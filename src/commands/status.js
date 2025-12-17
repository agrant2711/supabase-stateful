/**
 * Status command - show current state
 *
 * Displays:
 * - Whether Supabase is running
 * - Saved state info (exists, size, last modified)
 * - Configuration details
 */

import { isRunning } from '../lib/docker.js';
import { getStateInfo } from '../lib/state.js';
import { getConfig, configExists } from '../lib/config.js';
import { log } from '../utils/log.js';

export async function status() {
  console.log('');
  console.log('Supabase Stateful Status');
  console.log('========================');
  console.log('');

  // Check if initialized
  if (!await configExists()) {
    log.warn('Not initialized');
    console.log('');
    console.log('Run: supabase-stateful init');
    return;
  }

  const config = await getConfig();

  // Supabase status
  if (isRunning()) {
    log.success('Supabase: Running');
  } else {
    log.info('Supabase: Stopped');
  }

  // State file status
  const stateInfo = await getStateInfo();
  if (stateInfo.exists) {
    log.success(`State file: ${stateInfo.path}`);
    console.log(`  Size: ${stateInfo.size}`);
    console.log(`  Modified: ${stateInfo.modified.toLocaleString()}`);
  } else {
    log.info(`State file: Not saved yet`);
    console.log(`  Path: ${stateInfo.path}`);
  }

  // Config info
  console.log('');
  console.log('Configuration:');
  console.log(`  Container: ${config.containerName}`);
  console.log(`  State file: ${config.stateFile}`);

  // Service URLs if running
  if (isRunning()) {
    console.log('');
    console.log('Service URLs:');
    console.log('  API: http://localhost:54321');
    console.log('  Studio: http://localhost:54323');
    console.log('  Database: localhost:54322');
  }

  console.log('');
}
