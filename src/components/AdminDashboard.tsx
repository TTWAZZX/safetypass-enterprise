import React, { useEffect, useState, useMemo, useRef } from 'react';
import { api } from '../services/supabaseApi'; 
import { supabase } from '../services/supabaseClient'; 
import {
  Users, CheckCircle, XCircle, FileSpreadsheet,
  Search, Calendar, TrendingUp,
  Loader2, AlertCircle, RotateCcw, Filter, ChevronRight, ChevronLeft,
  ShieldCheck, AlertTriangle, UserX, Activity, PieChart as PieChartIcon,
  LineChart as LineChartIcon, Building2, ShieldAlert, Clock, ArrowRight, ChevronDown
} from 'lucide-react';
import { downloadSupplierOutsourceWorkbook, downloadWorkbook } from '../services/excelExport';
import { SupplierOutsourceReportRow } from '../types';
import AsyncState from './AsyncState';
import { calculateSupplierDashboardMetrics } from '../services/dashboardMetrics';

import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line
} from 'recharts';

const AdminDashboard: React.FC<{
  onNavigateToUsers?: () => void;
  onNavigateToSupplier?: () => void;
}> = ({ onNavigateToUsers, onNavigateToSupplier }) => {
  const [history, setHistory] = useState<any[]>([]);
  const [stats, setStats] = useState({ total: 0, passed: 0, failed: 0, suspended: 0 });
  const [complianceStats, setComplianceStats] = useState<{ noCert: number; expired: number; expiring: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [supplierExportLoading, setSupplierExportLoading] = useState(false);
  const [supplierRows, setSupplierRows] = useState<SupplierOutsourceReportRow[]>([]);
  const [supplierLaunchStatus, setSupplierLaunchStatus] = useState({ enabled: false, activeQuestionCount: 0 });
  const [supplierLoadError, setSupplierLoadError] = useState('');
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Filtering States
  const [filterDate, setFilterDate] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterType, setFilterType] = useState('ALL');

  // ✅ Pagination States
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10); // จำนวนต่อหน้า (เริ่มที่ 10)

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExportMenuOpen(false);
    };
    const closeOnOutsideClick = (event: MouseEvent | TouchEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('touchstart', closeOnOutsideClick);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('touchstart', closeOnOutsideClick);
    };
  }, [exportMenuOpen]);

  // ✅ รีเซ็ตหน้ากลับไปที่ 1 เสมอเวลาเปลี่ยนตัวกรอง ค้นหา หรือเปลี่ยนจำนวนแสดง
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterDate, filterStatus, filterType, itemsPerPage]);

  const loadSupplierSnapshot = async () => {
    setSupplierLoadError('');
    try {
      const [supplierReport, launchStatus] = await Promise.all([
        api.getSupplierOutsourceReport(),
        api.getSupplierOutsourceLaunchStatus(),
      ]);
      setSupplierRows(supplierReport);
      setSupplierLaunchStatus(launchStatus);
    } catch (supplierError: any) {
      console.error('Supplier dashboard metrics error:', supplierError);
      setSupplierLoadError(supplierError?.message || 'ไม่สามารถโหลดข้อมูล Supplier & Outsource ได้');
    }
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [historyData] = await Promise.all([
        api.getAllExamHistory(),
        loadSupplierSnapshot(),
      ]);

      let suspendedCount = 0;
      try {
         const { count } = await supabase
           .from('users')
           .select('*', { count: 'exact', head: true })
           .eq('is_active', false);
         suspendedCount = count || 0;
      } catch (e) {
         console.warn("Table users might not have is_active column yet", e);
      }

      const validHistory = historyData || [];
      
      const totalExams = validHistory.length;
      const passedExams = validHistory.filter(h => h.status === 'PASSED').length;
      const failedExams = validHistory.filter(h => h.status !== 'PASSED').length;

      setHistory(validHistory);
      setStats({
        total: totalExams,
        passed: passedExams,
        failed: failedExams,
        suspended: suspendedCount
      });

      // Compliance stats
      try {
        const { data: usersData } = await supabase
          .from('users')
          .select('induction_expiry')
          .eq('is_active', true);
        if (usersData) {
          const now = Date.now();
          const soon = now + 30 * 24 * 60 * 60 * 1000;
          let noCert = 0, expired = 0, expiring = 0;
          for (const u of usersData) {
            if (!u.induction_expiry) { noCert++; continue; }
            const exp = new Date(u.induction_expiry).getTime();
            if (exp <= now) expired++;
            else if (exp <= soon) expiring++;
          }
          setComplianceStats({ noCert, expired, expiring });
        }
      } catch { /* non-critical */ }

    } catch (err: any) {
      console.error("Dashboard fetch error:", err);
      setError("ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setLoading(false);
    }
  };

  const chartData = useMemo(() => {
    if (!history.length) return { pieData: [], barData: [], trendData: [], vendorData: [] };

    const passCount = history.filter(h => h.status === 'PASSED').length;
    const failCount = history.filter(h => h.status !== 'PASSED').length;
    const pieData = [
      { name: 'ผ่าน (Passed)', value: passCount, color: '#10b981' },
      { name: 'ไม่ผ่าน (Failed)', value: failCount, color: '#ef4444' }
    ];

    const typeStats = history.reduce((acc: any, curr: any) => {
      const type = curr.exam_type || 'UNKNOWN';
      if (!acc[type]) acc[type] = { name: type.replace('_', ' '), Passed: 0, Failed: 0 };
      if (curr.status === 'PASSED') acc[type].Passed += 1;
      else acc[type].Failed += 1;
      return acc;
    }, {});
    const barData = Object.values(typeStats);

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

  const supplierMetrics = useMemo(
    () => calculateSupplierDashboardMetrics(supplierRows),
    [supplierRows],
  );

  // ✅ การกรองข้อมูล
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

  // ✅ การแบ่งหน้า (Pagination)
  const totalItems = filteredHistory.length;
  const totalPages = itemsPerPage === -1 ? 1 : Math.ceil(totalItems / itemsPerPage);
  const paginatedData = itemsPerPage === -1 
    ? filteredHistory 
    : filteredHistory.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const exportToExcel = async () => {
    if (filteredHistory.length === 0) return;

    // Header row (ลำดับคอลัมน์ตามที่กำหนด)
    const headers = [
      'วันที่ทำแบบทดสอบ', 'ผลการสอบ', 'คะแนน',
      'ชื่อ-นามสกุล', 'อายุ', 'สัญชาติ',
      'เลขบัตรประชาชน', 'สังกัดบริษัท', 'ประเภทการสอบ'
    ];

    // Data rows — ใช้ array เพื่อควบคุมลำดับคอลัมน์ได้แน่นอน
    const rows = filteredHistory.map(item => {
      const idNum = parseInt((item.users?.national_id || '').replace(/\D/g, '') || '0', 10);
      return [
        new Date(item.created_at),                                       // A – Date object → Excel date
        item.status === 'PASSED' ? 'ผ่าน (PASS)' : 'ไม่ผ่าน (FAIL)',  // B
        item.score ?? 0,                                                 // C – คะแนนที่ได้ (ตัวเลขเดียว)
        item.users?.name || '-',                                          // D
        item.users?.age ?? '-',                                           // E
        item.users?.nationality || '-',                                   // F
        idNum,                                                             // G – number → custom 13-digit format
        item.users?.vendors?.name || '-',                                 // H
        item.exam_type || '-',                                             // I
      ];
    });

    const dateSuffix = filterDate || new Date().toISOString().split('T')[0];
    await downloadWorkbook(
      'Safety_Report',
      headers,
      rows,
      `Safety_Report_${filterType}_${filterStatus}_${dateSuffix}.xlsx`,
      [16, 16, 10, 26, 8, 15, 20, 32, 15],
      { 1: 'dd/mm/yyyy', 7: '0000000000000' },
    );
  };

  const exportSupplierOutsource = async () => {
    try {
      setSupplierExportLoading(true);
      const rows = await api.getSupplierOutsourceReport();
      await downloadSupplierOutsourceWorkbook(rows);
      setExportMenuOpen(false);
    } catch (exportError: any) {
      console.error('Supplier & Outsource export failed:', exportError);
      window.alert('ไม่สามารถส่งออกรายงาน Supplier & Outsource ได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setSupplierExportLoading(false);
    }
  };

  const renderPagination = (position: 'top' | 'bottom') => {
    if (filteredHistory.length === 0) return null;
    return (
      <div className={`bg-slate-50/50 p-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 ${position === 'top' ? 'border-b border-slate-100' : 'mt-auto border-t border-slate-200'}`}>
         {/* Page Size Selector */}
         <div className="flex items-center gap-2 text-[10px] md:text-xs font-bold text-slate-500 w-full sm:w-auto justify-center sm:justify-start">
            <span>แสดง</span>
            <select 
                value={itemsPerPage} 
                onChange={(e) => setItemsPerPage(Number(e.target.value))}
                className="bg-white border border-slate-200 rounded-lg px-2 py-1 outline-none focus:border-blue-500 shadow-sm font-black text-slate-700"
            >
                <option value={10}>10</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={500}>500</option>
                <option value={1000}>1,000</option>
                <option value={-1}>ทั้งหมด (All)</option>
            </select>
            <span>รายการ</span>
            <span className="ml-2 hidden sm:inline text-slate-400 font-medium">| จากทั้งหมด {totalItems} รายการ</span>
         </div>

         {/* Prev / Next Buttons */}
         <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
            <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="flex min-h-11 min-w-11 items-center justify-center gap-1 p-2 md:px-3 md:py-1.5 rounded-xl border border-slate-200 bg-white text-slate-600 disabled:opacity-50 disabled:bg-slate-50 hover:bg-slate-100 hover:text-blue-600 transition-all shadow-sm font-bold text-xs"
            >
                <ChevronLeft size={16} /> <span className="hidden md:inline">ก่อนหน้า</span>
            </button>
            <span className="text-[10px] md:text-xs font-black text-slate-600 bg-white px-4 py-1.5 rounded-xl border border-slate-200 shadow-sm">
                {currentPage} <span className="text-slate-400 mx-1">/</span> {totalPages}
            </span>
            <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages || totalPages === 0}
                className="flex min-h-11 min-w-11 items-center justify-center gap-1 p-2 md:px-3 md:py-1.5 rounded-xl border border-slate-200 bg-white text-slate-600 disabled:opacity-50 disabled:bg-slate-50 hover:bg-slate-100 hover:text-blue-600 transition-all shadow-sm font-bold text-xs"
            >
                <span className="hidden md:inline">ถัดไป</span> <ChevronRight size={16} />
            </button>
         </div>
         <span className="sm:hidden text-slate-400 font-bold text-[9px] uppercase mt-1">รวมทั้งหมด {totalItems} รายการ</span>
      </div>
    );
  };

  if (loading) {
    return <AsyncState variant="loading" title="กำลังโหลด Dashboard" description="ระบบกำลังรวบรวมสถิติผู้รับเหมาและ Supplier & Outsource" />;
  }

  if (error) {
    return <AsyncState variant="error" title="โหลด Dashboard ไม่สำเร็จ" description={error} onRetry={fetchData} />;
  }

  return (
    <div className="w-full space-y-6 pb-10 text-left md:space-y-8">
      
      {/* 1. Header & Primary Actions */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b border-slate-200 pb-6 mt-4">
        <div className="space-y-1 w-full md:w-auto">
          <h2 className="text-xl sm:text-2xl md:text-3xl font-black text-slate-900 tracking-tight uppercase flex items-center gap-2">
            Dashboard Analytics <span className="hidden sm:inline text-sm text-slate-400 font-medium normal-case ml-2 border-l-2 pl-3">ภาพรวมระบบ</span>
          </h2>
          <div className="text-slate-400 font-bold uppercase text-[9px] md:text-[10px] tracking-[0.2em] flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" /> 
            Real-time Security Metrics
          </div>
        </div>
        <div className="flex w-full md:w-auto gap-2">
          <div ref={exportMenuRef} className="relative flex-1 md:flex-none">
            <button
              type="button"
              onClick={() => setExportMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={exportMenuOpen}
              aria-controls="dashboard-export-menu"
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3.5 text-xs font-black uppercase text-white shadow-lg transition-all hover:bg-black active:scale-95 sm:px-6 md:w-auto"
            >
              <FileSpreadsheet size={16} />
              <span className="flex flex-col items-start leading-none text-left">
                  <span className="mb-0.5">Export Data</span>
                  <span className="text-[8px] font-medium text-slate-300">ส่งออก Excel</span>
              </span>
              <ChevronDown size={14} className={`transition-transform ${exportMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            {exportMenuOpen && (
              <div
                id="dashboard-export-menu"
                role="menu"
                aria-label="เลือกรายงาน Excel"
                className="absolute right-0 z-40 mt-2 w-full min-w-[260px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl md:w-72"
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={filteredHistory.length === 0}
                  onClick={async () => {
                    await exportToExcel();
                    setExportMenuOpen(false);
                  }}
                  className="w-full rounded-xl px-4 py-3 text-left transition-colors hover:bg-blue-50 focus:bg-blue-50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="block text-[10px] font-black uppercase text-slate-800">รายงานผู้รับเหมาเดิม</span>
                  <span className="mt-1 block text-[9px] font-bold text-slate-400">Contractor report</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={supplierExportLoading}
                  onClick={exportSupplierOutsource}
                  className="w-full rounded-xl px-4 py-3 text-left transition-colors hover:bg-emerald-50 focus:bg-emerald-50 focus:outline-none disabled:cursor-wait disabled:opacity-50"
                >
                  <span className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-800">
                    {supplierExportLoading && <Loader2 size={13} className="animate-spin" />}
                    รายงาน Supplier & Outsource
                  </span>
                  <span className="mt-1 block text-[9px] font-bold text-slate-400">Supplier Epass Check Member</span>
                </button>
              </div>
            )}
          </div>
          <button onClick={fetchData} title="รีเฟรชข้อมูล (Refresh)" aria-label="รีเฟรชข้อมูล Dashboard" className="min-h-11 min-w-11 p-3.5 bg-slate-100 text-slate-500 rounded-2xl hover:bg-blue-50 hover:text-blue-600 transition-all active:scale-90 flex-shrink-0">
            <RotateCcw size={18} />
          </button>
        </div>
      </div>

      {/* 2. Visual Statistics Widgets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          icon={<Activity />} 
          label="Total Exams / สอบทั้งหมด" 
          value={stats.total} 
          color="blue" 
          trend="All-time Activity"
          description="จำนวนการทดสอบในระบบ"
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
          label="Suspended / ถูกระงับสิทธิ์" 
          value={stats.suspended} 
          color="red" 
          trend="Access Revoked"
          description="พนักงานที่ถูกแบล็คลิสต์ในระบบ"
          glow="glow-red"
        />
      </div>

      {/* Supplier & Outsource snapshot */}
      <section className="rounded-[2rem] border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-cyan-50 p-4 shadow-sm sm:p-6" aria-labelledby="supplier-dashboard-title">
        {supplierLoadError ? <AsyncState compact variant="error" title="โหลดภาพรวม Supplier & Outsource ไม่สำเร็จ" description={supplierLoadError} onRetry={loadSupplierSnapshot} /> : <>
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="supplier-dashboard-title" className="text-sm font-black text-slate-900">ภาพรวม Supplier & Outsource</h3>
              <span className={`rounded-full px-2.5 py-1 text-[8px] font-black ${supplierLaunchStatus.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                {supplierLaunchStatus.enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
              </span>
            </div>
            <p className="mt-1 text-[10px] font-bold text-slate-500">
              ข้อสอบที่เปิดใช้งาน {supplierLaunchStatus.activeQuestionCount} ข้อ · เกณฑ์ขั้นต่ำ 20 ข้อ · Supplier {supplierMetrics.suppliers} คน · Outsource {supplierMetrics.outsource} คน
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-xl border border-emerald-100 bg-white px-4 py-2 text-right shadow-sm">
              <p className="text-[8px] font-black text-slate-400">อัตราสอบผ่าน</p>
              <p className="text-2xl font-black tabular-nums text-emerald-600">{supplierMetrics.passRate}%</p>
            </div>
            {onNavigateToSupplier && <button type="button" onClick={onNavigateToSupplier} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-[9px] font-black text-white transition-colors hover:bg-emerald-700">ดูรายละเอียด <ArrowRight size={14}/></button>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SupplierMetricCard label="ผู้มีสิทธิ์" value={supplierMetrics.entitled} detail="รายชื่อทั้งหมด" color="blue" />
          <SupplierMetricCard label="บัตรใช้งานได้" value={supplierMetrics.activePasses} detail="ผ่านและยังไม่หมดอายุ" color="emerald" />
          <SupplierMetricCard label="ต้องดำเนินการ" value={supplierMetrics.actionRequired} detail="ยังไม่สอบ ไม่ผ่าน หรือหมดอายุ" color="amber" />
          <SupplierMetricCard label="ใกล้หมดอายุ" value={supplierMetrics.nearExpiry} detail="ภายใน 30 วัน" color="red" />
        </div>
        </>}
      </section>

      {/* 2.5 Compliance Alert Widget */}
      {complianceStats && (complianceStats.noCert + complianceStats.expired + complianceStats.expiring) > 0 && (
        <div className="bg-gradient-to-r from-rose-50 to-amber-50 border border-rose-200 rounded-[2rem] p-4 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-in fade-in duration-500">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-rose-100 rounded-2xl shrink-0">
              <ShieldAlert size={22} className="text-rose-500" />
            </div>
            <div>
              <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-1">Compliance Alert</p>
              <p className="text-sm font-black text-slate-800">พนักงานที่ต้องดำเนินการ</p>
              <div className="flex flex-wrap gap-3 mt-2">
                {complianceStats.noCert > 0 && (
                  <span className="text-[10px] font-black text-rose-600 bg-rose-100 px-2 py-1 rounded-lg flex items-center gap-1">
                    <ShieldAlert size={11}/> ไม่มีใบเซอร์: {complianceStats.noCert} คน
                  </span>
                )}
                {complianceStats.expired > 0 && (
                  <span className="text-[10px] font-black text-orange-600 bg-orange-100 px-2 py-1 rounded-lg flex items-center gap-1">
                    <AlertTriangle size={11}/> หมดอายุแล้ว: {complianceStats.expired} คน
                  </span>
                )}
                {complianceStats.expiring > 0 && (
                  <span className="text-[10px] font-black text-amber-600 bg-amber-100 px-2 py-1 rounded-lg flex items-center gap-1">
                    <Clock size={11}/> ใกล้หมดอายุ: {complianceStats.expiring} คน
                  </span>
                )}
              </div>
            </div>
          </div>
          {onNavigateToUsers && (
            <button
              onClick={onNavigateToUsers}
              className="flex min-h-11 items-center gap-2 bg-rose-500 hover:bg-rose-600 text-white px-5 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95 shadow-lg shadow-rose-200 whitespace-nowrap shrink-0"
            >
              จัดการ <ArrowRight size={14}/>
            </button>
          )}
        </div>
      )}

      {/* 3. Data Visualization Charts */}
      {history.length > 0 && (
        <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in slide-in-from-bottom-4 duration-700">
                <div className="lg:col-span-2 bg-white p-4 sm:p-6 rounded-[2rem] sm:rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
                    <h3 className="text-[10px] sm:text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 sm:mb-6 flex justify-between items-center">
                        <span className="flex items-center gap-2"><LineChartIcon size={14} className="text-blue-500" /> Daily Traffic Trend <span className="hidden sm:inline text-[9px] text-slate-300 ml-1">| แนวโน้มรายวัน</span></span>
                    </h3>
                    <div className="w-full h-[180px] sm:h-[220px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData.trendData} margin={{ top: 5, right: 10, left: -30, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 'bold', fill: '#94a3b8' }} dy={10} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold', fill: '#94a3b8' }} allowDecimals={false} />
                                <Tooltip isAnimationActive={false} contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }} />
                                <Line isAnimationActive={false} type="monotone" dataKey="Exams" stroke="#3b82f6" strokeWidth={3} dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 5, fill: '#3b82f6' }} name="จำนวนผู้เข้าสอบ" />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="lg:col-span-1 bg-white p-4 sm:p-6 rounded-[2rem] sm:rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col h-[280px] sm:h-auto overflow-hidden">
                    <h3 className="text-[10px] sm:text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 sm:mb-6 flex justify-between items-center">
                        <span className="flex items-center gap-2"><Building2 size={14} className="text-amber-500" /> Top Vendors <span className="hidden sm:inline text-[9px] text-slate-300 ml-1">| จัดอันดับบริษัท</span></span>
                    </h3>
                    <div className="flex-1 flex flex-col gap-3 overflow-y-auto pr-2 no-scrollbar sm:gap-4 sm:overflow-y-visible">
                        {chartData.vendorData.map((vendor: any, i: number) => (
                            <div key={i} className="flex items-center gap-3 group">
                                <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-slate-100 flex items-center justify-center font-black text-[10px] sm:text-xs text-slate-500 flex-shrink-0 group-hover:bg-amber-100 group-hover:text-amber-600 transition-colors">
                                    {i + 1}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-end mb-1">
                                        <p className="font-bold text-[10px] sm:text-xs text-slate-800 truncate uppercase" title={vendor.name}>{vendor.name}</p>
                                        <p className="text-[10px] sm:text-xs font-black text-slate-600 ml-2 tabular-nums">{vendor.total}</p>
                                    </div>
                                    <div className="w-full bg-slate-100 h-1 sm:h-1.5 rounded-full overflow-hidden flex">
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
                <div className="lg:col-span-1 bg-white p-4 sm:p-6 rounded-[2rem] sm:rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col items-center">
                    <h3 className="text-[10px] sm:text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 w-full flex justify-between items-center">
                        <span className="flex items-center gap-2"><PieChartIcon size={14} className="text-emerald-500" /> Pass / Fail Ratio</span>
                    </h3>
                    <div className="w-full h-[180px] sm:h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                        <Pie isAnimationActive={false} data={chartData.pieData} innerRadius={50} outerRadius={70} paddingAngle={5} dataKey="value">
                            {chartData.pieData.map((entry, index) => (<Cell key={`cell-${index}`} fill={entry.color} />))}
                        </Pie>
                        <Tooltip isAnimationActive={false} contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }} itemStyle={{ fontWeight: 'bold', fontSize: '11px' }} />
                        <Legend iconType="circle" wrapperStyle={{ fontSize: '9px', fontWeight: 'bold' }} />
                        </PieChart>
                    </ResponsiveContainer>
                    </div>
                </div>

                <div className="lg:col-span-2 bg-white p-4 sm:p-6 rounded-[2rem] sm:rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
                    <h3 className="text-[10px] sm:text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 sm:mb-6 flex items-center gap-2">
                    <TrendingUp size={14} className="text-purple-500" /> Performance by Module <span className="hidden sm:inline text-[9px] text-slate-300 ml-1">| แยกตามหลักสูตร</span>
                    </h3>
                    <div className="w-full h-[180px] sm:h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData.barData} margin={{ top: 10, right: 0, left: -30, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 8, fontWeight: 'bold', fill: '#94a3b8' }} interval={0} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 'bold', fill: '#94a3b8' }} allowDecimals={false} />
                        <Tooltip isAnimationActive={false} cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }} />
                        <Legend wrapperStyle={{ fontSize: '9px', fontWeight: 'bold' }} />
                        <Bar isAnimationActive={false} dataKey="Passed" name="ผ่าน (Pass)" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} />
                        <Bar isAnimationActive={false} dataKey="Failed" name="ไม่ผ่าน (Fail)" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={40} />
                        </BarChart>
                    </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* 4. Smart Filters & Search Bar */}
      <div className="bg-white p-4 sm:p-6 rounded-[2rem] sm:rounded-[2.5rem] border border-slate-200 shadow-sm space-y-4 relative z-20">
        <div className="flex flex-col lg:flex-row gap-3 sm:gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input 
              type="text" 
              placeholder="ค้นหาชื่อ, เลขบัตร หรือชื่อบริษัท..." 
              className="w-full pl-10 pr-4 py-3 sm:py-4 rounded-[1rem] sm:rounded-2xl border border-slate-100 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none font-bold text-xs sm:text-sm transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative w-full sm:w-auto">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={14} />
              <input 
                type="date" 
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="w-full sm:w-auto pl-9 pr-3 py-3 sm:py-3.5 rounded-[1rem] sm:rounded-2xl border border-slate-100 bg-slate-50 font-bold text-xs outline-none focus:ring-2 focus:ring-blue-500/10 transition-all cursor-pointer"
              />
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
                <select 
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="flex-1 sm:flex-none px-3 py-3 sm:py-3.5 rounded-[1rem] sm:rounded-2xl border border-slate-100 bg-slate-50 font-black text-[9px] sm:text-[10px] uppercase outline-none focus:ring-2 focus:ring-blue-500/10 appearance-none cursor-pointer min-w-0 sm:min-w-[120px]"
                >
                <option value="ALL">ทุกสถานะ (All)</option>
                <option value="PASSED">ผ่าน (Passed)</option>
                <option value="FAILED">ไม่ผ่าน (Failed)</option>
                </select>
                <select 
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="flex-1 sm:flex-none px-3 py-3 sm:py-3.5 rounded-[1rem] sm:rounded-2xl border border-slate-100 bg-slate-50 font-black text-[9px] sm:text-[10px] uppercase outline-none focus:ring-2 focus:ring-blue-500/10 appearance-none cursor-pointer min-w-0 sm:min-w-[120px]"
                >
                <option value="ALL">ทุกหลักสูตร (All)</option>
                <option value="INDUCTION">Induction</option>
                <option value="WORK_PERMIT">Work Permit</option>
                <option value="SUPPLIER_OUTSOURCE">Supplier & Outsource</option>
                </select>
            </div>
          </div>
        </div>
      </div>

      {/* 5. Activity Logs Table with Pagination */}
      <div className="bg-white rounded-[2rem] sm:rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden mb-12 relative z-10 flex flex-col">
        
        {/* ✅ Pagination Top */}
        {renderPagination('top')}

        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:hidden">
          {paginatedData.length > 0 ? paginatedData.map((item) => (
            <article key={item.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm" aria-label={`ผลสอบของ ${item.users?.name || 'ผู้ใช้'}`}>
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-sm font-black uppercase text-blue-700">
                    {item.users?.name?.charAt(0) || '?'}
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-black text-slate-900">{item.users?.name || '-'}</h3>
                    <p className="mt-0.5 truncate text-[9px] font-bold text-slate-400">{item.users?.vendors?.name || 'ไม่มีสังกัด'}</p>
                  </div>
                </div>
                <span className={`shrink-0 rounded-xl border px-2.5 py-1.5 text-[8px] font-black ${item.status === 'PASSED' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-red-100 bg-red-50 text-red-700'}`}>
                  {item.status === 'PASSED' ? 'ผ่าน' : 'ไม่ผ่าน'}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-[10px]">
                <div><dt className="font-black text-slate-400">หลักสูตร</dt><dd className="mt-1 font-bold text-slate-700">{item.exam_type?.replace('_', ' ') || '-'}</dd></div>
                <div><dt className="font-black text-slate-400">คะแนน</dt><dd className={`mt-1 text-sm font-black ${item.status === 'PASSED' ? 'text-emerald-600' : 'text-red-600'}`}>{item.score ?? '-'} / {item.total_questions ?? '-'}</dd></div>
                <div><dt className="font-black text-slate-400">สัญชาติ / อายุ</dt><dd className="mt-1 font-bold text-slate-700">{item.users?.nationality || '-'} • {item.users?.age ? `${item.users.age} ปี` : '-'}</dd></div>
                <div><dt className="font-black text-slate-400">วันที่ทำรายการ</dt><dd className="mt-1 font-bold text-slate-700">{new Date(item.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' })}<span className="block text-[9px] text-slate-400">{new Date(item.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</span></dd></div>
              </dl>
            </article>
          )) : <AsyncState compact variant="empty" title="ไม่พบประวัติการสอบ" description="ลองเปลี่ยนคำค้นหา วันที่ สถานะ หรือหลักสูตรที่เลือก" />}
        </div>

        <div className="hidden overflow-x-auto xl:block">
          <table className="w-full text-left min-w-[800px]">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-6 sm:px-8 py-4 sm:py-5 text-[8px] sm:text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] whitespace-nowrap">ข้อมูลพนักงาน<br/><span className="text-[7px] sm:text-[8px] text-slate-400">Personnel Info</span></th>
                <th className="px-6 sm:px-8 py-4 sm:py-5 text-[8px] sm:text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] whitespace-nowrap">ข้อมูลส่วนตัว<br/><span className="text-[7px] sm:text-[8px] text-slate-400">Profile</span></th>
                <th className="px-6 sm:px-8 py-4 sm:py-5 text-[8px] sm:text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] whitespace-nowrap">หลักสูตร<br/><span className="text-[7px] sm:text-[8px] text-slate-400">Module</span></th>
                <th className="px-6 sm:px-8 py-4 sm:py-5 text-[8px] sm:text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] text-center whitespace-nowrap">คะแนน<br/><span className="text-[7px] sm:text-[8px] text-slate-400">Score</span></th>
                <th className="px-6 sm:px-8 py-4 sm:py-5 text-[8px] sm:text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] whitespace-nowrap">วันที่ทำรายการ<br/><span className="text-[7px] sm:text-[8px] text-slate-400">Timestamp</span></th>
                <th className="px-6 sm:px-8 py-4 sm:py-5 text-[8px] sm:text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] text-right whitespace-nowrap">ผลประเมิน<br/><span className="text-[7px] sm:text-[8px] text-slate-400">Result</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {paginatedData.length > 0 ? paginatedData.map((item) => (
                <tr key={item.id} className="hover:bg-blue-50/30 transition-colors group">
                  <td className="px-6 sm:px-8 py-4 sm:py-6">
                    <div className="flex items-center gap-3 sm:gap-4">
                      <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 font-black group-hover:bg-blue-600 group-hover:text-white transition-all uppercase text-[10px] sm:text-xs shrink-0">
                        {item.users?.name?.charAt(0)}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="font-black text-slate-800 text-xs sm:text-sm uppercase truncate">{item.users?.name}</span>
                        <span className="text-[8px] sm:text-[9px] text-slate-400 font-bold uppercase tracking-wider truncate">{item.users?.vendors?.name || 'EXTERNAL (ไม่มีสังกัด)'}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 sm:px-8 py-4 sm:py-6">
                    <div className="flex flex-col">
                      <span className="text-[10px] sm:text-xs font-black text-slate-700 uppercase whitespace-nowrap">{item.users?.nationality || 'N/A'}</span>
                      <span className="text-[8px] sm:text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-0.5 whitespace-nowrap">อายุ (Age): {item.users?.age ? `${item.users.age} ปี` : '-'}</span>
                    </div>
                  </td>
                  <td className="px-6 sm:px-8 py-4 sm:py-6">
                    <span className={`text-[8px] sm:text-[9px] font-black px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg sm:rounded-xl border w-fit uppercase whitespace-nowrap ${item.exam_type === 'INDUCTION' ? 'bg-blue-50 text-blue-600 border-blue-100' : item.exam_type === 'WORK_PERMIT' ? 'bg-purple-50 text-purple-600 border-purple-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}>
                      {item.exam_type?.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 sm:px-8 py-4 sm:py-6 text-center">
                    <div className="inline-flex flex-col items-center">
                      <span className={`font-black text-xs sm:text-sm leading-none ${item.status === 'PASSED' ? 'text-emerald-600' : 'text-red-600'}`}>{item.score}</span>
                      <span className="text-[7px] sm:text-[8px] text-slate-300 font-bold uppercase mt-1 whitespace-nowrap">/ {item.total_questions}</span>
                    </div>
                  </td>
                  <td className="px-6 sm:px-8 py-4 sm:py-6">
                    <div className="flex flex-col">
                      <span className="text-[9px] sm:text-[11px] text-slate-600 font-bold whitespace-nowrap">
                        {new Date(item.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </span>
                      <span className="text-[8px] sm:text-[9px] text-slate-400 mt-1 uppercase whitespace-nowrap">
                        {new Date(item.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 sm:px-8 py-4 sm:py-6 text-right">
                    <div className={`inline-flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[8px] sm:text-[9px] font-black uppercase border shadow-sm whitespace-nowrap ${item.status === 'PASSED' ? 'bg-emerald-50 text-emerald-600 border-emerald-100 glow-emerald' : 'bg-red-50 text-red-600 border-red-100 glow-red'}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${item.status === 'PASSED' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                        {item.status}
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                    <td colSpan={6}><AsyncState compact variant="empty" title="ไม่พบประวัติการสอบ" description="ลองเปลี่ยนคำค้นหา วันที่ สถานะ หรือหลักสูตรที่เลือก" /></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ✅ Pagination Bottom */}
        {renderPagination('bottom')}
        
      </div>
    </div>
  );
};

const SupplierMetricCard = ({ label, value, detail, color }: {
  label: string; value: number; detail: string; color: 'blue' | 'emerald' | 'amber' | 'red';
}) => {
  const colors = {
    blue: 'border-blue-100 bg-blue-50/70 text-blue-700',
    emerald: 'border-emerald-100 bg-emerald-50/70 text-emerald-700',
    amber: 'border-amber-100 bg-amber-50/70 text-amber-700',
    red: 'border-red-100 bg-red-50/70 text-red-700',
  };
  return (
    <div className={`rounded-2xl border p-4 ${colors[color]}`}>
      <p className="text-[9px] font-black">{label}</p>
      <p className="mt-1 text-2xl font-black tabular-nums text-slate-900 sm:text-3xl">{value}</p>
      <p className="mt-1 text-[8px] font-bold leading-relaxed opacity-70">{detail}</p>
    </div>
  );
};

const StatCard = ({ icon, label, value, color, trend, description, glow }: any) => {
  const styles: any = {
    blue: { box: 'bg-blue-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white', badge: 'bg-blue-50 text-blue-600 border-blue-100' },
    emerald: { box: 'bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white', badge: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
    amber: { box: 'bg-amber-50 text-amber-600 group-hover:bg-amber-600 group-hover:text-white', badge: 'bg-amber-50 text-amber-600 border-amber-100' },
    red: { box: 'bg-red-50 text-red-600 group-hover:bg-red-600 group-hover:text-white', badge: 'bg-red-50 text-red-600 border-red-100' },
  };

  const c = styles[color] || styles.blue;

  return (
    <div className={`bg-white p-4 sm:p-6 rounded-[2rem] sm:rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col gap-3 sm:gap-4 group hover:border-blue-500 hover:shadow-2xl transition-all duration-500 cursor-default relative overflow-hidden ${glow}`}>
      <div className={`absolute -right-4 -top-4 sm:-right-6 sm:-top-6 opacity-[0.03] group-hover:scale-150 group-hover:rotate-12 transition-transform duration-1000`}>
          {React.cloneElement(icon as React.ReactElement, { size: 120, className: "sm:w-[160px] sm:h-[160px]" })}
      </div>
      
      <div className="flex justify-between items-start relative z-10">
        <div className={`p-3 sm:p-4 rounded-xl sm:rounded-2xl transition-all duration-500 shadow-inner ${c.box}`}>
          {React.cloneElement(icon as React.ReactElement, { className: "w-5 h-5 sm:w-6 sm:h-6", strokeWidth: 2.5 })}
        </div>
        <span className={`text-[7px] sm:text-[8px] font-black px-2 py-1 sm:px-2.5 rounded-md sm:rounded-lg border uppercase tracking-tighter max-w-[50%] truncate text-right ${c.badge}`}>
            {trend}
        </span>
      </div>

      <div className="space-y-1 relative z-10">
        <p className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest truncate">{label}</p>
        <h4 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tighter tabular-nums">{value}</h4>
        <p className="text-[8px] sm:text-[9px] text-slate-400 font-bold uppercase tracking-tight opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-500 truncate">{description}</p>
      </div>
    </div>
  );
};

export default AdminDashboard;
