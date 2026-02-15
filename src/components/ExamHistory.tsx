import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { Clock, CheckCircle2, XCircle, Calendar, ArrowLeft } from 'lucide-react';

const ExamHistory: React.FC<{ userId: string; onBack: () => void }> = ({ userId, onBack }) => {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHistory = async () => {
      const { data } = await supabase
        .from('exam_history')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      setHistory(data || []);
      setLoading(false);
    };
    fetchHistory();
  }, [userId]);

  return (
    <div className="max-w-2xl mx-auto p-6 animate-in fade-in duration-500">
      <button onClick={onBack} className="flex items-center gap-2 text-slate-400 hover:text-slate-900 mb-6 font-bold transition-colors">
        <ArrowLeft size={18} /> กลับหน้าหลัก
      </button>

      <h3 className="text-2xl font-black text-slate-900 mb-6 flex items-center gap-3">
        <Clock className="text-blue-600" /> ประวัติการสอบของคุณ
      </h3>

      {loading ? (
        <div className="text-center py-10 text-slate-400">กำลังโหลด...</div>
      ) : history.length === 0 ? (
        <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl py-12 text-center text-slate-400 font-bold">
          ไม่พบประวัติการสอบ
        </div>
      ) : (
        <div className="space-y-4">
          {history.map((item) => (
            <div key={item.id} className="bg-white border border-slate-100 p-5 rounded-2xl shadow-sm flex items-center justify-between group hover:border-blue-200 transition-all">
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-xl ${item.status === 'PASSED' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                  {item.status === 'PASSED' ? <CheckCircle2 size={24} /> : <XCircle size={24} />}
                </div>
                <div>
                  <p className="font-black text-slate-800 uppercase text-xs tracking-widest">{item.exam_type}</p>
                  <p className="text-[10px] text-slate-400 font-bold flex items-center gap-1 mt-0.5 uppercase">
                    <Calendar size={10} /> {new Date(item.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-lg font-black text-slate-700">{item.score} <span className="text-xs text-slate-300">/ {item.total_questions}</span></p>
                <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${item.status === 'PASSED' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                  {item.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ExamHistory;