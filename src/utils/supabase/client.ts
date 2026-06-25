'use client'

import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Supabase env missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (recommended), or SUPABASE_URL and SUPABASE_ANON_KEY. Ensure your env file is named .env.local and restart the dev server.'
    )
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      lock: async (_name, _acquireTimeout, fn) => fn(),
    },
  })
}
