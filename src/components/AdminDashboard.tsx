import React, { useEffect, useState } from 'react';
import { api } from '../services/supabaseApi'; 
import { 
  Users, CheckCircle, XCircle, FileSpreadsheet, 
  Search, Calendar, TrendingUp,
  Loader2, AlertCircle, RotateCcw, Filter, ChevronRight,
  ShieldCheck, AlertTriangle, UserX, Activity
} from 'lucide-react';
import * as XLSX from 'xlsx';

const AdminDashboard: React.FC = () => {
  const [history, setHistory] = useState<any[]>([]);
  const [stats, setStats] = useState({ total: 0, passed: 0, failed: 0 });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState<string | null>(null);

  // ✅ Added Filtering States
  const [filterDate, setFilterDate] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterType, setFilterType] = useState('ALL');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [historyData, statsData] = await Promise.all([
        api.getAllExamHistory(),
        api.getDailyStats()
      ]);
      setHistory(historyData || []);
      setStats(statsData);
    } catch (err: any) {
      console.error("Dashboard fetch error:", err);
      setError("ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setLoading(false);
    }
  };

  // ✅ Enhanced Filtering Logic
  const filteredHistory = history.filter(item => {
    const matchesSearch = 
      item.users?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.users?.vendors?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.users?.national_id?.includes(searchTerm); // สามารถค้นหาด้วยเลขบัตรจริงได้แล้ว

    const matchesDate = filterDate ? item.created_at.startsWith(filterDate) : true;
    const matchesStatus = filterStatus === 'ALL' ? true : item.status === filterStatus;
    const matchesType = filterType === 'ALL' ? true : item.exam_type === filterType;

    return matchesSearch && matchesDate && matchesStatus && matchesType;
  });

  const exportToExcel = () => {
    if (filteredHistory.length === 0) return;

    const reportData = filteredHistory.map(item => ({
      'วันที่-เวลา': new Date(item.created_at).toLocaleString('th-TH'),
      'ชื่อ-นามสกุล': item.users?.name || 'N/A',
      // ✅ ใส่ ' เพื่อให้ Excel อ่านเป็น Text ตัวเต็ม ไม่ปัดเป็น Scientific Notation
      'เลขบัตร': item.users?.national_id ? `'${item.users.national_id}` : 'N/A', 
      'บริษัท/ซัพพลายเออร์': item.users?.vendors?.name || 'N/A',
      'ประเภทการสอบ': item.exam_type,
      'คะแนน': `${item.score}/${item.total_questions}`,
      'ผลการสอบ': item.status === 'PASSED' ? 'ผ่าน (PASS)' : 'ไม่ผ่าน (FAIL)'
    }));

    const ws = XLSX.utils.json_to_sheet(reportData);
    
    // Auto-width columns
    const wscols = [
        { wch: 20 }, // Date
        { wch: 25 }, // Name
        { wch: 18 }, // ID
        { wch: 25 }, // Vendor
        { wch: 15 }, // Type
        { wch: 10 }, // Score
        { wch: 15 }  // Result
    ];
    ws['!cols'] = wscols;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Safety_Report");
    const dateSuffix = filterDate || new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `Safety_Report_${filterType}_${filterStatus}_${dateSuffix}.xlsx`);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-slate-400 gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <p className="font-black uppercase tracking-widest text-[10px]">Synchronizing Security Data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-red-500 gap-4 animate-in fade-in">
        <AlertCircle className="w-12 h-12 opacity-20" />
        <p className="font-bold text-sm">{error}</p>
        <button onClick={fetchData} className="px-6 py-2 bg-slate-100 rounded-xl text-slate-600 font-black text-xs uppercase hover:bg-slate-200 transition-all">Retry Link</button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6 md:space-y-8 animate-in fade-in duration-500 text-left">
      
      {/* 1. Header & Primary Actions */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4 border-b border-slate-200 pb-6">
        <div className="space-y-1">
          <h2 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight uppercase">Dashboard Analytics</h2>
          <div className="text-slate-400 font-bold uppercase text-[9px] md:text-[10px] tracking-[0.2em] flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" /> 
            Security Monitoring & Performance Metrics
          </div>
        </div>
        <div className="flex w-full lg:w-auto gap-2">
          <button 
            onClick={exportToExcel}
            disabled={filteredHistory.length === 0}
            className="flex-1 lg:flex-none flex items-center justify-center gap-2 bg-slate-900 hover:bg-black disabled:bg-slate-200 text-white px-6 py-3.5 rounded-2xl font-black text-xs uppercase transition-all shadow-lg active:scale-95 group"
          >
            <FileSpreadsheet size={16} className="group-hover:rotate-12 transition-transform" />
            Export Data
          </button>
          <button onClick={fetchData} className="p-3.5 bg-slate-100 text-slate-500 rounded-2xl hover:bg-blue-50 hover:text-blue-600 transition-all active:scale-90">
            <RotateCcw size={18} />
          </button>
        </div>
      </div>

      {/* 2. Visual Statistics Widgets */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          icon={<Activity />} 
          label="Total Exams" 
          value={stats.total} 
          color="blue" 
          trend="Total System Load"
          description="Overall examination activity"
        />
        <StatCard 
          icon={<ShieldCheck />} 
          label="Qualified" 
          value={stats.passed} 
          color="emerald" 
          trend={`${stats.total > 0 ? ((stats.passed / stats.total) * 100).toFixed(0) : 0}% Rate`}
          description="Candidates passed induction"
          glow="glow-emerald"
        />
        <StatCard 
          icon={<AlertTriangle />} 
          label="Critical Failures" 
          value={stats.failed} 
          color="amber" 
          trend="Attention Required"
          description="High-risk failed attempts"
          glow="glow-amber"
        />
        <StatCard 
          icon={<UserX />} 
          label="Denied Access" 
          value={stats.failed} 
          color="red" 
          trend="Access Revoked"
          description="Unsuccessful compliance"
          glow="glow-red"
        />
      </div>

      {/* 3. Smart Filters & Search Bar */}
      <div className="bg-white p-4 md:p-6 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text" 
              placeholder="Filter by Personnel Name, National ID or Vendor..." 
              className="w-full pl-12 pr-4 py-4 rounded-2xl border border-slate-100 bg-slate-50 focus:bg-white focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 outline-none font-bold text-sm transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          <div className="flex flex-wrap lg:flex-nowrap gap-2">
            <div className="relative">
              <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={14} />
              <input 
                type="date" 
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="pl-10 pr-4 py-3.5 rounded-2xl border border-slate-100 bg-slate-50 font-bold text-xs outline-none focus:ring-2 focus:ring-blue-500/10 transition-all cursor-pointer"
              />
            </div>
            <select 
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-4 py-3.5 rounded-2xl border border-slate-100 bg-slate-50 font-black text-[10px] uppercase outline-none focus:ring-2 focus:ring-blue-500/10 appearance-none cursor-pointer min-w-[130px]"
            >
              <option value="ALL">All Statuses</option>
              <option value="PASSED">Passed</option>
              <option value="FAILED">Failed</option>
            </select>
            <select 
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-4 py-3.5 rounded-2xl border border-slate-100 bg-slate-50 font-black text-[10px] uppercase outline-none focus:ring-2 focus:ring-blue-500/10 appearance-none cursor-pointer min-w-[130px]"
            >
              <option value="ALL">All Modules</option>
              <option value="INDUCTION">Induction</option>
              <option value="WORK_PERMIT">Work Permit</option>
            </select>
          </div>
        </div>
      </div>

      {/* 4. Activity Logs Table */}
      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden mb-12">
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[900px]">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-8 py-6 text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Personnel Information</th>
                <th className="px-8 py-6 text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Module Type</th>
                <th className="px-8 py-6 text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] text-center">Efficiency</th>
                <th className="px-8 py-6 text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">System Log Time</th>
                <th className="px-8 py-6 text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] text-right">Gate Access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredHistory.length > 0 ? filteredHistory.map((item) => (
                <tr key={item.id} className="hover:bg-blue-50/30 transition-colors group">
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 font-black group-hover:bg-blue-600 group-hover:text-white transition-all uppercase">
                        {item.users?.name?.charAt(0)}
                      </div>
                      <div className="flex flex-col">
                        <span className="font-black text-slate-800 text-sm uppercase">{item.users?.name}</span>
                        <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">{item.users?.vendors?.name || 'External Contractor'}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <span className={`text-[9px] font-black px-3 py-1.5 rounded-xl border w-fit uppercase ${item.exam_type === 'INDUCTION' ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-purple-50 text-purple-600 border-purple-100'}`}>
                      {item.exam_type}
                    </span>
                  </td>
                  <td className="px-8 py-6 text-center">
                    <div className="inline-flex flex-col items-center">
                      <span className={`font-black text-sm leading-none ${item.status === 'PASSED' ? 'text-emerald-600' : 'text-red-600'}`}>{item.score}</span>
                      <span className="text-[8px] text-slate-300 font-bold uppercase mt-1">/ {item.total_questions}</span>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex flex-col">
                      <span className="text-[11px] text-slate-600 font-bold">
                        {new Date(item.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })}
                      </span>
                      <span className="text-[9px] text-slate-400 mt-1 uppercase">
                        {new Date(item.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </td>
                  <td className="px-8 py-6 text-right">
                    <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[9px] font-black uppercase border shadow-sm ${item.status === 'PASSED' ? 'bg-emerald-50 text-emerald-600 border-emerald-100 glow-emerald' : 'bg-red-50 text-red-600 border-red-100 glow-red'}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${item.status === 'PASSED' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                        {item.status}
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                    <td colSpan={5} className="px-8 py-32 text-center">
                      <div className="flex flex-col items-center opacity-20">
                        <Activity size={60} className="text-slate-300 mb-4 animate-pulse" />
                        <p className="font-black text-slate-400 uppercase text-xs tracking-widest italic">No matching records detected</p>
                      </div>
                    </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// 🔵 Shared Premium Stat Widget
const StatCard = ({ icon, label, value, color, trend, description, glow }: any) => (
  <div className={`bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col gap-4 group hover:border-blue-500 hover:shadow-2xl transition-all duration-500 cursor-default relative overflow-hidden ${glow}`}>
    <div className={`absolute -right-6 -top-6 opacity-[0.03] group-hover:scale-150 group-hover:rotate-12 transition-transform duration-1000`}>
        {React.cloneElement(icon as React.ReactElement, { size: 160 })}
    </div>
    
    <div className="flex justify-between items-start relative z-10">
      <div className={`p-4 rounded-2xl bg-${color}-50 text-${color}-600 group-hover:bg-${color}-600 group-hover:text-white transition-all duration-500 shadow-inner`}>
        {React.cloneElement(icon as React.ReactElement, { size: 24, strokeWidth: 2.5 })}
      </div>
      <span className={`text-[8px] font-black px-2.5 py-1 rounded-lg bg-${color}-50 text-${color}-600 border border-${color}-100 uppercase tracking-tighter`}>
          {trend}
      </span>
    </div>

    <div className="space-y-1 relative z-10">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
      <h4 className="text-4xl font-black text-slate-900 tracking-tighter tabular-nums">{value}</h4>
      <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tight opacity-0 group-hover:opacity-100 transition-opacity duration-500">{description}</p>
    </div>
  </div>
);

export default AdminDashboard;