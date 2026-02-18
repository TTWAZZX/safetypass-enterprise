import React, { useState, useEffect } from 'react';
import { api } from '../services/supabaseApi';
import { User, Vendor } from '../types';
import { useTranslation } from '../context/LanguageContext';
import { UserPlus, LogIn, ChevronRight, AlertCircle, Loader2, ShieldCheck, Globe2 } from 'lucide-react';
import PrivacyPolicyModal from './PrivacyPolicyModal'; // ✅ Import Modal ใหม่

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
  const [age, setAge] = useState('');
  const [nationality, setNationality] = useState('ไทย (Thai)');
  const [isOtherNationality, setIsOtherNationality] = useState(false); 
  const [vendorId, setVendorId] = useState('');
  const [otherVendor, setOtherVendor] = useState('');
  const [pdpaAccepted, setPdpaAccepted] = useState(false);
  const [showPolicyModal, setShowPolicyModal] = useState(false); // ✅ State สำหรับเปิด Modal
  
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetchingUser, setFetchingUser] = useState(false);

  useEffect(() => {
    if (mode === 'REGISTER') {
      api.getVendors().then(setVendors);
    }
  }, [mode]);

  const handleIdBlur = async () => {
    if (!regId || regId.length < 13) return; 
    
    setFetchingUser(true);
    try {
      const userData = await api.checkUser(regId);
      if (userData) {
        setName(userData.name || '');
        setAge(userData.age ? String(userData.age) : '');
        
        if (userData.vendor_id) {
           setVendorId(userData.vendor_id);
        }
        
        if (userData.nationality) {
           const commonNationalities = ['ไทย (Thai)', 'พม่า (Myanmar)', 'กัมพูชา (Cambodian)', 'ลาว (Lao)'];
           if (commonNationalities.includes(userData.nationality)) {
              setNationality(userData.nationality);
              setIsOtherNationality(false);
           } else {
              setIsOtherNationality(true);
              setNationality(userData.nationality);
           }
        }
      }
    } catch (err) {
      console.error("Error auto-filling user data", err);
    } finally {
      setFetchingUser(false);
    }
  };

  const handleNationalityChange = (val: string) => {
    if (val === 'OTHER') {
      setIsOtherNationality(true);
      setNationality(''); 
    } else {
      setIsOtherNationality(false);
      setNationality(val);
    }
  };

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
      const user = await api.register(
        regId, 
        name, 
        vendorId === 'OTHER' ? '' : vendorId, 
        Number(age), 
        nationality, 
        vendorId === 'OTHER' ? otherVendor : undefined
      );
      onLogin(user);
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-80px)] flex items-center justify-center p-4 animate-in fade-in duration-500">
      <div className="bg-white p-6 md:p-8 rounded-[2.5rem] shadow-xl shadow-slate-200/50 w-full max-w-md border border-slate-100">
        
        {/* Toggle Switcher */}
        <div className="flex bg-slate-100 p-1.5 rounded-[1.2rem] mb-6">
          <button 
            type="button"
            onClick={() => { setMode('LOGIN'); setError(''); }}
            className={`flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${mode === 'LOGIN' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
          >
            {t('auth.login')}
          </button>
          <button 
            type="button"
            onClick={() => { setMode('REGISTER'); setError(''); }}
            className={`flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${mode === 'REGISTER' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
          >
            {t('auth.register')}
          </button>
        </div>

        <div className="mb-6 text-center">
          <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-blue-100 shadow-inner">
            {mode === 'LOGIN' ? <LogIn size={24} /> : <UserPlus size={24} />}
          </div>
          <h2 className="text-xl font-black text-slate-900 tracking-tight uppercase">
            {mode === 'LOGIN' ? 'Welcome Back' : 'Create Account'}
          </h2>
          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1.5 flex items-center justify-center gap-1.5">
            <ShieldCheck size={12} className="text-blue-500" /> Security Passport Verification
          </div>
        </div>

        {/* LOGIN FORM */}
        {mode === 'LOGIN' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5 text-left">
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">{t('auth.national_id')}</label>
              <input 
                required 
                autoFocus
                className="w-full px-4 py-3.5 rounded-2xl border border-slate-100 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none font-bold text-slate-700 transition-all shadow-inner"
                value={loginId}
                onChange={e => setLoginId(e.target.value)}
                placeholder="13-digit National ID"
              />
              {/* ✅ Safety Hint for Login */}
              <div className="flex items-center gap-1.5 mt-1.5 ml-1 opacity-80">
                <ShieldCheck size={10} className="text-emerald-500" />
                <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
                  Secure encrypted authentication
                </span>
              </div>
            </div>
            <button disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-2xl shadow-lg shadow-blue-100 transition-all flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 text-xs uppercase tracking-widest">
                {loading ? <Loader2 size={18} className="animate-spin" /> : <>Login <ChevronRight size={16} /></>}
            </button>
          </form>
        )}

        {/* REGISTER FORM */}
        {mode === 'REGISTER' && (
          <form onSubmit={handleRegister} className="space-y-3.5 text-left">
            <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1">
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 flex justify-between">
                       {t('auth.national_id')}
                       {fetchingUser && <span className="text-blue-500 animate-pulse">Checking...</span>}
                    </label>
                    <input 
                        required 
                        value={regId} 
                        onChange={e => setRegId(e.target.value)} 
                        onBlur={handleIdBlur}
                        className="w-full px-4 py-3 rounded-2xl border border-slate-100 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none font-bold text-xs shadow-inner" 
                        placeholder="National ID Number" 
                    />
                    {/* ✅ Safety Hint for Registration */}
                    <div className="flex items-center gap-1.5 mt-1.5 ml-1 opacity-80">
                      <ShieldCheck size={10} className="text-emerald-500" />
                      <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest leading-none">
                        Protected by military-grade encryption (pgcrypto)
                      </span>
                    </div>
                </div>
                <div className="col-span-2 space-y-1">
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">{t('auth.full_name')}</label>
                    <input required value={name} onChange={e => setName(e.target.value)} className="w-full px-4 py-3 rounded-2xl border border-slate-100 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none font-bold text-xs shadow-inner" placeholder="Full Name (EN/TH)" />
                </div>
                <div className="space-y-1">
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Age / อายุ</label>
                    <input required type="number" value={age} onChange={e => setAge(e.target.value)} className="w-full px-4 py-3 rounded-2xl border border-slate-100 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none font-bold text-xs shadow-inner" placeholder="25" />
                </div>
                <div className="space-y-1">
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Nationality / สัญชาติ</label>
                    <select 
                      value={isOtherNationality ? 'OTHER' : nationality} 
                      onChange={e => handleNationalityChange(e.target.value)} 
                      className="w-full px-4 py-3 rounded-2xl border border-slate-100 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none font-bold text-xs appearance-none cursor-pointer"
                    >
                        <option value="ไทย (Thai)">ไทย (Thai)</option>
                        <option value="พม่า (Myanmar)">พม่า (Myanmar)</option>
                        <option value="กัมพูชา (Cambodian)">กัมพูชา (Cambodian)</option>
                        <option value="ลาว (Lao)">ลาว (Lao)</option>
                        <option value="OTHER">อื่นๆ / Other</option>
                    </select>
                </div>
            </div>

            {isOtherNationality && (
              <div className="space-y-1 animate-in slide-in-from-top-2 duration-300">
                <label className="block text-[9px] font-black text-blue-500 uppercase tracking-widest ml-1 flex items-center gap-1.5">
                  <Globe2 size={10} /> Please Specify Nationality
                </label>
                <input 
                  required 
                  autoFocus
                  value={nationality} 
                  onChange={e => setNationality(e.target.value)} 
                  className="w-full px-4 py-3 rounded-2xl border-2 border-blue-100 bg-blue-50/30 focus:bg-white focus:border-blue-500 outline-none font-bold text-xs" 
                  placeholder="เช่น เวียดนาม (Vietnamese)" 
                />
              </div>
            )}

            <div className="space-y-1">
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">{t('auth.company')}</label>
              <select required value={vendorId} onChange={e => setVendorId(e.target.value)} className="w-full px-4 py-3 rounded-2xl border border-slate-100 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none font-bold text-xs appearance-none cursor-pointer shadow-inner">
                <option value="">-- Select Company --</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                <option value="OTHER">Other (ระบุเพิ่ม)</option>
              </select>
            </div>
            
            {vendorId === 'OTHER' && (
              <div className="space-y-1 animate-in slide-in-from-top-2 duration-300">
                <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">{t('auth.other_company')}</label>
                <input required value={otherVendor} onChange={e => setOtherVendor(e.target.value)} className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none font-bold text-xs" />
              </div>
            )}

            {/* ✅ PDPA Checkbox Section */}
            <div className="mt-4 flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
              <input 
                type="checkbox" 
                id="pdpa"
                checked={pdpaAccepted}
                onChange={(e) => setPdpaAccepted(e.target.checked)}
                className="mt-1 w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
              />
              <label htmlFor="pdpa" className="text-[10px] text-slate-500 leading-tight cursor-pointer select-none">
                ข้าพเจ้ายอมรับ 
                <span 
                    className="text-blue-600 font-bold underline mx-1 hover:text-blue-800 transition-colors"
                    onClick={(e) => {
                        e.preventDefault(); // ป้องกันไม่ให้ไปติ๊ก Checkbox
                        setShowPolicyModal(true);
                    }}
                >
                    นโยบายความเป็นส่วนตัว (PDPA)
                </span> 
                และยินยอมให้จัดเก็บข้อมูลเพื่อการตรวจสอบความปลอดภัย
              </label>
            </div>

            <button 
                disabled={loading || !pdpaAccepted}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-black py-4 rounded-2xl shadow-lg shadow-blue-100 transition-all flex items-center justify-center gap-2 mt-4 active:scale-95 text-xs uppercase tracking-widest"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <>Register Account</>}
            </button>
          </form>
        )}

        {error && (
          <div className="mt-4 flex items-center gap-2 text-red-600 bg-red-50 p-3.5 rounded-2xl text-[10px] font-bold border border-red-100 animate-shake">
            <AlertCircle size={14} /> {error}
          </div>
        )}
      </div>

      {/* ✅ Render Policy Modal */}
      {showPolicyModal && <PrivacyPolicyModal onClose={() => setShowPolicyModal(false)} />}
    </div>
  );
};

export default Auth;