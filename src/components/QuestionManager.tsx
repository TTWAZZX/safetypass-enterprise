import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/supabaseApi';
import { supabase } from '../services/supabaseClient';
import { ExamType, Question, QuestionPattern } from '../types'; 
import { readFirstWorksheetRows } from '../services/excelImport';
import { 
  Plus, Save, Trash2, BookOpen, Ticket, Loader2, 
  Edit3, Upload, Download, X, Search, Image as ImageIcon,
  ChevronLeft, ChevronRight, RefreshCw, AlertCircle, CheckCircle2,
  ListFilter, Hash, HelpCircle, ArrowRightLeft, ChevronDown
} from 'lucide-react';
import AsyncState from './AsyncState';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useToastContext } from './ToastProvider';

const getQuestionCode = (id: string) => {
  const compactId = String(id || '').replace(/[^a-zA-Z0-9]/g, '');
  return `Q-${(compactId.slice(-6) || '000000').toUpperCase()}`;
};

const getQuestionChoices = (question: any) => Array.isArray(question?.choices_json) ? question.choices_json : [];

const getCorrectChoiceIndex = (question: any) => {
  const choices = getQuestionChoices(question);
  if (Number.isInteger(question?.correct_choice_index) && question.correct_choice_index >= 0) {
    return question.correct_choice_index;
  }
  return choices.findIndex((choice: any) => choice?.is_correct);
};

const getChoiceText = (choice: any) => choice?.text_th || choice?.text_en || 'ไม่มีข้อความตัวเลือก';

const getAnswerSummary = (question: any) => {
  const choices = getQuestionChoices(question);
  if (question.pattern === QuestionPattern.SHORT_ANSWER) {
    return choices[0]?.correct_answer || 'ยังไม่ได้ระบุเฉลย';
  }
  if (question.pattern === QuestionPattern.MATCHING) {
    return choices.length > 0 ? `${choices.length} คู่คำตอบ` : 'ยังไม่ได้ระบุคู่คำตอบ';
  }
  const correctIndex = getCorrectChoiceIndex(question);
  const correctChoice = choices[correctIndex];
  const correctText = correctChoice?.text_th || correctChoice?.text_en;
  return correctText ? `ตัวเลือก ${correctIndex + 1} — ${correctText}` : 'ยังไม่ได้ระบุเฉลย';
};

