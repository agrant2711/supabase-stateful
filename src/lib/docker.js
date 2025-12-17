/**
 * Docker and shell command helpers
 *
 * Provides utilities for:
 * - Running commands inside the Supabase postgres container (psql, pg_dump)
 * - Running shell commands (supabase start/stop)
 * - Checking if Supabase containers are running
 */

import { execSync, spawnSync } from 'child_process';
import { getConfig } from './config.js';

/**
 * Get the Supabase postgres container name from config
 */
export async function getContainerName() {
  const config = await getConfig();
  return config.containerName;
}

/**
 * Run a psql command inside the Supabase postgres container
 * Returns the command output
 */
export async function psql(sql) {
  const container = await getContainerName();
  return execSync(
    `docker exec ${container} psql -U postgres -d postgres -c "${sql}"`,
    { encoding: 'utf8' }
  );
}

/**
 * Run pg_dump inside the container and return the SQL output
 */
export async function pgDump(schemas = ['public', 'auth']) {
  const container = await getContainerName();
  const schemaFlags = schemas.map(s => `--schema=${s}`).join(' ');

  return execSync(
    `docker exec ${container} pg_dump -U postgres -d postgres --data-only --inserts ${schemaFlags}`,
    { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 } // 50MB buffer for large exports
  );
}

/**
 * Copy a file into the container and run psql on it
 */
export async function psqlFile(localPath) {
  const container = await getContainerName();

  // Copy file into container
  execSync(`docker cp "${localPath}" "${container}:/tmp/state.sql"`);

  // Run psql on the file
  return execSync(
    `docker exec ${container} psql -U postgres -d postgres -f /tmp/state.sql`,
    { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }
  );
}

/**
 * Run a shell command with output shown to user
 */
export function shell(cmd) {
  return spawnSync(cmd, {
    shell: true,
    stdio: 'inherit',
  });
}

/**
 * Run a shell command and capture output
 */
export function shellCapture(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8' });
  } catch (err) {
    return err.stdout || '';
  }
}

/**
 * Check if Supabase containers are running
 */
export function isRunning() {
  try {
    const output = execSync('docker ps --format "{{.Names}}"', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'], // Suppress stderr (Docker not running errors)
    });
    return output.includes('supabase_db_');
  } catch {
    return false;
  }
}
