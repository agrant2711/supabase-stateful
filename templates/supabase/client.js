import { createBrowserClient } from '@supabase/ssr'
import { getSupabaseConfig } from './config'

/**
 * Create a Supabase client for browser/client-side use
 * Automatically uses local or production config based on environment
 */
export function createClient() {
  const config = getSupabaseConfig()

  return createBrowserClient(
    config.url,
    config.anonKey
  )
}
