import React, { useState, useEffect } from 'react';
import { User } from './types';
import { LanguageProvider, useTranslation } from './context/LanguageContext';
import Auth from './components/Auth';
import UserPanel from './components/UserPanel';
import AdminPanel from './components/AdminPanel';
import LanguageSwitcher from './components/LanguageSwitcher';
import { Shield, Loader2 } from 'lucide-react';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/ToastProvider';

const AppContent: React.FC = () => {
  const { t } = useTranslation();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      // ✅ บังคับลบ Class Dark ทิ้งทันทีที่โหลด App
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
  }, []);

  const handleLogin = (user: User) => {
    setCurrentUser(user);
    localStorage.setItem('safety_pass_current_user', JSON.stringify(user));
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('safety_pass_current_user');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    // ✅ ลบ transition-colors และ dark:... ออก
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans">
      
      {/* Header (สีเข้มถาวร เพื่อความสวยงาม) */}
      <header className="bg-slate-900 text-white p-4 shadow-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight leading-none">
                {t('app.name')}
              </h1>
              <p className="text-[10px] text-blue-300 uppercase tracking-widest font-semibold mt-1">
                {t('app.tagline')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <LanguageSwitcher />

            {currentUser && (
              <div className="flex items-center gap-4 border-l border-white/20 pl-6">
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-medium">{currentUser.name}</p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">
                    {currentUser.role}
                  </p>
                </div>
                <button 
                  onClick={handleLogout}
                  className="bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white px-3 py-1.5 rounded-md text-xs font-bold transition-all border border-red-500/20"
                >
                  {t('common.logout')}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main */}
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

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 mt-12">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">
            © 2024 Corporate Contractor Safety Passport System
            <br />
            Internal Use Only • Enterprise UX Architecture
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