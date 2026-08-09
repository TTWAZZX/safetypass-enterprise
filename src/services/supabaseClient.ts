import { createClient } from '@supabase/supabase-js'
import { purgeLegacySupabaseAuthStorage } from './authSessionRestore'

// ✅ 1. ใช้ 'as string' เพื่อยืนยันกับ TypeScript ว่ามีค่าแน่นอน
const supabaseUrl = (
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL
) as string
const supabaseAnonKey = (
  import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY
) as string

// ✅ 2. (Optional) เพิ่มการดักจับ Error ถ้าลืมตั้งค่าใน .env
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('⚠️ Missing Supabase URL or Key. Please check your .env file.')
}

// Keep the Supabase Auth session only for the lifetime of the browser tab.
// Its user.email is derived from the national ID in this application, so it
// must not be persisted in localStorage after the tab is closed.
export const AUTH_SESSION_STORAGE_KEY = 'safety_pass_auth_session'
const legacySupabaseAuthStorageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`

export const purgeLegacyBrowserAuthStorage = (): void => {
  if (typeof window === 'undefined') return
  purgeLegacySupabaseAuthStorage(window.localStorage, legacySupabaseAuthStorageKey)
}

const authOptions = typeof window === 'undefined'
  ? {
      storageKey: AUTH_SESSION_STORAGE_KEY,
      persistSession: false,
      autoRefreshToken: false,
    }
  : {
      storage: window.sessionStorage,
      storageKey: AUTH_SESSION_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
    }

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  { auth: authOptions },
)
