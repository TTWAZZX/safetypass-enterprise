import React, { useState, useEffect } from 'react';
import { api } from '../services/supabaseApi';
import { User, Question, ExamType, QuestionPattern } from '../types';
import { useTranslation } from '../context/LanguageContext';
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Send,
  Clock,
  RotateCcw,
  Maximize2,
  ArrowRightLeft,
  XCircle,
  Check,
  Award,
  BadgeCheck
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
  const [answers, setAnswers] = useState<Record<string, any>>({}); 
  const [score, setScore] = useState(0);
  const [passed, setPassed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasReadManual, setHasReadManual] = useState(false);
  
  // ✅ เก็บข้อมูล User ที่อัปเดตแล้วไว้ส่งกลับ
  const [updatedUserData, setUpdatedUserData] = useState<User | null>(null);

  // --- Pagination States ---
  const [currentPage, setCurrentPage] = useState(0);
  const questionsPerPage = 5;

  // ✅ 1. Auto-Scroll to top
  useEffect(() => {
    if (step === 'EXAM') {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [currentPage, step]);

  // ✅ 2. Anti-Cheating System
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => e.preventDefault();
    const handleCopyPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      alert("⚠️ Security Alert: Action not allowed during examination.");
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === 'F12' || 
        (e.ctrlKey && e.shiftKey && e.key === 'I') ||
        (e.ctrlKey && (e.key === 'c' || e.key === 'v'))
      ) {
        e.preventDefault();
      }
    };
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('copy', handleCopyPaste);
    document.addEventListener('cut', handleCopyPaste);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('copy', handleCopyPaste);
      document.removeEventListener('cut', handleCopyPaste);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // ✅ 3. Shuffle Logic (Updated: Shuffle Only Questions, NOT Choices)
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
      // ✅ สลับ "ลำดับข้อคำถาม" (Questions) ได้เหมือนเดิม
      const prepared = shuffleArray(rawQuestions).map(q => {
        
        let processedChoices = q.choices_json;
        if (typeof processedChoices === 'string') {
             try { processedChoices = JSON.parse(processedChoices); } catch (e) { processedChoices = []; }
        }

        // หากเป็นข้อสอบจับคู่ ให้เตรียมข้อมูลฝั่งขวาที่ Shuffle แล้ว
        if (q.pattern === QuestionPattern.MATCHING) {
            const pairs = [...processedChoices];
            return { ...q, choices_json: pairs, shuffled_right: shuffleArray(pairs) };
        }
        
        // ⚠️ FIXED: ปรนัยปกติ ไม่สลับตัวเลือก (Choices) แล้ว เพื่อให้ Index ตรงกับ Database
        return {
          ...q,
          choices_json: processedChoices // ไม่ใส่ shuffleArray() ที่นี่
        };
      });
      setQuestions(prepared);
    });
  }, [type]);

  // ✅ 4. Submit & Grading Logic
  const handleSubmit = async () => {
    if (loading) return;
    setLoading(true);
    
    try {
      let correctCount = 0;
      
      // วนลูปตรวจทีละข้อ
      questions.forEach((q) => {
        const userAns = answers[q.id];

        // 1. ถ้าไม่ได้ตอบ ให้ข้าม (ถือว่าผิด)
        if (userAns === undefined || userAns === null) return;

        // 2. ตรวจตามประเภทคำถาม
        if (q.pattern === 'SHORT_ANSWER' || q.pattern === 'short_answer') {
            // แบบเติมคำ: ตัดช่องว่างหน้าหลัง และแปลงเป็นตัวเล็กก่อนเทียบ
            const correctText = q.choices_json[0]?.correct_answer?.toString().toLowerCase().trim();
            const userText = userAns.toString().toLowerCase().trim();
            if (userText === correctText) correctCount++;
        } 
        else if (q.pattern === 'MATCHING' || q.pattern === 'matching') {
            // แบบจับคู่: ต้องถูกทุกคู่
            const pairs = q.choices_json;
            // เช็คว่า userAns เป็น Array และค่าตรงกับ Index หรือไม่
            if (Array.isArray(userAns)) {
                const isAllCorrect = pairs.every((p: any, idx: number) => Number(userAns[idx]) === idx);
                if (isAllCorrect) correctCount++;
            }
        }
        else {
            // แบบเลือกตอบ (Multiple Choice / True-False)
            // userAns คือ index ของตัวเลือกที่ตอบ
            const selectedChoice = q.choices_json[Number(userAns)];
            
            if (selectedChoice) {
                // รองรับทั้ง Boolean (true) และ String ("true") และ Case-insensitive
                const isCorrectFlag = selectedChoice.is_correct;
                
                const isReallyCorrect = 
                    isCorrectFlag === true || 
                    String(isCorrectFlag) === 'true' || 
                    String(isCorrectFlag) === 'True' ||
                    String(isCorrectFlag) === 'TRUE';

                if (isReallyCorrect) correctCount++;
            }
        }
      });

      // คำนวณผล (เกณฑ์ 80%)
      const calculatedPassed = (correctCount / questions.length) * 100 >= 80;

      // บันทึกลงฐานข้อมูล (รอให้เสร็จก่อนค่อยไปต่อ)
      await api.submitExamWithAnswers(type, answers, permitNo);

      setScore(correctCount);
      setPassed(calculatedPassed); 
      
      if (calculatedPassed) {
        const updatedUser = { ...user };
        const now = new Date();
        if (type === 'INDUCTION') {
          const nextYear = new Date(now);
          nextYear.setFullYear(now.getFullYear() + 1);
          updatedUser.induction_expiry = nextYear.toISOString();
        }
        setUpdatedUserData(updatedUser);

        // 🔥 ส่งแจ้งเตือนเข้า LINE หากสอบ Work Permit ผ่าน
        if (type === 'WORK_PERMIT') {
          try {
            fetch('/api/notify-work-permit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: user.name,
                vendor: user.vendors?.name || 'EXTERNAL (ไม่มีสังกัด)',
                score: correctCount,
                maxScore: questions.length,
                permitNo: permitNo // ✅ เพิ่มบรรทัดนี้: ส่งเลข Work Permit ไปด้วย
              })
            }).catch(e => console.error("LINE Notification Trigger Error:", e));
          } catch (err) {
            console.error("Fail to trigger LINE API:", err);
          }
        }
      }
      
      setStep('RESULT');

    } catch (err: any) {
      console.error("Submission Error:", err);
      alert("ไม่สามารถบันทึกผลสอบได้: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const totalPages = Math.ceil(questions.length / questionsPerPage);
  const startIndex = currentPage * questionsPerPage;
  const currentQuestions = questions.slice(startIndex, startIndex + questionsPerPage);

  const handleNextPage = () => {
    if (currentPage < totalPages - 1) setCurrentPage(prev => prev + 1);
  };

  const handlePrevPage = () => {
    if (currentPage > 0) setCurrentPage(prev => prev - 1);
  };

  const isQuestionAnswered = (id: string) => answers[id] !== undefined;

  /* ================= 📖 READ STEP ================= */
  if (step === 'READ') {
    const pdfUrl = `https://qdodmxrecioltwdryhec.supabase.co/storage/v1/object/public/manuals/${type.toLowerCase()}.pdf`;
    return (
      <div className="max-w-2xl mx-auto p-4 md:p-6 animate-in slide-in-from-bottom-4 duration-500 text-left select-none">
        <button onClick={onBack} className="flex items-center gap-1.5 text-slate-400 hover:text-blue-600 mb-4 font-black text-[10px] uppercase tracking-widest transition-all">
          <ArrowLeft size={16} /> {t('common.back')}
        </button>
        <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[85vh]">
          <div className="p-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between flex-shrink-0">
            <div><h2 className="text-lg font-black text-slate-900 leading-tight">{t('user.manual')}</h2><p className="text-[10px] text-blue-600 font-bold uppercase tracking-widest mt-0.5">{type} Safety Training</p></div>
            <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="p-2 bg-white text-blue-600 hover:bg-blue-50 rounded-xl border border-slate-200 shadow-sm transition-all"><Maximize2 size={20} /></a>
          </div>
          <div className="flex-grow bg-slate-200 relative overflow-hidden">
            <iframe src={`${pdfUrl}#toolbar=0&navpanes=0&view=FitH`} className="w-full h-full border-none absolute inset-0" title="Manual Viewer" />
          </div>
          <div className="p-5 bg-white text-center space-y-4 flex-shrink-0 border-t border-slate-100 z-10">
            <label className="flex items-start gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-100 cursor-pointer active:bg-blue-50 transition-all text-left">
              <input type="checkbox" checked={hasReadManual} onChange={(e) => setHasReadManual(e.target.checked)} className="mt-1 w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 flex-shrink-0" />
              <span className="text-[11px] text-slate-600 font-bold leading-relaxed select-none">ข้าพเจ้ายืนยันว่าได้ศึกษาเนื้อหาคู่มือความปลอดภัยครบถ้วนแล้ว และพร้อมเข้าทำแบบทดสอบ</span>
            </label>
            <button disabled={!hasReadManual} onClick={() => setStep('EXAM')} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-2xl shadow-lg transition-all text-sm uppercase tracking-wider disabled:opacity-50 flex items-center justify-center gap-2 active:scale-95">
              {t('exam.start')} <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ================= 📊 RESULT STEP (แจ้งคะแนนก่อนรับบัตร) ================= */
  if (step === 'RESULT') {
    return (
      <div className="max-w-md mx-auto text-center p-8 bg-white rounded-[2.5rem] shadow-xl border border-slate-100 mt-10 animate-in zoom-in text-left select-none">
        
        {/* Icon Header */}
        <div className={`w-24 h-24 rounded-[1.5rem] flex items-center justify-center mx-auto mb-6 shadow-inner ${passed ? 'bg-emerald-50' : 'bg-red-50'}`}>
            {passed ? <Award className="w-12 h-12 text-emerald-500" /> : <AlertCircle className="w-12 h-12 text-red-500" />}
        </div>

        {/* Title */}
        <h2 className="text-2xl font-black text-slate-900 text-center mb-1">
            {passed ? 'Examination Passed' : 'Assessment Failed'}
        </h2>
        
        {/* Subtitle */}
        <p className={`font-bold text-center text-xs mb-8 uppercase tracking-widest ${passed ? 'text-emerald-500' : 'text-red-400'}`}>
            {passed ? 'You are now certified' : 'Please review and retry'}
        </p>

        {/* Score Box */}
        <div className="bg-slate-50 rounded-[2rem] p-8 mb-8 border border-slate-100 text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-slate-200 to-transparent"></div>
          <p className="text-[10px] text-slate-400 uppercase font-black tracking-[0.2em] mb-2">Total Score</p>
          <div className="text-6xl font-black text-slate-800 tracking-tighter flex items-center justify-center gap-2">
             {score} <span className="text-xl text-slate-300 font-bold">/ {questions.length}</span>
          </div>
        </div>

        {/* Action Button */}
        {passed ? (
            <button 
                onClick={() => updatedUserData && onComplete(updatedUserData)} 
                className="w-full py-4 bg-emerald-600 text-white font-black rounded-2xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 active:scale-95 flex items-center justify-center gap-2 uppercase text-xs tracking-widest"
            >
                <BadgeCheck size={18} /> รับบัตรประจำตัว (Get Card)
            </button>
        ) : (
            <button 
                onClick={() => { setStep('READ'); setCurrentPage(0); setAnswers({}); }} 
                className="w-full py-4 bg-slate-900 text-white font-black rounded-2xl hover:bg-slate-800 transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2 uppercase text-xs tracking-widest"
            >
                <RotateCcw size={16} /> สอบใหม่อีกครั้ง (Try Again)
            </button>
        )}
      </div>
    );
  }

  /* ================= 📝 EXAM STEP ================= */
  const answeredCount = Object.keys(answers).length;
  const totalQuestions = questions.length;
  const progressPercent = totalQuestions === 0 ? 0 : Math.round((answeredCount / totalQuestions) * 100);

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 animate-in slide-in-from-bottom-4 duration-500 text-left pb-32 select-none">
      
      {/* Tracker */}
      <div className="sticky top-[-1px] bg-slate-50/95 backdrop-blur-md pt-2 pb-6 mb-8 z-20 border-b border-slate-200">
        <div className="flex justify-between items-end mb-4">
          <div><h2 className="text-[11px] font-black text-slate-900 uppercase tracking-tight">Exam Module: {type}</h2><p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">{answeredCount === totalQuestions ? 'Ready for submission' : `Progress: ${answeredCount}/${totalQuestions} Completed`}</p></div>
          <div className="flex items-center gap-2"><Clock size={12} className="text-slate-300" /><span className="text-[10px] font-black text-blue-600 bg-blue-50 px-3 py-1 rounded-full border border-blue-100">{progressPercent}%</span></div>
        </div>
        <div className="flex flex-wrap gap-1 mb-4">
           {questions.map((q, qIdx) => (
             <button key={q.id} onClick={() => setCurrentPage(Math.floor(qIdx / questionsPerPage))} className={`w-6 h-6 rounded-lg flex items-center justify-center text-[8px] font-black transition-all border-2 ${isQuestionAnswered(q.id) ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm' : 'bg-white border-slate-100 text-slate-300'} ${qIdx >= startIndex && qIdx < startIndex + questionsPerPage ? 'ring-2 ring-blue-500 ring-offset-1 scale-110 z-10' : ''}`}>{qIdx + 1}</button>
           ))}
        </div>
        <div className="w-full h-1 bg-slate-200 rounded-full overflow-hidden shadow-inner"><div className={`h-full transition-all duration-700 ease-out ${progressPercent === 100 ? 'bg-emerald-500' : 'bg-blue-600'}`} style={{ width: `${progressPercent}%` }} /></div>
      </div>
      
      {type === 'WORK_PERMIT' && currentPage === 0 && (
        <div className="mb-8 p-5 bg-white rounded-2xl border-2 border-blue-100 shadow-sm text-left animate-in fade-in">
           <label className="block text-[9px] font-black uppercase text-slate-400 tracking-widest mb-2 ml-1">Work Permit Number (เลขใบอนุญาต)</label>
           <input value={permitNo} onChange={e => setPermitNo(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 font-black text-blue-600 outline-none focus:border-blue-500 focus:bg-white transition-all text-sm" placeholder="WP-XXXXX" />
        </div>
      )}

      {/* Questions List */}
      <div className="space-y-10">
        {currentQuestions.map((q, idx) => (
          <div key={q.id} className="animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                 <span className="px-2.5 py-0.5 bg-slate-900 text-white text-[9px] font-black rounded-md uppercase tracking-widest">Q {startIndex + idx + 1}</span>
                 <span className="text-[8px] font-black text-slate-300 uppercase tracking-widest">{q.pattern?.replace('_', ' ') || 'Choice'}</span>
              </div>
              {q.image_url && <div className="mb-3 rounded-xl overflow-hidden border border-slate-200 bg-white p-1 shadow-sm max-w-sm"><img src={q.image_url} alt="Reference" className="w-full max-h-48 object-contain" /></div>}
              <p className="font-bold text-slate-800 text-[15px] leading-relaxed">{language === 'th' ? q.content_th : q.content_en}</p>
            </div>

            {/* ✅ DYNAMIC RENDERER */}
            <div className="mt-4">
                {q.pattern === QuestionPattern.SHORT_ANSWER ? (
                    <input 
                      type="text" 
                      value={answers[q.id] || ''} 
                      onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} 
                      placeholder="Type answer here..." 
                      className="w-full p-4 bg-white border-2 border-slate-100 rounded-2xl font-bold text-sm focus:border-blue-500 outline-none transition-all shadow-inner" 
                    />
                ) : q.pattern === QuestionPattern.MATCHING ? (
                    <div className="space-y-3">
                        {q.choices_json.map((pair: any, pIdx: number) => (
                            <div key={pIdx} className="flex items-center gap-3">
                                <div className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-xl text-[12px] font-bold text-slate-600 truncate">{language === 'th' ? pair.left_th : pair.left_en}</div>
                                <ArrowRightLeft size={14} className="text-slate-300" />
                                <select 
                                    value={answers[q.id]?.[pIdx] ?? ""} 
                                    onChange={(e) => {
                                        const newAns = { ...(answers[q.id] || {}) };
                                        newAns[pIdx] = parseInt(e.target.value);
                                        setAnswers({ ...answers, [q.id]: newAns });
                                    }}
                                    className="flex-1 p-3 bg-white border-2 border-blue-50 rounded-xl text-[12px] font-black text-blue-600 outline-none focus:border-blue-500"
                                >
                                    <option value="">Select Match...</option>
                                    {(q as any).shuffled_right?.map((right: any) => {
                                        const originalIdx = q.choices_json.findIndex((p: any) => p.right_th === right.right_th);
                                        return <option key={originalIdx} value={originalIdx}>{language === 'th' ? right.right_th : right.right_en}</option>
                                    })}
                                </select>
                            </div>
                        ))}
                    </div>
                ) : (q.pattern === 'TRUE_FALSE' || q.pattern === QuestionPattern.TRUE_FALSE) ? ( 
                    <div className="grid grid-cols-2 gap-4">
                        {q.choices_json
                            .filter((c: any) => (c.text_th && c.text_th.trim() !== "") || (c.text_en && c.text_en.trim() !== ""))
                            .slice(0, 2)
                            .map((c: any, cIdx: number) => {
                            const isTrue = c.text_en.toLowerCase().includes('true') || c.text_th.includes('ถูก');
                            const realIndex = q.choices_json.findIndex((origin:any) => origin === c);
                            const isSelected = answers[q.id] === realIndex;
                            
                            return (
                                <button 
                                    key={realIndex} 
                                    onClick={() => setAnswers({ ...answers, [q.id]: realIndex })}
                                    className={`relative flex flex-col items-center justify-center gap-3 p-6 rounded-[2rem] border-2 transition-all active:scale-95 ${
                                        isSelected 
                                            ? (isTrue ? 'bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-200' : 'bg-red-500 border-red-500 text-white shadow-lg shadow-red-200')
                                            : 'bg-white border-slate-100 hover:border-slate-200 text-slate-400 hover:bg-slate-50'
                                    }`}
                                >
                                    {isSelected && <div className="absolute top-3 right-3"><CheckCircle2 size={16} /></div>}
                                    <div className={`p-3 rounded-2xl ${isSelected ? 'bg-white/20' : isTrue ? 'bg-emerald-50 text-emerald-500' : 'bg-red-50 text-red-500'}`}>
                                        {isTrue ? <Check size={24} /> : <XCircle size={24} />}
                                    </div>
                                    <span className={`text-xs font-black uppercase tracking-widest ${isSelected ? 'text-white' : 'text-slate-600'}`}>
                                        {language === 'th' ? c.text_th : c.text_en}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    /* Default: Multiple Choice */
                    <div className="space-y-2.5">
                      {q.choices_json.map((c: any, cIdx: number) => (
                        <label key={cIdx} className={`flex items-center gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition-all active:scale-[0.99] ${answers[q.id] === cIdx ? 'border-blue-600 bg-blue-50 shadow-sm' : 'border-slate-100 bg-white hover:border-slate-200'}`}>
                          <input type="radio" className="hidden" checked={answers[q.id] === cIdx} onChange={() => setAnswers({ ...answers, [q.id]: cIdx })} />
                          <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${answers[q.id] === cIdx ? 'border-blue-600 bg-blue-600' : 'border-slate-200'}`}>{answers[q.id] === cIdx && <div className="w-1 h-1 bg-white rounded-full" />}</div>
                          <span className={`text-[13px] font-medium leading-tight ${answers[q.id] === cIdx ? 'text-blue-700' : 'text-slate-500'}`}>{language === 'th' ? c.text_th : c.text_en}</span>
                        </label>
                      ))}
                    </div>
                )}
            </div>
          </div>
        ))}
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-4 md:p-6 bg-white/80 backdrop-blur-xl border-t border-slate-100 flex justify-center z-50">
        <div className="max-w-2xl w-full flex justify-between items-center gap-4">
          <button disabled={currentPage === 0} onClick={handlePrevPage} className={`flex items-center gap-2 px-6 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all ${currentPage === 0 ? 'opacity-0 pointer-events-none' : 'text-slate-400 hover:text-slate-800'}`}><ChevronLeft size={16} /> Back</button>
          {currentPage === totalPages - 1 ? (
            <button onClick={handleSubmit} disabled={loading || answeredCount !== totalQuestions || (type === 'WORK_PERMIT' && !permitNo)} className="flex-1 md:flex-none bg-emerald-600 hover:bg-emerald-700 text-white px-10 py-4 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-emerald-100 transition-all disabled:opacity-50 disabled:grayscale flex items-center justify-center gap-3 active:scale-95">{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Send size={16} /> Submit Exam</>}</button>
          ) : (
            <button onClick={handleNextPage} className="flex-1 md:flex-none bg-blue-600 hover:bg-blue-700 text-white px-10 py-4 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-blue-200 transition-all flex items-center justify-center gap-3 active:scale-95 group">Next Page <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform" /></button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExamSystem;