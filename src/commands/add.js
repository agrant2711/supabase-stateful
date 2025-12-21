/**
 * Add command - add a service to the dev:local script
 *
 * Usage:
 *   npx supabase-stateful add
 *   npx supabase-stateful add inngest "npx inngest-cli dev"
 */

import fs from 'fs/promises';
import path from 'path';
import { log } from '../utils/log.js';
import { getConfig, saveConfig, fileExists } from '../lib/config.js';
import { input, select, confirm } from '../utils/prompt.js';

export async function add(name, command) {
  // Load current config
  const config = await getConfig();
  config.devServices = config.devServices || [];

  let service;

  if (name && command) {
    // Non-interactive mode: name and command provided as arguments
    const color = await selectColor();
    service = { name: name.toLowerCase(), command, color };
  } else {
    // Interactive mode: prompt for everything
    service = await promptForService();
  }

  if (!service) {
    log.error('No service added');
    return;
  }

  // Check for duplicate
  const existing = config.devServices.find(s => s.name === service.name);
  if (existing) {
    const replace = await confirm(`Service "${service.name}" already exists. Replace it?`, '', false);
    if (replace) {
      config.devServices = config.devServices.filter(s => s.name !== service.name);
    } else {
      log.info('Cancelled');
      return;
    }
  }

  // Add service
  config.devServices.push(service);
  await saveConfig(config);

  // Regenerate the dev-local.sh script
  await regenerateScript(config);

  log.success(`Added ${service.name} to dev:local`);
  console.log('');
  log.info('Run `npm run dev:local` to start with all services');
}

/**
 * Remove a service from dev:local
 */
export async function remove(name) {
  const config = await getConfig();
  config.devServices = config.devServices || [];

  if (!name) {
    // Interactive mode: show list to select from
    if (config.devServices.length === 0) {
      log.info('No services configured');
      return;
    }

    const options = config.devServices.map(s => ({
      label: `${s.name} (${s.command})`,
      value: s.name,
    }));

    name = await select('Which service to remove?', options);
  }

  const existing = config.devServices.find(s => s.name === name);
  if (!existing) {
    log.error(`Service "${name}" not found`);
    return;
  }

  config.devServices = config.devServices.filter(s => s.name !== name);
  await saveConfig(config);

  // Regenerate the dev-local.sh script
  await regenerateScript(config);

  log.success(`Removed ${name} from dev:local`);
}

/**
 * List configured services
 */
export async function list() {
  const config = await getConfig();
  const services = config.devServices || [];

  console.log('');
  console.log('Services in dev:local:');
  console.log('');
  console.log('  supabase (built-in)');
  console.log('  next     (built-in)');

  if (services.length === 0) {
    console.log('');
    log.dim('No additional services configured');
    log.dim('Add one with: npx supabase-stateful add');
  } else {
    for (const s of services) {
      console.log(`  ${s.name.padEnd(10)} ${s.command}`);
    }
  }
  console.log('');
}

/**
 * Prompt user step-by-step for a service configuration
 */
async function promptForService() {
  console.log('');

  // Step 1: Name
  const name = await input('Service name (e.g., inngest, ngrok, stripe)');
  if (!name) return null;

  // Step 2: Command
  const command = await input('Command to run (e.g., npx inngest-cli dev)');
  if (!command) return null;

  // Step 3: Color
  const color = await selectColor();

  return { name: name.toLowerCase(), command, color };
}

/**
 * Prompt for color selection
 */
async function selectColor() {
  return await select('Display color', [
    { label: 'Magenta', value: 'magenta' },
    { label: 'Yellow', value: 'yellow' },
    { label: 'Blue', value: 'blue' },
    { label: 'Red', value: 'red' },
    { label: 'White', value: 'white' },
  ]);
}

/**
 * Regenerate dev-local.sh with current services
 */
async function regenerateScript(config) {
  const scriptPath = 'scripts/dev-local.sh';

  if (!await fileExists(scriptPath)) {
    log.warn('scripts/dev-local.sh not found. Run `npx supabase-stateful setup` first.');
    return;
  }

  // Detect dev command from package.json
  let devCmd = 'npm run dev';
  try {
    const pkgContent = await fs.readFile('package.json', 'utf8');
    const pkg = JSON.parse(pkgContent);
    if (pkg.scripts?.dev) {
      devCmd = pkg.scripts.dev;
    }
  } catch {
    // Use default
  }

  const content = generateDevLocalScript(devCmd, config.devServices || []);
  await fs.writeFile(scriptPath, content, { mode: 0o755 });
}

/**
 * Generate dev-local.sh script content
 */
function generateDevLocalScript(devCmd, devServices = []) {
  // Base commands: supabase start and next dev with local env var
  const commands = ['"npm run supabase:start"', `"NEXT_PUBLIC_SUPABASE_LOCAL=true ${devCmd}"`];
  const names = ['supabase', 'next'];
  const colors = ['green', 'cyan'];

  // Add configured services
  for (const svc of devServices) {
    commands.push(`"${svc.command}"`);
    names.push(svc.name.toLowerCase());
    colors.push(svc.color);
  }

  return `#!/bin/bash

# Local Development Script with Graceful Shutdown
# Generated by supabase-stateful
# Press Ctrl+C to stop and save Supabase state
#
# To add more services: npx supabase-stateful add
# To list services: npx supabase-stateful services
# To remove a service: npx supabase-stateful remove

GREEN='\\033[0;32m'
YELLOW='\\033[0;33m'
CYAN='\\033[0;36m'
NC='\\033[0m'

echo -e "\${CYAN}Starting local development environment...\${NC}"
echo ""

# Cleanup function called on Ctrl+C
cleanup() {
    echo ""
    echo -e "\${YELLOW}Shutting down gracefully...\${NC}"
    echo -e "\${CYAN}Saving Supabase state...\${NC}"

    # Kill the concurrently process group
    kill \$DEV_PID 2>/dev/null

    # Wait a moment for processes to terminate
    sleep 1

    # Save Supabase state
    npx supabase-stateful stop

    echo ""
    echo -e "\${GREEN}Development environment stopped. State saved.\${NC}"
    exit 0
}

# Trap Ctrl+C (SIGINT) and call cleanup
trap cleanup SIGINT SIGTERM

# Start the development environment in background
npx concurrently \\
    --names "${names.join(',')}" \\
    --prefix-colors "${colors.join(',')}" \\
    ${commands.join(' \\\n    ')} &

DEV_PID=\$!

# Wait for the background process
wait \$DEV_PID
`;
}
