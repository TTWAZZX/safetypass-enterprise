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
  CalendarDays,
  Ticket, // ไอคอนสำหรับ Work Permit
  User as UserIcon,
  ArrowLeft
} from 'lucide-react';

interface DigitalCardProps {
  user: User;
  onBack: () => void;
  // ✅ เพิ่ม Props สำหรับ Work Permit
  type?: 'INDUCTION' | 'WORK_PERMIT'; 
  permit?: WorkPermitSession | null;
}

const DigitalCard: React.FC<DigitalCardProps> = ({ 
  user, 
  onBack, 
  type = 'INDUCTION', // ค่าเริ่มต้นคือ Induction
  permit 
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  // ตั้งค่าธีมสีและข้อความตามประเภทบัตร
  const isPermit = type === 'WORK_PERMIT';
  const themeColor = isPermit ? 'from-purple-900 via-indigo-900 to-blue-900' : 'from-slate-900 via-slate-800 to-emerald-900';
  const accentColor = isPermit ? 'text-purple-400' : 'text-emerald-400';
  const cardTitle = isPermit ? 'WORK PERMIT' : 'SAFETY PASS';
  const cardIcon = isPermit ? <Ticket className={accentColor} size={24} /> : <ShieldCheck className={accentColor} size={24} />;
  
  // ข้อมูลที่จะแสดง
  const displayId = isPermit ? permit?.permit_no : user.national_id;
  const idLabel = isPermit ? 'PERMIT NO.' : 'ID NUMBER';
  
  // วันหมดอายุ
  const expiryDate = isPermit 
    ? (permit?.expire_date ? new Date(permit.expire_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '-')
    : (user.induction_expiry ? new Date(user.induction_expiry).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '-');

  const issueDate = new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });

  // QR Value: ถ้าเป็น Permit ให้ใส่เลข Permit ไปด้วย (หรือ URL Verify เฉพาะ)
  const qrValue = isPermit 
    ? `https://safetypass.app/verify/${user.id}?permit=${permit?.permit_no}`
    : `https://safetypass.app/verify/${user.id}`;

  const handleDownload = async () => {
    if (!cardRef.current) return;
    setDownloading(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      const canvas = await html2canvas(cardRef.current, { scale: 3, useCORS: true, backgroundColor: null });
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
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-4 animate-in zoom-in duration-500">
      
      {/* Header Text */}
      <div className="mb-6 text-center">
        <button onClick={onBack} className="flex items-center gap-2 text-slate-400 hover:text-slate-600 mb-4 mx-auto text-sm font-bold">
            <ArrowLeft size={16}/> ย้อนกลับ
        </button>
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-white shadow-xl ${isPermit ? 'bg-purple-100 text-purple-600' : 'bg-emerald-100 text-emerald-700'}`}>
          {isPermit ? <Ticket size={32} /> : <CheckCircle2 size={40} />}
        </div>
        <h2 className="text-2xl font-black text-slate-900">{isPermit ? 'ใบอนุญาตทำงาน (5 วัน)' : 'บัตรประจำตัวความปลอดภัย'}</h2>
        <p className="text-slate-500">{isPermit ? 'แสดงหน้านี้ต่อเจ้าหน้าที่เพื่อเข้าพื้นที่' : 'ใช้สำหรับยืนยันการผ่านอบรม Induction'}</p>
      </div>

      {/* 🟢 ตัวบัตร Digital Card */}
      <div className="relative group perspective-1000">
        <div 
          ref={cardRef}
          className={`w-[340px] h-[540px] bg-gradient-to-br ${themeColor} rounded-[2rem] shadow-2xl overflow-hidden relative text-white border border-slate-700/50`}
        >
          {/* Background Patterns */}
          <div className={`absolute top-0 right-0 w-64 h-64 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 opacity-30 ${isPermit ? 'bg-pink-500' : 'bg-blue-500'}`}></div>
          <div className={`absolute bottom-0 left-0 w-64 h-64 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2 opacity-20 ${isPermit ? 'bg-purple-500' : 'bg-emerald-500'}`}></div>

          {/* Card Header */}
          <div className="p-6 relative z-10 flex justify-between items-start">
            <div>
              <div className="flex items-center gap-2 mb-1">
                {cardIcon}
                <span className="font-black text-lg tracking-wider">{cardTitle}</span>
              </div>
              <p className="text-[10px] text-slate-400 uppercase tracking-[0.2em]">Official Certificate</p>
            </div>
            <div className="w-10 h-10 bg-white/10 rounded-lg backdrop-blur-sm border border-white/20 flex items-center justify-center">
               <span className="font-black text-xs">LOGO</span>
            </div>
          </div>

          {/* User Photo & Info */}
          <div className="px-6 relative z-10 text-center mt-2">
            <div className={`w-28 h-28 mx-auto bg-gradient-to-b p-[3px] rounded-full shadow-lg mb-4 ${isPermit ? 'from-pink-400 to-purple-500 shadow-purple-900/50' : 'from-blue-400 to-emerald-400 shadow-blue-900/50'}`}>
              <div className="w-full h-full bg-slate-800 rounded-full overflow-hidden flex items-center justify-center">
                 <UserIcon size={40} className="text-slate-400"/>
              </div>
            </div>
            
            <h3 className="text-2xl font-bold mb-1 truncate">{user.name}</h3>
            <div className="flex items-center justify-center gap-2 text-slate-300 text-sm mb-4">
               <Building2 size={14} />
               <span className="font-medium">{user.vendors?.name || 'Unknown Vendor'}</span>
            </div>

            {/* Grid Details */}
            <div className="grid grid-cols-2 gap-3 bg-white/5 rounded-2xl p-4 backdrop-blur-md border border-white/10">
               <div className="text-left">
                  <p className="text-[10px] text-slate-400 uppercase font-bold">Issue Date</p>
                  <p className={`font-bold text-sm ${accentColor}`}>{issueDate}</p>
               </div>
               <div className="text-left">
                  <p className="text-[10px] text-slate-400 uppercase font-bold">Expiry Date</p>
                  <p className="font-bold text-sm text-red-400">{expiryDate}</p>
               </div>
               <div className="col-span-2 text-left border-t border-white/10 pt-2 mt-1">
                  <p className="text-[10px] text-slate-400 uppercase font-bold">{idLabel}</p>
                  <p className="font-mono text-sm tracking-wider text-slate-200">{displayId}</p>
               </div>
            </div>
          </div>

          {/* Footer & QR */}
          <div className="absolute bottom-0 w-full p-6 bg-slate-950/50 backdrop-blur-xl border-t border-white/5 flex items-center justify-between">
             <div className="bg-white p-2 rounded-xl">
                <QRCode 
                  value={qrValue} 
                  size={64}
                  level="M" 
                />
             </div>
             <div className="text-right">
                <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Status</p>
                <div className={`flex items-center justify-end gap-1.5 px-3 py-1 rounded-full border ${isPermit ? 'bg-purple-500/20 border-purple-500/30' : 'bg-emerald-500/20 border-emerald-500/30'}`}>
                   <div className={`w-2 h-2 rounded-full animate-pulse ${isPermit ? 'bg-purple-400' : 'bg-emerald-400'}`}></div>
                   <span className={`text-xs font-bold uppercase ${isPermit ? 'text-purple-400' : 'text-emerald-400'}`}>Active</span>
                </div>
             </div>
          </div>

        </div>
      </div>

      {/* Action Buttons */}
      <div className="mt-8 flex gap-4 w-full max-w-sm">
        <button 
          onClick={handleDownload}
          disabled={downloading}
          className={`flex-1 py-4 text-white font-bold rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-70 ${isPermit ? 'bg-purple-600 hover:bg-purple-700 shadow-purple-200' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-200'}`}
        >
          {downloading ? <Loader2 className="animate-spin"/> : <Download size={20} />}
          บันทึกรูป
        </button>
      </div>

    </div>
  );
};

export default DigitalCard;