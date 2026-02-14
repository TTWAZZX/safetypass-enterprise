import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useCallback
} from 'react';

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

  const removeToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const showToast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = ++toastId;

      setToasts(prev => [...prev, { id, message, type }]);

      // ✅ Auto Remove 4 วิ
      setTimeout(() => {
        removeToast(id);
      }, 4000);
    },
    []
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}

      {/* ===== Toast Container ===== */}
      <div className="fixed top-6 right-6 z-[9999] space-y-4">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`px-6 py-4 rounded-2xl shadow-xl text-white font-semibold transition-all duration-300 animate-slide-in ${
              toast.type === 'success'
                ? 'bg-emerald-600'
                : toast.type === 'error'
                ? 'bg-red-600'
                : toast.type === 'warning'
                ? 'bg-orange-500'
                : 'bg-blue-600'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
