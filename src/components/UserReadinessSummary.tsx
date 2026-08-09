import React from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, HardHat, ShieldCheck, Truck } from 'lucide-react';
import {
  ReadinessAction, UserReadinessResult, UserReadinessTrack,
} from '../services/userReadiness';

interface Props {
  language: 'th' | 'en';
  readiness: UserReadinessResult;
  onAction: (action: ReadinessAction) => void;
}

const aggregateCopy = {
  th: {
    eyebrow: 'สถานะความพร้อมวันนี้',
    SUSPENDED: { title: 'ไม่สามารถเข้าพื้นที่ได้', description: 'บัญชีถูกระงับชั่วคราว กรุณาติดต่อเจ้าหน้าที่ Safety' },
    NO_PROGRAM: { title: 'ยังไม่มีประเภทสิทธิ์ที่เปิดใช้งาน', description: 'กรุณาติดต่อเจ้าหน้าที่เพื่อตรวจสอบประเภทงานของคุณ' },
    NOT_READY: { title: 'ยังไม่พร้อมเข้าพื้นที่', description: 'กรุณาดำเนินการตามรายการของแต่ละประเภทงานให้ครบ' },
    PARTIALLY_READY: { title: 'พร้อมเข้าพื้นที่บางประเภท', description: 'ใช้สิทธิ์ได้เฉพาะประเภทที่แสดงสถานะพร้อมเท่านั้น' },
    READY: { title: 'พร้อมเข้าพื้นที่', description: 'สิทธิ์ตามประเภทงานของคุณพร้อมใช้งาน' },
  },
  en: {
    eyebrow: "Today's readiness",
    SUSPENDED: { title: 'Site access unavailable', description: 'Your account is temporarily suspended. Please contact the Safety team.' },
    NO_PROGRAM: { title: 'No active access program', description: 'Contact the Safety team to review your work program.' },
    NOT_READY: { title: 'Not ready for site access', description: 'Complete the outstanding steps shown for each work program.' },
    PARTIALLY_READY: { title: 'Ready for selected access only', description: 'Use only the work program explicitly marked as ready.' },
    READY: { title: 'Ready for site access', description: 'Your assigned work-program access is ready to use.' },
  },
} as const;

const toneClasses = {
  danger: 'border-red-200 bg-red-50 text-red-950',
  warning: 'border-amber-200 bg-amber-50 text-amber-950',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-950',
} as const;

const iconClasses = {
  danger: 'bg-red-100 text-red-700',
  warning: 'bg-amber-100 text-amber-700',
  success: 'bg-emerald-100 text-emerald-700',
} as const;

const trackCopy = (track: UserReadinessTrack, language: 'th' | 'en') => {
  const contractor = language === 'th' ? 'ผู้รับเหมา (Contractor)' : 'Contractor';
  const supplier = 'Supplier & Outsource';
  const copy = language === 'th' ? {
    READY_CONTRACTOR: { status: track.nearExpiry ? 'พร้อม • ใกล้หมดอายุ' : 'พร้อมเข้าพื้นที่', detail: 'อบรมรายปีและใบอนุญาตเข้างาน 5 วันพร้อมใช้งาน', action: 'ดูใบอนุญาต' },
    READY_SUPPLIER: { status: track.nearExpiry ? 'พร้อม • ใกล้หมดอายุ' : 'พร้อมเข้าพื้นที่', detail: 'สอบผ่านและอยู่ในช่วงวันที่ได้รับอนุญาต', action: 'ดูบัตร' },
    INDUCTION_REQUIRED: { status: 'ยังไม่พร้อม', detail: 'ขั้นตอน 1: ต้องผ่านการอบรมความปลอดภัยรายปี', action: 'เริ่มอบรม' },
    PERMIT_REQUIRED: { status: 'ยังไม่พร้อม', detail: 'อบรมผ่านแล้ว • ขั้นตอน 2: ขอใบอนุญาตเข้างาน 5 วันที่หน้างาน', action: 'ขอใบอนุญาต' },
    SUPPLIER_EXAM_REQUIRED: { status: 'ยังไม่พร้อม', detail: 'ต้องสอบ Supplier & Outsource ให้ผ่านก่อนเข้าพื้นที่', action: 'เริ่มสอบ' },
    SUPPLIER_ACCESS_UPCOMING: { status: 'ยังไม่ถึงช่วงอนุญาต', detail: 'สอบผ่านแล้ว แต่วันที่เริ่มสิทธิ์ยังมาไม่ถึง', action: 'ดูรายละเอียด' },
    SUPPLIER_ACCESS_ENDED: { status: 'ช่วงอนุญาตสิ้นสุดแล้ว', detail: 'กรุณาแก้ไขหรือต่ออายุช่วงวันที่เข้าพื้นที่', action: 'แก้ไขสิทธิ์' },
  } : {
    READY_CONTRACTOR: { status: track.nearExpiry ? 'Ready • Expiring soon' : 'Ready for site access', detail: 'Annual induction and the five-day work permit are active.', action: 'View permit' },
    READY_SUPPLIER: { status: track.nearExpiry ? 'Ready • Expiring soon' : 'Ready for site access', detail: 'Assessment passed and the access-date window is active.', action: 'View card' },
    INDUCTION_REQUIRED: { status: 'Not ready', detail: 'Step 1: complete the annual safety induction.', action: 'Start induction' },
    PERMIT_REQUIRED: { status: 'Not ready', detail: 'Training passed • Step 2: obtain the five-day on-site work permit.', action: 'Get permit' },
    SUPPLIER_EXAM_REQUIRED: { status: 'Not ready', detail: 'Pass the Supplier & Outsource assessment before site access.', action: 'Start assessment' },
    SUPPLIER_ACCESS_UPCOMING: { status: 'Access starts later', detail: 'Assessment passed, but the approved access window has not started.', action: 'View details' },
    SUPPLIER_ACCESS_ENDED: { status: 'Access window ended', detail: 'Update or renew the approved site-access dates.', action: 'Edit access' },
  };

  const readyKey = track.program === 'CONTRACTOR' ? 'READY_CONTRACTOR' : 'READY_SUPPLIER';
  const content = track.status === 'READY' ? copy[readyKey] : copy[track.status];
  return { title: track.program === 'CONTRACTOR' ? contractor : supplier, ...content };
};

