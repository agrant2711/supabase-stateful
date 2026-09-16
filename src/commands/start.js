/**
 * Start command - start Supabase and restore saved state
 *
 * Flow:
 * 1. If already running: check for pending migrations, apply if needed
 * 2. If not running: start Supabase (with fallbacks for common issues)
 * 3. Restore saved state if it exists (schema + data from last session)
 * 4. Run pending migrations ON TOP of existing data
 *
 * This order is critical - migrations run on your data, not on an empty database.
 * E.g., if a teammate added a "rename column" migration, it transforms YOUR data.
 */

import { execSync, spawnSync } from 'child_process';
import { restoreState, stateExists } from '../lib/state.js';
import { isRunning, getDbContainerLogs } from '../lib/docker.js';
import { detectVersionMismatch, runUpgrade } from '../lib/upgrade.js';
import { log } from '../utils/log.js';

export async function start() {
  log.info('Starting Supabase with stateful development...');

  // Check if already running
  if (isRunning()) {
    log.success('Supabase already running');
    await handleRunningInstance();
    return;
  }

  // Start Supabase
  if (!await startSupabase()) {
    // Before giving up, check if this is a PG version mismatch
    const upgraded = await checkForPgUpgrade();
    if (upgraded) {
      // Upgrade restored data from the old volume.
      // Still apply saved state + new migrations on top.
      await restoreSavedState();
      await applyMigrations();
      printReady();
      return;
    }

    log.error('Failed to start Supabase');
    process.exit(1);
  }

  // Restore saved state FIRST (schema + data from last session)
  await restoreSavedState();

  // Apply pending migrations ON TOP of existing data
  await applyMigrations();

  printReady();
}

/**
 * Handle when Supabase is already running
 * Apply any pending migrations on top of existing data
 */
async function handleRunningInstance() {
  // Apply pending migrations on top of existing data
  await applyMigrations();
  printReady();
}

/**
 * Check docker logs for PG version mismatch and offer upgrade if detected
 * Returns true if upgrade was performed successfully
 */
async function checkForPgUpgrade() {
  log.dim('Checking for PostgreSQL version incompatibility...');

  const logs = getDbContainerLogs(100);
  const mismatch = detectVersionMismatch(logs);

  if (!mismatch) {
    return false;
  }

  log.warn(
    `Detected PostgreSQL version mismatch: ` +
    `data is PG${mismatch.oldVersion}, server is PG${mismatch.newVersion}`
  );

  return await runUpgrade({
    oldVersion: mismatch.oldVersion,
    newVersion: mismatch.newVersion,
  });
}

/**
 * Count the migrations present locally but not yet applied to the database.
 *
 * Exported and PURE so the parsing can be exercised without a Supabase install
 * — this function is where the silent failure lived, and a silent failure is
 * precisely what a test has to be able to reach.
 *
 * ## Two formats, because the CLI changed under us
 *
 * `supabase migration list` printed an ASCII table for years:
 *
 *     20251221044839 |                | 2025-12-21 04:48:39
 *
 * Newer CLIs (2.x) emit JSON instead:
 *
 *     {"migrations":[{"local":"20251221044839","remote":"","time":"…"}]}
 *
 * JSON contains no `|`, so the old table parser matched nothing, counted zero
 * pending migrations and reported "No pending migrations" — while `migration
 * up` was never called. Every migration added after the user upgraded their CLI
 * was silently skipped, with a success message on screen. That is the worst
 * available failure mode: the tool said the thing it was built to do had been
 * done.
 *
 * Both formats are handled rather than only the new one, because this package
 * cannot control which CLI a consumer has installed, and the table format is
 * still what older versions produce.
 *
 * @param {string} output Raw stdout from `supabase migration list`.
 * @returns {number} How many migrations exist locally but are not applied.
 */
