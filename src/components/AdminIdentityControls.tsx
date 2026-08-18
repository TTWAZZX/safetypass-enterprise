import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Download, Eye, EyeOff, KeyRound, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { api } from '../services/supabaseApi';
import { useToastContext } from './ToastProvider';

interface Props {
  userId: string;
  maskedNationalId: string;
  targetRole: string;
  isCurrentAdmin: boolean;
  onIdentityChanged: () => Promise<void> | void;
}

const AdminIdentityControls: React.FC<Props> = ({
  userId, maskedNationalId, targetRole, isCurrentAdmin, onIdentityChanged,
}) => {
  const { showToast } = useToastContext();
  const [pin, setPin] = useState('');
  const [stepUpToken, setStepUpToken] = useState('');
  const [stepUpExpiresAt, setStepUpExpiresAt] = useState('');
  const [reason, setReason] = useState('');
  const [fullNationalId, setFullNationalId] = useState('');
  const [revealExpiresAt, setRevealExpiresAt] = useState('');
  const [newNationalId, setNewNationalId] = useState('');
  const [confirmExport, setConfirmExport] = useState(false);
  const [confirmCorrection, setConfirmCorrection] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [recoveryOperationId, setRecoveryOperationId] = useState('');
  const [now, setNow] = useState(Date.now());

  const stepUpActive = Boolean(stepUpToken && new Date(stepUpExpiresAt).getTime() > now);
  const revealActive = Boolean(fullNationalId && new Date(revealExpiresAt).getTime() > now);
  const revealSeconds = Math.max(0, Math.ceil((new Date(revealExpiresAt).getTime() - now) / 1000));
  const correctionAllowed = targetRole === 'USER' && !isCurrentAdmin;
  const reasonValid = useMemo(() => reason.trim().length >= 3
    && !/(^|[^0-9])[0-9]{13}([^0-9]|$)/.test(reason), [reason]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const clearSensitiveState = () => {
      if (document.visibilityState === 'hidden') {
        setFullNationalId('');
        setRevealExpiresAt('');
      }
    };
    document.addEventListener('visibilitychange', clearSensitiveState);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', clearSensitiveState);
    };
  }, []);

  useEffect(() => {
    if (!stepUpActive && stepUpToken) {
      setStepUpToken('');
      setStepUpExpiresAt('');
      setFullNationalId('');
      setRevealExpiresAt('');
    }
    if (!revealActive && fullNationalId) {
      setFullNationalId('');
      setRevealExpiresAt('');
    }
  }, [fullNationalId, revealActive, stepUpActive, stepUpToken]);

  const verifyPin = async () => {
    setBusyAction('step-up');
    try {
      const result = await api.adminIdentityStepUp(pin);
      setStepUpToken(result.stepUpToken);
      setStepUpExpiresAt(result.expiresAt);
      setPin('');
      showToast('ยืนยัน PIN สำหรับงานข้อมูลส่วนบุคคลสำเร็จ ใช้ได้ 5 นาที', 'success');
    } catch (error: any) {
      showToast(error?.message || 'ยืนยัน PIN ไม่สำเร็จ', 'error');
    } finally { setBusyAction(''); }
  };

  const reveal = async () => {
    if (!stepUpActive || !reasonValid) return;
    setBusyAction('reveal');
    try {
      const result = await api.adminRevealNationalId({ userId, reason: reason.trim(), stepUpToken });
      setFullNationalId(result.nationalId);
      setRevealExpiresAt(result.expiresAt);
      showToast('เปิดดูเลขบัตรแล้ว ระบบจะซ่อนกลับภายใน 60 วินาที', 'success');
    } catch (error: any) { showToast(error?.message || 'เปิดดูเลขบัตรไม่สำเร็จ', 'error'); }
    finally { setBusyAction(''); }
  };

  const copyRevealed = async () => {
    if (!revealActive) return;
    try {
      await navigator.clipboard.writeText(fullNationalId);
      showToast('คัดลอกเลขบัตรแล้ว', 'success');
    } catch { showToast('ไม่สามารถคัดลอกได้', 'error'); }
  };

  const exportCurrent = async () => {
    if (!stepUpActive || !reasonValid || !confirmExport) return;
    setBusyAction('export');
    try {
      await api.adminExportNationalIds({ userIds: [userId], reason: reason.trim(), stepUpToken });
      setConfirmExport(false);
      showToast('สร้างไฟล์ Full-ID Export สำเร็จ', 'success');
    } catch (error: any) { showToast(error?.message || 'Export ไม่สำเร็จ', 'error'); }
    finally { setBusyAction(''); }
  };

  const correctIdentity = async () => {
    if (!stepUpActive || !reasonValid || !confirmCorrection || !/^\d{13}$/.test(newNationalId)) return;
    setBusyAction('correct');
    try {
      const result = await api.adminCorrectNationalId({ userId, newNationalId, reason: reason.trim(), stepUpToken });
      setFullNationalId('');
      setRevealExpiresAt('');
      setNewNationalId('');
      setConfirmCorrection(false);
      setStepUpToken('');
      setStepUpExpiresAt('');
      await onIdentityChanged();
      showToast(`แก้เลขบัตรสำเร็จ ผู้ใช้ต้องใช้ Temporary PIN 6 หลักท้ายภายใน ${new Date(result.temporaryPinExpiresAt).toLocaleTimeString('th-TH')}`, 'success');
    } catch (error: any) {
      if (error?.status === 'RECOVERY_REQUIRED' && error?.operationId) setRecoveryOperationId(error.operationId);
      showToast(error?.message || 'แก้เลขบัตรไม่สำเร็จ', 'error');
    } finally { setBusyAction(''); }
  };

  const recover = async () => {
    if (!stepUpActive || !reasonValid || !recoveryOperationId) return;
    setBusyAction('recover');
    try {
      const result = await api.adminRecoverNationalIdCorrection({ operationId: recoveryOperationId, reason: reason.trim(), stepUpToken });
      setRecoveryOperationId('');
      await onIdentityChanged();
      showToast(`กู้คืน Identity operation สำเร็จ: ${result.status}`, 'success');
    } catch (error: any) { showToast(error?.message || 'กู้คืน Identity operation ไม่สำเร็จ', 'error'); }
    finally { setBusyAction(''); }
  };

  return <section aria-labelledby="protected-identity-title" className="rounded-3xl border border-red-200 bg-red-50/60 p-4 md:p-5">
    <div className="flex items-start gap-3">
      <ShieldAlert className="mt-0.5 shrink-0 text-red-700" size={20} />
      <div>
        <h4 id="protected-identity-title" className="text-xs font-black uppercase text-red-900">Protected National ID</h4>
        <p className="mt-1 text-[10px] font-bold text-red-800">ทุกการเปิดดู ส่งออก และแก้ไขต้องยืนยัน PIN ฝั่ง Server และบันทึก Audit โดยไม่เก็บเลขเต็ม</p>
      </div>
    </div>

    <div className="mt-4 rounded-2xl border border-red-100 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[9px] font-black uppercase text-slate-500">Current identity</p>
          <p className="mt-1 font-mono text-base font-black tracking-wider text-slate-900">{revealActive ? fullNationalId : maskedNationalId}</p>
          {revealActive && <p className="mt-1 text-[9px] font-bold text-red-700">ซ่อนอัตโนมัติใน {revealSeconds} วินาที</p>}
        </div>
        <div className="flex gap-2">
          {revealActive && <button type="button" onClick={() => { setFullNationalId(''); setRevealExpiresAt(''); }} aria-label="ซ่อนเลขบัตรประชาชน" className="min-h-11 rounded-xl border border-slate-200 px-3 text-xs font-black text-slate-700"><EyeOff size={16}/></button>}
          {revealActive && <button type="button" onClick={copyRevealed} aria-label="คัดลอกเลขบัตรประชาชน" className="min-h-11 rounded-xl border border-slate-200 px-3 text-xs font-black text-slate-700"><Copy size={16}/></button>}
        </div>
      </div>
    </div>

    {!stepUpActive ? <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
      <label className="text-[10px] font-black text-slate-700">Admin PIN
        <input aria-label="Admin PIN สำหรับข้อมูลส่วนบุคคล" type="password" inputMode="numeric" autoComplete="current-password" maxLength={6} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} className="mt-1 w-full rounded-xl border border-red-200 bg-white p-3 text-sm font-black tracking-[0.3em] outline-none focus:border-red-500" />
      </label>
      <button type="button" onClick={verifyPin} disabled={busyAction !== '' || !/^\d{4}(?:\d{2})?$/.test(pin)} className="min-h-11 self-end rounded-xl bg-red-700 px-4 text-[10px] font-black text-white disabled:opacity-50">
        {busyAction === 'step-up' ? <Loader2 className="animate-spin" size={16}/> : <span className="flex items-center gap-2"><KeyRound size={15}/> Verify PIN</span>}
      </button>
    </div> : <p className="mt-4 rounded-xl bg-emerald-100 p-3 text-[10px] font-black text-emerald-800">PIN verified — protected actions available until {new Date(stepUpExpiresAt).toLocaleTimeString('th-TH')}</p>}

    <label className="mt-4 block text-[10px] font-black text-slate-700">เหตุผลสำหรับ Audit *
      <textarea aria-label="เหตุผลสำหรับการจัดการเลขบัตร" rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="ห้ามกรอกเลขบัตรประชาชนในเหตุผล" className="mt-1 w-full resize-none rounded-xl border border-red-200 bg-white p-3 text-sm font-bold outline-none focus:border-red-500" />
    </label>

    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <button type="button" onClick={reveal} disabled={!stepUpActive || !reasonValid || busyAction !== ''} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-[10px] font-black text-white disabled:opacity-40">
        {busyAction === 'reveal' ? <Loader2 className="animate-spin" size={15}/> : <><Eye size={15}/> Reveal 60 seconds</>}
      </button>
      <button type="button" onClick={exportCurrent} disabled={!stepUpActive || !reasonValid || !confirmExport || busyAction !== ''} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 text-[10px] font-black text-white disabled:opacity-40">
        {busyAction === 'export' ? <Loader2 className="animate-spin" size={15}/> : <><Download size={15}/> Full-ID Export</>}
      </button>
    </div>
    <label className="mt-2 flex items-start gap-2 text-[9px] font-bold text-slate-700"><input aria-label="ยืนยัน Full-ID Export" type="checkbox" checked={confirmExport} onChange={(event) => setConfirmExport(event.target.checked)} /> ยืนยันว่าไฟล์นี้เป็นข้อมูลส่วนบุคคลและต้องจัดเก็บตามนโยบาย PDPA</label>

    <div className="mt-5 border-t border-red-200 pt-4">
      <p className="text-[10px] font-black uppercase text-red-900">Correct National ID</p>
      {!correctionAllowed ? <p className="mt-2 text-[10px] font-bold text-red-700">แก้เลขบัตรได้เฉพาะบัญชี USER และห้ามแก้บัญชี Admin ของตนเอง</p> : <>
        <input aria-label="เลขบัตรประชาชนใหม่" inputMode="numeric" maxLength={13} value={newNationalId} onChange={(event) => setNewNationalId(event.target.value.replace(/\D/g, ''))} placeholder="เลขบัตรใหม่ 13 หลัก" className="mt-3 w-full rounded-xl border border-red-200 bg-white p-3 font-mono text-sm font-black tracking-wider outline-none focus:border-red-500" />
        <label className="mt-2 flex items-start gap-2 text-[9px] font-bold text-slate-700"><input aria-label="ยืนยันแก้เลขบัตรประชาชน" type="checkbox" checked={confirmCorrection} onChange={(event) => setConfirmCorrection(event.target.checked)} /> ยืนยันว่าได้ตรวจสอบเอกสารแล้ว และผู้ใช้จะต้องเปลี่ยน Temporary PIN หลังเข้าสู่ระบบด้วยเลขใหม่</label>
        <button type="button" onClick={correctIdentity} disabled={!stepUpActive || !reasonValid || !confirmCorrection || !/^\d{13}$/.test(newNationalId) || busyAction !== ''} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-4 text-[10px] font-black text-white disabled:opacity-40">
          {busyAction === 'correct' ? <Loader2 className="animate-spin" size={15}/> : <><RefreshCw size={15}/> Correct Identity</>}
        </button>
      </>}
    </div>

    {recoveryOperationId && <div role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
      <p className="text-[10px] font-black text-amber-900">Operation ต้องกู้คืน: {recoveryOperationId}</p>
      <button type="button" onClick={recover} disabled={!stepUpActive || !reasonValid || busyAction !== ''} className="mt-2 flex min-h-11 items-center gap-2 rounded-xl bg-amber-700 px-4 text-[10px] font-black text-white disabled:opacity-40">Recover operation</button>
    </div>}
  </section>;
};

export default AdminIdentityControls;
