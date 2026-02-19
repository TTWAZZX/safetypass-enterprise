import React, { useState, useEffect } from 'react';
import { api } from '../services/supabaseApi';

// ✅ Import ไฟล์ทั้งหมดเข้ามารวมกัน
import AdminDashboard from './AdminDashboard';
import QuestionManager from './QuestionManager';
import VendorManager from './VendorManager';
import SettingsManager from './SettingsManager';

import {
  LayoutGrid,
  ClipboardList,
  Building2,
  Settings,
  Loader2
} from 'lucide-react';

const AdminPanel: React.FC = () => {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activePage, setActivePage] = useState<'DASHBOARD' | 'QUESTIONS' | 'VENDORS' | 'SETTINGS'>('DASHBOARD');

  // ดึงข้อมูลแค่ Stats เบื้องต้น เพื่อเอามาแสดง "ตัวเลขแจ้งเตือน (Badge)" ที่เมนู Vendor
  const fetchData = async () => {
    try {
      setLoading(true);
      const dashboardStats = await api.getDashboardStats();
      setStats(dashboardStats);
    } catch (err) {
      console.error('Admin Panel Fetch Error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [activePage]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-slate-400 gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <p className="font-black uppercase tracking-widest text-[10px]">Loading Control Center...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row min-h-[calc(100vh-64px)] bg-slate-50 text-left">
      
      {/* 🧭 SIDE NAVIGATION (เมนูด้านซ้ายสำหรับ Desktop) */}
      <aside className="w-64 bg-white border-r border-slate-200 hidden md:flex flex-col sticky top-0 h-[calc(100vh-64px)] z-10">
        <div className="p-6 border-b border-slate-50">
          <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.2em] mb-1">Control Center</p>
          <h3 className="text-lg font-black text-slate-900 tracking-tight">Admin Portal</h3>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          <SidebarButton icon={<LayoutGrid size={18} />} label="Overview" active={activePage === 'DASHBOARD'} onClick={() => setActivePage('DASHBOARD')} />
          <SidebarButton icon={<ClipboardList size={18} />} label="Questions" active={activePage === 'QUESTIONS'} onClick={() => setActivePage('QUESTIONS')} />
          <SidebarButton icon={<Building2 size={18} />} label="Vendors" badge={stats?.pendingVendors} active={activePage === 'VENDORS'} onClick={() => setActivePage('VENDORS')} />
          <SidebarButton icon={<Settings size={18} />} label="Settings" active={activePage === 'SETTINGS'} onClick={() => setActivePage('SETTINGS')} />
        </nav>
      </aside>

      {/* 📱 BOTTOM NAVIGATION (เมนูด้านล่างสำหรับ Mobile) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-2 py-2.5 z-[100] flex justify-around items-center shadow-[0_-10px_25px_rgba(0,0,0,0.05)]">
        <MobileTab icon={<LayoutGrid size={20} />} label="Home" active={activePage === 'DASHBOARD'} onClick={() => setActivePage('DASHBOARD')} />
        <MobileTab icon={<ClipboardList size={20} />} label="Exam" active={activePage === 'QUESTIONS'} onClick={() => setActivePage('QUESTIONS')} />
        <MobileTab icon={<Building2 size={20} />} label="Vendor" badge={stats?.pendingVendors} active={activePage === 'VENDORS'} onClick={() => setActivePage('VENDORS')} />
        <MobileTab icon={<Settings size={20} />} label="Config" active={activePage === 'SETTINGS'} onClick={() => setActivePage('SETTINGS')} />
      </nav>

      {/* 🖥️ MAIN CONTENT AREA (พื้นที่แสดงเนื้อหาหลัก) */}
      <main className="flex-1 p-0 md:p-4 lg:p-8 overflow-y-auto pb-24 md:pb-8 w-full max-w-full overflow-x-hidden">
        
        {/* ซ่อน Header ของ AdminPanel เมื่ออยู่หน้า Dashboard เพราะ AdminDashboard มี Header ของตัวเองแล้ว */}
        {activePage !== 'DASHBOARD' && (
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 p-4 md:p-0 mb-4 md:mb-8">
                <div className="space-y-1">
                    <h1 className="text-xl md:text-3xl font-black text-slate-900 tracking-tight uppercase leading-none">
                        {activePage === 'QUESTIONS' ? 'Assessment Manager' : 
                         activePage === 'VENDORS' ? 'Vendor Compliance' : 'System Configuration'}
                    </h1>
                    <p className="text-[10px] md:text-sm text-slate-400 font-bold tracking-tight uppercase">Management Access • Secure Node</p>
                </div>
            </div>
        )}

        {/* ✅ แสดง Component ตามเมนูที่เลือก (เชื่อมกัน 100%) */}
        <div className="animate-in fade-in duration-500">
            {activePage === 'DASHBOARD' && <AdminDashboard />}
            {activePage === 'QUESTIONS' && <QuestionManager />}
            {activePage === 'VENDORS' && <VendorManager />}
            {activePage === 'SETTINGS' && <SettingsManager />}
        </div>
      </main>
    </div>
  );
};

/* --- SHARED COMPONENTS (ปุ่มเมนู) --- */

const SidebarButton = ({ icon, label, active, onClick, badge }: any) => (
  <button onClick={onClick} className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all duration-300 active:scale-95 group ${active ? 'bg-slate-900 text-white shadow-xl shadow-slate-900/10 translate-x-1' : 'text-slate-500 hover:bg-slate-50'}`}>
    <div className="flex items-center gap-3">{icon} {label}</div>
    {badge > 0 && <span className="bg-red-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded-lg animate-pulse">{badge}</span>}
  </button>
);

const MobileTab = ({ icon, label, active, onClick, badge }: any) => (
  <button onClick={onClick} className={`flex flex-col items-center gap-1 relative flex-1 py-1 transition-all ${active ? 'text-blue-600' : 'text-slate-400'}`}>
    <div className={`transition-transform duration-300 ${active ? 'scale-110 -translate-y-1' : ''}`}>{icon}</div>
    <span className="text-[8px] font-black uppercase tracking-tighter">{label}</span>
    {active && <div className="absolute -bottom-1 w-1 h-1 bg-blue-600 rounded-full" />}
    {badge > 0 && <span className="absolute top-0 right-1/4 bg-red-500 text-white text-[7px] w-3.5 h-3.5 flex items-center justify-center rounded-full border-2 border-white font-black">{badge}</span>}
  </button>
);

export default AdminPanel;