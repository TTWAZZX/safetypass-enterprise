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
  AlertTriangle,
  ChevronRight,
  ShieldCheck
} from 'lucide-react';
import { useToastContext } from './ToastProvider';

const SettingsManager: React.FC = () => {
  const { showToast } = useToastContext();
  
  // States สำหรับระบบอัปโหลด
  const [uploading, setUploading] = useState<string | null>(null);
  
  // States สำหรับระบบตั้งค่าคะแนน
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

  // ✅ ฟังก์ชันบันทึกคะแนน
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
    <div className="space-y-6 md:space-y-8 animate-in fade-in duration-500 pb-10 text-left">
      
      {/* 🧭 SECTION 1: PASSING SCORES CONFIGURATION */}
      <div className="bg-white p-6 md:p-10 rounded-[2.5rem] border border-slate-200 shadow-sm relative overflow-hidden group">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
            <div className="flex items-center gap-4">
                <div className="p-4 bg-blue-600 text-white rounded-3xl shadow-lg shadow-blue-200 group-hover:scale-110 transition-transform duration-500">
                    <Target size={28} strokeWidth={2.5} />
                </div>
                <div>
                    <h3 className="text-xl md:text-2xl font-black text-slate-900 leading-none uppercase tracking-tight">Threshold Settings</h3>
                    <p className="text-slate-400 text-[10px] font-black uppercase tracking-[0.2em] mt-1.5 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                        Global Compliance Passing Rates
                    </p>
                </div>
            </div>
        </div>

        {loadingScore ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
             <Loader2 size={32} className="animate-spin text-blue-600" />
             <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Accessing Node...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10 mb-10">
            <ScoreInput 
              label="Induction Pass Rate" 
              description="Minimum percentage required for safety orientation."
              value={passingScore.INDUCTION} 
              onChange={(val) => setPassingScore({...passingScore, INDUCTION: val})}
              color="blue"
            />
            <ScoreInput 
              label="Work Permit Pass Rate" 
              description="Critical accuracy required for high-risk operations."
              value={passingScore.WORK_PERMIT} 
              onChange={(val) => setPassingScore({...passingScore, WORK_PERMIT: val})}
              color="purple"
            />
          </div>
        )}

        <div className="flex flex-col md:flex-row items-center justify-between pt-8 border-t border-slate-50 gap-4">
          <div className="flex items-center gap-2 text-slate-400">
             <ShieldCheck size={16} />
             <p className="text-[10px] font-bold uppercase tracking-tight">All changes affect current sessions immediately</p>
          </div>
          <button 
            onClick={handleSaveScores}
            disabled={isSavingScore || loadingScore}
            className="w-full md:w-auto bg-slate-900 hover:bg-blue-600 text-white px-10 py-4 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 transition-all shadow-xl active:scale-95 disabled:opacity-50"
          >
            {isSavingScore ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Commit Config
          </button>
        </div>
      </div>

      {/* 📚 SECTION 2: MANUALS & ASSET MANAGEMENT */}
      <div className="bg-white p-6 md:p-10 rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-4 mb-10">
          <div className="p-4 bg-slate-100 text-slate-600 rounded-3xl">
            <FileText size={28} strokeWidth={2.5} />
          </div>
          <div>
            <h3 className="text-xl md:text-2xl font-black text-slate-900 leading-none uppercase tracking-tight">Resource Center</h3>
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-[0.2em] mt-1.5">Manage Study Materials (PDF Assets)</p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          <ManualUploadCard 
            title="Induction Manual"
            type="induction"
            isUploading={uploading === 'induction'}
            onUpload={(e) => handleUploadManual(e, 'induction')}
          />
          <ManualUploadCard 
            title="Work Permit Manual"
            type="work_permit"
            isUploading={uploading === 'work_permit'}
            onUpload={(e) => handleUploadManual(e, 'work_permit')}
          />
        </div>

        <div className="mt-10 p-5 bg-amber-50/50 rounded-3xl border border-amber-100 flex items-start gap-4">
            <div className="p-2 bg-white rounded-xl shadow-sm text-amber-500">
                <AlertTriangle size={20} />
            </div>
            <div className="space-y-1">
                <p className="text-xs font-black text-amber-800 uppercase tracking-tight">Deployment Notice</p>
                <p className="text-[11px] text-amber-700/80 font-bold leading-relaxed">
                    Uploading a new document will **permanently overwrite** the existing file. Ensure the content is validated and the file size is under **5MB** for optimal performance on mobile devices.
                </p>
            </div>
        </div>
      </div>
    </div>
  );
};

/* --- 🔵 SUB-COMPONENTS --- */

const ScoreInput = ({ label, description, value, onChange, color }: any) => (
  <div className="space-y-3 group">
    <div className="ml-1">
        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">{label}</label>
        <p className="text-[9px] text-slate-300 font-bold uppercase tracking-tight">{description}</p>
    </div>
    <div className="relative">
      <input 
        type="number" 
        min="0" 
        max="100"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`w-full bg-slate-50 border-2 border-slate-50 p-5 md:p-6 rounded-3xl font-black text-3xl md:text-4xl text-slate-800 focus:bg-white focus:border-${color}-500 transition-all outline-none shadow-inner tabular-nums`}
      />
      <div className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-200 font-black text-2xl group-focus-within:text-blue-500 transition-colors">%</div>
    </div>
  </div>
);

const ManualUploadCard = ({ title, type, isUploading, onUpload }: any) => (
  <div className="p-8 md:p-10 border-2 border-dashed border-slate-100 bg-slate-50/30 rounded-[2.5rem] flex flex-col items-center text-center group hover:border-blue-400 hover:bg-white transition-all duration-500 cursor-default shadow-sm hover:shadow-xl hover:shadow-blue-500/5">
    <div className="w-20 h-20 bg-white text-slate-300 rounded-[2rem] mb-6 flex items-center justify-center shadow-sm border border-slate-50 group-hover:bg-blue-600 group-hover:text-white group-hover:scale-110 transition-all duration-500">
      <FileText size={36} strokeWidth={1.5} />
    </div>
    <h4 className="font-black text-slate-800 text-lg uppercase tracking-tight mb-1">{title}</h4>
    <p className="text-[9px] font-black text-slate-400 tracking-[0.2em] uppercase mb-8">Asset Format: Adobe PDF</p>
    
    <label className="cursor-pointer relative w-full">
      <input 
        type="file" 
        accept=".pdf" 
        className="hidden" 
        onChange={onUpload} 
        disabled={isUploading} 
      />
      <div className={`w-full py-4 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] flex items-center justify-center gap-2 transition-all shadow-sm ${isUploading ? 'bg-slate-100 text-slate-400' : 'bg-white border border-slate-200 text-slate-900 hover:bg-slate-900 hover:text-white hover:border-slate-900'}`}>
        {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
        {isUploading ? 'Deploying Assets...' : 'Replace Artifact'}
      </div>
    </label>
  </div>
);

export default SettingsManager;