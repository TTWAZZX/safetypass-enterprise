import React, { useEffect } from 'react';
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastProps {
  id: string;
  message: string;
  type: ToastType;
  onClose: (id: string) => void;
  duration?: number;
}

const Toast: React.FC<ToastProps> = ({
  id,
  message,
  type,
  onClose,
  duration = 4000
}) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose(id);
    }, duration);

    return () => clearTimeout(timer);
  }, [id, duration, onClose]);

  // ✅ ปรับโทนสีให้พรีเมียมขึ้นด้วย Gradient และ Shadow
  const styles = {
    success: 'bg-emerald-600/95 border-emerald-500 shadow-emerald-200/50',
    error: 'bg-rose-600/95 border-rose-500 shadow-rose-200/50',
    warning: 'bg-amber-500/95 border-amber-400 shadow-amber-200/50',
    info: 'bg-blue-600/95 border-blue-500 shadow-blue-200/50'
  };

  // ✅ แมพไอคอนให้ตรงจุดประสงค์
  const icons = {
    success: <CheckCircle2 size={18} strokeWidth={2.5} />,
    error: <AlertCircle size={18} strokeWidth={2.5} />,
    warning: <AlertTriangle size={18} strokeWidth={2.5} />,
    info: <Info size={18} strokeWidth={2.5} />
  };

  return (
    <div
      className={`
        flex items-center justify-between gap-4 text-white px-5 py-3.5 
        rounded-2xl shadow-2xl border backdrop-blur-md
        animate-in slide-in-from-top-4 fade-in duration-300
        w-full sm:w-auto min-w-[280px] max-w-md
        ${styles[type]}
      `}
    >
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0 opacity-90">
          {icons[type]}
        </div>
        <p className="text-[13px] font-black uppercase tracking-tight leading-tight">
          {message}
        </p>
      </div>

      <button 
        onClick={() => onClose(id)}
        className="flex-shrink-0 p-1.5 hover:bg-white/20 rounded-xl transition-all active:scale-75 group"
      >
        <X size={16} className="opacity-60 group-hover:opacity-100 transition-opacity" />
      </button>
    </div>
  );
};

export default Toast;