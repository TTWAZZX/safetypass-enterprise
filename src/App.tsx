import React, { useState, useEffect } from 'react';
import { User } from './types';
import { LanguageProvider, useTranslation } from './context/LanguageContext';
import Auth from './components/Auth';
import UserPanel from './components/UserPanel';
import AdminPanel from './components/AdminPanel';
import LanguageSwitcher from './components/LanguageSwitcher';
import { Shield, Loader2, LogOut, User as UserIcon } from 'lucide-react';
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
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans relative">
      
      {/* --- 🌟 REDESIGNED HEADER: Modern & Integrated --- */}
      <header className="bg-slate-900 text-white shadow-lg sticky top-0 z-50 backdrop-blur-md bg-opacity-95 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 h-16 flex justify-between items-center gap-4">
          
          {/* Logo Section */}
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-2 rounded-xl shadow-lg shadow-blue-500/20 ring-1 ring-white/10">
              <Shield size={20} className="text-white" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-sm font-black tracking-tight uppercase leading-none text-white">
                {t('app.name')}
              </h1>
              <p className="text-[9px] text-slate-400 uppercase tracking-[0.2em] font-bold mt-0.5">
                {t('app.tagline')}
              </p>
            </div>
          </div>

          {/* Actions Section */}
          <div className="flex items-center gap-3 md:gap-5">
            {/* Language Switcher */}
            <div className="bg-slate-800/50 rounded-lg p-1 border border-slate-700">
               <LanguageSwitcher />
            </div>

            {currentUser && (
              <div className="flex items-center gap-3 pl-3 md:pl-5 border-l border-slate-700">
                
                {/* User Info (Hidden on Mobile) */}
                <div className="text-right hidden md:block">
                  <p className="text-xs font-bold text-white leading-none mb-0.5">{currentUser.name}</p>
                  <div className="flex items-center justify-end gap-1">
                     <span className={`w-1.5 h-1.5 rounded-full ${currentUser.role === 'ADMIN' ? 'bg-amber-500' : 'bg-emerald-500'}`}></span>
                     <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wide">
                       {currentUser.role}
                     </p>
                  </div>
                </div>

                {/* Logout Button */}
                <button 
                  onClick={handleLogout}
                  className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white px-3 py-2 rounded-xl text-[10px] font-black transition-all border border-red-500/20 active:scale-95 group"
                  title="Logout"
                >
                  <LogOut size={14} className="group-hover:translate-x-0.5 transition-transform" />
                  <span className="hidden md:inline uppercase tracking-widest">Logout</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-grow relative z-0">
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

      {/* Footer - Integrated Style */}
      <footer className="bg-slate-50 border-t border-slate-200 py-8 mt-auto">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 mb-2 opacity-50 grayscale hover:grayscale-0 transition-all duration-500">
             <Shield size={14} className="text-blue-500"/>
             <span className="text-xs font-black text-slate-700 tracking-tight">SafetyPass Enterprise</span>
          </div>
          <p className="text-slate-400 text-[10px] font-bold uppercase tracking-[0.2em]">
            © 2026 Secure Access System • Internal Use Only
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