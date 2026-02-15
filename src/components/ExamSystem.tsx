import React, { useState, useEffect } from 'react';
import { api } from '../services/supabaseApi';
import { User, Question, ExamType } from '../types';
import { useTranslation } from '../context/LanguageContext';
import DigitalCard from './DigitalCard';
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileText,
  ChevronRight // ✅ เพิ่มการ Import ตัวนี้เพื่อแก้ปัญหาหน้าจอขาว (ReferenceError)
} from 'lucide-react';

interface ExamSystemProps {
  type: ExamType;
  user: User;
  onComplete: (user: User) => void;
  onBack: () => void;
}

const ExamSystem: React.FC<ExamSystemProps> = ({
  type,
  user,
  onComplete,
  onBack
}) => {
  const { t, language } = useTranslation();

  const [step, setStep] = useState<'READ' | 'EXAM' | 'RESULT'>('READ');
  const [permitNo, setPermitNo] = useState('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [score, setScore] = useState(0);
  const [passed, setPassed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasReadManual, setHasReadManual] = useState(false);

  useEffect(() => {
    // ดึงข้อถามตามประเภทการสอบ
    api.getQuestions(type).then(setQuestions);
  }, [type]);

  // ฟังก์ชันดักจับการเลื่อนอ่านคู่มือ เพื่อปลดล็อกปุ่มสอบ
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 20) {
      setHasReadManual(true);
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      // ส่งคำตอบไปตรวจที่ Server ผ่าน RPC เพื่อความปลอดภัย
      const result = await api.submitExamWithAnswers(
        type, 
        answers, 
        permitNo
      );

      setScore(result.score);
      setPassed(result.passed);
      setStep('RESULT');

      if (result.passed) {
        const updatedUser = { ...user };
        const now = new Date();
        // ถ้าเป็น Induction ให้คำนวณวันหมดอายุ 1 ปี
        if (type === 'INDUCTION') {
          const nextYear = new Date(now);
          nextYear.setFullYear(now.getFullYear() + 1);
          updatedUser.induction_expiry = nextYear.toISOString();
        }
        setTimeout(() => onComplete(updatedUser), 2000);
      }
    } catch (err: any) {
      alert("เกิดข้อผิดพลาด: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  /* ================= READ STEP ================= */

  if (step === 'READ') {
    return (
      <div className="max-w-4xl mx-auto p-6 animate-in zoom-in duration-300">
        {/* ปุ่มย้อนกลับ */}
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-slate-400 hover:text-slate-600 mb-4 font-bold text-xs uppercase transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('common.back')}
        </button>

        <div className="bg-white rounded-[2.5rem] shadow-xl border border-slate-200 overflow-hidden">
          {/* Header หน้าอ่านคู่มือ */}
          <div className="p-8 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
            <div>
              <h2 className="text-3xl font-black text-slate-900 tracking-tight">
                {t('user.manual')}
              </h2>
              <p className="text-slate-500 font-bold text-sm mt-1">
                ประเภท: <span className="text-blue-600">{type} Safety Training</span>
              </p>
            </div>
            <div className="hidden md:block p-3 bg-white rounded-2xl shadow-sm border border-slate-100">
              <FileText className="w-8 h-8 text-blue-500" />
            </div>
          </div>

          {/* PDF Viewer Section */}
          <div className="p-4 bg-slate-200">
            <div className="bg-white rounded-2xl shadow-inner overflow-hidden relative group">
              <iframe 
                src={`https://qdodmxrecioltwdryhec.supabase.co/storage/v1/object/public/manuals/${type.toLowerCase()}.pdf#toolbar=0&navpanes=0`} 
                className="w-full h-[60vh] border-none"
                title="Safety Manual PDF"
              />
              
              {!hasReadManual && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-slate-900/80 backdrop-blur-md text-white px-6 py-2 rounded-full text-xs font-bold animate-bounce">
                  ⬇️ กรุณาศึกษาเนื้อหาให้ครบถ้วนก่อนเข้าสอบ
                </div>
              )}
            </div>
          </div>

          {/* Action Button */}
          <div className="p-8 bg-white text-center space-y-6">
            {/* ส่วนยืนยันการอ่าน: เปลี่ยนจาก Pulse Text เป็น Checkbox เพื่อปลดล็อกปุ่ม */}
            <div className="flex flex-col items-center gap-3">
              <label className="flex items-center gap-3 cursor-pointer group bg-slate-50 px-6 py-4 rounded-2xl border border-slate-100 hover:border-blue-200 transition-all">
                <input 
                  type="checkbox" 
                  checked={hasReadManual}
                  onChange={(e) => setHasReadManual(e.target.checked)}
                  className="w-6 h-6 rounded-lg border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <span className="text-slate-700 font-black text-sm select-none">
                  ฉันได้ศึกษาเนื้อหาคู่มือความปลอดภัยครบถ้วนแล้ว
                </span>
              </label>
              {!hasReadManual && (
                <p className="text-[10px] text-amber-500 font-bold uppercase tracking-wider animate-pulse">
                  * กรุณาทำเครื่องหมายถูกเพื่อยืนยันก่อนเริ่มทำข้อสอบ
                </p>
              )}
            </div>
            
            <button
              disabled={!hasReadManual}
              onClick={() => setStep('EXAM')}
              className="w-full max-w-md bg-blue-600 hover:bg-blue-700 text-white font-black py-5 rounded-2xl shadow-xl shadow-blue-200 transition-all text-xl disabled:opacity-50 disabled:grayscale disabled:shadow-none flex items-center justify-center gap-3 mx-auto"
            >
              {t('exam.start')}
              <ChevronRight className="w-6 h-6" />
            </button>
            
            <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">
              Security Verified • Enterprise Safety Standard
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* ================= RESULT STEP ================= */

  if (step === 'RESULT') {
    if (passed) {
      // ✅ ถ้าสอบผ่าน แสดง Digital Card
      return <DigitalCard user={user} onBack={onComplete} />; 
      // หมายเหตุ: onBack ให้เรียก onComplete เพื่อกลับหน้า UserPanel
    }

    // ❌ ถ้าสอบตก แสดงหน้า Fail แบบเดิม
    return (
      <div className="max-w-md mx-auto text-center p-10 bg-white rounded-3xl shadow-xl border border-slate-200 mt-10 animate-in zoom-in">
        <div className="bg-red-50 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertCircle className="w-12 h-12 text-red-500" />
        </div>

        <h2 className="text-3xl font-black text-slate-900 mb-2">เสียใจด้วยครับ</h2>
        <p className="text-slate-500 font-bold">คุณทำคะแนนได้ไม่ถึงเกณฑ์ที่กำหนด</p>

        <div className="bg-slate-50 rounded-2xl p-6 my-8 border border-slate-200">
          <p className="text-slate-400 text-xs uppercase font-bold tracking-widest mb-2">คะแนนของคุณ</p>
          <div className="text-5xl font-black text-slate-800">
            {score} <span className="text-2xl text-slate-400">/ {questions.length}</span>
          </div>
        </div>

        <button 
          onClick={() => setStep('READ')} // ให้โอกาสกลับไปอ่านคู่มือใหม่
          className="w-full py-4 bg-slate-900 text-white font-bold rounded-2xl hover:bg-slate-700 transition-all"
        >
          ลองใหม่อีกครั้ง
        </button>
      </div>
    );
  }

  /* ================= EXAM STEP ================= */

  const answeredCount = Object.keys(answers).length;
  const totalQuestions = questions.length;
  const progressPercent = totalQuestions === 0 ? 0 : Math.round((answeredCount / totalQuestions) * 100);

  return (
    <div className="max-w-3xl mx-auto p-6 bg-white rounded-3xl shadow-lg border border-slate-200">
      <div className="sticky top-0 bg-white pb-6 mb-8 border-b border-slate-200 z-20">
        <div className="flex justify-between mb-2">
          <h2 className="text-lg font-black text-slate-900">Examination : {type}</h2>
          <span className="text-xs text-slate-500">{answeredCount}/{totalQuestions}</span>
        </div>
        <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${progressPercent === 100 ? 'bg-emerald-500' : 'bg-blue-600'}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
      
      {/* กรณีสอบ Work Permit ต้องกรอกเลขที่ใบอนุญาต */}
      {type === 'WORK_PERMIT' && (
        <div className="mb-6 p-4 bg-slate-50 rounded-xl border border-slate-200">
           <label className="block text-sm font-bold mb-2 text-slate-700">Work Permit Number (เลขที่ใบอนุญาต)</label>
           <input 
             value={permitNo}
             onChange={e => setPermitNo(e.target.value)}
             className="w-full p-2 border rounded-lg bg-white"
             placeholder="WP-XXXXX"
           />
        </div>
      )}

      <div className="space-y-10">
        {questions.map((q, idx) => (
          <div key={q.id}>
            <div>
              {/* 🟢 ส่วนที่เพิ่ม: แสดงรูปภาพถ้ามี */}
              {q.image_url && (
                <div className="mb-4">
                  <img 
                    src={q.image_url} 
                    alt="Question Reference" 
                    className="rounded-xl max-h-60 object-contain border border-slate-200" 
                  />
                </div>
              )}

              <p className="font-bold text-slate-900 mb-4 text-lg">
                <span className="text-slate-400 mr-2">{idx + 1}.</span>
                {language === 'th' ? q.content_th : q.content_en}
              </p>
            </div>

            <div className="space-y-3 pl-6">
              {q.choices_json.map((c, cIdx) => (
                <label
                  key={cIdx}
                  className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                    answers[q.id] === cIdx
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-slate-200 hover:border-slate-400'
                  }`}
                >
                  <input
                    type="radio"
                    className="hidden"
                    checked={answers[q.id] === cIdx}
                    onChange={() => setAnswers({ ...answers, [q.id]: cIdx })}
                  />
                  <span className="text-sm text-slate-700">
                    {language === 'th' ? c.text_th : c.text_en}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10">
        <button
          onClick={handleSubmit}
          disabled={loading || answeredCount !== totalQuestions || (type === 'WORK_PERMIT' && !permitNo)}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : t('exam.submit')}
        </button>
      </div>
    </div>
  );
};

export default ExamSystem;