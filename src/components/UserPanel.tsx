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
  Loader2, // ✅ เพิ่ม Import เพื่อแก้จุดแดง
  Calendar, // ✅ เพิ่ม Import เพื่อแก้จุดแดง
  Globe2    // ✅ เพิ่ม Import เพื่อแก้จุดแดง
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useToastContext } from './ToastProvider';

interface UserPanelProps {
  user: User;
  onUserUpdate: (user: User) => void;
}

const UserPanel: React.FC<UserPanelProps> = ({ user, onUserUpdate }) => {
  const { t } = useTranslation();
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

  // ตรวจสอบว่าสัญชาติที่มีอยู่เป็น "อื่นๆ" หรือไม่ตอนเปิดโหมดแก้ไข
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

  if (showCard) return <DigitalCard user={user} onBack={() => setShowCard(false)} type={cardType} permit={activePermit} />;
  if (showHistory) return <ExamHistory userId={user.id} onBack={() => setShowHistory(false)} />;
  
  if (activeStage !== 'IDLE') {
    return (
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
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4 md:space-y-6 animate-in fade-in duration-500 pb-10 text-left">
      
      {/* 🟢 Profile Section */}
      <div className="bg-white rounded-[1.8rem] border border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-blue-800 h-16 w-full relative">
            <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]"></div>
        </div>
        <div className="px-5 pb-5 -mt-8 relative z-10">
          <div className="flex items-end gap-3 mb-4">
            <div className="w-16 h-16 rounded-2xl bg-white p-1 shadow-md flex-shrink-0">
              <div className="w-full h-full rounded-xl bg-slate-50 flex items-center justify-center text-blue-600 text-xl font-black border border-slate-100 uppercase">
                {user.name ? user.name.charAt(0) : '?'}
              </div>
            </div>
            <div className="flex-1 min-w-0 pb-1">
                {isEditing ? (
                  <input 
                    className="text-lg font-bold text-slate-900 border-b-2 border-blue-500 outline-none w-full bg-slate-50 px-2 py-1 rounded-t-lg transition-all" 
                    value={editName} 
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="ชื่อ-นามสกุล"
                  />
                ) : (
                  <h2 className="text-lg font-black text-slate-900 truncate tracking-tight uppercase leading-none">{user.name}</h2>
                )}
                <div className="text-[9px] text-blue-600 font-black uppercase tracking-widest flex items-center gap-1 mt-1.5">
                  <ShieldCheck size={10} /> {user.role === 'ADMIN' ? 'System Administrator' : 'Contractor Personnel'}
                </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
             <InfoItem label="National ID" value={user.national_id} />
             <InfoItem label="Company" value={user.vendors?.name || 'Waiting Verification'} />
             
             {isEditing ? (
                <>
                  <div className="space-y-1">
                    <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1"><Calendar size={8}/> Age</div>
                    <input 
                      type="number" 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-xs outline-none focus:border-blue-500 transition-all shadow-inner" 
                      value={editAge} 
                      onChange={(e) => setEditAge(e.target.value)} 
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1"><Globe2 size={8}/> Nationality</div>
                    <select 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-xs outline-none focus:border-blue-500 transition-all shadow-inner appearance-none cursor-pointer" 
                      value={isOtherNationality ? 'OTHER' : editNationality} 
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === 'OTHER') {
                          setIsOtherNationality(true);
                          setEditNationality('');
                        } else {
                          setIsOtherNationality(false);
                          setEditNationality(val);
                        }
                      }}
                    >
                      <option value="ไทย (Thai)">ไทย (Thai)</option>
                      <option value="พม่า (Myanmar)">พม่า (Myanmar)</option>
                      <option value="กัมพูชา (Cambodian)">กัมพูชา (Cambodian)</option>
                      <option value="ลาว (Lao)">ลาว (Lao)</option>
                      <option value="OTHER">อื่นๆ / Other</option>
                    </select>
                  </div>
                  {isOtherNationality && (
                    <div className="col-span-2 animate-in slide-in-from-top-2">
                       <div className="text-[8px] font-black text-blue-500 uppercase tracking-widest mb-1">Specify Nationality</div>
                       <input 
                        className="w-full bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 font-bold text-xs text-blue-600 outline-none focus:border-blue-500 shadow-sm" 
                        placeholder="ระบุสัญชาติ..."
                        value={editNationality}
                        onChange={(e) => setEditNationality(e.target.value)}
                       />
                    </div>
                  )}
                </>
              ) : (
                <>
                  <InfoItem label="Age" value={`${user.age || '-'} Years`} />
                  <InfoItem label="Nationality" value={user.nationality || '-'} />
                </>
              )}
          </div>

          <div className="flex flex-wrap gap-2">
            {isEditing ? (
              <>
                <button onClick={handleUpdateProfile} disabled={isSaving} className="flex-1 bg-emerald-600 text-white py-2.5 rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-2 shadow-lg shadow-emerald-100 transition-all active:scale-95">
                  {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save Changes
                </button>
                <button onClick={() => setIsEditing(false)} className="px-6 bg-slate-100 text-slate-500 rounded-xl text-[10px] font-black uppercase hover:bg-slate-200 transition-all">Cancel</button>
              </>
            ) : (
              <>
                {hasInduction && (
                  <button onClick={() => { setCardType('INDUCTION'); setShowCard(true); }} className="flex-1 bg-emerald-600 text-white py-2.5 rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-2 shadow-lg shadow-emerald-100 active:scale-95 transition-all">
                    <QrCode size={14} /> My Digital Pass
                  </button>
                )}
                <button onClick={() => setIsEditing(true)} className="p-2.5 bg-white text-slate-600 rounded-xl border border-slate-200 active:scale-90 transition-all shadow-sm"><Edit3 size={14} /></button>
                <button onClick={handleResetExam} disabled={isSaving} className="p-2.5 bg-red-50 text-red-500 rounded-xl border border-red-100 active:scale-90 transition-all shadow-sm"><RotateCcw size={14} /></button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 🔵 Status & Resources */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 px-1">
          <div className="w-1 h-5 bg-blue-600 rounded-full"></div>
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Safety Certification</h3>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <StageCard
            title={t('user.stage1')}
            isActive={hasInduction}
            isNearExpiry={isNearExpiry}
            expiryDate={user.induction_expiry}
            icon={<BookOpen size={24} />}
            onClick={() => { if (hasInduction && !isNearExpiry) { setCardType('INDUCTION'); setShowCard(true); } else setActiveStage('INDUCTION'); }}
            canAction={true}
            buttonText={hasInduction && !isNearExpiry ? "View ID Card" : "Start Exam"}
          />

          <StageCard
            title={t('user.stage2')}
            isActive={!!activePermit}
            expiryDate={activePermit?.expire_date}
            icon={<Ticket size={24} />}
            onClick={() => { if (activePermit) { setCardType('WORK_PERMIT'); setShowCard(true); } else if (hasInduction) setActiveStage('WORK_PERMIT'); }}
            onRenew={() => { if(window.confirm("ยืนยันเริ่มสอบต่ออายุใบอนุญาต?")) setActiveStage('WORK_PERMIT'); }}
            disabled={!hasInduction}
            permitNo={activePermit?.permit_no}
            canAction={hasInduction}
            buttonText={!!activePermit ? "View Permit" : "Take Exam"}
          />

          <button onClick={() => setShowHistory(true)} className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-2xl hover:bg-slate-50 active:scale-[0.98] transition-all group shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-slate-50 text-slate-400 group-hover:bg-blue-600 group-hover:text-white rounded-xl transition-all">
                <Clock size={18} />
              </div>
              <div className="text-left">
                <h4 className="font-black text-slate-800 text-xs leading-none">Exam History</h4>
                <p className="text-[9px] text-slate-400 font-bold uppercase mt-1">View all past results</p>
              </div>
            </div>
            <ChevronRight size={18} className="text-slate-300" />
          </button>
        </div>
      </div>

      {/* 🟡 Resource Guides */}
      <div className="grid grid-cols-2 gap-3">
        <ResourceCard icon={<BookOpen size={18} />} title="Induction" desc="Safety Manual" onClick={() => setViewingManual(ExamType.INDUCTION)} />
        <ResourceCard icon={<Ticket size={18} />} title="Work Permit" desc="Safety Manual" onClick={() => setViewingManual(ExamType.WORK_PERMIT)} />
      </div>

      {/* Active Permit Visual */}
      {activePermit && (
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-[2rem] p-6 text-white shadow-xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
            <QrCode size={100} />
          </div>
          <div className="relative z-10 flex items-center gap-5">
            <div className="bg-white p-2 rounded-xl shadow-lg active:scale-95 transition-all cursor-pointer" onClick={() => setShowQRFullScreen(true)}>
              <QRCodeSVG value={activePermit.permit_no} size={80} />
            </div>
            <div className="text-left">
              <div className="text-blue-100 font-bold uppercase tracking-widest text-[8px] mb-1">Authenticated Permit</div>
              <h4 className="text-2xl font-black mb-2 tracking-tight">{activePermit.permit_no}</h4>
              <button onClick={() => setShowQRFullScreen(true)} className="bg-white/20 hover:bg-white/30 text-white px-4 py-1.5 rounded-lg font-black text-[9px] transition-all flex items-center gap-1 backdrop-blur-sm border border-white/20 uppercase tracking-widest">
                <QrCode size={12} /> Full Screen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Viewer Modal */}
      {viewingManual && (
        <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-md z-[100] flex flex-col items-center justify-end md:justify-center">
          <div className="bg-white w-full max-w-2xl h-[85vh] rounded-t-[2.5rem] md:rounded-[2.5rem] flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 duration-500">
            <div className="p-5 border-b flex justify-between items-center bg-slate-50">
              <div className="flex items-center gap-3 text-left">
                <div className="p-2 bg-blue-600 text-white rounded-xl"><FileText size={20} /></div>
                <div><h3 className="text-sm font-black text-slate-900">{viewingManual} Manual</h3><p className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">Safety Training Documentation</p></div>
              </div>
              <button onClick={() => setViewingManual(null)} className="p-2 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-full transition-all"><X size={20} /></button>
            </div>
            <div className="flex-grow bg-slate-100">
              <iframe src={`https://qdodmxrecioltwdryhec.supabase.co/storage/v1/object/public/manuals/${viewingManual.toLowerCase()}.pdf#toolbar=0`} className="w-full h-full border-none shadow-inner" title="Manual Viewer" />
            </div>
          </div>
        </div>
      )}

      {/* QR Fullscreen Overlay */}
      {showQRFullScreen && activePermit && (
        <div className="fixed inset-0 bg-slate-950 z-[200] flex flex-col items-center justify-center text-white p-6 animate-in fade-in duration-300" onClick={() => setShowQRFullScreen(false)}>
          <button className="absolute top-8 right-8 p-4 text-white/50 hover:text-white transition-all"><X size={32} /></button>
          <div className="bg-white p-8 rounded-[3rem] shadow-[0_0_50px_rgba(59,130,246,0.3)] animate-in zoom-in duration-500">
            <QRCodeSVG value={activePermit.permit_no} size={280} />
          </div>
          <div className="mt-8 text-2xl font-black tracking-[0.3em] uppercase border-b-2 border-blue-500 pb-2">{activePermit.permit_no}</div>
          <div className="mt-4 text-blue-400 font-bold text-xs uppercase tracking-widest">Authorized Work Permit</div>
        </div>
      )}
    </div>
  );
};

// 🔵 Shared UI Components
const InfoItem = ({ label, value }: { label: string, value: any }) => (
  <div className="text-left bg-slate-50/50 p-2 rounded-xl border border-slate-100 shadow-sm">
    <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">{label}</div>
    <div className="text-[11px] font-bold text-slate-700 truncate">{value || '-'}</div>
  </div>
);

const ResourceCard = ({ icon, title, desc, onClick }: any) => (
  <button onClick={onClick} className="bg-white p-3.5 rounded-2xl border border-slate-200 active:bg-slate-50 transition-all flex items-center gap-3 group shadow-sm">
    <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl group-active:bg-blue-600 group-active:text-white transition-all">{icon}</div>
    <div className="text-left min-w-0">
      <h4 className="font-black text-slate-800 text-[11px] leading-tight truncate uppercase tracking-tight">{title}</h4>
      <div className="text-[9px] text-slate-400 font-bold uppercase truncate">{desc}</div>
    </div>
  </button>
);

const StageCard = ({ title, isActive, isNearExpiry, expiryDate, icon, onClick, disabled, permitNo, buttonText, onRenew }: any) => (
  <div onClick={!disabled ? onClick : undefined} className={`p-4 rounded-[1.5rem] border-2 transition-all relative overflow-hidden shadow-sm ${disabled ? 'bg-slate-50 border-slate-100 opacity-60 grayscale' : isActive && !isNearExpiry ? 'bg-white border-emerald-100 active:bg-emerald-50' : isNearExpiry ? 'bg-white border-amber-200 active:bg-amber-50' : 'bg-white border-slate-200 active:bg-blue-50'}`}>
    <div className="flex items-center gap-3 text-left">
      <div className={`p-3 rounded-xl shadow-sm ${isActive ? 'bg-emerald-50 text-emerald-600' : isNearExpiry ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'}`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <h4 className="font-black text-slate-800 text-xs leading-tight mb-1">{title}</h4>
        {expiryDate ? (
          <div className={`text-[8px] font-bold uppercase tracking-wider ${isNearExpiry ? 'text-amber-500' : 'text-slate-400'}`}>Expires: {new Date(expiryDate).toLocaleDateString('th-TH')}</div>
        ) : (
          <div className="text-[8px] font-bold text-blue-500 uppercase tracking-wider">{disabled ? 'Induction Locked' : 'Status: Ready'}</div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        {isActive ? (
          <span className={`px-2 py-0.5 rounded-lg text-[7px] font-black uppercase border ${isNearExpiry ? 'bg-amber-100 text-amber-600 border-amber-200' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>Authenticated</span>
        ) : !disabled && <ChevronRight size={16} className="text-blue-400" />}
        {permitNo && onRenew && (
          <button onClick={(e) => { e.stopPropagation(); onRenew(); }} className="text-[7px] font-black text-amber-600 underline uppercase mt-1 tracking-widest">Renew Now</button>
        )}
      </div>
    </div>
  </div>
);

export default UserPanel;