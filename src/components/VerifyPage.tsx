import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { 
  ShieldCheck, 
  ShieldAlert, 
  User, 
  Building2, 
  CalendarDays, 
  Loader2,
  AlertTriangle,
  Clock,
  Fingerprint,
  FileText
} from 'lucide-react';

const VerifyPage: React.FC = () => {
  // ✅ มีสถานะ EXPIRED แยกออกมาให้ชัดเจน
  const [status, setStatus] = useState<'LOADING' | 'VALID' | 'EXPIRED' | 'NOT_FOUND' | 'SUSPENDED'>('LOADING');
  const [userData, setUserData] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string>(''); 

  // ✅ เพิ่ม State สำหรับแยกว่ากำลังตรวจบัตรประเภทไหน และวันหมดอายุคือวันไหน
  const [verifyMode, setVerifyMode] = useState<'INDUCTION' | 'WORK_PERMIT'>('INDUCTION');
  const [verifiedExpiryDate, setVerifiedExpiryDate] = useState<string | null>(null);
  const [activePermitObj, setActivePermitObj] = useState<any>(null);

  useEffect(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      let userId = urlParams.get('id');
      const permitId = urlParams.get('permit'); 

      if (!userId) {
        const pathParts = window.location.pathname.split('/');
        const potentialId = pathParts[pathParts.length - 1];
        if (potentialId && potentialId !== 'verify') {
          userId = potentialId;
        }
      }

      if (userId) {
        checkUserStatus(decodeURIComponent(userId), permitId); 
      } else {
        setStatus('NOT_FOUND');
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message);
      setStatus('NOT_FOUND');
    }
  }, []);

  const checkUserStatus = async (id: string, permitId: string | null) => {
    try {
      let targetUser = null;

      const { data: userById } = await supabase
        .from('users')
        .select(`
          *,
          vendors(name),
          work_permits(permit_no, expire_date)
        `)
        .eq('national_id', id)
        .order('created_at', { foreignTable: 'work_permits', ascending: false })
        .maybeSingle();

      targetUser = userById;

      if (!targetUser) {
        const { data: permitData } = await supabase
          .from('work_permits')
          .select('user_id')
          .eq('permit_no', id)
          .maybeSingle();

        if (permitData) {
          const { data: userByPermit } = await supabase
            .from('users')
            .select(`
              *,
              vendors(name),
              work_permits(permit_no, expire_date)
            `)
            .eq('id', permitData.user_id)
            .order('created_at', { foreignTable: 'work_permits', ascending: false })
            .single();
            
          targetUser = userByPermit;
        }
      }

      if (!targetUser) {
        const { data: userByUUID } = await supabase
          .from('users')
          .select(`
            *,
            vendors(name),
            work_permits(permit_no, expire_date)
          `)
          .eq('id', id)
          .order('created_at', { foreignTable: 'work_permits', ascending: false })
          .maybeSingle();
          
        targetUser = userByUUID;
      }

      if (!targetUser) {
        setStatus('NOT_FOUND');
        return;
      }

      setUserData(targetUser);

      if (targetUser.is_active === false) {
          setStatus('SUSPENDED');
          return;
      }

      const today = new Date().getTime();
      
      // 🔥 ลอจิกใหม่: แยกการเช็คตามประเภทบัตร 100%
      let mode: 'INDUCTION' | 'WORK_PERMIT' = 'INDUCTION';
      let isValid = false;
      let expiryToStore: string | null = null;
      let permitObj = null;

      if (permitId) {
          // 📌 กรณีสแกน Work Permit (5 วัน)
          mode = 'WORK_PERMIT';
          if (targetUser.work_permits && targetUser.work_permits.length > 0) {
              permitObj = targetUser.work_permits.find((p: any) => p.permit_no === permitId);
          }
          
          if (!permitObj) {
              setStatus('NOT_FOUND');
              return;
          }
          expiryToStore = permitObj.expire_date;
          isValid = new Date(permitObj.expire_date).getTime() > today;
      } else {
          // 📌 กรณีสแกน Induction (รายปี)
          mode = 'INDUCTION';
          expiryToStore = targetUser.induction_expiry;
          isValid = targetUser.induction_expiry && new Date(targetUser.induction_expiry).getTime() > today;
      }

      // บันทึกค่าลง State เพื่อให้ UI เอาไปแสดงผลให้ตรงกับบริบท
      setVerifyMode(mode);
      setVerifiedExpiryDate(expiryToStore);
      setActivePermitObj(permitObj);

      setTimeout(() => {
        if (isValid) {
          setStatus('VALID');
        } else {
          setStatus('EXPIRED'); // ถ้าหมดอายุให้ขึ้น EXPIRED เลย
        }
      }, 100);

    } catch (err: any) {
      console.error('Verification error:', err);
      setErrorMsg(err.message);
      setStatus('NOT_FOUND');
    }
  };

  if (status === 'LOADING' || (status !== 'NOT_FOUND' && status !== 'SUSPENDED' && !userData)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6">
        <div className="relative">
          <Loader2 className="w-16 h-16 text-blue-600 animate-spin" strokeWidth={1.5} />
          <Fingerprint className="absolute inset-0 m-auto w-6 h-6 text-blue-400 animate-pulse" />
        </div>
        <p className="text-slate-500 font-black uppercase text-[10px] tracking-[0.3em] mt-6 animate-pulse">
          Authenticating Identity...
        </p>
      </div>
    );
  }

  if (status === 'NOT_FOUND' || status === 'SUSPENDED') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#f8fafc] p-8 text-center">
        <div className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-slate-100 max-w-sm w-full">
          <div className="bg-red-50 w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-10 h-10 text-red-500" />
          </div>
          <h1 className="text-xl font-black text-slate-800 uppercase tracking-tight">
              {status === 'SUSPENDED' ? 'Account Suspended' : 'Record Not Found'}
          </h1>
          <p className="text-sm text-slate-400 font-bold mt-2 leading-relaxed">
            {status === 'SUSPENDED' ? 'สิทธิ์ของคุณถูกระงับชั่วคราว โปรดติดต่อเจ้าหน้าที่' : 'ข้อมูลไม่ถูกต้อง หรือไม่มีรหัสนี้อยู่ในระบบ'}
          </p>
          {errorMsg && <p className="text-[9px] text-red-400 mt-2 font-mono break-words">{errorMsg}</p>}
          <button onClick={() => window.location.href = '/'} className="mt-8 w-full py-4 bg-slate-900 text-white font-black rounded-2xl text-[10px] uppercase tracking-widest active:scale-95 transition-all">
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  // ✅ ตัวแปรคุมธีมสี (แบ่งเป็น 3 โทน: ผ่าน = เขียว, หมดอายุ = ส้ม, อื่นๆ = แดง)
  const isSuccess = status === 'VALID';
  const isExpired = status === 'EXPIRED';

  const mainBg = isSuccess ? 'bg-emerald-500' : isExpired ? 'bg-amber-500' : 'bg-rose-500';
  const headerBg = isSuccess ? 'bg-gradient-to-b from-emerald-500 to-emerald-600' : isExpired ? 'bg-gradient-to-b from-amber-500 to-amber-600' : 'bg-gradient-to-b from-rose-500 to-rose-600';
  const iconColor = isSuccess ? 'text-emerald-500' : isExpired ? 'text-amber-500' : 'text-rose-500';
  const boxBg = isSuccess ? 'bg-emerald-50' : isExpired ? 'bg-amber-50' : 'bg-rose-50';
  const boxBorder = isSuccess ? 'border-emerald-100' : isExpired ? 'border-amber-100' : 'border-rose-100';
  const textMuted = isSuccess ? 'text-emerald-600/60' : isExpired ? 'text-amber-600/60' : 'text-rose-600/60';
  const textBold = isSuccess ? 'text-emerald-700' : isExpired ? 'text-amber-700' : 'text-rose-700';

  return (
    <div className={`min-h-screen p-4 md:p-6 flex flex-col items-center justify-center transition-colors duration-700 ${mainBg}`}>
      
      <div className="mb-6 flex flex-col items-center gap-2 text-white animate-in slide-in-from-top-4">
         <div className="bg-white/20 p-2 rounded-full backdrop-blur-md border border-white/30">
            <ShieldCheck size={20} />
         </div>
         {/* เปลี่ยน Title ด้านบนให้ตรงกับประเภทบัตร */}
         <span className="text-[10px] font-black uppercase tracking-[0.4em] text-center">
            {verifyMode === 'WORK_PERMIT' ? 'Work Permit Verification' : 'Safety Pass Verification'}
         </span>
      </div>

      <div className="bg-white w-full max-w-[360px] rounded-[3rem] shadow-[0_40px_80px_-15px_rgba(0,0,0,0.3)] overflow-hidden relative border-4 border-white/50 animate-in zoom-in duration-500">
        
        <div className={`pt-10 pb-8 text-center px-6 ${headerBg}`}>
          <div className="bg-white/10 w-24 h-24 rounded-[2rem] flex items-center justify-center mx-auto mb-4 backdrop-blur-md border border-white/20 shadow-xl">
            {isSuccess ? (
              <ShieldCheck className="w-14 h-14 text-white drop-shadow-lg" strokeWidth={1.5} />
            ) : isExpired ? (
              <Clock className="w-14 h-14 text-white drop-shadow-lg animate-pulse" strokeWidth={1.5} />
            ) : (
              <ShieldAlert className="w-14 h-14 text-white drop-shadow-lg" strokeWidth={1.5} />
            )}
          </div>
          <h1 className="text-4xl font-black text-white uppercase tracking-tighter">
            {isSuccess ? 'AUTHORIZED' : isExpired ? 'EXPIRED' : 'DENIED'}
          </h1>
          <p className="text-white/80 font-black text-[10px] uppercase tracking-[0.2em] mt-2">
            {isSuccess 
              ? 'อนุญาตให้เข้าปฏิบัติงาน' 
              : isExpired 
                ? (verifyMode === 'WORK_PERMIT' ? 'ใบอนุญาตทำงานหมดอายุ' : 'ประวัติการอบรมหมดอายุ')
                : 'ไม่อนุญาต - ตรวจพบข้อผิดพลาด'}
          </p>
        </div>

        <div className="p-8 space-y-4">
          <div className="text-center relative mb-6">
            <div className="w-20 h-20 bg-slate-50 rounded-[1.5rem] mx-auto mb-4 flex items-center justify-center border border-slate-100 shadow-inner relative overflow-hidden group">
               {userData?.avatar_url ? (
                  <img src={userData.avatar_url} alt="Profile" className="w-full h-full object-cover" />
               ) : (
                  <User className="w-8 h-8 text-slate-300" />
               )}
               <div className="absolute inset-0 bg-blue-600/5 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <h2 className="text-xl font-black text-slate-900 leading-tight uppercase tracking-tight">{userData?.name || 'Unknown User'}</h2>
            <p className="text-[10px] text-slate-400 font-bold mt-1.5 tracking-widest font-mono">{userData?.national_id || '-'}</p>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100/50">
              <div className="bg-white p-2.5 rounded-xl shadow-sm border border-slate-100"><Building2 className="w-4 h-4 text-blue-500"/></div>
              <div className="min-w-0">
                <p className="text-[8px] uppercase text-slate-400 font-black tracking-widest">Affiliation / สังกัด</p>
                <p className="font-bold text-slate-700 text-sm truncate">{userData?.vendors?.name || 'Authorized Personnel'}</p>
              </div>
            </div>

            {/* โชว์กล่องเลข Permit เฉพาะเวลาที่เป็น Work Permit เท่านั้น */}
            {verifyMode === 'WORK_PERMIT' && activePermitObj && (
               <div className="flex items-center gap-4 p-4 bg-blue-50/50 rounded-2xl border border-blue-100">
                  <div className="bg-white p-2.5 rounded-xl shadow-sm border border-blue-100"><FileText className="w-4 h-4 text-blue-500"/></div>
                  <div className="min-w-0">
                    <p className="text-[8px] uppercase text-blue-400 font-black tracking-widest">Work Permit Number</p>
                    <p className="font-bold text-blue-700 text-sm truncate">{activePermitObj.permit_no}</p>
                  </div>
               </div>
            )}

            <div className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${boxBg} ${boxBorder}`}>
              <div className="bg-white p-2.5 rounded-xl shadow-sm border border-white">
                <CalendarDays className={`w-4 h-4 ${iconColor}`}/>
              </div>
              <div>
                <p className={`text-[8px] uppercase font-black tracking-widest ${textMuted}`}>
                  {verifyMode === 'WORK_PERMIT' ? 'Permit Valid Until' : 'Induction Valid Until'}
                </p>
                <p className={`font-black text-sm ${textBold}`}>
                  {verifiedExpiryDate ? new Date(verifiedExpiryDate).toLocaleDateString('th-TH', { 
                    day: 'numeric', month: 'short', year: 'numeric' 
                  }) : 'Not Available'}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="p-5 bg-slate-50 text-center border-t border-slate-100 space-y-1">
          <div className="flex items-center justify-center gap-1.5 text-slate-400">
             <Clock size={12} className="opacity-60" />
             <p className="text-[9px] font-black uppercase tracking-widest">
               VERIFIED AT {new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
             </p>
          </div>
          <p className="text-[8px] text-slate-300 font-bold uppercase tracking-tighter">
            System Node: SP-AUTH-GATE-2026
          </p>
        </div>
      </div>
    </div>
  );
};

export default VerifyPage;