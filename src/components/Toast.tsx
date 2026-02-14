import React, { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

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

  const styles = {
    success: 'bg-emerald-600',
    error: 'bg-red-600',
    warning: 'bg-yellow-500',
    info: 'bg-blue-600'
  };

  const Icon = {
    success: CheckCircle,
    error: AlertCircle,
    warning: AlertCircle,
    info: Info
  }[type];

  return (
    <div
      className={`flex items-center justify-between gap-4 text-white px-6 py-4 rounded-2xl shadow-xl animate-in slide-in-from-right duration-300 ${styles[type]}`}
    >
      <div className="flex items-center gap-3">
        <Icon className="w-5 h-5" />
        <span className="text-sm font-semibold">{message}</span>
      </div>

      <button onClick={() => onClose(id)}>
        <X className="w-4 h-4 opacity-80 hover:opacity-100" />
      </button>
    </div>
  );
};

export default Toast;
