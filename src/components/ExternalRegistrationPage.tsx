import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Building2, CheckCircle2, ChevronRight, ClipboardList, Loader2, Plus, Search, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { supabase } from '../services/supabaseClient';

type UserType = 'CONTRACTOR' | 'SUPPLIER' | 'OUTSOURCE';
type PageMode = 'FORM' | 'RESULT' | 'STATUS' | 'EDIT';
type SubmissionResult = { request_no: string; tracking_token: string; status: string };
type EditFormData = {
  request_no: string;
  status: string;
  company_name: string;
  first_name_th: string;
  last_name_th: string;
  first_name_en: string;
  last_name_en: string;
  job_title: string;
  email: string;
  phone: string;
  types: string[];
  coordinators: string[];
  admin_note: string | null;
  rejection_reason: string | null;
};

const TYPE_LABELS: Record<UserType, string> = { CONTRACTOR: 'Contractor', SUPPLIER: 'Supplier', OUTSOURCE: 'Outsource' };
const SYSTEM_LABELS: Record<string, string> = { CONTRACTOR_ONLINE: 'Contractor Online', SUPPLIER_EPASS: 'Supplier E-Pass' };
const STATUS_LABELS: Record<string, string> = {
  SUBMITTED: 'รอตรวจสอบ',
  UNDER_REVIEW: 'กำลังตรวจสอบ',
  NEED_MORE_INFO: 'ขอข้อมูลเพิ่มเติม',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่อนุมัติ',
  CANCELLED: 'ลบคำขอแล้ว',
};
const inputClass = 'mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10';

