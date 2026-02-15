import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import { api } from '../services/supabaseApi';
import { 
  Upload, 
  FileText, 
  CheckCircle2, 
  Loader2, 
  Target, 
  Save, 
  AlertTriangle 
} from 'lucide-react';
import { useToastContext } from './ToastProvider';

const SettingsManager: React.FC = () => {
  const { showToast } = useToastContext();
  
  // States สำหรับระบบอัปโหลด
  const [uploading, setUploading] = useState<string | null>(null);
  
  // States สำหรับระบบตั้งค่าคะแนน (ฟังก์ชันเดิมที่หายไป)
  const [passingScore, setPassingScore] = useState({
    INDUCTION: 80,
    WORK_PERMIT: 100
  });
  const [loadingScore, setLoadingScore] = useState(true);
  const [isSavingScore, setIsSavingScore] = useState(false);

  // ✅ ดึงค่าคะแนนเดิมจากฐานข้อมูลตอนโหลดหน้า
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        setLoadingScore(true);
        const config = await api.getSystemSettings();
        setPassingScore({
          INDUCTION: Number(config.PASSING_SCORE_INDUCTION || 80),
          WORK_PERMIT: Number(config.PASSING_SCORE_WORK_PERMIT || 100)
        });
      } catch (err) {
        console.error('Failed to fetch settings:', err);
      } finally {
        setLoadingScore(false);
      }
    };
    fetchSettings();
  }, []);

  // ✅ ฟังก์ชันบันทึกคะแนน (ฟังก์ชันเดิมที่ถูกต้อง)
  const handleSaveScores = async () => {
    setIsSavingScore(true);
    try {
      await api.updateSystemSetting('PASSING_SCORE_INDUCTION', passingScore.INDUCTION);
      await api.updateSystemSetting('PASSING_SCORE_WORK_PERMIT', passingScore.WORK_PERMIT);
      showToast('บันทึกเกณฑ์คะแนนสอบเรียบร้อยแล้ว', 'success');
    } catch (err: any) {
      showToast('บันทึกล้มเหลว: ' + err.message, 'error');
    } finally {
      setIsSavingScore(false);
    }
  };

  // ✅ ฟังก์ชันอัปโหลดไฟล์คู่มือ PDF
  const handleUploadManual = async (event: React.ChangeEvent<HTMLInputElement>, type: 'induction' | 'work_permit') => {
    try {
      setUploading(type);
      const file = event.target.files?.[0];
      if (!file) return;

      if (file.type !== 'application/pdf') {
        return showToast('กรุณาอัปโหลดไฟล์ PDF เท่านั้น', 'error');
      }

      // อัปโหลดไฟล์ไปที่ bucket "manuals" ใน Supabase
      const { error } = await supabase.storage
        .from('manuals')
        .upload(`${type}.pdf`, file, {
          upsert: true 
        });

      if (error) throw error;

      showToast(`อัปโหลดคู่มือ ${type} สำเร็จแล้ว`, 'success');
    } catch (err: any) {
      showToast('อัปโหลดล้มเหลว: ' + err.message, 'error');
    } finally {
      setUploading(null);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* 1. ส่วนตั้งค่าเกณฑ์คะแนนสอบ (ฟังก์ชันเดิมที่คุณต้องการ) */}
      <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden relative">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl">
            <Target size={24} />
          </div>
          <div>
            <h3 className="text-xl font-black text-slate-900 leading-none">Passing Scores</h3>
            <p className="text-slate-400 text-xs font-bold uppercase mt-1">กำหนดเกณฑ์คะแนนขั้นต่ำในการสอบผ่าน</p>
          </div>
        </div>

        {loadingScore ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-blue-600" /></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
            <ScoreInput 
              label="Induction Pass Rate (%)" 
              value={passingScore.INDUCTION} 
              onChange={(val) => setPassingScore({...passingScore, INDUCTION: val})}
            />
            <ScoreInput 
              label="Work Permit Pass Rate (%)" 
              value={passingScore.WORK_PERMIT} 
              onChange={(val) => setPassingScore({...passingScore, WORK_PERMIT: val})}
            />
          </div>
        )}

        <div className="flex justify-end pt-4 border-t border-slate-50">
          <button 
            onClick={handleSaveScores}
            disabled={isSavingScore || loadingScore}
            className="bg-slate-900 text-white px-8 py-3 rounded-2xl font-black text-sm flex items-center gap-2 hover:bg-blue-600 transition-all shadow-lg shadow-slate-200 disabled:opacity-50"
          >
            {isSavingScore ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save Configuration
          </button>
        </div>
      </div>

      {/* 2. ส่วนจัดการคู่มือ PDF (ระบบอัปโหลดใหม่) */}
      <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
            <FileText size={24} />
          </div>
          <div>
            <h3 className="text-xl font-black text-slate-900 leading-none">Manual Management</h3>
            <p className="text-slate-400 text-xs font-bold uppercase mt-1">จัดการไฟล์คู่มือประกอบการอบรม (PDF)</p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <ManualUploadCard 
            title="Induction Manual (PDF)"
            type="induction"
            isUploading={uploading === 'induction'}
            onUpload={(e) => handleUploadManual(e, 'induction')}
          />
          <ManualUploadCard 
            title="Work Permit Manual (PDF)"
            type="work_permit"
            isUploading={uploading === 'work_permit'}
            onUpload={(e) => handleUploadManual(e, 'work_permit')}
          />
        </div>

        <div className="mt-8 p-4 bg-amber-50 rounded-2xl border border-amber-100 flex items-start gap-3">
            <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={18} />
            <p className="text-xs text-amber-700 font-medium leading-relaxed">
                <strong>คำแนะนำ:</strong> การอัปโหลดไฟล์ใหม่จะทำการบันทึกทับไฟล์เดิมทันที กรุณาตรวจสอบความถูกต้องของเนื้อหาและขนาดไฟล์ (ไม่ควรเกิน 5MB) ก่อนทำการอัปโหลด
            </p>
        </div>
      </div>
    </div>
  );
};

