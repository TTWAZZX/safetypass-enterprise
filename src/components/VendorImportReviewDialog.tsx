import React, { useMemo, useRef, useState } from 'react';
import { Building2, CheckCircle2, Loader2, ShieldAlert, X } from 'lucide-react';
import { VendorNameMatch } from '../types';
import { useDialogFocus } from '../hooks/useDialogFocus';

export type VendorImportResolution =
  | { kind: 'EXACT_SKIPPED'; vendorName?: string }
  | { kind: 'USED_EXISTING'; vendorName: string }
  | { kind: 'CREATED_NEW'; vendorName: string };

export interface VendorImportReviewItem {
  id: string;
  inputName: string;
  reason: 'EXACT' | 'SIMILAR';
  matches: VendorNameMatch[];
  resolution?: VendorImportResolution;
}

interface Props {
  items: VendorImportReviewItem[];
  resolvingId: string | null;
  onClose: () => void;
  onUseExisting: (itemId: string, match: VendorNameMatch) => void;
  onCreateNew: (itemId: string) => void;
}

const VendorImportReviewDialog: React.FC<Props> = ({ items, resolvingId, onClose, onUseExisting, onCreateNew }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<'ALL' | 'EXACT' | 'PENDING' | 'RESOLVED'>('ALL');
  useDialogFocus(true, dialogRef, onClose);

  const counts = useMemo(() => ({
    exact: items.filter((item) => item.reason === 'EXACT').length,
    pending: items.filter((item) => item.reason === 'SIMILAR' && !item.resolution).length,
    resolved: items.filter((item) => item.reason === 'SIMILAR' && item.resolution).length,
  }), [items]);
  const visibleItems = items.filter((item) => {
    if (filter === 'EXACT') return item.reason === 'EXACT';
    if (filter === 'PENDING') return item.reason === 'SIMILAR' && !item.resolution;
    if (filter === 'RESOLVED') return item.reason === 'SIMILAR' && Boolean(item.resolution);
    return true;
  });

  return (
    <div className="fixed inset-0 z-[320] flex items-center justify-center p-3 sm:p-6">
      <button type="button" aria-label="ปิดรายการตรวจสอบ Import" className="absolute inset-0 h-full w-full bg-slate-950/65 backdrop-blur-sm" onClick={onClose} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="vendor-import-review-title" tabIndex={-1} className="relative z-10 flex max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-[1.75rem] border border-white/50 bg-white shadow-2xl focus:outline-none">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-7">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-blue-700">Import review</p>
            <h2 id="vendor-import-review-title" className="mt-1 text-lg font-black text-slate-900">ตรวจสอบบริษัทที่ไม่ได้เพิ่มทั้งหมด</h2>
            <p className="mt-1 text-[10px] font-bold text-slate-500">ชื่อซ้ำถูกข้ามอัตโนมัติ ส่วนชื่อใกล้เคียงต้องให้แอดมินตัดสินใจ</p>
          </div>
          <button type="button" onClick={onClose} disabled={Boolean(resolvingId)} aria-label="ปิด" className="min-h-11 min-w-11 rounded-full bg-slate-100 p-3 text-slate-600 disabled:opacity-50"><X size={18} /></button>
        </header>

        <div className="shrink-0 border-b border-slate-100 px-5 py-3 sm:px-7">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="กรองผลตรวจสอบ">
            {([['ALL', `ทั้งหมด ${items.length}`], ['EXACT', `ซ้ำและข้ามแล้ว ${counts.exact}`], ['PENDING', `รอตัดสินใจ ${counts.pending}`], ['RESOLVED', `ตัดสินใจแล้ว ${counts.resolved}`]] as const).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setFilter(value)} className={`min-h-10 rounded-xl border px-3 text-[9px] font-black transition ${filter === value ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300'}`}>{label}</button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-4 py-4 sm:px-7">
          {visibleItems.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-xs font-bold text-slate-500">ไม่มีรายการในหมวดนี้</div> : (
            <ul className="space-y-3">
              {visibleItems.map((item) => {
                const busy = resolvingId === item.id;
                return (
                  <li key={item.id} className={`rounded-2xl border bg-white p-4 ${item.reason === 'EXACT' ? 'border-slate-200' : item.resolution ? 'border-emerald-200' : 'border-amber-200'}`}>
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 rounded-xl p-2 ${item.reason === 'EXACT' ? 'bg-slate-100 text-slate-500' : item.resolution ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                        {item.resolution ? <CheckCircle2 size={17} /> : item.reason === 'EXACT' ? <ShieldAlert size={17} /> : <Building2 size={17} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="break-words text-sm font-black text-slate-900">{item.inputName}</p>
                          <span className={`rounded-full px-2 py-1 text-[8px] font-black ${item.reason === 'EXACT' ? 'bg-slate-100 text-slate-600' : item.resolution ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{item.reason === 'EXACT' ? 'ซ้ำ · ข้ามแล้ว' : item.resolution ? 'ตัดสินใจแล้ว' : 'ใกล้เคียง · รอตัดสินใจ'}</span>
                        </div>
                        {item.resolution && item.reason === 'SIMILAR' ? (
                          <p className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-[10px] font-bold text-emerald-800">{item.resolution.kind === 'CREATED_NEW' ? `เพิ่มเป็นบริษัทใหม่แล้ว: ${item.resolution.vendorName}` : `ใช้บริษัทเดิม: ${item.resolution.vendorName} (ไม่ได้สร้างรายการใหม่)`}</p>
                        ) : (
                          <div className="mt-3 space-y-2">
                            {item.matches.map((match) => (
                              <div key={match.id} className="flex flex-col gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0"><p className="break-words text-[10px] font-black text-slate-800">{match.name}</p><p className="mt-0.5 text-[8px] font-bold text-slate-500">{match.status} · ตรงกัน {Math.round(Number(match.match_score) * 100)}%</p></div>
                                {item.reason === 'SIMILAR' && <button type="button" onClick={() => onUseExisting(item.id, match)} disabled={Boolean(resolvingId)} className="min-h-10 shrink-0 rounded-xl border border-slate-300 bg-white px-3 text-[9px] font-black text-slate-700 disabled:opacity-50">ใช้บริษัทนี้</button>}
                              </div>
                            ))}
                            {item.reason === 'SIMILAR' && <button type="button" onClick={() => onCreateNew(item.id)} disabled={Boolean(resolvingId)} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-[9px] font-black text-white shadow-sm disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin" /> : <Building2 size={14} />}ยืนยันว่าเป็นคนละบริษัทและเพิ่มใหม่</button>}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default VendorImportReviewDialog;
