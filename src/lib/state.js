/**
 * Core state management - save and restore database state
 *
 * Follows the proven workflow from scouty:
 * 1. Dynamically discover tables (excluding system tables)
 * 2. Export each table with pg_dump --table=schema.table
 * 3. Add ON CONFLICT DO NOTHING to all INSERTs via sed-like replacement
 * 4. Wrap with replication_role disable/enable for performance
 */

import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { execSync, spawn } from 'child_process';
import { createInterface } from 'readline';
import { once } from 'events';
import { getConfig, fileExists } from './config.js';
import { log } from '../utils/log.js';

/**
 * Save current database state to the state file
 */
export async function saveState() {
  const config = await getConfig();
  const container = config.containerName;

  // Backup existing state file
  if (await fileExists(config.stateFile)) {
    await fs.copyFile(config.stateFile, `${config.stateFile}.backup`);
  }

  log.dim('Discovering tables to export...');

  // Query to find all user tables (excluding system tables)
  const tablesQuery = `
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname IN ('public', 'auth', 'storage')
      AND tablename NOT LIKE 'supabase_%'
      AND tablename NOT LIKE '%_migrations'
      AND tablename NOT LIKE 'pg_%'
      AND tablename NOT IN ('schema_migrations', 'spatial_ref_sys', 's3_multipart_uploads', 's3_multipart_uploads_parts')
    ORDER BY schemaname, tablename;
  `;

  // Get list of tables
  const tablesOutput = execSync(
    `docker exec ${container} psql -U postgres -d postgres -t -c "${tablesQuery}"`,
    { encoding: 'utf8' }
  );

  // Parse table list and build --table flags
  const tableFlags = tablesOutput
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && line.includes('|'))
    .map(line => {
      const [schema, table] = line.split('|').map(s => s.trim());
      log.dim(`  Will export: ${schema}.${table}`);
      return `--table=${schema}.${table}`;
    })
    .join(' ');

  if (!tableFlags) {
    log.warn('No tables found to export');
    return;
  }

  // Run pg_dump with all table flags
  // Include schema (CREATE TABLE) + data so migrations can run ON TOP of existing data
  //
  // STREAMED to disk, never buffered into a string.
  //
  // This used to be `execSync(..., { maxBuffer: 50MB })`, which is a cliff
  // rather than a limit: a project's dump only ever grows, and the day it
  // passes the ceiling the save fails with `ENOBUFS` — after the tool has
  // already told the user it was saving. The state file is the entire point of
  // this package, so the failure lands exactly where it can do most harm, and
  // raising the number just moves the cliff a few months out.
  //
  // Streaming has no ceiling. The `ON CONFLICT DO NOTHING` rewrite that used to
  // run as a regex over the whole dump now runs per line as it flows past,
  // which is the same transformation in constant memory: `pg_dump --inserts`
  // emits one INSERT per line, so a line is the unit the old pattern matched
  // anyway (it was anchored `^…;$` with the `m` flag).
  const timestamp = new Date().toISOString();
  const header = `-- =============================================================================
-- Local Development State Snapshot
-- =============================================================================
-- Generated: ${timestamp}
-- Tool: supabase-stateful
--
-- This file contains your local development state including:
-- • auth.users (test users you created)
-- • All public schema data
-- • storage.buckets and storage.objects (file metadata)
-- • Foreign key relationships intact
--
-- This preserves your local development progress between sessions
-- =============================================================================

-- Disable foreign key checks temporarily
SET session_replication_role = replica;

`;

  const footer = `
-- Re-enable foreign key checks
SET session_replication_role = DEFAULT;

-- =============================================================================
-- Local State Restored
-- =============================================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'Local development state restored!';
  RAISE NOTICE '';
  RAISE NOTICE 'Your test users and data are preserved';
  RAISE NOTICE 'Migrations have been applied over existing data';
  RAISE NOTICE '';
END $$;
`;

  // WRITE TO A TEMPORARY FILE, then rename.
  //
  // `rename` is atomic within a filesystem, so a crash mid-dump leaves the
  // previous state file untouched rather than half-written. Without it a
  // failure partway through would destroy the very thing being backed up —
  // and this function's whole job is to not lose data.
  const tempFile = `${config.stateFile}.writing`;
  const out = createWriteStream(tempFile);

  const dump = spawn(
    'docker',
    ['exec', container, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--inserts',
     ...tableFlags.split(' ').filter(Boolean)],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  // Kept so a failure can say WHY rather than just exiting non-zero.
  let stderr = '';
  dump.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const write = (chunk) => {
    // Respect backpressure: `write` returning false means the buffer is full,
    // and ignoring it is how a stream quietly grows into the memory this
    // change exists to stop using.
    if (!out.write(chunk)) return once(out, 'drain');
    return null;
  };

  await write(header);

  const lines = createInterface({ input: dump.stdout, crlfDelay: Infinity });
  for await (const line of lines) {
    // The same rewrite as before, one line at a time. Makes a restore
    // idempotent: an existing row is skipped rather than raising a duplicate
    // key and aborting the whole restore.
    const rewritten = /^INSERT INTO .*;$/.test(line)
      ? `${line.slice(0, -1)}\nON CONFLICT DO NOTHING;`
      : line;
    const pending = write(`${rewritten}\n`);
    if (pending) await pending;
  }

  await write(footer);
  out.end();
  await once(out, 'finish');

  const [code] = await once(dump, 'close');
  if (code !== 0) {
    // Leave the previous state file alone — a failed dump must not replace a
    // good backup with a partial one.
    await fs.unlink(tempFile).catch(() => {});
    throw new Error(`pg_dump exited with ${code}${stderr ? `: ${stderr.trim()}` : ''}`);
  }

  await fs.rename(tempFile, config.stateFile);
}

