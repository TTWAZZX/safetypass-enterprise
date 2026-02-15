import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/supabaseApi';
import { supabase } from '../services/supabaseClient';
import * as XLSX from 'xlsx';
import { 
  Plus, Save, Trash2, BookOpen, Ticket, Loader2, 
  Edit3, Upload, Download, X, Search, Image as ImageIcon,
  ChevronLeft, ChevronRight, RefreshCw, AlertCircle, CheckCircle2
} from 'lucide-react';

const QuestionManager: React.FC = () => {
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // --- Search & Pagination State ---
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  // --- Form State ---
  const [examType, setExamType] = useState('INDUCTION');
  const [th, setTh] = useState('');
  const [en, setEn] = useState('');
  const [choices, setChoices] = useState([
    { text_th: '', text_en: '', is_correct: true },
    { text_th: '', text_en: '', is_correct: false },
    { text_th: '', text_en: '', is_correct: false },
    { text_th: '', text_en: '', is_correct: false },
  ]);

  // --- Image Upload State ---
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  // --- Edit State ---
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const fetchQuestions = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('questions')
        .select('*')
        .eq('type', examType) 
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setQuestions(data || []);
      setCurrentPage(1);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuestions();
  }, [examType]);

  // ================= [ IMAGE HANDLER ] =================
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
      const fileExt = imageFile.name.split('.').pop();
      const fileName = `${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('question-images')
        .upload(filePath, imageFile);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('question-images').getPublicUrl(filePath);
      return data.publicUrl;
    } catch (error) {
      console.error('Upload error:', error);
      alert('อัปโหลดรูปภาพล้มเหลว');
      return null;
    } finally {
      setUploadingImage(false);
    }
  };

  // ================= [ CRUD ACTIONS ] =================

  const handleEdit = (q: any) => {
    setEditingId(q.id);
    setExamType(q.type);
    setTh(q.content_th);
    setEn(q.content_en);
    setPreviewUrl(q.image_url);
    setImageFile(null);
    
    const newChoices = q.choices_json.map((c: any, idx: number) => ({
      text_th: c.text_th,
      text_en: c.text_en,
      is_correct: q.correct_choice_index !== undefined ? q.correct_choice_index === idx : c.is_correct
    }));
    setChoices(newChoices);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setTh(''); setEn('');
    setChoices([
      { text_th: '', text_en: '', is_correct: true },
      { text_th: '', text_en: '', is_correct: false },
      { text_th: '', text_en: '', is_correct: false },
      { text_th: '', text_en: '', is_correct: false },
    ]);
    clearImage();
  };

  const handleSave = async () => {
    if(!th || !en) return alert("กรุณากรอกโจทย์ให้ครบถ้วน");

    const correctIndex = choices.findIndex(c => c.is_correct);
    if (correctIndex === -1) return alert("กรุณาเลือกข้อที่ถูกต้อง");

    const imageUrl = await uploadImageToSupabase();

    const payload = {
       type: examType,
       content_th: th,
       content_en: en,
       choices_json: choices,
       correct_choice_index: correctIndex,
       image_url: imageUrl,
       is_active: true
    };

    try {
      let error;
      if (editingId) {
        const res = await supabase.from('questions').update(payload).eq('id', editingId);
        error = res.error;
      } else {
        const res = await supabase.from('questions').insert(payload);
        error = res.error;
      }
  
      if(error) throw error;
      
      alert(editingId ? "แก้ไขข้อสอบสำเร็จ!" : "บันทึกข้อสอบสำเร็จ!");
      handleCancelEdit();
      fetchQuestions();
    } catch (err: any) {
      alert("เกิดข้อผิดพลาด: " + err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if(!window.confirm("ยืนยันการลบข้อสอบนี้?")) return;
    try {
      await api.deleteQuestion(id);
      fetchQuestions();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // ================= [ EXCEL ] =================
  const handleExport = () => {
    const data = questions.map(q => ({
      Type: q.type,
      QuestionTH: q.content_th,
      QuestionEN: q.content_en,
      ImageURL: q.image_url || '',
      Choice1TH: q.choices_json[0]?.text_th,
      Choice1EN: q.choices_json[0]?.text_en,
      Choice2TH: q.choices_json[1]?.text_th,
      Choice2EN: q.choices_json[1]?.text_en,
      Choice3TH: q.choices_json[2]?.text_th,
      Choice3EN: q.choices_json[2]?.text_en,
      Choice4TH: q.choices_json[3]?.text_th,
      Choice4EN: q.choices_json[3]?.text_en,
      CorrectAnswerIndex: (q.correct_choice_index !== undefined ? q.correct_choice_index : q.choices_json.findIndex((c:any) => c.is_correct)) + 1
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Questions");
    XLSX.writeFile(wb, `Exam_Questions_${examType}.xlsx`);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data: any[] = XLSX.utils.sheet_to_json(ws);
        let successCount = 0;
        for (const row of data) {
          const choices = [
            { text_th: row['Choice1TH'], text_en: row['Choice1EN'] },
            { text_th: row['Choice2TH'], text_en: row['Choice2EN'] },
            { text_th: row['Choice3TH'], text_en: row['Choice3EN'] },
            { text_th: row['Choice4TH'], text_en: row['Choice4EN'] },
          ];
          const payload = {
            type: examType,
            content_th: row['QuestionTH'],
            content_en: row['QuestionEN'],
            choices_json: choices,
            correct_choice_index: (row['CorrectAnswerIndex'] || 1) - 1,
            image_url: row['ImageURL'] || null,
            is_active: true
          };
          if (payload.content_th) {
             await supabase.from('questions').insert([payload]);
             successCount++;
          }
        }
        alert(`นำเข้าสำเร็จ ${successCount} ข้อ`);
        fetchQuestions();
      } catch (err) { alert('ไฟล์ไม่ถูกต้อง'); }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const filteredQuestions = questions.filter(q => 
    q.content_th.toLowerCase().includes(searchTerm.toLowerCase()) ||
    q.content_en.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalPages = Math.ceil(filteredQuestions.length / itemsPerPage);
  const currentQuestions = filteredQuestions.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  return (
    <div className="space-y-6 md:space-y-8 animate-in fade-in duration-500 pb-10">
      
      {/* 🟢 SECTION 1: QUESTION CREATOR/EDITOR */}
      <div className={`p-6 md:p-8 rounded-[2rem] border-2 transition-all ${editingId ? 'bg-amber-50/50 border-amber-200' : 'bg-white border-slate-100 shadow-sm'}`}>
        <div className="flex justify-between items-center mb-6 md:mb-8">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${editingId ? 'bg-amber-100 text-amber-600' : 'bg-blue-50 text-blue-600'}`}>
               {editingId ? <Edit3 size={20} /> : <Plus size={20} />}
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">
                 {editingId ? 'Modify Assessment' : 'New Assessment Question'}
              </h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Question Designer Module</p>
            </div>
          </div>
          {editingId && (
            <button onClick={handleCancelEdit} className="p-2 bg-white text-slate-400 hover:text-red-500 rounded-full border border-slate-200 transition-colors shadow-sm"><X size={18} /></button>
          )}
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-12">
            <div className="space-y-5">
                {/* Image Upload Area */}
                <div 
                  className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl p-5 text-center hover:bg-blue-50/50 hover:border-blue-300 transition-all cursor-pointer relative group overflow-hidden" 
                  onClick={() => imageInputRef.current?.click()}
                >
                    <input type="file" ref={imageInputRef} className="hidden" accept="image/*" onChange={handleImageChange} />
                    {previewUrl ? (
                        <div className="relative z-10">
                            <img src={previewUrl} alt="Preview" className="h-44 md:h-56 mx-auto rounded-2xl object-contain shadow-lg bg-white" />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl flex items-center justify-center">
                               <p className="text-white text-[10px] font-black uppercase">Change Image</p>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); clearImage(); }} className="absolute -top-2 -right-2 bg-red-500 text-white p-1.5 rounded-full hover:bg-red-600 shadow-md border-2 border-white"><X size={14}/></button>
                        </div>
                    ) : (
                        <div className="py-10 text-slate-400 flex flex-col items-center gap-3">
                            <div className="p-4 bg-white rounded-2xl shadow-sm border border-slate-100 group-hover:scale-110 transition-transform">
                              <ImageIcon size={32} strokeWidth={1.5} />
                            </div>
                            <div className="space-y-1">
                               <p className="text-xs font-black uppercase tracking-widest text-slate-600">Click to Upload Media</p>
                               <p className="text-[10px] font-medium text-slate-400">PNG, JPG or JPEG (Max 2MB)</p>
                            </div>
                        </div>
                    )}
                </div>

                <div className="space-y-3">
                  <div className="relative group">
                    <input 
                      placeholder="โจทย์ภาษาไทย (Question in Thai)" 
                      value={th} 
                      onChange={e=>setTh(e.target.value)} 
                      className="w-full p-4 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none text-sm font-bold text-slate-800 bg-white transition-all shadow-inner" 
                    />
                  </div>
                  <div className="relative group">
                    <input 
                      placeholder="Question in English (ภาษาอังกฤษ)" 
                      value={en} 
                      onChange={e=>setEn(e.target.value)} 
                      className="w-full p-4 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none text-sm font-bold text-slate-800 bg-white transition-all shadow-inner" 
                    />
                  </div>
                </div>
                
                <div className="flex bg-slate-100 p-1.5 rounded-2xl">
                    <button 
                        onClick={() => setExamType('INDUCTION')}
                        className={`flex-1 py-3 rounded-xl font-black text-[10px] uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 ${examType === 'INDUCTION' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                        <BookOpen size={14} /> Induction
                    </button>
                    <button 
                        onClick={() => setExamType('WORK_PERMIT')}
                        className={`flex-1 py-3 rounded-xl font-black text-[10px] uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 ${examType === 'WORK_PERMIT' ? 'bg-purple-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                        <Ticket size={14} /> Work Permit
                    </button>
                </div>
            </div>

            <div className="space-y-4">
                <div className="flex items-center justify-between mb-2">
                   <label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Answer Logic & Choices</label>
                   <span className="text-[8px] bg-slate-100 px-2 py-0.5 rounded-full font-black text-slate-400">SELECT CORRECT ANSWER</span>
                </div>
                {choices.map((c, idx) => (
                    <div key={idx} className={`flex gap-3 items-center p-3 rounded-2xl border-2 transition-all ${c.is_correct ? 'border-emerald-500 bg-emerald-50/30' : 'border-slate-50 bg-slate-50/50'}`}>
                        <input 
                            type="radio" 
                            name="correct_choice" 
                            checked={c.is_correct} 
                            onChange={() => {
                                const newC = choices.map(ch => ({ ...ch, is_correct: false }));
                                newC[idx].is_correct = true;
                                setChoices(newC);
                            }}
                            className="w-6 h-6 text-emerald-600 border-slate-300 focus:ring-emerald-500 cursor-pointer"
                        />
                        <div className="flex-1 space-y-2">
                            <input 
                              placeholder={`Thai Answer ${idx+1}`} 
                              value={c.text_th} 
                              onChange={e => {
                                  const newC = [...choices]; newC[idx].text_th = e.target.value; setChoices(newC);
                              }} 
                              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold focus:ring-2 focus:ring-blue-100 outline-none" 
                            />
                            <input 
                              placeholder={`English Answer ${idx+1}`} 
                              value={c.text_en} 
                              onChange={e => {
                                  const newC = [...choices]; newC[idx].text_en = e.target.value; setChoices(newC);
                              }} 
                              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold focus:ring-2 focus:ring-blue-100 outline-none" 
                            />
                        </div>
                    </div>
                ))}
            </div>
        </div>

        <div className="mt-8 flex flex-col md:flex-row items-center gap-4">
          <button 
              onClick={handleSave} 
              disabled={uploadingImage}
              className={`w-full md:w-auto text-white px-12 py-4 rounded-[1.5rem] font-black uppercase text-xs tracking-widest flex items-center justify-center gap-3 transition-all shadow-xl active:scale-95 ${editingId ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-200' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-200'} ${uploadingImage ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
              {uploadingImage ? <Loader2 className="w-5 h-5 animate-spin"/> : <Save size={16} />} 
              {uploadingImage ? 'Uploading Assets...' : (editingId ? 'Update Question' : 'Deploy Question')}
          </button>
          
          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest hidden md:block">
             System will auto-validate correct answer index before saving
          </p>
        </div>
      </div>

      {/* 🔵 SECTION 2: QUESTION REPOSITORY & MANAGEMENT */}
      <div className="bg-white p-6 md:p-8 rounded-[2rem] border border-slate-100 shadow-sm min-h-[500px] text-left">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-6">
            <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight uppercase">Master Repository</h3>
                <p className="text-[10px] text-slate-400 font-black uppercase mt-1 tracking-[0.2em] flex items-center gap-2">
                   <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                   Total Pool: {filteredQuestions.length} Modules
                </p>
            </div>
            
            <div className="flex flex-wrap gap-2 items-center w-full md:w-auto">
                {/* Search Console */}
                <div className="relative flex-1 md:flex-none">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                    <input 
                        placeholder="Filter by keyword..." 
                        value={searchTerm}
                        onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                        className="pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:ring-4 focus:ring-blue-500/10 outline-none w-full md:w-56 transition-all"
                    />
                </div>

                <div className="flex gap-2 w-full md:w-auto">
                    <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx" onChange={handleImport} />
                    <button onClick={() => fileInputRef.current?.click()} className="flex-1 md:flex-none bg-emerald-50 text-emerald-600 border border-emerald-100 px-4 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-emerald-100 transition-colors">
                        <Upload size={14}/> Import
                    </button>
                    <button onClick={handleExport} className="flex-1 md:flex-none bg-slate-50 text-slate-600 border border-slate-200 px-4 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-slate-100 transition-colors">
                        <Download size={14}/> Export
                    </button>
                </div>
            </div>
        </div>
        
        {loading ? (
            <div className="py-32 text-center text-slate-400">
                <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-blue-500" />
                <p className="font-black uppercase tracking-widest text-[10px]">Accessing Repository...</p>
            </div>
        ) : (
            <>
                <div className="grid grid-cols-1 gap-4">
                    {currentQuestions.map((q) => (
                        <div key={q.id} className={`p-4 md:p-6 border-2 rounded-3xl transition-all flex flex-col md:flex-row gap-6 items-start group bg-white relative ${editingId === q.id ? 'border-amber-400 bg-amber-50/10' : 'border-slate-50 hover:border-blue-100 hover:shadow-lg hover:shadow-blue-500/5'}`}>
                            
                            {/* Visual Asset Thumbnail */}
                            <div className="w-full md:w-32 h-32 flex-shrink-0">
                              {q.image_url ? (
                                  <img src={q.image_url} alt="Question" className="w-full h-full object-cover rounded-2xl border border-slate-100 shadow-sm bg-slate-50" />
                              ) : (
                                  <div className="w-full h-full bg-slate-50 rounded-2xl border border-slate-100 flex flex-col items-center justify-center text-slate-300 gap-1">
                                      <ImageIcon size={24} strokeWidth={1.5}/>
                                      <span className="text-[8px] font-black uppercase">No Media</span>
                                  </div>
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-3">
                                    <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${q.type === 'INDUCTION' ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-purple-50 text-purple-600 border-purple-100'}`}>
                                        {q.type}
                                    </span>
                                    <div className="flex gap-1 md:opacity-0 md:group-hover:opacity-100 transition-all">
                                        <button onClick={() => handleEdit(q)} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all" title="Edit"><Edit3 size={18} /></button>
                                        <button onClick={() => handleDelete(q.id)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all" title="Delete"><Trash2 size={18} /></button>
                                    </div>
                                </div>
                                <h4 className="font-black text-slate-800 text-base leading-tight mb-1">{q.content_th}</h4>
                                <p className="text-xs text-slate-400 font-bold italic mb-4 uppercase tracking-tighter opacity-80">{q.content_en}</p>
                                
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-4 p-4 bg-slate-50/50 rounded-2xl border border-slate-50">
                                    {q.choices_json.map((c: any, i: number) => {
                                        const isCorrect = q.correct_choice_index === i || c.is_correct;
                                        return (
                                          <div key={i} className={`text-[10px] py-1 flex items-center gap-2 ${isCorrect ? 'text-emerald-600 font-black' : 'text-slate-500 font-bold'}`}>
                                              {isCorrect ? <div className="w-4 h-4 bg-emerald-500 text-white rounded-full flex items-center justify-center"><CheckCircle2 size={10} strokeWidth={3}/></div> : <div className="w-4 h-4 border-2 border-slate-200 rounded-full flex items-center justify-center text-[8px] font-black text-slate-300">{i+1}</div>}
                                              <span className="truncate">{c.text_th}</span>
                                          </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    ))}
                    {filteredQuestions.length === 0 && (
                        <div className="py-24 text-center">
                            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-100">
                               <Search className="text-slate-200" size={32} />
                            </div>
                            <p className="text-xs font-black text-slate-400 uppercase tracking-widest italic">No matching assessment assets found</p>
                        </div>
                    )}
                </div>

                {/* PAGINATION NAVIGATION */}
                {filteredQuestions.length > itemsPerPage && (
                    <div className="flex justify-center items-center gap-4 mt-12 pt-6 border-t border-slate-50">
                        <button 
                            disabled={currentPage === 1}
                            onClick={() => setCurrentPage(p => p - 1)}
                            className="p-3 bg-white border border-slate-200 rounded-2xl hover:bg-blue-50 hover:text-blue-600 disabled:opacity-20 disabled:hover:bg-transparent transition-all shadow-sm active:scale-90"
                        >
                            <ChevronLeft size={20} />
                        </button>
                        <div className="flex items-center gap-2">
                           <span className="px-4 py-2 bg-slate-900 text-white text-[10px] font-black rounded-xl uppercase tracking-tighter shadow-lg shadow-slate-200">
                              PAGE {currentPage}
                           </span>
                           <span className="text-[10px] font-black text-slate-300 uppercase">OF</span>
                           <span className="px-4 py-2 bg-white border border-slate-100 text-slate-600 text-[10px] font-black rounded-xl uppercase tracking-tighter">
                              {totalPages}
                           </span>
                        </div>
                        <button 
                            disabled={currentPage === totalPages}
                            onClick={() => setCurrentPage(p => p + 1)}
                            className="p-3 bg-white border border-slate-200 rounded-2xl hover:bg-blue-50 hover:text-blue-600 disabled:opacity-20 disabled:hover:bg-transparent transition-all shadow-sm active:scale-90"
                        >
                            <ChevronRight size={20} />
                        </button>
                    </div>
                )}
            </>
        )}
      </div>
    </div>
  );
};

export default QuestionManager;