const QuestionManager: React.FC = () => {
  const { showToast } = useToastContext();
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  const [examType, setExamType] = useState<ExamType>(ExamType.INDUCTION);
  const [pattern, setPattern] = useState<QuestionPattern>(QuestionPattern.MULTIPLE_CHOICE);
  const [th, setTh] = useState('');
  const [en, setEn] = useState('');
  
  // State สำหรับ Choice / True-False
  const [choices, setChoices] = useState([
    { text_th: '', text_en: '', is_correct: true },
    { text_th: '', text_en: '', is_correct: false },
    { text_th: '', text_en: '', is_correct: false },
    { text_th: '', text_en: '', is_correct: false },
  ]);

  const [shortAnswer, setShortAnswer] = useState(''); 
  const [matchingPairs, setMatchingPairs] = useState([{ left_th: '', left_en: '', right_th: '', right_en: '' }]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [lastSavedQuestion, setLastSavedQuestion] = useState<{ id: string; savedAt: Date } | null>(null);
  const [highlightedQuestionId, setHighlightedQuestionId] = useState<string | null>(null);
  const [expandedAnswerIds, setExpandedAnswerIds] = useState<Set<string>>(() => new Set());
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const editDialogRef = useRef<HTMLElement>(null);
  const questionCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
  }, []);

  useEffect(() => {
    if (!highlightedQuestionId) return;
    const frame = window.requestAnimationFrame(() => {
      const card = questionCardRefs.current.get(highlightedQuestionId);
      if (!card) return;
      const rect = card.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > window.innerHeight) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [highlightedQuestionId, currentPage, questions]);

  useEffect(() => {
    if (!editingId) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [editingId]);

  const fetchQuestions = async (options: { showLoading?: boolean; resetPage?: boolean } = {}) => {
    const { showLoading = true, resetPage = true } = options;
    if (showLoading) setLoading(true);
    setLoadError('');
    try {
      const { data, error } = await supabase
        .from('questions')
        .select('*')
        .eq('type', examType) 
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Sanitize Data
      const sanitized = (data || []).map(q => ({
        ...q,
        pattern: q.pattern || QuestionPattern.MULTIPLE_CHOICE
      }));

      setQuestions(sanitized);
      if (resetPage) setCurrentPage(1);
    } catch (err: any) {
      console.error("Fetch Error:", err);
      setLoadError(err?.message || 'ไม่สามารถโหลดคลังข้อสอบได้');
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuestions();
  }, [examType]);

  // ================= [ HANDLERS ] =================
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setImageFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  const clearImage = () => {
    setImageFile(null);
    setPreviewUrl(null);
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const uploadImageToSupabase = async (): Promise<string | null> => {
    if (!imageFile) return previewUrl; 
    setUploadingImage(true);
    try {
      const filePath = `${Date.now()}.${imageFile.name.split('.').pop()}`;
      const { error: uploadError } = await supabase.storage.from('question-images').upload(filePath, imageFile);
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('question-images').getPublicUrl(filePath);
      return data.publicUrl;
    } catch (error) { return null; } finally { setUploadingImage(false); }
  };

  const handleEdit = (q: any) => {
    setEditingId(q.id);
    setExamType(q.type as ExamType);
    const qPattern = q.pattern || QuestionPattern.MULTIPLE_CHOICE;
    setPattern(qPattern as QuestionPattern);
    setTh(q.content_th);
    setEn(q.content_en);
    setPreviewUrl(q.image_url);

    setShortAnswer('');
    setMatchingPairs([{ left_th: '', left_en: '', right_th: '', right_en: '' }]);
    setChoices([
      { text_th: '', text_en: '', is_correct: true },
      { text_th: '', text_en: '', is_correct: false },
      { text_th: '', text_en: '', is_correct: false },
      { text_th: '', text_en: '', is_correct: false },
    ]);

    if (qPattern === QuestionPattern.SHORT_ANSWER) {
        setShortAnswer(q.choices_json?.[0]?.correct_answer || '');
    } else if (qPattern === QuestionPattern.MATCHING) {
        setMatchingPairs(q.choices_json || []);
    } else {
        const loadedChoices = q.choices_json || [];
        const fullChoices = [0,1,2,3].map(i => ({
            text_th: loadedChoices[i]?.text_th || '',
            text_en: loadedChoices[i]?.text_en || '',
            is_correct: q.correct_choice_index !== undefined ? q.correct_choice_index === i : (loadedChoices[i]?.is_correct || false)
        }));
        setChoices(fullChoices);
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setPattern(QuestionPattern.MULTIPLE_CHOICE);
    setTh(''); setEn(''); setShortAnswer('');
    setMatchingPairs([{ left_th: '', left_en: '', right_th: '', right_en: '' }]);
    setChoices([{ text_th: '', text_en: '', is_correct: true }, { text_th: '', text_en: '', is_correct: false }, { text_th: '', text_en: '', is_correct: false }, { text_th: '', text_en: '', is_correct: false }]);
    clearImage();
  };

  useDialogFocus(Boolean(editingId), editDialogRef, handleCancelEdit);

  const handleSave = async () => {
    if(!th || !en) return alert("กรุณากรอกโจทย์");
    let finalChoices: any[] = choices;
    let correctIndex = choices.findIndex(c => c.is_correct);

    if (pattern === QuestionPattern.SHORT_ANSWER) {
        finalChoices = [{ correct_answer: shortAnswer }];
        correctIndex = 0;
    } else if (pattern === QuestionPattern.MATCHING) {
        finalChoices = matchingPairs;
        correctIndex = 0;
    } else if (pattern === QuestionPattern.TRUE_FALSE) {
        // ✅ CLEAN DATA: กรองเอาเฉพาะตัวเลือกที่มีข้อความเท่านั้น เพื่อไม่ให้บันทึกช่องว่างลงไป
        finalChoices = choices.filter(c => c.text_th.trim() !== '' || c.text_en.trim() !== '');
        
        // ถ้ากรองแล้วเหลือ 0 ให้บังคับเอา 2 ช่องแรก (กัน Error)
        if (finalChoices.length === 0) finalChoices = choices.slice(0, 2);
        
        // Reset correctIndex ถ้ามันชี้ไปผิดที่
        const newCorrectIndex = finalChoices.findIndex(c => c.is_correct);
        correctIndex = newCorrectIndex !== -1 ? newCorrectIndex : 0;
        
        // Ensure only one is correct
        finalChoices = finalChoices.map((c, idx) => ({ ...c, is_correct: idx === correctIndex }));
    }

    const imageUrl = await uploadImageToSupabase();
    const payload: Partial<Question> = { 
        type: examType, 
        pattern: pattern, 
        content_th: th, 
        content_en: en, 
        choices_json: finalChoices, 
        correct_choice_index: correctIndex, 
        image_url: imageUrl, 
        is_active: true 
    };

    try {
      const wasEditing = Boolean(editingId);
      const savedId = editingId
        ? await api.updateQuestion(editingId, payload)
        : await api.createQuestion(payload);
      handleCancelEdit();
      if (!wasEditing) setCurrentPage(1);
      await fetchQuestions({ showLoading: false, resetPage: !wasEditing });
      setLastSavedQuestion({ id: savedId, savedAt: new Date() });
      setHighlightedQuestionId(savedId);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => setHighlightedQuestionId(null), 5000);
      showToast(`บันทึกคำถาม ${getQuestionCode(savedId)} สำเร็จ`, 'success');
    } catch (err: any) {
      showToast(`บันทึกคำถามไม่สำเร็จ: ${err.message}`, 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if(!window.confirm("ต้องการลบข้อสอบนี้ใช่หรือไม่?")) return;
    await api.deleteQuestion(id);
    fetchQuestions();
  };

  const handleToggleActive = async (question: any) => {
    try {
      await api.updateQuestion(question.id, { ...question, is_active: !question.is_active });
      fetchQuestions();
    } catch (error: any) {
      alert('เปลี่ยนสถานะไม่สำเร็จ: ' + error.message);
    }
  };

  const handleQuestionImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const rows = await readFirstWorksheetRows(file);
      let imported = 0;
      for (const row of rows) {
        const value = (names: string[]) => {
          const key = Object.keys(row).find((item) => names.includes(item.trim().toLowerCase()));
          return key ? String(row[key] ?? '').trim() : '';
        };
        const contentTh = value(['question th', 'question_th', 'คำถามภาษาไทย', 'คำถาม']);
        const contentEn = value(['question en', 'question_en', 'คำถามภาษาอังกฤษ']);
        if (!contentTh || !contentEn) continue;
        const importedPattern = (value(['pattern', 'รูปแบบ']) || 'MULTIPLE_CHOICE').toUpperCase() as QuestionPattern;
        const importedType = (value(['type', 'exam type', 'ประเภทข้อสอบ']) || examType).toUpperCase();
        const correct = Math.max(0, Number(value(['correct choice', 'correct_choice_index', 'คำตอบที่ถูก'])) - 1 || 0);
        const importedChoices = [1, 2, 3, 4].map((index) => ({
          text_th: value([`choice ${index} th`, `choice_${index}_th`, `ตัวเลือก ${index} ไทย`]),
          text_en: value([`choice ${index} en`, `choice_${index}_en`, `ตัวเลือก ${index} อังกฤษ`]),
          is_correct: index - 1 === correct,
        })).filter((choice) => choice.text_th || choice.text_en);
        await api.createQuestion({
          type: importedType as any,
          pattern: importedPattern,
          content_th: contentTh,
          content_en: contentEn,
          choices_json: importedPattern === QuestionPattern.SHORT_ANSWER
            ? [{ correct_answer: value(['correct answer', 'คำตอบ']) }]
            : importedChoices,
          correct_choice_index: correct,
          image_url: null,
          is_active: true,
        });
        imported++;
      }
      alert(`นำเข้าข้อสอบสำเร็จ ${imported} ข้อ`);
      fetchQuestions();
    } catch (error: any) {
      alert('นำเข้าไม่สำเร็จ: ' + error.message);
    }
  };

  // ================= [ RENDER ] =================
  const filteredQuestions = questions.filter(q => q.content_th.toLowerCase().includes(searchTerm.toLowerCase()) || q.content_en.toLowerCase().includes(searchTerm.toLowerCase()));
  const totalPages = Math.ceil(filteredQuestions.length / itemsPerPage);
  const currentQuestions = filteredQuestions.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="space-y-8 pb-10 text-left">
      
      {/* 🟢 Form Section — edit mode reuses the same form inside an accessible modal. */}
      <div
        className={editingId ? 'fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm' : ''}
        onMouseDown={(event) => { if (editingId && event.target === event.currentTarget) handleCancelEdit(); }}
      >
      <section
        id={editingId ? 'question-edit-dialog' : undefined}
        ref={editDialogRef}
        role={editingId ? 'dialog' : undefined}
        aria-modal={editingId ? true : undefined}
        aria-labelledby={editingId ? 'question-editor-title' : undefined}
        tabIndex={editingId ? -1 : undefined}
        className={`p-6 md:p-8 rounded-[2rem] border-2 transition-all focus:outline-none ${editingId ? 'w-full max-w-6xl max-h-[calc(100vh-2rem)] overflow-y-auto bg-white border-amber-200 shadow-2xl' : 'bg-white border-slate-100 shadow-sm'}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${editingId ? 'bg-amber-100 text-amber-800' : 'bg-blue-600 text-white'}`}>{editingId ? <Edit3 size={20} /> : <Plus size={20} />}</div>
            <div><h3 id="question-editor-title" className="text-lg font-black text-slate-900 uppercase leading-none">{editingId ? 'Edit Question' : 'Create Question'}</h3></div>
          </div>
          {editingId && <button onClick={handleCancelEdit} aria-label="ยกเลิกการแก้ไขข้อสอบ" className="min-h-11 min-w-11 p-2 bg-white text-slate-600 hover:text-red-700 rounded-full border border-slate-200"><X size={18}/></button>}
        </div>

        <div className="flex flex-wrap bg-slate-100 p-1.5 rounded-2xl mb-8 gap-1">
            <PatternTab active={pattern === QuestionPattern.MULTIPLE_CHOICE} onClick={() => setPattern(QuestionPattern.MULTIPLE_CHOICE)} icon={<ListFilter size={14}/>} label="Choice" />
            <PatternTab active={pattern === QuestionPattern.TRUE_FALSE} onClick={() => setPattern(QuestionPattern.TRUE_FALSE)} icon={<HelpCircle size={14}/>} label="T/F" />
            <PatternTab active={pattern === QuestionPattern.MATCHING} onClick={() => setPattern(QuestionPattern.MATCHING)} icon={<ArrowRightLeft size={14}/>} label="Matching" />
            <PatternTab active={pattern === QuestionPattern.SHORT_ANSWER} onClick={() => setPattern(QuestionPattern.SHORT_ANSWER)} icon={<Hash size={14}/>} label="Writing" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-4">
                <div role="button" tabIndex={0} aria-label="เลือกรูปประกอบข้อสอบ" className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl p-5 text-center cursor-pointer relative overflow-hidden group hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500" onClick={() => imageInputRef.current?.click()} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); imageInputRef.current?.click(); } }}>
                    <input type="file" ref={imageInputRef} className="hidden" accept="image/*" onChange={handleImageChange} />
                    {previewUrl ? <div className="relative"><img src={previewUrl} alt="รูปประกอบข้อสอบ" className="h-44 mx-auto rounded-2xl object-contain shadow-lg bg-white" /><button onClick={(e) => { e.stopPropagation(); clearImage(); }} aria-label="ลบรูปประกอบข้อสอบ" className="absolute -top-2 -right-2 min-h-11 min-w-11 bg-red-700 text-white p-1 rounded-full border-2 border-white"><X size={14}/></button></div> : <div className="py-10 text-slate-600 flex flex-col items-center gap-2 group-hover:text-blue-700"><ImageIcon size={32}/><span className="text-[10px] font-black uppercase tracking-widest">Media Assets</span></div>}
                </div>
                <div className="space-y-2">
                    <label htmlFor="question-content-th" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">Question (Thai)</label>
                    <input id="question-content-th" placeholder="โจทย์ภาษาไทย" value={th} onChange={e=>setTh(e.target.value)} className="w-full p-4 border border-slate-200 rounded-2xl text-base md:text-sm font-bold bg-white outline-none focus:border-blue-500" />
                </div>
                <div className="space-y-2">
                    <label htmlFor="question-content-en" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">Question (English)</label>
                    <input id="question-content-en" placeholder="Question in English" value={en} onChange={e=>setEn(e.target.value)} className="w-full p-4 border border-slate-200 rounded-2xl text-base md:text-sm font-bold bg-white outline-none focus:border-blue-500" />
                </div>
                <div className="flex bg-slate-100 p-1.5 rounded-2xl">
                    <button onClick={() => setExamType(ExamType.INDUCTION)} className={`min-h-11 flex-1 py-3 rounded-xl font-black text-[10px] transition-all ${examType === ExamType.INDUCTION ? 'bg-blue-700 text-white shadow-md' : 'text-slate-600 hover:text-slate-800'}`}>INDUCTION</button>
                    <button onClick={() => setExamType(ExamType.WORK_PERMIT)} className={`min-h-11 flex-1 py-3 rounded-xl font-black text-[10px] transition-all ${examType === ExamType.WORK_PERMIT ? 'bg-purple-700 text-white shadow-md' : 'text-slate-600 hover:text-slate-800'}`}>WORK PERMIT</button>
                    <button onClick={() => setExamType(ExamType.SUPPLIER_OUTSOURCE)} className={`min-h-11 flex-1 py-3 rounded-xl font-black text-[9px] transition-all ${examType === ExamType.SUPPLIER_OUTSOURCE ? 'bg-emerald-700 text-white shadow-md' : 'text-slate-600 hover:text-slate-800'}`}>SUPPLIER & OUTSOURCE</button>
                </div>
            </div>
            <div className="space-y-4">
                {(pattern === QuestionPattern.MULTIPLE_CHOICE || pattern === QuestionPattern.TRUE_FALSE) && (
                    <div className="space-y-2">
                        {/* ✅ UI: แสดงช่องกรอก 2 หรือ 4 ช่อง ตามประเภท */}
                        {(pattern === QuestionPattern.TRUE_FALSE ? choices.slice(0, 2) : choices).map((c, idx) => (
                            <div key={idx} className={`flex gap-3 items-center p-3 rounded-2xl border-2 transition-all ${c.is_correct ? 'border-emerald-500 bg-emerald-50' : 'border-slate-50 bg-slate-50'}`}>
                                <input type="radio" name="correct_choice" aria-label={`กำหนดตัวเลือก ${idx + 1} เป็นคำตอบที่ถูกต้อง`} checked={c.is_correct} onChange={() => { const n = choices.map(ch => ({ ...ch, is_correct: false })); n[idx].is_correct = true; setChoices(n); }} className="w-5 h-5 text-emerald-700 cursor-pointer" />
                                <div className="flex-1 space-y-1">
                                    <input placeholder="ตัวเลือก (ไทย)" value={c.text_th} onChange={e => { const n = [...choices]; n[idx].text_th = e.target.value; setChoices(n); }} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-[11px] font-bold outline-none" />
                                    <input placeholder="Choice (English)" value={c.text_en} onChange={e => { const n = [...choices]; n[idx].text_en = e.target.value; setChoices(n); }} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-[11px] font-bold outline-none" />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {pattern === QuestionPattern.SHORT_ANSWER && <div className="p-6 bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200 text-center"><label htmlFor="question-short-answer" className="text-[9px] font-black text-slate-600 uppercase mb-2 block tracking-widest">Correct Answer</label><input id="question-short-answer" value={shortAnswer} onChange={e => setShortAnswer(e.target.value)} placeholder="เฉลย..." className="w-full p-4 border border-slate-200 rounded-2xl text-sm font-black text-blue-700 shadow-inner outline-none text-center" /></div>}
                {pattern === QuestionPattern.MATCHING && <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">{matchingPairs.map((pair, idx) => (<div key={idx} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 relative"><div className="grid grid-cols-2 gap-3"><div className="space-y-1"><span className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Left</span><input aria-label={`คู่จับคู่ ${idx + 1} ฝั่งซ้ายภาษาไทย`} value={pair.left_th} onChange={e => { const n = [...matchingPairs]; n[idx].left_th = e.target.value; setMatchingPairs(n); }} className="w-full p-2 border border-slate-200 rounded-lg text-[10px]" /><input aria-label={`คู่จับคู่ ${idx + 1} ฝั่งซ้ายภาษาอังกฤษ`} value={pair.left_en} onChange={e => { const n = [...matchingPairs]; n[idx].left_en = e.target.value; setMatchingPairs(n); }} className="w-full p-2 border border-slate-200 rounded-lg text-[10px]" /></div><div className="space-y-1"><span className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Right</span><input aria-label={`คู่จับคู่ ${idx + 1} ฝั่งขวาภาษาไทย`} value={pair.right_th} onChange={e => { const n = [...matchingPairs]; n[idx].right_th = e.target.value; setMatchingPairs(n); }} className="w-full p-2 border border-slate-200 rounded-lg text-[10px]" /><input aria-label={`คู่จับคู่ ${idx + 1} ฝั่งขวาภาษาอังกฤษ`} value={pair.right_en} onChange={e => { const n = [...matchingPairs]; n[idx].right_en = e.target.value; setMatchingPairs(n); }} className="w-full p-2 border border-slate-200 rounded-lg text-[10px]" /></div></div>{matchingPairs.length > 1 && <button onClick={() => setMatchingPairs(matchingPairs.filter((_, i) => i !== idx))} aria-label={`ลบคู่จับคู่ลำดับ ${idx + 1}`} className="absolute -top-1 -right-1 min-h-11 min-w-11 bg-red-100 text-red-700 p-1 rounded-full"><X size={10}/></button>}</div>))}<button onClick={() => setMatchingPairs([...matchingPairs, { left_th: '', left_en: '', right_th: '', right_en: '' }])} className="min-h-11 w-full py-2 border-2 border-dashed border-slate-300 text-slate-600 text-[10px] font-black rounded-xl hover:bg-slate-50 uppercase tracking-widest">Add +</button></div>}
            </div>
        </div>
        <button onClick={handleSave} disabled={uploadingImage} className={`${editingId ? 'sticky bottom-0 z-20 mt-8 w-full' : 'mt-8 w-full md:w-auto'} bg-slate-900 text-white px-12 py-4 rounded-2xl font-black uppercase text-xs shadow-xl active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 hover:bg-slate-800`}>
            {uploadingImage ? <Loader2 className="animate-spin" size={16}/> : <Save size={16}/>} {uploadingImage ? 'Uploading Assets...' : editingId ? 'Update Question' : 'Deploy Question'}
        </button>
      </section>
      </div>

      {/* 🔵 Master Repository List */}
      <div className="bg-white p-6 md:p-8 rounded-[2rem] border border-slate-100 shadow-sm min-h-[500px]">
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
            <div className="text-left">
              <h3 className="text-xl font-black text-slate-900 uppercase">Master Repository</h3>
              <div className="text-[10px] text-slate-600 font-black uppercase tracking-widest flex items-center gap-2 mt-1">
                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" /> Element Count: {filteredQuestions.length}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 w-full md:w-auto">
                <div className="relative flex-1"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input placeholder="Search keywords..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none w-full" /></div>
                <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={handleQuestionImport} />
                <button onClick={() => fileInputRef.current?.click()} className="flex min-h-11 items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-[9px] font-black uppercase tracking-widest text-emerald-700"><Upload size={16}/> Import</button>
                <button onClick={() => fetchQuestions()} aria-label="รีเฟรชคลังข้อสอบ" className="min-h-11 min-w-11 p-2.5 bg-slate-50 text-slate-400 rounded-xl hover:text-blue-600 transition-all border border-slate-100 shadow-sm"><RefreshCw size={18}/></button>
            </div>
        </div>
        
        {loading ? <AsyncState compact variant="loading" title="กำลังโหลดคลังข้อสอบ" /> : loadError ? <AsyncState compact variant="error" title="โหลดคลังข้อสอบไม่สำเร็จ" description={loadError} onRetry={() => fetchQuestions()} /> : (
            <div className="grid grid-cols-1 gap-4">
                {currentQuestions.map((q) => {
                  const questionCode = getQuestionCode(q.id);
                  const isLastSaved = lastSavedQuestion?.id === q.id;
                  const isHighlighted = highlightedQuestionId === q.id;
                  const isAnswerExpanded = expandedAnswerIds.has(q.id);
                  const choices = getQuestionChoices(q);
                  const answerSummary = getAnswerSummary(q);
                  const hasAnswer = !answerSummary.startsWith('ยังไม่ได้ระบุ');

                  return (
                    <div
                      key={q.id}
                      id={`question-card-${q.id}`}
                      ref={(element) => {
                        if (element) questionCardRefs.current.set(q.id, element);
                        else questionCardRefs.current.delete(q.id);
                      }}
                      className={`p-4 md:p-5 border-2 rounded-3xl flex flex-col md:flex-row gap-5 items-start group transition-all duration-500 ${
                        isHighlighted
                          ? 'border-emerald-500 bg-emerald-50 shadow-lg shadow-emerald-100 ring-4 ring-emerald-100'
                          : editingId === q.id
                            ? 'border-amber-400 bg-amber-50/10'
                            : 'border-slate-100 hover:border-blue-100 hover:shadow-lg'
                      }`}
                    >
                        <div className="w-full md:w-28 h-28 flex-shrink-0 relative">
                            {q.image_url ? <img src={q.image_url} alt={`รูปประกอบคำถาม ${questionCode}`} className="w-full h-full object-cover rounded-2xl bg-slate-50 border border-slate-100 shadow-inner" /> : <div className="w-full h-full bg-slate-50 rounded-2xl flex items-center justify-center text-slate-300 border border-slate-100 shadow-sm"><ImageIcon size={24}/></div>}
                            <div className="absolute top-1.5 left-1.5 px-2 py-0.5 bg-slate-900/80 text-white text-[6px] font-black rounded uppercase tracking-tighter shadow-md border border-white/20">{q.pattern?.replace('_', ' ')}</div>
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                            <div className="flex flex-wrap justify-between items-start gap-2 mb-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="px-2.5 py-1 rounded-md text-[9px] font-black text-slate-700 border border-slate-200 bg-slate-50" title={`รหัสคำถาม ${q.id}`}>{questionCode}</span>
                                  <span className={`px-2 py-1 rounded-md text-[8px] font-black border ${q.type === 'INDUCTION' ? 'text-blue-700 border-blue-100 bg-blue-50' : q.type === 'WORK_PERMIT' ? 'text-purple-700 border-purple-100 bg-purple-50' : 'text-emerald-800 border-emerald-100 bg-emerald-50'}`}>{q.type}</span>
                                  {isLastSaved && (
                                    <span
                                      role="status"
                                      className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-1 text-[9px] font-black text-emerald-800"
                                      title={`บันทึกเมื่อ ${lastSavedQuestion.savedAt.toLocaleTimeString('th-TH')}`}
                                    >
                                      <CheckCircle2 size={12} /> บันทึกแล้ว • เมื่อสักครู่
                                    </span>
                                  )}
                                </div>
                                <div className="flex gap-1">
                                    <button onClick={() => handleToggleActive(q)} aria-label={`${q.is_active ? 'ปิด' : 'เปิด'}การใช้งานข้อสอบ`} className={`min-h-11 min-w-11 rounded-lg px-2 text-[8px] font-black ${q.is_active ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{q.is_active ? 'ON' : 'OFF'}</button>
                                    <button onClick={() => handleEdit(q)} aria-label={`แก้ไขคำถาม ${questionCode}`} className="min-h-11 min-w-11 p-3 text-slate-600 hover:text-blue-700 transition-colors active:scale-90"><Edit3 size={16}/></button>
                                    <button onClick={() => handleDelete(q.id)} aria-label={`ลบคำถาม ${questionCode}`} className="min-h-11 min-w-11 p-3 text-slate-600 hover:text-red-700 transition-colors active:scale-90"><Trash2 size={16}/></button>
                                </div>
                            </div>
                            <h4 className="font-black text-slate-800 text-sm leading-relaxed">{q.content_th}</h4>
                            <p className="text-[10px] text-slate-600 italic leading-relaxed mb-4">{q.content_en}</p>
                            <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100">
                                <span className="text-[9px] font-black text-slate-700 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-200">
                                  {q.pattern === QuestionPattern.MATCHING ? `${choices.length} คู่จับคู่` : q.pattern === QuestionPattern.SHORT_ANSWER ? 'คำตอบแบบเขียน' : `${choices.length} ตัวเลือก`}
                                </span>
                                <span className={`max-w-full truncate text-[9px] font-black px-3 py-1.5 rounded-full border ${hasAnswer ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : 'text-amber-800 bg-amber-50 border-amber-200'}`} title={answerSummary}>
                                  เฉลย: {answerSummary}
                                </span>
                                <button
                                  type="button"
                                  aria-expanded={isAnswerExpanded}
                                  aria-controls={`question-answer-${q.id}`}
                                  onClick={() => setExpandedAnswerIds((previous) => {
                                    const next = new Set(previous);
                                    if (next.has(q.id)) next.delete(q.id);
                                    else next.add(q.id);
                                    return next;
                                  })}
                                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[9px] font-black text-blue-700 hover:bg-blue-100"
                                >
                                  {isAnswerExpanded ? 'ซ่อนตัวเลือกและเฉลย' : 'ดูตัวเลือกและเฉลย'}
                                  <ChevronDown size={14} className={`transition-transform ${isAnswerExpanded ? 'rotate-180' : ''}`} />
                                </button>
                            </div>
                            {isAnswerExpanded && <QuestionAnswerDetails question={q} />}
                        </div>
                    </div>
                  );
                })}
                {filteredQuestions.length === 0 && <AsyncState compact variant="empty" title="ไม่พบข้อสอบ" description={searchTerm ? 'ลองเปลี่ยนคำค้นหา หรือเลือกหลักสูตรอื่น' : 'กดสร้างข้อสอบหรือนำเข้าไฟล์ Excel เพื่อเริ่มต้น'} />}
                {totalPages > 1 && (
                    <div className="flex justify-center items-center gap-4 mt-8 pt-6 border-t border-slate-50">
                        <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} aria-label="หน้าก่อนหน้า" className="min-h-11 min-w-11 p-2 bg-slate-50 rounded-xl hover:bg-slate-100 disabled:opacity-20 transition-all"><ChevronLeft size={20}/></button>
                        <span className="text-[10px] font-black text-slate-900 uppercase tracking-tighter shadow-sm bg-white px-4 py-2 rounded-xl border border-slate-100">Page {currentPage} / {totalPages}</span>
                        <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} aria-label="หน้าถัดไป" className="min-h-11 min-w-11 p-2 bg-slate-50 rounded-xl hover:bg-slate-100 disabled:opacity-20 transition-all"><ChevronRight size={20}/></button>
                    </div>
                )}
            </div>
        )}
      </div>
    </div>
  );
};

const QuestionAnswerDetails = ({ question }: { question: any }) => {
  const choices = getQuestionChoices(question);

  if (question.pattern === QuestionPattern.SHORT_ANSWER) {
    return (
      <div id={`question-answer-${question.id}`} className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
        <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-blue-700">คำตอบที่ถูกต้อง</p>
        <p className="text-sm font-bold text-slate-800">{choices[0]?.correct_answer || 'ยังไม่ได้ระบุเฉลย'}</p>
      </div>
    );
  }

  if (question.pattern === QuestionPattern.MATCHING) {
    return (
      <div id={`question-answer-${question.id}`} className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="mb-3 text-[9px] font-black uppercase tracking-widest text-slate-600">คู่คำตอบที่ถูกต้อง</p>
        {choices.length > 0 ? (
          <ol className="space-y-2">
            {choices.map((pair: any, index: number) => {
              const leftTh = pair?.left_th || pair?.left_text_th || '-';
              const rightTh = pair?.right_th || pair?.right_text_th || '-';
              const leftEn = pair?.left_en || pair?.left_text_en || '';
              const rightEn = pair?.right_en || pair?.right_text_en || '';
              return (
                <li key={`${question.id}-pair-${index}`} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-center gap-2 text-xs font-black text-slate-800">
                    <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-blue-100 text-[9px] text-blue-700">{index + 1}</span>
                    <span>{leftTh}</span><ArrowRightLeft size={13} className="flex-none text-emerald-700"/><span>{rightTh}</span>
                  </div>
                  {(leftEn || rightEn) && <p className="mt-1 pl-8 text-[10px] italic text-slate-600">{leftEn || '-'} ↔ {rightEn || '-'}</p>}
                </li>
              );
            })}
          </ol>
        ) : <p className="text-xs font-bold text-amber-800">ยังไม่ได้ระบุคู่คำตอบ</p>}
      </div>
    );
  }

  const correctIndex = getCorrectChoiceIndex(question);
  return (
    <div id={`question-answer-${question.id}`} className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="mb-3 text-[9px] font-black uppercase tracking-widest text-slate-600">ตัวเลือกและเฉลย</p>
      {choices.length > 0 ? (
        <ol className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {choices.map((choice: any, index: number) => {
            const isCorrect = index === correctIndex;
            return (
              <li key={`${question.id}-choice-${index}`} className={`rounded-xl border p-3 ${isCorrect ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
                <div className="flex items-start gap-2">
                  <span className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-[9px] font-black ${isCorrect ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700'}`}>{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-800">{choice?.text_th || 'ไม่มีข้อความภาษาไทย'}</p>
                    {choice?.text_en && <p className="mt-0.5 text-[10px] italic text-slate-600">{choice.text_en}</p>}
                  </div>
                  {isCorrect && <span className="inline-flex flex-none items-center gap-1 text-[9px] font-black text-emerald-800"><CheckCircle2 size={14}/> เฉลย</span>}
                </div>
              </li>
            );
          })}
        </ol>
      ) : <p className="text-xs font-bold text-amber-800">ยังไม่มีตัวเลือกและเฉลย</p>}
    </div>
  );
};

const PatternTab = ({ active, onClick, icon, label }: any) => (
    <button onClick={onClick} className={`min-h-11 flex-1 flex items-center justify-center gap-2 py-3.5 px-2 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all border ${active ? 'bg-white text-blue-700 shadow-sm border-slate-200' : 'text-slate-600 hover:text-slate-800 border-transparent'}`}>
        {icon} <span className="hidden sm:inline">{label}</span>
    </button>
);

export default QuestionManager;
