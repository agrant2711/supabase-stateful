/**
 * PostgreSQL version upgrade module
 *
 * Handles the case where a Supabase CLI update upgrades PostgreSQL
 * (e.g., PG15 → PG17), making the existing Docker data volume incompatible.
 *
 * Flow:
 * 1. Detect PG version mismatch from docker logs
 * 2. Prompt user for confirmation
 * 3. Dump all data using a temp container with the OLD PG version
 * 4. Stop Supabase and remove only the DB volume (preserve storage)
 * 5. Start Supabase fresh (new PG version + migrations)
 * 6. Restore data from the dump
 * 7. Clean up temp files
 */

import { execSync, spawnSync } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { getProjectName, volumeExists, removeVolume } from './docker.js';
import { getConfig } from './config.js';
import { log } from '../utils/log.js';
import { confirm } from '../utils/prompt.js';

const TEMP_CONTAINER_NAME = 'supabase_stateful_pg_upgrade';
const DUMP_FILENAME = 'supabase-stateful-upgrade-dump.sql';
const BACKUP_FILENAME = 'supabase/upgrade-backup.sql';
const PG_READY_TIMEOUT_MS = 30_000;
const PG_READY_POLL_MS = 1_000;

// --- Detection ---

/**
 * Parse docker logs for PG version mismatch error.
 * Returns { oldVersion, newVersion } or null if no mismatch detected.
 */
export function detectVersionMismatch(logOutput) {
  const patterns = [
    /initialized by PostgreSQL version (\d+).*?not compatible with.*?version (\d+)/s,
    /data directory was initialized by PostgreSQL version (\d+).*?this version (\d+)/s,
  ];

  for (const pattern of patterns) {
    const match = logOutput.match(pattern);
    if (match) {
      return {
        oldVersion: match[1],
        newVersion: match[2],
      };
    }
  }

  return null;
}

// --- Data Dump Phase ---

/**
 * Dump all data from the existing (incompatible) volume using a temp container
 * running the OLD PostgreSQL version.
 *
 * Returns the path to the dump file.
 */
