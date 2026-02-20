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
  LayoutDashboard, 
  History, 
  QrCode,
  Home,
  Menu,       // ✅ เพิ่มไอคอน Menu
  X,          // ✅ เพิ่มไอคอน X
  ChevronDown // ✅ เพิ่มไอคอนลูกศรลง
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
  
  // ✅ State สำหรับควบคุมการ เปิด/ปิด เมนูล่าง
  const [isNavOpen, setIsNavOpen] = useState(true); 

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

  // ✅ แก้ให้รองรับ Query Parameter เช่น /verify?id=1234
  if (currentPath.startsWith('/verify')) {
    return <VerifyPage />;
  }

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans relative">
      
      {/* Header */}
      <header className="bg-slate-900 text-white shadow-lg relative z-50 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 h-16 flex justify-between items-center gap-4">
          
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

      {/* Main Content */}
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

      {/* --- 📱 SMART BOTTOM NAVIGATION (Toggleable) --- */}
      {currentUser && currentUser.role === 'USER' && (
        <>
          {/* 1. ปุ่มเปิดเมนู (แสดงเมื่อเมนูปิดอยู่) */}
          <div className={`md:hidden fixed bottom-6 right-6 z-[60] transition-all duration-500 ${isNavOpen ? 'translate-y-24 opacity-0 pointer-events-none' : 'translate-y-0 opacity-100'}`}>
             <button 
                onClick={() => setIsNavOpen(true)}
                className="bg-slate-900 text-white p-4 rounded-full shadow-xl shadow-slate-900/40 border border-slate-700 active:scale-90 transition-all flex items-center justify-center animate-bounce-slow"
             >
                <Menu size={24} />
             </button>
          </div>

          {/* 2. แถบเมนูเต็ม (แสดงเมื่อเมนูเปิดอยู่) */}
          <nav className={`md:hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] w-[90%] max-w-sm transition-all duration-500 cubic-bezier(0.175, 0.885, 0.32, 1.275) ${isNavOpen ? 'translate-y-0 opacity-100' : 'translate-y-32 opacity-0 pointer-events-none'}`}>
            
            {/* ปุ่มปิดเมนูเล็กๆ ด้านบน */}
            <button 
              onClick={() => setIsNavOpen(false)}
              className="absolute -top-10 left-1/2 -translate-x-1/2 bg-white/80 backdrop-blur text-slate-500 p-2 rounded-full shadow-sm border border-slate-100 hover:bg-white active:scale-90 transition-all"
            >
               <ChevronDown size={20} />
            </button>

            <div className="bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-full p-2 flex items-center justify-around shadow-[0_20px_40px_rgba(0,0,0,0.4)]">
              
              <button 
                onClick={() => { setActiveTab('HOME'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                className={`p-3 flex flex-col items-center gap-1 transition-all active:scale-90 ${activeTab === 'HOME' ? 'text-blue-400' : 'text-slate-400'}`}
              >
                <Home size={20} />
                <span className="text-[8px] font-black uppercase tracking-widest">Home</span>
              </button>
              
              {/* ปุ่ม QR ตรงกลาง */}
              <button 
                className="bg-blue-600 text-white p-4 rounded-full -mt-10 shadow-xl shadow-blue-500/40 border-4 border-slate-50 active:scale-95 transition-all relative group"
                onClick={scrollToQR}
              >
                <QrCode size={24} className="group-active:rotate-12 transition-transform" />
                <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[9px] font-black text-slate-500 opacity-0 group-active:opacity-100 transition-opacity whitespace-nowrap bg-white px-2 py-0.5 rounded-md shadow-sm">My ID</span>
              </button>

              <button 
                onClick={() => { setActiveTab('LOGS'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                className={`p-3 flex flex-col items-center gap-1 transition-all active:scale-90 ${activeTab === 'LOGS' ? 'text-blue-400' : 'text-slate-400'}`}
              >
                <History size={20} />
                <span className="text-[8px] font-black uppercase tracking-widest">Logs</span>
              </button>
            </div>
          </nav>
        </>
      )}

      {/* Footer */}
      <footer className="bg-slate-50 border-t border-slate-200 py-8 mt-auto pb-32 md:pb-8">
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