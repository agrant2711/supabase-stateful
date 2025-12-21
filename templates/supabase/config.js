/**
 * Supabase Environment Configuration
 *
 * Automatically switches between local and production Supabase
 * based on the NEXT_PUBLIC_SUPABASE_LOCAL environment variable.
 *
 * Usage:
 *   npm run dev:local     -> NEXT_PUBLIC_SUPABASE_LOCAL=true  -> uses localhost:54321
 *   npm run dev           -> NEXT_PUBLIC_SUPABASE_LOCAL=false -> uses cloud Supabase
 *
 * Required environment variables for production (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ...  (optional, for admin operations)
 *
 * Find these in: Supabase Dashboard -> Project Settings -> API
 */

const isLocalDev = process.env.NEXT_PUBLIC_SUPABASE_LOCAL === 'true'
const isProduction = process.env.NODE_ENV === 'production'

// Local Supabase configuration
// These are the default keys from `supabase start` - same for all local instances
// See: https://supabase.com/docs/guides/cli/local-development
const LOCAL_CONFIG = {
  url: 'http://127.0.0.1:54321',
  // Default anon key from supabase start (public, same for everyone)
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
  // Default service role key from supabase start (public, same for everyone)
  serviceRoleKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
}

// Production configuration (from your .env file)
const PRODUCTION_CONFIG = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
}

/**
 * Get Supabase configuration based on environment
 */
export function getSupabaseConfig() {
  const config = isLocalDev ? LOCAL_CONFIG : PRODUCTION_CONFIG

  if (!config.url || !config.anonKey) {
    throw new Error(`Missing Supabase configuration for ${isLocalDev ? 'local' : 'production'} environment`)
  }

  return {
    url: config.url,
    anonKey: config.anonKey,
    serviceRoleKey: config.serviceRoleKey,
    isLocal: isLocalDev,
    environment: isLocalDev ? 'local' : (isProduction ? 'production' : 'development')
  }
}

/**
 * Get configuration for admin/service role client
 */
export function getSupabaseAdminConfig() {
  const config = getSupabaseConfig()

  if (!config.serviceRoleKey) {
    throw new Error(`Missing service role key for ${config.environment} environment`)
  }

  return {
    url: config.url,
    serviceRoleKey: config.serviceRoleKey,
    isLocal: config.isLocal,
    environment: config.environment
  }
}
