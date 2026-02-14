import React, { useState, useEffect } from 'react';
import { User } from './types';
import { LanguageProvider, useTranslation } from './context/LanguageContext';
import Auth from './components/Auth';
import UserPanel from './components/UserPanel';
import AdminPanel from './components/AdminPanel';
import LanguageSwitcher from './components/LanguageSwitcher';
import { Shield, Loader2, Moon, Sun } from 'lucide-react';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/ToastProvider';


const AppContent: React.FC = () => {
  const { t } = useTranslation();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    try {
      const savedUser = localStorage.getItem('safety_pass_current_user');
      if (savedUser) {
        setCurrentUser(JSON.parse(savedUser));
      }

      // ✅ บังคับเริ่มต้นเป็น LIGHT MODE เสมอ
      document.documentElement.classList.remove('dark');
      localStorage.setItem('safety_pass_theme', 'light');
      setDarkMode(false);

    } catch (err) {
      console.error('Init error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const fallback = setTimeout(() => {
      setLoading(false);
    }, 3000);

    return () => clearTimeout(fallback);
  }, []);

  const toggleTheme = () => {
    if (darkMode) {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('safety_pass_theme', 'light');
    } else {
      document.documentElement.classList.add('dark');
      localStorage.setItem('safety_pass_theme', 'dark');
    }
    setDarkMode(!darkMode);
  };

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
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-900 transition-colors duration-300">
      
      {/* Header */}
      <header className="bg-slate-900 dark:bg-slate-950 text-white p-4 shadow-md sticky top-0 z-50 transition-colors">
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

            {/* 🌙 Dark Mode Toggle */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition"
            >
              {darkMode ? (
                <Sun className="w-5 h-5 text-yellow-400" />
              ) : (
                <Moon className="w-5 h-5 text-white" />
              )}
            </button>

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
      <footer className="bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 py-6 mt-12 transition-colors">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-slate-400 dark:text-slate-500 text-[10px] font-bold uppercase tracking-widest">
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