const ExternalRegistrationPage: React.FC = () => {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const requestNo = params.get('request') || '';
  const trackingToken = params.get('token') || '';
  const hasTrackingLink = window.location.pathname.includes('/status') && Boolean(requestNo && trackingToken);
  const initialMode: PageMode = hasTrackingLink ? (params.get('mode') === 'edit' ? 'EDIT' : 'STATUS') : 'FORM';
  const [mode, setMode] = useState<PageMode>(initialMode);
  const [featureEnabled, setFeatureEnabled] = useState(false);
  const [featureLoading, setFeatureLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(initialMode === 'STATUS');
  const [loadingEdit, setLoadingEdit] = useState(initialMode === 'EDIT');
  const [error, setError] = useState('');
  const [emailNotice, setEmailNotice] = useState('');
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const [statusData, setStatusData] = useState<any>(null);
  const [editData, setEditData] = useState<EditFormData | null>(null);
  const [form, setForm] = useState({
    companyName: '', firstNameTh: '', lastNameTh: '', firstNameEn: '', lastNameEn: '',
    jobTitle: '', email: '', phone: '', types: [] as UserType[], coordinators: [''], pdpa: false,
  });

  useEffect(() => {
    supabase.rpc('get_external_registration_feature_flag').then(({ data, error: flagError }) => {
      setFeatureEnabled(!flagError && Boolean(data));
      setFeatureLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!hasTrackingLink || !['STATUS', 'EDIT'].includes(initialMode)) return;
    const loadLinkData = async () => {
      if (initialMode === 'EDIT') setLoadingEdit(true);
      else setLoadingStatus(true);
      const rpcName = initialMode === 'EDIT' ? 'get_external_access_application_edit_form' : 'get_external_access_application_status';
      const { data, error: linkError } = await supabase.rpc(rpcName, {
        request_no_param: requestNo,
        tracking_token_param: trackingToken,
      });
      if (linkError || !data) {
        setError(initialMode === 'EDIT' ? 'ไม่สามารถเปิดแบบฟอร์มแก้ไขได้ ลิงก์อาจหมดอายุหรือคำขอไม่อยู่ในสถานะที่แก้ไขได้' : 'ไม่พบข้อมูลคำขอ หรือ Tracking Link ไม่ถูกต้อง');
      } else if (initialMode === 'EDIT') {
        const editable = data as EditFormData;
        setEditData(editable);
        setForm({
          companyName: editable.company_name,
          firstNameTh: editable.first_name_th,
          lastNameTh: editable.last_name_th,
          firstNameEn: editable.first_name_en,
          lastNameEn: editable.last_name_en,
          jobTitle: editable.job_title,
          email: editable.email,
          phone: editable.phone,
          types: editable.types as UserType[],
          coordinators: editable.coordinators.length > 0 ? editable.coordinators : [''],
          pdpa: true,
        });
      } else {
        setStatusData(data);
      }
      setLoadingEdit(false);
      setLoadingStatus(false);
    };
    void loadLinkData();
  }, [hasTrackingLink, initialMode, requestNo, trackingToken]);

  const selectedSystems = useMemo(() => {
    const systems = new Set<string>();
    if (form.types.includes('CONTRACTOR')) systems.add('CONTRACTOR_ONLINE');
    if (form.types.includes('SUPPLIER') || form.types.includes('OUTSOURCE')) systems.add('SUPPLIER_EPASS');
    return Array.from(systems);
  }, [form.types]);

  const updateField = (key: string, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const toggleType = (type: UserType) => setForm((current) => ({ ...current, types: current.types.includes(type) ? current.types.filter((item) => item !== type) : [...current.types, type] }));
  const updateCoordinator = (index: number, value: string) => setForm((current) => ({ ...current, coordinators: current.coordinators.map((item, itemIndex) => itemIndex === index ? value : item) }));
  const addCoordinator = () => setForm((current) => ({ ...current, coordinators: [...current.coordinators, ''] }));
  const removeCoordinator = (index: number) => setForm((current) => ({ ...current, coordinators: current.coordinators.length === 1 ? current.coordinators : current.coordinators.filter((_, itemIndex) => itemIndex !== index) }));

  const sendSubmissionEmail = async (requestNumber: string, token: string) => {
    try {
      const emailResponse = await fetch('/api/send-external-registration-submission', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestNo: requestNumber, trackingToken: token }) });
      if (!emailResponse.ok) setEmailNotice('บันทึกคำขอแล้ว แต่ระบบยังส่ง Email ไม่สำเร็จ Admin สามารถตรวจสอบและส่งซ้ำได้');
    } catch {
      setEmailNotice('บันทึกคำขอแล้ว แต่ระบบยังไม่สามารถส่ง Email ได้');
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setEmailNotice('');
    const coordinators = form.coordinators.map((name) => name.trim()).filter(Boolean);
    if (form.types.length === 0) return setError('กรุณาเลือกประเภทผู้ใช้งานอย่างน้อย 1 รายการ');
    if (coordinators.length === 0) return setError('กรุณาระบุชื่อผู้ประสานงาน TSH อย่างน้อย 1 คน');
    if (!form.pdpa) return setError('กรุณายอมรับเงื่อนไข PDPA ก่อนส่งคำขอ');
    setSubmitting(true);
    try {
      if (mode === 'EDIT') {
        const { data, error: resubmitError } = await supabase.rpc('resubmit_external_access_application', {
          request_no_param: requestNo,
          tracking_token_param: trackingToken,
          company_name_param: form.companyName,
          requested_types_param: form.types,
          first_name_th_param: form.firstNameTh,
          last_name_th_param: form.lastNameTh,
          first_name_en_param: form.firstNameEn,
          last_name_en_param: form.lastNameEn,
          job_title_param: form.jobTitle,
          login_email_param: form.email,
          phone_param: form.phone,
          coordinator_names_param: coordinators,
        });
        if (resubmitError) throw resubmitError;
        const submitted: SubmissionResult = { request_no: data.request_no, tracking_token: trackingToken, status: data.status };
        setResult(submitted);
        setMode('RESULT');
        await sendSubmissionEmail(submitted.request_no, submitted.tracking_token);
      } else {
        const { data, error: submitError } = await supabase.rpc('create_external_access_application', {
          company_name_param: form.companyName,
          requested_types_param: form.types,
          first_name_th_param: form.firstNameTh,
          last_name_th_param: form.lastNameTh,
          first_name_en_param: form.firstNameEn,
          last_name_en_param: form.lastNameEn,
          job_title_param: form.jobTitle,
          login_email_param: form.email,
          phone_param: form.phone,
          coordinator_names_param: coordinators,
          pdpa_agreed_param: form.pdpa,
        });
        if (submitError) throw submitError;
        const submission = data as SubmissionResult;
        setResult(submission);
        setMode('RESULT');
        await sendSubmissionEmail(submission.request_no, submission.tracking_token);
      }
    } catch (err: any) {
      setError(err?.message || 'ไม่สามารถส่งคำขอได้ กรุณาตรวจสอบข้อมูลแล้วลองใหม่');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setForm({ companyName: '', firstNameTh: '', lastNameTh: '', firstNameEn: '', lastNameEn: '', jobTitle: '', email: '', phone: '', types: [], coordinators: [''], pdpa: false });
    setResult(null);
    setEditData(null);
    setError('');
    setEmailNotice('');
    setMode('FORM');
  };

  const trackingUrl = result ? `${window.location.origin}/external-registration/status?request=${encodeURIComponent(result.request_no)}&token=${encodeURIComponent(result.tracking_token)}` : '';
  const editUrl = hasTrackingLink ? `${window.location.origin}/external-registration/status?request=${encodeURIComponent(requestNo)}&token=${encodeURIComponent(trackingToken)}&mode=edit` : '';
  const isEditing = mode === 'EDIT';

  if (featureLoading) return <PageShell><LoadingState label="กำลังตรวจสอบสถานะระบบ" /></PageShell>;
  if (!featureEnabled && mode === 'FORM') return <PageShell><EmptyState onBack={() => { window.location.href = '/'; }} /></PageShell>;
  if (mode === 'RESULT' && result) return <PageShell><ResultView result={result} trackingUrl={trackingUrl} emailNotice={emailNotice} onNew={resetForm} /></PageShell>;
  if (mode === 'STATUS') return <PageShell><StatusView loading={loadingStatus} data={statusData} error={error} editUrl={editUrl} onBack={() => { window.location.href = '/external-registration'; }} /></PageShell>;
  if (mode === 'EDIT' && (loadingEdit || !editData)) return <PageShell><LoadingState label="กำลังโหลดข้อมูลเดิมสำหรับแก้ไข" />{error && <p className="mt-4 text-center text-xs font-bold text-red-700">{error}</p>}</PageShell>;

  return <PageShell>
    <div className="mb-6 flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-700">External Access Request</p><h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900">{isEditing ? 'แก้ไขข้อมูลและส่งคำขออีกครั้ง' : 'ลงทะเบียนใช้งาน Contractor Online / Supplier E-Pass'}</h1><p className="mt-2 text-xs font-bold leading-relaxed text-slate-500">{isEditing ? 'แก้ไขข้อมูลตามที่ Admin ขอ แล้วส่งกลับมาให้ตรวจสอบใหม่ โดยใช้เลขคำขอเดิม' : 'กรอกข้อมูลเพื่อขอใช้งาน Contractor Online หรือ Supplier E-Pass'}</p></div><a href="/" className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-black text-slate-700"><ArrowLeft size={15} /> กลับ</a></div>
    {isEditing && <div className="mb-6 rounded-2xl border border-purple-200 bg-purple-50 p-4 text-xs font-bold leading-relaxed text-purple-900"><p className="font-black">คำขอเดิม: {editData?.request_no}</p>{editData?.admin_note && <p className="mt-1">ข้อมูลที่ต้องเพิ่มเติม: {editData.admin_note}</p>}{editData?.rejection_reason && <p className="mt-1">เหตุผลจาก Admin: {editData.rejection_reason}</p>}</div>}
    <form onSubmit={submit} className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm md:p-8"><SectionTitle icon={<ClipboardList size={20} />} title="1. ประเภทผู้ใช้งาน" description="เลือกได้มากกว่า 1 ประเภท" /><div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">{(['CONTRACTOR', 'SUPPLIER', 'OUTSOURCE'] as UserType[]).map((type) => <label key={type} className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${form.types.includes(type) ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/10' : 'border-slate-200 bg-slate-50 hover:bg-white'}`}><input type="checkbox" checked={form.types.includes(type)} onChange={() => toggleType(type)} className="mt-1 h-4 w-4 accent-blue-700" /><span><span className="block text-sm font-black text-slate-900">{TYPE_LABELS[type]}</span><span className="mt-1 block text-[10px] font-bold text-slate-500">{type === 'CONTRACTOR' ? 'Contractor Online' : 'Supplier E-Pass'}</span></span></label>)}</div>{selectedSystems.length > 0 && <div className="mt-4 flex flex-wrap gap-2"><span className="text-[10px] font-black text-slate-500">ระบบที่เกี่ยวข้อง:</span>{selectedSystems.map((system) => <span key={system} className="rounded-full bg-slate-900 px-3 py-1 text-[10px] font-black text-white">{SYSTEM_LABELS[system]}</span>)}</div>}</section>
      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm md:p-8"><SectionTitle icon={<Building2 size={20} />} title="2. ข้อมูลบริษัท" description="กรุณาใช้ชื่อบริษัทเต็ม ไม่ใช้ชื่อย่อ" /><label className="mt-5 block text-[10px] font-black uppercase tracking-widest text-slate-600">ชื่อบริษัท *<input required value={form.companyName} onChange={(e) => updateField('companyName', e.target.value)} className={inputClass} placeholder="ชื่อบริษัทภาษาไทยหรือภาษาอังกฤษ" /></label></section>
      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm md:p-8"><SectionTitle icon={<UserRound size={20} />} title="3. ข้อมูลผู้สมัคร" description="ข้อมูลนี้ใช้ประกอบการตรวจสอบคำขอ" /><div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2"><label className="text-[10px] font-black uppercase tracking-widest text-slate-600">ชื่อภาษาไทย *<input required value={form.firstNameTh} onChange={(e) => updateField('firstNameTh', e.target.value)} className={inputClass} /></label><label className="text-[10px] font-black uppercase tracking-widest text-slate-600">นามสกุลภาษาไทย *<input required value={form.lastNameTh} onChange={(e) => updateField('lastNameTh', e.target.value)} className={inputClass} /></label><label className="text-[10px] font-black uppercase tracking-widest text-slate-600">First Name *<input required value={form.firstNameEn} onChange={(e) => updateField('firstNameEn', e.target.value)} className={inputClass} /></label><label className="text-[10px] font-black uppercase tracking-widest text-slate-600">Last Name *<input required value={form.lastNameEn} onChange={(e) => updateField('lastNameEn', e.target.value)} className={inputClass} /></label><label className="text-[10px] font-black uppercase tracking-widest text-slate-600">ตำแหน่ง *<input required value={form.jobTitle} onChange={(e) => updateField('jobTitle', e.target.value)} className={inputClass} /></label><label className="text-[10px] font-black uppercase tracking-widest text-slate-600">Email Address *<input required type="email" value={form.email} onChange={(e) => updateField('email', e.target.value)} className={inputClass} placeholder="name@company.com" /></label><label className="text-[10px] font-black uppercase tracking-widest text-slate-600 md:col-span-2">เบอร์โทรติดต่อ *<input required value={form.phone} onChange={(e) => updateField('phone', e.target.value)} className={inputClass} placeholder="เบอร์บุคคลหรือบริษัท" /></label></div></section>
      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm md:p-8"><SectionTitle icon={<ShieldCheck size={20} />} title="4. ผู้ประสานงาน TSH" description="กรุณาระบุชื่อผู้ประสานงานที่ดูแลการเข้าปฏิบัติงาน อย่างน้อย 1 คน" /><div className="mt-5 space-y-3">{form.coordinators.map((name, index) => <div key={index} className="flex items-center gap-2"><input required value={name} onChange={(e) => updateCoordinator(index, e.target.value)} className={inputClass.replace('mt-2', 'mt-0')} placeholder={`ชื่อผู้ประสานงาน TSH คนที่ ${index + 1}`} />{form.coordinators.length > 1 && <button type="button" onClick={() => removeCoordinator(index)} className="min-h-11 min-w-11 rounded-xl border border-red-200 bg-red-50 text-red-700" aria-label={`ลบผู้ประสานงานคนที่ ${index + 1}`}><Trash2 size={16} /></button>}</div>)}<button type="button" onClick={addCoordinator} className="flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-blue-300 px-4 text-[10px] font-black text-blue-700"><Plus size={15} /> เพิ่มผู้ประสานงาน</button></div></section>
      {error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs font-bold text-red-700">{error}</div>}
      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm md:p-8"><label className="flex cursor-pointer items-start gap-3 text-xs font-bold leading-relaxed text-slate-700"><input type="checkbox" checked={form.pdpa} onChange={(e) => updateField('pdpa', e.target.checked)} className="mt-1 h-4 w-4 accent-blue-700" />ข้าพเจ้ายอมรับเงื่อนไขการเก็บ ใช้ และเปิดเผยข้อมูลส่วนบุคคลตามนโยบาย PDPA เพื่อการพิจารณาคำขอนี้</label><button type="submit" disabled={submitting} className="mt-5 flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-blue-700 px-5 py-4 text-xs font-black text-white shadow-lg shadow-blue-700/20 hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">{submitting ? <Loader2 size={18} className="animate-spin" /> : <ChevronRight size={18} />} {submitting ? 'กำลังส่งข้อมูล' : isEditing ? 'ส่งข้อมูลแก้ไขให้ Admin' : 'ยืนยันและส่งคำขอ'}</button></section>
    </form>
  </PageShell>;
};

const PageShell: React.FC<React.PropsWithChildren> = ({ children }) => <div className="min-h-screen bg-slate-50 px-4 py-8 text-left md:py-12"><div className="mx-auto max-w-3xl"><div className="mb-6 flex items-center gap-3"><div className="rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 p-2 text-white shadow-lg"><ShieldCheck size={20} /></div><div><p className="text-sm font-black text-slate-900">TSH CTR GatePass</p><p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">Secure Access Request</p></div></div>{children}</div></div>;
const SectionTitle = ({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) => <div className="flex items-start gap-3"><div className="rounded-xl bg-blue-50 p-2 text-blue-700">{icon}</div><div><h2 className="text-base font-black text-slate-900">{title}</h2><p className="mt-1 text-[10px] font-bold text-slate-500">{description}</p></div></div>;
const LoadingState = ({ label }: { label: string }) => <div className="rounded-[2rem] border border-slate-200 bg-white p-10 text-center"><Loader2 className="mx-auto animate-spin text-blue-700" size={28} /><p className="mt-4 text-xs font-bold text-slate-600">{label}</p></div>;
const EmptyState = ({ onBack }: { onBack: () => void }) => <div className="rounded-[2rem] border border-slate-200 bg-white p-8 text-center shadow-sm"><ShieldCheck className="mx-auto text-slate-400" size={36} /><h1 className="mt-4 text-xl font-black text-slate-900">ยังไม่เปิดรับคำขอ</h1><p className="mt-2 text-xs font-bold leading-relaxed text-slate-500">ขณะนี้ระบบยังไม่เปิดรับคำขอลงทะเบียน กรุณาติดต่อ Admin</p><button onClick={onBack} className="mt-6 min-h-11 rounded-xl bg-slate-900 px-5 text-xs font-black text-white">กลับหน้าหลัก</button></div>;
const ResultView = ({ result, trackingUrl, emailNotice, onNew }: { result: SubmissionResult; trackingUrl: string; emailNotice: string; onNew: () => void }) => <div className="rounded-[2rem] border border-slate-200 bg-white p-6 text-center shadow-sm md:p-10"><CheckCircle2 className="mx-auto text-emerald-600" size={48} /><p className="mt-5 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Request Submitted</p><h1 className="mt-2 text-2xl font-black text-slate-900">ส่งคำขอเรียบร้อยแล้ว</h1><p className="mt-3 text-xs font-bold text-slate-500">เลขที่คำขอของคุณ</p><div className="mt-2 rounded-2xl bg-slate-900 px-5 py-4 text-xl font-black tracking-widest text-white">{result.request_no}</div>{emailNotice ? <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left text-xs font-bold leading-relaxed text-amber-800">{emailNotice}</div> : <p className="mt-5 text-xs font-bold text-slate-600">ระบบได้ส่ง Email แจ้งรายละเอียดไปยัง Email ที่แจ้งไว้แล้ว</p>}<div className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-left"><p className="text-[10px] font-black uppercase tracking-widest text-blue-700">ติดตามสถานะคำขอ</p><p className="mt-2 break-all text-[10px] font-bold text-blue-900">สามารถใช้ลิงก์นี้เพื่อติดตามสถานะได้</p><a href={trackingUrl} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl bg-blue-700 px-4 text-[10px] font-black text-white">ติดตามสถานะคำขอ <Search size={14} /></a></div><button onClick={onNew} className="mt-6 min-h-11 rounded-xl border border-slate-200 px-5 text-xs font-black text-slate-700">ส่งคำขอใหม่</button></div>;
const StatusView = ({ loading, data, error, editUrl, onBack }: { loading: boolean; data: any; error: string; editUrl: string; onBack: () => void }) => <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm md:p-10">{loading ? <LoadingState label="กำลังโหลดสถานะคำขอ" /> : error || !data ? <div className="text-center"><p className="text-sm font-black text-red-700">{error || 'ไม่พบข้อมูลคำขอ'}</p><button onClick={onBack} className="mt-6 min-h-11 rounded-xl bg-slate-900 px-5 text-xs font-black text-white">กลับหน้าลงทะเบียน</button></div> : <><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Request Status</p><h1 className="mt-2 text-2xl font-black text-slate-900">{data.request_no}</h1></div><span className="rounded-full bg-blue-100 px-3 py-1 text-[10px] font-black text-blue-700">{STATUS_LABELS[data.status] || data.status}</span></div><div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2"><Info label="บริษัท" value={data.company_name} /><Info label="สถานะบริษัท" value={data.company_resolution} /><Info label="วันที่ส่งคำขอ" value={data.submitted_at ? new Date(data.submitted_at).toLocaleString('th-TH') : '-'} /><Info label="ประเภท" value={(data.types || []).map((item: any) => TYPE_LABELS[item.type_code as UserType] || item.type_code).join(', ')} /></div>{data.admin_note && <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-bold text-amber-800"><strong>ข้อความจาก Admin:</strong><br />{data.admin_note}</div>}{data.rejection_reason && <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-xs font-bold text-red-800"><strong>เหตุผล:</strong><br />{data.rejection_reason}</div>}{['NEED_MORE_INFO', 'REJECTED'].includes(data.status) && <a href={editUrl} className="mt-6 flex min-h-12 items-center justify-center gap-2 rounded-xl bg-purple-700 px-4 text-xs font-black text-white">{data.status === 'REJECTED' ? 'แก้ไขข้อมูลและส่งคำขอใหม่' : 'แก้ไขและส่งข้อมูลเพิ่มเติม'} <ChevronRight size={16} /></a>}<button onClick={onBack} className="mt-6 flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-xs font-black text-slate-700"><ArrowLeft size={15} /> กลับหน้าลงทะเบียน</button></>}</div>;
const Info = ({ label, value }: { label: string; value: string }) => <div className="rounded-xl bg-slate-50 p-4"><p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p><p className="mt-1 text-sm font-black text-slate-900">{value || '-'}</p></div>;

export default ExternalRegistrationPage;
