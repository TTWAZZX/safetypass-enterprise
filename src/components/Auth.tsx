import React, { useState, useEffect } from 'react';
import { api } from '../services/supabaseApi';
import { User, Vendor } from '../types';
import { useTranslation } from '../context/LanguageContext';
import { UserPlus, LogIn, ChevronRight, AlertCircle, Loader2 } from 'lucide-react';

interface AuthProps {
  onLogin: (user: User) => void;
}

const Auth: React.FC<AuthProps> = ({ onLogin }) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
  
  // Login State
  const [loginId, setLoginId] = useState('');

  // Register State
  const [regId, setRegId] = useState('');
  const [name, setName] = useState('');
  const [age, setAge] = useState(''); // ✅ เพิ่มอายุ
  const [nationality, setNationality] = useState('ไทย (Thai)'); // ✅ เพิ่มสัญชาติ
  const [vendorId, setVendorId] = useState('');
  const [otherVendor, setOtherVendor] = useState('');
  
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (mode === 'REGISTER') {
      api.getVendors().then(setVendors);
    }
  }, [mode]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const user = await api.login(loginId);
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
      // ✅ ส่ง Age และ Nationality ไปด้วย
      const user = await api.register(
        regId, 
        name, 
        vendorId, 
        Number(age), 
        nationality, 
        otherVendor
      );
      onLogin(user);
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-md border border-slate-200">
        
        {/* Toggle Header */}
        <div className="flex bg-slate-100 p-1 rounded-xl mb-8">
          <button 
            onClick={() => { setMode('LOGIN'); setError(''); }}
            className={`flex-1 py-3 rounded-lg text-sm font-bold transition-all ${mode === 'LOGIN' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
          >
            {t('auth.login')}
          </button>
          <button 
            onClick={() => { setMode('REGISTER'); setError(''); }}
            className={`flex-1 py-3 rounded-lg text-sm font-bold transition-all ${mode === 'REGISTER' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
          >
            {t('auth.register')}
          </button>
        </div>

        <div className="mb-6 text-center">
          <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4 text-blue-600">
            {mode === 'LOGIN' ? <LogIn className="w-8 h-8" /> : <UserPlus className="w-8 h-8" />}
          </div>
          <h2 className="text-2xl font-black text-slate-800">
            {mode === 'LOGIN' ? 'Welcome Back' : 'Create Account'}
          </h2>
          <p className="text-slate-500 text-sm mt-2">Safety Passport System</p>
        </div>

        {/* LOGIN FORM */}
        {mode === 'LOGIN' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{t('auth.national_id')}</label>
              <input 
                required 
                autoFocus
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none font-medium"
                value={loginId}
                onChange={e => setLoginId(e.target.value)}
                placeholder="13-digit ID / เลขบัตรประชาชน"
              />
            </div>
            <button disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2 disabled:opacity-50">
               {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Login <ChevronRight className="w-4 h-4" /></>}
            </button>
          </form>
        )}

        {/* REGISTER FORM */}
        {mode === 'REGISTER' && (
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{t('auth.national_id')}</label>
                    <input required value={regId} onChange={e => setRegId(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="1234567890123" />
                </div>
                <div className="col-span-2">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{t('auth.full_name')}</label>
                    <input required value={name} onChange={e => setName(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Mr. John Doe" />
                </div>
                {/* ✅ เพิ่มช่องกรอก อายุ & สัญชาติ */}
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Age / อายุ</label>
                    <input required type="number" value={age} onChange={e => setAge(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="25" />
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nationality / สัญชาติ</label>
                    <select value={nationality} onChange={e => setNationality(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                        <option value="ไทย (Thai)">ไทย (Thai)</option>
                        <option value="ต่างชาติ (Foreigner)">ต่างชาติ (Foreigner)</option>
                        <option value="กัมพูชา (Cambodian)">กัมพูชา (Cambodian)</option>
                        <option value="พม่า (Myanmar)">พม่า (Myanmar)</option>
                        <option value="ลาว (Lao)">ลาว (Lao)</option>
                    </select>
                </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{t('auth.company')}</label>
              <select required value={vendorId} onChange={e => setVendorId(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                <option value="">-- Select Company --</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                <option value="OTHER">Other (ระบุเพิ่ม)</option>
              </select>
            </div>
            
            {vendorId === 'OTHER' && (
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{t('auth.other_company')}</label>
                <input required value={otherVendor} onChange={e => setOtherVendor(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
            )}

            <button disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2 disabled:opacity-50 mt-4">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Register Account</>}
            </button>
          </form>
        )}

        {error && (
          <div className="mt-4 flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-xl text-xs font-medium">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        )}
      </div>
    </div>
  );
};

export default Auth;