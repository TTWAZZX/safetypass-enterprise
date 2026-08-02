import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Building2, CheckCircle2, ClipboardList,
  Clock3, Loader2, Mail, RefreshCw, Search, Send, ShieldCheck, UserRound, XCircle,
} from 'lucide-react';
import { api } from '../services/supabaseApi';
import { useToastContext } from './ToastProvider';
import AsyncState from './AsyncState';
import {
  ExternalRegistrationApplicationDetail,
  ExternalRegistrationApplicationRow,
  ExternalRegistrationApplicationStatus,
  VendorStatus,
} from '../types';

const STATUS_LABELS: Record<ExternalRegistrationApplicationStatus, string> = {
  SUBMITTED: 'รอตรวจสอบ',
  UNDER_REVIEW: 'กำลังตรวจสอบ',
  NEED_MORE_INFO: 'ขอข้อมูลเพิ่ม',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่อนุมัติ',
  CANCELLED: 'ยกเลิก',
};

const TYPE_LABELS: Record<string, string> = {
  CONTRACTOR: 'Contractor',
  SUPPLIER: 'Supplier',
  OUTSOURCE: 'Outsource',
};

const STATUS_STYLES: Record<string, string> = {
  SUBMITTED: 'bg-amber-50 text-amber-700 border-amber-200',
  UNDER_REVIEW: 'bg-blue-50 text-blue-700 border-blue-200',
  NEED_MORE_INFO: 'bg-purple-50 text-purple-700 border-purple-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
  CANCELLED: 'bg-slate-100 text-slate-600 border-slate-200',
};

