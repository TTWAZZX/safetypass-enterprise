/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  // เพิ่มตัวแปรอื่น ๆ ที่คุณใช้ใน .env ที่นี่
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}