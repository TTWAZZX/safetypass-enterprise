import { supabase } from '../services/supabaseClient'; // ✅ เพิ่มบรรทัดนี้เข้ามา
import React, { useState, useEffect } from 'react';
import { api } from '../services/supabaseApi';
import {
  User, Vendor, TrainingProgram, SupplierOutsourceType, SupplierOutsourceWorkType,
} from '../types';
import { useTranslation } from '../context/LanguageContext';
import { 
  UserPlus, LogIn, ChevronRight, AlertCircle, Loader2, 
  ShieldCheck, Globe2, BookOpen, HelpCircle,
  Search, CheckCircle
} from 'lucide-react';
import PrivacyPolicyModal from './PrivacyPolicyModal';

interface AuthProps {
  onLogin: (user: User) => void;
}

const Auth: React.FC<AuthProps> = ({ onLogin }) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
  
  // Login State
  const [loginId, setLoginId] = useState('');
  const [loginPin, setLoginPin] = useState('');

  // Register State
  const [regId, setRegId] = useState('');
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [nationality, setNationality] = useState('ไทย (Thai)');
  const [isOtherNationality, setIsOtherNationality] = useState(false); 
  const [vendorId, setVendorId] = useState('');
  const [otherVendor, setOtherVendor] = useState('');
  const [pdpaAccepted, setPdpaAccepted] = useState(false);
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [supplierOutsourceEnabled, setSupplierOutsourceEnabled] = useState(false);
  const [selectedPrograms, setSelectedPrograms] = useState<TrainingProgram[]>(['CONTRACTOR']);
  const [participantType, setParticipantType] = useState<SupplierOutsourceType>('supplier');
  const [workType, setWorkType] = useState<SupplierOutsourceWorkType>('Driver');
  const [accessStartDate, setAccessStartDate] = useState('');
  const [accessEndDate, setAccessEndDate] = useState('');
  
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorSearch, setVendorSearch] = useState('');
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [vendorsError, setVendorsError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetchingUser, setFetchingUser] = useState(false);
  const [dataFoundMsg, setDataFoundMsg] = useState(false); 
  const [dataNotFoundMsg, setDataNotFoundMsg] = useState(false); 
  const [infoMsg, setInfoMsg] = useState(''); 

  // Support Links State
  const [manualUrl, setManualUrl] = useState<string>('');
  const [supportUrl, setSupportUrl] = useState<string>('');

  const filteredVendors = vendors.filter((vendor) =>
    vendor.name.toLocaleLowerCase().includes(vendorSearch.trim().toLocaleLowerCase())
  );

  const loadRegistrationVendors = async () => {
    setVendorsLoading(true);
    setVendorsError('');
    try {
      const approvedVendors = await api.getVendors();
      setVendors(approvedVendors);
    } catch (vendorError: any) {
      console.error('Registration vendor load failed:', vendorError);
      setVendors([]);
      setVendorsError('โหลดรายชื่อบริษัทไม่สำเร็จ กรุณาลองอีกครั้ง');
    } finally {
      setVendorsLoading(false);
    }
  };

  useEffect(() => {
    if (mode === 'REGISTER') void loadRegistrationVendors();
  }, [mode]);

  useEffect(() => {
    api.getPublicFeatureFlags()
      .then(({ supplierOutsourceEnabled: enabled }) => setSupplierOutsourceEnabled(enabled))
      .catch(() => setSupplierOutsourceEnabled(false));
  }, []);

  const toggleProgram = (program: TrainingProgram) => {
    setSelectedPrograms((current) => current.includes(program)
      ? current.filter((item) => item !== program)
      : [...current, program]);
  };

  useEffect(() => {
    const loadSupportLinks = async () => {
      try {
        const config = await api.getSystemSettings();
        if (config['manual_url']) setManualUrl(config['manual_url']);
        if (config['support_url']) setSupportUrl(config['support_url']);
      } catch (err) {
        console.error("Failed to load support links", err);
      }
    };
    loadSupportLinks();
  }, []);

  const handleCheckID = async (idToCheck = regId) => {
    if (!idToCheck || idToCheck.length < 13) return; 
    
    setFetchingUser(true);
    setDataFoundMsg(false);
    setDataNotFoundMsg(false); 
    try {
      const userData = await api.checkUser(idToCheck);
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
        
        setDataFoundMsg(true);
        setTimeout(() => setDataFoundMsg(false), 5000);
      } else {
        setDataNotFoundMsg(true);
        setTimeout(() => setDataNotFoundMsg(false), 5000);
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
    setInfoMsg("");
    try {
      const user = await api.login(loginId, loginPin || undefined);
      
      // แสตมป์เวลาเข้าสู่ระบบล่าสุด (fire-and-forget ไม่ block login flow)
      supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);

      onLogin(user);
    } catch (err: any) {
      const errorMsg = err.message || '';
      
      // 🔥 ดักจับถ้ายังไม่ได้ลงทะเบียน ให้สลับหน้าและโยนเลขบัตรไปช่อง Register
      if (errorMsg.includes('REQUIRE_REGISTER')) {
         setRegId(loginId); // ส่งเลขบัตรที่พิมพ์ค้างไว้ไปหน้าลงทะเบียน
         setMode('REGISTER'); // สลับไปหน้าลงทะเบียนอัตโนมัติ
         setInfoMsg('กรุณาตรวจสอบข้อมูลและยอมรับเงื่อนไข (PDPA) ก่อนเข้าใช้งานครั้งแรก');
         setTimeout(() => setInfoMsg(''), 6000);
         // สั่งให้ระบบวิ่งไปดึงข้อมูลแอดมินอัตโนมัติเลย
         handleCheckID(loginId); 
      } else {
         setError(errorMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setInfoMsg(""); 
    try {
      if (supplierOutsourceEnabled && selectedPrograms.length === 0) {
        throw new Error('กรุณาเลือกหลักสูตรอย่างน้อย 1 รายการ');
      }
      if (supplierOutsourceEnabled && selectedPrograms.includes('SUPPLIER_OUTSOURCE')
          && accessStartDate && accessEndDate && accessEndDate < accessStartDate) {
        throw new Error('วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น');
      }
      const user = await api.register(
        regId, 
        name, 
        vendorId === 'OTHER' ? '' : vendorId, 
        Number(age), 
        nationality, 
        vendorId === 'OTHER' ? otherVendor : undefined,
        supplierOutsourceEnabled ? {
          programs: selectedPrograms,
          participantType: selectedPrograms.includes('SUPPLIER_OUTSOURCE') ? participantType : undefined,
          workType: selectedPrograms.includes('SUPPLIER_OUTSOURCE') ? workType : undefined,
          accessStartDate: selectedPrograms.includes('SUPPLIER_OUTSOURCE') ? accessStartDate : undefined,
          accessEndDate: selectedPrograms.includes('SUPPLIER_OUTSOURCE') ? accessEndDate : undefined,
        } : undefined,
      );

      // 🔥 ✅ แก้ไข: เติมคำว่า await เพื่อให้ระบบ "รอ" ส่ง LINE ให้เสร็จก่อนเปลี่ยนหน้า
      if (vendorId === 'OTHER' && otherVendor.trim() !== '') {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session?.access_token) throw new Error('No active session');

          await fetch('/api/notify-admin', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              vendorName: otherVendor.trim(),
              adminEmail: `พนักงานสมัครใหม่ (${name})`
            })
          });
        } catch (err) {
          console.error("Fail to trigger LINE Admin API:", err);
        }
      }

      // แสตมป์เวลาเข้าสู่ระบบล่าสุด (fire-and-forget ไม่ block login flow)
      supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);

      onLogin(user);

    } catch (err: any) {
      const errorMsg = err.message || '';
      
      if (errorMsg.toLowerCase().includes('already registered') || errorMsg.toLowerCase().includes('already exists') || errorMsg.includes('User already registered')) {
         
         setLoginId(regId); 
         setMode('LOGIN'); 
         setError('');
         
         setInfoMsg('พบว่าคุณมีบัญชีในระบบแล้ว! กรุณากด Login เพื่อเข้าใช้งาน');
         setTimeout(() => setInfoMsg(''), 6000); 
      } else {
         setError('Registration failed: ' + errorMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-80px)] flex items-center justify-center p-4 animate-in fade-in duration-500 py-10">
      <div className="bg-white p-6 md:p-8 rounded-[2.5rem] shadow-xl shadow-slate-200/50 w-full max-w-md border border-slate-100 relative overflow-hidden">
        
        {/* Toggle Switcher */}
        <div className="flex bg-slate-100 p-1.5 rounded-[1.2rem] mb-6 relative z-10">
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

        <div className="mb-6 text-center relative z-10">
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
          <form onSubmit={handleLogin} className="space-y-4 relative z-10">
            
            {infoMsg && (
                <div className="bg-blue-50 border border-blue-200 text-blue-700 p-3 rounded-2xl text-[10px] sm:text-xs font-bold flex items-start gap-2 animate-in slide-in-from-top-2 shadow-sm">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <span className="leading-relaxed">{infoMsg}</span>
                </div>
            )}

            <div className="space-y-1.5 text-left">
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">{t('auth.national_id')}</label>
              <input 
                required 
                autoFocus
                className="w-full px-4 py-3.5 rounded-2xl border border-slate-100 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none font-bold text-base md:text-sm text-slate-700 transition-all shadow-inner"
                value={loginId}
                onChange={e => setLoginId(e.target.value)}
                placeholder="13-digit National ID"
              />
              <div className="flex items-center gap-1.5 mt-1.5 ml-1 opacity-80">
                <ShieldCheck size={10} className="text-emerald-500" />
                <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
                  Secure encrypted authentication
                </span>
              </div>
            </div>

            <div className="space-y-1.5 text-left">
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">PIN 4 หลักท้ายบัตรประชาชน</label>
              <input
                required
                inputMode="numeric"
                maxLength={4}
                type="password"
                className="w-full px-4 py-3.5 rounded-2xl border border-slate-100 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none font-bold text-base md:text-sm text-slate-700 transition-all shadow-inner"
                value={loginPin}
                onChange={e => setLoginPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="4 หลักท้ายบัตรประชาชน"
              />
              <p className="text-[8px] font-bold text-slate-400 ml-1">ผู้ใช้เดิมใช้เลข 4 หลักท้ายบัตรประชาชนเพื่อย้ายบัญชีครั้งแรก</p>
            </div>
            
            <button disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-2xl shadow-lg shadow-blue-100 transition-all flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 text-xs uppercase tracking-widest">
                {loading ? <Loader2 size={18} className="animate-spin" /> : <>Login <ChevronRight size={16} /></>}
            </button>
          </form>
        )}

        {/* REGISTER FORM */}
        {mode === 'REGISTER' && (
          <form onSubmit={handleRegister} className="space-y-3.5 text-left relative z-10">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                
                <div className="col-span-2 space-y-1">
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 flex justify-between">
                        {t('auth.national_id')}
                        {fetchingUser && <span className="text-blue-500 animate-pulse">กำลังค้นหาข้อมูล...</span>}
                    </label>
                    <div className="relative flex items-center">
                        <input 
                            required 
                            value={regId} 
                            onChange={e => {
                                const val = e.target.value.replace(/\D/g, '').slice(0, 13);
                                setRegId(val);
                                if (val.length === 13) handleCheckID(val);
                            }} 
                            onBlur={() => handleCheckID()} 
                            className="w-full pl-4 pr-24 py-3 rounded-2xl border border-slate-100 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none font-bold text-base md:text-xs shadow-inner transition-all" 
                            placeholder="เลขบัตรประจำตัวประชาชน 13 หลัก" 
                        />
                        <button 
                            type="button"
                            onClick={() => handleCheckID()}
                            disabled={regId.length < 13 || fetchingUser}
                            className="absolute right-2 bg-slate-900 text-white px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-blue-600 disabled:opacity-50 disabled:bg-slate-200 transition-all flex items-center gap-1 active:scale-95"
                        >
                            {fetchingUser ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                            ตรวจสอบ
                        </button>
                    </div>
                    
                    <div className="min-h-[20px]">
                      {dataFoundMsg ? (
                          <div className="flex items-center gap-1.5 mt-2 ml-1 text-emerald-600 animate-in fade-in slide-in-from-top-1">
                            <CheckCircle size={12} />
                            <span className="text-[9px] font-bold uppercase tracking-widest">
                              พบข้อมูลเดิมในระบบ ดึงข้อมูลสำเร็จ!
                            </span>
                          </div>
                      ) : dataNotFoundMsg ? (
                          <div className="flex items-center gap-1.5 mt-2 ml-1 text-amber-500 animate-in fade-in slide-in-from-top-1">
                            <AlertCircle size={12} />
                            <span className="text-[9px] font-bold uppercase tracking-widest">
                              ไม่พบประวัติ กรุณากรอกข้อมูลเพื่อลงทะเบียนใหม่
                            </span>
                          </div>
                      ) : (
                          <div className="flex items-center gap-1.5 mt-1.5 ml-1 opacity-80">
                            <ShieldCheck size={10} className="text-emerald-500" />
                            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest leading-none">
                              Protected by military-grade encryption (pgcrypto)
                            </span>
                          </div>
                      )}
                    </div>
                </div>

                <div className="col-span-2 space-y-1">
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">{t('auth.full_name')}</label>
                    <input required value={name} onChange={e => setName(e.target.value)} className="w-full px-4 py-3 rounded-2xl border border-slate-100 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none font-bold text-base md:text-xs shadow-inner" placeholder="Full Name (EN/TH)" />
                </div>
                <div className="space-y-1">
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Age / อายุ</label>
                    <input required type="number" value={age} onChange={e => setAge(e.target.value)} className="w-full px-4 py-3 rounded-2xl border border-slate-100 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none font-bold text-base md:text-xs shadow-inner" placeholder="25" />
                </div>
                <div className="space-y-1">
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Nationality / สัญชาติ</label>
                    <select 
                      value={isOtherNationality ? 'OTHER' : nationality} 
                      onChange={e => handleNationalityChange(e.target.value)} 
                      className="w-full px-4 py-3 rounded-2xl border border-slate-100 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none font-bold text-base md:text-xs appearance-none cursor-pointer"
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
                  className="w-full px-4 py-3 rounded-2xl border-2 border-blue-100 bg-blue-50/30 focus:bg-white focus:border-blue-500 outline-none font-bold text-base md:text-xs" 
                  placeholder="เช่น เวียดนาม (Vietnamese)" 
                />
              </div>
            )}

            <div className="space-y-1">
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">{t('auth.company')}</label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="search"
                  value={vendorSearch}
                  onChange={(e) => setVendorSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-100 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none font-bold text-base md:text-xs shadow-inner"
                  placeholder="ค้นหาชื่อบริษัท"
                  aria-label="ค้นหาชื่อบริษัท"
                />
              </div>
              <select required value={vendorId} onChange={e => setVendorId(e.target.value)} className="w-full px-4 py-3 rounded-2xl border border-slate-100 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none font-bold text-base md:text-xs appearance-none cursor-pointer shadow-inner">
                <option value="">{vendorsLoading ? 'กำลังโหลดรายชื่อบริษัท...' : '-- Select Company --'}</option>
                {filteredVendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                <option value="OTHER">Other (ระบุเพิ่ม)</option>
              </select>
              {vendorsError && (
                <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2">
                  <span className="text-[9px] font-bold text-red-600">{vendorsError}</span>
                  <button type="button" onClick={loadRegistrationVendors} disabled={vendorsLoading} className="shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-[8px] font-black text-white disabled:opacity-50">
                    ลองอีกครั้ง
                  </button>
                </div>
              )}
              {!vendorsLoading && !vendorsError && vendorSearch.trim() && filteredVendors.length === 0 && (
                <p className="px-1 text-[9px] font-bold text-amber-600">ไม่พบบริษัทที่ตรงกับคำค้นหา สามารถเลือก Other เพื่อระบุบริษัทใหม่ได้</p>
              )}
            </div>
            
            {vendorId === 'OTHER' && (
              <div className="space-y-1 animate-in slide-in-from-top-2 duration-300">
                <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">{t('auth.other_company')}</label>
                <input required value={otherVendor} onChange={e => setOtherVendor(e.target.value)} className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none font-bold text-base md:text-xs" />
              </div>
            )}

            {supplierOutsourceEnabled && (
              <div className="space-y-3 rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
                    หลักสูตรที่ต้องการ / Training Programs
                  </p>
                  <p className="mt-1 text-[9px] font-bold text-slate-500">
                    เลือกได้มากกว่า 1 รายการ และสามารถเพิ่ม Supplier & Outsource ภายหลังได้
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${selectedPrograms.includes('CONTRACTOR') ? 'border-blue-300 bg-white' : 'border-slate-200 bg-slate-50'}`}>
                    <input type="checkbox" checked={selectedPrograms.includes('CONTRACTOR')} onChange={() => toggleProgram('CONTRACTOR')} />
                    <span className="text-[10px] font-black text-slate-700">Contractor</span>
                  </label>
                  <label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${selectedPrograms.includes('SUPPLIER_OUTSOURCE') ? 'border-emerald-300 bg-white' : 'border-slate-200 bg-slate-50'}`}>
                    <input type="checkbox" checked={selectedPrograms.includes('SUPPLIER_OUTSOURCE')} onChange={() => toggleProgram('SUPPLIER_OUTSOURCE')} />
                    <span className="text-[10px] font-black text-slate-700">Supplier & Outsource</span>
                  </label>
                </div>

                {selectedPrograms.includes('SUPPLIER_OUTSOURCE') && (
                  <div className="grid grid-cols-1 gap-3 border-t border-emerald-100 pt-3 sm:grid-cols-2">
                    <label className="space-y-1 text-[9px] font-black uppercase tracking-widest text-slate-400">
                      ประเภทผู้ใช้
                      <select value={participantType} onChange={(e) => setParticipantType(e.target.value as SupplierOutsourceType)} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs font-bold normal-case text-slate-700">
                        <option value="supplier">Supplier ส่งสินค้า/เข้าพื้นที่ชั่วคราว</option>
                        <option value="outsource">Outsource งานทั่วไป</option>
                      </select>
                    </label>
                    <label className="space-y-1 text-[9px] font-black uppercase tracking-widest text-slate-400">
                      ประเภทงาน
                      <select value={workType} onChange={(e) => setWorkType(e.target.value as SupplierOutsourceWorkType)} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs font-bold normal-case text-slate-700">
                        <option value="Driver">Driver</option>
                        <option value="Passenger">Passenger</option>
                        <option value="Trainee">Trainee</option>
                      </select>
                    </label>
                    <label className="space-y-1 text-[9px] font-black uppercase tracking-widest text-slate-400">
                      วันที่เริ่มเข้าพื้นที่ (ถ้ามี)
                      <input type="date" value={accessStartDate} onChange={(e) => setAccessStartDate(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs font-bold text-slate-700" />
                    </label>
                    <label className="space-y-1 text-[9px] font-black uppercase tracking-widest text-slate-400">
                      วันที่สิ้นสุด (ถ้ามี)
                      <input type="date" value={accessEndDate} min={accessStartDate || undefined} onChange={(e) => setAccessEndDate(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs font-bold text-slate-700" />
                    </label>
                  </div>
                )}
              </div>
            )}

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
                        e.preventDefault(); 
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
          <div className="mt-4 flex items-center gap-2 text-red-600 bg-red-50 p-3.5 rounded-2xl text-[10px] font-bold border border-red-100 animate-shake relative z-10">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {/* ✅ ส่วน Help & Resources ที่ดึงข้อมูลจากการตั้งค่าแอดมิน */}
        {(manualUrl || supportUrl) && (
          <div className="mt-8 pt-5 border-t border-slate-100 relative z-10">
            <p className="text-center text-[9px] font-black text-slate-300 uppercase tracking-[0.2em] mb-3">
                Help & Resources
            </p>
            <div className="flex flex-col gap-2">
                {manualUrl && (
                  <a 
                    href={manualUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 p-3 rounded-xl bg-slate-50 text-slate-500 hover:bg-blue-50 hover:text-blue-600 transition-colors border border-slate-100 font-bold text-[10px] uppercase tracking-wide group"
                  >
                    <BookOpen size={14} className="group-hover:scale-110 transition-transform" /> 
                    คู่มือการใช้งานระบบ (User Guide)
                  </a>
                )}
                
                {supportUrl && (
                  <a 
                    href={supportUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 p-3 rounded-xl bg-slate-50 text-slate-500 hover:bg-emerald-50 hover:text-emerald-600 transition-colors border border-slate-100 font-bold text-[10px] uppercase tracking-wide group"
                  >
                    <HelpCircle size={14} className="group-hover:scale-110 transition-transform" />
                    แจ้งปัญหาการใช้งาน (Support)
                  </a>
                )}
            </div>
          </div>
        )}

      </div>

      {showPolicyModal && <PrivacyPolicyModal onClose={() => setShowPolicyModal(false)} />}
    </div>
  );
};

export default Auth;
