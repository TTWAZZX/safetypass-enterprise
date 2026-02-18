import React, { useState, useEffect } from 'react';
import { User, WorkPermitSession, ExamType } from '../types';
import { api as mockApi } from '../services/supabaseApi';
import { supabase } from '../services/supabaseClient'; 
import { useTranslation } from '../context/LanguageContext';
import ExamSystem from './ExamSystem';
import DigitalCard from './DigitalCard'; 
import ExamHistory from './ExamHistory'; 
import {
  BookOpen,
  Lock,
  ChevronRight,
  Ticket,
  QrCode,
  X,
  FileText,
  Download,
  ShieldCheck,
  Edit3,
  Save,
  RotateCcw,
  RefreshCw,
  Clock,
  Loader2, 
  Calendar, 
  Globe2,
  CheckCircle2,
  AlertTriangle,
  ArrowRightCircle
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useToastContext } from './ToastProvider';

const maskNationalID = (id: string) => {
  if (!id || id.length < 13) return id;
  return `${id.substring(0, 1)}-${id.substring(1, 5)}-XXXXX-${id.substring(10, 12)}-${id.substring(12)}`;
};

interface UserPanelProps {
  user: User;
  onUserUpdate: (user: User) => void;
}

const UserPanel: React.FC<UserPanelProps> = ({ user, onUserUpdate }) => {
  const { t, language } = useTranslation();
  const { showToast } = useToastContext();

  const [activeStage, setActiveStage] = useState<'IDLE' | 'INDUCTION' | 'WORK_PERMIT'>('IDLE');
  const [activePermit, setActivePermit] = useState<WorkPermitSession | null>(null);
  const [showQRFullScreen, setShowQRFullScreen] = useState(false);
  const [viewingManual, setViewingManual] = useState<ExamType | null>(null);
  const [showCard, setShowCard] = useState(false);
  const [cardType, setCardType] = useState<'INDUCTION' | 'WORK_PERMIT'>('INDUCTION');
  const [showHistory, setShowHistory] = useState(false);

  // Profile Edit States
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(user.name);
  const [editAge, setEditAge] = useState(user.age || '');
  const [editNationality, setEditNationality] = useState(user.nationality || 'ไทย (Thai)');
  const [isOtherNationality, setIsOtherNationality] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // ✅ 1. Focus Mode Logic: จัดการการแสดงผล Bottom Nav ในระดับ CSS
  // เมื่อมีการสอบ หรือดูบัตร เราจะสั่งซ่อน Bottom Nav ผ่านการคุมคลาสที่ตัวแม่ (ถ้าจำเป็น) 
  // หรือใช้การคุมพื้นที่ผ่าน padding ในหน้านี้
  useEffect(() => {
    const bottomNav = document.querySelector('nav.md\\:hidden');
    if (activeStage !== 'IDLE' || showCard || viewingManual || showHistory) {
      bottomNav?.classList.add('hidden');
    } else {
      bottomNav?.classList.remove('hidden');
    }
    // Cleanup เมื่อออกหน้า
    return () => bottomNav?.classList.remove('hidden');
  }, [activeStage, showCard, viewingManual, showHistory]);

  useEffect(() => {
    const fetchPermit = async () => {
        try {
            const data = await mockApi.getActiveWorkPermit(user.id);
            setActivePermit(data);
        } catch (error) {
            console.error("Error fetching permit:", error);
        }
    };
    fetchPermit();
  }, [user.id]);

  useEffect(() => {
    if (isEditing) {
      const standardList = ['ไทย (Thai)', 'พม่า (Myanmar)', 'กัมพูชา (Cambodian)', 'ลาว (Lao)'];
      if (user.nationality && !standardList.includes(user.nationality)) {
        setIsOtherNationality(true);
      } else {
        setIsOtherNationality(false);
      }
    }
  }, [isEditing, user.nationality]);

  const hasInduction = user.induction_expiry && new Date(user.induction_expiry) > new Date();
  const isNearExpiry = user.induction_expiry && (new Date(user.induction_expiry).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24) < 30;

  const handleUpdateProfile = async () => {
    if (!editName.trim()) return showToast('กรุณากรอกชื่อ-นามสกุล', 'error');
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('users')
        .update({ 
          name: editName, 
          age: Number(editAge), 
          nationality: editNationality 
        })
        .eq('id', user.id);

      if (error) throw error;
      onUserUpdate({ ...user, name: editName, age: Number(editAge), nationality: editNationality });
      showToast('อัปเดตข้อมูลส่วนตัวเรียบร้อยแล้ว', 'success');
      setIsEditing(false);
    } catch (err: any) {
      showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetExam = async () => {
    if(!window.confirm("คุณต้องการล้างประวัติการอบรมเพื่อเริ่มสอบใหม่ใช่หรือไม่?")) return;
    setIsSaving(true);
    try {
      const { error } = await supabase.from('users').update({ induction_expiry: null }).eq('id', user.id);
      if (error) throw error;
      onUserUpdate({ ...user, induction_expiry: null });
      showToast('รีเซ็ตสถานะการอบรมแล้ว คุณสามารถเริ่มสอบใหม่ได้ทันที', 'success');
    } catch (err: any) {
      showToast('ไม่สามารถรีเซ็ตได้: ' + err.message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // ✅ Focus Mode Render: ซ่อนทุกอย่างเพื่อโชว์หน้าเฉพาะทาง
  if (showCard) return <DigitalCard user={user} onBack={() => setShowCard(false)} type={cardType} permit={activePermit} />;
  if (showHistory) return <ExamHistory userId={user.id} onBack={() => setShowHistory(false)} />;
  
  if (activeStage !== 'IDLE') {
    return (
      <div className="animate-in fade-in zoom-in-95 duration-300">
        <ExamSystem
          type={activeStage === 'INDUCTION' ? ExamType.INDUCTION : ExamType.WORK_PERMIT}
          user={user}
          onComplete={(u) => {
            onUserUpdate(u);
            setActiveStage('IDLE');
            showToast('บันทึกผลการสอบเรียบร้อยแล้ว', 'success');
            if (u.induction_expiry && activeStage === 'INDUCTION') { setCardType('INDUCTION'); setShowCard(true); }
            if (activeStage === 'WORK_PERMIT') {
                setTimeout(async () => {
                    const data = await mockApi.getActiveWorkPermit(user.id);
                    setActivePermit(data);
                    setCardType('WORK_PERMIT');
                    setShowCard(true);
                }, 1500);
            }
          }}
          onBack={() => setActiveStage('IDLE')}
        />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-slate-50/50 pb-24 text-left">
      
      {/* 🎨 Background Pattern Overlay */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-40" 
           style={{ backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)', backgroundSize: '24px 24px' }}>
      </div>

      <div className="relative z-10 max-w-2xl mx-auto p-4 space-y-6 md:space-y-8 animate-in fade-in duration-500">
        
        {/* 🟢 Hero Section: Floating Identity Card */}
        <div className="relative pt-4">
          <div className="absolute top-20 left-1/2 -translate-x-1/2 w-3/4 h-20 bg-blue-500/20 blur-[60px] rounded-full pointer-events-none"></div>
          <div className="absolute top-0 left-0 right-0 h-36 bg-gradient-to-r from-blue-600 to-indigo-800 rounded-[2.5rem] shadow-sm overflow-hidden">
               <div className="absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]"></div>
          </div>

          <div className="relative z-10 mx-2 md:mx-6 bg-white rounded-[2rem] p-5 md:p-6 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.1)] border border-slate-100 mt-16 flex flex-col md:flex-row gap-5 items-start md:items-center">
              <div className="relative self-center md:self-start">
                  <div className="w-24 h-24 rounded-[1.5rem] bg-white p-1.5 shadow-lg -mt-16 md:mt-0 relative z-20">
                      <div className="w-full h-full rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center text-blue-600 text-4xl font-black border border-slate-200 uppercase shadow-inner">
                          {user.name ? user.name.charAt(0) : '?'}
                      </div>
                  </div>
                  <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[9px] font-black px-3 py-1.5 rounded-full uppercase tracking-widest border-4 border-white shadow-md flex items-center gap-1 whitespace-nowrap z-30">
                      <ShieldCheck size={10} /> {user.role === 'ADMIN' ? 'Admin' : 'User'}
                  </div>
              </div>

              <div className="flex-1 w-full pt-4 md:pt-0 text-center md:text-left">
                  {isEditing ? (
                    <div className="space-y-3 text-left">
                       <input className="text-lg font-bold text-slate-900 border-b-2 border-blue-500 outline-none w-full bg-slate-50 px-3 py-2 rounded-t-lg transition-all" value={editName} onChange={(e) => setEditName(e.target.value)} />
                        <div className="grid grid-cols-2 gap-3">
                           <div>
                              <label className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Age</label>
                              <input type="number" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-xs outline-none focus:border-blue-500" value={editAge} onChange={(e) => setEditAge(e.target.value)} />
                           </div>
                           <div>
                              <label className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Nationality</label>
                              <select className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-xs outline-none focus:border-blue-500" value={isOtherNationality ? 'OTHER' : editNationality} onChange={(e) => {
                                  const val = e.target.value;
                                  if (val === 'OTHER') { setIsOtherNationality(true); setEditNationality(''); } 
                                  else { setIsOtherNationality(false); setEditNationality(val); }
                                }}>
                                <option value="ไทย (Thai)">ไทย (Thai)</option>
                                <option value="พม่า (Myanmar)">พม่า (Myanmar)</option>
                                <option value="กัมพูชา (Cambodian)">กัมพูชา (Cambodian)</option>
                                <option value="ลาว (Lao)">ลาว (Lao)</option>
                                <option value="OTHER">อื่นๆ / Other</option>
                              </select>
                           </div>
                        </div>
                    </div>
                  ) : (
                    <div>
                        <h2 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight uppercase leading-none mb-3">{user.name}</h2>
                        <div className="flex flex-wrap justify-center md:justify-start gap-2 text-[10px] md:text-xs font-bold text-slate-500">
                          <span className="bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100 flex items-center gap-1.5 group relative">
                            <Ticket size={12} className="text-blue-500"/> {maskNationalID(user.national_id)} <Lock size={10} className="text-emerald-500 ml-1" />
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-slate-800 text-white text-[8px] px-2 py-1 rounded whitespace-nowrap z-50">Data Encrypted with pgcrypto</div>
                        </span>
                          <span className="bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100 flex items-center gap-1.5">
                              <ShieldCheck size={12} className="text-blue-500"/> {user.vendors?.name || 'Verifying...'}
                          </span>
                          <span className="bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100 flex items-center gap-1.5">
                              <Calendar size={12} className="text-blue-500"/> {user.age ? `${user.age} Years` : '-'}
                          </span>
                        </div>
                    </div>
                  )}
              </div>

              <div className="flex gap-2 w-full md:w-auto mt-2 md:mt-0 justify-center">
                 {isEditing ? (
                    <div className="flex gap-2 w-full">
                       <button onClick={handleUpdateProfile} disabled={isSaving} className="flex-1 bg-emerald-600 text-white py-2.5 px-4 rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all">
                         {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
                       </button>
                       <button onClick={() => setIsEditing(false)} className="px-4 bg-slate-100 text-slate-500 rounded-xl text-[10px] font-black uppercase hover:bg-slate-200">Cancel</button>
                    </div>
                 ) : (
                    <button onClick={() => setIsEditing(true)} className="p-3 bg-slate-50 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all active:scale-90 border border-transparent hover:border-blue-100"><Edit3 size={18} /></button>
                 )}
              </div>
          </div>
        </div>

        {/* 🔵 Safety Journey Timeline */}
        <div className="space-y-5 px-1">
          <div className="flex items-center justify-between">
             <div className="flex items-center gap-3">
               <div className="w-1.5 h-6 bg-blue-600 rounded-full shadow-sm"></div>
               <h3 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em]">Safety Journey</h3>
             </div>
             <button onClick={() => setShowHistory(true)} className="text-[10px] font-bold text-blue-500 flex items-center gap-1 hover:text-blue-700 uppercase bg-blue-50 px-3 py-1.5 rounded-full">
                History <ChevronRight size={12} />
             </button>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <StageCard
              title={t('user.stage1')} 
              isActive={hasInduction}
              isNearExpiry={isNearExpiry}
              expiryDate={user.induction_expiry}
              icon={<BookOpen size={24} />}
              onClick={() => { if (hasInduction && !isNearExpiry) { setCardType('INDUCTION'); setShowCard(true); } else setActiveStage('INDUCTION'); }}
              canAction={true}
              buttonText={hasInduction && !isNearExpiry ? (language === 'th' ? "แสดงบัตรดิจิทัล" : "Show Digital ID") : (language === 'th' ? "เริ่มการอบรม" : "Start Induction Exam")}
              color="blue"
            />

            <StageCard
              title={t('user.stage2')} 
              isActive={!!activePermit}
              expiryDate={activePermit?.expire_date}
              icon={!hasInduction ? <Lock size={24} /> : <Ticket size={24} />}
              onClick={() => { if (activePermit) { setCardType('WORK_PERMIT'); setShowCard(true); } else if (hasInduction) setActiveStage('WORK_PERMIT'); }}
              onRenew={() => { if(window.confirm("ยืนยันเริ่มสอบต่ออายุใบอนุญาต?")) setActiveStage('WORK_PERMIT'); }}
              disabled={!hasInduction} 
              permitNo={activePermit?.permit_no}
              canAction={hasInduction}
              buttonText={!!activePermit ? (language === 'th' ? "ดูใบอนุญาต" : "View Permit") : (language === 'th' ? "ขอใบอนุญาตทำงาน" : "Get Work Permit")}
              color="indigo"
            />

            {!hasInduction && !activePermit && (
              <div className="bg-blue-50/50 border-2 border-dashed border-blue-200 rounded-[2rem] p-8 text-center animate-in zoom-in">
                <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm">
                  <ArrowRightCircle size={32} className="text-blue-500 animate-soft-pulse" />
                </div>
                <h4 className="text-sm font-black text-blue-900 uppercase tracking-tight mb-2">Welcome to SafetyPass</h4>
                <p className="text-[10px] text-blue-600/70 font-bold uppercase tracking-widest leading-relaxed max-w-[200px] mx-auto">Please complete the Induction Training to unlock your digital safety identity.</p>
              </div>
            )}
          </div>
        </div>

        {/* 🟡 Resource Guides */}
        <div className="space-y-4 px-1 text-left">
           <h3 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em] ml-2">Safety Manuals</h3>
           <div className="grid grid-cols-2 gap-4">
              <ResourceCard icon={<BookOpen size={20} />} title="Induction" desc="Basic Safety Rules" onClick={() => setViewingManual(ExamType.INDUCTION)} />
              <ResourceCard icon={<Ticket size={20} />} title="Work Permit" desc="High Risk Work" onClick={() => setViewingManual(ExamType.WORK_PERMIT)} />
           </div>
        </div>

        {/* Active Permit Visual */}
        {activePermit && (
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-[2rem] p-6 text-white shadow-2xl relative overflow-hidden group mx-1">
            <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform duration-500"><QrCode size={120} /></div>
            <div className="relative z-10 flex items-center gap-6">
              <div className="bg-white p-2.5 rounded-2xl shadow-lg active:scale-95 transition-all cursor-pointer" onClick={() => setShowQRFullScreen(true)}><QRCodeSVG value={activePermit.permit_no} size={80} /></div>
              <div className="text-left">
                <div className="flex items-center gap-2 mb-2"><span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_10px_#10b981]"></span><div className="text-slate-400 font-bold uppercase tracking-widest text-[9px]">Active Permit</div></div>
                <h4 className="text-2xl font-black mb-3 tracking-tight text-white">{activePermit.permit_no}</h4>
                <button onClick={() => setShowQRFullScreen(true)} className="bg-white/10 hover:bg-white/20 text-white px-5 py-2 rounded-xl font-black text-[9px] transition-all flex items-center gap-2 backdrop-blur-sm border border-white/10 uppercase tracking-widest">Tap to Expand</button>
              </div>
            </div>
          </div>
        )}

        {/* Manual Viewer Modal */}
        {viewingManual && (
          <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-md z-[100] flex flex-col items-center justify-end md:justify-center">
            <div className="bg-white w-full max-w-3xl h-[90vh] md:h-[85vh] rounded-t-[2.5rem] md:rounded-[2.5rem] flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 shadow-2xl">
              <div className="p-6 border-b flex justify-between items-center bg-slate-50">
                <div className="flex items-center gap-4 text-left">
                  <div className="p-3 bg-blue-600 text-white rounded-2xl shadow-lg"><FileText size={24} /></div>
                  <div><h3 className="text-lg font-black text-slate-900">{viewingManual} Manual</h3><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Safety Training Documentation</p></div>
                </div>
                <button onClick={() => setViewingManual(null)} className="p-3 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-2xl transition-all"><X size={24} /></button>
              </div>
              <div className="flex-grow bg-slate-200 relative">
                <iframe src={`https://qdodmxrecioltwdryhec.supabase.co/storage/v1/object/public/manuals/${viewingManual.toLowerCase()}.pdf#toolbar=0`} className="w-full h-full border-none" title="Manual Viewer" />
              </div>
            </div>
          </div>
        )}

        {/* QR Fullscreen Overlay */}
        {showQRFullScreen && activePermit && (
          <div className="fixed inset-0 bg-slate-950 z-[200] flex flex-col items-center justify-center text-white p-6 animate-in fade-in duration-300 backdrop-blur-xl" onClick={() => setShowQRFullScreen(false)}>
            <button className="absolute top-8 right-8 p-4 text-white/50 hover:text-white transition-all"><X size={32} /></button>
            <div className="bg-white p-10 rounded-[3rem] shadow-[0_0_80px_rgba(59,130,246,0.4)] animate-in zoom-in duration-500"><QRCodeSVG value={activePermit.permit_no} size={300} /></div>
            <div className="mt-10 text-3xl font-black tracking-[0.3em] uppercase border-b-2 border-blue-500 pb-4">{activePermit.permit_no}</div>
            <div className="mt-6 text-blue-400 font-bold text-xs uppercase tracking-[0.3em] flex items-center gap-2"><ShieldCheck size={16} /> Authenticated Access</div>
          </div>
        )}
      </div>
    </div>
  );
};

// 🔵 Premium Shared UI Components
const ResourceCard = ({ icon, title, desc, onClick }: any) => (
  <button onClick={onClick} className="bg-white p-5 rounded-[1.5rem] border border-slate-100 active:bg-slate-50 hover:shadow-lg transition-all flex flex-col items-center text-center gap-3 group relative overflow-hidden">
    <div className="p-4 bg-slate-50 text-blue-600 rounded-2xl group-active:bg-blue-600 group-active:text-white transition-all shadow-inner">{icon}</div>
    <div className="min-w-0">
      <h4 className="font-black text-slate-800 text-xs truncate uppercase tracking-tight mb-1">{title}</h4>
      <div className="text-[9px] text-slate-400 font-bold uppercase truncate tracking-wide">{desc}</div>
    </div>
  </button>
);

const StageCard = ({ title, isActive, isNearExpiry, expiryDate, icon, onClick, disabled, permitNo, buttonText, onRenew, color = 'blue' }: any) => {
    const { language } = useTranslation();
    const statusType = disabled ? 'LOCKED' : isActive && !isNearExpiry ? 'PASSED' : isNearExpiry ? 'WARNING' : 'READY';
    
    return (
        <div onClick={!disabled ? onClick : undefined} className={`group p-0.5 rounded-[2rem] transition-all duration-500 ${!disabled ? 'hover:-translate-y-1' : ''}`}>
            <div className={`bg-white p-5 rounded-[1.8rem] border-2 transition-all relative overflow-hidden shadow-sm h-full flex flex-col justify-between ${
                disabled ? 'border-slate-100 opacity-60 grayscale cursor-not-allowed' 
                : statusType === 'PASSED' ? 'border-emerald-100 glow-emerald' 
                : statusType === 'WARNING' ? 'border-amber-100 glow-amber'
                : `border-slate-100 hover:border-${color}-200 hover:shadow-lg`
            }`}>
                {!disabled && (
                  <div className={`absolute top-4 right-4 flex items-center gap-1.5 px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest ${
                    statusType === 'PASSED' ? 'bg-emerald-50 text-emerald-600' :
                    statusType === 'WARNING' ? 'bg-amber-50 text-amber-600 animate-soft-pulse' :
                    'bg-slate-50 text-slate-400'
                  }`}>
                    {statusType === 'PASSED' && <CheckCircle2 size={10} />}
                    {statusType === 'WARNING' && <AlertTriangle size={10} />}
                    {statusType}
                  </div>
                )}
                
                <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-4">
                        <div className={`p-3.5 rounded-2xl shadow-sm transition-all duration-500 ${
                            statusType === 'PASSED' ? 'bg-emerald-50 text-emerald-600 shadow-emerald-200' : disabled ? 'bg-slate-100 text-slate-400' : `bg-${color}-50 text-${color}-600 group-hover:bg-${color}-600 group-hover:text-white`
                        }`}>
                            {icon}
                        </div>
                        <div className="text-left">
                            <h4 className="font-black text-slate-800 text-sm leading-tight mb-1 uppercase tracking-tight">{title}</h4>
                            <div className={`text-[9px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${statusType === 'PASSED' ? 'text-emerald-500' : disabled ? 'text-slate-400' : `text-${color}-500`}`}>
                                {statusType === 'PASSED' ? <CheckCircle2 size={10} /> : disabled ? <Lock size={10} /> : <div className={`w-2 h-2 rounded-full bg-${color}-500 animate-pulse`}></div>}
                                {statusType === 'PASSED' ? 'Training Passed' : disabled ? 'Locked Content' : 'Ready to Start'}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex items-end justify-between border-t border-slate-50 pt-4 mt-auto">
                    <div className="text-left">
                        {expiryDate ? (
                            <div className="flex flex-col">
                                <span className="text-[8px] font-black text-slate-300 uppercase tracking-widest">Valid Until</span>
                                <span className={`text-[10px] font-bold ${isNearExpiry ? 'text-amber-500' : 'text-slate-600'}`}>{new Date(expiryDate).toLocaleDateString(language === 'th' ? 'th-TH' : 'en-US')}</span>
                            </div>
                        ) : (
                            <div className="flex flex-col">
                                <span className="text-[8px] font-black text-slate-300 uppercase tracking-widest">Action Required</span>
                                <span className="text-[10px] font-bold text-slate-400">Step Not Started</span>
                            </div>
                        )}
                    </div>
                    <button className={`px-5 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center gap-2 transition-all shadow-md active:scale-95 ${
                            statusType === 'PASSED' ? 'bg-slate-900 text-white hover:bg-slate-800 shadow-slate-200' : disabled ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : `bg-${color}-600 text-white hover:bg-${color}-700 shadow-${color}-200`
                        }`}>
                        {buttonText} {!isActive && !disabled && <ChevronRight size={12} />}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default UserPanel;