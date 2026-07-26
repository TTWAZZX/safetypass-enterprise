import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import ErrorBoundary from './components/ErrorBoundary';
import { initializeMotionPreference } from './services/motionPreference';

// Apply the stored/OS motion preference before React paints to avoid animation flash.
initializeMotionPreference();

// 🔍 ค้นหา Root Element สำหรับการ Render
const rootElement = document.getElementById('root');

// ✅ ป้องกันกรณีหา Element ไม่เจอด้วย Error Message ที่ชัดเจน
if (!rootElement) {
  throw new Error(
    "CRITICAL_FAILURE: Could not find root element to mount the SafetyPass application. Please check your index.html."
  );
}

// 🚀 สร้าง Root และเริ่มการ Render ระบบ
// (เพิ่ม as HTMLElement เพื่อความถูกต้องของ TypeScript)
const root = ReactDOM.createRoot(rootElement as HTMLElement);

root.render(
  <React.StrictMode>
    {/* 🛡️ หุ้มด้วย ErrorBoundary ชั้นนอกสุดเพื่อให้ระบบไม่มีวันล่มเป็นหน้าขาว */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
