import React, { useEffect, useMemo, useState } from 'react';
import { Download, Loader2, Plus, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { api } from '../services/supabaseApi';
import { supabase } from '../services/supabaseClient';
import { downloadSupplierOutsourceWorkbook } from '../services/excelExport';
import { SupplierOutsourceReportRow, SupplierOutsourceType, SupplierOutsourceWorkType } from '../types';
import { useToastContext } from './ToastProvider';

const SupplierOutsourceManager: React.FC = () => {
  const { showToast } = useToastContext();
  const [rows, setRows] = useState<SupplierOutsourceReportRow[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [workFilter, setWorkFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [showForm, setShowForm] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [participantType, setParticipantType] = useState<SupplierOutsourceType>('supplier');
  const [workType, setWorkType] = useState<SupplierOutsourceWorkType>('Driver');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [launchStatus, setLaunchStatus] = useState({ enabled: false, activeQuestionCount: 0 });

  const loadData = async () => {
    setLoading(true);
    try {
      const [report, userResponse, launch] = await Promise.all([
        api.getSupplierOutsourceReport(),
        supabase.rpc('admin_list_users'),
        api.getSupplierOutsourceLaunchStatus(),
      ]);
      setRows(report);
      setUsers(userResponse.data || []);
      setLaunchStatus(launch);
    } catch (error: any) {
      showToast('โหลดข้อมูล Supplier & Outsource ไม่สำเร็จ: ' + error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const statusOf = (row: SupplierOutsourceReportRow) => {
    if (!row.result_status) return 'READY';
    if (row.result_status === 'FAILED') return 'FAILED';
    if (!row.expiration_date || new Date(row.expiration_date) <= new Date()) return 'EXPIRED';
    if ((new Date(row.expiration_date).getTime() - Date.now()) / 86400000 < 30) return 'NEAR_EXPIRY';
    return 'PASSED';
  };
  const filteredRows = useMemo(() => rows.filter((row) => {
    const term = search.trim().toLocaleLowerCase();
    const searchable = `${row.name} ${row.company} ${row.national_id || ''}`.toLocaleLowerCase();
    return (!term || searchable.includes(term))
      && (typeFilter === 'ALL' || row.participant_type === typeFilter)
      && (workFilter === 'ALL' || row.work_type === workFilter)
      && (statusFilter === 'ALL' || statusOf(row) === statusFilter);
  }), [rows, search, typeFilter, workFilter, statusFilter]);

  const stats = useMemo(() => ({
    entitled: rows.length,
    passed: rows.filter((row) => statusOf(row) === 'PASSED' || statusOf(row) === 'NEAR_EXPIRY').length,
    failed: rows.filter((row) => statusOf(row) === 'FAILED').length,
    near: rows.filter((row) => statusOf(row) === 'NEAR_EXPIRY').length,
    expired: rows.filter((row) => statusOf(row) === 'EXPIRED').length,
    supplier: rows.filter((row) => row.participant_type === 'supplier').length,
    outsource: rows.filter((row) => row.participant_type === 'outsource').length,
    driver: rows.filter((row) => row.work_type === 'Driver').length,
    passenger: rows.filter((row) => row.work_type === 'Passenger').length,
    trainee: rows.filter((row) => row.work_type === 'Trainee').length,
  }), [rows]);

  const openForm = (row?: SupplierOutsourceReportRow) => {
    setSelectedUserId(row?.user_id || '');
    setParticipantType(row?.participant_type || 'supplier');
    setWorkType(row?.work_type || 'Driver');
    setStartDate(row?.access_start_date || '');
    setEndDate(row?.access_end_date || '');
    setShowForm(true);
  };

  const saveAccess = async () => {
    if (!selectedUserId) return showToast('กรุณาเลือกผู้ใช้', 'error');
    if (startDate && endDate && endDate < startDate) return showToast('วันที่สิ้นสุดไม่ถูกต้อง', 'error');
    setSaving(true);
    try {
      await api.adminSetSupplierOutsourceAccess({
        userId: selectedUserId, enabled: true, participantType, workType,
        accessStartDate: startDate || undefined, accessEndDate: endDate || undefined,
      });
      setShowForm(false);
      await loadData();
      showToast('บันทึกสิทธิ์เรียบร้อยแล้ว', 'success');
    } catch (error: any) {
      showToast('บันทึกไม่สำเร็จ: ' + error.message, 'error');
    } finally { setSaving(false); }
  };

  const revokeAccess = async (row: SupplierOutsourceReportRow) => {
    if (!window.confirm(`ระงับสิทธิ์ Supplier & Outsource ของ ${row.name} ใช่หรือไม่?`)) return;
    try {
      await api.adminSetSupplierOutsourceAccess({ userId: row.user_id, enabled: false });
      await loadData();
      showToast('ระงับสิทธิ์เรียบร้อยแล้ว', 'success');
    } catch (error: any) { showToast(error.message, 'error'); }
  };

  const toggleFeature = async () => {
    const nextValue = !launchStatus.enabled;
    if (nextValue && !window.confirm('เปิดใช้งาน Supplier & Outsource สำหรับผู้ใช้ทั้งหมดใช่หรือไม่?')) return;
    try {
      await api.setSupplierOutsourceFeature(nextValue);
      await loadData();
      showToast(nextValue ? 'เปิดใช้งานโปรแกรมแล้ว' : 'ปิดใช้งานโปรแกรมแล้ว', 'success');
    } catch (error: any) { showToast('เปลี่ยนสถานะไม่สำเร็จ: ' + error.message, 'error'); }
  };

  return (
    <div className="space-y-6 pb-12 text-left">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div><h2 className="text-2xl font-black uppercase text-slate-900">Supplier & Outsource</h2><p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Program Control & Reporting</p></div>
        <div className="flex gap-2">
          <button onClick={() => openForm()} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-[9px] font-black uppercase tracking-widest text-white"><Plus size={16}/> เพิ่มสิทธิ์</button>
          <button onClick={() => downloadSupplierOutsourceWorkbook(filteredRows)} className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-[9px] font-black uppercase tracking-widest text-white"><Download size={16}/> Export</button>
          <button onClick={loadData} className="rounded-xl border border-slate-200 bg-white p-3 text-slate-500"><RefreshCw size={16}/></button>
        </div>
      </div>

      <div className={`flex flex-col justify-between gap-4 rounded-2xl border p-4 sm:flex-row sm:items-center ${launchStatus.enabled ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
        <div><p className="text-[10px] font-black uppercase tracking-widest text-slate-800">Production Feature: {launchStatus.enabled ? 'ENABLED' : 'DISABLED'}</p><p className="mt-1 text-[9px] font-bold text-slate-500">คำถามที่เปิดใช้งาน {launchStatus.activeQuestionCount} ข้อ ระบบจะไม่อนุญาตให้เปิด feature หากยังไม่มีข้อสอบ</p></div>
        <button onClick={toggleFeature} className={`rounded-xl px-4 py-3 text-[9px] font-black uppercase tracking-widest text-white ${launchStatus.enabled ? 'bg-amber-600' : 'bg-emerald-600'}`}>{launchStatus.enabled ? 'ปิดโปรแกรม' : 'เปิดโปรแกรม'}</button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5 xl:grid-cols-10">
        {Object.entries(stats).map(([key, value]) => <div key={key} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"><p className="text-[8px] font-black uppercase tracking-widest text-slate-400">{key.replace('_', ' ')}</p><p className="mt-1 text-2xl font-black text-slate-900">{value}</p></div>)}
      </div>

      <div className="grid grid-cols-1 gap-2 rounded-2xl border border-slate-100 bg-white p-3 md:grid-cols-4">
        <div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อ บริษัท หรือเลขบัตร" className="w-full rounded-xl bg-slate-50 py-3 pl-9 pr-3 text-xs font-bold outline-none"/></div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-xl bg-slate-50 p-3 text-xs font-bold"><option value="ALL">ทุกประเภท</option><option value="supplier">Supplier</option><option value="outsource">Outsource</option></select>
        <select value={workFilter} onChange={(e) => setWorkFilter(e.target.value)} className="rounded-xl bg-slate-50 p-3 text-xs font-bold"><option value="ALL">ทุกลักษณะงาน</option><option>Driver</option><option>Passenger</option><option>Trainee</option></select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl bg-slate-50 p-3 text-xs font-bold"><option value="ALL">ทุกสถานะ</option><option value="READY">พร้อมสอบ</option><option value="PASSED">ผ่าน</option><option value="FAILED">ไม่ผ่าน</option><option value="NEAR_EXPIRY">ใกล้หมดอายุ</option><option value="EXPIRED">หมดอายุ</option></select>
      </div>

      <div className="overflow-hidden rounded-[2rem] border border-slate-100 bg-white shadow-sm">
        {loading ? <div className="p-20 text-center"><Loader2 className="mx-auto animate-spin text-emerald-600"/></div> : (
          <div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="bg-slate-50 text-[8px] font-black uppercase tracking-widest text-slate-400"><tr>{['Name / Company','Type','Work','Score','Test Date','Expiration','Status','Action'].map((item) => <th key={item} className="px-4 py-4">{item}</th>)}</tr></thead><tbody className="divide-y divide-slate-50">{filteredRows.map((row) => <tr key={row.user_id} className="hover:bg-slate-50/70"><td className="px-4 py-4"><p className="font-black text-slate-800">{row.name}</p><p className="mt-1 text-[9px] text-slate-400">{row.company}</p></td><td className="px-4 py-4 font-bold">{row.participant_type}</td><td className="px-4 py-4 font-bold">{row.work_type}</td><td className="px-4 py-4 font-black text-emerald-600">{row.score ?? '-'} / {row.total_questions ?? '-'}</td><td className="px-4 py-4">{row.test_date ? new Date(row.test_date).toLocaleDateString('th-TH') : '-'}</td><td className="px-4 py-4">{row.expiration_date ? new Date(row.expiration_date).toLocaleDateString('th-TH') : '-'}</td><td className="px-4 py-4"><span className="rounded-full bg-slate-100 px-2 py-1 text-[8px] font-black">{statusOf(row)}</span></td><td className="px-4 py-4"><div className="flex gap-2"><button onClick={() => openForm(row)} className="rounded-lg bg-blue-50 px-2 py-1.5 text-[8px] font-black text-blue-700">แก้ไข</button><button onClick={() => revokeAccess(row)} className="rounded-lg bg-red-50 px-2 py-1.5 text-[8px] font-black text-red-600">ระงับ</button></div></td></tr>)}</tbody></table>{filteredRows.length === 0 && <div className="p-16 text-center text-xs font-bold text-slate-400">ไม่พบข้อมูล</div>}</div>
        )}
      </div>

      {showForm && <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"><div className="w-full max-w-md rounded-[2rem] bg-white p-6"><div className="mb-5 flex justify-between"><div><h3 className="text-lg font-black uppercase">จัดการสิทธิ์</h3><p className="text-[9px] font-bold text-slate-400">Supplier & Outsource Access</p></div><button onClick={() => setShowForm(false)} className="rounded-full bg-slate-100 p-2"><X size={18}/></button></div><div className="space-y-3"><select value={selectedUserId} disabled={Boolean(rows.find((row) => row.user_id === selectedUserId))} onChange={(e) => setSelectedUserId(e.target.value)} className="w-full rounded-xl border border-slate-200 p-3 text-xs font-bold"><option value="">เลือกผู้ใช้</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name} — {user.vendors?.name || '-'}</option>)}</select><div className="grid grid-cols-2 gap-3"><select value={participantType} onChange={(e) => setParticipantType(e.target.value as SupplierOutsourceType)} className="rounded-xl border border-slate-200 p-3 text-xs font-bold"><option value="supplier">Supplier</option><option value="outsource">Outsource</option></select><select value={workType} onChange={(e) => setWorkType(e.target.value as SupplierOutsourceWorkType)} className="rounded-xl border border-slate-200 p-3 text-xs font-bold"><option>Driver</option><option>Passenger</option><option>Trainee</option></select><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-xl border border-slate-200 p-3 text-xs font-bold"/><input type="date" min={startDate || undefined} value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-xl border border-slate-200 p-3 text-xs font-bold"/></div><button onClick={saveAccess} disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-4 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin"/> : <ShieldCheck size={16}/>} บันทึกสิทธิ์</button></div></div></div>}
    </div>
  );
};

export default SupplierOutsourceManager;
