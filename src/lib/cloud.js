/**
 * Cloud data export - pull data from a remote Supabase instance
 *
 * Requires environment variables:
 * - SUPABASE_URL - Your Supabase project URL
 * - SUPABASE_SERVICE_ROLE_KEY - Service role key for data access
 *
 * Based on scouty's data-export.js
 */

import fs from 'fs/promises';
import { log } from '../utils/log.js';

// Tables to export in dependency order (parent tables first)
const DEFAULT_TABLES = [
  'coaches',
  'client_profiles',
  'products',
  'plans',
  'coach_availability',
  'plan_groups',
  'subscriptions',
  'enquiries',
  'purchases',
  'payments',
  'bookings',
  'reviews',
  'coach_reviews',
  'events',
];

/**
 * Export data from cloud Supabase to a seed file
 */
export async function exportCloudData(options = {}) {
  const { sample = false, tables = null, output = 'supabase/seed-data.sql' } = options;

  // Check for required env vars
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    log.error('Missing environment variables');
    console.log('');
    console.log('Required:');
    console.log('  SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)');
    console.log('  SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  log.info('Connecting to cloud Supabase...');
  log.dim(`URL: ${url}`);

  // Determine which tables to export
  const tablesToExport = tables ? tables.split(',').map(t => t.trim()) : DEFAULT_TABLES;
  const limit = sample ? 100 : null;

  log.info(`Exporting ${tablesToExport.length} tables${sample ? ' (sample: 100 rows each)' : ''}...`);

  const allData = [];

  for (const table of tablesToExport) {
    const tableData = await fetchTable(url, key, table, limit);
    if (tableData) {
      allData.push(tableData);
      log.success(`  ${table}: ${tableData.data.length} rows`);
    } else {
      log.dim(`  ${table}: skipped (not found or empty)`);
    }
  }

  // Generate SQL file
  const sql = generateSql(allData, sample);
  await fs.writeFile(output, sql);

  const totalRows = allData.reduce((sum, t) => sum + t.data.length, 0);
  log.success(`Exported ${totalRows} total rows to ${output}`);

  return output;
}

/**
 * Fetch data from a single table
 */
async function fetchTable(url, key, table, limit) {
  try {
    let apiUrl = `${url}/rest/v1/${table}?select=*`;
    if (limit) {
      apiUrl += `&limit=${limit}`;
    }

    const response = await fetch(apiUrl, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (!data || data.length === 0) {
      return null;
    }

    return { table, data };
  } catch {
    return null;
  }
}

/**
 * Generate SQL INSERT statements from exported data
 */
function generateSql(allData, sample) {
  const timestamp = new Date().toISOString();

  let sql = `-- =============================================================================
-- Cloud Data Export
-- =============================================================================
-- Generated: ${timestamp}
-- Mode: ${sample ? 'Sample (100 rows per table)' : 'Full export'}
--
-- Use this file to seed your local database with cloud data
-- =============================================================================

SET session_replication_role = replica;

`;

  for (const { table, data } of allData) {
    if (data.length === 0) continue;

    const columns = Object.keys(data[0]);
    const columnList = columns.map(c => `"${c}"`).join(', ');

    sql += `-- ${table}\n`;
    sql += `INSERT INTO public.${table} (${columnList}) VALUES\n`;

    const valueRows = data.map((row, i) => {
      const values = columns.map(col => formatValue(row[col])).join(', ');
      const comma = i < data.length - 1 ? ',' : '';
      return `  (${values})${comma}`;
    });

    sql += valueRows.join('\n');
    sql += '\nON CONFLICT DO NOTHING;\n\n';
  }

  sql += `SET session_replication_role = DEFAULT;\n`;

  return sql;
}

/**
 * Format a value for SQL INSERT
 */
function formatValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  }
  // String - escape single quotes
  return `'${String(value).replace(/'/g, "''")}'`;
}
