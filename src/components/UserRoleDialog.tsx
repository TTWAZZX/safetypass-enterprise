import React, { useRef, useState } from 'react';
import { Loader2, ShieldCheck, UserRound, X } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';

interface RoleUser {
  id: string;
  name: string;
  role: 'ADMIN' | 'USER' | string;
  is_active?: boolean;
  last_login?: string | null;
  pdpa_agreed?: boolean | null;
}

interface Props {
  user: RoleUser;
  isCurrentAdmin: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (role: 'ADMIN' | 'USER') => void;
}

const UserRoleDialog: React.FC<Props> = ({ user, isCurrentAdmin, busy, onClose, onConfirm }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const currentRole: 'ADMIN' | 'USER' = user.role === 'ADMIN' ? 'ADMIN' : 'USER';
  const [selectedRole, setSelectedRole] = useState<'ADMIN' | 'USER'>(currentRole);
  const cannotPromote = selectedRole === 'ADMIN' && currentRole === 'USER'
    && (user.is_active === false || !user.last_login || user.pdpa_agreed !== true);
  const changed = selectedRole !== currentRole;
  useDialogFocus(true, dialogRef, onClose);

  return (
    <div className="fixed inset-0 z-[310] flex items-center justify-center p-3 sm:p-5">
      <button type="button" aria-label="ปิดหน้าต่างจัดการสิทธิ์" className="absolute inset-0 h-full w-full bg-slate-950/65 backdrop-blur-sm" onClick={onClose} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="user-role-dialog-title" tabIndex={-1} className="relative z-10 w-full max-w-lg overflow-hidden rounded-[1.75rem] border border-white/50 bg-white shadow-2xl focus:outline-none">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-7">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-violet-700">Access control</p>
            <h2 id="user-role-dialog-title" className="mt-1 text-lg font-black text-slate-900">กำหนดสิทธิ์ผู้ใช้งาน</h2>
            <p className="mt-1 text-[10px] font-bold text-slate-500">{user.name}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="ปิด" className="min-h-11 min-w-11 rounded-full bg-slate-100 p-3 text-slate-600 disabled:opacity-50"><X size={18} /></button>
        </header>

        <div className="space-y-4 px-5 py-5 sm:px-7">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label="สิทธิ์การใช้งานระบบ">
            <button type="button" role="radio" aria-checked={selectedRole === 'USER'} onClick={() => setSelectedRole('USER')} disabled={busy || isCurrentAdmin} className={`rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${selectedRole === 'USER' ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/10' : 'border-slate-200 bg-white'}`}>
              <UserRound size={20} className="text-blue-600" />
              <p className="mt-3 text-xs font-black text-slate-900">ผู้ใช้งานทั่วไป</p>
              <p className="mt-1 text-[9px] font-bold leading-relaxed text-slate-500">เข้าอบรม สอบ และใช้สิทธิ์ตามที่ได้รับ</p>
            </button>
            <button type="button" role="radio" aria-checked={selectedRole === 'ADMIN'} onClick={() => setSelectedRole('ADMIN')} disabled={busy || isCurrentAdmin} className={`rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${selectedRole === 'ADMIN' ? 'border-violet-500 bg-violet-50 ring-2 ring-violet-500/10' : 'border-slate-200 bg-white'}`}>
              <ShieldCheck size={20} className="text-violet-600" />
              <p className="mt-3 text-xs font-black text-slate-900">ผู้ดูแลระบบ</p>
              <p className="mt-1 text-[9px] font-bold leading-relaxed text-slate-500">เข้าถึง Admin Portal และจัดการข้อมูลระบบ</p>
            </button>
          </div>

          {isCurrentAdmin && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] font-bold text-amber-800">ไม่สามารถเปลี่ยนสิทธิ์บัญชีที่กำลังใช้งานอยู่ได้</p>}
          {cannotPromote && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] font-bold text-amber-800">เลื่อนเป็นแอดมินได้หลังจากผู้ใช้ลงทะเบียนสำเร็จและบัญชี Active แล้วเท่านั้น</p>}
          {changed && !cannotPromote && !isCurrentAdmin && (
            <p className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-[10px] font-bold leading-relaxed text-violet-800">
              {selectedRole === 'ADMIN' ? 'ผู้ใช้นี้จะเข้าถึงข้อมูลและเครื่องมือใน Admin Portal ได้' : 'ผู้ใช้นี้จะสูญเสียสิทธิ์เข้าถึง Admin Portal ทันที'}
            </p>
          )}
        </div>

        <footer className="grid grid-cols-1 gap-2 border-t border-slate-100 p-4 sm:grid-cols-2 sm:px-7">
          <button type="button" onClick={onClose} disabled={busy} className="min-h-12 rounded-2xl border border-slate-200 bg-slate-50 text-[10px] font-black text-slate-600 disabled:opacity-50">ยกเลิก</button>
          <button type="button" onClick={() => onConfirm(selectedRole)} disabled={busy || !changed || cannotPromote || isCurrentAdmin} className="min-h-12 rounded-2xl bg-violet-600 text-[10px] font-black text-white shadow-lg shadow-violet-100 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none">
            {busy ? <Loader2 size={16} className="mx-auto animate-spin" /> : 'ยืนยันการเปลี่ยนสิทธิ์'}
          </button>
        </footer>
      </div>
    </div>
  );
};

export default UserRoleDialog;
