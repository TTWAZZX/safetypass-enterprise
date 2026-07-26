import React from 'react';
import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react';

type AsyncStateVariant = 'loading' | 'empty' | 'error';

interface AsyncStateProps {
  variant: AsyncStateVariant;
  title?: string;
  description?: string;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
}

const defaults: Record<AsyncStateVariant, { title: string; description: string }> = {
  loading: { title: 'กำลังโหลดข้อมูล', description: 'กรุณารอสักครู่ ระบบกำลังซิงก์ข้อมูลล่าสุด' },
  empty: { title: 'ยังไม่มีข้อมูล', description: 'เมื่อมีข้อมูลใหม่ รายการจะแสดงในส่วนนี้' },
  error: { title: 'โหลดข้อมูลไม่สำเร็จ', description: 'กรุณาตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง' },
};

const AsyncState: React.FC<AsyncStateProps> = ({
  variant, title, description, onRetry, compact = false, className = '',
}) => {
  const content = defaults[variant];
  const iconBox = variant === 'error'
    ? 'bg-red-50 text-red-500'
    : variant === 'empty'
      ? 'bg-slate-100 text-slate-400'
      : 'bg-blue-50 text-blue-600';

  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live={variant === 'error' ? 'assertive' : 'polite'}
      className={`flex w-full flex-col items-center justify-center text-center ${compact ? 'min-h-48 px-5 py-10' : 'min-h-[360px] px-6 py-16'} ${className}`}
    >
      <div className={`mb-4 flex h-14 w-14 items-center justify-center rounded-2xl ${iconBox}`}>
        {variant === 'loading' && <Loader2 size={26} className="animate-spin" aria-hidden="true" />}
        {variant === 'empty' && <Inbox size={26} aria-hidden="true" />}
        {variant === 'error' && <AlertTriangle size={26} aria-hidden="true" />}
      </div>
      <h3 className="text-sm font-black text-slate-800">{title || content.title}</h3>
      <p className="mt-2 max-w-md text-[11px] font-bold leading-relaxed text-slate-400">
        {description || content.description}
      </p>
      {variant === 'error' && onRetry && (
        <button
          type="button"
          onClick={() => onRetry()}
          className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 text-[10px] font-black text-white transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <RefreshCw size={15} aria-hidden="true" /> ลองอีกครั้ง
        </button>
      )}
    </div>
  );
};

export default AsyncState;
