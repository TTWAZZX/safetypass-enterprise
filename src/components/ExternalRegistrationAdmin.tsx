import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Building2, CalendarDays, CheckCircle2, ChevronRight,
  ClipboardList, Clock3, Loader2, Mail, Phone, RefreshCw, Search,
  Send, ShieldCheck, UserRound, X, XCircle,
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

const FILTER_STATUSES: Array<'' | ExternalRegistrationApplicationStatus> = [
  '', 'SUBMITTED', 'UNDER_REVIEW', 'NEED_MORE_INFO', 'APPROVED', 'REJECTED',
];

type ResolveAction = 'APPROVED' | 'REJECTED' | 'NEED_MORE_INFO' | 'UNDER_REVIEW';
type ConfirmationRequest =
  | { kind: 'RESOLVE'; action: ResolveAction }
  | { kind: 'RETRY_EMAIL' };

const ACTION_LABELS: Record<ResolveAction, string> = {
  APPROVED: 'อนุมัติคำขอและส่ง Email',
  REJECTED: 'ไม่อนุมัติคำขอ',
  NEED_MORE_INFO: 'ส่งคำขอข้อมูลเพิ่มเติม',
  UNDER_REVIEW: 'บันทึกสถานะกำลังตรวจสอบ',
};

const ExternalRegistrationAdmin: React.FC = () => {
  const { showToast } = useToastContext();
  const [applications, setApplications] = useState<ExternalRegistrationApplicationRow[]>([]);
  const [vendors, setVendors] = useState<Array<{ id: string; name: string; status: VendorStatus }>>([]);
  const [selected, setSelected] = useState<ExternalRegistrationApplicationDetail | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | ExternalRegistrationApplicationStatus>('');
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

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !confirmation) setDrawerOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [drawerOpen, confirmation]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [drawerOpen]);

  const openApplication = async (id: string, reset = true) => {
    setDrawerOpen(true);
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

  const closeDrawer = () => {
    if (saving || sendingEmail) return;
    setDrawerOpen(false);
  };

  const canReview = selected && !['APPROVED', 'REJECTED', 'CANCELLED'].includes(selected.application.status);
  const vendorOptions = useMemo(() => vendors.filter((vendor) => vendor.status !== 'REJECTED'), [vendors]);

  const requestResolve = (action: ResolveAction) => {
    if (!selected) return;
    if (action === 'REJECTED' && !rejectionReason.trim()) {
      showToast('กรุณาระบุเหตุผลการไม่อนุมัติก่อนดำเนินการ', 'error'); return;
    }
    if (action === 'NEED_MORE_INFO' && !adminNote.trim()) {
      showToast('กรุณาระบุข้อมูลที่ต้องการให้ผู้สมัครเพิ่มเติม', 'error'); return;
    }
    if (action === 'APPROVED' && vendorChoice === 'EXISTING' && !vendorId) {
      showToast('กรุณาเลือกบริษัทเดิม หรือเลือกสร้างบริษัทใหม่', 'error'); return;
    }
    setConfirmation({ kind: 'RESOLVE', action });
  };

  const resolve = async (action: ResolveAction) => {
    if (!selected) return;
    setSaving(true);
    try {
      const result = await api.resolveExternalRegistrationApplication({
        applicationId: selected.application.id,
        action,
        vendorId: action === 'APPROVED' && vendorChoice === 'EXISTING' ? vendorId : null,
        newCompanyStatus,
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

  const confirmAction = async () => {
    if (!confirmation) return;
    const nextAction = confirmation;
    setConfirmation(null);
    if (nextAction.kind === 'RETRY_EMAIL') await retryEmail();
    else await resolve(nextAction.action);
  };

  if (loading && applications.length === 0) return <AsyncState variant="loading" title="กำลังโหลดคำขอลงทะเบียนภายนอก" description="กำลังตรวจสอบสิทธิ์และดึงข้อมูลคำขอสำหรับ Admin" />;
  if (error && applications.length === 0) return <AsyncState variant="error" title="โหลดรายการคำขอไม่สำเร็จ" description={error} onRetry={load} />;

  return <div className="space-y-6 animate-in fade-in duration-500">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex items-start gap-3"><div className="rounded-2xl bg-blue-700 p-3 text-white shadow-lg"><ClipboardList size={24} /></div><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-700">External Registration</p><h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900">คำขอลงทะเบียนใช้งานระบบภายนอก</h2><p className="mt-1 text-xs font-bold text-slate-500">เลือกคำขอเพื่อเปิดรายละเอียด ตรวจสอบบริษัท และดำเนินการ</p></div></div>
      <button onClick={load} disabled={loading} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-[10px] font-black text-slate-700 shadow-sm"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> รีเฟรชรายการ</button>
    </div>

    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {FILTER_STATUSES.map((status) => <button key={status || 'ALL'} onClick={() => setStatusFilter(status)} aria-pressed={statusFilter === status} className={`rounded-2xl border p-4 text-left transition ${statusFilter === status ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/10' : 'border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/30'}`}><p className="text-[9px] font-black uppercase tracking-widest text-slate-500">{status ? STATUS_LABELS[status] : 'ทั้งหมด'}</p><p className="mt-1 text-xl font-black text-slate-900">{status ? applications.filter((item) => item.status === status).length : applications.length}</p><p className="mt-1 text-[9px] font-bold text-slate-400">คลิกเพื่อกรอง</p></button>)}
    </div>

    <section className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm md:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><h3 className="text-sm font-black text-slate-900">รายการคำขอ</h3><p className="mt-1 text-[10px] font-bold text-slate-500">พบ {applications.length} รายการ · คลิกรายการเพื่อเปิดหน้าตรวจสอบ</p></div><form className="flex w-full gap-2 lg:max-w-xl" onSubmit={(event) => { event.preventDefault(); void load(); }}><div className="relative flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs font-bold outline-none focus:border-blue-500 focus:bg-white" placeholder="ค้นหาเลขคำขอ บริษัท หรือ Email" aria-label="ค้นหาเลขคำขอ บริษัท หรือ Email" /></div><button type="submit" className="min-h-11 rounded-xl bg-slate-900 px-5 text-[10px] font-black text-white hover:bg-slate-700">ค้นหา</button></form></div>
      <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">{applications.map((application) => <RequestCard key={application.id} application={application} selected={selected?.application.id === application.id && drawerOpen} onOpen={() => { void openApplication(application.id); }} />)}{applications.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center lg:col-span-2"><ClipboardList className="mx-auto text-slate-300" size={32} /><p className="mt-3 text-xs font-bold text-slate-500">ไม่พบคำขอตามเงื่อนไข</p><p className="mt-1 text-[10px] font-bold text-slate-400">ลองเปลี่ยนตัวกรองหรือคำค้นหา</p></div>}</div>
    </section>

    {drawerOpen && <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm md:p-8" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDrawer(); }}><aside className="flex h-[88vh] max-h-[900px] w-full max-w-3xl flex-col overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl ring-1 ring-black/10" role="dialog" aria-modal="true" aria-labelledby="external-request-drawer-title"><div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 md:px-7"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-700">ตรวจสอบคำขอ</p><h2 id="external-request-drawer-title" className="mt-1 text-lg font-black text-slate-900">รายละเอียดคำขอ</h2><p className="mt-1 text-[10px] font-bold text-slate-500">หน้าต่างตรวจสอบคำขอ · กด Esc หรือปุ่มปิดเพื่อออก</p></div><button type="button" onClick={closeDrawer} disabled={saving || sendingEmail} aria-label="ปิดรายละเอียดคำขอ" className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"><X size={20} /></button></div><div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{detailLoading || !selected ? <div className="flex min-h-80 items-center justify-center gap-2 text-xs font-bold text-slate-500"><Loader2 size={18} className="animate-spin" /> กำลังโหลดรายละเอียดคำขอ</div> : <DetailPanel detail={selected} canReview={Boolean(canReview)} vendors={vendorOptions} vendorChoice={vendorChoice} setVendorChoice={setVendorChoice} vendorId={vendorId} setVendorId={setVendorId} newCompanyStatus={newCompanyStatus} setNewCompanyStatus={setNewCompanyStatus} adminNote={adminNote} setAdminNote={setAdminNote} rejectionReason={rejectionReason} setRejectionReason={setRejectionReason} saving={saving || sendingEmail} onRequestResolve={requestResolve} onRequestRetryEmail={() => setConfirmation({ kind: 'RETRY_EMAIL' })} />}</div></aside></div>}
    {confirmation && selected && <ConfirmationDialog request={confirmation} application={selected.application} vendorChoice={vendorChoice} vendorName={vendorOptions.find((vendor) => vendor.id === vendorId)?.name || ''} newCompanyStatus={newCompanyStatus} rejectionReason={rejectionReason} saving={saving || sendingEmail} onCancel={() => setConfirmation(null)} onConfirm={confirmAction} />}
  </div>;
};

const RequestCard = ({ application, selected, onOpen }: { application: ExternalRegistrationApplicationRow; selected: boolean; onOpen: () => void }) => <button type="button" onClick={onOpen} aria-label={`${application.request_no} ${application.company_name_submitted} ${STATUS_LABELS[application.status]}`} className={`group w-full rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md ${selected ? 'border-blue-500 bg-blue-50/70 ring-2 ring-blue-500/15' : 'border-slate-200 bg-white'}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-black text-slate-900">{application.request_no}</p><StatusBadge status={application.status} /></div><p className="mt-2 truncate text-xs font-bold text-slate-700">{application.company_name_submitted}</p></div><ChevronRight size={18} className="mt-1 shrink-0 text-slate-300 transition group-hover:translate-x-1 group-hover:text-blue-600" /></div><div className="mt-3 grid grid-cols-1 gap-1 text-[10px] font-bold text-slate-500 sm:grid-cols-2"><span className="flex items-center gap-1.5"><UserRound size={13} className="text-slate-400" />{application.first_name_th} {application.last_name_th}</span><span className="flex items-center gap-1.5 truncate"><Mail size={13} className="text-slate-400" />{application.login_email}</span><span className="flex items-center gap-1.5"><CalendarDays size={13} className="text-slate-400" />ส่งเมื่อ {new Date(application.submitted_at).toLocaleDateString('th-TH')}</span></div><div className="mt-3 flex flex-wrap gap-1.5">{application.types.map((type) => <span key={type.type_code} className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black text-slate-600">{TYPE_LABELS[type.type_code] || type.type_code}</span>)}{application.vendor_name ? <span className="rounded-full bg-indigo-50 px-2 py-1 text-[9px] font-black text-indigo-700">ผูกบริษัทแล้ว</span> : <span className="rounded-full bg-amber-50 px-2 py-1 text-[9px] font-black text-amber-700">รอจัดการบริษัท</span>}</div><p className="mt-3 text-[10px] font-black text-blue-700">คลิกเพื่อเปิดรายละเอียดและดำเนินการ</p></button>;

const DetailPanel = (props: {
  detail: ExternalRegistrationApplicationDetail;
  canReview: boolean;
  vendors: Array<{ id: string; name: string; status: VendorStatus }>;
  vendorChoice: 'EXISTING' | 'NEW'; setVendorChoice: (value: 'EXISTING' | 'NEW') => void;
  vendorId: string; setVendorId: (value: string) => void;
  newCompanyStatus: 'PENDING' | 'APPROVED'; setNewCompanyStatus: (value: 'PENDING' | 'APPROVED') => void;
  adminNote: string; setAdminNote: (value: string) => void;
  rejectionReason: string; setRejectionReason: (value: string) => void;
  saving: boolean; onRequestResolve: (action: ResolveAction) => void; onRequestRetryEmail: () => void;
}) => {
  const { detail } = props;
  const application = detail.application;
  return <div className="space-y-6 p-5 pb-8 md:p-7">
    <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Request Detail</p><h3 className="mt-1 text-2xl font-black text-slate-900">{application.request_no}</h3><p className="mt-1 text-[10px] font-bold text-slate-500">ส่งคำขอเมื่อ {new Date(application.submitted_at).toLocaleString('th-TH')}</p></div><StatusBadge status={application.status} /></div>
    <div className="grid grid-cols-3 gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-center"><Step label="1 ตรวจข้อมูล" active /><Step label="2 จัดการบริษัท" active={Boolean(application.vendor_id) || props.canReview} /><Step label="3 ตัดสินใจ" active={application.status !== 'SUBMITTED' && application.status !== 'UNDER_REVIEW'} /></div>

    <section><SectionHeading icon={<Building2 size={15} />} title="ข้อมูลบริษัทและคำขอ" /><div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"><Info label="บริษัทที่แจ้ง" value={application.company_name_submitted} icon={<Building2 size={14} />} /><Info label="สถานะบริษัท" value={application.company_resolution} icon={<ShieldCheck size={14} />} /><Info label="ประเภทที่ขอ" value={detail.types.map((type) => TYPE_LABELS[type.type_code] || type.type_code).join(', ')} icon={<ClipboardList size={14} />} /><Info label="ระบบปลายทาง" value={detail.types.map((type) => type.target_system).filter((value, index, values) => values.indexOf(value) === index).join(', ')} icon={<ChevronRight size={14} />} /></div></section>

    <section><SectionHeading icon={<UserRound size={15} />} title="ข้อมูลผู้สมัคร" /><div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"><Info label="ชื่อภาษาไทย" value={`${application.first_name_th} ${application.last_name_th}`} icon={<UserRound size={14} />} /><Info label="ชื่อภาษาอังกฤษ" value={`${application.first_name_en} ${application.last_name_en}`} icon={<UserRound size={14} />} /><Info label="ตำแหน่ง" value={application.job_title} icon={<ClipboardList size={14} />} /><Info label="Email สำหรับ Login" value={application.login_email} icon={<Mail size={14} />} /><Info label="เบอร์โทรติดต่อ" value={application.phone} icon={<Phone size={14} />} /><Info label="ผู้ประสานงาน TSH" value={detail.coordinators.map((coordinator) => coordinator.name).join(', ')} icon={<UserRound size={14} />} /></div></section>

    {props.canReview ? <section className="space-y-4 rounded-2xl border border-blue-200 bg-blue-50/60 p-4"><div><SectionHeading icon={<ShieldCheck size={15} />} title="จัดการบริษัทและผลคำขอ" /><p className="mt-2 text-[10px] font-bold leading-relaxed text-slate-600">ตรวจสอบข้อมูลด้านบนก่อนเลือกบริษัทและผลคำขอ เมื่อกดยืนยัน ระบบจะบันทึกประวัติให้ Admin อัตโนมัติ</p></div><div className="grid grid-cols-2 gap-2" role="group" aria-label="รูปแบบการจัดการบริษัท"><button type="button" onClick={() => props.setVendorChoice('EXISTING')} className={`rounded-xl border p-3 text-left text-[10px] font-black transition ${props.vendorChoice === 'EXISTING' ? 'border-blue-500 bg-white text-blue-700 ring-2 ring-blue-500/10' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300'}`}>ใช้บริษัทเดิม<p className="mt-1 text-[9px] font-bold text-slate-400">เลือกจากรายชื่อบริษัทที่มีอยู่</p></button><button type="button" onClick={() => props.setVendorChoice('NEW')} className={`rounded-xl border p-3 text-left text-[10px] font-black transition ${props.vendorChoice === 'NEW' ? 'border-blue-500 bg-white text-blue-700 ring-2 ring-blue-500/10' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300'}`}>สร้างบริษัทใหม่<p className="mt-1 text-[9px] font-bold text-slate-400">ใช้เมื่อไม่พบบริษัทในระบบ</p></button></div>{props.vendorChoice === 'EXISTING' ? <label className="block text-[10px] font-black text-slate-600">บริษัทเดิม<select value={props.vendorId} onChange={(e) => props.setVendorId(e.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-blue-500"><option value="">-- เลือกบริษัท --</option>{props.vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name} ({vendor.status})</option>)}</select></label> : <label className="block text-[10px] font-black text-slate-600">สถานะบริษัทใหม่<select value={props.newCompanyStatus} onChange={(e) => props.setNewCompanyStatus(e.target.value as 'PENDING' | 'APPROVED')} className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-blue-500"><option value="PENDING">PENDING — รอตรวจสอบบริษัท</option><option value="APPROVED">APPROVED — ยืนยันบริษัทแล้ว</option></select></label>}<label className="block text-[10px] font-black text-slate-600">หมายเหตุ Admin<p className="mt-1 text-[9px] font-bold text-slate-400">ใช้บันทึกข้อมูลที่แจ้งผู้สมัครหรือเหตุผลประกอบการพิจารณา</p><textarea value={props.adminNote} onChange={(e) => props.setAdminNote(e.target.value)} rows={3} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-xs font-bold text-slate-700 outline-none focus:border-blue-500" placeholder="พิมพ์หมายเหตุ (ถ้ามี)" /></label><label className="block text-[10px] font-black text-slate-600">เหตุผลกรณีไม่อนุมัติ<p className="mt-1 text-[9px] font-bold text-slate-400">ต้องกรอกทุกครั้งก่อนเลือกไม่อนุมัติ</p><textarea value={props.rejectionReason} onChange={(e) => props.setRejectionReason(e.target.value)} rows={3} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-xs font-bold text-slate-700 outline-none focus:border-red-500" placeholder="พิมพ์เหตุผลการไม่อนุมัติ" /></label><div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><ActionButton variant="neutral" onClick={() => props.onRequestResolve('UNDER_REVIEW')} disabled={props.saving}>บันทึกสถานะกำลังตรวจสอบ</ActionButton><ActionButton variant="purple" onClick={() => props.onRequestResolve('NEED_MORE_INFO')} disabled={props.saving}>ส่งคำขอข้อมูลเพิ่มเติม</ActionButton><ActionButton variant="danger" icon={<XCircle size={15} />} onClick={() => props.onRequestResolve('REJECTED')} disabled={props.saving}>ไม่อนุมัติคำขอ</ActionButton><ActionButton variant="success" icon={<CheckCircle2 size={15} />} onClick={() => props.onRequestResolve('APPROVED')} disabled={props.saving}>อนุมัติคำขอและส่ง Email</ActionButton></div><p className="text-center text-[9px] font-bold text-slate-500">ระบบจะแสดงหน้าต่างยืนยันก่อนบันทึกผลทุกครั้ง</p></section> : <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-start gap-3"><CheckCircle2 size={18} className={application.status === 'APPROVED' ? 'text-emerald-600' : 'text-red-600'} /><div><p className="text-sm font-black text-slate-700">คำขอนี้ดำเนินการแล้ว</p><p className="mt-1 text-[10px] font-bold leading-relaxed text-slate-500">ระบบบันทึกผลและประวัติเรียบร้อยแล้ว หากผู้สมัครไม่ได้รับ Email สามารถส่งซ้ำได้</p></div></div><button type="button" onClick={props.onRequestRetryEmail} disabled={props.saving} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-3 text-[10px] font-black text-blue-700 hover:bg-blue-50 disabled:opacity-50"><Send size={14} /> ส่ง Email ผลลัพธ์ซ้ำ</button></section>}

    <section><SectionHeading icon={<Clock3 size={15} />} title="ประวัติการดำเนินการ" /><div className="mt-3 space-y-2">{detail.history.map((item, index) => <div key={`${item.created_at}-${index}`} className="flex gap-3 rounded-xl border border-slate-100 bg-white p-3"><div className="mt-0.5 text-blue-600"><Clock3 size={14} /></div><div className="min-w-0"><p className="text-[10px] font-black text-slate-800">{STATUS_LABELS[item.to_status as ExternalRegistrationApplicationStatus] || item.to_status}</p><p className="mt-1 text-[10px] font-bold text-slate-500">{new Date(item.created_at).toLocaleString('th-TH')}{item.note ? ` · ${item.note}` : ''}</p></div></div>)}{detail.history.length === 0 && <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs font-bold text-slate-400">ยังไม่มีประวัติ</p>}</div></section>
    {application.status === 'APPROVED' && <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[10px] font-bold leading-relaxed text-emerald-800"><CheckCircle2 size={15} className="mt-0.5 shrink-0" />คำขออนุมัติแล้ว ระบบส่ง Email ผลการอนุมัติจาก safetytsh@gmail.com ไปยังผู้สมัครแล้ว</div>}
    {application.status === 'REJECTED' && <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-[10px] font-bold leading-relaxed text-red-800"><AlertTriangle size={15} className="mt-0.5 shrink-0" />เหตุผลที่ไม่อนุมัติ: {application.rejection_reason || '-'}</div>}
  </div>;
};

const ConfirmationDialog = ({ request, application, vendorChoice, vendorName, newCompanyStatus, rejectionReason, saving, onCancel, onConfirm }: { request: ConfirmationRequest; application: ExternalRegistrationApplicationRow; vendorChoice: 'EXISTING' | 'NEW'; vendorName: string; newCompanyStatus: 'PENDING' | 'APPROVED'; rejectionReason: string; saving: boolean; onCancel: () => void; onConfirm: () => void }) => {
  const isRetry = request.kind === 'RETRY_EMAIL';
  const action = request.kind === 'RESOLVE' ? request.action : null;
  const title = isRetry ? 'ยืนยันการส่ง Email ซ้ำ' : `ยืนยัน${action ? ACTION_LABELS[action] : 'การดำเนินการ'}`;
  const confirmLabel = isRetry ? 'ยืนยันส่ง Email ซ้ำ' : action === 'APPROVED' ? 'ยืนยันอนุมัติและส่ง Email' : action === 'REJECTED' ? 'ยืนยันไม่อนุมัติคำขอ' : `ยืนยัน${action ? ACTION_LABELS[action] : 'การดำเนินการ'}`;
  return <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm" role="presentation"><div className="w-full max-w-lg rounded-[2rem] border border-white/20 bg-white p-6 shadow-2xl md:p-7" role="dialog" aria-modal="true" aria-labelledby="external-confirm-title"><div className="flex items-start gap-4"><div className={`rounded-2xl p-3 ${action === 'REJECTED' ? 'bg-red-100 text-red-700' : action === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{action === 'REJECTED' ? <XCircle size={22} /> : action === 'APPROVED' ? <CheckCircle2 size={22} /> : <ShieldCheck size={22} />}</div><div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-widest text-slate-500">ยืนยันการดำเนินการ</p><h2 id="external-confirm-title" className="mt-1 text-lg font-black text-slate-900">{title}</h2><p className="mt-2 text-xs font-bold leading-relaxed text-slate-600">กรุณาตรวจสอบข้อมูลด้านล่างอีกครั้ง การดำเนินการนี้จะถูกบันทึกไว้ในประวัติคำขอ</p></div></div><div className="mt-5 space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs"><SummaryRow label="เลขคำขอ" value={application.request_no} /><SummaryRow label="บริษัท" value={application.company_name_submitted} /><SummaryRow label="ผู้สมัคร" value={`${application.first_name_th} ${application.last_name_th}`} /><SummaryRow label="Email" value={application.login_email} />{action === 'APPROVED' && <SummaryRow label="การจัดการบริษัท" value={vendorChoice === 'EXISTING' ? `ใช้บริษัทเดิม${vendorName ? `: ${vendorName}` : ''}` : `สร้างบริษัทใหม่ (${newCompanyStatus})`} />}{action === 'REJECTED' && <SummaryRow label="เหตุผล" value={rejectionReason} />}{isRetry && <p className="mt-3 border-t border-slate-200 pt-3 text-[10px] font-bold text-amber-700">ระบบจะส่ง Email ผลลัพธ์ซ้ำไปยังผู้สมัครตาม Email นี้</p>}{action === 'APPROVED' && <p className="mt-3 border-t border-slate-200 pt-3 text-[10px] font-bold text-emerald-700">ระบบจะส่ง Email ผลการอนุมัติไปยังผู้สมัครหลังบันทึกสำเร็จ</p>}</div><div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={onCancel} disabled={saving} className="min-h-11 rounded-xl border border-slate-200 px-5 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50">ยกเลิก</button><button type="button" onClick={onConfirm} disabled={saving} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-xs font-black text-white disabled:opacity-50 ${action === 'REJECTED' ? 'bg-red-600 hover:bg-red-700' : action === 'APPROVED' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-700 hover:bg-blue-800'}`}>{saving && <Loader2 size={15} className="animate-spin" />}{confirmLabel}</button></div></div></div>;
};

const SummaryRow = ({ label, value }: { label: string; value: string }) => <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-3"><span className="font-bold text-slate-500">{label}</span><span className="break-words font-black text-slate-800">{value}</span></div>;
const SectionHeading = ({ icon, title }: { icon: React.ReactNode; title: string }) => <div className="flex items-center gap-2 text-sm font-black text-slate-900"><span className="text-blue-700">{icon}</span>{title}</div>;
const Step = ({ label, active }: { label: string; active: boolean }) => <div className={`rounded-xl px-2 py-2 text-[9px] font-black ${active ? 'bg-blue-700 text-white' : 'bg-white text-slate-400'}`}>{label}</div>;
const ActionButton = ({ children, variant, icon, onClick, disabled }: { children: React.ReactNode; variant: 'neutral' | 'purple' | 'danger' | 'success'; icon?: React.ReactNode; onClick: () => void; disabled: boolean }) => {
  const styles = { neutral: 'border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:text-blue-700', purple: 'border-purple-200 bg-white text-purple-700 hover:bg-purple-50', danger: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100', success: 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700' };
  return <button type="button" onClick={onClick} disabled={disabled} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-[10px] font-black transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]}`}>{icon}{children}</button>;
};
const StatusBadge = ({ status }: { status: string }) => <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[9px] font-black ${STATUS_STYLES[status] || STATUS_STYLES.CANCELLED}`}>{STATUS_LABELS[status as ExternalRegistrationApplicationStatus] || status}</span>;
const Info = ({ label, value, icon }: { label: string; value: string | null | undefined; icon: React.ReactNode }) => <div className="rounded-xl bg-slate-50 p-3"><div className="flex items-center gap-1.5 text-slate-500">{icon}<p className="text-[9px] font-black uppercase tracking-widest">{label}</p></div><p className="mt-1 break-words text-xs font-black text-slate-800">{value || '-'}</p></div>;

export default ExternalRegistrationAdmin;
