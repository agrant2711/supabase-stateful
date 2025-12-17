import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdminConfig } from './config'

/**
 * Create a Supabase admin client with service role privileges
 * Bypasses RLS policies - only use server-side!
 */
export function createAdminClient() {
  const config = getSupabaseAdminConfig()

  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}
