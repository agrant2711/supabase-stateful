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
import { execSync } from 'child_process';
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
    WHERE schemaname IN ('public', 'auth')
      AND tablename NOT LIKE 'supabase_%'
      AND tablename NOT LIKE '%_migrations'
      AND tablename NOT LIKE 'pg_%'
      AND tablename NOT IN ('schema_migrations', 'spatial_ref_sys')
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
  const rawSql = execSync(
    `docker exec ${container} pg_dump -U postgres -d postgres --inserts ${tableFlags}`,
    { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }
  );

  // Add ON CONFLICT DO NOTHING to all INSERT statements
  // This makes restoration idempotent - existing rows are skipped
  const safeSql = rawSql.replace(
    /^(INSERT INTO [^;]+);$/gm,
    '$1\nON CONFLICT DO NOTHING;'
  );

  // Wrap with header and footer
  const timestamp = new Date().toISOString();
  const sql = `-- =============================================================================
-- Local Development State Snapshot
-- =============================================================================
-- Generated: ${timestamp}
-- Tool: supabase-stateful
--
-- This file contains your local development state including:
-- • auth.users (test users you created)
-- • All public schema data
-- • Foreign key relationships intact
--
-- This preserves your local development progress between sessions
-- =============================================================================

-- Disable foreign key checks temporarily
SET session_replication_role = replica;

${safeSql}

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

  await fs.writeFile(config.stateFile, sql);
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
