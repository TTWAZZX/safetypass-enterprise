import React, { useEffect, useState, useMemo } from 'react';
import { api } from '../services/supabaseApi'; 
import { 
  Users, CheckCircle, XCircle, FileSpreadsheet, 
  Search, Calendar, TrendingUp,
  Loader2, AlertCircle, RotateCcw, Filter, ChevronRight,
  ShieldCheck, AlertTriangle, UserX, Activity, PieChart as PieChartIcon,
  LineChart as LineChartIcon, Building2
} from 'lucide-react';
import * as XLSX from 'xlsx';

import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line
} from 'recharts';

const AdminDashboard: React.FC = () => {
  const [history, setHistory] = useState<any[]>([]);
  const [stats, setStats] = useState({ total: 0, passed: 0, failed: 0 });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Filtering States
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

  const chartData = useMemo(() => {
    if (!history.length) return { pieData: [], barData: [], trendData: [], vendorData: [] };

    // 1. Pie Chart
    const passCount = history.filter(h => h.status === 'PASSED').length;
    const failCount = history.filter(h => h.status !== 'PASSED').length;
    const pieData = [
      { name: 'ผ่าน (Passed)', value: passCount, color: '#10b981' },
      { name: 'ไม่ผ่าน (Failed)', value: failCount, color: '#ef4444' }
    ];

    // 2. Bar Chart
    const typeStats = history.reduce((acc: any, curr: any) => {
      const type = curr.exam_type || 'UNKNOWN';
      if (!acc[type]) acc[type] = { name: type.replace('_', ' '), Passed: 0, Failed: 0 };
      if (curr.status === 'PASSED') acc[type].Passed += 1;
      else acc[type].Failed += 1;
      return acc;
    }, {});
    const barData = Object.values(typeStats);

    // 3. Line Chart
    const dateMap: any = {};
    history.forEach(h => {
      const d = new Date(h.created_at);
      const key = d.toISOString().split('T')[0];
      const label = d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short' });
      if (!dateMap[key]) dateMap[key] = { dateKey: key, name: label, Exams: 0 };
      dateMap[key].Exams += 1;
    });
    const trendData = Object.values(dateMap)
      .sort((a: any, b: any) => a.dateKey.localeCompare(b.dateKey))
      .slice(-14);

    // 4. Top Vendors
    const vendorMap: any = {};
    history.forEach(h => {
      const vName = h.users?.vendors?.name || 'EXTERNAL (ไม่มีสังกัด)';
      if (!vendorMap[vName]) vendorMap[vName] = { name: vName, total: 0, passed: 0, failed: 0 };
      vendorMap[vName].total += 1;
      if (h.status === 'PASSED') vendorMap[vName].passed += 1;
      else vendorMap[vName].failed += 1;
    });
    const vendorData = Object.values(vendorMap)
      .sort((a: any, b: any) => b.total - a.total)
      .slice(0, 5);

    return { pieData, barData, trendData, vendorData };
  }, [history]);

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

  const exportToExcel = () => {
    if (filteredHistory.length === 0) return;

    const reportData = filteredHistory.map(item => {
      // ✅ จัดการรูปแบบวันที่ให้เป็น วัน/เดือน/ปี (เช่น 10/2/2026) โดยไม่เอาเวลา
      const d = new Date(item.created_at);
      const formattedDate = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;

      return {
        'วันที่ทำแบบทดสอบ': formattedDate,
        'ผลการสอบ': item.status === 'PASSED' ? 'ผ่าน (PASS)' : 'ไม่ผ่าน (FAIL)',
        'คะแนน': `${item.score}/${item.total_questions}`,
        'ชื่อ-นามสกุล': item.users?.name || '-',
        'อายุ': item.users?.age || '-',
        'สัญชาติ': item.users?.nationality || '-',
        'เลขบัตรประชาชน': item.users?.national_id || '-', // ไม่ใส่เครื่องหมาย ' แล้ว
        'สังกัดบริษัท': item.users?.vendors?.name || '-',
        'ประเภทการสอบ': item.exam_type || '-'
      };
    });

    const ws = XLSX.utils.json_to_sheet(reportData);
    
    // ตั้งค่าความกว้างคอลัมน์ให้พอดี
    const wscols = [
        { wch: 15 }, // วันที่ทำแบบทดสอบ
        { wch: 15 }, // ผลการสอบ
        { wch: 10 }, // คะแนน
        { wch: 25 }, // ชื่อ-นามสกุล
        { wch: 8 },  // อายุ
        { wch: 15 }, // สัญชาติ
        { wch: 20 }, // เลขบัตรประชาชน
        { wch: 30 }, // สังกัดบริษัท
        { wch: 15 }  // ประเภทการสอบ
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
        <p className="font-black uppercase tracking-widest text-[10px]">กำลังประมวลผลข้อมูล (Syncing Data)...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-red-500 gap-4 animate-in fade-in">
        <AlertCircle className="w-12 h-12 opacity-20" />
        <p className="font-bold text-sm">{error}</p>
        <button onClick={fetchData} className="px-6 py-2 bg-slate-100 rounded-xl text-slate-600 font-black text-xs uppercase hover:bg-slate-200 transition-all">ลองใหม่อีกครั้ง (Retry)</button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 md:space-y-8 animate-in fade-in duration-500 text-left pb-10">
      
      {/* 1. Header & Primary Actions */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4 border-b border-slate-200 pb-6">
        <div className="space-y-1">
          <h2 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight uppercase flex items-center gap-2">
            Dashboard Analytics <span className="text-sm text-slate-400 font-medium normal-case ml-2 border-l-2 pl-3">ภาพรวมระบบ</span>
          </h2>
          <div className="text-slate-400 font-bold uppercase text-[9px] md:text-[10px] tracking-[0.2em] flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" /> 
            Real-time Security Metrics
          </div>
        </div>
        <div className="flex w-full lg:w-auto gap-2">
          <button 
            onClick={exportToExcel}
            disabled={filteredHistory.length === 0}
            className="flex-1 lg:flex-none flex items-center justify-center gap-2 bg-slate-900 hover:bg-black disabled:bg-slate-200 text-white px-6 py-3.5 rounded-2xl font-black text-xs uppercase transition-all shadow-lg active:scale-95 group"
          >
            <FileSpreadsheet size={16} className="group-hover:rotate-12 transition-transform" />
            <span className="flex flex-col items-start leading-tight">
                <span>Export Data</span>
                <span className="text-[8px] text-slate-300 font-medium">ส่งออก Excel</span>
            </span>
          </button>
          <button onClick={fetchData} title="รีเฟรชข้อมูล (Refresh)" className="p-3.5 bg-slate-100 text-slate-500 rounded-2xl hover:bg-blue-50 hover:text-blue-600 transition-all active:scale-90">
            <RotateCcw size={18} />
          </button>
        </div>
      </div>

      {/* 2. Visual Statistics Widgets (Bilingual) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          icon={<Activity />} 
          label="Total Exams / สอบทั้งหมด" 
          value={stats.total} 
          color="blue" 
          trend="Today's Activity"
          description="จำนวนการทดสอบในวันนี้"
        />
        <StatCard 
          icon={<ShieldCheck />} 
          label="Qualified / ผ่านเกณฑ์" 
          value={stats.passed} 
          color="emerald" 
          trend={`${stats.total > 0 ? ((stats.passed / stats.total) * 100).toFixed(0) : 0}% Pass Rate`}
          description="ผู้รับเหมาที่พร้อมเข้าปฏิบัติงาน"
          glow="glow-emerald"
        />
        <StatCard 
          icon={<AlertTriangle />} 
          label="Retakes / ไม่ผ่านเกณฑ์" 
          value={stats.failed} 
          color="amber" 
          trend="Needs Attention"
          description="ผู้ที่ต้องรับการอบรมและสอบใหม่"
          glow="glow-amber"
        />
        <StatCard 
          icon={<UserX />} 
          label="Denied / ห้ามเข้าพื้นที่" 
          value={stats.failed} 
          color="red" 
          trend="Access Revoked"
          description="ไม่ผ่านการประเมินความปลอดภัย"
          glow="glow-red"
        />
      </div>

      {/* 3. Data Visualization Charts */}
      {history.length > 0 && (
        <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in slide-in-from-bottom-4 duration-700">
                <div className="lg:col-span-2 bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm">
                    <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6 flex justify-between items-center">
                        <span className="flex items-center gap-2"><LineChartIcon size={14} className="text-blue-500" /> Daily Traffic Trend <span className="text-[9px] text-slate-300 ml-1">| แนวโน้มรายวัน</span></span>
                    </h3>
                    <div className="w-full h-[220px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData.trendData} margin={{ top: 5, right: 20, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold', fill: '#94a3b8' }} dy={10} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold', fill: '#94a3b8' }} allowDecimals={false} />
                                <Tooltip contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }} />
                                <Line type="monotone" dataKey="Exams" stroke="#3b82f6" strokeWidth={4} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 6, fill: '#3b82f6' }} name="จำนวนผู้เข้าสอบ" />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="lg:col-span-1 bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col">
                    <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6 flex justify-between items-center">
                        <span className="flex items-center gap-2"><Building2 size={14} className="text-amber-500" /> Top Vendors <span className="text-[9px] text-slate-300 ml-1">| จัดอันดับบริษัท</span></span>
                    </h3>
                    <div className="flex-1 flex flex-col gap-4 overflow-y-auto pr-2 no-scrollbar">
                        {chartData.vendorData.map((vendor: any, i: number) => (
                            <div key={i} className="flex items-center gap-3 group">
                                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center font-black text-xs text-slate-500 flex-shrink-0 group-hover:bg-amber-100 group-hover:text-amber-600 transition-colors">
                                    {i + 1}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-end mb-1">
                                        <p className="font-bold text-xs text-slate-800 truncate uppercase" title={vendor.name}>{vendor.name}</p>
                                        <p className="text-xs font-black text-slate-600 ml-2 tabular-nums">{vendor.total}</p>
                                    </div>
                                    <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden flex">
                                        <div style={{ width: `${(vendor.passed / vendor.total) * 100}%` }} className="h-full bg-emerald-400"></div>
                                        <div style={{ width: `${(vendor.failed / vendor.total) * 100}%` }} className="h-full bg-red-400"></div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in slide-in-from-bottom-6 duration-700">
                <div className="lg:col-span-1 bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col items-center">
                    <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 w-full flex justify-between items-center">
                        <span className="flex items-center gap-2"><PieChartIcon size={14} className="text-emerald-500" /> Pass / Fail Ratio</span>
                    </h3>
                    <div className="w-full h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                        <Pie data={chartData.pieData} innerRadius={55} outerRadius={80} paddingAngle={5} dataKey="value">
                            {chartData.pieData.map((entry, index) => (<Cell key={`cell-${index}`} fill={entry.color} />))}
                        </Pie>
                        <Tooltip contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }} itemStyle={{ fontWeight: 'bold', fontSize: '12px' }} />
                        <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }} />
                        </PieChart>
                    </ResponsiveContainer>
                    </div>
                </div>

                <div className="lg:col-span-2 bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm">
                    <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
                    <TrendingUp size={14} className="text-purple-500" /> Performance by Module <span className="text-[9px] text-slate-300 ml-1">| แยกตามหลักสูตร</span>
                    </h3>
                    <div className="w-full h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData.barData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 'bold', fill: '#94a3b8' }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold', fill: '#94a3b8' }} allowDecimals={false} />
                        <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }} />
                        <Legend wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }} />
                        <Bar dataKey="Passed" name="ผ่าน (Pass)" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={45} />
                        <Bar dataKey="Failed" name="ไม่ผ่าน (Fail)" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={45} />
                        </BarChart>
                    </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* 4. Smart Filters & Search Bar */}
      <div className="bg-white p-4 md:p-6 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text" 
              placeholder="ค้นหาชื่อ, เลขบัตร หรือชื่อบริษัท (Search Name, ID, Vendor)..." 
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
              className="px-4 py-3.5 rounded-2xl border border-slate-100 bg-slate-50 font-black text-[10px] uppercase outline-none focus:ring-2 focus:ring-blue-500/10 appearance-none cursor-pointer min-w-[140px]"
            >
              <option value="ALL">ทุกสถานะ (All)</option>
              <option value="PASSED">ผ่าน (Passed)</option>
              <option value="FAILED">ไม่ผ่าน (Failed)</option>
            </select>
            <select 
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-4 py-3.5 rounded-2xl border border-slate-100 bg-slate-50 font-black text-[10px] uppercase outline-none focus:ring-2 focus:ring-blue-500/10 appearance-none cursor-pointer min-w-[140px]"
            >
              <option value="ALL">ทุกหลักสูตร (All)</option>
              <option value="INDUCTION">Induction</option>
              <option value="WORK_PERMIT">Work Permit</option>
            </select>
          </div>
        </div>
      </div>

      {/* 5. Activity Logs Table */}
      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden mb-12">
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[1000px]">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-8 py-5 text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">ข้อมูลพนักงาน<br/><span className="text-[8px] text-slate-400">Personnel Info</span></th>
                <th className="px-8 py-5 text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">ข้อมูลส่วนตัว<br/><span className="text-[8px] text-slate-400">Profile</span></th>
                <th className="px-8 py-5 text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">หลักสูตร<br/><span className="text-[8px] text-slate-400">Module</span></th>
                <th className="px-8 py-5 text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] text-center">คะแนน<br/><span className="text-[8px] text-slate-400">Score</span></th>
                <th className="px-8 py-5 text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">วันที่ทำรายการ<br/><span className="text-[8px] text-slate-400">Timestamp</span></th>
                <th className="px-8 py-5 text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] text-right">ผลประเมิน<br/><span className="text-[8px] text-slate-400">Result</span></th>
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
                        <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">{item.users?.vendors?.name || 'EXTERNAL (ไม่มีสังกัด)'}</span>
                      </div>
                    </div>
                  </td>
                  {/* ✅ เพิ่มคอลัมน์แสดงอายุและสัญชาติ */}
                  <td className="px-8 py-6">
                    <div className="flex flex-col">
                      <span className="text-xs font-black text-slate-700 uppercase">{item.users?.nationality || 'N/A'}</span>
                      <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">อายุ (Age): {item.users?.age ? `${item.users.age} ปี` : '-'}</span>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <span className={`text-[9px] font-black px-3 py-1.5 rounded-xl border w-fit uppercase ${item.exam_type === 'INDUCTION' ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-purple-50 text-purple-600 border-purple-100'}`}>
                      {item.exam_type?.replace('_', ' ')}
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
                        {new Date(item.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' })}
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
                    <td colSpan={6} className="px-8 py-32 text-center">
                      <div className="flex flex-col items-center opacity-20">
                        <Activity size={60} className="text-slate-300 mb-4 animate-pulse" />
                        <p className="font-black text-slate-400 uppercase text-xs tracking-widest italic">ไม่พบข้อมูลที่ค้นหา (No matching records)</p>
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