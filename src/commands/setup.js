/**
 * Setup command - complete setup including Supabase client files
 *
 * This does everything init does, plus:
 * 1. Creates src/utils/supabase/ client files with local/production switching
 * 2. Adds dev:local and dev:all:local scripts
 */

import fs from 'fs/promises';
import path from 'path';
import { log } from '../utils/log.js';
import { fileExists } from '../lib/config.js';
import { init } from './init.js';

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

export async function setup(options = {}) {
  log.info('Setting up supabase-stateful with client files...');

  // First run the basic init
  await init();

  // Detect the utils path
  const utilsPath = await detectUtilsPath();
  if (!utilsPath) {
    log.warn('Could not detect utils path - skipping client file creation');
    log.info('Manually copy files from templates/supabase/ to your project');
    return;
  }

  const supabasePath = path.join(utilsPath, 'supabase');

  // Create supabase directory if needed
  await fs.mkdir(supabasePath, { recursive: true });

  // Write client files
  const files = [
    { name: 'config.js', content: CONFIG_TEMPLATE },
    { name: 'client.js', content: CLIENT_TEMPLATE },
    { name: 'server.js', content: SERVER_TEMPLATE },
    { name: 'middleware.js', content: MIDDLEWARE_TEMPLATE },
  ];

  for (const file of files) {
    const filePath = path.join(supabasePath, file.name);
    if (await fileExists(filePath)) {
      if (options.force) {
        await fs.writeFile(filePath, file.content);
        log.success(`Overwrote ${filePath}`);
      } else {
        log.dim(`Skipped ${file.name} (already exists)`);
      }
    } else {
      await fs.writeFile(filePath, file.content);
      log.success(`Created ${filePath}`);
    }
  }

  // Add dev:local scripts to package.json
  await addDevScripts();

  console.log('');
  log.success('Setup complete!');
  console.log('');
  console.log('Usage:');
  console.log('  npm run dev:local        Start with local Supabase');
  console.log('  npm run dev:all:local    Start all services with local Supabase');
  console.log('  npm run supabase:stop    Save state and stop');
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
 * Add dev:local and dev:all:local scripts to package.json
 */
async function addDevScripts() {
  if (!await fileExists('package.json')) return;

  try {
    const pkgContent = await fs.readFile('package.json', 'utf8');
    const pkg = JSON.parse(pkgContent);
    pkg.scripts = pkg.scripts || {};

    // Detect the dev command framework
    const devCmd = pkg.scripts.dev || 'next dev';
    const hasInngest = pkg.scripts.inngest;
    const hasNgrok = pkg.scripts.ngrok;

    // Add dev:local
    if (!pkg.scripts['dev:local']) {
      pkg.scripts['dev:local'] = `NEXT_PUBLIC_SUPABASE_LOCAL=true ${devCmd}`;
      log.success('Added dev:local script');
    }

    // Add dev:all:local if they have concurrently
    const hasConcurrently = pkg.devDependencies?.concurrently || pkg.dependencies?.concurrently;
    if (hasConcurrently && !pkg.scripts['dev:all:local']) {
      let services = '"npm run supabase:start" "npm run dev:local"';
      let names = 'SUPABASE,NEXT';
      let colors = 'green,cyan';

      if (hasInngest) {
        services += ' "npm run inngest"';
        names += ',INNGEST';
        colors += ',magenta';
      }

      pkg.scripts['dev:all:local'] = `concurrently ${services} --names "${names}" --prefix-colors "${colors}"`;
      log.success('Added dev:all:local script');
    }

    await fs.writeFile('package.json', JSON.stringify(pkg, null, 2) + '\n');
  } catch (err) {
    log.warn(`Could not update package.json: ${err.message}`);
  }
}
