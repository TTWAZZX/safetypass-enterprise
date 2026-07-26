import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, Plus, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { api } from '../services/supabaseApi';
import { supabase } from '../services/supabaseClient';
import { downloadSupplierOutsourceWorkbook } from '../services/excelExport';
import { SupplierOutsourceReportRow, SupplierOutsourceType, SupplierOutsourceWorkType } from '../types';
import { useToastContext } from './ToastProvider';
import { addOneYearIsoDate, getTodayIsoDate } from '../utils/accessDates';
import AsyncState from './AsyncState';
import { useDialogFocus } from '../hooks/useDialogFocus';

interface AdminUserOption {
  id: string;
  national_id?: string | null;
  name: string;
  role?: string | null;
  is_active?: boolean | null;
  vendors?: { name?: string } | null;
}

const SupplierOutsourceManager: React.FC = () => {
  const { showToast } = useToastContext();
  const [rows, setRows] = useState<SupplierOutsourceReportRow[]>([]);
  const [users, setUsers] = useState<AdminUserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [workFilter, setWorkFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [showForm, setShowForm] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [participantType, setParticipantType] = useState<SupplierOutsourceType>('supplier');
  const [workType, setWorkType] = useState<SupplierOutsourceWorkType>('Driver');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [launchStatus, setLaunchStatus] = useState({ enabled: false, activeQuestionCount: 0 });
  const accessDialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(showForm, accessDialogRef, () => setShowForm(false));

  const loadData = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [report, userResponse, launch] = await Promise.all([
        api.getSupplierOutsourceReport(),
        supabase.rpc('admin_list_users'),
        api.getSupplierOutsourceLaunchStatus(),
      ]);
      if (userResponse.error) throw userResponse.error;
      setRows(report);
      setUsers(userResponse.data || []);
      setLaunchStatus(launch);
    } catch (error: any) {
      const message = error?.message || 'ไม่สามารถเชื่อมต่อระบบได้';
      setLoadError(message);
      showToast('โหลดข้อมูล Supplier & Outsource ไม่สำเร็จ: ' + message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);
  useEffect(() => {
    if (!showForm) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) setShowForm(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [showForm, saving]);

  const statusOf = (row: SupplierOutsourceReportRow) => {
    if (!row.result_status) return 'READY';
    if (row.result_status === 'FAILED') return 'FAILED';
    if (!row.expiration_date || new Date(row.expiration_date) <= new Date()) return 'EXPIRED';
    if ((new Date(row.expiration_date).getTime() - Date.now()) / 86400000 < 30) return 'NEAR_EXPIRY';
    return 'PASSED';
  };
  const statusLabel = (status: string) => ({
    READY: 'พร้อมสอบ',
    PASSED: 'ผ่าน',
    FAILED: 'ไม่ผ่าน',
    NEAR_EXPIRY: 'ใกล้หมดอายุ',
    EXPIRED: 'หมดอายุ',
  }[status] || status);
  const statusBadgeClass = (status: string) => ({
    READY: 'border-blue-100 bg-blue-50 text-blue-700',
    PASSED: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    FAILED: 'border-red-100 bg-red-50 text-red-700',
    NEAR_EXPIRY: 'border-amber-100 bg-amber-50 text-amber-700',
    EXPIRED: 'border-slate-200 bg-slate-100 text-slate-600',
  }[status] || 'border-slate-200 bg-slate-100 text-slate-600');
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

  const selectableUsers = useMemo(() => users.filter((user) => {
    if (user.role === 'ADMIN' || user.is_active === false) return false;
    const term = userSearch.trim().toLocaleLowerCase();
    const searchable = `${user.name} ${user.vendors?.name || ''} ${user.national_id || ''}`.toLocaleLowerCase();
    return !term || searchable.includes(term);
  }), [users, userSearch]);

  const allVisibleSelected = selectableUsers.length > 0
    && selectableUsers.every((user) => selectedUserIds.includes(user.id));

  const openForm = (row?: SupplierOutsourceReportRow) => {
    const today = getTodayIsoDate();
    setEditingUserId(row?.user_id || null);
    setSelectedUserIds(row ? [row.user_id] : []);
    setUserSearch('');
    setParticipantType(row?.participant_type || 'supplier');
    setWorkType(row?.work_type || 'Driver');
    setStartDate(row?.access_start_date || today);
    setEndDate(row?.access_end_date || addOneYearIsoDate(today));
    setShowForm(true);
  };

  const saveAccess = async () => {
    if (selectedUserIds.length === 0) return showToast('กรุณาเลือกผู้ใช้อย่างน้อย 1 คน', 'error');
    if (startDate && endDate && endDate < startDate) return showToast('วันที่สิ้นสุดไม่ถูกต้อง', 'error');
    const activePassCount = rows.filter((row) => selectedUserIds.includes(row.user_id)
      && row.verification_token && row.expiration_date && new Date(row.expiration_date) > new Date()).length;
    if (activePassCount > 0 && !window.confirm(
      `ผู้ใช้ที่เลือก ${activePassCount} คนมีบัตรที่ยังใช้งานอยู่ การเปลี่ยนสิทธิ์จะยกเลิกบัตรเดิมและต้องสอบใหม่ ต้องการดำเนินการต่อหรือไม่?`
    )) return;
    setSaving(true);
    try {
      await api.adminSetSupplierOutsourceAccessBulk({
        userIds: selectedUserIds, participantType, workType,
        accessStartDate: startDate || undefined, accessEndDate: endDate || undefined,
      });
      setShowForm(false);
      await loadData();
      showToast(`บันทึกสิทธิ์ผู้ใช้ ${selectedUserIds.length} คนเรียบร้อยแล้ว`, 'success');
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
    if (nextValue && launchStatus.activeQuestionCount < 20) {
      showToast('ยังเปิดโปรแกรมไม่ได้ กรุณาเพิ่มข้อสอบที่เปิดใช้งานให้ครบอย่างน้อย 20 ข้อ', 'error');
      return;
    }
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
        <div className="flex flex-wrap gap-2">
          <button onClick={() => openForm()} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-[9px] font-black uppercase tracking-widest text-white sm:flex-none"><Plus size={16}/> เพิ่มสิทธิ์</button>
          <button onClick={() => downloadSupplierOutsourceWorkbook(filteredRows)} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-[9px] font-black uppercase tracking-widest text-white sm:flex-none"><Download size={16}/> Export</button>
          <button onClick={loadData} disabled={loading} aria-label="รีเฟรชข้อมูล Supplier & Outsource" className="min-h-11 min-w-11 rounded-xl border border-slate-200 bg-white p-3 text-slate-500 disabled:opacity-50"><RefreshCw size={16} className={loading ? 'animate-spin' : ''}/></button>
        </div>
      </div>

      <div className={`flex flex-col justify-between gap-4 rounded-2xl border p-4 sm:flex-row sm:items-center ${launchStatus.enabled ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
        <div><p className="text-[10px] font-black uppercase tracking-widest text-slate-800">Production Feature: {launchStatus.enabled ? 'ENABLED' : 'DISABLED'}</p><p className="mt-1 text-[9px] font-bold text-slate-500">คำถามที่เปิดใช้งาน {launchStatus.activeQuestionCount} ข้อ ระบบใช้ข้อสอบจริง 20 ข้อต่อครั้ง และต้องมีอย่างน้อย 20 ข้อจึงจะเปิดโปรแกรมได้</p></div>
        <button onClick={toggleFeature} disabled={!launchStatus.enabled && launchStatus.activeQuestionCount < 20} className={`min-h-11 rounded-xl px-4 py-3 text-[9px] font-black uppercase tracking-widest text-white disabled:cursor-not-allowed disabled:bg-slate-400 ${launchStatus.enabled ? 'bg-amber-600' : 'bg-emerald-600'}`}>{launchStatus.enabled ? 'ปิดโปรแกรม' : 'เปิดโปรแกรม'}</button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5 xl:grid-cols-10">
        {Object.entries(stats).map(([key, value]) => <div key={key} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"><p className="text-[8px] font-black uppercase tracking-widest text-slate-400">{key.replace('_', ' ')}</p><p className="mt-1 text-2xl font-black text-slate-900">{value}</p></div>)}
      </div>

      <div className="grid grid-cols-1 gap-2 rounded-2xl border border-slate-100 bg-white p-3 md:grid-cols-4">
        <div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input aria-label="ค้นหาชื่อ บริษัท หรือเลขบัตร" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อ บริษัท หรือเลขบัตร" className="w-full rounded-xl bg-slate-50 py-3 pl-9 pr-3 text-xs font-bold outline-none"/></div>
        <select aria-label="กรองประเภทผู้ใช้" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-xl bg-slate-50 p-3 text-xs font-bold"><option value="ALL">ทุกประเภท</option><option value="supplier">Supplier</option><option value="outsource">Outsource</option></select>
        <select aria-label="กรองลักษณะงาน" value={workFilter} onChange={(e) => setWorkFilter(e.target.value)} className="rounded-xl bg-slate-50 p-3 text-xs font-bold"><option value="ALL">ทุกลักษณะงาน</option><option>Driver</option><option>Passenger</option><option>Trainee</option></select>
        <select aria-label="กรองสถานะ" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl bg-slate-50 p-3 text-xs font-bold"><option value="ALL">ทุกสถานะ</option><option value="READY">พร้อมสอบ</option><option value="PASSED">ผ่าน</option><option value="FAILED">ไม่ผ่าน</option><option value="NEAR_EXPIRY">ใกล้หมดอายุ</option><option value="EXPIRED">หมดอายุ</option></select>
      </div>

      <div className="overflow-hidden rounded-[2rem] border border-slate-100 bg-white shadow-sm">
        {loading ? <AsyncState compact variant="loading" title="กำลังโหลดข้อมูล Supplier & Outsource" /> : loadError ? <AsyncState compact variant="error" title="โหลดข้อมูล Supplier & Outsource ไม่สำเร็จ" description={loadError} onRetry={loadData} /> : (
          <>
            {filteredRows.length === 0 ? <AsyncState compact variant="empty" title="ไม่พบข้อมูล Supplier & Outsource" description={search || typeFilter !== 'ALL' || workFilter !== 'ALL' || statusFilter !== 'ALL' ? 'ลองล้างคำค้นหาหรือตัวกรองแล้วค้นหาอีกครั้ง' : 'เพิ่มสิทธิ์ผู้ใช้เพื่อเริ่มต้นใช้งานโปรแกรม'} /> : (
              <>
                <div className="grid gap-3 p-3 sm:grid-cols-2 xl:hidden">
                  {filteredRows.map((row) => {
                    const rowStatus = statusOf(row);
                    return (
                      <article key={row.user_id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm" aria-label={`สิทธิ์ Supplier & Outsource ของ ${row.name}`}>
                        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                          <div className="min-w-0"><h3 className="truncate text-sm font-black text-slate-900">{row.name}</h3><p className="mt-1 truncate text-[9px] font-bold text-slate-400">{row.company || 'ไม่มีสังกัด'}</p></div>
                          <span className={`shrink-0 rounded-xl border px-2.5 py-1.5 text-[8px] font-black ${statusBadgeClass(rowStatus)}`}>{statusLabel(rowStatus)}</span>
                        </div>
                        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-[10px]">
                          <div><dt className="font-black text-slate-400">ประเภทผู้ใช้</dt><dd className="mt-1 font-bold capitalize text-slate-700">{row.participant_type || '-'}</dd></div>
                          <div><dt className="font-black text-slate-400">ลักษณะงาน</dt><dd className="mt-1 font-bold text-slate-700">{row.work_type || '-'}</dd></div>
                          <div><dt className="font-black text-slate-400">คะแนน</dt><dd className="mt-1 text-sm font-black text-emerald-600">{row.score ?? '-'} / {row.total_questions ?? '-'}</dd></div>
                          <div><dt className="font-black text-slate-400">วันที่สอบ</dt><dd className="mt-1 font-bold text-slate-700">{row.test_date ? new Date(row.test_date).toLocaleDateString('th-TH') : '-'}</dd></div>
                          <div className="col-span-2"><dt className="font-black text-slate-400">วันหมดอายุ</dt><dd className="mt-1 font-bold text-slate-700">{row.expiration_date ? new Date(row.expiration_date).toLocaleDateString('th-TH') : '-'}</dd></div>
                        </dl>
                        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
                          <button onClick={() => openForm(row)} className="min-h-11 rounded-xl bg-blue-50 px-3 text-[10px] font-black text-blue-700">แก้ไขสิทธิ์</button>
                          <button onClick={() => revokeAccess(row)} className="min-h-11 rounded-xl bg-red-50 px-3 text-[10px] font-black text-red-600">ระงับสิทธิ์</button>
                        </div>
                      </article>
                    );
                  })}
                </div>
                <div className="hidden overflow-x-auto xl:block">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-slate-50 text-[8px] font-black uppercase tracking-widest text-slate-400"><tr>{['Name / Company','Type','Work','Score','Test Date','Expiration','Status','Action'].map((item) => <th key={item} className="px-4 py-4">{item}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-50">{filteredRows.map((row) => { const rowStatus = statusOf(row); return <tr key={row.user_id} className="hover:bg-slate-50/70"><td className="px-4 py-4"><p className="font-black text-slate-800">{row.name}</p><p className="mt-1 text-[9px] text-slate-400">{row.company}</p></td><td className="px-4 py-4 font-bold">{row.participant_type}</td><td className="px-4 py-4 font-bold">{row.work_type}</td><td className="px-4 py-4 font-black text-emerald-600">{row.score ?? '-'} / {row.total_questions ?? '-'}</td><td className="px-4 py-4">{row.test_date ? new Date(row.test_date).toLocaleDateString('th-TH') : '-'}</td><td className="px-4 py-4">{row.expiration_date ? new Date(row.expiration_date).toLocaleDateString('th-TH') : '-'}</td><td className="px-4 py-4"><span className={`rounded-full border px-2 py-1 text-[8px] font-black ${statusBadgeClass(rowStatus)}`}>{statusLabel(rowStatus)}</span></td><td className="px-4 py-4"><div className="flex gap-2"><button onClick={() => openForm(row)} className="min-h-11 rounded-lg bg-blue-50 px-3 text-[8px] font-black text-blue-700">แก้ไข</button><button onClick={() => revokeAccess(row)} className="min-h-11 rounded-lg bg-red-50 px-3 text-[8px] font-black text-red-600">ระงับ</button></div></td></tr>; })}</tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {showForm && <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"><div ref={accessDialogRef} role="dialog" aria-modal="true" aria-labelledby="supplier-access-dialog-title" tabIndex={-1} className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-[2rem] bg-white p-6 focus:outline-none"><div className="mb-5 flex justify-between"><div><h3 id="supplier-access-dialog-title" className="text-lg font-black uppercase">จัดการสิทธิ์</h3><p className="text-[9px] font-bold text-slate-600">Supplier & Outsource Access</p></div><button aria-label="ปิดหน้าต่างจัดการสิทธิ์" onClick={() => setShowForm(false)} className="min-h-11 min-w-11 rounded-full bg-slate-100 p-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"><X size={18}/></button></div><div className="space-y-3">
        {editingUserId ? <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-bold">{users.find((user) => user.id === editingUserId)?.name || 'ผู้ใช้'} — {users.find((user) => user.id === editingUserId)?.vendors?.name || '-'}</div> : <div className="rounded-xl border border-slate-200 p-3"><div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input aria-label="ค้นหาผู้ใช้" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="พิมพ์ชื่อ บริษัท หรือเลขบัตร" className="w-full rounded-lg bg-slate-50 py-3 pl-9 pr-3 text-xs font-bold outline-none"/></div><label className="mt-3 flex cursor-pointer items-center gap-2 border-b border-slate-100 pb-3 text-[10px] font-black text-emerald-700"><input type="checkbox" checked={allVisibleSelected} onChange={() => setSelectedUserIds(allVisibleSelected ? selectedUserIds.filter((id) => !selectableUsers.some((user) => user.id === id)) : Array.from(new Set([...selectedUserIds, ...selectableUsers.map((user) => user.id)])))} /> เลือกทั้งหมดที่แสดง ({selectableUsers.length} คน)</label><div className="mt-2 max-h-44 space-y-1 overflow-y-auto">{selectableUsers.map((user) => <label key={user.id} className="flex cursor-pointer items-start gap-2 rounded-lg p-2 hover:bg-slate-50"><input className="mt-0.5" type="checkbox" checked={selectedUserIds.includes(user.id)} onChange={() => setSelectedUserIds((current) => current.includes(user.id) ? current.filter((id) => id !== user.id) : [...current, user.id])}/><span className="text-[10px] font-bold text-slate-700">{user.name}<span className="block text-[9px] font-medium text-slate-400">{user.vendors?.name || '-'}{user.national_id ? ` • ${user.national_id}` : ''}</span></span></label>)}{selectableUsers.length === 0 && <p className="py-4 text-center text-[10px] font-bold text-slate-400">ไม่พบผู้ใช้</p>}</div><p className="mt-2 text-[9px] font-bold text-slate-500">เลือกแล้ว {selectedUserIds.length} คน</p></div>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><select aria-label="ประเภทผู้ใช้" value={participantType} onChange={(e) => setParticipantType(e.target.value as SupplierOutsourceType)} className="rounded-xl border border-slate-200 p-3 text-xs font-bold"><option value="supplier">Supplier</option><option value="outsource">Outsource</option></select><select aria-label="ลักษณะงาน" value={workType} onChange={(e) => setWorkType(e.target.value as SupplierOutsourceWorkType)} className="rounded-xl border border-slate-200 p-3 text-xs font-bold"><option>Driver</option><option>Passenger</option><option>Trainee</option></select><input aria-label="วันที่เริ่มสิทธิ์" type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setEndDate(addOneYearIsoDate(e.target.value)); }} className="rounded-xl border border-slate-200 p-3 text-xs font-bold"/><input aria-label="วันที่สิ้นสุดสิทธิ์" type="date" min={startDate || undefined} value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-xl border border-slate-200 p-3 text-xs font-bold"/></div><button onClick={saveAccess} disabled={saving || selectedUserIds.length === 0} aria-describedby={selectedUserIds.length === 0 ? 'supplier-access-disabled-reason' : undefined} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-4 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin"/> : <ShieldCheck size={16}/>} บันทึกสิทธิ์ {selectedUserIds.length > 1 ? `${selectedUserIds.length} คน` : ''}</button>{selectedUserIds.length === 0 && <p id="supplier-access-disabled-reason" className="text-center text-[9px] font-bold text-amber-700" role="status">เลือกผู้ใช้อย่างน้อย 1 คนก่อนบันทึกสิทธิ์</p>}</div></div></div>}
    </div>
  );
};

export default SupplierOutsourceManager;