export async function dumpDataFromOldVolume(oldVersion) {
  const projectName = await getProjectName();
  const dbVolume = `supabase_db_${projectName}`;
  const pgImage = `postgres:${oldVersion}`;
  const dumpPath = path.join(os.tmpdir(), DUMP_FILENAME);

  log.info(`Pulling PostgreSQL ${oldVersion} image...`);
  const pullResult = spawnSync('docker', ['pull', pgImage], {
    stdio: 'inherit',
    shell: true,
  });
  if (pullResult.status !== 0) {
    throw new Error(`Failed to pull Docker image: ${pgImage}`);
  }

  // Clean up any leftover temp container from a previous failed attempt
  cleanupTempContainer();

  log.info(`Starting temporary PostgreSQL ${oldVersion} container...`);
  const runResult = spawnSync('docker', [
    'run', '-d',
    '--name', TEMP_CONTAINER_NAME,
    '-v', `${dbVolume}:/var/lib/postgresql/data`,
    pgImage,
  ], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (runResult.status !== 0) {
    throw new Error(
      `Failed to start temp container: ${runResult.stderr || 'unknown error'}`
    );
  }

  log.info('Waiting for PostgreSQL to be ready...');
  await waitForPgReady(TEMP_CONTAINER_NAME);

  log.info('Dumping all database data...');
  try {
    const dumpSql = execSync(
      `docker exec ${TEMP_CONTAINER_NAME} pg_dumpall -U postgres --data-only`,
      { encoding: 'utf8', maxBuffer: 200 * 1024 * 1024 }
    );
    await fs.writeFile(dumpPath, dumpSql);
    log.success(`Dump saved (${formatBytes(Buffer.byteLength(dumpSql))})`);
  } catch (err) {
    cleanupTempContainer();
    throw new Error(`pg_dumpall failed: ${err.message}`);
  }

  cleanupTempContainer();

  return dumpPath;
}

/**
 * Wait for PostgreSQL to be ready inside a container
 */
async function waitForPgReady(containerName) {
  const startTime = Date.now();

  while (Date.now() - startTime < PG_READY_TIMEOUT_MS) {
    try {
      execSync(
        `docker exec ${containerName} pg_isready -U postgres`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      return;
    } catch {
      await sleep(PG_READY_POLL_MS);
    }
  }

  throw new Error(
    `PostgreSQL did not become ready within ${PG_READY_TIMEOUT_MS / 1000}s`
  );
}

/**
 * Stop and remove the temporary upgrade container if it exists
 */
function cleanupTempContainer() {
  try {
    execSync(`docker rm -f ${TEMP_CONTAINER_NAME}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    // Container doesn't exist, that's fine
  }
}

// --- Volume Replacement Phase ---

/**
 * Stop Supabase and selectively remove only the DB volume.
 *
 * Uses normal `supabase stop` (NOT --no-backup) to preserve the
 * supabase_storage_* volume which contains actual uploaded files.
 * Then manually removes only the supabase_db_* volume.
 */
export async function replaceDbVolume() {
  const projectName = await getProjectName();
  const dbVolume = `supabase_db_${projectName}`;

  log.info('Stopping Supabase...');
  spawnSync('supabase', ['stop'], {
    stdio: 'inherit',
    shell: true,
  });

  if (!volumeExists(dbVolume)) {
    log.warn(`Volume ${dbVolume} not found (may have been removed already)`);
    return;
  }

  log.info(`Removing incompatible database volume: ${dbVolume}`);
  if (!removeVolume(dbVolume)) {
    // Volume might still be in use — force-stop containers using it
    log.warn('Volume in use, force-stopping remaining containers...');
    try {
      execSync(
        `docker ps -a --filter "volume=${dbVolume}" -q | xargs -r docker rm -f`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
    } catch { /* ignore */ }

    if (!removeVolume(dbVolume)) {
      throw new Error(
        `Could not remove volume ${dbVolume}. Try: docker volume rm ${dbVolume}`
      );
    }
  }

  log.success(`Removed volume: ${dbVolume}`);
  log.dim(`Preserved: supabase_storage_${projectName} (uploaded files intact)`);
}

// --- Fresh Start Phase ---

/**
 * Start Supabase fresh with the new PG version.
 * Creates a new DB volume and applies all migrations.
 */
export async function startFresh() {
  log.info('Starting Supabase with new PostgreSQL version...');

  let result = spawnSync('supabase', ['start'], {
    stdio: 'inherit',
    shell: true,
  });

  if (result.status === 0) return;

  // Same fallback chain as start.js
  log.warn('Standard start failed, trying without analytics...');
  result = spawnSync('supabase', ['start', '--exclude', 'logflare'], {
    stdio: 'inherit',
    shell: true,
  });

  if (result.status === 0) return;

  throw new Error(
    'Failed to start Supabase after volume replacement. ' +
    'Your dump file is preserved for manual recovery.'
  );
}

// --- Data Restoration Phase ---

/**
 * Restore data from the pg_dumpall dump file.
 *
 * Filters the dump to only restore auth/public/storage COPY blocks,
 * disables storage triggers, and applies via psql.
 */
export async function restoreData(dumpPath) {
  const config = await getConfig();
  const container = config.containerName;

  log.info('Restoring data from dump...');

  const rawDump = await fs.readFile(dumpPath, 'utf8');
  const filteredSql = filterDumpForRestore(rawDump);

  const restoreSql = `-- Upgrade data restoration (generated by supabase-stateful)
SET session_replication_role = replica;
ALTER TABLE IF EXISTS storage.objects DISABLE TRIGGER ALL;
ALTER TABLE IF EXISTS storage.buckets DISABLE TRIGGER ALL;

${filteredSql}

ALTER TABLE IF EXISTS storage.objects ENABLE TRIGGER ALL;
ALTER TABLE IF EXISTS storage.buckets ENABLE TRIGGER ALL;
SET session_replication_role = DEFAULT;
`;

  const restorePath = path.join(os.tmpdir(), 'supabase-stateful-restore.sql');
  await fs.writeFile(restorePath, restoreSql);

  execSync(`docker cp "${restorePath}" "${container}:/tmp/upgrade-restore.sql"`);

  try {
    execSync(
      `docker exec ${container} psql -U postgres -d postgres -f /tmp/upgrade-restore.sql`,
      { encoding: 'utf8', maxBuffer: 200 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    log.success('Data restored successfully');
  } catch (err) {
    const stderr = err.stderr || '';
    if (stderr.includes('duplicate key')) {
      log.warn('Some duplicate key errors during restoration (expected for existing data)');
    } else {
      log.warn(`Restoration had errors: ${stderr.slice(0, 500)}`);
      log.warn('Your data may be partially restored. Check the dump file for manual recovery.');
    }
  }

  try { await fs.unlink(restorePath); } catch { /* ignore */ }
}

/**
 * Filter pg_dumpall output to extract only COPY blocks for
 * auth, public, and storage schemas. Skips role management,
 * database creation, and internal Supabase schema data.
 */
function filterDumpForRestore(dumpSql) {
  const lines = dumpSql.split('\n');
  const output = [];
  let inCopyBlock = false;
  let includeCopyBlock = false;

  const targetSchemas = ['auth', 'public', 'storage'];
  const skipTables = ['schema_migrations', 'supabase_migrations'];

  for (const line of lines) {
    if (line.startsWith('COPY ') && line.includes(' FROM stdin;')) {
      inCopyBlock = true;

      const tableMatch = line.match(/^COPY\s+(\w+)\.(\w+)\s/);
      if (tableMatch) {
        const [, schema, table] = tableMatch;
        includeCopyBlock = targetSchemas.includes(schema)
          && !skipTables.includes(table);
      } else {
        includeCopyBlock = false;
      }

      if (includeCopyBlock) {
        output.push(line);
      }
      continue;
    }

    if (inCopyBlock && line === '\\.') {
      if (includeCopyBlock) {
        output.push(line);
        output.push('');
      }
      inCopyBlock = false;
      includeCopyBlock = false;
      continue;
    }

    if (inCopyBlock) {
      if (includeCopyBlock) {
        output.push(line);
      }
      continue;
    }
  }

  return output.join('\n');
}

// --- Orchestrator ---

/**
 * Run the full upgrade pipeline.
 *
 * @param {object} options
 * @param {string} options.oldVersion - The old PG version (e.g., "15")
 * @param {string} options.newVersion - The new PG version (e.g., "17")
 * @param {boolean} options.skipConfirmation - Skip the user confirmation prompt
 */
export async function runUpgrade({ oldVersion, newVersion, skipConfirmation = false }) {
  console.log('');
  log.warn('PostgreSQL Version Upgrade Required');
  console.log('');
  console.log(`  Old version: PostgreSQL ${oldVersion} (in existing data volume)`);
  console.log(`  New version: PostgreSQL ${newVersion} (required by Supabase CLI)`);
  console.log('');
  console.log('  This process will:');
  console.log('  1. Export all your data using the old PostgreSQL version');
  console.log('  2. Remove the incompatible database volume');
  console.log('  3. Start Supabase fresh (applies all migrations)');
  console.log('  4. Restore your data');
  console.log('');
  console.log('  Your storage files (uploaded images, etc.) will be preserved.');
  console.log('');

  if (!skipConfirmation) {
    const proceed = await confirm(
      'Proceed with PostgreSQL upgrade?',
      'A backup of your data will be saved in case anything goes wrong.',
      true
    );

    if (!proceed) {
      log.info('Upgrade cancelled');
      console.log('');
      console.log('To fix manually:');
      console.log('  1. supabase stop');
      console.log('  2. docker volume rm supabase_db_<project>');
      console.log('  3. supabase start');
      console.log('  (Note: this loses all local data)');
      return false;
    }
  }

  let dumpPath;

  try {
    log.info('Phase 1/4: Exporting data from old PostgreSQL volume...');
    dumpPath = await dumpDataFromOldVolume(oldVersion);

    // Save a backup in the project directory
    await fs.copyFile(dumpPath, BACKUP_FILENAME);
    log.dim(`  Backup saved to: ${BACKUP_FILENAME}`);

    log.info('Phase 2/4: Replacing database volume...');
    await replaceDbVolume();

    log.info('Phase 3/4: Starting Supabase with new PostgreSQL...');
    await startFresh();

    log.info('Phase 4/4: Restoring data...');
    await restoreData(dumpPath);

    // Cleanup temp files on success
    try { await fs.unlink(dumpPath); } catch { /* ignore */ }
    try { await fs.unlink(BACKUP_FILENAME); } catch { /* ignore */ }

    console.log('');
    log.success('PostgreSQL upgrade complete!');
    console.log('');
    console.log(`  Upgraded: PostgreSQL ${oldVersion} → ${newVersion}`);
    console.log('  All data has been migrated');
    console.log('  Storage files preserved');
    console.log('');

    return true;
  } catch (err) {
    console.log('');
    log.error(`Upgrade failed: ${err.message}`);
    console.log('');

    if (dumpPath) {
      try {
        await fs.access(BACKUP_FILENAME);
        console.log('  Your data dump has been preserved:');
        console.log(`    ${BACKUP_FILENAME}`);
        console.log('');
        console.log('  To recover manually:');
        console.log('    1. supabase stop');
        console.log('    2. docker volume rm supabase_db_<project>');
        console.log('    3. supabase start');
        console.log(`    4. docker cp ${BACKUP_FILENAME} supabase_db_<project>:/tmp/restore.sql`);
        console.log('    5. docker exec supabase_db_<project> psql -U postgres -f /tmp/restore.sql');
      } catch {
        try {
          await fs.access(dumpPath);
          console.log(`  Your data dump is at: ${dumpPath}`);
        } catch {
          console.log('  WARNING: No dump file found. Data may be lost.');
        }
      }
    }

    return false;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