// 🔵 Helper Components
const ScoreInput = ({ label, value, onChange }: any) => (
  <div className="space-y-2">
    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">{label}</label>
    <div className="relative">
      <input 
        type="number" 
        min="0" 
        max="100"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full bg-slate-50 border border-slate-100 p-4 rounded-2xl font-black text-2xl text-slate-800 focus:bg-white focus:border-blue-500 transition-all outline-none"
      />
      <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 font-black text-xl">%</div>
    </div>
  </div>
);

const ManualUploadCard = ({ title, type, isUploading, onUpload }: any) => (
  <div className="p-8 border-2 border-dashed border-slate-200 rounded-3xl flex flex-col items-center text-center group hover:border-blue-400 hover:bg-blue-50/10 transition-all cursor-default">
    <div className="p-5 bg-slate-50 text-slate-400 rounded-[2rem] mb-5 group-hover:bg-blue-100 group-hover:text-blue-600 transition-all duration-300">
      <FileText size={40} />
    </div>
    <h4 className="font-black text-slate-800 text-lg mb-1">{title}</h4>
    <p className="text-[10px] text-slate-400 mb-6 tracking-widest uppercase font-black">Supported: PDF Only</p>
    
    <label className="cursor-pointer relative w-full">
      <input 
        type="file" 
        accept=".pdf" 
        className="hidden" 
        onChange={onUpload} 
        disabled={isUploading} 
      />
      <div className={`w-full py-4 rounded-2xl font-black text-xs uppercase flex items-center justify-center gap-2 transition-all shadow-sm ${isUploading ? 'bg-slate-100 text-slate-400' : 'bg-white border border-slate-200 text-slate-900 hover:bg-slate-900 hover:text-white hover:shadow-lg'}`}>
        {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
        {isUploading ? 'Processing...' : 'Change Document'}
      </div>
    </label>
  </div>
);

export default SettingsManager;