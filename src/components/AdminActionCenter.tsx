import React from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, ShieldAlert, UserX } from 'lucide-react';
import { AdminActionItem, AdminActionKind } from '../services/adminActionCenter';

interface Props {
  items: AdminActionItem[];
  lastUpdatedAt: Date | null;
  onNavigateToUsers?: () => void;
  onNavigateToSupplier?: () => void;
}

const metadata: Record<AdminActionKind, { title: string; description: string; icon: React.ReactNode }> = {
  COMPLIANCE: { title: 'สิทธิ์อบรมต้องตรวจสอบ', description: 'ไม่มีใบรับรอง หมดอายุ หรือใกล้หมดอายุ', icon: <ShieldAlert size={18} /> },
  SUSPENDED: { title: 'บัญชีถูกระงับ', description: 'ตรวจสอบเหตุผลและสถานะการเข้าพื้นที่', icon: <UserX size={18} /> },
  RETAKE: { title: 'ต้องสอบใหม่', description: 'มีผลสอบไม่ผ่านที่ควรติดตาม', icon: <AlertTriangle size={18} /> },
  SUPPLIER: { title: 'Supplier & Outsource', description: 'ยังไม่สอบ ไม่ผ่าน หรือสิทธิ์หมดอายุ', icon: <Clock3 size={18} /> },
};

const AdminActionCenter: React.FC<Props> = ({ items, lastUpdatedAt, onNavigateToUsers, onNavigateToSupplier }) => (
  <section aria-labelledby="admin-action-center-title" className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-700">Action Center</p>
        <h3 id="admin-action-center-title" className="mt-1 text-lg font-black text-slate-900">งานที่ควรจัดการ</h3>
        <p className="mt-1 text-[11px] font-bold text-slate-500">เรียงรายการที่ต้องติดตามจากข้อมูล Dashboard เดิม</p>
      </div>
      {lastUpdatedAt && <p className="text-[9px] font-bold text-slate-500">อัปเดตล่าสุด {lastUpdatedAt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</p>}
    </div>

    {items.length === 0 ? (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
        <CheckCircle2 size={20} aria-hidden="true" />
        <div><p className="text-sm font-black">ไม่มีรายการเร่งด่วน</p><p className="text-[10px] font-bold opacity-75">ข้อมูลปัจจุบันไม่มีงานค้างที่ต้องติดตามจาก Dashboard</p></div>
      </div>
    ) : (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {items.map((item) => {
          const meta = metadata[item.kind];
          const onClick = item.destination === 'supplier' ? onNavigateToSupplier : onNavigateToUsers;
          return (
            <button
              key={item.kind}
              type="button"
              onClick={onClick}
              disabled={!onClick}
              className={`group flex min-h-24 items-center gap-3 rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md disabled:cursor-default disabled:hover:translate-y-0 disabled:hover:shadow-none ${item.priority === 'high' ? 'border-red-200 bg-red-50/70' : 'border-amber-200 bg-amber-50/70'}`}
            >
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${item.priority === 'high' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{meta.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2"><strong className="text-sm font-black text-slate-900">{meta.title}</strong><span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${item.priority === 'high' ? 'bg-red-700 text-white' : 'bg-amber-700 text-white'}`}>{item.count}</span></span>
                <span className="mt-1 block text-[10px] font-bold leading-relaxed text-slate-600">{meta.description}</span>
              </span>
              {onClick && <ArrowRight size={16} className="shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-blue-700" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    )}
  </section>
);

export default AdminActionCenter;