const ExternalRegistrationAdmin: React.FC = () => {
  const { showToast } = useToastContext();
  const [applications, setApplications] = useState<ExternalRegistrationApplicationRow[]>([]);
  const [vendors, setVendors] = useState<Array<{ id: string; name: string; status: VendorStatus }>>([]);
  const [selected, setSelected] = useState<ExternalRegistrationApplicationDetail | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [vendorChoice, setVendorChoice] = useState<'EXISTING' | 'NEW'>('NEW');
  const [vendorId, setVendorId] = useState('');
  const [newCompanyStatus, setNewCompanyStatus] = useState<'PENDING' | 'APPROVED'>('PENDING');
  const [adminNote, setAdminNote] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [rows, vendorRows] = await Promise.all([
        api.getExternalRegistrationApplications({ status: statusFilter, search }),
        api.getExternalRegistrationVendors(),
      ]);
      setApplications(rows); setVendors(vendorRows);
      if (selected) {
        const refreshed = rows.find((row) => row.id === selected.application.id);
        if (refreshed) await openApplication(refreshed.id, false);
      }
    } catch (err: any) {
      setError(err?.message || 'ไม่สามารถโหลดรายการคำขอได้');
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [statusFilter]);

  const openApplication = async (id: string, reset = true) => {
    setDetailLoading(true);
    try {
      const detail = await api.getExternalRegistrationApplication(id);
      setSelected(detail);
      if (reset) {
        setVendorId(detail.vendor?.id || '');
        setVendorChoice(detail.vendor?.id ? 'EXISTING' : 'NEW');
        setNewCompanyStatus('PENDING');
        setAdminNote(detail.application.admin_note || '');
        setRejectionReason(detail.application.rejection_reason || '');
      }
    } catch (err: any) { showToast(err?.message || 'ไม่สามารถโหลดรายละเอียดคำขอได้', 'error'); }
    finally { setDetailLoading(false); }
  };

  const canReview = selected && !['APPROVED', 'REJECTED', 'CANCELLED'].includes(selected.application.status);
  const vendorOptions = useMemo(() => vendors.filter((vendor) => vendor.status !== 'REJECTED'), [vendors]);

  const resolve = async (action: 'APPROVED' | 'REJECTED' | 'NEED_MORE_INFO' | 'UNDER_REVIEW') => {
    if (!selected) return;
    if (action === 'REJECTED' && !rejectionReason.trim()) {
      showToast('กรุณาระบุเหตุผลการไม่อนุมัติ', 'error'); return;
    }
    if (action === 'NEED_MORE_INFO' && !adminNote.trim()) {
      showToast('กรุณาระบุข้อมูลที่ต้องการให้ผู้สมัครเพิ่มเติม', 'error'); return;
    }
    if (action === 'APPROVED' && vendorChoice === 'EXISTING' && !vendorId) {
      showToast('กรุณาเลือกบริษัทเดิม หรือเลือกสร้างบริษัทใหม่', 'error'); return;
    }
    setSaving(true);
    try {
      const result = await api.resolveExternalRegistrationApplication({
        applicationId: selected.application.id,
        action,
        vendorId: action === 'APPROVED' && vendorChoice === 'EXISTING' ? vendorId : null,
        newCompanyStatus: newCompanyStatus,
        adminNote,
        rejectionReason,
      });
      if (action === 'APPROVED' || action === 'REJECTED') {
        setSendingEmail(true);
        try {
          const emailResult = await api.sendExternalRegistrationResultEmail(selected.application.id);
          if (!emailResult.success || emailResult.sent === 0) showToast('บันทึกผลแล้ว แต่ยังไม่มี Email ถูกส่งออก', 'warning');
          else showToast(`บันทึกผลและส่ง Email ให้ผู้สมัครแล้ว (${emailResult.sent} ฉบับ)`, 'success');
        } catch (emailError: any) {
          showToast(`บันทึกผลแล้ว แต่ส่ง Email ไม่สำเร็จ: ${emailError?.message || 'ตรวจสอบภายหลัง'}`, 'warning');
        } finally { setSendingEmail(false); }
      } else {
        showToast(`บันทึกสถานะ ${STATUS_LABELS[action] || action} แล้ว`, 'success');
      }
      await load();
      await openApplication(result.application_id, true);
    } catch (err: any) { showToast(err?.message || 'ไม่สามารถบันทึกผลคำขอได้', 'error'); }
    finally { setSaving(false); }
  };

  const retryEmail = async () => {
    if (!selected) return;
    setSendingEmail(true);
    try {
      const result = await api.sendExternalRegistrationResultEmail(selected.application.id);
      showToast(result.sent > 0 ? 'ส่ง Email ซ้ำเรียบร้อยแล้ว' : 'ยังไม่มี Email ที่พร้อมส่งซ้ำ', result.sent > 0 ? 'success' : 'warning');
      await openApplication(selected.application.id, false);
    } catch (err: any) { showToast(err?.message || 'ส่ง Email ซ้ำไม่สำเร็จ', 'error'); }
    finally { setSendingEmail(false); }
  };

  if (loading && applications.length === 0) return <AsyncState variant="loading" title="กำลังโหลดคำขอลงทะเบียนภายนอก" description="กำลังตรวจสอบสิทธิ์และดึงข้อมูลคำขอสำหรับ Admin" />;
  if (error && applications.length === 0) return <AsyncState variant="error" title="โหลดรายการคำขอไม่สำเร็จ" description={error} onRetry={load} />;

  return <div className="space-y-6 animate-in fade-in duration-500">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex items-start gap-3"><div className="rounded-2xl bg-blue-700 p-3 text-white shadow-lg"><ClipboardList size={24} /></div><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-700">External Registration</p><h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900">ตรวจสอบคำขอใช้งานระบบภายนอก</h2><p className="mt-1 text-xs font-bold text-slate-500">จัดการคำขอ บริษัทใหม่ และผลการอนุมัติในพื้นที่เดียว</p></div></div>
      <button onClick={load} disabled={loading} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-[10px] font-black text-slate-700 shadow-sm"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> รีเฟรช</button>
    </div>

    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {(['', 'SUBMITTED', 'NEED_MORE_INFO', 'APPROVED', 'REJECTED'] as const).map((status) => <button key={status || 'ALL'} onClick={() => setStatusFilter(status)} className={`rounded-2xl border p-4 text-left transition ${statusFilter === status ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/10' : 'border-slate-200 bg-white hover:border-blue-200'}`}><p className="text-[9px] font-black uppercase tracking-widest text-slate-500">{status ? STATUS_LABELS[status] : 'ทั้งหมด'}</p><p className="mt-1 text-xl font-black text-slate-900">{status ? applications.filter((item) => item.status === status).length : applications.length}</p></button>)}
    </div>

    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.95fr)]">
      <section className="min-w-0 rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        <div className="flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs font-bold outline-none focus:border-blue-500" placeholder="ค้นหาเลขคำขอ บริษัท หรือ Email" /></div><button onClick={load} className="min-h-11 rounded-xl bg-slate-900 px-4 text-[10px] font-black text-white">ค้นหา</button></div>
        <div className="mt-5 space-y-3">{applications.map((application) => <button key={application.id} onClick={() => openApplication(application.id)} className={`w-full rounded-2xl border p-4 text-left transition ${selected?.application.id === application.id ? 'border-blue-500 bg-blue-50/60 ring-2 ring-blue-500/10' : 'border-slate-200 bg-white hover:border-blue-300'}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-black text-slate-900">{application.request_no}</p><p className="mt-1 truncate text-xs font-bold text-slate-600">{application.company_name_submitted}</p></div><StatusBadge status={application.status} /></div><div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-bold text-slate-500"><span>{application.first_name_th} {application.last_name_th}</span><span>•</span><span>{application.login_email}</span></div><div className="mt-3 flex flex-wrap gap-1.5">{application.types.map((type) => <span key={type.type_code} className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black text-slate-600">{TYPE_LABELS[type.type_code] || type.type_code}</span>)}{application.vendor_name ? <span className="rounded-full bg-indigo-50 px-2 py-1 text-[9px] font-black text-indigo-700">บริษัท: {application.vendor_name}</span> : <span className="rounded-full bg-amber-50 px-2 py-1 text-[9px] font-black text-amber-700">บริษัทยังไม่ผูก</span>}</div></button>)}{applications.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center"><ClipboardList className="mx-auto text-slate-300" size={32} /><p className="mt-3 text-xs font-bold text-slate-500">ไม่พบคำขอตามเงื่อนไข</p></div>}</div>
      </section>

      <section className="min-w-0 rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm md:p-6">{detailLoading ? <div className="flex min-h-80 items-center justify-center gap-2 text-xs font-bold text-slate-500"><Loader2 size={18} className="animate-spin" /> กำลังโหลดรายละเอียด</div> : selected ? <DetailPanel detail={selected} canReview={Boolean(canReview)} vendors={vendorOptions} vendorChoice={vendorChoice} setVendorChoice={setVendorChoice} vendorId={vendorId} setVendorId={setVendorId} newCompanyStatus={newCompanyStatus} setNewCompanyStatus={setNewCompanyStatus} adminNote={adminNote} setAdminNote={setAdminNote} rejectionReason={rejectionReason} setRejectionReason={setRejectionReason} saving={saving || sendingEmail} onResolve={resolve} onRetryEmail={retryEmail} /> : <div className="flex min-h-80 flex-col items-center justify-center text-center"><ShieldCheck className="text-slate-300" size={40} /><p className="mt-4 text-sm font-black text-slate-700">เลือกคำขอเพื่อดูรายละเอียด</p><p className="mt-1 text-xs font-bold text-slate-500">ข้อมูลผู้สมัครและประวัติการดำเนินการจะแสดงที่นี่</p></div>}</section>
    </div>
  </div>;
};

const StatusBadge = ({ status }: { status: string }) => <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[9px] font-black ${STATUS_STYLES[status] || STATUS_STYLES.CANCELLED}`}>{STATUS_LABELS[status as ExternalRegistrationApplicationStatus] || status}</span>;

const DetailPanel = (props: {
  detail: ExternalRegistrationApplicationDetail;
  canReview: boolean;
  vendors: Array<{ id: string; name: string; status: VendorStatus }>;
  vendorChoice: 'EXISTING' | 'NEW'; setVendorChoice: (value: 'EXISTING' | 'NEW') => void;
  vendorId: string; setVendorId: (value: string) => void;
  newCompanyStatus: 'PENDING' | 'APPROVED'; setNewCompanyStatus: (value: 'PENDING' | 'APPROVED') => void;
  adminNote: string; setAdminNote: (value: string) => void;
  rejectionReason: string; setRejectionReason: (value: string) => void;
  saving: boolean; onResolve: (action: 'APPROVED' | 'REJECTED' | 'NEED_MORE_INFO' | 'UNDER_REVIEW') => void; onRetryEmail: () => void;
}) => {
  const { detail } = props;
  const application = detail.application;
  return <div className="space-y-5">
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4"><div><p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Request Detail</p><h3 className="mt-1 text-xl font-black text-slate-900">{application.request_no}</h3></div><StatusBadge status={application.status} /></div>
    <div className="grid grid-cols-2 gap-3"><Info label="บริษัทที่แจ้ง" value={application.company_name_submitted} icon={<Building2 size={14} />} /><Info label="Company Resolution" value={application.company_resolution} icon={<ShieldCheck size={14} />} /><Info label="ผู้สมัคร" value={`${application.first_name_th} ${application.last_name_th}`} icon={<UserRound size={14} />} /><Info label="ตำแหน่ง" value={application.job_title} icon={<ClipboardList size={14} />} /><Info label="Email" value={application.login_email} icon={<Mail size={14} />} /><Info label="โทรศัพท์" value={application.phone} icon={<Clock3 size={14} />} /></div>
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-[10px] font-black uppercase tracking-widest text-slate-500">ประเภทที่ขอ</p><div className="mt-2 flex flex-wrap gap-2">{detail.types.map((type) => <span key={type.type_code} className="rounded-full bg-white px-3 py-1.5 text-[10px] font-black text-slate-700">{TYPE_LABELS[type.type_code] || type.type_code} · {type.target_system}</span>)}</div><p className="mt-4 text-[10px] font-black uppercase tracking-widest text-slate-500">ผู้ประสานงาน TSH</p><div className="mt-2 space-y-1">{detail.coordinators.map((coordinator) => <p key={`${coordinator.display_order}-${coordinator.name}`} className="text-xs font-bold text-slate-700">{coordinator.name}</p>)}</div></div>
    {props.canReview ? <div className="space-y-4 rounded-2xl border border-blue-200 bg-blue-50/50 p-4"><div><p className="text-sm font-black text-slate-900">จัดการบริษัทและผลคำขอ</p><p className="mt-1 text-[10px] font-bold leading-relaxed text-slate-600">คำขอใหม่สามารถผูกกับบริษัทเดิม หรือสร้างบริษัทใหม่โดยแยกสถานะบริษัทออกจากสถานะคำขอ</p></div><div className="grid grid-cols-2 gap-2"><button onClick={() => props.setVendorChoice('EXISTING')} className={`rounded-xl border p-3 text-left text-[10px] font-black ${props.vendorChoice === 'EXISTING' ? 'border-blue-500 bg-white text-blue-700' : 'border-slate-200 bg-white text-slate-600'}`}>ใช้บริษัทเดิม</button><button onClick={() => props.setVendorChoice('NEW')} className={`rounded-xl border p-3 text-left text-[10px] font-black ${props.vendorChoice === 'NEW' ? 'border-blue-500 bg-white text-blue-700' : 'border-slate-200 bg-white text-slate-600'}`}>สร้างบริษัทใหม่</button></div>{props.vendorChoice === 'EXISTING' ? <select value={props.vendorId} onChange={(e) => props.setVendorId(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700"><option value="">-- เลือกบริษัท --</option>{props.vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name} ({vendor.status})</option>)}</select> : <label className="block text-[10px] font-black text-slate-600">สถานะบริษัทใหม่<select value={props.newCompanyStatus} onChange={(e) => props.setNewCompanyStatus(e.target.value as 'PENDING' | 'APPROVED')} className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700"><option value="PENDING">PENDING — รอตรวจสอบบริษัท</option><option value="APPROVED">APPROVED — ยืนยันบริษัทแล้ว</option></select></label>}<label className="block text-[10px] font-black text-slate-600">หมายเหตุ Admin<textarea value={props.adminNote} onChange={(e) => props.setAdminNote(e.target.value)} rows={3} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-xs font-bold text-slate-700 outline-none focus:border-blue-500" placeholder="บันทึกหมายเหตุหรือข้อมูลที่ต้องการแจ้งผู้สมัคร" /></label><label className="block text-[10px] font-black text-slate-600">เหตุผลกรณีไม่อนุมัติ<textarea value={props.rejectionReason} onChange={(e) => props.setRejectionReason(e.target.value)} rows={2} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-xs font-bold text-slate-700 outline-none focus:border-red-500" placeholder="กรอกเมื่อเลือกไม่อนุมัติ" /></label><div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><button onClick={() => props.onResolve('UNDER_REVIEW')} disabled={props.saving} className="min-h-11 rounded-xl border border-blue-200 bg-white px-3 text-[10px] font-black text-blue-700 disabled:opacity-50">บันทึกกำลังตรวจสอบ</button><button onClick={() => props.onResolve('NEED_MORE_INFO')} disabled={props.saving} className="min-h-11 rounded-xl border border-purple-200 bg-white px-3 text-[10px] font-black text-purple-700 disabled:opacity-50">ขอข้อมูลเพิ่ม</button><button onClick={() => props.onResolve('REJECTED')} disabled={props.saving} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 text-[10px] font-black text-red-700 disabled:opacity-50"><XCircle size={15} /> ไม่อนุมัติ</button><button onClick={() => props.onResolve('APPROVED')} disabled={props.saving} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-[10px] font-black text-white disabled:opacity-50"><CheckCircle2 size={15} /> อนุมัติคำขอ</button></div></div> : <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-black text-slate-700">คำขอนี้ดำเนินการแล้ว</p><p className="mt-1 text-[10px] font-bold text-slate-500">ระบบบันทึกผลและประวัติเรียบร้อยแล้ว หาก Email ไม่สำเร็จสามารถกดส่งซ้ำได้</p><button onClick={props.onRetryEmail} disabled={props.saving} className="mt-3 flex min-h-10 items-center gap-2 rounded-xl border border-blue-200 bg-white px-3 text-[10px] font-black text-blue-700 disabled:opacity-50"><Send size={14} /> ส่ง Email ผลลัพธ์ซ้ำ</button></div>}
    <div><p className="text-[10px] font-black uppercase tracking-widest text-slate-500">ประวัติการดำเนินการ</p><div className="mt-3 space-y-2">{detail.history.map((item, index) => <div key={`${item.created_at}-${index}`} className="flex gap-3 rounded-xl border border-slate-100 p-3"><div className="mt-0.5 text-blue-600"><Clock3 size={14} /></div><div><p className="text-[10px] font-black text-slate-800">{STATUS_LABELS[item.to_status as ExternalRegistrationApplicationStatus] || item.to_status}</p><p className="mt-1 text-[10px] font-bold text-slate-500">{new Date(item.created_at).toLocaleString('th-TH')}{item.note ? ` · ${item.note}` : ''}</p></div></div>)}{detail.history.length === 0 && <p className="text-xs font-bold text-slate-400">ยังไม่มีประวัติ</p>}</div></div>
    {application.status === 'APPROVED' && <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[10px] font-bold text-emerald-800"><CheckCircle2 size={15} className="shrink-0" />คำขออนุมัติแล้ว ระบบจะส่ง Email ผลการอนุมัติจาก safetytsh@gmail.com ไปยังผู้สมัคร</div>}
    {application.status === 'REJECTED' && <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-[10px] font-bold text-red-800"><AlertTriangle size={15} className="shrink-0" />คำขอไม่อนุมัติ: {application.rejection_reason || '-'}</div>}
  </div>;
};

const Info = ({ label, value, icon }: { label: string; value: string | null | undefined; icon: React.ReactNode }) => <div className="rounded-xl bg-slate-50 p-3"><div className="flex items-center gap-1.5 text-slate-500">{icon}<p className="text-[9px] font-black uppercase tracking-widest">{label}</p></div><p className="mt-1 break-words text-xs font-black text-slate-800">{value || '-'}</p></div>;

export default ExternalRegistrationAdmin;
