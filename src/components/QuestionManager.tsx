import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/supabaseApi';
import { supabase } from '../services/supabaseClient';
import * as XLSX from 'xlsx';
import { QuestionPattern } from '../types'; 
import { 
  Plus, Save, Trash2, BookOpen, Ticket, Loader2, 
  Edit3, Upload, Download, X, Search, Image as ImageIcon,
  ChevronLeft, ChevronRight, RefreshCw, AlertCircle, CheckCircle2,
  ListFilter, Hash, HelpCircle, ArrowRightLeft
} from 'lucide-react';

const QuestionManager: React.FC = () => {
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  const [examType, setExamType] = useState('INDUCTION');
  const [pattern, setPattern] = useState<QuestionPattern>(QuestionPattern.MULTIPLE_CHOICE);
  const [th, setTh] = useState('');
  const [en, setEn] = useState('');
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
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // ✅ ปรับปรุงการ Fetch: ป้องกันการกรองข้อมูลพลาด
  const fetchQuestions = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('questions')
        .select('*')
        .eq('type', examType) 
        .order('created_at', { ascending: false });

      if (error) throw error;

      // ทำความสะอาดข้อมูลก่อนแสดงผล (Sanitize)
      const sanitized = (data || []).map(q => ({
        ...q,
        pattern: q.pattern || QuestionPattern.MULTIPLE_CHOICE
      }));

      setQuestions(sanitized);
      setCurrentPage(1);
    } catch (err) {
      console.error("Fetch Error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuestions();
  }, [examType]);

  // ================= [ HANDLERS (เหมือนเดิมครบถ้วน) ] =================
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
    setExamType(q.type);
    const qPattern = q.pattern || QuestionPattern.MULTIPLE_CHOICE;
    setPattern(qPattern as QuestionPattern);
    setTh(q.content_th);
    setEn(q.content_en);
    setPreviewUrl(q.image_url);
    if (qPattern === QuestionPattern.SHORT_ANSWER) {
        setShortAnswer(q.choices_json?.[0]?.correct_answer || '');
    } else if (qPattern === QuestionPattern.MATCHING) {
        setMatchingPairs(q.choices_json || []);
    } else {
        setChoices(q.choices_json.map((c: any, idx: number) => ({
          text_th: c.text_th, text_en: c.text_en,
          is_correct: q.correct_choice_index !== undefined ? q.correct_choice_index === idx : c.is_correct
        })));
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setPattern(QuestionPattern.MULTIPLE_CHOICE);
    setTh(''); setEn(''); setShortAnswer('');
    setMatchingPairs([{ left_th: '', left_en: '', right_th: '', right_en: '' }]);
    setChoices([{ text_th: '', text_en: '', is_correct: true }, { text_th: '', text_en: '', is_correct: false }, { text_th: '', text_en: '', is_correct: false }, { text_th: '', text_en: '', is_correct: false }]);
    clearImage();
  };

  const handleSave = async () => {
    if(!th || !en) return alert("กรุณากรอกโจทย์");
    let finalChoices = choices;
    let correctIndex = choices.findIndex(c => c.is_correct);

    if (pattern === QuestionPattern.SHORT_ANSWER) {
        finalChoices = [{ correct_answer: shortAnswer }];
        correctIndex = 0;
    } else if (pattern === QuestionPattern.MATCHING) {
        finalChoices = matchingPairs;
        correctIndex = 0;
    }

    const imageUrl = await uploadImageToSupabase();
    const payload = { 
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
      const { error } = editingId ? await supabase.from('questions').update(payload).eq('id', editingId) : await supabase.from('questions').insert(payload);
      if(error) throw error;
      alert("สำเร็จ!");
      handleCancelEdit();
      fetchQuestions();
    } catch (err: any) { alert("Error: " + err.message); }
  };

  const handleDelete = async (id: string) => {
    if(!window.confirm("ลบข้อสอบนี้?")) return;
    await supabase.from('questions').delete().eq('id', id);
    fetchQuestions();
  };

  // ================= [ RENDER ] =================
  const filteredQuestions = questions.filter(q => q.content_th.toLowerCase().includes(searchTerm.toLowerCase()) || q.content_en.toLowerCase().includes(searchTerm.toLowerCase()));
  const totalPages = Math.ceil(filteredQuestions.length / itemsPerPage);
  const currentQuestions = filteredQuestions.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="space-y-8 pb-10 text-left">
      {/* 🟢 Form Section (คงเดิม) */}
      <div className={`p-6 md:p-8 rounded-[2rem] border-2 transition-all ${editingId ? 'bg-amber-50/30 border-amber-200' : 'bg-white border-slate-100 shadow-sm'}`}>
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${editingId ? 'bg-amber-100 text-amber-600' : 'bg-blue-600 text-white'}`}>{editingId ? <Edit3 size={20} /> : <Plus size={20} />}</div>
            <div><h3 className="text-lg font-black text-slate-900 uppercase leading-none">Assessment Designer</h3></div>
          </div>
          {editingId && <button onClick={handleCancelEdit} className="p-2 bg-white text-slate-400 hover:text-red-500 rounded-full border border-slate-200"><X size={18}/></button>}
        </div>

        <div className="flex flex-wrap bg-slate-100 p-1.5 rounded-2xl mb-8 gap-1">
            <PatternTab active={pattern === QuestionPattern.MULTIPLE_CHOICE} onClick={() => setPattern(QuestionPattern.MULTIPLE_CHOICE)} icon={<ListFilter size={14}/>} label="Choice" />
            <PatternTab active={pattern === QuestionPattern.TRUE_FALSE} onClick={() => setPattern(QuestionPattern.TRUE_FALSE)} icon={<HelpCircle size={14}/>} label="T/F" />
            <PatternTab active={pattern === QuestionPattern.MATCHING} onClick={() => setPattern(QuestionPattern.MATCHING)} icon={<ArrowRightLeft size={14}/>} label="Matching" />
            <PatternTab active={pattern === QuestionPattern.SHORT_ANSWER} onClick={() => setPattern(QuestionPattern.SHORT_ANSWER)} icon={<Hash size={14}/>} label="Writing" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-4">
                <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl p-5 text-center cursor-pointer relative overflow-hidden" onClick={() => imageInputRef.current?.click()}>
                    <input type="file" ref={imageInputRef} className="hidden" accept="image/*" onChange={handleImageChange} />
                    {previewUrl ? <div className="relative"><img src={previewUrl} className="h-44 mx-auto rounded-2xl object-contain shadow-lg bg-white" /><button onClick={(e) => { e.stopPropagation(); clearImage(); }} className="absolute -top-2 -right-2 bg-red-500 text-white p-1 rounded-full border-2 border-white"><X size={14}/></button></div> : <div className="py-10 text-slate-300 flex flex-col items-center gap-2"><ImageIcon size={32}/><span className="text-[10px] font-black uppercase tracking-widest">Media Assets</span></div>}
                </div>
                <input placeholder="โจทย์ไทย" value={th} onChange={e=>setTh(e.target.value)} className="w-full p-4 border border-slate-200 rounded-2xl text-sm font-bold bg-white outline-none focus:border-blue-500" />
                <input placeholder="English" value={en} onChange={e=>setEn(e.target.value)} className="w-full p-4 border border-slate-200 rounded-2xl text-sm font-bold bg-white outline-none focus:border-blue-500" />
                <div className="flex bg-slate-100 p-1.5 rounded-2xl">
                    <button onClick={() => setExamType('INDUCTION')} className={`flex-1 py-3 rounded-xl font-black text-[10px] transition-all ${examType === 'INDUCTION' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400'}`}>INDUCTION</button>
                    <button onClick={() => setExamType('WORK_PERMIT')} className={`flex-1 py-3 rounded-xl font-black text-[10px] transition-all ${examType === 'WORK_PERMIT' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400'}`}>WORK PERMIT</button>
                </div>
            </div>
            <div className="space-y-4">
                {(pattern === QuestionPattern.MULTIPLE_CHOICE || pattern === QuestionPattern.TRUE_FALSE) && (
                    <div className="space-y-2">
                        {(pattern === QuestionPattern.TRUE_FALSE ? choices.slice(0, 2) : choices).map((c, idx) => (
                            <div key={idx} className={`flex gap-3 items-center p-3 rounded-2xl border-2 transition-all ${c.is_correct ? 'border-emerald-500 bg-emerald-50' : 'border-slate-50 bg-slate-50'}`}>
                                <input type="radio" name="correct_choice" checked={c.is_correct} onChange={() => { const n = choices.map(ch => ({ ...ch, is_correct: false })); n[idx].is_correct = true; setChoices(n); }} className="w-5 h-5 text-emerald-600 cursor-pointer" />
                                <div className="flex-1 space-y-1"><input placeholder="ไทย" value={c.text_th} onChange={e => { const n = [...choices]; n[idx].text_th = e.target.value; setChoices(n); }} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-[11px] font-bold outline-none" /><input placeholder="English" value={c.text_en} onChange={e => { const n = [...choices]; n[idx].text_en = e.target.value; setChoices(n); }} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-[11px] font-bold outline-none" /></div>
                            </div>
                        ))}
                    </div>
                )}
                {pattern === QuestionPattern.SHORT_ANSWER && <div className="p-6 bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200 text-center"><label className="text-[9px] font-black text-slate-400 uppercase mb-2 block tracking-widest">Correct Answer</label><input value={shortAnswer} onChange={e => setShortAnswer(e.target.value)} placeholder="เฉลย..." className="w-full p-4 border border-slate-200 rounded-2xl text-sm font-black text-blue-600 shadow-inner outline-none text-center" /></div>}
                {pattern === QuestionPattern.MATCHING && <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">{matchingPairs.map((pair, idx) => (<div key={idx} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 relative"><div className="grid grid-cols-2 gap-3"><div className="space-y-1"><span className="text-[8px] font-black opacity-30 uppercase tracking-widest">Left</span><input value={pair.left_th} onChange={e => { const n = [...matchingPairs]; n[idx].left_th = e.target.value; setMatchingPairs(n); }} className="w-full p-2 border border-slate-200 rounded-lg text-[10px]" /><input value={pair.left_en} onChange={e => { const n = [...matchingPairs]; n[idx].left_en = e.target.value; setMatchingPairs(n); }} className="w-full p-2 border border-slate-200 rounded-lg text-[10px]" /></div><div className="space-y-1"><span className="text-[8px] font-black opacity-30 uppercase tracking-widest">Right</span><input value={pair.right_th} onChange={e => { const n = [...matchingPairs]; n[idx].right_th = e.target.value; setMatchingPairs(n); }} className="w-full p-2 border border-slate-200 rounded-lg text-[10px]" /><input value={pair.right_en} onChange={e => { const n = [...matchingPairs]; n[idx].right_en = e.target.value; setMatchingPairs(n); }} className="w-full p-2 border border-slate-200 rounded-lg text-[10px]" /></div></div>{matchingPairs.length > 1 && <button onClick={() => setMatchingPairs(matchingPairs.filter((_, i) => i !== idx))} className="absolute -top-1 -right-1 bg-red-100 text-red-500 p-1 rounded-full"><X size={10}/></button>}</div>))}<button onClick={() => setMatchingPairs([...matchingPairs, { left_th: '', left_en: '', right_th: '', right_en: '' }])} className="w-full py-2 border-2 border-dashed border-slate-200 text-slate-400 text-[10px] font-black rounded-xl hover:bg-slate-50 uppercase tracking-widest">Add +</button></div>}
            </div>
        </div>
        <button onClick={handleSave} disabled={uploadingImage} className="mt-8 w-full md:w-auto bg-slate-900 text-white px-12 py-4 rounded-2xl font-black uppercase text-xs shadow-xl active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2">
            {uploadingImage ? <Loader2 className="animate-spin" size={16}/> : <Save size={16}/>} {uploadingImage ? 'Uploading Assets...' : editingId ? 'Update Question' : 'Deploy Question'}
        </button>
      </div>

      {/* 🔵 Master Repository - แก้ไข Hydration Error ที่นี่ */}
      <div className="bg-white p-6 md:p-8 rounded-[2rem] border border-slate-100 shadow-sm min-h-[500px]">
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
            <div className="text-left">
              <h3 className="text-xl font-black text-slate-900 uppercase">Master Repository</h3>
              {/* ✅ แก้ไข: เปลี่ยน <p> เป็น <div> เพื่อป้องกัน Hydration Error */}
              <div className="text-[10px] text-slate-400 font-black uppercase tracking-widest flex items-center gap-2 mt-1">
                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" /> Element Count: {filteredQuestions.length}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 w-full md:w-auto">
                <div className="relative flex-1"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input placeholder="Search keywords..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none w-full" /></div>
                <button onClick={fetchQuestions} className="p-2.5 bg-slate-50 text-slate-400 rounded-xl hover:text-blue-600 transition-all border border-slate-100 shadow-sm"><RefreshCw size={18}/></button>
            </div>
        </div>
        {loading ? (<div className="py-24 text-center"><Loader2 className="animate-spin mx-auto mb-4 text-blue-500"/><p className="text-[10px] font-black uppercase tracking-widest">Synchronizing Database...</p></div>) : (
            <div className="grid grid-cols-1 gap-4">
                {currentQuestions.map((q) => (
                    <div key={q.id} className={`p-4 md:p-5 border-2 rounded-3xl flex flex-col md:flex-row gap-5 items-start group transition-all ${editingId === q.id ? 'border-amber-400 bg-amber-50/10' : 'border-slate-50 hover:border-blue-100 hover:shadow-lg'}`}>
                        <div className="w-full md:w-28 h-28 flex-shrink-0 relative">
                            {q.image_url ? <img src={q.image_url} className="w-full h-full object-cover rounded-2xl bg-slate-50 border border-slate-100 shadow-inner" /> : <div className="w-full h-full bg-slate-50 rounded-2xl flex items-center justify-center text-slate-200 border border-slate-100 shadow-sm"><ImageIcon size={24}/></div>}
                            <div className="absolute top-1.5 left-1.5 px-2 py-0.5 bg-slate-900/80 text-white text-[6px] font-black rounded uppercase tracking-tighter shadow-md border border-white/20">{q.pattern?.replace('_', ' ')}</div>
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                            <div className="flex justify-between items-center mb-1">
                                <span className={`px-2 py-0.5 rounded-md text-[8px] font-black border ${q.type === 'INDUCTION' ? 'text-blue-600 border-blue-100 bg-blue-50' : 'text-purple-600 border-purple-100 bg-purple-50'}`}>{q.type}</span>
                                <div className="flex gap-1 md:opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => handleEdit(q)} className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors"><Edit3 size={16}/></button>
                                    <button onClick={() => handleDelete(q.id)} className="p-1.5 text-slate-400 hover:text-red-600 transition-colors"><Trash2 size={16}/></button>
                                </div>
                            </div>
                            <h4 className="font-black text-slate-800 text-sm truncate">{q.content_th}</h4>
                            <p className="text-[10px] text-slate-400 italic truncate mb-4 opacity-70">{q.content_en}</p>
                            <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-50">
                                {q.pattern === QuestionPattern.SHORT_ANSWER ? (
                                    <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-3 py-1 rounded-full border border-blue-100 shadow-sm uppercase tracking-tighter">Ans: {q.choices_json?.[0]?.correct_answer}</span>
                                ) : (
                                    <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100 shadow-sm uppercase tracking-tighter">{q.choices_json?.length} Configuration Elements</span>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
                {filteredQuestions.length === 0 && <div className="py-24 text-center opacity-30 font-black uppercase text-xs tracking-widest italic">No assets found in current pool</div>}
                {totalPages > 1 && (
                    <div className="flex justify-center items-center gap-4 mt-8 pt-6 border-t border-slate-50">
                        <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="p-2 bg-slate-50 rounded-xl hover:bg-slate-100 disabled:opacity-20 transition-all"><ChevronLeft size={20}/></button>
                        <span className="text-[10px] font-black text-slate-900 uppercase tracking-tighter shadow-sm bg-white px-4 py-2 rounded-xl border border-slate-100">Page {currentPage} / {totalPages}</span>
                        <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="p-2 bg-slate-50 rounded-xl hover:bg-slate-100 disabled:opacity-20 transition-all"><ChevronRight size={20}/></button>
                    </div>
                )}
            </div>
        )}
      </div>
    </div>
  );
};

const PatternTab = ({ active, onClick, icon, label }: any) => (
    <button onClick={onClick} className={`flex-1 flex items-center justify-center gap-2 py-3.5 px-2 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all border ${active ? 'bg-white text-blue-600 shadow-sm border-slate-200' : 'text-slate-400 hover:text-slate-500 border-transparent'}`}>
        {icon} <span className="hidden sm:inline">{label}</span>
    </button>
);

export default QuestionManager;