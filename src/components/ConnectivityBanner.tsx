import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

const ConnectivityBanner: React.FC = () => {
  const online = useOnlineStatus();
  if (online) return null;

  return (
    <div role="status" aria-live="polite" className="relative z-40 flex items-center justify-center gap-2 border-b border-amber-300 bg-amber-100 px-4 py-2.5 text-center text-[10px] font-black text-amber-950">
      <WifiOff size={15} aria-hidden="true" />
      อุปกรณ์ออฟไลน์ — ข้อมูลที่ต้องเชื่อมต่ออาจยังไม่อัปเดต กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง
    </div>
  );
};

export default ConnectivityBanner;