/**
 * Restore saved state from the state file
 * Should be called AFTER migrations have been applied
 */
export async function restoreState() {
  const config = await getConfig();
  const container = config.containerName;

  if (!await fileExists(config.stateFile)) {
    return false;
  }

  // Disable storage triggers before restore (they block INSERT/DELETE)
  try {
    execSync(
      `docker exec ${container} psql -U postgres -d postgres -c "ALTER TABLE IF EXISTS storage.objects DISABLE TRIGGER ALL; ALTER TABLE IF EXISTS storage.buckets DISABLE TRIGGER ALL;"`,
      { encoding: 'utf8', stdio: 'pipe' }
    );
  } catch { /* table may not exist yet */ }

  // Copy state file into container
  execSync(`docker cp "${config.stateFile}" "${container}:/tmp/state.sql"`);

  // Apply the state file - errors are expected (duplicates) so we don't throw
  try {
    execSync(
      `docker exec ${container} psql -U postgres -d postgres -f /tmp/state.sql`,
      { encoding: 'utf8', stdio: 'pipe' }
    );
  } catch {
    // Errors during restore are tolerated (likely duplicate key conflicts)
    // The ON CONFLICT DO NOTHING handles most cases, but some edge cases may error
  }

  // Re-enable storage triggers
  try {
    execSync(
      `docker exec ${container} psql -U postgres -d postgres -c "ALTER TABLE IF EXISTS storage.objects ENABLE TRIGGER ALL; ALTER TABLE IF EXISTS storage.buckets ENABLE TRIGGER ALL;"`,
      { encoding: 'utf8', stdio: 'pipe' }
    );
  } catch { /* ignore */ }

  return true;
}

/**
 * Clear auth refresh tokens to prevent duplicate key errors on next start
 */
export async function clearAuthTokens() {
  const config = await getConfig();
  const container = config.containerName;

  try {
    execSync(
      `docker exec ${container} psql -U postgres -d postgres -c "DELETE FROM auth.refresh_tokens;"`,
      { encoding: 'utf8', stdio: 'pipe' }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a saved state file exists
 */
export async function stateExists() {
  const config = await getConfig();
  return fileExists(config.stateFile);
}

/**
 * Get info about the saved state (size, last modified)
 */
export async function getStateInfo() {
  const config = await getConfig();

  try {
    const stats = await fs.stat(config.stateFile);
    return {
      exists: true,
      path: config.stateFile,
      size: formatBytes(stats.size),
      modified: stats.mtime,
    };
  } catch {
    return {
      exists: false,
      path: config.stateFile,
    };
  }
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
