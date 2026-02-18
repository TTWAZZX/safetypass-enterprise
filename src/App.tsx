import React, { useState, useEffect } from 'react';
import { User } from './types';
import { LanguageProvider, useTranslation } from './context/LanguageContext';
import Auth from './components/Auth';
import UserPanel from './components/UserPanel';
import AdminPanel from './components/AdminPanel';
import LanguageSwitcher from './components/LanguageSwitcher';
import ExamHistory from './components/ExamHistory'; 
import { 
  Shield, 
  Loader2, 
  LogOut, 
  User as UserIcon, 
  LayoutDashboard, 
  History, 
  QrCode,
  Home
} from 'lucide-react';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/ToastProvider';
import VerifyPage from './components/VerifyPage';
import { PageSkeleton } from './components/Skeleton'; 

const AppContent: React.FC = () => {
  const { t, language } = useTranslation();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  
  const [activeTab, setActiveTab] = useState<'HOME' | 'LOGS'>('HOME');

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
      setTimeout(() => setLoading(false), 800);
    }
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  const handleLogin = (user: User) => {
    setCurrentUser(user);
    localStorage.setItem('safety_pass_current_user', JSON.stringify(user));
  };

  const handleLogout = () => {
    if(window.confirm(language === 'th' ? "คุณต้องการออกจากระบบใช่หรือไม่?" : "Are you sure you want to logout?")) {
      setCurrentUser(null);
      localStorage.removeItem('safety_pass_current_user');
      setActiveTab('HOME'); 
    }
  };

  const scrollToQR = () => {
    if (activeTab !== 'HOME') {
      setActiveTab('HOME');
    }
    setTimeout(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }, 100);
  };

  if (currentPath.startsWith('/verify/')) {
    return <VerifyPage />;
  }

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans relative">
      
      {/* --- 🌟 HEADER: ปรับจาก sticky เป็น relative เพื่อให้เลื่อนหายไปเมื่อเลื่อนลง --- */}
      <header className="bg-slate-900 text-white shadow-lg relative z-50 border-b border-slate-800">
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
            <div className="bg-slate-800/50 rounded-lg p-1 border border-slate-700">
               <LanguageSwitcher />
            </div>

            {currentUser && (
              <div className="flex items-center gap-3 pl-3 md:pl-5 border-l border-slate-700">
                <div className="text-right hidden md:block">
                  <p className="text-xs font-bold text-white leading-none mb-0.5">{currentUser.name}</p>
                  <div className="flex items-center justify-end gap-1">
                     <span className={`w-1.5 h-1.5 rounded-full ${currentUser.role === 'ADMIN' ? 'bg-amber-500' : 'bg-emerald-500'}`}></span>
                     <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wide">
                       {currentUser.role}
                     </p>
                  </div>
                </div>

                <button 
                  onClick={handleLogout}
                  className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white px-3 py-2 rounded-xl text-[10px] font-black transition-all border border-red-500/20 active:scale-95 group"
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
              <div className="animate-in fade-in duration-500">
                {activeTab === 'HOME' ? (
                  <UserPanel user={currentUser} onUserUpdate={handleLogin} />
                ) : (
                  <div className="max-w-2xl mx-auto p-4">
                    <ExamHistory userId={currentUser.id} onBack={() => setActiveTab('HOME')} />
                  </div>
                )}
              </div>
            )}
          </ProtectedRoute>
        )}
      </main>

      {/* --- 📱 BOTTOM NAVIGATION: ปรับให้แสดงเฉพาะ User เท่านั้น เพื่อไม่ให้บังปุ่มในหน้า Admin --- */}
      {currentUser && currentUser.role === 'USER' && (
        <nav className="md:hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] w-[90%] max-w-sm">
          <div className="bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-full p-2 flex items-center justify-around shadow-[0_20px_40px_rgba(0,0,0,0.4)]">
            
            <button 
              onClick={() => { setActiveTab('HOME'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              className={`p-3 flex flex-col items-center gap-1 transition-all active:scale-90 ${activeTab === 'HOME' ? 'text-blue-500' : 'text-slate-400'}`}
            >
              <Home size={20} />
              <span className="text-[8px] font-black uppercase tracking-widest">Home</span>
            </button>
            
            <button 
              className="bg-blue-600 text-white p-4 rounded-full -mt-10 shadow-xl shadow-blue-500/40 border-4 border-slate-50 active:scale-95 transition-all"
              onClick={scrollToQR}
            >
              <QrCode size={24} />
            </button>

            <button 
              onClick={() => { setActiveTab('LOGS'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              className={`p-3 flex flex-col items-center gap-1 transition-all active:scale-90 ${activeTab === 'LOGS' ? 'text-blue-500' : 'text-slate-400'}`}
            >
              <History size={20} />
              <span className="text-[8px] font-black uppercase tracking-widest">Logs</span>
            </button>
          </div>
        </nav>
      )}

      {/* Footer */}
      <footer className="bg-slate-50 border-t border-slate-200 py-8 mt-auto pb-24 md:pb-8">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 mb-2 opacity-50 grayscale">
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