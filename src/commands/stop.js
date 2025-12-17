/**
 * Stop command - save state, clear auth tokens, stop Supabase
 *
 * Flow:
 * 1. Check if Supabase is running
 * 2. Save current database state
 * 3. Clear auth.refresh_tokens (prevents duplicate key errors on next start)
 * 4. Stop Supabase
 */

import { saveState, clearAuthTokens } from '../lib/state.js';
import { isRunning, shell } from '../lib/docker.js';
import { log } from '../utils/log.js';

export async function stop() {
  // Check if Supabase is running
  if (!isRunning()) {
    log.warn('Supabase is not running');
    return;
  }

  log.info('Saving state and stopping Supabase...');

  // Save current database state
  log.info('Saving local database state...');
  try {
    await saveState();
    log.success('State saved');
  } catch (err) {
    log.error(`Failed to save state: ${err.message}`);
    // Continue anyway - user may want to stop even if save fails
  }

  // Clear refresh tokens to prevent duplicate key errors on next start
  log.info('Clearing auth tokens...');
  if (await clearAuthTokens()) {
    log.success('Refresh tokens cleared');
  } else {
    log.warn('Could not clear refresh tokens (this is okay)');
  }

  // Stop Supabase
  log.info('Stopping Supabase...');
  shell('supabase stop');

  log.success('Supabase stopped cleanly');
  console.log('');
  console.log('State saved and auth tokens cleared');
  console.log('Next time: supabase-stateful start to restore your session');
}
