import React, { lazy, Suspense, useState, useEffect } from 'react';
import { api } from '../services/supabaseApi';

import AsyncState from './AsyncState';

const AdminDashboard = lazy(() => import('./AdminDashboard'));
const QuestionManager = lazy(() => import('./QuestionManager'));
const VendorManager = lazy(() => import('./VendorManager'));
const SettingsManager = lazy(() => import('./SettingsManager'));
const SupplierOutsourceManager = lazy(() => import('./SupplierOutsourceManager'));

import {
  LayoutGrid,
  ClipboardList,
  Building2,
  Settings,
  ShieldCheck,
} from 'lucide-react';

const AdminPanel: React.FC = () => {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activePage, setActivePage] = useState<'DASHBOARD' | 'QUESTIONS' | 'VENDORS' | 'SUPPLIER_OUTSOURCE' | 'SETTINGS'>('DASHBOARD');
  
  // ✅ สร้าง State เพื่อเก็บคำค้นหาที่อาจส่งมาจาก LINE
  const [searchQuery, setSearchQuery] = useState<string | null>(null);

  // ดึงข้อมูลแค่ Stats เบื้องต้น
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
    // ✅ เช็ค URL Parameter ทันทีที่โหลดหน้า
    const params = new URLSearchParams(window.location.search);
    const searchParam = params.get('search');
    
    if (searchParam) {
      setSearchQuery(searchParam);
      // ✅ บังคับเปิดหน้า VENDORS (หรือหน้าที่คุณเอาไว้จัดการแบน/ผู้ใช้) ทันที
      setActivePage('VENDORS');
      
      // (Optional) ล้าง URL ให้สะอาดหลังจากดึงค่ามาแล้วเพื่อไม่ให้เกะกะ
      window.history.replaceState({}, '', '/admin');
    }

    fetchData();
  }, []); // Run only once on mount

  useEffect(() => {
    // Each admin section starts at the top and uses the document as the only vertical scroller.
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [activePage]);

  if (loading) {
    return <AsyncState variant="loading" title="กำลังเปิดศูนย์ควบคุม" description="ระบบกำลังโหลดสิทธิ์และข้อมูลภาพรวมสำหรับแอดมิน" />;
  }

  return (
    <div className="admin-shell flex flex-col md:flex-row min-h-screen md:min-h-[calc(100vh-64px)] bg-slate-50 text-left relative">
      
      {/* 🧭 SIDE NAVIGATION (สำหรับ Desktop) */}
      <aside className="w-64 bg-white border-r border-slate-200 hidden md:flex flex-col sticky top-0 h-[calc(100vh-64px)] z-10 shrink-0">
        <div className="p-6 border-b border-slate-50">
          <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.2em] mb-1">Control Center</p>
          <h3 className="text-lg font-black text-slate-900 tracking-tight">Admin Portal</h3>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          <SidebarButton icon={<LayoutGrid size={18} />} label="Overview" active={activePage === 'DASHBOARD'} onClick={() => setActivePage('DASHBOARD')} />
          <SidebarButton icon={<ClipboardList size={18} />} label="Questions" active={activePage === 'QUESTIONS'} onClick={() => setActivePage('QUESTIONS')} />
          <SidebarButton icon={<Building2 size={18} />} label="Vendors & Users" badge={stats?.pendingVendors} active={activePage === 'VENDORS'} onClick={() => setActivePage('VENDORS')} />
          <SidebarButton icon={<ShieldCheck size={18} />} label="Supplier & Outsource" active={activePage === 'SUPPLIER_OUTSOURCE'} onClick={() => setActivePage('SUPPLIER_OUTSOURCE')} />
          <SidebarButton icon={<Settings size={18} />} label="Settings" active={activePage === 'SETTINGS'} onClick={() => setActivePage('SETTINGS')} />
        </nav>
      </aside>

      {/* 📱 BOTTOM NAVIGATION (สำหรับ Mobile) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-2 py-2 pb-safe z-[100] flex justify-around items-center shadow-[0_-10px_25px_rgba(0,0,0,0.05)]">
        <MobileTab icon={<LayoutGrid size={20} />} label="Home" active={activePage === 'DASHBOARD'} onClick={() => setActivePage('DASHBOARD')} />
        <MobileTab icon={<ClipboardList size={20} />} label="Exam" active={activePage === 'QUESTIONS'} onClick={() => setActivePage('QUESTIONS')} />
        <MobileTab icon={<Building2 size={20} />} label="Users" badge={stats?.pendingVendors} active={activePage === 'VENDORS'} onClick={() => setActivePage('VENDORS')} />
        <MobileTab icon={<ShieldCheck size={20} />} label="S&O" active={activePage === 'SUPPLIER_OUTSOURCE'} onClick={() => setActivePage('SUPPLIER_OUTSOURCE')} />
        <MobileTab icon={<Settings size={20} />} label="Config" active={activePage === 'SETTINGS'} onClick={() => setActivePage('SETTINGS')} />
      </nav>

      {/* 🖥️ MAIN CONTENT AREA */}
      <main className="min-w-0 flex-1 p-4 md:p-6 lg:p-8 w-full max-w-full overflow-x-hidden pb-24 md:pb-8 min-h-screen md:min-h-0">
        
        {activePage !== 'DASHBOARD' && (
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-6 md:mb-8">
                <div className="space-y-1">
                    <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight uppercase leading-none">
                        {activePage === 'QUESTIONS' ? 'Assessment Manager' : 
                         activePage === 'VENDORS' ? 'User & Vendor Compliance' :
                         activePage === 'SUPPLIER_OUTSOURCE' ? 'Supplier & Outsource Program' : 'System Configuration'}
                    </h1>
                    <p className="text-[10px] md:text-xs text-slate-600 font-bold tracking-widest uppercase mt-1">Management Access • Secure Node</p>
                </div>
            </div>
        )}

        {/* ✅ ส่ง searchQuery ต่อไปยัง Component ย่อย */}
        <Suspense fallback={<AsyncState variant="loading" title="กำลังเปิดส่วนจัดการ" description="กำลังโหลดเฉพาะเครื่องมือที่เลือก" />}>
          <div className="animate-in fade-in duration-500 w-full h-full">
              {activePage === 'DASHBOARD' && <AdminDashboard onNavigateToUsers={() => setActivePage('VENDORS')} onNavigateToSupplier={() => setActivePage('SUPPLIER_OUTSOURCE')} />}
              {activePage === 'QUESTIONS' && <QuestionManager />}
              {activePage === 'VENDORS' && <VendorManager initialSearch={searchQuery} />}
              {activePage === 'SUPPLIER_OUTSOURCE' && <SupplierOutsourceManager />}
              {activePage === 'SETTINGS' && <SettingsManager />}
          </div>
        </Suspense>
      </main>
    </div>
  );
};

