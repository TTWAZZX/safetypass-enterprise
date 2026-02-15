import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { 
  ShieldCheck, 
  ShieldAlert, 
  User, 
  Building2, 
  CalendarDays, 
  Loader2,
  AlertTriangle
} from 'lucide-react';

const VerifyPage: React.FC = () => {
  const [status, setStatus] = useState<'LOADING' | 'VALID' | 'EXPIRED' | 'NOT_FOUND'>('LOADING');
  const [userData, setUserData] = useState<any>(null);

  useEffect(() => {
    // ดึง User ID จาก URL (สมมติ URL คือ domain.com/verify/USER_ID)
    const path = window.location.pathname;
    const userId = path.split('/').pop(); // เอาตัวสุดท้ายของ URL

    if (userId) {
      checkUserStatus(userId);
    } else {
      setStatus('NOT_FOUND');
    }
  }, []);

  const checkUserStatus = async (id: string) => {
    try {
      // 1. ดึงข้อมูล User และประวัติใบอนุญาตล่าสุด (Work Permit)
      const { data: user, error } = await supabase
        .from('users')
        .select(`
          *,
          vendors(name),
          work_permits(permit_no, expire_date)
        `)
        .eq('id', id)
        .order('created_at', { foreignTable: 'work_permits', ascending: false })
        .limit(1, { foreignTable: 'work_permits' })
        .single();

      if (error || !user) {
        setStatus('NOT_FOUND');
        return;
      }

      setUserData(user);

      // 2. เช็คเงื่อนไขความปลอดภัย (ต้องผ่านทั้ง Induction และมี Work Permit ที่ยังไม่หมดอายุ)
      const today = new Date();
      const isInductionValid = user.induction_expiry && new Date(user.induction_expiry) > today;
      
      // ดึง Work Permit ล่าสุดมาเช็ค
      const latestPermit = user.work_permits?.[0];
      const isPermitValid = latestPermit && new Date(latestPermit.expire_date) > today;

      // 🟢 สถานะจะเป็น VALID ก็ต่อเมื่อผ่านทั้งคู่ (หรือปรับตามนโยบายบริษัทคุณ)
      if (isInductionValid && isPermitValid) {
        setStatus('VALID');
      } else {
        setStatus('EXPIRED');
      }

    } catch (err) {
      console.error(err);
      setStatus('NOT_FOUND');
    }
  };

  if (status === 'LOADING') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4">
        <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
        <p className="text-slate-400 font-bold animate-pulse">กำลังตรวจสอบข้อมูล...</p>
      </div>
    );
  }

  if (status === 'NOT_FOUND') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-100 p-6 text-center">
        <div className="bg-slate-200 p-6 rounded-full mb-6">
          <AlertTriangle className="w-16 h-16 text-slate-400" />
        </div>
        <h1 className="text-2xl font-black text-slate-700">ไม่พบข้อมูลผู้ใช้</h1>
        <p className="text-slate-500 mt-2">QR Code อาจไม่ถูกต้อง หรือผู้ใช้นี้ถูกลบไปแล้ว</p>
      </div>
    );
  }

  return (
    <div className={`min-h-screen p-6 flex flex-col items-center justify-center transition-colors duration-500 ${status === 'VALID' ? 'bg-emerald-50' : 'bg-red-50'}`}>
      
      {/* 🟢 Status Card */}
      <div className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl overflow-hidden border-4 border-white relative">
        
        {/* Header Indicator */}
        <div className={`p-8 text-center ${status === 'VALID' ? 'bg-emerald-500' : 'bg-red-500'}`}>
          <div className="bg-white/20 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-4 backdrop-blur-sm shadow-inner">
            {status === 'VALID' ? (
              <ShieldCheck className="w-14 h-14 text-white" />
            ) : (
              <ShieldAlert className="w-14 h-14 text-white" />
            )}
          </div>
          <h1 className="text-3xl font-black text-white uppercase tracking-wider">
            {status === 'VALID' ? 'PASS' : 'EXPIRED'}
          </h1>
          <p className="text-white/80 font-bold text-sm mt-1">
            {status === 'VALID' ? 'อนุญาตให้เข้าพื้นที่' : 'ไม่อนุญาต / บัตรหมดอายุ'}
          </p>
        </div>

        {/* User Details */}
        <div className="p-8 space-y-6">
          <div className="text-center">
            <div className="w-24 h-24 bg-slate-100 rounded-full mx-auto mb-4 flex items-center justify-center overflow-hidden border-4 border-slate-50 shadow-lg">
               {/* ใส่รูปจริงถ้ามี */}
               <User className="w-10 h-10 text-slate-300" />
            </div>
            <h2 className="text-2xl font-black text-slate-800 leading-tight">{userData.name}</h2>
            <p className="text-slate-400 font-bold text-sm mt-1 tracking-wider">{userData.national_id}</p>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <div className="bg-white p-2 rounded-xl shadow-sm"><Building2 className="w-5 h-5 text-blue-500"/></div>
              <div>
                <p className="text-[10px] uppercase text-slate-400 font-black">Company / Vendor</p>
                <p className="font-bold text-slate-700">{userData.vendors?.name || 'N/A'}</p>
              </div>
            </div>

            <div className={`flex items-center gap-4 p-4 rounded-2xl border ${status === 'VALID' ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
              <div className="bg-white p-2 rounded-xl shadow-sm"><CalendarDays className={`w-5 h-5 ${status === 'VALID' ? 'text-emerald-500' : 'text-red-500'}`}/></div>
              <div>
                <p className={`text-[10px] uppercase font-black ${status === 'VALID' ? 'text-emerald-600/60' : 'text-red-600/60'}`}>Expiry Date</p>
                <p className={`font-bold ${status === 'VALID' ? 'text-emerald-700' : 'text-red-700'}`}>
                  {new Date(userData.induction_expiry).toLocaleDateString('th-TH', { 
                    day: 'numeric', month: 'long', year: 'numeric' 
                  })}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 text-center border-t border-slate-100">
          <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">
            Safety Pass Verification System
          </p>
          <p className="text-[10px] text-slate-300 mt-1">
            Checked at {new Date().toLocaleTimeString('th-TH')}
          </p>
        </div>
      </div>
    </div>
  );
};

export default VerifyPage;