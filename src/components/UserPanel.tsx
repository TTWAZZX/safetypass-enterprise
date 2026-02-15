import React, { useState, useEffect } from 'react';
import { User, WorkPermitSession, ExamType } from '../types';
import { api as mockApi } from '../services/supabaseApi';
import { supabase } from '../services/supabaseClient'; 
import { useTranslation } from '../context/LanguageContext';
import ExamSystem from './ExamSystem';
import {
  BookOpen,
  Lock,
  CheckCircle2,
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
  User as UserIcon
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

  // State สำหรับการแก้ไขโปรไฟล์
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(user.name);
  const [editAge, setEditAge] = useState(user.age || '');
  const [editNationality, setEditNationality] = useState(user.nationality || 'ไทย (Thai)');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    mockApi.getActiveWorkPermit(user.id).then((data) => {
      setActivePermit(data);
    });
  }, [user.id]);

  const hasInduction =
    user.induction_expiry &&
    new Date(user.induction_expiry) > new Date();

  const isNearExpiry =
    user.induction_expiry &&
    (new Date(user.induction_expiry).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24) < 30;

  // ฟังก์ชันบันทึกการแก้ไขโปรไฟล์
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

      onUserUpdate({
        ...user,
        name: editName,
        age: Number(editAge),
        nationality: editNationality
      });

      showToast('อัปเดตข้อมูลส่วนตัวเรียบร้อยแล้ว', 'success');
      setIsEditing(false);
    } catch (err: any) {
      showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // ✅ ฟังก์ชัน Reset การสอบเพื่อให้สอบใหม่ได้ทันที
  const handleResetExam = async () => {
    if(!window.confirm("คุณต้องการล้างประวัติการอบรมเพื่อเริ่มสอบใหม่ใช่หรือไม่?")) return;
    
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('users')
        .update({ induction_expiry: null })
        .eq('id', user.id);

      if (error) throw error;

      // ล้างข้อมูลใน State หน้าบ้านด้วย
      onUserUpdate({
        ...user,
        induction_expiry: null
      });

      showToast('รีเซ็ตสถานะการอบรมแล้ว คุณสามารถเริ่มสอบใหม่ได้ทันที', 'success');
    } catch (err: any) {
      showToast('ไม่สามารถรีเซ็ตได้: ' + err.message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  if (activeStage !== 'IDLE') {
    return (
      <ExamSystem
        type={activeStage === 'INDUCTION' ? ExamType.INDUCTION : ExamType.WORK_PERMIT}
        user={user}
        onComplete={(u) => {
          onUserUpdate(u);
          setActiveStage('IDLE');
          showToast('บันทึกผลการสอบเรียบร้อยแล้ว', 'success');
        }}
        onBack={() => setActiveStage('IDLE')}
      />
    );
  }

  return (
    <>
      <div className="max-w-4xl mx-auto p-6 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 text-left">
        
        {/* 🟢 Digital ID Card (Header) */}
        <header className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden relative">
          <div className="bg-blue-600 h-24 w-full relative">
            <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]"></div>
          </div>
          
          <div className="px-8 pb-8 -mt-12 relative z-10">
            <div className="flex flex-col md:flex-row items-end gap-6 mb-8">
              <div className="w-24 h-24 rounded-3xl bg-white p-1 shadow-lg">
                <div className="w-full h-full rounded-2xl bg-slate-100 flex items-center justify-center text-blue-600 text-3xl font-black border-2 border-slate-50">
                  {user.name.charAt(0)}
                </div>
              </div>
              
              <div className="flex-1 pb-2">
                {isEditing ? (
                  <input 
                    className="text-2xl font-black text-slate-900 border-b-2 border-blue-500 outline-none w-full bg-slate-50 px-2 py-1 rounded"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                ) : (
                  <h2 className="text-3xl font-black text-slate-900 leading-tight">
                    {user.name}
                  </h2>
                )}
                <p className="text-blue-600 font-bold flex items-center gap-2 mt-1">
                  <ShieldCheck size={16} /> {user.role === 'ADMIN' ? 'System Administrator' : 'Contractor Personnel'}
                </p>
              </div>

              <div className="pb-2 flex flex-wrap gap-2">
                {isEditing ? (
                  <>
                    <button onClick={handleUpdateProfile} disabled={isSaving} className="bg-emerald-600 text-white px-5 py-2.5 rounded-2xl text-xs font-black uppercase flex items-center gap-2 hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100">
                      {isSaving ? "..." : <Save size={14} />} Save
                    </button>
                    <button onClick={() => setIsEditing(false)} className="bg-slate-200 text-slate-600 px-5 py-2.5 rounded-2xl text-xs font-black uppercase hover:bg-slate-300 transition-all">
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setIsEditing(true)} className="bg-white text-slate-600 border border-slate-200 px-5 py-2.5 rounded-2xl text-xs font-black uppercase flex items-center gap-2 hover:bg-slate-50 transition-all shadow-sm">
                      <Edit3 size={14} /> Edit
                    </button>
                    <button 
                      onClick={handleResetExam}
                      disabled={isSaving}
                      className="bg-red-50 text-red-600 border border-red-100 px-5 py-2.5 rounded-2xl text-xs font-black uppercase flex items-center gap-2 hover:bg-red-100 transition-all shadow-sm"
                    >
                      <RotateCcw size={14} /> Reset Exam
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-6 bg-slate-50 rounded-3xl border border-slate-100 text-left">
              <InfoItem label="National ID / เลขบัตร" value={user.national_id} />
              <InfoItem label="Company / สังกัด" value={user.vendors?.name || 'กำลังรอการตรวจสอบ'} />
              
              {isEditing ? (
                <>
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Age / อายุ</p>
                    <input type="number" className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 font-bold text-sm outline-none" value={editAge} onChange={(e) => setEditAge(e.target.value)} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Nationality / สัญชาติ</p>
                    <select className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 font-bold text-sm outline-none" value={editNationality} onChange={(e) => setEditNationality(e.target.value)}>
                      <option value="ไทย (Thai)">ไทย (Thai)</option>
                      <option value="ต่างชาติ (Foreigner)">ต่างชาติ (Foreigner)</option>
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <InfoItem label="Age / อายุ" value={`${user.age || '-'} ปี`} />
                  <InfoItem label="Nationality / สัญชาติ" value={user.nationality || '-'} />
                </>
              )}
            </div>
          </div>
        </header>

        {/* 🟢 Safety Resources (คู่มือย้อนหลัง) */}
        <section>
          <div className="flex items-center gap-2 mb-4 px-2">
            <div className="w-1.5 h-6 bg-blue-600 rounded-full"></div>
            <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">
              Safety Resources / คลังคู่มือความปลอดภัย
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
            <ResourceCard 
              icon={<BookOpen size={24} />}
              title="Induction Manual"
              desc="คู่มืออบรมความปลอดภัยพื้นฐาน"
              onClick={() => setViewingManual(ExamType.INDUCTION)}
            />
            <ResourceCard 
              icon={<Ticket size={24} />}
              title="Work Permit Manual"
              desc="ขั้นตอนการขออนุญาตทำงานเสี่ยง"
              onClick={() => setViewingManual(ExamType.WORK_PERMIT)}
            />
          </div>
        </section>

        {/* 🟢 Training Status (สถานะการอบรม) */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 mb-4 px-2">
            <div className="w-1.5 h-6 bg-blue-600 rounded-full"></div>
            <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">
              Training Status / สถานะการอบรม
            </h3>
          </div>

          <div className="grid grid-cols-1 gap-6 text-left">
            <StageCard
              title={t('user.stage1')}
              isActive={hasInduction}
              isNearExpiry={isNearExpiry}
              expiryDate={user.induction_expiry}
              icon={<BookOpen size={32} />}
              onClick={() => (!hasInduction || isNearExpiry) && setActiveStage('INDUCTION')}
              canAction={!hasInduction || isNearExpiry}
            />

            <StageCard
              title={t('user.stage2')}
              isActive={!!activePermit}
              expiryDate={activePermit?.expire_date || null}
              icon={<Ticket size={32} />}
              onClick={() => hasInduction && setActiveStage('WORK_PERMIT')}
              disabled={!hasInduction}
              permitNo={activePermit?.permit_no}
              canAction={hasInduction}
            />
          </div>
        </section>

        {/* 🟢 Active QR Code */}
        {activePermit && (
          <section className="animate-in zoom-in duration-500">
             <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-[2.5rem] p-8 text-white shadow-2xl relative overflow-hidden group">
               <div className="absolute top-0 right-0 p-10 opacity-10 group-hover:scale-110 transition-transform">
                  <QrCode size={180} />
               </div>
               <div className="relative z-10 flex flex-col md:flex-row items-center gap-8">
                  <div className="bg-white p-4 rounded-3xl shadow-lg border-4 border-white/20">
                    <QRCodeSVG value={activePermit.permit_no} size={140} />
                  </div>
                  <div className="text-center md:text-left">
                    <p className="text-blue-100 font-bold uppercase tracking-widest text-[10px] mb-1">Active Work Permit</p>
                    <h4 className="text-4xl font-black mb-4">{activePermit.permit_no}</h4>
                    <button
                      onClick={() => setShowQRFullScreen(true)}
                      className="bg-white/20 hover:bg-white text-white hover:text-blue-700 px-6 py-3 rounded-2xl font-black transition-all flex items-center gap-2 backdrop-blur-md border border-white/30"
                    >
                      <QrCode size={18} /> FULL SCREEN
                    </button>
                  </div>
               </div>
             </div>
          </section>
        )}
      </div>

      {/* 🟢 Modal ดู PDF - แก้ไขรหัส Project ID เรียบร้อยแล้ว */}
      {viewingManual && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-5xl h-[90vh] rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden">
            <div className="p-8 border-b flex justify-between items-center bg-slate-50">
              <div className="flex items-center gap-4 text-left">
                <div className="p-3 bg-blue-600 text-white rounded-2xl"><FileText size={24} /></div>
                <div>
                  <h3 className="text-xl font-black text-slate-900">{viewingManual} Safety Manual</h3>
                  <p className="text-sm text-slate-500 font-bold">เอกสารประกอบการอบรมความปลอดภัย</p>
                </div>
              </div>
              <button onClick={() => setViewingManual(null)} className="p-3 hover:bg-red-50 hover:text-red-500 text-slate-400 rounded-full transition-all border border-slate-100 shadow-sm"><X size={24} /></button>
            </div>
            <div className="flex-grow bg-slate-100 p-2 md:p-6">
              {/* ✅ แก้ไขเป็นรหัส qdodmxrecioltwdryhec ตาม Project ของคุณ */}
              <iframe 
                src={`https://qdodmxrecioltwdryhec.supabase.co/storage/v1/object/public/manuals/${viewingManual.toLowerCase()}.pdf#toolbar=0`} 
                className="w-full h-full rounded-2xl shadow-inner border-none bg-white"
                title="Manual Viewer"
              />
            </div>
          </div>
        </div>
      )}

      {/* 🟢 QR Fullscreen */}
      {showQRFullScreen && activePermit && (
        <div className="fixed inset-0 bg-black z-[200] flex flex-col items-center justify-center text-white p-4" onClick={() => setShowQRFullScreen(false)}>
          <button className="absolute top-8 right-8 bg-white/10 p-4 rounded-full"><X className="w-8 h-8" /></button>
          <div className="bg-white p-10 rounded-[3rem]">
            <QRCodeSVG value={activePermit.permit_no} size={320} />
          </div>
          <p className="mt-10 text-3xl font-black tracking-widest">{activePermit.permit_no}</p>
        </div>
      )}
    </>
  );
};

// 🔵 Helper Components
const InfoItem = ({ label, value }: { label: string, value: string | number }) => (
  <div className="text-left">
    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
    <p className="text-sm font-bold text-slate-700 break-words">{value}</p>
  </div>
);

const ResourceCard = ({ icon, title, desc, onClick }: any) => (
  <button 
    onClick={onClick}
    className="bg-white p-5 rounded-3xl border border-slate-200 hover:border-blue-500 hover:shadow-xl hover:shadow-blue-100 transition-all flex items-center gap-5 group"
  >
    <div className="p-4 bg-slate-50 text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-600 rounded-2xl transition-colors">{icon}</div>
    <div className="text-left">
      <h4 className="font-black text-slate-800 leading-tight">{title}</h4>
      <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wide mt-1">{desc}</p>
    </div>
    <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
       <div className="p-2 bg-blue-50 text-blue-600 rounded-full"><Download size={16} /></div>
    </div>
  </button>
);

const StageCard = ({ title, isActive, isNearExpiry, expiryDate, icon, onClick, disabled, permitNo }: any) => {
  return (
    <div
      onClick={!disabled ? onClick : undefined}
      className={`p-8 rounded-[2.5rem] border-2 transition-all relative overflow-hidden group ${
        disabled 
          ? 'bg-slate-50 border-slate-100 opacity-60 grayscale cursor-not-allowed' 
          : isActive && !isNearExpiry
            ? 'bg-white border-emerald-100 hover:border-emerald-300 cursor-pointer'
            : isNearExpiry 
              ? 'bg-white border-amber-200 hover:border-amber-400 cursor-pointer shadow-lg shadow-amber-50'
              : 'bg-white border-slate-200 hover:border-blue-400 cursor-pointer'
      }`}
    >
      <div className="flex justify-between items-start relative z-10 text-left">
        <div className={`p-5 rounded-3xl ${isActive ? 'bg-emerald-50 text-emerald-600' : isNearExpiry ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'}`}>{icon}</div>
        <div className="text-right">
          {isActive ? (
            <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase border ${isNearExpiry ? 'bg-amber-50 text-amber-600 border-amber-200' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
              {isNearExpiry ? 'Near Expiry / ใกล้หมดอายุ' : 'Valid / สถานะปกติ'}
            </span>
          ) : disabled ? (
            <span className="bg-slate-200 text-slate-500 px-4 py-1.5 rounded-full text-[10px] font-black uppercase flex items-center gap-1"><Lock size={10} /> Locked</span>
          ) : (
            <span className="bg-blue-600 text-white px-4 py-1.5 rounded-full text-[10px] font-black uppercase animate-pulse">Start Now</span>
          )}
          {expiryDate && <p className={`text-[10px] font-bold mt-3 uppercase tracking-widest ${isNearExpiry ? 'text-amber-500' : 'text-slate-400'}`}>Expires: {new Date(expiryDate).toLocaleDateString()}</p>}
        </div>
      </div>
      <div className="mt-8 flex justify-between items-end relative z-10 text-left">
        <div>
          <h3 className="text-2xl font-black text-slate-900 leading-none">{title}</h3>
          {permitNo && <p className="text-blue-600 font-black text-sm mt-2">Active No: {permitNo}</p>}
        </div>
        {!disabled && <div className={`p-2 rounded-full transition-transform group-hover:translate-x-1 ${isActive ? 'text-emerald-300' : 'text-blue-400'}`}><ChevronRight size={24} /></div>}
      </div>
    </div>
  );
};

export default UserPanel;