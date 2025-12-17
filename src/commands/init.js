/**
 * Init command - set up supabase-stateful in a project
 *
 * Steps:
 * 1. Check for supabase/config.toml (must have run 'supabase init' first)
 * 2. Parse project name from config
 * 3. Create .supabase-stateful.json with container name
 * 4. Add npm scripts to package.json
 * 5. Add state file to .gitignore
 */

import fs from 'fs/promises';
import path from 'path';
import toml from 'toml';
import { log } from '../utils/log.js';
import { saveConfig, fileExists, appendIfMissing, configExists } from '../lib/config.js';

export async function init() {
  log.info('Initializing supabase-stateful...');

  // Check if already initialized
  if (await configExists()) {
    log.warn('Already initialized (.supabase-stateful.json exists)');
    return;
  }

  // Check for supabase project
  const supabaseConfigPath = 'supabase/config.toml';
  if (!await fileExists(supabaseConfigPath)) {
    log.error('No supabase/config.toml found');
    console.log('');
    console.log('Run "supabase init" first to create a Supabase project');
    process.exit(1);
  }

  // Parse project name from supabase config
  let projectName;
  try {
    const configContent = await fs.readFile(supabaseConfigPath, 'utf8');
    const config = toml.parse(configContent);
    projectName = config.project_id || path.basename(process.cwd());
  } catch {
    projectName = path.basename(process.cwd());
  }

  log.info(`Detected project: ${projectName}`);

  // Create config file
  const statefulConfig = {
    stateFile: 'supabase/local-state.sql',
    containerName: `supabase_db_${projectName}`,
  };
  await saveConfig(statefulConfig);
  log.success('Created .supabase-stateful.json');

  // Update package.json with npm scripts
  if (await fileExists('package.json')) {
    try {
      const pkgContent = await fs.readFile('package.json', 'utf8');
      const pkg = JSON.parse(pkgContent);

      pkg.scripts = pkg.scripts || {};
      pkg.scripts['supabase:start'] = 'supabase-stateful start';
      pkg.scripts['supabase:stop'] = 'supabase-stateful stop';
      pkg.scripts['supabase:status'] = 'supabase-stateful status';

      await fs.writeFile('package.json', JSON.stringify(pkg, null, 2) + '\n');
      log.success('Added npm scripts to package.json');
    } catch (err) {
      log.warn(`Could not update package.json: ${err.message}`);
    }
  }

  // Add state file to .gitignore
  await appendIfMissing('.gitignore', 'supabase/local-state.sql');
  log.success('Added state file to .gitignore');

  console.log('');
  log.success('Initialized!');
  console.log('');
  console.log('Usage:');
  console.log('  npm run supabase:start   Start and restore saved state');
  console.log('  npm run supabase:stop    Save state and stop');
  console.log('  npm run supabase:status  Show current status');
  console.log('');
  console.log('Or run directly:');
  console.log('  npx supabase-stateful start');
  console.log('  npx supabase-stateful stop');
}
