import { useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Download, Loader2 } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { api } from '../services/supabaseApi';

type Props = {
  title: string;
  onClose: () => void;
  onExport: (stepUpToken: string, reason: string) => Promise<void>;
};

export default function ReportExportDialog({ title, onClose, onExport }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useDialogFocus(true, ref, () => { if (!busy) onClose(); });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setPin('');
    try {
      const { stepUpToken } = await api.adminIdentityStepUp(pin);
      await onExport(stepUpToken, reason.trim());
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'ไม่สามารถส่งออกรายงานได้');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[310] grid place-items-center bg-slate-950/60 p-4">
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="report-export-title" className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 text-left shadow-xl outline-none">
        <h2 id="report-export-title" className="text-lg font-black text-slate-900">{title}</h2>
        <p className="mt-2 text-sm text-slate-600">ยืนยัน PIN แอดมินและระบุเหตุผลเพื่อดาวน์โหลด Excel ที่มีเลขบัตรประชาชนเต็ม</p>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <label className="block text-sm font-semibold text-slate-700">
            PIN แอดมิน
            <input type="password" inputMode="numeric" autoComplete="current-password" required maxLength={6}
              value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            เหตุผลที่ส่งออกรายงาน
            <textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" />
          </label>
          {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" disabled={busy} onClick={onClose} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-700">ยกเลิก</button>
            <button type="submit" disabled={busy || !/^\d{4}(?:\d{2})?$/.test(pin) || !reason.trim()} className="flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-50">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} ดาวน์โหลด Excel
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
