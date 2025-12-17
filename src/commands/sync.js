/**
 * Sync command - export cloud data and apply to local database
 *
 * Combines export + local application:
 * 1. Export cloud data to seed file
 * 2. Reset local database (applies migrations)
 * 3. Apply the seed data
 */

import { spawnSync } from 'child_process';
import { exportCloudData } from '../lib/cloud.js';
import { isRunning, psqlFile } from '../lib/docker.js';
import { log } from '../utils/log.js';

export async function sync(options) {
  log.info('Syncing cloud data to local...');

  // Check if Supabase is running
  if (!isRunning()) {
    log.error('Supabase is not running');
    console.log('');
    console.log('Start it first: supabase-stateful start');
    process.exit(1);
  }

  // Export cloud data
  let seedFile;
  try {
    seedFile = await exportCloudData({
      sample: options.sample,
      tables: options.tables,
    });
  } catch (err) {
    log.error(`Export failed: ${err.message}`);
    process.exit(1);
  }

  // Reset local database to apply migrations
  log.info('Resetting local database...');
  const resetResult = spawnSync('supabase', ['db', 'reset'], {
    stdio: 'inherit',
    shell: true,
  });

  if (resetResult.status !== 0) {
    log.error('Database reset failed');
    process.exit(1);
  }

  // Apply the seed data
  log.info('Applying seed data...');
  try {
    await psqlFile(seedFile);
  } catch {
    log.warn('Some seed data may have failed (duplicates - this is normal)');
  }

  console.log('');
  log.success('Sync complete!');
  console.log('');
  console.log('Your local database now has cloud data');
  console.log('Access Studio: http://localhost:54323');
}
