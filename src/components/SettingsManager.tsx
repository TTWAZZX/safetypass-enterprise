import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { api } from '../services/supabaseApi';
import { useToastContext } from './ToastProvider';
import { 
  FileText, 
  Save, 
  Loader2, 
  ShieldAlert, 
  Upload, 
  ServerCog,
  AlertTriangle,
  Target,
  Link as LinkIcon,
  MessageCircleQuestion,
  BookOpen
} from 'lucide-react';

const SettingsManager: React.FC = () => {
  const { showToast } = useToastContext();
  
  // Upload States
  const [uploading, setUploading] = useState<string | null>(null);
  
  // Config States
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // States: Scores
  const [inductionScore, setInductionScore] = useState<number>(80);
  const [permitScore, setPermitScore] = useState<number>(80);

  // ✅ States: Support Links (ใหม่)
  const [manualUrl, setManualUrl] = useState<string>('');
  const [supportUrl, setSupportUrl] = useState<string>('');

  // Load Settings
  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const config = await api.getSystemSettings();
      // ดึงค่าคะแนนเดิมมาใส่ State (ถ้าไม่มีให้ใช้ 80)
      if (config['PASSING_SCORE_INDUCTION']) setInductionScore(Number(config['PASSING_SCORE_INDUCTION']));
      if (config['PASSING_SCORE_WORK_PERMIT']) setPermitScore(Number(config['PASSING_SCORE_WORK_PERMIT']));
      
      // ✅ ดึงค่าลิงก์มาใส่ State (ถ้าไม่มีให้ว่างไว้)
      if (config['manual_url']) setManualUrl(config['manual_url']);
      if (config['support_url']) setSupportUrl(config['support_url']);

    } catch (err) {
      console.error(err);
      showToast('ไม่สามารถโหลดค่า Config ได้ (Failed to load config)', 'error');
    } finally {
      setLoading(false);
    }
  };

  // ✅ Save Logic: บันทึกทั้งคะแนนและลิงก์ พร้อมโหลดค่าซ้ำเพื่อยืนยัน
  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      await Promise.all([
        // บันทึกคะแนนผ่าน
        api.updateSystemSetting('PASSING_SCORE_INDUCTION', inductionScore),
        api.updateSystemSetting('PASSING_SCORE_WORK_PERMIT', permitScore),
        // ✅ บันทึกลิงก์
        api.updateSystemSetting('manual_url', manualUrl),
        api.updateSystemSetting('support_url', supportUrl)
      ]);

      showToast('บันทึกการตั้งค่าระบบเรียบร้อยแล้ว (Settings saved successfully)', 'success');
      await loadConfig(); // Reload เพื่อความชัวร์
    } catch (err: any) {
      console.error(err);
      showToast('บันทึกไม่สำเร็จ (Save failed): ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Upload Logic (ของเดิม ไม่ถูกลบ)
  const handleUploadManual = async (event: React.ChangeEvent<HTMLInputElement>, type: 'induction' | 'work_permit') => {
    try {
      setUploading(type);
      const file = event.target.files?.[0];
      if (!file) return;

      if (file.type !== 'application/pdf') {
        return showToast('กรุณาอัปโหลดไฟล์ PDF เท่านั้น (Please upload PDF file only)', 'error');
      }

      const { error } = await supabase.storage
        .from('manuals')
        .upload(`${type}.pdf`, file, { upsert: true });

      if (error) throw error;

      showToast(`อัปโหลดคู่มือ ${type} สำเร็จแล้ว (Upload successful)`, 'success');
    } catch (err: any) {
      showToast('อัปโหลดล้มเหลว (Upload failed): ' + err.message, 'error');
    } finally {
      setUploading(null);
    }
  };

  if (loading) return <div className="p-20 text-center"><Loader2 className="animate-spin mx-auto text-blue-600" /></div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-4xl mx-auto pb-10">
      
      {/* Header */}
      <div className="flex items-center gap-4 border-b border-slate-200 pb-6">
        <div className="p-3 bg-slate-900 text-white rounded-2xl shadow-lg">
           <ServerCog size={24} />
        </div>
        <div>
           <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">System Configuration</h2>
           <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">ตั้งค่าระบบและเกณฑ์การทดสอบ (Global Parameters)</p>
        </div>
      </div>

      {/* ⚙️ Threshold Settings (UI แบบเดิมของคุณ) */}
      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden relative">
         <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-blue-500 via-purple-500 to-emerald-500" />
         
         <div className="p-8 pb-4">
            <div className="flex items-start gap-4 mb-8">
                <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl border border-blue-100">
                    <ShieldAlert size={24} />
                </div>
                <div>
                    <h3 className="text-lg font-black text-slate-800 uppercase">Threshold Settings <span className="text-sm font-bold text-slate-400 normal-case">| เกณฑ์การทดสอบ</span></h3>
                    <p className="text-xs text-slate-400 font-bold mt-1">กำหนดเกณฑ์คะแนนขั้นต่ำสำหรับการผ่านการทดสอบ (Passing Score)</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                {/* Induction Score */}
                <div className="bg-slate-50 p-6 rounded-3xl border border-slate-200 hover:border-blue-300 transition-all group">
                    <div className="flex justify-between items-center mb-4">
                        <label className="text-xs font-black text-slate-500 uppercase tracking-widest flex flex-col">
                            Induction Pass Rate
                            <span className="text-[9px] text-slate-400 font-bold">เกณฑ์ผ่านปฐมนิเทศ</span>
                        </label>
                        <span className={`px-3 py-1 rounded-full text-[10px] font-black border ${inductionScore >= 80 ? 'bg-emerald-100 text-emerald-600 border-emerald-200' : 'bg-amber-100 text-amber-600 border-amber-200'}`}>
                            {inductionScore >= 80 ? 'STRICT' : 'STANDARD'}
                        </span>
                    </div>
                    <div className="flex items-center gap-4">
                        <input 
                            type="range" 
                            min="0" max="100" step="5"
                            value={inductionScore}
                            onChange={(e) => setInductionScore(Number(e.target.value))}
                            className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                        />
                        <div className="w-16 h-16 bg-white rounded-2xl border-2 border-blue-100 flex items-center justify-center text-xl font-black text-slate-800 shadow-sm group-hover:scale-110 transition-transform">
                            {inductionScore}%
                        </div>
                    </div>
                </div>

                {/* Work Permit Score */}
                <div className="bg-slate-50 p-6 rounded-3xl border border-slate-200 hover:border-purple-300 transition-all group">
                    <div className="flex justify-between items-center mb-4">
                        <label className="text-xs font-black text-slate-500 uppercase tracking-widest flex flex-col">
                            Work Permit Pass Rate
                            <span className="text-[9px] text-slate-400 font-bold">เกณฑ์ผ่านใบอนุญาตทำงาน</span>
                        </label>
                        <span className={`px-3 py-1 rounded-full text-[10px] font-black border ${permitScore >= 80 ? 'bg-emerald-100 text-emerald-600 border-emerald-200' : 'bg-amber-100 text-amber-600 border-amber-200'}`}>
                            {permitScore >= 80 ? 'STRICT' : 'STANDARD'}
                        </span>
                    </div>
                    <div className="flex items-center gap-4">
                        <input 
                            type="range" 
                            min="0" max="100" step="5"
                            value={permitScore}
                            onChange={(e) => setPermitScore(Number(e.target.value))}
                            className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                        />
                        <div className="w-16 h-16 bg-white rounded-2xl border-2 border-purple-100 flex items-center justify-center text-xl font-black text-slate-800 shadow-sm group-hover:scale-110 transition-transform">
                            {permitScore}%
                        </div>
                    </div>
                </div>
            </div>
            
            {/* ✅ ส่วนตั้งค่าลิงก์ใหม่ (Help & Support Links) */}
            <div className="border-t border-slate-100 pt-8 mb-8">
                <div className="flex items-start gap-4 mb-6">
                    <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl border border-indigo-100">
                        <LinkIcon size={24} />
                    </div>
                    <div>
                        <h3 className="text-lg font-black text-slate-800 uppercase">Support Links <span className="text-sm font-bold text-slate-400 normal-case">| ลิงก์คู่มือและติดต่อ</span></h3>
                        <p className="text-xs text-slate-400 font-bold mt-1">ตั้งค่าลิงก์ที่แสดงในหน้าเข้าสู่ระบบ (Displayed on Login Page)</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5 ml-1">
                            <BookOpen size={12} className="text-blue-500" /> User Guide URL (ลิงก์คู่มือใช้งาน)
                        </label>
                        <input 
                            type="text" 
                            placeholder="เช่น https://yourdomain.com/manual.pdf"
                            value={manualUrl}
                            onChange={(e) => setManualUrl(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold text-sm shadow-inner outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all text-slate-700"
                        />
                        <p className="text-[9px] text-slate-400 font-bold ml-1">เว้นว่างไว้หากไม่ต้องการให้แสดงปุ่มคู่มือ</p>
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5 ml-1">
                            <MessageCircleQuestion size={12} className="text-emerald-500" /> Support URL (ลิงก์แจ้งปัญหา/Line)
                        </label>
                        <input 
                            type="text" 
                            placeholder="เช่น https://line.me/ti/p/@yourid"
                            value={supportUrl}
                            onChange={(e) => setSupportUrl(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold text-sm shadow-inner outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all text-slate-700"
                        />
                        <p className="text-[9px] text-slate-400 font-bold ml-1">เว้นว่างไว้หากไม่ต้องการให้แสดงปุ่มติดต่อ</p>
                    </div>
                </div>
            </div>

         </div>
         
         <div className="bg-slate-50 p-6 border-t border-slate-100 flex justify-end">
             <button 
                onClick={handleSaveConfig} 
                disabled={saving}
                className="flex items-center gap-2 px-8 py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-black transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
             >
                {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                Save Changes / บันทึก
             </button>
         </div>
      </div>

      {/* 📚 SECTION 2: MANUALS & ASSET MANAGEMENT (ของเดิม) */}
      <div className="bg-white p-6 md:p-10 rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-4 mb-10">
          <div className="p-4 bg-slate-100 text-slate-600 rounded-3xl">
            <FileText size={28} strokeWidth={2.5} />
          </div>
          <div>
            <h3 className="text-xl md:text-2xl font-black text-slate-900 leading-none uppercase tracking-tight">Resource Center <span className="text-sm font-bold text-slate-400 normal-case">| จัดการไฟล์ระบบ</span></h3>
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-[0.2em] mt-1.5">Manage Study Materials (PDF Assets)</p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          <ManualUploadCard 
            title="Induction Manual (ปฐมนิเทศ)"
            type="induction"
            isUploading={uploading === 'induction'}
            onUpload={(e: any) => handleUploadManual(e, 'induction')}
          />
          <ManualUploadCard 
            title="Work Permit Manual (ใบอนุญาต)"
            type="work_permit"
            isUploading={uploading === 'work_permit'}
            onUpload={(e: any) => handleUploadManual(e, 'work_permit')}
          />
        </div>

        <div className="mt-10 p-5 bg-amber-50/50 rounded-3xl border border-amber-100 flex items-start gap-4">
            <div className="p-2 bg-white rounded-xl shadow-sm text-amber-500">
                <AlertTriangle size={20} />
            </div>
            <div className="space-y-1">
                <p className="text-xs font-black text-amber-800 uppercase tracking-tight">Deployment Notice</p>
                <p className="text-[11px] text-amber-700/80 font-bold leading-relaxed">
                    Uploading a new document will permanently overwrite the existing file.<br/>
                    การอัปโหลดไฟล์เอกสารใหม่จะทับไฟล์เดิมที่อยู่บนระบบทันที
                </p>
            </div>
        </div>
      </div>
    </div>
  );
};

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
        {isUploading ? 'Deploying Assets...' : 'Replace Artifact (อัปโหลดใหม่)'}
      </div>
    </label>
  </div>
);

export default SettingsManager;