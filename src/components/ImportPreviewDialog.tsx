import React, { useRef } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, X, XCircle } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';

export interface ImportPreviewDisplayRow {
  rowNumber: number;
  primary: string;
  secondary: string;
  issues: Array<{ level: 'warning' | 'error'; message: string }>;
}

interface Props {
  fileName: string;
  kindLabel: string;
  rows: ImportPreviewDisplayRow[];
  summary: { total: number; ready: number; warning: number; error: number };
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const ImportPreviewDialog: React.FC<Props> = ({ fileName, kindLabel, rows, summary, busy, onCancel, onConfirm }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(true, dialogRef, () => { if (!busy) onCancel(); });

  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/65 p-3 backdrop-blur-sm sm:p-6" role="presentation">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="import-preview-title" tabIndex={-1} className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl focus:outline-none">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700"><FileSpreadsheet size={20} /></span>
            <div className="min-w-0"><p className="text-[9px] font-black uppercase tracking-widest text-emerald-700">ตรวจสอบก่อนบันทึก</p><h2 id="import-preview-title" className="mt-1 text-lg font-black text-slate-900">Preview Import {kindLabel}</h2><p className="mt-1 truncate text-[10px] font-bold text-slate-500" title={fileName}>{fileName}</p></div>
          </div>
          <button type="button" onClick={onCancel} disabled={busy} aria-label="ปิด Preview Import" className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-600 disabled:opacity-40"><X size={18} /></button>
        </header>

        <div className="grid grid-cols-2 gap-2 border-b border-slate-100 bg-slate-50 p-4 sm:grid-cols-4 sm:px-6">
          <Summary label="ทั้งหมด" value={summary.total} tone="slate" />
          <Summary label="พร้อมนำเข้า" value={summary.ready} tone="emerald" />
          <Summary label="มีคำเตือน" value={summary.warning} tone="amber" />
          <Summary label="บันทึกไม่ได้" value={summary.error} tone="red" />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="space-y-2">
            {rows.map((row) => {
              const hasError = row.issues.some((issue) => issue.level === 'error');
              const hasWarning = row.issues.some((issue) => issue.level === 'warning');
              return (
                <div key={row.rowNumber} className={`rounded-2xl border p-3 ${hasError ? 'border-red-200 bg-red-50' : hasWarning ? 'border-amber-200 bg-amber-50' : 'border-emerald-100 bg-white'}`}>
                  <div className="flex items-start gap-3">
                    <span className="w-12 shrink-0 text-[9px] font-black text-slate-500">แถว {row.rowNumber}</span>
                    <div className="min-w-0 flex-1"><p className="truncate text-xs font-black text-slate-900">{row.primary || 'ไม่มีข้อมูล'}</p><p className="mt-0.5 truncate text-[9px] font-bold text-slate-500">{row.secondary}</p>{row.issues.map((issue, index) => <p key={`${issue.message}-${index}`} className={`mt-1 flex items-start gap-1 text-[9px] font-bold ${issue.level === 'error' ? 'text-red-700' : 'text-amber-800'}`}>{issue.level === 'error' ? <XCircle size={11} className="mt-0.5 shrink-0" /> : <AlertTriangle size={11} className="mt-0.5 shrink-0" />}{issue.message}</p>)}</div>
                    {!hasError && !hasWarning && <CheckCircle2 size={16} className="shrink-0 text-emerald-600" aria-label="พร้อมนำเข้า" />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <footer className="grid grid-cols-1 gap-2 border-t border-slate-200 bg-white p-4 sm:grid-cols-[auto_1fr] sm:px-6">
          <button type="button" onClick={onCancel} disabled={busy} className="min-h-12 rounded-xl border border-slate-200 px-5 text-xs font-black text-slate-700 disabled:opacity-40">ยกเลิก</button>
          <button type="button" onClick={onConfirm} disabled={busy || summary.ready === 0} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 text-xs font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300">{busy ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />} {busy ? 'กำลังบันทึกข้อมูล' : `ยืนยันนำเข้า ${summary.ready} รายการ`}</button>
        </footer>
      </div>
    </div>
  );
};

const Summary = ({ label, value, tone }: { label: string; value: number; tone: 'slate' | 'emerald' | 'amber' | 'red' }) => {
  const classes = { slate: 'border-slate-200 bg-white text-slate-700', emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800', amber: 'border-amber-200 bg-amber-50 text-amber-800', red: 'border-red-200 bg-red-50 text-red-800' };
  return <div className={`rounded-xl border px-3 py-2 ${classes[tone]}`}><p className="text-[8px] font-black uppercase tracking-wider opacity-70">{label}</p><p className="mt-0.5 text-xl font-black tabular-nums">{value}</p></div>;
};

export default ImportPreviewDialog;

