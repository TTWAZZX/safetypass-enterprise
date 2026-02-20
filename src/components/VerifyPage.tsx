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
  const [status, setStatus] = useState<'LOADING' | 'VALID' | 'EXPIRED' | 'NOT_FOUND' | 'SUSPENDED'>('LOADING');
  const [userData, setUserData] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string>(''); // เอาไว้จับ Error โชว์บนหน้าจอแทนหน้าขาว

  useEffect(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      let userId = urlParams.get('id');

      if (!userId) {
        const pathParts = window.location.pathname.split('/');
        const potentialId = pathParts[pathParts.length - 1];
        if (potentialId && potentialId !== 'verify') {
          userId = potentialId;
        }
      }

      if (userId) {
        checkUserStatus(decodeURIComponent(userId));
      } else {
        setStatus('NOT_FOUND');
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message);
      setStatus('NOT_FOUND');
    }
  }, []);

  const checkUserStatus = async (id: string) => {
    try {
      let targetUser = null;

      // สเต็ป A: ค้นหาจาก National ID ก่อน
      const { data: userById, error: err1 } = await supabase
        .from('users')
        .select(`*, vendors(name), work_permits(permit_no, expire_date)`)
        .eq('national_id', id)
        .order('created_at', { foreignTable: 'work_permits', ascending: false })
        .limit(1, { foreignTable: 'work_permits' })
        .maybeSingle();

      targetUser = userById;

      // สเต็ป B: ถ้าไม่เจอ ลองหาจาก Work Permit Number
      if (!targetUser) {
        const { data: permitData } = await supabase
          .from('work_permits')
          .select('user_id')
          .eq('permit_no', id)
          .maybeSingle();

        if (permitData) {
          const { data: userByPermit } = await supabase
            .from('users')
            .select(`*, vendors(name), work_permits(permit_no, expire_date)`)
            .eq('id', permitData.user_id)
            .order('created_at', { foreignTable: 'work_permits', ascending: false })
            .limit(1, { foreignTable: 'work_permits' })
            .single();
            
          targetUser = userByPermit;
        }
      }

      if (!targetUser) {
        setStatus('NOT_FOUND');
        return;
      }

      // ✅ บังคับให้เก็บ Data ก่อนค่อยเปลี่ยน Status ป้องกันหน้าขาว
      setUserData(targetUser);

      if (targetUser.is_active === false) {
          setStatus('SUSPENDED');
          return;
      }

      const today = new Date().getTime();
      const isInductionValid = targetUser.induction_expiry && new Date(targetUser.induction_expiry).getTime() > today;
      const latestPermit = targetUser.work_permits?.[0];
      const isPermitValid = latestPermit && new Date(latestPermit.expire_date).getTime() > today;

      // ให้เวลา React อัปเดต State ก่อนเปลี่ยนหน้า (ป้องกันแครช)
      setTimeout(() => {
        if (isInductionValid || isPermitValid) {
          setStatus('VALID');
        } else {
          setStatus('EXPIRED');
        }
      }, 100);

    } catch (err: any) {
      console.error('Verification error:', err);
      setErrorMsg(err.message);
      setStatus('NOT_FOUND');
    }
  };

  // 🛡️ เช็คความปลอดภัยชั้นที่ 1: ถ้ากำลังโหลด หรือ ข้อมูลยังไม่มา ให้โชว์โหลดหมุนๆ ห้ามแครช!
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

  // 🛡️ เช็คความปลอดภัยชั้นที่ 2: ถ้าหาไม่เจอ หรือโดนแบน
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
            {status === 'SUSPENDED' ? 'สิทธิ์ของคุณถูกระงับชั่วคราว โปรดติดต่อเจ้าหน้าที่' : 'ข้อมูลไม่ถูกต้อง หรือไม่มีรหัสพนักงานนี้อยู่ในระบบ'}
          </p>
          {errorMsg && <p className="text-[9px] text-red-400 mt-2 font-mono break-words">{errorMsg}</p>}
          <button 
            onClick={() => window.location.href = '/'}
            className="mt-8 w-full py-4 bg-slate-900 text-white font-black rounded-2xl text-[10px] uppercase tracking-widest active:scale-95 transition-all"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  // 🛡️ เช็คความปลอดภัยชั้นที่ 3: กันพังตอนดึง Work Permit
  const activePermit = userData?.work_permits && Array.isArray(userData.work_permits) ? userData.work_permits[0] : null;

  return (
    <div className={`min-h-screen p-4 md:p-6 flex flex-col items-center justify-center transition-colors duration-700 ${status === 'VALID' ? 'bg-emerald-500' : 'bg-rose-500'}`}>
      
      <div className="mb-6 flex flex-col items-center gap-2 text-white animate-in slide-in-from-top-4">
         <div className="bg-white/20 p-2 rounded-full backdrop-blur-md border border-white/30">
            <ShieldCheck size={20} />
         </div>
         <span className="text-[10px] font-black uppercase tracking-[0.4em]">Official Verification</span>
      </div>

      <div className="bg-white w-full max-w-[360px] rounded-[3rem] shadow-[0_40px_80px_-15px_rgba(0,0,0,0.3)] overflow-hidden relative border-4 border-white/50 animate-in zoom-in duration-500">
        
        <div className={`pt-10 pb-8 text-center px-6 ${status === 'VALID' ? 'bg-gradient-to-b from-emerald-500 to-emerald-600' : 'bg-gradient-to-b from-rose-500 to-rose-600'}`}>
          <div className="bg-white/10 w-24 h-24 rounded-[2rem] flex items-center justify-center mx-auto mb-4 backdrop-blur-md border border-white/20 shadow-xl">
            {status === 'VALID' ? (
              <ShieldCheck className="w-14 h-14 text-white drop-shadow-lg" strokeWidth={1.5} />
            ) : (
              <ShieldAlert className="w-14 h-14 text-white drop-shadow-lg" strokeWidth={1.5} />
            )}
          </div>
          <h1 className="text-4xl font-black text-white uppercase tracking-tighter">
            {status === 'VALID' ? 'AUTHORIZED' : 'ACCESS DENIED'}
          </h1>
          <p className="text-white/80 font-black text-[10px] uppercase tracking-[0.2em] mt-2">
            {status === 'VALID' ? 'อนุญาตให้เข้าปฏิบัติงาน' : 'ไม่อนุญาต - ตรวจพบข้อผิดพลาด'}
          </p>
        </div>

        <div className="p-8 space-y-4">
          <div className="text-center relative mb-6">
            <div className="w-20 h-20 bg-slate-50 rounded-[1.5rem] mx-auto mb-4 flex items-center justify-center border border-slate-100 shadow-inner relative overflow-hidden group">
               <User className="w-8 h-8 text-slate-300" />
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

            {activePermit && activePermit.permit_no && (
               <div className="flex items-center gap-4 p-4 bg-blue-50/50 rounded-2xl border border-blue-100">
                  <div className="bg-white p-2.5 rounded-xl shadow-sm border border-blue-100"><FileText className="w-4 h-4 text-blue-500"/></div>
                  <div className="min-w-0">
                    <p className="text-[8px] uppercase text-blue-400 font-black tracking-widest">Work Permit Number</p>
                    <p className="font-bold text-blue-700 text-sm truncate">{activePermit.permit_no}</p>
                  </div>
               </div>
            )}

            <div className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${status === 'VALID' ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'}`}>
              <div className="bg-white p-2.5 rounded-xl shadow-sm border border-white"><CalendarDays className={`w-4 h-4 ${status === 'VALID' ? 'text-emerald-500' : 'text-rose-500'}`}/></div>
              <div>
                <p className={`text-[8px] uppercase font-black tracking-widest ${status === 'VALID' ? 'text-emerald-600/60' : 'text-rose-600/60'}`}>Compliance Valid Until</p>
                <p className={`font-black text-sm ${status === 'VALID' ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {userData?.induction_expiry ? new Date(userData.induction_expiry).toLocaleDateString('th-TH', { 
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