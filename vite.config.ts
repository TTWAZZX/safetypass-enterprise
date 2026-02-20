import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    
    return {
      // ✅ เพิ่ม base: '/' เพื่อแก้ปัญหาหน้าขาวและ Unexpected token '<'
      // ช่วยให้ Browser ดึงไฟล์ JS จาก Root เสมอ ไม่ว่าจะอยู่ที่ URL ไหน
      base: '/', 
      
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      
      // 🔒 ==========================================
      // 🛡️ SECURITY & PRODUCTION SETTINGS
      // ==========================================
      build: {
        // 1. ปิดการสร้าง Source Maps 
        // Hacker จะไม่สามารถกด F12 แล้วดูโฟลเดอร์ src/components ของเราได้อีกต่อไป
        sourcemap: false, 
        
        // (Optional) ขยายขนาด Warning ตอน Build จะได้ไม่รกหน้าจอ Vercel
        chunkSizeWarningLimit: 1000, 
      },
      
      esbuild: {
        // 2. ลบ console.log และ debugger อัตโนมัติเมื่อขึ้นเซิร์ฟเวอร์จริง (Production)
        // ทำให้ไม่มี Error หรือ Log ข้อมูลหลุดไปโผล่ใน Console ของผู้ใช้เลย 
        // แต่ตอนรันในคอมเรา (npm run dev) ยังเห็น Log ปกติเพื่อใช้แก้บั๊กครับ
        drop: mode === 'production' ? ['console', 'debugger'] : [],
      }
    };
});