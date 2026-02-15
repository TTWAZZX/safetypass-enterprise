import React, { useState, useEffect } from 'react';
import { api } from '../services/supabaseApi';
import { supabase } from '../services/supabaseClient';
import { Plus, Save, Trash2, BookOpen, Ticket, Loader2 } from 'lucide-react';

const QuestionManager: React.FC = () => {
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [examType, setExamType] = useState('INDUCTION');
  const [th, setTh] = useState('');
  const [en, setEn] = useState('');
  const [choices, setChoices] = useState([
    { text_th: '', text_en: '', is_correct: true },
    { text_th: '', text_en: '', is_correct: false },
    { text_th: '', text_en: '', is_correct: false },
    { text_th: '', text_en: '', is_correct: false },
  ]);

  const fetchQuestions = async () => {
    setLoading(true);
    try {
      const data = await api.getAllQuestions();
      setQuestions(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuestions();
  }, []);

  const handleSave = async () => {
    if(!th || !en) return alert("กรุณากรอกโจทย์ให้ครบถ้วน");

    // หาข้อที่ถูก
    const correctIndex = choices.findIndex(c => c.is_correct);
    if (correctIndex === -1) return alert("กรุณาเลือกข้อที่ถูกต้อง");

    try {
      const { error } = await supabase.from('questions').insert({
          content_th: th,
          content_en: en,
          type: examType,
          choices_json: choices,
          correct_choice_index: correctIndex, // ✅ ส่ง Index ไปบันทึก
          is_active: true
      });
  
      if(error) throw error;
      
      alert("บันทึกข้อสอบสำเร็จ!");
      setTh(''); setEn('');
      setChoices([
        { text_th: '', text_en: '', is_correct: true },
        { text_th: '', text_en: '', is_correct: false },
        { text_th: '', text_en: '', is_correct: false },
        { text_th: '', text_en: '', is_correct: false },
      ]);
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

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      
      {/* 🟢 ส่วนที่ 1: ฟอร์มเพิ่มข้อสอบ (Clean White) */}
      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
        <h3 className="text-xl font-black text-slate-900 mb-6 flex items-center gap-2">
            <Plus className="w-6 h-6 text-blue-600" /> เพิ่มข้อสอบใหม่
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="space-y-4">
                <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">เนื้อหาข้อสอบ (ไทย/อังกฤษ)</label>
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
                
                <div className="pt-2">
                    <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">ประเภทการสอบ</label>
                    <div className="flex gap-2 mt-2">
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

        <button onClick={handleSave} className="w-full md:w-auto bg-blue-600 text-white px-10 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-lg shadow-blue-200">
            <Save className="w-5 h-5" /> บันทึกข้อสอบ
        </button>
      </div>

      {/* 🔵 ส่วนที่ 2: รายการข้อสอบ (Clean White) */}
      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
        <h3 className="text-xl font-black text-slate-900 mb-6">รายการข้อสอบทั้งหมด ({questions.length})</h3>
        
        {loading ? (
            <div className="py-10 text-center text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                กำลังโหลดข้อมูล...
            </div>
        ) : (
            <div className="grid grid-cols-1 gap-4">
                {questions.map((q) => (
                    <div key={q.id} className="p-5 border border-slate-100 rounded-2xl hover:bg-slate-50 transition-all flex justify-between items-start group bg-white">
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${q.type === 'INDUCTION' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'}`}>
                                    {q.type}
                                </span>
                                <span className="text-slate-300 text-xs">ID: {q.id.slice(0,8)}</span>
                            </div>
                            <p className="font-bold text-slate-800">{q.content_th}</p>
                            <p className="text-sm text-slate-500 italic">{q.content_en}</p>
                            
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3">
                                {q.choices_json.map((c: any, i: number) => (
                                    <div key={i} className={`text-xs ${
                                      (q.correct_choice_index === i || c.is_correct) 
                                        ? 'text-emerald-600 font-bold' 
                                        : 'text-slate-400'
                                    }`}>
                                        • {c.text_th} {(q.correct_choice_index === i || c.is_correct) && '✓'}
                                    </div>
                                ))}
                            </div>
                        </div>
                        <button 
                            onClick={() => handleDelete(q.id)}
                            className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                        >
                            <Trash2 className="w-5 h-5" />
                        </button>
                    </div>
                ))}
                {questions.length === 0 && <p className="text-center text-slate-400 py-10">ไม่พบข้อมูลข้อสอบ</p>}
            </div>
        )}
      </div>
    </div>
  );
};

export default QuestionManager;