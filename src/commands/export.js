/**
 * Export command - export cloud data to a seed file
 *
 * Options:
 * --sample    Limit to 100 rows per table
 * --tables    Comma-separated list of tables
 * --output    Output file path (default: supabase/seed-data.sql)
 */

import { exportCloudData } from '../lib/cloud.js';
import { log } from '../utils/log.js';

export async function exportData(options) {
  log.info('Exporting cloud data...');

  try {
    const output = await exportCloudData({
      sample: options.sample,
      tables: options.tables,
      output: options.output || 'supabase/seed-data.sql',
    });

    console.log('');
    log.success('Export complete!');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Review the generated seed file');
    console.log('  2. Run: supabase-stateful sync  (to apply to local)');
    console.log(`  Or manually: supabase db reset && psql < ${output}`);
  } catch (err) {
    log.error(`Export failed: ${err.message}`);
    process.exit(1);
  }
}
