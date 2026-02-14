import React, { useState, useEffect } from 'react';
import { api as mockApi } from '../services/supabaseApi'; // ✅ แก้เป็น Supabase
import { User, Vendor, VendorStatus } from '../types';
import { useTranslation } from '../context/LanguageContext';
import { UserPlus, LogIn, ChevronRight, AlertCircle, Loader2 } from 'lucide-react';

interface AuthProps {
  onLogin: (user: User) => void;
}

const Auth: React.FC<AuthProps> = ({ onLogin }) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [otherVendor, setOtherVendor] = useState('');
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // โหลดรายชื่อบริษัทเมื่อเข้าหน้า Register
    if (mode === 'REGISTER') {
      mockApi.getVendors().then(list => setVendors(list));
    }
  }, [mode]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const user = await mockApi.login(id);
      onLogin(user);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const user = await mockApi.register(id, name, vendorId, otherVendor);
      onLogin(user);
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded-3xl shadow-xl border border-slate-100 my-10">
      <div className="flex gap-4 mb-8 p-1 bg-slate-100 rounded-xl">
        <button 
          onClick={() => setMode('LOGIN')}
          className={`flex-1 py-3 rounded-lg text-sm font-bold transition-all ${mode === 'LOGIN' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
        >
          {t('auth.login')}
        </button>
        <button 
          onClick={() => setMode('REGISTER')}
          className={`flex-1 py-3 rounded-lg text-sm font-bold transition-all ${mode === 'REGISTER' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
        >
          {t('auth.register')}
        </button>
      </div>

      <form onSubmit={mode === 'LOGIN' ? handleLogin : handleRegister} className="space-y-4">
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{t('auth.national_id')}</label>
          <input 
            required 
            type="text" 
            value={id}
            onChange={e => setId(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
            placeholder="xxxxxxxxxxxxx"
          />
        </div>

        {mode === 'REGISTER' && (
          <>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{t('auth.full_name')}</label>
              <input 
                required 
                type="text" 
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{t('auth.company')}</label>
              <select 
                value={vendorId}
                onChange={e => setVendorId(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="">-- Select Vendor --</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                <option value="OTHER">Other (ระบุเพิ่ม)</option>
              </select>
            </div>
            {vendorId === 'OTHER' && (
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{t('auth.other_company')}</label>
                <input 
                  required 
                  type="text" 
                  value={otherVendor}
                  onChange={e => setOtherVendor(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            )}
          </>
        )}

        {error && (
          <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-xl text-xs font-medium">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        )}

        <button 
          disabled={loading}
          type="submit"
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>{mode === 'LOGIN' ? t('auth.login') : t('auth.register')} <ChevronRight className="w-5 h-5" /></>}
        </button>
      </form>
    </div>
  );
};

export default Auth;