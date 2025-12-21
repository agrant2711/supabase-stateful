/**
 * Configuration file management
 *
 * Handles the .supabase-stateful.json config file that stores:
 * - stateFile: where to save the database state (default: supabase/local-state.sql)
 * - containerName: the docker container name (e.g., supabase_db_myproject)
 */

import fs from 'fs/promises';

const CONFIG_FILE = '.supabase-stateful.json';

const DEFAULT_CONFIG = {
  stateFile: 'supabase/local-state.sql',
  containerName: null,
  // Services to run with dev:local (besides supabase and next)
  // Each entry is { name: 'INNGEST', command: 'npm run inngest', color: 'magenta' }
  devServices: [],
};

/**
 * Load config from .supabase-stateful.json
 * Falls back to defaults if file doesn't exist
 */
export async function getConfig() {
  try {
    const content = await fs.readFile(CONFIG_FILE, 'utf8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/**
 * Save config to .supabase-stateful.json
 */
export async function saveConfig(config) {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Check if config file exists (used to detect if init has been run)
 */
export async function configExists() {
  try {
    await fs.access(CONFIG_FILE);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generic file exists check
 */
export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Append a line to a file if not already present
 * Used to add state file to .gitignore
 */
export async function appendIfMissing(filePath, line) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    if (!content.includes(line)) {
      await fs.appendFile(filePath, `\n${line}\n`);
    }
  } catch {
    await fs.writeFile(filePath, `${line}\n`);
  }
}
