import React from 'react';
import { User } from '../types';
import { ShieldAlert } from 'lucide-react';

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
  // ไม่มี user → block
  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-white dark:bg-slate-900 p-10 rounded-3xl shadow-xl border dark:border-slate-700 text-center transition-colors">
          <ShieldAlert className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-black text-slate-900 dark:text-white">
            Access Denied
          </h2>
          <p className="text-slate-500 dark:text-slate-400 mt-2">
            Please login to continue.
          </p>
        </div>
      </div>
    );
  }

  // Role ไม่ตรง → block
  if (user.role !== requiredRole) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-white dark:bg-slate-900 p-10 rounded-3xl shadow-xl border dark:border-slate-700 text-center transition-colors">
          <ShieldAlert className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-black text-slate-900 dark:text-white">
            Unauthorized
          </h2>
          <p className="text-slate-500 dark:text-slate-400 mt-2">
            You don’t have permission to access this page.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default ProtectedRoute;
