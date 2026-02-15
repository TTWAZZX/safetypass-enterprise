import React from 'react';
import { User } from '../types';
import { ShieldAlert, Lock, Home, LogIn } from 'lucide-react';

interface ProtectedRouteProps {
  user: User | null;
  requiredRole: 'ADMIN' | 'USER';
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  user,
  requiredRole,
  children
}) => {
  // 1. ไม่มี user → บล็อกและแสดงหน้า Login Required
  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-[70vh] p-6 animate-in fade-in zoom-in duration-500 text-left">
        <div className="bg-white dark:bg-slate-900 p-8 md:p-12 rounded-[2.5rem] shadow-2xl shadow-slate-200/50 border border-slate-100 dark:border-slate-800 max-w-md w-full text-center">
          <div className="w-20 h-20 bg-red-50 dark:bg-red-900/20 text-red-500 rounded-[2rem] flex items-center justify-center mx-auto mb-8 border border-red-100 dark:border-red-900/30 shadow-inner">
            <Lock size={40} strokeWidth={1.5} />
          </div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
            Access Denied
          </h2>
          <p className="text-[10px] font-black text-red-500 uppercase tracking-[0.2em] mt-2 mb-8">
            Security Clearance Required
          </p>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-10 leading-relaxed">
            กรุณาเข้าสู่ระบบด้วยบัญชีผู้ใช้งานของคุณเพื่อดำเนินการต่อในส่วนนี้
          </p>
          <button 
            onClick={() => window.location.reload()}
            className="w-full bg-slate-900 dark:bg-blue-600 text-white font-black py-4 rounded-2xl shadow-xl transition-all flex items-center justify-center gap-3 active:scale-95 uppercase text-xs tracking-widest"
          >
            <LogIn size={16} />
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  // 2. Role ไม่ตรง → บล็อกและแสดงหน้า Unauthorized
  if (user.role !== requiredRole) {
    return (
      <div className="flex items-center justify-center min-h-[70vh] p-6 animate-in fade-in zoom-in duration-500 text-left">
        <div className="bg-white dark:bg-slate-900 p-8 md:p-12 rounded-[2.5rem] shadow-2xl shadow-slate-200/50 border border-slate-100 dark:border-slate-800 max-w-md w-full text-center">
          <div className="w-20 h-20 bg-amber-50 dark:bg-amber-900/20 text-amber-500 rounded-[2rem] flex items-center justify-center mx-auto mb-8 border border-amber-100 dark:border-amber-900/30 shadow-inner">
            <ShieldAlert size={40} strokeWidth={1.5} />
          </div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
            Unauthorized
          </h2>
          <p className="text-[10px] font-black text-amber-600 uppercase tracking-[0.2em] mt-2 mb-8">
            Restricted System Node
          </p>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-10 leading-relaxed">
            ขออภัย คุณไม่มีสิทธิ์เข้าถึงหน้านี้ โปรดติดต่อผู้ดูแลระบบหากคุณคิดว่านี่คือข้อผิดพลาด
          </p>
          <button 
            onClick={() => window.location.href = '/'}
            className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl shadow-xl transition-all flex items-center justify-center gap-3 active:scale-95 uppercase text-xs tracking-widest"
          >
            <Home size={16} />
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  // 3. ผ่านเงื่อนไขทั้งหมด → แสดงเนื้อหาภายใน
  return <>{children}</>;
};

export default ProtectedRoute;