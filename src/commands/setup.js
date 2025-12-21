/**
 * Setup command - complete setup including Supabase client files
 *
 * This does everything init does, plus:
 * 1. Creates src/utils/supabase/ client files with local/production switching
 * 2. Adds dev:local and dev:all:local scripts
 * 3. Optionally installs GitHub Actions workflow
 * 4. Optionally creates dev-local.sh with graceful shutdown
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { log } from '../utils/log.js';
import { fileExists } from '../lib/config.js';
import { init } from './init.js';
import { confirm, select } from '../utils/prompt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Template files for Supabase clients
const CONFIG_TEMPLATE = `/**
 * Supabase Environment Configuration
 *
 * Automatically switches between local and production Supabase
 * based on the NEXT_PUBLIC_SUPABASE_LOCAL environment variable.
 *
 * Usage:
 *   npm run dev:local     -> uses localhost:54321
 *   npm run dev           -> uses cloud Supabase
 */

const isLocalDev = process.env.NEXT_PUBLIC_SUPABASE_LOCAL === 'true'
const isProduction = process.env.NODE_ENV === 'production'

// Local Supabase - default keys from \`supabase start\`
const LOCAL_CONFIG = {
  url: 'http://127.0.0.1:54321',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
  serviceRoleKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
}

// Production - from .env
const PRODUCTION_CONFIG = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
}

