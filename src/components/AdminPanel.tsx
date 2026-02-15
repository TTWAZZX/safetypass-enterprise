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
  MoreHorizontal,
  Search,
  Download
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
  const [activePage, setActivePage] =
    useState<'DASHBOARD' | 'QUESTIONS' | 'VENDORS' | 'SETTINGS'>('DASHBOARD');

  const fetchData = async () => {
    try {
      setLoading(true);
      const dashboard = await api.getDashboardStats();
      const report = await api.getReportData();
      setStats(dashboard);
      setReportData(report);
    } catch (err) {
      console.error('Dashboard fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // ✅ ฟังก์ชัน Export Excel (แก้ไขให้จัด Format วันที่ถูกต้อง)
  const handleExportExcel = () => {
    const header = [
      "วันที่ทำแบบทดสอบ / Date of Test",
      "Total points",
      "ชื่อ-นามสกุล / Full Name",
      "อายุ / Age",
      "สัญชาติ / Nationality",
      "เลขบัตรประชาชนหรือเลขบัตรอนุญาตทำงาน \nNational ID Card No. or Work Permit No.",
      "สังกัดบริษัท / Company Affiliation",
      "การขออนุญาตออกบัตรปฏิบัติงานสำหรับผู้รับเหมา \nRequest for Contractor Work Permit Issuance"
    ];

    const body = reportData.map((row) => {
      // แปลงวันที่เป็น d/m/yyyy
      const dateObj = new Date(row.timestamp);
      const dateStr = dateObj.toLocaleDateString('th-TH', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });

      // Logic เลือกประเภท
      let requestType = "ต่ออายุ (Renewal)";
      if (row.exam_type === 'INDUCTION') {
        requestType = "ออกบัตรใหม่ (New Card)";
      }

      return [
        dateStr,                  
        row.score,                
        row.name,                 
        row.age || '-',           // ถ้าไม่มีข้อมูลให้ขีด -
        row.nationality || '-',   
        "'" + row.national_id,    // ใส่ ' นำหน้ากัน Excel ตัดเลข 0
        row.vendor,               
        requestType               
      ];
    });

    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    ws['!cols'] = [
      { wch: 15 }, { wch: 10 }, { wch: 25 }, { wch: 8 }, 
      { wch: 15 }, { wch: 20 }, { wch: 30 }, { wch: 30 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Exam_Report");
    XLSX.writeFile(wb, `SafetyPass_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const totalExams = (stats?.examSummary?.[0]?.value || 0) + (stats?.examSummary?.[1]?.value || 0);
  const passRate = totalExams > 0 
    ? Math.round(((stats?.examSummary?.[0]?.value || 0) / totalExams) * 100) 
    : 0;

  const examTypeSummary = [
    {
      name: 'Induction',
      value: reportData.filter(r => r.exam_type === 'INDUCTION').length,
      fill: '#3b82f6'
    },
    {
      name: 'Work Permit',
      value: reportData.filter(r => r.exam_type === 'WORK_PERMIT').length,
      fill: '#8b5cf6'
    }
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
      <aside className="w-72 bg-white border-r border-slate-200 hidden md:flex flex-col">
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
                <p className="text-slate-500 font-medium">Welcome back, Admin. Here is today's report.</p>
            </div>
            {activePage === 'DASHBOARD' && (
                <div className="flex gap-3">
                    <button 
                        onClick={handleExportExcel}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50 transition shadow-sm"
                    >
                        <Download size={16} /> Export Report
                    </button>
                </div>
            )}
        </div>

        {activePage === 'DASHBOARD' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            {/* KPI CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <PremiumStatCard title="Total Users" value={stats?.totalUsers || 0} icon={<Users className="text-blue-600" size={24} />} color="bg-blue-50" trend="+12% this week" />
              <PremiumStatCard title="Active Permits" value={stats?.activePermits || 0} icon={<FileCheck className="text-emerald-600" size={24} />} color="bg-emerald-50" trend="Currently active" />
              <PremiumStatCard title="Pending Approval" value={stats?.pendingVendors || 0} icon={<Building2 className="text-orange-600" size={24} />} color="bg-orange-50" trend="Requires action" alert={stats?.pendingVendors > 0} />
              <PremiumStatCard title="Pass Rate" value={`${passRate}%`} icon={<TrendingUp className="text-purple-600" size={24} />} color="bg-purple-50" trend="Based on all exams" />
            </div>

            {/* CHARTS */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm flex flex-col justify-between">
                <div><h3 className="text-lg font-bold text-slate-800 mb-2">Exam Performance</h3></div>
                <div className="h-64 relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={stats?.examSummary || []} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5}>
                        {(stats?.examSummary || []).map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={entry.name === 'Passed' ? COLORS.pass : COLORS.fail} strokeWidth={0} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }} />
                      <Legend verticalAlign="bottom" height={36} iconType="circle" />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="text-center">
                          <span className="block text-3xl font-black text-slate-800">{totalExams}</span>
                          <span className="text-xs font-bold text-slate-400 uppercase">Exams</span>
                      </div>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-2 bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-bold text-slate-800">Exam Activity Volume</h3>
                </div>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={examTypeSummary} barSize={60}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12, fontWeight: 600 }} dy={10} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                      <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }} />
                      <Bar dataKey="value" radius={[12, 12, 0, 0]}>
                        {examTypeSummary.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* TABLE - จุดที่แก้ไข Error คือตรงนี้ 👇 */}
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-8 border-b border-slate-100 flex justify-between items-center">
                <h3 className="text-lg font-bold text-slate-800">Recent Exam History</h3>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                    <input placeholder="Search..." className="pl-10 pr-4 py-2 bg-slate-50 border-none rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-100 outline-none w-64"/>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50/50 text-xs font-black uppercase text-slate-400 tracking-wider">
                    <tr>
                      <th className="px-8 py-4 text-left">User</th>
                      <th className="px-6 py-4 text-left">Exam Type</th>
                      <th className="px-6 py-4 text-left">Score</th>
                      <th className="px-6 py-4 text-left">Date</th>
                      <th className="px-6 py-4 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {reportData.slice(0, 8).map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/80 transition-colors group">
                        <td className="px-8 py-5">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-xs">
                                    {row.name.charAt(0)}
                                </div>
                                <div>
                                    <p className="font-bold text-slate-700">{row.name}</p>
                                    <p className="text-[10px] text-slate-400">{row.national_id}</p>
                                </div>
                            </div>
                        </td>
                        <td className="px-6 py-5">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-bold ${
                                row.exam_type === 'INDUCTION' ? 'bg-blue-50 text-blue-700 border border-blue-100' : 'bg-purple-50 text-purple-700 border border-purple-100'
                            }`}>
                                {row.exam_type}
                            </span>
                        </td>
                        <td className="px-6 py-5 font-bold text-slate-700">{row.score}</td>
                        {/* 🔴 แก้ไข: ใช้ toLocaleDateString แทน .split() เพื่อรองรับ Date Object */}
                        <td className="px-6 py-5 text-slate-500 font-medium">
                          {new Date(row.timestamp).toLocaleDateString('th-TH')}
                        </td>
                        <td className="px-6 py-5">
                          {row.result === 'PASSED' ? (
                            <span className="inline-flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full text-xs font-bold border border-emerald-100">
                              <CheckCircle2 size={14} /> Passed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-red-600 bg-red-50 px-3 py-1 rounded-full text-xs font-bold border border-red-100">
                              <XCircle size={14} /> Failed
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
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

export default AdminPanel;

/* ================================
   PREMIUM COMPONENT HELPERS
================================ */

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
    {badge && <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full shadow-sm">{badge}</span>}
  </button>
);

const PremiumStatCard = ({ title, value, icon, color, trend, alert }: any) => (
  <div className={`bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-all duration-300 relative overflow-hidden group`}>
    <div className="flex justify-between items-start mb-4 relative z-10">
        <div className={`p-3 rounded-2xl ${color} transition-transform group-hover:scale-110 duration-300`}>{icon}</div>
        {alert && <span className="w-3 h-3 bg-red-500 rounded-full animate-ping absolute right-0 top-0"></span>}
    </div>
    <div className="relative z-10">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-1">{title}</h3>
        <p className="text-4xl font-black text-slate-800 tracking-tight">{value}</p>
        <p className="text-xs font-medium text-slate-400 mt-2 flex items-center gap-1">{trend}</p>
    </div>
    <div className={`absolute -right-6 -bottom-6 w-32 h-32 rounded-full opacity-10 ${color}`}></div>
  </div>
);