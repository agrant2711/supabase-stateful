/**
 * Docker and shell command helpers
 *
 * Provides utilities for:
 * - Running commands inside the Supabase postgres container (psql, pg_dump)
 * - Running shell commands (supabase start/stop)
 * - Checking if Supabase containers are running
 */

import { execSync, spawnSync } from 'child_process';
import { readFileSync } from 'fs';
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
 * The configured container name, read SYNCHRONOUSLY.
 *
 * `getConfig()` is async and this cannot be. `isRunning()` is called as a bare
 * `if (isRunning())` in five places, two of them NEGATED (`stop.js`,
 * `sync.js`). An async version returns a Promise, which is always truthy, so a
 * single missed `await` would invert those guards — `stop` would decide nothing
 * was running and refuse to stop it. Reading the file synchronously keeps the
 * signature and every call site untouched.
 *
 * Returns null when there is no config, so a project that has never run `init`
 * keeps the old behaviour instead of throwing.
 */
function configuredContainerName() {
  try {
    const parsed = JSON.parse(readFileSync('.supabase-stateful.json', 'utf8'));
    return typeof parsed.containerName === 'string' && parsed.containerName
      ? parsed.containerName
      : null;
  } catch {
    return null;
  }
}

/**
 * Check if THIS PROJECT'S Supabase containers are running.
 *
 * Matches the container named in `.supabase-stateful.json`, not the bare
 * `supabase_db_` prefix.
 *
 * ## The prefix check was a bug, and a silent one
 *
 * Anyone with two Supabase projects on one machine — which is every consultant
 * and most teams — has a second `supabase_db_<other>` in `docker ps`. The prefix
 * matched it, so `isRunning()` answered a question about the WRONG project.
 *
 * `start()` then took its "already running" branch and skipped both
 * `startSupabase()` and, far worse, `restoreSavedState()`. It went on to apply
 * migrations against a port with nothing behind it, failed to connect, and
 * printed "Ready for development!" anyway. The user is told their stateful
 * database is up when it was never started and their saved state — the entire
 * point of this package — was never restored.
 *
 * `stop.js` and `sync.js` were wrong in the same way, in the opposite
 * direction: both guard on `!isRunning()`, so they would act on a project whose
 * container is not there.
 *
 * The config file next to this code already names the right container. It
 * simply was not consulted.
 */
export function isRunning() {
  try {
    const output = execSync('docker ps --format "{{.Names}}"', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'], // Suppress stderr (Docker not running errors)
    });

    const container = configuredContainerName();
    // No config (pre-`init`): fall back to the old prefix behaviour rather than
    // throwing. Still wrong in the two-project case, but no worse than before.
    if (!container) return output.includes('supabase_db_');

    // Exact line match. `--format "{{.Names}}"` prints one name per line, so a
    // substring test would also match a container whose name merely CONTAINS
    // ours — `supabase_db_app` matching `supabase_db_app_staging`.
    return output.split('\n').some((name) => name.trim() === container);
  } catch {
    return false;
  }
}

/**
 * Get the project name from the container name config
 * e.g., "supabase_db_homefree" → "homefree"
 */
export async function getProjectName() {
  const config = await getConfig();
  return config.containerName.replace('supabase_db_', '');
}

/**
 * Get docker logs for THIS PROJECT'S DB container (last N lines).
 * Works even when the container has exited (crashed).
 *
 * Same bug as `isRunning()` had, and a more dangerous one: the bare
 * `supabase_db_` filter returned EVERY project's container and this took the
 * first line of that list. With two projects on one machine, which one you got
 * was down to docker's ordering.
 *
 * Both callers feed the output to `detectVersionMismatch()` — `start.js` on a
 * failed start, and `upgrade.js`. A PG version mismatch found in ANOTHER
 * project's logs would offer to "upgrade" this project, and that path removes
 * the data volume. Reading the wrong container here risks the wrong data.
 */
export function getDbContainerLogs(tailLines = 50) {
  try {
    const configured = configuredContainerName();
    const containers = execSync(
      'docker ps -a --format "{{.Names}}" --filter "name=supabase_db_"',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const names = containers.trim().split('\n').map((n) => n.trim()).filter(Boolean);

    // Exact match on the configured name. No config (pre-`init`): fall back to
    // the first container, as before — no worse than the old behaviour.
    const containerName = configured
      ? names.find((name) => name === configured)
      : names[0];
    if (!containerName) return '';

    return execSync(
      `docker logs --tail ${tailLines} ${containerName} 2>&1`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch (err) {
    return err.stderr || err.stdout || '';
  }
}

/**
 * Check if a Docker volume exists
 */
export function volumeExists(volumeName) {
  try {
    execSync(`docker volume inspect ${volumeName}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a specific Docker volume
 */
export function removeVolume(volumeName) {
  try {
    execSync(`docker volume rm ${volumeName}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}
