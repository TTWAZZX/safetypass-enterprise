import React from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react';
import { UserReadinessResult } from '../services/userReadiness';

interface Props {
  language: 'th' | 'en';
  readiness: UserReadinessResult;
  onPrimaryAction: () => void;
}

const copy = {
  th: {
    eyebrow: 'สถานะความพร้อมวันนี้',
    SUSPENDED: { title: 'บัญชีถูกระงับชั่วคราว', description: 'ยังไม่สามารถเข้าพื้นที่หรือทำแบบทดสอบได้ กรุณาติดต่อเจ้าหน้าที่ Safety', action: '', next: 'สิ่งที่ต้องทำ: ติดต่อเจ้าหน้าที่เพื่อตรวจสอบสถานะบัญชี' },
    INDUCTION_REQUIRED: { title: 'ยังไม่พร้อมเข้าพื้นที่', description: 'ต้องผ่านการอบรมความปลอดภัยรายปีก่อนดำเนินการขั้นตอนถัดไป', action: 'เริ่มการอบรม', next: 'สิ่งที่ต้องทำ: ทำแบบทดสอบ Induction ให้ผ่าน' },
    PERMIT_REQUIRED: { title: 'ผ่านการอบรมแล้ว เหลืออีก 1 ขั้นตอน', description: 'กรุณาดำเนินการขอใบอนุญาตเข้าทำงานก่อนเข้าพื้นที่', action: 'ขอใบอนุญาตทำงาน', next: 'สิ่งที่ต้องทำ: ขอ Work Permit ให้สำเร็จ' },
    READY: { title: 'พร้อมเข้าพื้นที่', description: 'การอบรมและใบอนุญาตทำงานของคุณพร้อมใช้งาน', action: 'ดูใบอนุญาต', next: 'ไม่มีรายการค้างในขณะนี้' },
  },
  en: {
    eyebrow: "Today's readiness",
    SUSPENDED: { title: 'Account temporarily suspended', description: 'Site access and examinations are unavailable. Please contact the Safety team.', action: '', next: 'Next step: contact the Safety team to review your account.' },
    INDUCTION_REQUIRED: { title: 'Not ready for site access', description: 'Complete the annual safety induction before continuing.', action: 'Start induction', next: 'Next step: pass the Induction examination.' },
    PERMIT_REQUIRED: { title: 'Training passed — one step remaining', description: 'Obtain a work permit before entering the work area.', action: 'Get work permit', next: 'Next step: complete your Work Permit.' },
    READY: { title: 'Ready for site access', description: 'Your training and work permit are ready to use.', action: 'View permit', next: 'No outstanding actions right now.' },
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

const buttonClasses = {
  danger: 'bg-red-700 hover:bg-red-800',
  warning: 'bg-amber-700 hover:bg-amber-800',
  success: 'bg-emerald-700 hover:bg-emerald-800',
} as const;

const UserReadinessSummary: React.FC<Props> = ({ language, readiness, onPrimaryAction }) => {
  const content = copy[language][readiness.code];
  const Icon = readiness.tone === 'success' ? CheckCircle2 : readiness.tone === 'danger' ? AlertTriangle : ShieldCheck;

  return (
    <section aria-labelledby="user-readiness-title" className={`rounded-[1.75rem] border p-5 shadow-sm ${toneClasses[readiness.tone]}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${iconClasses[readiness.tone]}`}>
            <Icon aria-hidden="true" size={22} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] opacity-70">{copy[language].eyebrow}</p>
            <h2 id="user-readiness-title" className="mt-1 text-lg font-black leading-tight">{content.title}</h2>
            <p className="mt-1 text-xs font-bold leading-relaxed opacity-80">{content.description}</p>
          </div>
        </div>
        {readiness.primaryAction !== 'NONE' && (
          <button type="button" onClick={onPrimaryAction} className={`flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-black text-white shadow-sm transition active:scale-95 ${buttonClasses[readiness.tone]}`}>
            {content.action}<ArrowRight aria-hidden="true" size={15} />
          </button>
        )}
      </div>
      <div className="mt-4 rounded-xl border border-current/10 bg-white/65 px-3 py-2.5 text-[11px] font-bold leading-relaxed">{content.next}</div>
    </section>
  );
};

export default UserReadinessSummary;

