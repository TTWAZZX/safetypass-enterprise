import React, { useEffect, useState } from 'react';
import { api } from '../services/supabaseApi'; 
import { 
  Users, CheckCircle, XCircle, FileSpreadsheet, 
  Search, Calendar, TrendingUp,
  Loader2, AlertCircle, RotateCcw, Filter
} from 'lucide-react';
import * as XLSX from 'xlsx';

const AdminDashboard: React.FC = () => {
  const [history, setHistory] = useState<any[]>([]);
  const [stats, setStats] = useState({ total: 0, passed: 0, failed: 0 });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState<string | null>(null);

  // ✅ New Filter States
  const [filterDate, setFilterDate] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL'); // ALL, PASSED, FAILED
  const [filterType, setFilterType] = useState('ALL');     // ALL, INDUCTION, WORK_PERMIT

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

  // ✅ 1. กรองข้อมูลสำหรับแสดงผลในตาราง (Search + Filters)
  const filteredHistory = history.filter(item => {
    const matchesSearch = 
      item.users?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.users?.vendors?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.users?.national_id?.includes(searchTerm);

    const matchesDate = filterDate ? item.created_at.startsWith(filterDate) : true;
    const matchesStatus = filterStatus === 'ALL' ? true : item.status === filterStatus;
    const matchesType = filterType === 'ALL' ? true : item.exam_type === filterType;

    return matchesSearch && matchesDate && matchesStatus && matchesType;
  });

  // ✅ 2. ฟังก์ชัน Export เป็น Excel (กรองตามที่เลือกไว้ใน Filter)
  const exportToExcel = () => {
    if (filteredHistory.length === 0) {
      alert("ไม่พบข้อมูลตามเงื่อนไขที่เลือก");
      return;
    }

    const reportData = filteredHistory.map(item => ({
      'วันที่-เวลา': new Date(item.created_at).toLocaleString('th-TH'),
      'ชื่อ-นามสกุล': item.users?.name || 'N/A',
      'เลขบัตร': item.users?.national_id || 'N/A',
      'บริษัท/ซัพพลายเออร์': item.users?.vendors?.name || 'N/A',
      'ประเภทการสอบ': item.exam_type,
      'คะแนน': `${item.score}/${item.total_questions}`,
      'ผลการสอบ': item.status === 'PASSED' ? 'ผ่าน (PASS)' : 'ไม่ผ่าน (FAIL)'
    }));

    const ws = XLSX.utils.json_to_sheet(reportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Safety_Report");
    
    // ตั้งชื่อไฟล์ตาม Filter ที่เลือก
    const dateSuffix = filterDate || new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `Safety_Report_${filterType}_${filterStatus}_${dateSuffix}.xlsx`);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-slate-400 gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
        <p className="font-bold animate-pulse uppercase tracking-widest text-xs">Loading Security Data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-red-500 gap-4">
        <AlertCircle className="w-12 h-12" />
        <p className="font-bold">{error}</p>
        <button onClick={fetchData} className="px-4 py-2 bg-slate-100 rounded-lg text-slate-600 hover:bg-slate-200 transition-colors">ลองใหม่อีกครั้ง</button>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      
      {/* 1. Header & Quick Actions */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">Overview Dashboard</h2>
          <p className="text-slate-400 font-bold uppercase text-[10px] tracking-widest mt-1">
            Real-time monitoring & reporting system
          </p>
        </div>
        <button 
          onClick={exportToExcel}
          disabled={filteredHistory.length === 0}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white px-6 py-3 rounded-2xl font-black transition-all shadow-lg shadow-emerald-100 group"
        >
          <FileSpreadsheet size={18} className="group-hover:rotate-12 transition-transform" />
          EXPORT FILTERED EXCEL
        </button>
      </div>

      {/* 2. สถิติภาพรวม (Stats Cards) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard icon={<Users className="text-blue-600" />} label="Exams Taken Today" value={stats.total} color="blue" trend="Daily Activity" />
        <StatCard icon={<CheckCircle className="text-emerald-600" />} label="Successful Passes" value={stats.passed} color="emerald" trend="Compliance Ready" />
        <StatCard icon={<XCircle className="text-red-600" />} label="Failed Attempts" value={stats.failed} color="red" trend="Re-training Required" />
      </div>

      {/* 3. Advanced Filters Section */}
      <div className="bg-slate-50 p-6 rounded-[2.5rem] border border-slate-200 shadow-inner flex flex-wrap gap-4 items-end">
        <div className="flex items-center gap-2 w-full mb-2 text-slate-500 font-black text-[11px] uppercase tracking-wider">
          <Filter size={14} /> Filter Results
        </div>
        
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10px] font-black text-slate-400 uppercase mb-2 ml-2">วันที่สอบ / Date</label>
          <input 
            type="date" 
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="w-full p-3 rounded-2xl border border-slate-200 font-bold text-sm outline-none focus:border-blue-500 transition-all"
          />
        </div>

        <div className="flex-1 min-w-[150px]">
          <label className="block text-[10px] font-black text-slate-400 uppercase mb-2 ml-2">สถานะ / Status</label>
          <select 
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="w-full p-3 rounded-2xl border border-slate-200 font-bold text-sm outline-none focus:border-blue-500 bg-white"
          >
            <option value="ALL">ทั้งหมด (ALL)</option>
            <option value="PASSED">ผ่าน (PASSED)</option>
            <option value="FAILED">ตก (FAILED)</option>
          </select>
        </div>

        <div className="flex-1 min-w-[150px]">
          <label className="block text-[10px] font-black text-slate-400 uppercase mb-2 ml-2">ประเภท / Exam Type</label>
          <select 
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="w-full p-3 rounded-2xl border border-slate-200 font-bold text-sm outline-none focus:border-blue-500 bg-white"
          >
            <option value="ALL">ทั้งหมด (ALL)</option>
            <option value="INDUCTION">INDUCTION</option>
            <option value="WORK_PERMIT">WORK PERMIT</option>
          </select>
        </div>

        <button 
          onClick={() => { setFilterDate(''); setFilterStatus('ALL'); setFilterType('ALL'); setSearchTerm(''); }}
          className="p-3 bg-white text-slate-400 hover:text-red-500 border border-slate-200 rounded-2xl transition-all shadow-sm"
          title="Reset Filters"
        >
          <RotateCcw size={20} />
        </button>
      </div>

      {/* 4. รายการล่าสุด (Recent Activity Table) */}
      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden mb-12">
        <div className="p-8 border-b border-slate-100 flex flex-col md:flex-row gap-6 justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
             <div className="w-1.5 h-8 bg-blue-600 rounded-full"></div>
             <div>
                <h3 className="font-black text-slate-800 uppercase text-sm tracking-tight leading-none">Activity Log</h3>
                <p className="text-[10px] text-slate-400 font-bold mt-1">Filtered result: {filteredHistory.length} records</p>
             </div>
          </div>
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text" 
              placeholder="Search by name, company..." 
              className="w-full pl-12 pr-4 py-4 rounded-2xl border border-slate-200 focus:border-blue-500 outline-none font-bold text-sm transition-all shadow-inner bg-white"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50/80">
              <tr>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Personnel Info</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Exam Details</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Score</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Time</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredHistory.length > 0 ? filteredHistory.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-8 py-6">
                    <p className="font-black text-slate-800 leading-none group-hover:text-blue-600 transition-colors">{item.users?.name}</p>
                    <p className="text-[10px] text-slate-400 font-bold mt-1.5 uppercase tracking-tight">{item.users?.vendors?.name || 'No Company'}</p>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex flex-col">
                       <span className={`text-[10px] font-black px-2 py-0.5 rounded w-fit uppercase ${item.exam_type === 'INDUCTION' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>
                          {item.exam_type}
                       </span>
                    </div>
                  </td>
                  <td className="px-8 py-6 text-center">
                    <div className="inline-block px-3 py-1.5 bg-slate-100 rounded-xl font-black text-slate-700 text-sm">
                       {item.score} <span className="text-[10px] text-slate-400">/ {item.total_questions}</span>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <p className="text-[11px] text-slate-500 font-bold">
                       {new Date(item.created_at).toLocaleString('th-TH', { 
                          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' 
                        })}
                    </p>
                  </td>
                  <td className="px-8 py-6 text-right">
                    <span className={`px-5 py-2 rounded-full text-[10px] font-black uppercase shadow-sm border ${item.status === 'PASSED' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100'}`}>
                      {item.status}
                    </span>
                  </td>
                </tr>
              )) : (
                <tr>
                   <td colSpan={5} className="px-8 py-20 text-center text-slate-300 font-bold italic uppercase tracking-widest">
                      No records match the selected filters
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

const StatCard = ({ icon, label, value, color, trend }: any) => (
  <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm flex items-center gap-6 group hover:border-blue-500 hover:shadow-xl hover:shadow-blue-50/50 transition-all cursor-default">
    <div className={`p-5 rounded-3xl bg-${color}-50 text-${color}-600 group-hover:scale-110 transition-transform duration-500 shadow-inner`}>
      {React.cloneElement(icon as React.ReactElement, { size: 32, strokeWidth: 2.5 })}
    </div>
    <div className="flex-1 text-left">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-2.5">{label}</p>
      <div className="flex items-baseline gap-2">
        <h4 className="text-5xl font-black text-slate-900 leading-none tabular-nums tracking-tighter">{value}</h4>
        <div className={`flex items-center gap-1 px-2 py-0.5 rounded-lg bg-${color}-50 text-${color}-600 font-bold text-[10px]`}>
           <TrendingUp size={12} strokeWidth={3} /> {trend}
        </div>
      </div>
    </div>
  </div>
);

export default AdminDashboard;