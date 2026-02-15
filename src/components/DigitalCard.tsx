import React, { useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import html2canvas from 'html2canvas';
import { User, WorkPermitSession } from '../types';
import { 
  Download, 
  CheckCircle2, 
  ShieldCheck, 
  Loader2,
  Building2,
  Ticket, 
  User as UserIcon,
  ArrowLeft,
  Shield
} from 'lucide-react';

interface DigitalCardProps {
  user: User;
  onBack: () => void;
  type?: 'INDUCTION' | 'WORK_PERMIT'; 
  permit?: WorkPermitSession | null;
}

const DigitalCard: React.FC<DigitalCardProps> = ({ 
  user, 
  onBack, 
  type = 'INDUCTION', 
  permit 
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  const isPermit = type === 'WORK_PERMIT';
  const themeColor = isPermit 
    ? 'from-slate-900 via-indigo-950 to-purple-950' 
    : 'from-[#0f172a] via-[#1e293b] to-[#064e3b]';
  const accentColor = isPermit ? 'text-purple-400' : 'text-emerald-400';
  const cardTitle = isPermit ? 'WORK PERMIT' : 'SAFETY PASS';
  const cardIcon = isPermit ? <Ticket className={accentColor} size={20} /> : <ShieldCheck className={accentColor} size={20} />;
  
  const displayId = isPermit ? permit?.permit_no : user.national_id;
  const idLabel = isPermit ? 'PERMIT NO.' : 'NATIONAL ID';
  
  const expiryDate = isPermit 
    ? (permit?.expire_date ? new Date(permit.expire_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '-')
    : (user.induction_expiry ? new Date(user.induction_expiry).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '-');

  const issueDate = new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });

  const qrValue = isPermit 
    ? `https://safetypass.app/verify/${user.id}?permit=${permit?.permit_no}`
    : `https://safetypass.app/verify/${user.id}`;

  const handleDownload = async () => {
    if (!cardRef.current) return;
    setDownloading(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 600));
      // ✅ แก้ไขแล้ว: ลบ borderRadius ออกเพื่อไม่ให้ติด Error
      const canvas = await html2canvas(cardRef.current, { 
        scale: 3, 
        useCORS: true, 
        backgroundColor: null 
      });
      const image = canvas.toDataURL("image/png", 1.0);
      const link = document.createElement("a");
      link.href = image;
      link.download = `SafetyPass_${isPermit ? 'Permit' : 'Induction'}_${user.national_id}.png`;
      link.click();
    } catch (err) {
      console.error(err);
      alert("บันทึกรูปภาพไม่สำเร็จ");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex flex-col items-center min-h-screen p-4 animate-in fade-in duration-700 text-left">
      
      <div className="w-full max-w-[320px] flex items-center justify-between mb-6">
        <button onClick={onBack} className="flex items-center gap-1.5 text-slate-400 hover:text-blue-600 transition-colors py-2 px-1 rounded-xl active:bg-slate-100">
            <ArrowLeft size={16}/>
            <span className="text-[10px] font-black uppercase tracking-widest">Back</span>
        </button>
        <div className={`px-3 py-1 rounded-lg border text-[9px] font-black uppercase tracking-tighter ${isPermit ? 'bg-purple-50 text-purple-600 border-purple-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
          Digital Identity
        </div>
      </div>

      <div className="text-center mb-6">
         <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">
            {isPermit ? 'Contractor Work Permit' : 'Personnel Safety Pass'}
         </h2>
         <p className="text-[10px] text-slate-400 font-bold uppercase mt-1 tracking-wide">
            {isPermit ? 'Show to security at entry point' : 'Verified Safety Induction Status'}
         </p>
      </div>

      <div className="relative group touch-none">
        <div 
          ref={cardRef}
          className={`w-[310px] h-[480px] bg-gradient-to-br ${themeColor} rounded-[2.5rem] shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] overflow-hidden relative text-white border border-white/10`}
        >
          <div className={`absolute top-0 right-0 w-40 h-40 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/2 opacity-40 ${isPermit ? 'bg-pink-600' : 'bg-blue-600'}`}></div>
          <div className={`absolute bottom-0 left-0 w-40 h-40 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/2 opacity-30 ${isPermit ? 'bg-indigo-600' : 'bg-emerald-600'}`}></div>

          <div className="p-6 relative z-10 flex justify-between items-start">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <div className="bg-white/10 p-1.5 rounded-lg backdrop-blur-md border border-white/20">
                    {cardIcon}
                </div>
                <span className="font-black text-sm tracking-widest uppercase">{cardTitle}</span>
              </div>
              <p className="text-[7px] text-slate-400 font-bold uppercase tracking-[0.3em] ml-1">Identity Confirmed</p>
            </div>
            <div className="p-1.5 bg-white/5 rounded-lg backdrop-blur-md border border-white/10 opacity-40">
               <Shield size={14} className="text-white" />
            </div>
          </div>

          <div className="px-6 relative z-10 text-center mt-2">
            <div className={`w-20 h-20 mx-auto bg-gradient-to-b p-[2.5px] rounded-[1.8rem] shadow-2xl mb-4 ${isPermit ? 'from-pink-400 to-indigo-500' : 'from-blue-400 to-emerald-400'}`}>
              <div className="w-full h-full bg-slate-900 rounded-[1.6rem] overflow-hidden flex items-center justify-center border border-white/10">
                 <UserIcon size={32} className="text-slate-500 opacity-50"/>
              </div>
            </div>
            
            <h3 className="text-lg font-black mb-1 truncate tracking-tight uppercase px-2">{user.name}</h3>
            <div className="flex items-center justify-center gap-1.5 text-slate-400 text-[9px] mb-6 font-bold uppercase tracking-wide">
               <Building2 size={10} className="opacity-50 flex-shrink-0" />
               <span className="truncate max-w-[160px]">{user.vendors?.name || 'Authorized Contractor'}</span>
            </div>

            <div className="grid grid-cols-2 gap-3 bg-slate-950/40 rounded-[1.5rem] p-4 backdrop-blur-xl border border-white/5 shadow-inner">
               <div className="text-left">
                  <p className="text-[7px] text-slate-500 uppercase font-black tracking-widest mb-0.5">Issue Date</p>
                  <p className={`font-black text-[11px] ${accentColor}`}>{issueDate}</p>
               </div>
               <div className="text-left">
                  <p className="text-[7px] text-slate-500 uppercase font-black tracking-widest mb-0.5">Expiry Date</p>
                  <p className="font-black text-[11px] text-red-400">{expiryDate}</p>
               </div>
               <div className="col-span-2 text-left pt-2.5 border-t border-white/5">
                  <p className="text-[7px] text-slate-500 uppercase font-black tracking-widest mb-0.5">{idLabel}</p>
                  <p className="font-mono text-[11px] font-bold tracking-widest text-slate-200">{displayId}</p>
               </div>
            </div>
          </div>

          <div className="absolute bottom-0 w-full p-5 bg-slate-950/60 backdrop-blur-2xl border-t border-white/5 flex items-center justify-between">
             <div className="bg-white p-1 rounded-xl shadow-lg border-[3px] border-white/10">
                <QRCode 
                  value={qrValue} 
                  size={50}
                  level="H" 
                />
             </div>
             <div className="text-right">
                <p className="text-[7px] text-slate-500 uppercase font-black tracking-widest mb-1 text-right">Auth Status</p>
                <div className={`flex items-center justify-end gap-1 px-2.5 py-1 rounded-lg border ${isPermit ? 'bg-purple-500/10 border-purple-500/20' : 'bg-emerald-500/10 border-emerald-500/20'}`}>
                   <div className={`w-1 h-1 rounded-full animate-pulse ${isPermit ? 'bg-purple-400' : 'bg-emerald-400'}`}></div>
                   <span className={`text-[9px] font-black uppercase tracking-tighter ${isPermit ? 'text-purple-400' : 'text-emerald-400'}`}>Verified</span>
                </div>
             </div>
          </div>

        </div>
      </div>

      <div className="mt-8 flex flex-col gap-3 w-full max-w-[310px]">
        <button 
          onClick={handleDownload}
          disabled={downloading}
          className={`w-full py-3.5 text-white font-black rounded-2xl shadow-xl transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-70 ${isPermit ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200' : 'bg-[#2563eb] hover:bg-blue-700 shadow-blue-200'}`}
        >
          {downloading ? <Loader2 className="animate-spin" size={18}/> : <Download size={18} />}
          <span className="uppercase text-xs tracking-widest">Download Identity Pass</span>
        </button>
        
        <p className="text-[8px] text-slate-400 font-bold text-center uppercase tracking-widest mt-2 opacity-60">
          Enterprise Security Protocol • ID 2026
        </p>
      </div>

    </div>
  );
};

export default DigitalCard;