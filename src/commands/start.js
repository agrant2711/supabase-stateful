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
import { isRunning } from '../lib/docker.js';
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
 * Apply pending migrations ON TOP of existing data
 * Uses `supabase migration up` instead of `db reset` to preserve data
 */
async function applyMigrations() {
  log.info('Checking for pending migrations...');

  try {
    const output = execSync('supabase migration list --output json', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const pendingCount = (output.match(/"Applied": false/g) || []).length;

    if (pendingCount > 0) {
      log.info(`Found ${pendingCount} pending migration(s)`);
      log.info('Applying migrations on top of existing data...');

      // Use `migration up` instead of `db reset` - this applies migrations WITHOUT wiping data
      const result = spawnSync('supabase', ['migration', 'up'], {
        stdio: 'inherit',
        shell: true,
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

    const result = spawnSync('supabase', ['migration', 'up'], {
      stdio: 'inherit',
      shell: true,
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
    shell: true,
  });

  if (result.status === 0) {
    return true;
  }

  log.warn('Standard start failed, trying alternatives...');

  // Try without analytics (logflare often causes health check issues)
  result = spawnSync('supabase', ['start', '--exclude', 'logflare'], {
    stdio: 'inherit',
    shell: true,
  });

  if (result.status === 0) {
    log.success('Started without analytics');
    return true;
  }

  // Try ignoring health checks
  result = spawnSync('supabase', ['start', '--ignore-health-check'], {
    stdio: 'inherit',
    shell: true,
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
