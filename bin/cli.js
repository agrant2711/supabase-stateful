#!/usr/bin/env node

import { program } from 'commander';
import { init } from '../src/commands/init.js';
import { setup } from '../src/commands/setup.js';
import { start } from '../src/commands/start.js';
import { stop } from '../src/commands/stop.js';
import { status } from '../src/commands/status.js';
import { sync } from '../src/commands/sync.js';
import { exportData } from '../src/commands/export.js';
import { add, remove, list } from '../src/commands/add.js';

program
  .name('supabase-stateful')
  .description('Persistent local state for Supabase development')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize supabase-stateful (basic - just adds npm scripts)')
  .action(init);

program
  .command('setup')
  .description('Full setup - creates Supabase client files + npm scripts')
  .option('--force', 'Overwrite existing files')
  .option('-y, --yes', 'Skip interactive prompts (auto-confirm defaults)')
  .action(setup);

program
  .command('start')
  .description('Start Supabase and restore saved state')
  .action(start);

program
  .command('stop')
  .description('Save state, clear auth tokens, and stop Supabase')
  .action(stop);

program
  .command('status')
  .description('Show current status')
  .action(status);

program
  .command('sync')
  .description('Sync cloud data to local database')
  .option('--sample', 'Limit to 100 rows per table')
  .option('--tables <tables>', 'Comma-separated list of tables')
  .action(sync);

program
  .command('export')
  .description('Export cloud data to seed file')
  .option('--sample', 'Limit to 100 rows per table')
  .option('--tables <tables>', 'Comma-separated list of tables')
  .option('--output <path>', 'Output file path')
  .action(exportData);

program
  .command('add [name] [command]')
  .description('Add a service to dev:local (e.g., inngest, ngrok)')
  .action(add);

program
  .command('remove [name]')
  .description('Remove a service from dev:local')
  .action(remove);

program
  .command('services')
  .description('List services configured in dev:local')
  .action(list);

program.parse();