const UserReadinessSummary: React.FC<Props> = ({ language, readiness, onAction }) => {
  const content = aggregateCopy[language][readiness.code];
  const Icon = readiness.tone === 'success' ? CheckCircle2 : readiness.tone === 'danger' ? AlertTriangle : ShieldCheck;
  const countLabel = language === 'th'
    ? `พร้อม ${readiness.readyCount} จาก ${readiness.totalCount} ประเภท`
    : `${readiness.readyCount} of ${readiness.totalCount} programs ready`;

  return (
    <section aria-labelledby="user-readiness-title" className={`rounded-[1.75rem] border p-5 shadow-sm ${toneClasses[readiness.tone]}`}>
      <div className="flex min-w-0 items-start gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${iconClasses[readiness.tone]}`}>
          <Icon aria-hidden="true" size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] opacity-75">{aggregateCopy[language].eyebrow}</p>
            {readiness.totalCount > 1 && <span className="rounded-full border border-current/15 bg-white/70 px-2 py-1 text-[9px] font-black">{countLabel}</span>}
          </div>
          <h2 id="user-readiness-title" className="mt-1 text-lg font-black leading-tight">{content.title}</h2>
          <p className="mt-1 text-xs font-bold leading-relaxed opacity-80">{content.description}</p>
        </div>
      </div>

      {readiness.tracks.length > 0 && (
        <div className={`mt-4 grid gap-2 ${readiness.tracks.length > 1 ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
          {readiness.tracks.map((track) => {
            const item = trackCopy(track, language);
            const TrackIcon = track.program === 'CONTRACTOR' ? HardHat : Truck;
            const readyClasses = track.ready
              ? track.nearExpiry ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-emerald-200 bg-white/80 text-emerald-950'
              : 'border-amber-200 bg-white/80 text-amber-950';
            return (
              <div key={track.program} className={`flex flex-col justify-between gap-3 rounded-2xl border p-3.5 ${readyClasses}`}>
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm"><TrackIcon size={19} aria-hidden="true" /></span>
                  <div className="min-w-0">
                    <p className="text-xs font-black">{item.title}</p>
                    <p className={`mt-0.5 text-[10px] font-black ${track.ready && !track.nearExpiry ? 'text-emerald-700' : 'text-amber-800'}`}>{item.status}</p>
                    <p className="mt-1 text-[10px] font-bold leading-relaxed opacity-80">{item.detail}</p>
                  </div>
                </div>
                {track.primaryAction !== 'NONE' && (
                  <button type="button" onClick={() => onAction(track.primaryAction)} className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[10px] font-black text-white transition active:scale-[0.98] ${track.ready && !track.nearExpiry ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-amber-700 hover:bg-amber-800'}`}>
                    {item.action}<ArrowRight aria-hidden="true" size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default UserReadinessSummary;