export function getSupabaseConfig() {
  const config = isLocalDev ? LOCAL_CONFIG : PRODUCTION_CONFIG

  if (!config.url || !config.anonKey) {
    throw new Error(\`Missing Supabase config for \${isLocalDev ? 'local' : 'production'}\`)
  }

  return {
    url: config.url,
    anonKey: config.anonKey,
    serviceRoleKey: config.serviceRoleKey,
    isLocal: isLocalDev,
    environment: isLocalDev ? 'local' : (isProduction ? 'production' : 'development')
  }
}

export function getSupabaseAdminConfig() {
  const config = getSupabaseConfig()
  if (!config.serviceRoleKey) {
    throw new Error(\`Missing service role key for \${config.environment}\`)
  }
  return { url: config.url, serviceRoleKey: config.serviceRoleKey }
}
`;

const CLIENT_TEMPLATE = `import { createBrowserClient } from '@supabase/ssr'
import { getSupabaseConfig } from './config'

export function createClient() {
  const config = getSupabaseConfig()
  return createBrowserClient(config.url, config.anonKey)
}
`;

const SERVER_TEMPLATE = `import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { getSupabaseConfig, getSupabaseAdminConfig } from './config'

export async function createClient() {
  const cookieStore = await cookies()
  const config = getSupabaseConfig()

  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          // Called from Server Component - middleware handles refresh
        }
      },
    },
  })
}

export function createAdminClient() {
  const config = getSupabaseAdminConfig()
  return createSupabaseClient(config.url, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
}
`;

const MIDDLEWARE_TEMPLATE = `import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import { getSupabaseConfig } from './config'

export async function updateSession(request) {
  let supabaseResponse = NextResponse.next({ request })
  const config = getSupabaseConfig()

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        supabaseResponse = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        )
      },
    },
  })

  await supabase.auth.getUser()
  return supabaseResponse
}
`;

/**
 * Main setup command
 */
export async function setup(options = {}) {
  const isInteractive = !options.yes && process.stdin.isTTY;

  log.info('Setting up supabase-stateful...');

  // Step 1: Run basic init
  await init();

  // Step 2: Check if this is a Next.js project (required for client files)
  const isNextJs = await isNextJsProject();

  if (isNextJs) {
    // Step 3: Check for Supabase dependencies
    const hasSupabaseSsr = await hasDependency('@supabase/ssr');
    const hasSupabaseJs = await hasDependency('@supabase/supabase-js');

    const missingDeps = [];
    if (!hasSupabaseSsr) missingDeps.push('@supabase/ssr');
    if (!hasSupabaseJs) missingDeps.push('@supabase/supabase-js');

    if (missingDeps.length > 0) {
      let shouldInstall = true;

      if (isInteractive) {
        shouldInstall = await confirm(
          `Install ${missingDeps.join(' and ')}?`,
          'Required for the Supabase client files.\n' +
          '• @supabase/ssr - Server-side rendering support for auth\n' +
          '• @supabase/supabase-js - Core Supabase client library',
          true
        );
      }

      if (shouldInstall) {
        for (const dep of missingDeps) {
          installDependency(dep);
        }
      }
    }

    // Step 4: Detect utils path and create client files
    const utilsPath = await detectUtilsPath();
    if (utilsPath) {
      let createClients = true;

      if (isInteractive) {
        createClients = await confirm(
          'Create Supabase client files?',
          'This creates config.js, client.js, server.js, and middleware.js\n' +
          `in ${utilsPath}/supabase/ with automatic local/production switching.\n` +
          'Use \`npm run dev:local\` for local, \`npm run dev\` for production.',
          true
        );
      }

      if (createClients) {
        await createClientFiles(utilsPath, options.force, isInteractive);
      }
    } else {
      log.warn('Could not detect utils path - skipping client file creation');
      log.info('Manually copy files from templates/supabase/ to your project');
    }
  } else {
    log.dim('Skipping Supabase client files (Next.js not detected)');
    log.dim('The generated client files are Next.js App Router specific.');
  }

  // Step 4: Check for concurrently (needed for graceful shutdown)
  let services = await detectServices();
  if (!services.hasConcurrently) {
    let shouldInstall = false;

    if (isInteractive) {
      shouldInstall = await confirm(
        'Install concurrently?',
        'Enables running multiple services together and graceful shutdown.\n' +
        'With this, pressing Ctrl+C will automatically save your database\n' +
        'state before stopping. Without it, you must manually run\n' +
        '\`npm run supabase:stop\` before closing your terminal.',
        true
      );
    }

    if (shouldInstall) {
      if (installDependency('concurrently', true)) {
        // Re-detect services after installing
        services = await detectServices();
        services.hasConcurrently = true;
      }
    }
  }

  // Step 5: Add dev scripts
  await addDevScripts(services);

  // Step 6: GitHub workflow (only if remote Supabase is configured)
  if (isInteractive) {
    const hasRemote = await hasRemoteSupabase();

    if (hasRemote) {
      const installWorkflow = await confirm(
        'Install GitHub Actions workflow for CI/CD?',
        'Automatically applies database migrations when you push to main.',
        false
      );

      if (installWorkflow) {
        const workflowType = await select('Select workflow type:', [
          { value: 'migrations', label: 'Migrations only (Supabase CLI)' },
          { value: 'full', label: 'Migrations + Vercel deploy' },
        ], 'migrations');

        await installGitHubWorkflow(workflowType, options.force);
      }
    }
  }

  // Step 7: dev-local.sh script (requires concurrently)
  if (services.hasConcurrently) {
    let createDevScript = !isInteractive; // Auto-create in non-interactive mode

    if (isInteractive) {
      createDevScript = await confirm(
        'Create scripts/dev-local.sh with graceful shutdown?',
        'This script saves your database state when you press Ctrl+C.\n' +
        'Without it, you need to manually run \`npm run supabase:stop\`\n' +
        'before closing your terminal to preserve your test data.',
        true
      );
    }

    if (createDevScript) {
      await createDevLocalScript(services, options.force);
    }
  }

  // Final output
  console.log('');
  log.success('Setup complete!');
  console.log('');
  console.log('Usage:');
  console.log('  npm run dev:local           Start with local Supabase');
  if (services.hasConcurrently) {
    console.log('  npm run dev:all:local       Start all services with local Supabase');
    if (await fileExists('scripts/dev-local.sh')) {
      console.log('  ./scripts/dev-local.sh      Start with graceful shutdown (Ctrl+C saves state)');
    }
  }
  console.log('  npm run supabase:stop       Save state and stop');
}

/**
 * Detect where utils folder is (src/utils, utils, lib, src/lib)
 */
async function detectUtilsPath() {
  const candidates = [
    'src/utils',
    'src/lib',
    'utils',
    'lib',
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  // If src exists, create src/utils
  if (await fileExists('src')) {
    return 'src/utils';
  }

  return null;
}

/**
 * Detect available services from package.json
 */
async function detectServices() {
  try {
    const pkgContent = await fs.readFile('package.json', 'utf8');
    const pkg = JSON.parse(pkgContent);

    return {
      devCmd: pkg.scripts?.dev || 'next dev',
      hasInngest: !!(pkg.scripts?.inngest || pkg.scripts?.['dev:inngest'] || pkg.dependencies?.inngest || pkg.devDependencies?.inngest),
      hasNgrok: !!(pkg.scripts?.ngrok || pkg.dependencies?.ngrok || pkg.devDependencies?.ngrok),
      hasConcurrently: !!(pkg.dependencies?.concurrently || pkg.devDependencies?.concurrently),
    };
  } catch {
    return { devCmd: 'next dev', hasInngest: false, hasNgrok: false, hasConcurrently: false };
  }
}

/**
 * Create Supabase client files in the utils directory
 */
async function createClientFiles(utilsPath, force = false, isInteractive = false) {
  const supabasePath = path.join(utilsPath, 'supabase');
  await fs.mkdir(supabasePath, { recursive: true });

  const files = [
    { name: 'config.js', content: CONFIG_TEMPLATE },
    { name: 'client.js', content: CLIENT_TEMPLATE },
    { name: 'server.js', content: SERVER_TEMPLATE },
    { name: 'middleware.js', content: MIDDLEWARE_TEMPLATE },
  ];

  // Check for existing files
  const existingFiles = [];
  for (const file of files) {
    const filePath = path.join(supabasePath, file.name);
    if (await fileExists(filePath)) {
      existingFiles.push(file.name);
    }
  }

  // Handle conflicts
  let shouldOverwrite = force;
  if (existingFiles.length > 0 && !force && isInteractive) {
    log.warn(`Some Supabase client files already exist: ${existingFiles.join(', ')}`);
    shouldOverwrite = await confirm(
      'Overwrite existing files?',
      'This will replace any customizations you made to these files.',
      false
    );
  }

  // Write files
  let createdAny = false;
  for (const file of files) {
    const filePath = path.join(supabasePath, file.name);
    const exists = await fileExists(filePath);

    if (exists && !shouldOverwrite) {
      log.dim(`Skipped ${file.name} (already exists)`);
    } else {
      await fs.writeFile(filePath, file.content);
      log.success(exists ? `Overwrote ${filePath}` : `Created ${filePath}`);
      createdAny = true;
    }
  }

  // Show env setup reminder if files were created
  if (createdAny) {
    log.info('');
    log.info('For production, add to .env.local:');
    log.dim('  NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co');
    log.dim('  NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...');
    log.dim('  SUPABASE_SERVICE_ROLE_KEY=eyJ...  (optional)');
    log.info('Find these in: Supabase Dashboard → Project Settings → API');
    log.info('');
  }
}

/**
 * Add dev:local and dev:all:local scripts to package.json
 */
async function addDevScripts(services) {
  if (!await fileExists('package.json')) return;

  try {
    const pkgContent = await fs.readFile('package.json', 'utf8');
    const pkg = JSON.parse(pkgContent);
    pkg.scripts = pkg.scripts || {};

    // Add dev:local
    if (!pkg.scripts['dev:local']) {
      pkg.scripts['dev:local'] = `NEXT_PUBLIC_SUPABASE_LOCAL=true ${services.devCmd}`;
      log.success('Added dev:local script');
    }

    // Add dev:all:local if they have concurrently
    if (services.hasConcurrently && !pkg.scripts['dev:all:local']) {
      let cmds = '"npm run supabase:start" "npm run dev:local"';
      let names = 'SUPABASE,NEXT';
      let colors = 'green,cyan';

      if (services.hasInngest) {
        const inngestCmd = pkg.scripts['dev:inngest'] ? 'dev:inngest' : 'inngest';
        cmds += ` "npm run ${inngestCmd}"`;
        names += ',INNGEST';
        colors += ',magenta';
      }

      if (services.hasNgrok) {
        cmds += ' "npm run ngrok"';
        names += ',NGROK';
        colors += ',yellow';
      }

      pkg.scripts['dev:all:local'] = `concurrently ${cmds} --names "${names}" --prefix-colors "${colors}"`;
      log.success('Added dev:all:local script');
    }

    await fs.writeFile('package.json', JSON.stringify(pkg, null, 2) + '\n');
  } catch (err) {
    log.warn(`Could not update package.json: ${err.message}`);
  }
}

/**
 * Install GitHub workflow file
 */
async function installGitHubWorkflow(workflowType, force = false) {
  const workflowDir = '.github/workflows';
  await fs.mkdir(workflowDir, { recursive: true });

  const targetFile = path.join(workflowDir, 'deploy.yml');

  if (await fileExists(targetFile) && !force) {
    log.dim('Skipped GitHub workflow (already exists)');
    return;
  }

  // Read template from package templates directory
  const templatesDir = path.resolve(__dirname, '../../templates/github-workflow');
  const sourceFile = workflowType === 'migrations'
    ? path.join(templatesDir, 'migrations-only.yml')
    : path.join(templatesDir, 'deploy.yml');

  const content = await fs.readFile(sourceFile, 'utf8');
  await fs.writeFile(targetFile, content);

  log.success(`Created ${targetFile} (${workflowType === 'migrations' ? 'migrations only' : 'migrations + Vercel deploy'})`);

  // Show required secrets
  console.log('');
  log.info('Required GitHub secrets:');
  console.log('  - SUPABASE_ACCESS_TOKEN');
  console.log('  - SUPABASE_PROJECT_REF');
  console.log('  - SUPABASE_DB_PASSWORD');
  if (workflowType === 'full') {
    console.log('  - VERCEL_TOKEN');
    console.log('  - VERCEL_ORG_ID');
    console.log('  - VERCEL_PROJECT_ID');
  }
}

/**
 * Generate dev-local.sh script content
 */
function generateDevLocalScript(services) {
  const commands = ['"npm run supabase:start"', '"npm run dev:local"'];
  const names = ['SUPABASE', 'NEXT'];
  const colors = ['green', 'cyan'];

  if (services.hasInngest) {
    commands.push('"npm run inngest"');
    names.push('INNGEST');
    colors.push('magenta');
  }

  if (services.hasNgrok) {
    commands.push('"npm run ngrok"');
    names.push('NGROK');
    colors.push('yellow');
  }

  return `#!/bin/bash

# Local Development Script with Graceful Shutdown
# Generated by supabase-stateful setup
# Press Ctrl+C to stop - you'll be asked whether to save Supabase state

GREEN='\\033[0;32m'
YELLOW='\\033[0;33m'
CYAN='\\033[0;36m'
RED='\\033[0;31m'
NC='\\033[0m'

echo -e "\${CYAN}Starting local development environment...\${NC}"
echo ""

# Trap SIGINT so the shell doesn't exit when Ctrl+C is pressed
# This allows us to run cleanup code after concurrently exits
trap 'echo ""' INT

# Run concurrently in background so trap can catch SIGINT
npx concurrently \\
    --names "${names.join(',')}" \\
    --prefix-colors "${colors.join(',')}" \\
    --kill-others-on-fail \\
    ${commands.join(' \\\n    ')} &

CONCURRENT_PID=\$!

# Wait for concurrently to finish (will return immediately when SIGINT is received)
wait \$CONCURRENT_PID 2>/dev/null

# Small delay to let processes finish their output
sleep 0.5

# After concurrently exits (from Ctrl+C or error), ask about saving state
echo ""
echo -e "\${CYAN}Save Supabase state and stop? [Y/n]\${NC}"
echo -e "\${CYAN}(Choose 'n' if you're just restarting the dev server)\${NC}"

# Read with timeout, default to Yes
read -t 10 -n 1 response
echo ""

if [[ "\$response" =~ ^[Nn]$ ]]; then
    echo -e "\${GREEN}Dev server stopped. Supabase still running.\${NC}"
    echo -e "Run \${YELLOW}npx supabase-stateful stop\${NC} later to save state."
else
    echo -e "\${CYAN}Saving Supabase state...\${NC}"
    npx supabase-stateful stop
    echo ""
    echo -e "\${GREEN}Development environment stopped. State saved.\${NC}"
fi
`;
}

/**
 * Create the dev-local.sh script
 */
async function createDevLocalScript(services, force = false) {
  const scriptsDir = 'scripts';
  await fs.mkdir(scriptsDir, { recursive: true });

  const scriptPath = path.join(scriptsDir, 'dev-local.sh');

  if (await fileExists(scriptPath) && !force) {
    log.dim('Skipped scripts/dev-local.sh (already exists)');
    return;
  }

  const content = generateDevLocalScript(services);
  await fs.writeFile(scriptPath, content, { mode: 0o755 });

  log.success('Created scripts/dev-local.sh');
}

/**
 * Check if a dependency is installed
 */
async function hasDependency(name) {
  try {
    const pkgContent = await fs.readFile('package.json', 'utf8');
    const pkg = JSON.parse(pkgContent);
    return !!(pkg.dependencies?.[name] || pkg.devDependencies?.[name]);
  } catch {
    return false;
  }
}

/**
 * Install a dependency using npm
 */
function installDependency(name, isDev = false) {
  const flag = isDev ? '--save-dev' : '--save';
  try {
    log.info(`Installing ${name}...`);
    execSync(`npm install ${flag} ${name}`, { stdio: 'inherit' });
    log.success(`Installed ${name}`);
    return true;
  } catch {
    log.error(`Failed to install ${name}`);
    return false;
  }
}

/**
 * Check if project has a remote Supabase configured
 * Looks for .env with SUPABASE_URL or supabase/.temp/project-ref
 */
async function hasRemoteSupabase() {
  // Check for linked project (created by `supabase link`)
  if (await fileExists('supabase/.temp/project-ref')) {
    return true;
  }

  // Check for .env with Supabase URL
  try {
    const envFiles = ['.env', '.env.local', '.env.production'];
    for (const envFile of envFiles) {
      if (await fileExists(envFile)) {
        const content = await fs.readFile(envFile, 'utf8');
        if (content.includes('SUPABASE_URL') || content.includes('NEXT_PUBLIC_SUPABASE_URL')) {
          return true;
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return false;
}

/**
 * Check if this is a Next.js project
 */
async function isNextJsProject() {
  return await hasDependency('next');
}
