import React, { useState, useEffect } from 'react';
import { User } from './types';
import { LanguageProvider, useTranslation } from './context/LanguageContext';
import Auth from './components/Auth';
import UserPanel from './components/UserPanel';
import AdminPanel from './components/AdminPanel';
import LanguageSwitcher from './components/LanguageSwitcher';
import { Shield, Loader2, LogOut } from 'lucide-react';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/ToastProvider';
import VerifyPage from './components/VerifyPage';

const AppContent: React.FC = () => {
  const { t } = useTranslation();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPath, setCurrentPath] = useState(window.location.pathname);

  useEffect(() => {
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', handleLocationChange);
    handleLocationChange();

    try {
      document.documentElement.classList.remove('dark');
      localStorage.removeItem('safety_pass_theme');
      const savedUser = localStorage.getItem('safety_pass_current_user');
      if (savedUser) {
        setCurrentUser(JSON.parse(savedUser));
      }
    } catch (err) {
      console.error('Init error:', err);
    } finally {
      setLoading(false);
    }
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  const handleLogin = (user: User) => {
    setCurrentUser(user);
    localStorage.setItem('safety_pass_current_user', JSON.stringify(user));
  };

  const handleLogout = () => {
    if(window.confirm("คุณต้องการออกจากระบบใช่หรือไม่?")) {
      setCurrentUser(null);
      localStorage.removeItem('safety_pass_current_user');
    }
  };

  if (currentPath.startsWith('/verify/')) {
    return <VerifyPage />;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans">
      
      {/* --- 📱 GLOBAL HEADER: ปรับให้เล็กลงพิเศษ และเลื่อนหายไปตามเนื้อหา (ไม่ Sticky) --- */}
      <header className="bg-[#0f172a] text-white py-2.5 shadow-md">
        <div className="max-w-7xl mx-auto px-4 flex justify-between items-center gap-2">
          
          {/* Logo Section - Compact Style */}
          <div className="flex items-center gap-2 min-w-0">
            <div className="bg-blue-600 p-1.5 rounded-lg shadow-lg shadow-blue-500/10 flex-shrink-0">
              <Shield size={16} className="md:w-5 md:h-5 text-white" />
            </div>
            <div className="flex flex-col min-w-0">
              <h1 className="text-[10px] md:text-sm font-black tracking-tighter uppercase leading-none truncate">
                {t('app.name')}
              </h1>
              <p className="text-[6px] md:text-[8px] text-blue-400 uppercase tracking-tighter font-bold mt-0.5 truncate opacity-80">
                {t('app.tagline')}
              </p>
            </div>
          </div>

          {/* Actions Section - Space Saving */}
          <div className="flex items-center gap-2 md:gap-6 flex-shrink-0">
            {/* ย่อขนาดตัวเลือกภาษาในมือถือ */}
            <div className="scale-75 md:scale-90 origin-right">
               <LanguageSwitcher />
            </div>

            {currentUser && (
              <div className="flex items-center gap-2 md:gap-4 border-l border-white/10 pl-2 md:pl-6">
                <div className="text-right hidden lg:block">
                  <p className="text-xs font-black leading-none">{currentUser.name}</p>
                  <p className="text-[8px] text-slate-500 font-bold uppercase tracking-tighter mt-1">
                    {currentUser.role}
                  </p>
                </div>
                <button 
                  onClick={handleLogout}
                  className="flex items-center gap-1.5 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white p-1.5 md:px-3 md:py-1.5 rounded-lg text-[9px] font-black transition-all border border-red-500/20"
                  title="Logout"
                >
                  <LogOut size={12} />
                  <span className="hidden md:inline uppercase">{t('common.logout')}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-grow">
        {!currentUser ? (
          <Auth onLogin={handleLogin} />
        ) : (
          <ProtectedRoute
            user={currentUser}
            requiredRole={currentUser.role === 'ADMIN' ? 'ADMIN' : 'USER'}
          >
            {currentUser.role === 'ADMIN' ? (
              <AdminPanel />
            ) : (
              <UserPanel user={currentUser} onUserUpdate={handleLogin} />
            )}
          </ProtectedRoute>
        )}
      </main>

      {/* Footer - Compact */}
      <footer className="bg-white border-t border-slate-200 py-6 mt-6">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-slate-400 text-[9px] font-bold uppercase tracking-[0.2em]">
            © 2026 SafetyPass • Enterprise System
            <br />
            <span className="text-slate-300 opacity-60 font-medium">Internal Use Only</span>
          </p>
        </div>
      </footer>
    </div>
  );
};

const App: React.FC = () => (
  <LanguageProvider>
    <ToastProvider>
      <ErrorBoundary>
        <AppContent />
      </ErrorBoundary>
    </ToastProvider>
  </LanguageProvider>
);

export default App;