/* --- SHARED COMPONENTS --- */
const SidebarButton = ({ icon, label, active, onClick, badge }: any) => (
  <button onClick={onClick} className={`min-h-11 w-full flex items-center justify-between px-4 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all duration-300 active:scale-95 group ${active ? 'bg-slate-900 text-white shadow-xl shadow-slate-900/10 translate-x-1' : 'text-slate-500 hover:bg-slate-50'}`}>
    <div className="flex items-center gap-3">{icon} {label}</div>
    {badge > 0 && <span className="bg-red-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded-lg animate-pulse">{badge}</span>}
  </button>
);

const MobileTab = ({ icon, label, active, onClick, badge }: any) => (
  <button onClick={onClick} className={`flex min-h-11 flex-col items-center justify-center gap-1 relative flex-1 py-2 transition-all ${active ? 'text-blue-700' : 'text-slate-600'}`}>
    <div className={`transition-transform duration-300 ${active ? 'scale-110 -translate-y-1' : ''}`}>{icon}</div>
    <span className="text-[8px] font-black uppercase tracking-tighter">{label}</span>
    {active && <div className="absolute bottom-0 w-1 h-1 bg-blue-600 rounded-full" />}
    {badge > 0 && <span className="absolute top-0 right-1/4 bg-red-500 text-white text-[7px] w-3.5 h-3.5 flex items-center justify-center rounded-full border-2 border-white font-black">{badge}</span>}
  </button>
);

export default AdminPanel;
