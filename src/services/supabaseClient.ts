import { createClient } from '@supabase/supabase-js'

// ✅ 1. ใช้ 'as string' เพื่อยืนยันกับ TypeScript ว่ามีค่าแน่นอน
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

// ✅ 2. (Optional) เพิ่มการดักจับ Error ถ้าลืมตั้งค่าใน .env
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('⚠️ Missing Supabase URL or Key. Please check your .env file.')
}

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey
)