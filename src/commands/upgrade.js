/**
 * Upgrade command - manually trigger PostgreSQL version upgrade
 *
 * Usage: supabase-stateful upgrade
 *
 * Detects the PG version mismatch from docker logs and runs the
 * upgrade pipeline. Falls back to manual version input if auto-detection fails.
 */

import { getDbContainerLogs } from '../lib/docker.js';
import { detectVersionMismatch, runUpgrade } from '../lib/upgrade.js';
import { log } from '../utils/log.js';
import { input } from '../utils/prompt.js';

export async function upgrade() {
  log.info('PostgreSQL Version Upgrade');
  console.log('');

  // Try to auto-detect versions from docker logs
  const logs = getDbContainerLogs(100);
  let mismatch = detectVersionMismatch(logs);

  if (mismatch) {
    log.info(
      `Detected: PostgreSQL ${mismatch.oldVersion} → ${mismatch.newVersion}`
    );
  } else {
    log.warn('Could not auto-detect PostgreSQL versions from docker logs');
    console.log('');
    console.log('This usually means the DB container has been removed already.');
    console.log('Please provide the version numbers manually:');
    console.log('');

    const oldVersion = await input(
      'Old PostgreSQL version (the one your data was created with)',
      '15'
    );
    const newVersion = await input(
      'New PostgreSQL version (the one Supabase CLI now uses)',
      '17'
    );

    mismatch = { oldVersion, newVersion };
  }

  const success = await runUpgrade({
    oldVersion: mismatch.oldVersion,
    newVersion: mismatch.newVersion,
  });

  if (!success) {
    process.exit(1);
  }
}