export function countPendingMigrations(output) {
  const trimmed = (output ?? '').trim();
  if (!trimmed) return 0;

  // JSON first — it is what current CLIs emit, and it is unambiguous.
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const migrations = Array.isArray(parsed) ? parsed : (parsed.migrations ?? []);
      // A pending migration has a local version and NO remote one. `remote` is
      // an empty string rather than absent, so falsiness is the right test.
      return migrations.filter((m) => m?.local && !m?.remote).length;
    } catch {
      // Malformed JSON is not a table — fall through and let the table parser
      // find nothing rather than guessing.
    }
  }

  // Legacy ASCII table.
  let pendingCount = 0;

  for (const line of trimmed.split('\n')) {
    // Skip header lines and empty lines
    if (line.includes('Local') || line.includes('---') || !line.trim()) continue;

    // Split by | and check columns
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length >= 2) {
      const localVersion = parts[0];
      const remoteVersion = parts[1];
      // If there's a local version but no remote version, it's pending
      if (localVersion && /^\d+$/.test(localVersion) && !remoteVersion) {
        pendingCount++;
      }
    }
  }

  return pendingCount;
}

/**
 * Apply pending migrations ON TOP of existing data
 * Uses `supabase migration up` instead of `db reset` to preserve data
 */
async function applyMigrations() {
  log.info('Checking for pending migrations...');

  try {
    // `--output-format json` is REQUESTED, never assumed. The default format is
    // the CLI's to change — and when it changed from table to JSON, this check
    // silently stopped finding anything. Asking for a format explicitly means a
    // future default cannot break it again.
    //
    // Older CLIs do not know the flag and exit non-zero, which lands in the
    // catch below and applies migrations anyway — the safe direction. The
    // parser still understands the table format for anyone pinned there.
    const output = execSync('supabase migration list --local --output-format json', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const pendingCount = countPendingMigrations(output);

    if (pendingCount > 0) {
      log.info(`Found ${pendingCount} pending migration(s)`);
      log.info('Applying migrations on top of existing data...');

      // Use `migration up` instead of `db reset` - this applies migrations WITHOUT wiping data
      //
      // `--local` MATCHES THE CHECK ABOVE, and must. The list is read with
      // `--local`, so without it here the tool decides what is pending by
      // looking at the local database and then applies it to whatever
      // `migration up` defaults to — the LINKED project when one is configured.
      // This command exists to manage a local stack; it must never reach a
      // remote database.
      const result = spawnSync('supabase', ['migration', 'up', '--local'], {
        stdio: 'inherit',
      });

      if (result.status !== 0) {
        log.error('Migration failed');
        process.exit(1);
      }

      log.success('Migrations applied');
    } else {
      log.success('No pending migrations');
    }
  } catch {
    // Migration check failed, try applying anyway
    log.dim('Could not check migration status, attempting to apply...');

    const result = spawnSync('supabase', ['migration', 'up', '--local'], {
      stdio: 'inherit',
    });

    if (result.status === 0) {
      log.success('Migrations applied');
    }
  }
}

/**
 * Start Supabase with fallbacks for common issues
 */
async function startSupabase() {
  log.info('Starting Supabase...');

  // Try normal start first
  let result = spawnSync('supabase', ['start'], {
    stdio: 'inherit',
  });

  if (result.status === 0) {
    return true;
  }

  log.warn('Standard start failed, trying alternatives...');

  // Try without analytics (logflare often causes health check issues)
  result = spawnSync('supabase', ['start', '--exclude', 'logflare'], {
    stdio: 'inherit',
  });

  if (result.status === 0) {
    log.success('Started without analytics');
    return true;
  }

  // Try ignoring health checks
  result = spawnSync('supabase', ['start', '--ignore-health-check'], {
    stdio: 'inherit',
  });

  if (result.status === 0) {
    log.success('Started ignoring health checks');
    return true;
  }

  return false;
}

/**
 * Restore saved state if it exists
 */
async function restoreSavedState() {
  if (await stateExists()) {
    log.info('Found saved state - restoring...');

    try {
      await restoreState();
      console.log('');
      log.success('Previous session restored!');
      console.log('');
      console.log('Your test users and data have been restored');
      console.log('Database schema updated and data preserved');
    } catch {
      log.warn('State restoration had some errors (likely duplicates - this is normal)');
    }
  } else {
    log.info('No saved state found');
    console.log('');
    console.log('Create test users, then run: supabase-stateful stop');
    console.log('Your state will be saved for next session');
  }
}

/**
 * Print ready message
 */
function printReady() {
  console.log('');
  console.log('Access Supabase Studio: http://localhost:54323');
  log.success('Ready for development!');
}
