import React, { Component, ReactNode, ErrorInfo } from 'react';
import { ShieldAlert, RefreshCw } from 'lucide-react';

// ✅ นิยาม Interface ให้ชัดเจน
interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// ✅ ระบุ Generic <Props, State> ที่หัว Class
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  
  // ✅ วิธีแก้จุดแดงที่ State: ประกาศ Type และค่าเริ่มต้นที่นี่เลย (ไม่ผ่าน constructor)
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    // อัปเดต state เพื่อให้การเรนเดอร์ครั้งถัดไปแสดง UI สำรอง
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // บันทึก Log ข้อผิดพลาดเข้า Console
    console.error('SYSTEM_CRITICAL_FAILURE:', error, errorInfo);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  public render(): ReactNode {
    // ✅ เรียกใช้ผ่าน this.state ปกติ (ระบุ Type แล้วจะไม่แดง)
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#f8fafc] p-6 text-left font-sans">
          <div className="bg-white p-8 md:p-10 rounded-[2.5rem] shadow-2xl shadow-slate-200/50 w-full max-w-md border border-slate-100 animate-in zoom-in duration-300">
            
            <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mb-8 border border-red-100 shadow-inner">
              <ShieldAlert size={32} strokeWidth={2} />
            </div>

            <div className="space-y-2 mb-8">
                <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight leading-none">
                  System Interrupted
                </h2>
                <p className="text-[10px] font-black text-red-500 uppercase tracking-[0.2em]">
                  Security Protocol Encountered an Error
                </p>
            </div>

            <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100 mb-8">
                <p className="text-sm text-slate-600 font-bold leading-relaxed">
                  ขออภัย ระบบขัดข้องชั่วคราว ข้อมูลบางส่วนอาจไม่สามารถแสดงผลได้ในขณะนี้
                </p>
                <div className="mt-4 pt-4 border-t border-slate-200/50">
                    <p className="text-[9px] font-mono text-slate-400 truncate uppercase">
                      Code: {this.state.error?.name || 'ERR_RECOVERY_MODE'}
                    </p>
                </div>
            </div>

            <button
              onClick={this.handleReload}
              className="w-full bg-slate-900 hover:bg-black text-white font-black py-4 rounded-2xl shadow-xl transition-all flex items-center justify-center gap-3 active:scale-95 uppercase text-[10px] tracking-[0.2em]"
            >
              <RefreshCw size={14} />
              Restore System
            </button>

            <p className="mt-6 text-center text-[9px] font-bold text-slate-400 uppercase tracking-widest opacity-60">
              SafetyPass • Enterprise Data Recovery
            </p>
          </div>
        </div>
      );
    }

    // ✅ วิธีแก้จุดแดงที่ props: เข้าถึงผ่าน this.props.children ตรงๆ 
    // เพราะเราประกาศ <ErrorBoundaryProps> ไว้ข้างบนแล้ว
    return this.props.children;
  }
}

export default ErrorBoundary;