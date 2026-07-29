import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useCallback
} from 'react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export const useToastContext = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToastContext must be used inside ToastProvider');
  }
  return ctx;
};

interface Props {
  children: ReactNode;
}

let toastId = 0;

export const ToastProvider: React.FC<Props> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = ++toastId;
      setToasts(prev => [...prev, { id, message, type }]);

      // ✅ Auto Remove 4 วิ
      setTimeout(() => {
        removeToast(id);
      }, 4000);
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}

      {/* ===== 📱 TOAST CONTAINER: ปรับตำแหน่งให้เหมาะสมกับมือถือ ===== */}
      <div className="fixed top-4 md:top-6 left-1/2 -translate-x-1/2 md:left-auto md:right-6 md:translate-x-0 z-[9999] flex flex-col items-center md:items-end gap-3 w-full max-w-[90%] md:max-w-sm pointer-events-none">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`
              pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl border backdrop-blur-md
              animate-in slide-in-from-top-4 fade-in duration-300 w-full md:w-auto
              ${
                toast.type === 'success'
                  ? 'bg-emerald-700/95 border-emerald-600 text-white'
                  : toast.type === 'error'
                  ? 'bg-red-700/95 border-red-600 text-white'
                  : toast.type === 'warning'
                  ? 'bg-amber-800/95 border-amber-700 text-white'
                  : 'bg-blue-700/95 border-blue-600 text-white'
              }
            `}
          >
            {/* Icon ตามประเภท */}
            <div className="flex-shrink-0">
              {toast.type === 'success' && <CheckCircle2 size={18} />}
              {toast.type === 'error' && <AlertCircle size={18} />}
              {toast.type === 'warning' && <AlertTriangle size={18} />}
              {toast.type === 'info' && <Info size={18} />}
            </div>

            <p className="text-xs md:text-sm font-black uppercase tracking-tight flex-1">
              {toast.message}
            </p>

            <button 
              onClick={() => removeToast(toast.id)}
              aria-label="ปิดข้อความแจ้งเตือน"
              className="p-1 hover:bg-white/20 rounded-lg transition-colors"
            >
              <X size={14} className="opacity-70" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
