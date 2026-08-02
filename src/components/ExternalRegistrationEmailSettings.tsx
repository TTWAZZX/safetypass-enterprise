import React, { useEffect, useState } from 'react';
import { Edit3, Loader2, Mail, Plus, RefreshCw, Save, Send, ShieldCheck, Trash2, X } from 'lucide-react';
import { api } from '../services/supabaseApi';
import { supabase } from '../services/supabaseClient';
import { ExternalRegistrationNotificationRecipient } from '../types';
import { useToastContext } from './ToastProvider';

type RecipientForm = { id: string | null; displayName: string; email: string; isActive: boolean };
const emptyForm: RecipientForm = { id: null, displayName: '', email: '', isActive: true };

const ExternalRegistrationEmailSettings: React.FC = () => {
  const { showToast } = useToastContext();
  const [recipients, setRecipients] = useState<ExternalRegistrationNotificationRecipient[]>([]);
  const [senderEmail, setSenderEmail] = useState('safetytsh@gmail.com');
  const [featureEnabled, setFeatureEnabled] = useState(false);
  const [form, setForm] = useState<RecipientForm>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadData = async () => {
    setLoading(true); setError('');
    try {
      const data = await api.getExternalRegistrationEmailSettings();
      setRecipients(data.recipients); setSenderEmail(data.senderEmail); setFeatureEnabled(data.enabled);
    } catch (err: any) { setError(err?.message || 'ไม่สามารถโหลดรายชื่อผู้รับ Email ได้'); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, []);

  const saveRecipient = async () => {
    if (!form.email.trim()) return showToast('กรุณาระบุ Email ผู้รับ', 'error');
    setSaving(true);
    try {
      await api.saveExternalRegistrationEmailRecipient({ id: form.id, displayName: form.displayName, email: form.email, isActive: form.isActive });
      showToast('บันทึกรายชื่อผู้รับ Email แล้ว', 'success'); setShowForm(false); await loadData();
    } catch (err: any) { showToast(`บันทึกไม่สำเร็จ: ${err?.message || 'เกิดข้อผิดพลาด'}`, 'error'); }
    finally { setSaving(false); }
  };

  const removeRecipient = async (recipient: ExternalRegistrationNotificationRecipient) => {
    if (!window.confirm(`ปิดการรับแจ้งเตือนของ ${recipient.email} ใช่หรือไม่?`)) return;
    try { await api.removeExternalRegistrationEmailRecipient(recipient.id); showToast('ปิดการรับแจ้งเตือนแล้ว', 'success'); await loadData(); }
    catch (err: any) { showToast(`ดำเนินการไม่สำเร็จ: ${err?.message || 'เกิดข้อผิดพลาด'}`, 'error'); }
  };

  const testRecipient = async (recipient: ExternalRegistrationNotificationRecipient) => {
    setTestingId(recipient.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('ไม่พบ Session ของ Admin');
      const response = await fetch('/api/test-external-registration-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ recipientEmail: recipient.email, recipientName: recipient.display_name || '' }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || 'ส่ง Test Email ไม่สำเร็จ');
      showToast(`ส่ง Test Email ไปที่ ${recipient.email} แล้ว`, 'success');
    } catch (err: any) { showToast(`ส่ง Test Email ไม่สำเร็จ: ${err?.message || 'เกิดข้อผิดพลาด'}`, 'error'); }
    finally { setTestingId(null); }
  };

  const toggleFeature = async () => {
    const nextValue = !featureEnabled;
    if (nextValue && !window.confirm('เปิดใช้งานโมดูล External Registration หรือไม่?')) return;
    try { await api.setExternalRegistrationFeature(nextValue); setFeatureEnabled(nextValue); showToast(nextValue ? 'เปิดใช้งาน External Registration แล้ว' : 'ปิดใช้งาน External Registration แล้ว', 'success'); }
    catch (err: any) { showToast(`เปลี่ยนสถานะไม่สำเร็จ: ${err?.message || 'เกิดข้อผิดพลาด'}`, 'error'); }
  };

  return (
    <section className="bg-white rounded-[2rem] md:rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-5 md:p-8 border-b border-slate-100"><div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3 md:gap-4"><div className="p-3 bg-blue-50 text-blue-700 rounded-2xl border border-blue-100"><Mail size={24} /></div><div><h3 className="text-lg md:text-xl font-black text-slate-900">External Registration Email</h3><p className="mt-1 text-[10px] md:text-xs font-bold text-slate-500">จัดการผู้รับแจ้งเตือนและทดสอบการส่ง Email</p></div></div>
        <button onClick={loadData} disabled={loading} className="min-h-11 min-w-11 rounded-xl border border-slate-200 bg-white p-3 text-slate-600 hover:bg-slate-50 disabled:opacity-50" aria-label="รีเฟรชรายชื่อผู้รับ"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
      </div></div>

      <div className="p-5 md:p-8 space-y-6">
        {error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs font-bold text-red-700">{error}</div>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Sender Email</p><p className="mt-2 flex items-center gap-2 text-sm font-black text-slate-900"><ShieldCheck size={16} className="text-emerald-600" />{senderEmail}</p><p className="mt-2 text-[10px] font-bold leading-relaxed text-slate-500">ผู้ส่งถูกกำหนดไว้ฝั่ง Server และแก้ไขจากหน้าเว็บไม่ได้</p></div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Module Status</p><div className="mt-2 flex items-center justify-between gap-3"><span className={`rounded-full px-3 py-1 text-[10px] font-black ${featureEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{featureEnabled ? 'ENABLED' : 'DISABLED'}</span><button onClick={toggleFeature} className={`min-h-10 rounded-xl px-3 text-[10px] font-black ${featureEnabled ? 'border border-red-200 bg-red-50 text-red-700' : 'bg-slate-900 text-white'}`}>{featureEnabled ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button></div><p className="mt-2 text-[10px] font-bold leading-relaxed text-slate-500">เปิดใช้งานเมื่อพร้อมเปิดฟอร์มคำขอใน Phase ถัดไป</p></div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"><div><h4 className="text-sm font-black text-slate-900">Admin Notification Recipients</h4><p className="mt-1 text-[10px] font-bold text-slate-500">รายชื่อที่รับ Email เมื่อมีคำขอใหม่</p></div><button onClick={() => { setForm(emptyForm); setShowForm(true); }} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-3 text-[10px] font-black text-white hover:bg-blue-800"><Plus size={15} /> เพิ่ม Email Admin</button></div>

        {loading ? <div className="flex items-center justify-center gap-2 py-10 text-xs font-bold text-slate-500"><Loader2 size={18} className="animate-spin" /> กำลังโหลดรายชื่อ</div> : recipients.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-xs font-bold text-slate-500">ยังไม่มีรายชื่อผู้รับ Email</div> : <div className="space-y-3">{recipients.map((recipient) => <div key={recipient.id} className={`flex flex-col lg:flex-row lg:items-center justify-between gap-4 rounded-2xl border p-4 ${recipient.is_active ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50 opacity-70'}`}><div className="flex items-start gap-3"><div className="rounded-xl bg-slate-100 p-2 text-slate-600"><Mail size={16} /></div><div><p className="text-sm font-black text-slate-900">{recipient.display_name || 'Admin'}</p><p className="text-xs font-bold text-slate-600">{recipient.email}</p><p className={`mt-1 text-[9px] font-black uppercase tracking-widest ${recipient.is_active ? 'text-emerald-700' : 'text-slate-500'}`}>{recipient.is_active ? 'Active recipient' : 'Disabled recipient'}</p></div></div><div className="flex flex-wrap gap-2"><button onClick={() => testRecipient(recipient)} disabled={!recipient.is_active || testingId === recipient.id} className="flex min-h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-[10px] font-black text-emerald-700 disabled:opacity-50"><Send size={14} />{testingId === recipient.id ? 'กำลังส่ง' : 'Test Email'}</button><button onClick={() => { setForm({ id: recipient.id, displayName: recipient.display_name || '', email: recipient.email, isActive: recipient.is_active }); setShowForm(true); }} className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-black text-slate-700"><Edit3 size={14} /> แก้ไข</button>{recipient.is_active && <button onClick={() => removeRecipient(recipient)} className="flex min-h-10 items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 text-[10px] font-black text-red-700"><Trash2 size={14} /> ปิดใช้งาน</button>}</div></div>)}</div>}
      </div>

      {showForm && <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"><div role="dialog" aria-modal="true" aria-labelledby="external-email-recipient-dialog" className="w-full max-w-lg rounded-[2rem] bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h4 id="external-email-recipient-dialog" className="text-lg font-black text-slate-900">{form.id ? 'แก้ไขผู้รับ Email' : 'เพิ่มผู้รับ Email'}</h4><p className="mt-1 text-[10px] font-bold text-slate-500">ผู้รับแจ้งเตือนคำขอลงทะเบียน</p></div><button onClick={() => setShowForm(false)} className="min-h-11 min-w-11 rounded-full bg-slate-100 p-2 text-slate-700" aria-label="ปิดหน้าต่าง"><X size={18} /></button></div><div className="mt-6 space-y-4"><label className="block text-[10px] font-black uppercase tracking-widest text-slate-600">ชื่อแสดงผล<input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold outline-none focus:border-blue-500" placeholder="เช่น Safety Manager" /></label><label className="block text-[10px] font-black uppercase tracking-widest text-slate-600">Email *<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold outline-none focus:border-blue-500" placeholder="admin@company.com" /></label><label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs font-black text-slate-700"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="h-4 w-4 accent-blue-700" /> เปิดรับ Email แจ้งเตือน</label><button onClick={saveRecipient} disabled={saving} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} บันทึก</button></div></div></div>}
    </section>
  );
};

export default ExternalRegistrationEmailSettings;
