import React, { useState, useEffect } from 'react';
import { api } from '../services/supabaseApi';
import Skeleton from './Skeleton';
import QuestionManager from './QuestionManager';
import VendorManager from './VendorManager';
import SettingsManager from './SettingsManager';
import * as XLSX from 'xlsx';

import {
  LayoutGrid,
  ClipboardList,
  Building2,
  Settings,
  CheckCircle2,
  XCircle,
  Users,
  FileCheck,
  TrendingUp,
  Search,
  Download,
  Filter,
  RotateCcw,
  ChevronRight,
  Loader2 // ✅ Import ครบถ้วน ไม่แดงแน่นอน
} from 'lucide-react';

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid
} from 'recharts';

const COLORS = {
  pass: '#10b981',
  fail: '#ef4444',
  primary: '#3b82f6',
  secondary: '#8b5cf6'
};

const AdminPanel: React.FC = () => {
  const [stats, setStats] = useState<any>(null);
  const [reportData, setReportData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePage, setActivePage] = useState<'DASHBOARD' | 'QUESTIONS' | 'VENDORS' | 'SETTINGS'>('DASHBOARD');
  
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL'); 
  const [filterType, setFilterType] = useState('ALL');

  const fetchData = async () => {
    try {
      setLoading(true);
      const [dashboardStats, historyData] = await Promise.all([
        api.getDashboardStats(),
        api.getReportData()
      ]);
      setStats(dashboardStats);
      setReportData(historyData);
    } catch (err) {
      console.error('Admin Panel Fetch Error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [activePage]);

  const getFilteredData = () => {
    return reportData.filter((item: any) => {
      const matchesSearch = 
        item.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.vendor?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.national_id?.includes(searchTerm);
      const matchesDate = filterDate ? item.timestamp.startsWith(filterDate) : true;
      const matchesStatus = filterStatus === 'ALL' ? true : item.result === filterStatus;
      const matchesType = filterType === 'ALL' ? true : item.exam_type === filterType;
      return matchesSearch && matchesDate && matchesStatus && matchesType;
    });
  };

  const filteredHistory = getFilteredData();

  const handleExportExcel = () => {
    const dataToExport = getFilteredData();
    if (dataToExport.length === 0) {
      alert("ไม่พบข้อมูลตามเงื่อนไขที่เลือก");
      return;
    }
    const header = ["วันที่ทำแบบทดสอบ", "ผลการสอบ", "คะแนน", "ชื่อ-นามสกุล", "อายุ", "สัญชาติ", "เลขบัตรประชาชน", "สังกัดบริษัท", "ประเภทการสอบ"];
    const body = dataToExport.map((row) => [
      new Date(row.timestamp).toLocaleDateString('th-TH'),
      row.result === 'PASSED' ? 'ผ่าน' : 'ไม่ผ่าน',
      row.score,
      row.name,
      row.age || '-',
      row.nationality || '-',
      "'" + row.national_id,
      row.vendor,
      row.exam_type
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Exam_Report");
    XLSX.writeFile(wb, `Safety_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const totalExams = (stats?.examSummary?.[0]?.value || 0) + (stats?.examSummary?.[1]?.value || 0);
  const passRate = totalExams > 0 ? Math.round(((stats?.examSummary?.[0]?.value || 0) / totalExams) * 100) : 0;

  const examTypeSummary = stats?.activityVolume || [
    { name: 'Induction', value: reportData.filter(r => r.exam_type === 'INDUCTION').length, fill: COLORS.primary },
    { name: 'Work Permit', value: reportData.filter(r => r.exam_type === 'WORK_PERMIT').length, fill: COLORS.secondary }
  ];

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
      
      {/* 🧭 SIDE NAVIGATION (Desktop Only) */}
      <aside className="w-64 bg-white border-r border-slate-200 hidden md:flex flex-col sticky top-0 h-[calc(100vh-64px)]">
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

      {/* 📱 BOTTOM NAVIGATION (Mobile Only) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-2 py-2.5 z-[100] flex justify-around items-center shadow-[0_-10px_25px_rgba(0,0,0,0.05)]">
        <MobileTab icon={<LayoutGrid size={20} />} label="Home" active={activePage === 'DASHBOARD'} onClick={() => setActivePage('DASHBOARD')} />
        <MobileTab icon={<ClipboardList size={20} />} label="Exam" active={activePage === 'QUESTIONS'} onClick={() => setActivePage('QUESTIONS')} />
        <MobileTab icon={<Building2 size={20} />} label="Vendor" badge={stats?.pendingVendors} active={activePage === 'VENDORS'} onClick={() => setActivePage('VENDORS')} />
        <MobileTab icon={<Settings size={20} />} label="Config" active={activePage === 'SETTINGS'} onClick={() => setActivePage('SETTINGS')} />
      </nav>

      {/* 🖥️ MAIN VIEWPORT */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto pb-24 md:pb-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-8">
            <div className="space-y-1">
                <h1 className="text-xl md:text-3xl font-black text-slate-900 tracking-tight uppercase leading-none">
                    {activePage === 'DASHBOARD' ? 'Executive Overview' : 
                     activePage === 'QUESTIONS' ? 'Assessment Manager' : 
                     activePage === 'VENDORS' ? 'Vendor Compliance' : 'System Configuration'}
                </h1>
                <p className="text-[10px] md:text-sm text-slate-400 font-bold tracking-tight uppercase">Management Access • Secure Node</p>
            </div>
            {activePage === 'DASHBOARD' && (
                <button 
                    onClick={handleExportExcel}
                    className="w-full md:w-auto flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black text-xs uppercase transition-all shadow-lg shadow-emerald-100 active:scale-95 group"
                >
                    <Download size={16} /> Export Dataset
                </button>
            )}
        </div>

        {activePage === 'DASHBOARD' && (
          <div className="space-y-6 md:space-y-8 animate-in fade-in duration-700">
            {/* KPI GRID */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
              <PremiumStatCard title="Registry" value={stats?.totalUsers || 0} icon={<Users size={20} />} color="blue" trend="Active database" />
              <PremiumStatCard title="Safety" value={stats?.activePermits || 0} icon={<FileCheck size={20} />} color="emerald" trend="Valid Permits" />
              <PremiumStatCard title="Pending" value={stats?.pendingVendors || 0} icon={<Building2 size={20} />} color="orange" trend="Verification" alert={stats?.pendingVendors > 0} />
              <PremiumStatCard title="Efficiency" value={`${passRate}%`} icon={<TrendingUp size={20} />} color="purple" trend="Pass Ratio" />
            </div>

            {/* ANALYTICS CHARTS */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
              <div className="bg-white p-6 md:p-8 rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
                <h3 className="text-[10px] font-black text-slate-400 mb-6 uppercase tracking-widest text-center border-b border-slate-50 pb-4">Performance Matrix</h3>
                <div className="h-56 relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={stats?.examSummary || []} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={70} paddingAngle={8}>
                        {(stats?.examSummary || []).map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={entry.name === 'Passed' ? COLORS.pass : COLORS.fail} strokeWidth={0} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none mt-[-10px]">
                      <div className="text-center">
                          <span className="block text-2xl font-black text-slate-800 tabular-nums">{totalExams}</span>
                          <span className="text-[8px] font-black text-slate-400 uppercase">Logs</span>
                      </div>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-2 bg-white p-6 md:p-8 rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
                <h3 className="text-[10px] font-black text-slate-400 mb-6 uppercase tracking-widest text-center border-b border-slate-50 pb-4">Module Distribution</h3>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={examTypeSummary} barSize={40}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 800 }} axisLine={false} tickLine={false} dy={10} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                        {examTypeSummary.map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={entry.fill || (index === 0 ? COLORS.primary : COLORS.secondary)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* RECORDSET TABLE */}
            <div className="bg-white rounded-[1.8rem] border border-slate-200 shadow-sm overflow-hidden overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="bg-slate-50/50 text-[9px] font-black uppercase text-slate-400 tracking-widest border-b border-slate-100">
                    <th className="px-6 py-4 text-left">Personnel</th>
                    <th className="px-4 py-4 text-left">Module</th>
                    <th className="px-4 py-4 text-center">Score</th>
                    <th className="px-4 py-4 text-left">Time</th>
                    <th className="px-6 py-4 text-right">Access</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredHistory.length > 0 ? filteredHistory.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/30 transition-colors group">
                      <td className="px-6 py-4">
                        <p className="font-black text-slate-800 text-xs truncate uppercase group-hover:text-blue-600 transition-colors">{row.name}</p>
                        <p className="text-[9px] text-slate-400 font-bold uppercase truncate">{row.vendor}</p>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`text-[8px] font-black px-2 py-0.5 rounded border uppercase ${row.exam_type === 'INDUCTION' ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-purple-50 text-purple-700 border-purple-100'}`}>{row.exam_type}</span>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span className="font-black text-slate-700 text-xs">{row.score}</span>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <p className="text-slate-500 font-bold text-[10px]">{new Date(row.timestamp).toLocaleDateString('th-TH')}</p>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-[9px] font-black uppercase border ${row.result === 'PASSED' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100'}`}>
                           <div className={`w-1 h-1 rounded-full ${row.result === 'PASSED' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                           {row.result}
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan={5} className="py-20 text-center text-slate-300 font-black uppercase text-xs tracking-widest italic opacity-50">Empty Recordset</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activePage === 'QUESTIONS' && <QuestionManager />}
        {activePage === 'VENDORS' && <VendorManager />}
        {activePage === 'SETTINGS' && <SettingsManager />}
      </main>
    </div>
  );
};

/* --- 🔵 SHARED COMPONENTS --- */

const SidebarButton = ({ icon, label, active, onClick, badge }: any) => (
  <button onClick={onClick} className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all duration-300 active:scale-95 group ${active ? 'bg-blue-600 text-white shadow-xl shadow-blue-500/20 translate-x-1' : 'text-slate-500 hover:bg-slate-50'}`}>
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

const PremiumStatCard = ({ title, value, icon, color, trend, alert }: any) => (
  <div className="bg-white p-5 md:p-6 rounded-[1.8rem] md:rounded-[2rem] border border-slate-200 shadow-sm relative overflow-hidden group hover:shadow-lg transition-all duration-500">
    <div className="flex justify-between items-start mb-4 relative z-10">
        <div className={`p-3 rounded-xl bg-${color}-50 text-${color}-600 group-hover:bg-${color}-600 group-hover:text-white transition-all duration-500`}>{icon}</div>
        {alert && <div className="w-2 h-2 bg-red-500 rounded-full animate-ping" />}
    </div>
    <div className="relative z-10">
        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">{title}</p>
        <p className="text-xl md:text-3xl font-black text-slate-800 tracking-tighter tabular-nums">{value}</p>
    </div>
    <div className={`absolute -right-6 -bottom-6 w-24 h-24 rounded-full opacity-[0.03] bg-${color}-600 group-hover:scale-150 transition-transform duration-1000`}></div>
  </div>
);

export default AdminPanel;