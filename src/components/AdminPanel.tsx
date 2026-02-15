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
  RotateCcw
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
  primary: '#2563eb',
  secondary: '#64748b'
};

const AdminPanel: React.FC = () => {
  const [stats, setStats] = useState<any>(null);
  const [reportData, setReportData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePage, setActivePage] = useState<'DASHBOARD' | 'QUESTIONS' | 'VENDORS' | 'SETTINGS'>('DASHBOARD');
  
  // ✅ Advanced Filter States
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL'); 
  const [filterType, setFilterType] = useState('ALL');

  // ✅ รวมการโหลดข้อมูลไว้ที่เดียว
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

  // ✅ Logic สำหรับกรองข้อมูลในตารางและการ Export
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

  // ✅ ฟังก์ชัน Smart Export Excel (กรองตามที่เลือกบน UI)
  const handleExportExcel = () => {
    const dataToExport = getFilteredData();
    
    if (dataToExport.length === 0) {
      alert("ไม่พบข้อมูลตามเงื่อนไขที่เลือก");
      return;
    }

    // 1. กำหนด Header ตามลำดับที่ต้องการ
    const header = [
      "วันที่ทำแบบทดสอบ / Date of Test",
      "ผลการสอบ",
      "Total points",
      "ชื่อ-นามสกุล / Full Name",
      "อายุ / Age",
      "สัญชาติ / Nationality",
      "เลขบัตรประชาชนหรือเลขบัตรอนุญาตทำงาน \nNational ID Card No. or Work Permit No.",
      "สังกัดบริษัท / Company Affiliation",
      "ประเภทการสอบ"
    ];

    // 2. จัดเรียงข้อมูลใน Body ให้ตรงกับ Header
    const body = dataToExport.map((row) => {
      const dateObj = new Date(row.timestamp);
      const dateStr = dateObj.toLocaleDateString('th-TH', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });

      return [
        dateStr,                                      // วันที่ทำแบบทดสอบ
        row.result === 'PASSED' ? 'ผ่าน' : 'ไม่ผ่าน',      // ผลการสอบ
        row.score,                                    // Total points
        row.name,                                     // ชื่อ-นามสกุล
        row.age || '-',                               // อายุ
        row.nationality || '-',                       // สัญชาติ
        "'" + row.national_id,                        // เลขบัตร (ใส่ ' กัน Excel ตัดเลข 0)
        row.vendor,                                   // สังกัดบริษัท
        row.exam_type                                 // ประเภทการสอบ
      ];
    });

    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    
    // ตั้งความกว้างคอลัมน์ให้เหมาะสมกับข้อความภาษาไทย/อังกฤษ
    ws['!cols'] = [
      { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 25 }, 
      { wch: 10 }, { wch: 15 }, { wch: 30 }, { wch: 30 }, { wch: 15 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Exam_Report");
    
    const fileName = `Safety_Report_${filterType}_${filterStatus}_${filterDate || 'All'}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  const totalExams = (stats?.examSummary?.[0]?.value || 0) + (stats?.examSummary?.[1]?.value || 0);
  const passRate = totalExams > 0 
    ? Math.round(((stats?.examSummary?.[0]?.value || 0) / totalExams) * 100) 
    : 0;

  const examTypeSummary = stats?.activityVolume || [
    { name: 'Induction', value: reportData.filter(r => r.exam_type === 'INDUCTION').length, fill: '#3b82f6' },
    { name: 'Work Permit', value: reportData.filter(r => r.exam_type === 'WORK_PERMIT').length, fill: '#8b5cf6' }
  ];

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-80px)] bg-slate-50 p-8 gap-8">
        <Skeleton className="w-64 h-full hidden md:block" />
        <div className="flex-1 space-y-6">
          <Skeleton className="h-32" /><Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-80px)] bg-slate-50">
      {/* SIDEBAR */}
      <aside className="w-72 bg-white border-r border-slate-200 hidden md:flex flex-col shadow-sm">
        <div className="p-8 pb-4">
          <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Management</h2>
          <h3 className="text-xl font-bold text-slate-900 tracking-tight">Admin Portal</h3>
        </div>
        <nav className="flex-1 px-4 space-y-2">
          <SidebarButton icon={<LayoutGrid size={20} />} label="Overview" active={activePage === 'DASHBOARD'} onClick={() => setActivePage('DASHBOARD')} />
          <SidebarButton icon={<ClipboardList size={20} />} label="Exam Management" active={activePage === 'QUESTIONS'} onClick={() => setActivePage('QUESTIONS')} />
          <SidebarButton icon={<Building2 size={20} />} label="Vendor Approval" badge={stats?.pendingVendors > 0 ? stats.pendingVendors : null} active={activePage === 'VENDORS'} onClick={() => setActivePage('VENDORS')} />
          <div className="pt-4 mt-4 border-t border-slate-100">
            <h2 className="px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">System</h2>
            <SidebarButton icon={<Settings size={20} />} label="Configuration" active={activePage === 'SETTINGS'} onClick={() => setActivePage('SETTINGS')} />
          </div>
        </nav>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 p-6 md:p-10 overflow-y-auto h-[calc(100vh-80px)]">
        <div className="flex justify-between items-end mb-8">
            <div>
                <h1 className="text-3xl font-black text-slate-900 tracking-tight mb-1">
                    {activePage === 'DASHBOARD' ? 'Executive Dashboard' : 
                     activePage === 'QUESTIONS' ? 'Exam Questions' : 
                     activePage === 'VENDORS' ? 'Vendor Management' : 'System Settings'}
                </h1>
                <p className="text-slate-500 font-medium">Welcome back, Admin. Filter and export records.</p>
            </div>
            {activePage === 'DASHBOARD' && (
                <div className="flex gap-3">
                    <button 
                        onClick={handleExportExcel}
                        className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 transition shadow-lg shadow-emerald-100"
                    >
                        <Download size={16} /> EXPORT FILTERED EXCEL
                    </button>
                </div>
            )}
        </div>

        {activePage === 'DASHBOARD' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* KPI CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <PremiumStatCard title="Total Users" value={stats?.totalUsers || 0} icon={<Users className="text-blue-600" size={24} />} color="bg-blue-50" trend="System total" />
              <PremiumStatCard title="Active Permits" value={stats?.activePermits || 0} icon={<FileCheck className="text-emerald-600" size={24} />} color="bg-emerald-50" trend="Currently valid" />
              <PremiumStatCard title="Pending Vendors" value={stats?.pendingVendors || 0} icon={<Building2 className="text-orange-600" size={24} />} color="bg-orange-50" trend="Action required" alert={stats?.pendingVendors > 0} />
              <PremiumStatCard title="Pass Rate" value={`${passRate}%`} icon={<TrendingUp className="text-purple-600" size={24} />} color="bg-purple-50" trend="Efficiency score" />
            </div>

            {/* CHARTS */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm h-[400px]">
                <h3 className="text-lg font-bold text-slate-800 mb-2 text-center">Performance</h3>
                <div className="h-64 relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={stats?.examSummary || []} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5}>
                        {(stats?.examSummary || []).map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={entry.name === 'Passed' ? COLORS.pass : COLORS.fail} strokeWidth={0} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend verticalAlign="bottom" height={36} iconType="circle" />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="text-center">
                          <span className="block text-3xl font-black text-slate-800">{totalExams}</span>
                          <span className="text-xs font-bold text-slate-400 uppercase">Tests</span>
                      </div>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-2 bg-white p-8 rounded-3xl border border-slate-100 shadow-sm h-[400px]">
                <h3 className="text-lg font-bold text-slate-800 mb-6 text-center">Exam Volume</h3>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={examTypeSummary} barSize={60}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 12, fontWeight: 600 }} dy={10} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="value" radius={[12, 12, 0, 0]}>
                        {examTypeSummary.map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={entry.fill || (index === 0 ? '#3b82f6' : '#8b5cf6')} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* ✅ NEW: ADVANCED FILTER BAR */}
            <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-200 shadow-inner flex flex-wrap gap-4 items-end">
                <div className="flex items-center gap-2 w-full mb-1 text-slate-500 font-black text-[11px] uppercase tracking-wider">
                    <Filter size={14} /> Advanced Filter Control
                </div>
                
                <div className="flex-1 min-w-[180px]">
                    <label className="block text-[10px] font-black text-slate-400 uppercase mb-2 ml-2 text-left">ค้นหาวันที่ / Date</label>
                    <input 
                        type="date" 
                        value={filterDate}
                        onChange={(e) => setFilterDate(e.target.value)}
                        className="w-full p-3 rounded-2xl border border-slate-200 font-bold text-sm outline-none focus:border-blue-500"
                    />
                </div>

                <div className="flex-1 min-w-[140px]">
                    <label className="block text-[10px] font-black text-slate-400 uppercase mb-2 ml-2 text-left">ผลการสอบ / Result</label>
                    <select 
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="w-full p-3 rounded-2xl border border-slate-200 font-bold text-sm outline-none focus:border-blue-500 bg-white"
                    >
                        <option value="ALL">ทั้งหมด (All)</option>
                        <option value="PASSED">ผ่าน (Passed)</option>
                        <option value="FAILED">ตก (Failed)</option>
                    </select>
                </div>

                <div className="flex-1 min-w-[140px]">
                    <label className="block text-[10px] font-black text-slate-400 uppercase mb-2 ml-2 text-left">ประเภท / Type</label>
                    <select 
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                        className="w-full p-3 rounded-2xl border border-slate-200 font-bold text-sm outline-none focus:border-blue-500 bg-white"
                    >
                        <option value="ALL">ทั้งหมด (All)</option>
                        <option value="INDUCTION">INDUCTION</option>
                        <option value="WORK_PERMIT">WORK PERMIT</option>
                    </select>
                </div>

                <button 
                    onClick={() => { setFilterDate(''); setFilterStatus('ALL'); setFilterType('ALL'); setSearchTerm(''); }}
                    className="p-3 bg-white text-slate-400 hover:text-red-500 border border-slate-200 rounded-2xl transition-all shadow-sm"
                    title="Reset All Filters"
                >
                    <RotateCcw size={20} />
                </button>
            </div>

            {/* RECENT ACTIVITY TABLE */}
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden mb-12">
              <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/30">
                <h3 className="text-lg font-bold text-slate-800 text-left">Result: {filteredHistory.length} records</h3>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                    <input 
                        placeholder="Search name or ID..." 
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-100 outline-none w-64 transition-all" 
                    />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50/50 text-xs font-black uppercase text-slate-400 tracking-wider">
                    <tr>
                      <th className="px-8 py-4 text-left">Personnel</th>
                      <th className="px-6 py-4 text-left">Type</th>
                      <th className="px-6 py-4 text-left">Score</th>
                      <th className="px-6 py-4 text-left">Timestamp</th>
                      <th className="px-6 py-4 text-left text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 text-left">
                    {filteredHistory.length > 0 ? filteredHistory.slice(0, 10).map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/80 transition-colors group">
                        <td className="px-8 py-5">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-black text-xs">
                                    {row.name ? row.name.charAt(0) : '?'}
                                </div>
                                <div>
                                    <p className="font-bold text-slate-700 leading-none">{row.name}</p>
                                    <p className="text-[10px] text-slate-400 font-bold mt-1 uppercase">{row.vendor}</p>
                                </div>
                            </div>
                        </td>
                        <td className="px-6 py-5">
                            <span className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase border ${
                                row.exam_type === 'INDUCTION' ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-purple-50 text-purple-700 border-purple-100'
                            }`}>
                                {row.exam_type}
                            </span>
                        </td>
                        <td className="px-6 py-5 font-black text-slate-700">{row.score}</td>
                        <td className="px-6 py-5 text-slate-500 font-bold text-[11px]">
                          {new Date(row.timestamp).toLocaleString('th-TH', { 
                             day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' 
                          })}
                        </td>
                        <td className="px-6 py-5 text-right">
                          {row.result === 'PASSED' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full text-[10px] font-black uppercase border border-emerald-100">
                              <CheckCircle2 size={12} /> Pass
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-600 bg-red-50 px-3 py-1 rounded-full text-[10px] font-black uppercase border border-red-100">
                              <XCircle size={12} /> Fail
                            </span>
                          )}
                        </td>
                      </tr>
                    )) : (
                      <tr><td colSpan={5} className="py-20 text-center text-slate-400 font-bold italic uppercase tracking-widest">No matching records found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
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

/* --- Helper Components --- */

const SidebarButton = ({ icon, label, active, onClick, badge }: any) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl font-bold text-sm transition-all duration-200 group ${
      active ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
    }`}
  >
    <div className="flex items-center gap-3">
        <span className={`transition-opacity ${active ? 'opacity-100' : 'opacity-70 group-hover:opacity-100'}`}>{icon}</span>
        {label}
    </div>
    {badge && <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full shadow-sm animate-pulse">{badge}</span>}
  </button>
);

const PremiumStatCard = ({ title, value, icon, color, trend, alert }: any) => (
  <div className={`bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-all duration-300 relative overflow-hidden group`}>
    <div className="flex justify-between items-start mb-4 relative z-10">
        <div className={`p-3 rounded-2xl ${color} transition-transform group-hover:scale-110 duration-300`}>{icon}</div>
        {alert && <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-ping absolute right-0 top-0"></span>}
    </div>
    <div className="relative z-10">
        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{title}</h3>
        <p className="text-3xl font-black text-slate-800 tracking-tight">{value}</p>
        <p className="text-[10px] font-bold text-slate-400 mt-2 flex items-center gap-1 uppercase tracking-tighter text-left">{trend}</p>
    </div>
    <div className={`absolute -right-6 -bottom-6 w-32 h-32 rounded-full opacity-5 ${color}`}></div>
  </div>
);

export default AdminPanel;