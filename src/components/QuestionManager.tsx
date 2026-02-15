import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/supabaseApi';
import { supabase } from '../services/supabaseClient';
import * as XLSX from 'xlsx';
import { 
  Plus, Save, Trash2, BookOpen, Ticket, Loader2, 
  Edit3, Upload, Download, X, Search, Image as ImageIcon,
  ChevronLeft, ChevronRight, RefreshCw
} from 'lucide-react';

const QuestionManager: React.FC = () => {
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // --- Search & Pagination State ---
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5; // จำนวนข้อต่อหน้า

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
      setCurrentPage(1); // รีเซ็ตหน้าเมื่อโหลดข้อมูลใหม่
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
      setPreviewUrl(URL.createObjectURL(file)); // แสดง Preview ทันที
    }
  };

  const clearImage = () => {
    setImageFile(null);
    setPreviewUrl(null);
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const uploadImageToSupabase = async (): Promise<string | null> => {
    if (!imageFile) return previewUrl; // ถ้าไม่ได้เลือกรูปใหม่ ให้ใช้ URL เดิม (ถ้ามี)

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
    setPreviewUrl(q.image_url); // โหลดรูปเดิมมาโชว์
    setImageFile(null); // เคลียร์ไฟล์ใหม่รอไว้
    
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

    // 1. Upload Image ก่อน
    const imageUrl = await uploadImageToSupabase();

    const payload = {
       type: examType,
       content_th: th,
       content_en: en,
       choices_json: choices,
       correct_choice_index: correctIndex,
       image_url: imageUrl, // บันทึก URL รูปภาพ
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
            image_url: row['ImageURL'] || null, // รองรับ import URL รูป
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

  // ================= [ LOGIC: SEARCH & PAGINATION ] =================
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
    <div className="space-y-8 animate-in fade-in duration-700">
      
      {/* 🟢 ส่วนที่ 1: ฟอร์ม (เพิ่ม/แก้ไข) */}
      <div className={`p-8 rounded-3xl border shadow-sm transition-all ${editingId ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}>
        <div className="flex justify-between items-center mb-6">
          <h3 className={`text-xl font-black flex items-center gap-2 ${editingId ? 'text-amber-700' : 'text-slate-900'}`}>
             {editingId ? <><Edit3 className="w-6 h-6" /> แก้ไขข้อสอบ</> : <><Plus className="w-6 h-6 text-blue-600" /> เพิ่มข้อสอบใหม่</>}
          </h3>
          {editingId && (
            <button onClick={handleCancelEdit} className="text-slate-400 hover:text-red-500"><X className="w-6 h-6" /></button>
          )}
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-6">
            <div className="space-y-4">
                {/* Image Upload Section */}
                <div className="bg-slate-50 border-2 border-dashed border-slate-300 rounded-xl p-4 text-center hover:bg-blue-50 hover:border-blue-300 transition-all cursor-pointer relative group" onClick={() => imageInputRef.current?.click()}>
                    <input type="file" ref={imageInputRef} className="hidden" accept="image/*" onChange={handleImageChange} />
                    {previewUrl ? (
                        <div className="relative">
                            <img src={previewUrl} alt="Preview" className="h-40 mx-auto rounded-lg object-contain" />
                            <button onClick={(e) => { e.stopPropagation(); clearImage(); }} className="absolute top-0 right-0 bg-red-500 text-white p-1 rounded-full hover:bg-red-600"><X size={14}/></button>
                        </div>
                    ) : (
                        <div className="py-6 text-slate-400 flex flex-col items-center gap-2">
                            <ImageIcon className="w-10 h-10" />
                            <span className="text-sm font-bold">คลิกเพื่ออัปโหลดรูปภาพประกอบ</span>
                        </div>
                    )}
                </div>

                <input 
                  placeholder="โจทย์ภาษาไทย" 
                  value={th} 
                  onChange={e=>setTh(e.target.value)} 
                  className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 bg-white" 
                />
                <input 
                  placeholder="Question in English" 
                  value={en} 
                  onChange={e=>setEn(e.target.value)} 
                  className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 bg-white" 
                />
                
                <div className="flex gap-2">
                    <button 
                        onClick={() => setExamType('INDUCTION')}
                        className={`flex-1 py-2 px-4 rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-2 ${examType === 'INDUCTION' ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' : 'bg-slate-100 text-slate-500'}`}
                    >
                        <BookOpen className="w-4 h-4" /> INDUCTION
                    </button>
                    <button 
                        onClick={() => setExamType('WORK_PERMIT')}
                        className={`flex-1 py-2 px-4 rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-2 ${examType === 'WORK_PERMIT' ? 'bg-purple-600 text-white shadow-lg shadow-purple-100' : 'bg-slate-100 text-slate-500'}`}
                    >
                        <Ticket className="w-4 h-4" /> WORK PERMIT
                    </button>
                </div>
            </div>

            <div className="space-y-3">
                <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">ตัวเลือก (ติ๊กหน้าข้อที่ถูกต้อง)</label>
                {choices.map((c, idx) => (
                    <div key={idx} className="flex gap-2 items-center group">
                        <input 
                            type="radio" 
                            name="correct_choice" 
                            checked={c.is_correct} 
                            onChange={() => {
                                const newC = choices.map(ch => ({ ...ch, is_correct: false }));
                                newC[idx].is_correct = true;
                                setChoices(newC);
                            }}
                            className="w-5 h-5 text-blue-600 border-slate-300 focus:ring-blue-500 cursor-pointer"
                        />
                        <div className="flex-1 flex flex-col gap-1">
                            <input 
                              placeholder={`ตัวเลือกที่ ${idx+1} (TH)`} 
                              value={c.text_th} 
                              onChange={e => {
                                  const newC = [...choices]; newC[idx].text_th = e.target.value; setChoices(newC);
                              }} 
                              className="w-full p-2 border border-slate-200 rounded-lg text-sm focus:border-blue-300 outline-none text-slate-900 bg-white" 
                            />
                            <input 
                              placeholder={`Choice ${idx+1} (EN)`} 
                              value={c.text_en} 
                              onChange={e => {
                                  const newC = [...choices]; newC[idx].text_en = e.target.value; setChoices(newC);
                              }} 
                              className="w-full p-2 border border-slate-200 rounded-lg text-sm focus:border-blue-300 outline-none text-slate-900 bg-white" 
                            />
                        </div>
                    </div>
                ))}
            </div>
        </div>

        <button 
            onClick={handleSave} 
            disabled={uploadingImage}
            className={`w-full md:w-auto text-white px-10 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg ${editingId ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-200' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-200'} ${uploadingImage ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
            {uploadingImage ? <Loader2 className="w-5 h-5 animate-spin"/> : <Save className="w-5 h-5" />} 
            {uploadingImage ? 'กำลังอัปโหลด...' : (editingId ? 'บันทึกการแก้ไข' : 'บันทึกข้อสอบ')}
        </button>
      </div>

      {/* 🔵 ส่วนที่ 2: รายการข้อสอบ (Search & List) */}
      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm min-h-[500px]">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
            <div>
                <h3 className="text-xl font-black text-slate-900">รายการข้อสอบ</h3>
                <p className="text-xs text-slate-400 font-bold mt-1">ทั้งหมด {filteredQuestions.length} ข้อ (แสดงหน้าละ {itemsPerPage})</p>
            </div>
            
            <div className="flex flex-wrap gap-2 items-center">
                {/* Search Box */}
                <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                    <input 
                        placeholder="ค้นหาข้อสอบ..." 
                        value={searchTerm}
                        onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                        className="pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none w-48 md:w-64"
                    />
                </div>

                <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx" onChange={handleImport} />
                <button onClick={() => fileInputRef.current?.click()} className="bg-emerald-50 text-emerald-600 border border-emerald-100 px-3 py-2 rounded-xl font-black text-xs uppercase flex items-center gap-2 hover:bg-emerald-100">
                    <Upload className="w-4 h-4"/> Import
                </button>
                <button onClick={handleExport} className="bg-white text-slate-600 border border-slate-200 px-3 py-2 rounded-xl font-black text-xs uppercase flex items-center gap-2 hover:border-blue-500 hover:text-blue-600">
                    <Download className="w-4 h-4"/> Export
                </button>
            </div>
        </div>
        
        {loading ? (
            <div className="py-20 text-center text-slate-400">
                <Loader2 className="w-10 h-10 animate-spin mx-auto mb-4 text-blue-500" />
                <p className="font-bold">กำลังโหลดข้อมูล...</p>
            </div>
        ) : (
            <>
                <div className="grid grid-cols-1 gap-4">
                    {currentQuestions.map((q) => (
                        <div key={q.id} className={`p-5 border rounded-2xl transition-all flex flex-col md:flex-row gap-6 items-start group bg-white ${editingId === q.id ? 'border-amber-400 ring-2 ring-amber-100' : 'border-slate-100 hover:bg-slate-50'}`}>
                            
                            {/* Thumbnail */}
                            {q.image_url ? (
                                <img src={q.image_url} alt="Question" className="w-full md:w-32 h-32 object-cover rounded-xl border border-slate-200" />
                            ) : (
                                <div className="w-full md:w-32 h-32 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-center text-slate-300">
                                    <ImageIcon className="w-8 h-8"/>
                                </div>
                            )}

                            <div className="flex-1 space-y-2 w-full">
                                <div className="flex items-center justify-between">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${q.type === 'INDUCTION' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'}`}>
                                        {q.type}
                                    </span>
                                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => handleEdit(q)} className="p-2 text-slate-300 hover:text-blue-500 hover:bg-blue-50 rounded-xl transition-all">
                                            <Edit3 className="w-5 h-5" />
                                        </button>
                                        <button onClick={() => handleDelete(q.id)} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all">
                                            <Trash2 className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                                <p className="font-bold text-slate-800 text-lg">{q.content_th}</p>
                                <p className="text-sm text-slate-500 italic">{q.content_en}</p>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 mt-3">
                                    {q.choices_json.map((c: any, i: number) => (
                                        <div key={i} className={`text-xs ${
                                          (q.correct_choice_index === i || c.is_correct) 
                                            ? 'text-emerald-600 font-bold flex items-center gap-1' 
                                            : 'text-slate-400'
                                        }`}>
                                            {(q.correct_choice_index === i || c.is_correct) && <CheckCircle2 size={12}/>}
                                            {i+1}. {c.text_th}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ))}
                    {filteredQuestions.length === 0 && (
                        <div className="text-center py-20">
                            <Search className="w-12 h-12 text-slate-200 mx-auto mb-4"/>
                            <p className="text-slate-400 font-bold">ไม่พบข้อสอบที่ค้นหา</p>
                        </div>
                    )}
                </div>

                {/* Pagination Controls */}
                {filteredQuestions.length > itemsPerPage && (
                    <div className="flex justify-center items-center gap-4 mt-8 pt-4 border-t border-slate-100">
                        <button 
                            disabled={currentPage === 1}
                            onClick={() => setCurrentPage(p => p - 1)}
                            className="p-2 rounded-xl hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
                        >
                            <ChevronLeft className="w-5 h-5 text-slate-600"/>
                        </button>
                        <span className="text-sm font-bold text-slate-500">
                            หน้า {currentPage} / {totalPages}
                        </span>
                        <button 
                            disabled={currentPage === totalPages}
                            onClick={() => setCurrentPage(p => p + 1)}
                            className="p-2 rounded-xl hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
                        >
                            <ChevronRight className="w-5 h-5 text-slate-600"/>
                        </button>
                    </div>
                )}
            </>
        )}
      </div>
    </div>
  );
};

// Helper Icon Component (ถ้ายังไม่มี CheckCircle2)
const CheckCircle2 = ({size}:{size:number}) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>
);

export default QuestionManager;