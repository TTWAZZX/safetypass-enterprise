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
  ChevronRight,
  ChevronLeft,
  BookOpen,
  Send,
  Clock
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

  // --- Pagination States ---
  const [currentPage, setCurrentPage] = useState(0);
  const questionsPerPage = 5;

  // ✅ ฟังก์ชันสำหรับการสลับลำดับ (Fisher-Yates Shuffle)
  const shuffleArray = <T,>(array: T[]): T[] => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  useEffect(() => {
    api.getQuestions(type).then((rawQuestions) => {
      // ✅ สลับข้อสอบ และสลับตัวเลือกภายในแต่ละข้อ
      const prepared = shuffleArray(rawQuestions).map(q => ({
        ...q,
        choices_json: shuffleArray(q.choices_json)
      }));
      setQuestions(prepared);
    });
  }, [type]);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      // ✅ คำนวณคะแนนฝั่ง Client โดยตรวจจากฟิลด์ is_correct ในตัวเลือกที่สุ่มมา
      let correctCount = 0;
      questions.forEach((q) => {
        const selectedIdx = answers[q.id];
        if (selectedIdx !== undefined) {
          const selectedChoice = q.choices_json[selectedIdx];
          if (selectedChoice && selectedChoice.is_correct) {
            correctCount++;
          }
        }
      });

      // ส่งข้อมูลไปบันทึก (ระบบหลังบ้านจะได้รับ answers ที่ index ตรงกับที่แสดงผลในหน้าจอขณะนั้น)
      const result = await api.submitExamWithAnswers(type, answers, permitNo);
      
      // อัปเดตสถานะด้วยคะแนนที่คำนวณได้จริง
      setScore(correctCount);
      setPassed(result.passed); 
      setStep('RESULT');

      if (result.passed) {
        const updatedUser = { ...user };
        const now = new Date();
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

  // --- Pagination Logic ---
  const totalPages = Math.ceil(questions.length / questionsPerPage);
  const startIndex = currentPage * questionsPerPage;
  const currentQuestions = questions.slice(startIndex, startIndex + questionsPerPage);

  const handleNextPage = () => {
    if (currentPage < totalPages - 1) {
      setCurrentPage(prev => prev + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handlePrevPage = () => {
    if (currentPage > 0) {
      setCurrentPage(prev => prev - 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const isQuestionAnswered = (id: string) => answers[id] !== undefined;

  /* ================= 📖 READ STEP ================= */
  if (step === 'READ') {
    return (
      <div className="max-w-2xl mx-auto p-4 md:p-6 animate-in slide-in-from-bottom-4 duration-500 text-left">
        <button onClick={onBack} className="flex items-center gap-1.5 text-slate-400 hover:text-blue-600 mb-4 font-black text-[10px] uppercase tracking-widest transition-all">
          <ArrowLeft size={16} /> {t('common.back')}
        </button>

        <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-6 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-black text-slate-900 leading-tight">{t('user.manual')}</h2>
              <p className="text-[10px] text-blue-600 font-bold uppercase tracking-widest mt-0.5">{type} Safety Training</p>
            </div>
            <div className="p-2 bg-white rounded-xl shadow-sm border border-slate-100"><BookOpen className="text-blue-500" size={20} /></div>
          </div>

          <div className="p-2 bg-slate-100">
            <div className="bg-white rounded-xl overflow-hidden relative border border-slate-200 shadow-inner">
              <iframe 
                src={`https://qdodmxrecioltwdryhec.supabase.co/storage/v1/object/public/manuals/${type.toLowerCase()}.pdf#toolbar=0&navpanes=0`} 
                className="w-full h-[50vh] md:h-[60vh] border-none"
                title="Manual Viewer"
              />
            </div>
          </div>

          <div className="p-6 bg-white text-center space-y-5">
            <label className="flex items-start gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100 cursor-pointer active:bg-blue-50 transition-all text-left">
              <input 
                type="checkbox" 
                checked={hasReadManual}
                onChange={(e) => setHasReadManual(e.target.checked)}
                className="mt-1 w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-xs text-slate-600 font-bold leading-relaxed select-none">
                ข้าพเจ้ายืนยันว่าได้ศึกษาเนื้อหาคู่มือความปลอดภัยครบถ้วนแล้ว และพร้อมเข้าทำแบบทดสอบ
              </span>
            </label>
            
            <button
              disabled={!hasReadManual}
              onClick={() => setStep('EXAM')}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-2xl shadow-lg shadow-blue-100 transition-all text-base disabled:opacity-50 disabled:grayscale flex items-center justify-center gap-2 active:scale-95"
            >
              {t('exam.start')} <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ================= 📊 RESULT STEP ================= */
  if (step === 'RESULT') {
    if (passed) return <DigitalCard user={user} onBack={onComplete} />; 

    return (
      <div className="max-w-md mx-auto text-center p-8 bg-white rounded-[2.5rem] shadow-xl border border-slate-100 mt-10 animate-in zoom-in text-left">
        <div className="bg-red-50 w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6">
          <AlertCircle className="w-10 h-10 text-red-500" />
        </div>

        <h2 className="text-2xl font-black text-slate-900 text-center mb-1">ไม่ผ่านเกณฑ์การสอบ</h2>
        <p className="text-slate-500 font-bold text-center text-sm mb-8">กรุณากลับไปทบทวนคู่มือและลองใหม่อีกครั้ง</p>

        <div className="bg-slate-50 rounded-[2rem] p-6 mb-8 border border-slate-100 text-center">
          <p className="text-[10px] text-slate-400 uppercase font-black tracking-[0.2em] mb-2">Your Score</p>
          <div className="text-5xl font-black text-slate-800 tracking-tighter">
            {score} <span className="text-xl text-slate-300">/ {questions.length}</span>
          </div>
        </div>

        <button onClick={() => { setStep('READ'); setCurrentPage(0); setAnswers({}); }} className="w-full py-4 bg-slate-900 text-white font-black rounded-2xl hover:bg-slate-800 transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2 uppercase text-xs tracking-widest">
            <RotateCcw size={16} /> Try Again
        </button>
      </div>
    );
  }

  /* ================= 📝 EXAM STEP (Paged & Tracker) ================= */
  const answeredCount = Object.keys(answers).length;
  const totalQuestions = questions.length;
  const progressPercent = totalQuestions === 0 ? 0 : Math.round((answeredCount / totalQuestions) * 100);

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 animate-in slide-in-from-bottom-4 duration-500 text-left pb-32">
      
      {/* 📍 Top Sticky Progress & Tracker Grid */}
      <div className="sticky top-[-1px] bg-slate-50/95 backdrop-blur-md pt-2 pb-6 mb-8 z-20 border-b border-slate-200">
        <div className="flex justify-between items-end mb-4">
          <div>
            <h2 className="text-sm font-black text-slate-900 uppercase tracking-tight">Exam: {type}</h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
               {answeredCount === totalQuestions ? 'All questions answered' : `Please complete all questions (${answeredCount}/${totalQuestions})`}
            </p>
          </div>
          <div className="flex items-center gap-2">
             <Clock size={14} className="text-slate-300" />
             <span className="text-xs font-black text-blue-600 bg-blue-50 px-3 py-1 rounded-full border border-blue-100">
               {progressPercent}%
             </span>
          </div>
        </div>
        
        {/* Question Mini-Map Grid */}
        <div className="flex flex-wrap gap-1.5 mb-4">
           {questions.map((q, qIdx) => (
             <button
               key={q.id}
               onClick={() => setCurrentPage(Math.floor(qIdx / questionsPerPage))}
               className={`w-7 h-7 rounded-lg flex items-center justify-center text-[9px] font-black transition-all border-2
                 ${isQuestionAnswered(q.id) ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm' : 'bg-white border-slate-100 text-slate-300'}
                 ${qIdx >= startIndex && qIdx < startIndex + questionsPerPage ? 'ring-2 ring-blue-500 ring-offset-1 scale-110 z-10' : ''}
               `}
             >
               {qIdx + 1}
             </button>
           ))}
        </div>

        <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden shadow-inner">
          <div
            className={`h-full transition-all duration-700 ease-out ${progressPercent === 100 ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'bg-blue-600'}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
      
      {/* Work Permit Input (Only on Page 1) */}
      {type === 'WORK_PERMIT' && currentPage === 0 && (
        <div className="mb-8 p-5 bg-white rounded-2xl border-2 border-blue-100 shadow-sm animate-in fade-in duration-500 text-left">
           <label className="block text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2 ml-1">Work Permit Number (เลขใบอนุญาต)</label>
           <input 
             value={permitNo}
             onChange={e => setPermitNo(e.target.value)}
             className="w-full p-4 border border-slate-200 rounded-xl bg-slate-50 font-black text-blue-600 outline-none focus:border-blue-500 focus:bg-white transition-all shadow-inner"
             placeholder="WP-XXXXX"
           />
        </div>
      )}

      {/* 📝 Questions List (Current Page) */}
      <div className="space-y-12">
        {currentQuestions.map((q, idx) => (
          <div key={q.id} className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="mb-4">
              <div className="flex items-center justify-between mb-3">
                 <span className="px-3 py-1 bg-slate-900 text-white text-[10px] font-black rounded-lg uppercase tracking-widest">Question {startIndex + idx + 1}</span>
                 {isQuestionAnswered(q.id) && <CheckCircle2 size={16} className="text-emerald-500" />}
              </div>
              {q.image_url && (
                <div className="mb-4 rounded-2xl overflow-hidden border border-slate-200 bg-white p-1 shadow-sm">
                  <img src={q.image_url} alt="Reference" className="w-full max-h-64 object-contain" />
                </div>
              )}
              <p className="font-bold text-slate-800 text-base md:text-lg leading-snug">
                {language === 'th' ? q.content_th : q.content_en}
              </p>
            </div>

            <div className="space-y-3">
              {q.choices_json.map((c, cIdx) => (
                <label
                  key={cIdx}
                  className={`flex items-center gap-4 p-4 rounded-2xl border-2 cursor-pointer transition-all active:scale-[0.98] ${
                    answers[q.id] === cIdx
                      ? 'border-blue-600 bg-blue-50 shadow-md shadow-blue-50'
                      : 'border-slate-100 bg-white hover:border-slate-200'
                  }`}
                >
                  <input
                    type="radio"
                    className="hidden"
                    checked={answers[q.id] === cIdx}
                    onChange={() => setAnswers({ ...answers, [q.id]: cIdx })}
                  />
                  <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${
                    answers[q.id] === cIdx ? 'border-blue-600 bg-blue-600' : 'border-slate-200'
                  }`}>
                    {answers[q.id] === cIdx && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                  </div>
                  <span className={`text-sm font-bold ${answers[q.id] === cIdx ? 'text-blue-700' : 'text-slate-600'}`}>
                    {language === 'th' ? c.text_th : c.text_en}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 🧭 Floating Navigation Control Bar */}
      <div className="fixed bottom-0 left-0 right-0 p-4 md:p-6 bg-white/80 backdrop-blur-xl border-t border-slate-100 flex justify-center z-50">
        <div className="max-w-2xl w-full flex justify-between items-center gap-4">
          <button 
            disabled={currentPage === 0}
            onClick={handlePrevPage}
            className={`flex items-center gap-2 px-6 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all ${currentPage === 0 ? 'opacity-0 pointer-events-none' : 'text-slate-400 hover:text-slate-800'}`}
          >
            <ChevronLeft size={16} /> Back
          </button>

          {currentPage === totalPages - 1 ? (
            <button
              onClick={handleSubmit}
              disabled={loading || answeredCount !== totalQuestions || (type === 'WORK_PERMIT' && !permitNo)}
              className="flex-1 md:flex-none bg-emerald-600 hover:bg-emerald-700 text-white px-10 py-4 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-emerald-100 transition-all disabled:opacity-50 disabled:grayscale flex items-center justify-center gap-3 active:scale-95"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Send size={16} /> Submit Exam</>}
            </button>
          ) : (
            <button 
              onClick={handleNextPage}
              className="flex-1 md:flex-none bg-blue-600 hover:bg-blue-700 text-white px-10 py-4 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-blue-200 transition-all flex items-center justify-center gap-3 active:scale-95 group"
            >
              Next Page <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// 🔵 Helper Components
const RotateCcw = ({ size }: { size: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
);

export default ExamSystem;