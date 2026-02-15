import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { Clock, CheckCircle2, XCircle, Calendar, ArrowLeft, Loader2 } from 'lucide-react';

const ExamHistory: React.FC<{ userId: string; onBack: () => void }> = ({ userId, onBack }) => {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const { data } = await supabase
          .from('exam_history')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });
        setHistory(data || []);
      } catch (err) {
        console.error("Error fetching history:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, [userId]);

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 animate-in fade-in duration-500 text-left">
      
      {/* 🔙 Navigation & Header */}
      <div className="flex items-center justify-between mb-6">
        <button 
          onClick={onBack} 
          className="flex items-center gap-1.5 text-slate-400 hover:text-blue-600 transition-colors p-2 -ml-2 rounded-xl active:bg-slate-100"
        >
          <ArrowLeft size={18} />
          <span className="text-xs font-black uppercase tracking-widest">Back</span>
        </button>
        
        <div className="flex items-center gap-2 bg-blue-50 px-4 py-1.5 rounded-full border border-blue-100">
           <Clock size={14} className="text-blue-600" />
           <span className="text-[10px] font-black text-blue-700 uppercase tracking-widest">Exam History</span>
        </div>
      </div>

      <h3 className="text-xl font-black text-slate-900 mb-6 px-1 uppercase tracking-tight">
        ประวัติการสอบของคุณ
      </h3>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <p className="text-[10px] font-black uppercase tracking-widest">Loading Records...</p>
        </div>
      ) : history.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-[2rem] py-16 text-center shadow-sm">
          <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <Clock className="text-slate-300" size={32} />
          </div>
          <p className="text-slate-400 font-black uppercase text-xs tracking-widest">ไม่พบประวัติการสอบ</p>
        </div>
      ) : (
        <div className="space-y-3">
          {history.map((item) => (
            <div 
              key={item.id} 
              className="bg-white border border-slate-200 p-4 rounded-2xl shadow-sm flex items-center justify-between group active:scale-[0.98] transition-all"
            >
              <div className="flex items-center gap-4 min-w-0">
                <div className={`p-2.5 rounded-xl flex-shrink-0 ${
                  item.status === 'PASSED' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
                }`}>
                  {item.status === 'PASSED' ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
                </div>
                <div className="min-w-0">
                  <p className="font-black text-slate-800 uppercase text-[11px] tracking-wider truncate">
                    {item.exam_type}
                  </p>
                  <p className="text-[9px] text-slate-400 font-bold flex items-center gap-1 mt-0.5 uppercase tracking-tighter">
                    <Calendar size={10} className="opacity-70" /> 
                    {new Date(item.created_at).toLocaleDateString('th-TH', { 
                      day: '2-digit', 
                      month: 'short', 
                      year: 'numeric', 
                      hour: '2-digit', 
                      minute: '2-digit' 
                    })}
                  </p>
                </div>
              </div>

              <div className="text-right flex-shrink-0 pl-4 border-l border-slate-100 ml-2">
                <p className="text-lg font-black text-slate-800 leading-none mb-1">
                  {item.score}
                  <span className="text-[10px] text-slate-300 ml-1">/ {item.total_questions}</span>
                </p>
                <span className={`text-[8px] font-black px-2 py-0.5 rounded-md uppercase tracking-widest border ${
                  item.status === 'PASSED' 
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                    : 'bg-red-50 text-red-700 border-red-100'
                }`}>
                  {item.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <footer className="mt-12 text-center">
         <p className="text-[9px] text-slate-300 font-bold uppercase tracking-[0.2em]">
            Safety Passport Record Management
         </p>
      </footer>
    </div>
  );
};

export default ExamHistory;