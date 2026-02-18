import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../services/supabaseClient';
import { api } from '../services/supabaseApi';
import { useToastContext } from './ToastProvider';
import * as XLSX from 'xlsx';
import { 
  Users, 
  Building2, 
  Search, 
  Plus, 
  RotateCcw, 
  CheckCircle, 
  Loader2,
  Trash2,
  Edit3,
  UserPlus,
  Upload,
  Download,
  History,
  ShieldCheck,
  X,
  Globe2,
  Calendar,
  CalendarClock,
  Ban,
  Clock,
  CheckCircle2
} from 'lucide-react';

// ✅ ฟังก์ชันช่วยสร้าง UUID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ✅ ฟังก์ชันแปลงวันที่จาก Excel (รองรับ DD/MM/YYYY และ Serial Number)
const processExcelDate = (excelDate: any): string | null => {
    if (!excelDate) return null;
    try {
        if (typeof excelDate === 'number') {
            const date = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
            return !isNaN(date.getTime()) ? date.toISOString() : null;
        }
        // กรณีเป็น String รูปแบบ DD/MM/YYYY ตามในไฟล์ตัวอย่างที่แนบมา
        if (typeof excelDate === 'string' && excelDate.includes('/')) {
            const [day, month, year] = excelDate.split('/');
            const date = new Date(`${year}-${month}-${day}`);
            return !isNaN(date.getTime()) ? date.toISOString() : null;
        }
        const date = new Date(excelDate);
        return !isNaN(date.getTime()) ? date.toISOString() : null;
    } catch { return null; }
};

const VendorManager: React.FC = () => {
  const { showToast } = useToastContext();
  const [activeTab, setActiveTab] = useState<'USERS' | 'VENDORS' | 'LOGS'>('VENDORS');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [dataList, setDataList] = useState<any[]>([]);
  const [allVendors, setAllVendors] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  
  // ✅ Modal States
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [editForm, setEditForm] = useState({ name: '', age: '', nationality: '', induction_expiry: '' });
  const [isOtherNationality, setIsOtherNationality] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const userFileInputRef = useRef<HTMLInputElement>(null);
  const vendorFileInputRef = useRef<HTMLInputElement>(null);

  const logAction = async (action: string, target: string, details: string = '') => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('audit_logs').insert([{
        admin_email: user?.email || 'System Admin',
        action,
        target,
        details
      }]);
    } catch (err) {
      console.error('Audit log failure:', err);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      let query: any;
      if (activeTab === 'VENDORS') {
        query = supabase.from('vendors').select('*').order('created_at', { ascending: false });
      } else if (activeTab === 'USERS') {
        query = supabase.from('users').select('*, vendors(name)').order('created_at', { ascending: false });
      } else {
        query = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100);
      }

      const { data, error } = await query;
      if (error) throw error;

      if (activeTab === 'LOGS') setLogs(data || []);
      else setDataList(data || []);

      const { data: vData } = await supabase.from('vendors').select('id, name').eq('status', 'APPROVED');
      setAllVendors(vData || []);

    } catch (err: any) {
      showToast('ไม่สามารถโหลดข้อมูลได้: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [activeTab]);

  const handleUpdateVendorStatus = async (id: string, name: string, newStatus: 'APPROVED' | 'REJECTED') => {
    const confirmMsg = newStatus === 'APPROVED' ? `ยืนยันการอนุมัติบริษัท ${name}?` : `ยืนยันการปฏิเสธบริษัท ${name}?`;
    if (!window.confirm(confirmMsg)) return;

    try {
      const { error } = await supabase.from('vendors').update({ status: newStatus }).eq('id', id);
      if (error) throw error;
      
      showToast(`ปรับสถานะบริษัท ${name} เป็น ${newStatus} สำเร็จ`, 'success');
      logAction(`VENDOR_${newStatus}`, name, `Status updated to ${newStatus}`);
      loadData();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleEditVendor = async (id: string, currentName: string) => {
    const newName = window.prompt("แก้ไขชื่อบริษัท (Edit Company Name):", currentName);
    if (!newName || newName === currentName) return;
    const { error } = await supabase.from('vendors').update({ name: newName }).eq('id', id);
    if (error) showToast(error.message, 'error');
    else { 
      showToast('แก้ไขชื่อบริษัทสำเร็จ', 'success'); 
      logAction('EDIT_VENDOR', currentName, `Changed to ${newName}`);
      loadData(); 
    }
  };

  const handleEditUser = (user: any) => {
    setEditingUser(user);
    const nationalities = ['ไทย (Thai)', 'พม่า (Myanmar)', 'กัมพูชา (Cambodian)', 'ลาว (Lao)'];
    const isOther = user.nationality && !nationalities.includes(user.nationality);
    
    setEditForm({
      name: user.name || '',
      age: user.age || '',
      nationality: user.nationality || 'ไทย (Thai)',
      induction_expiry: user.induction_expiry ? new Date(user.induction_expiry).toISOString().split('T')[0] : ''
    });
    setIsOtherNationality(isOther);
    setIsEditModalOpen(true);
  };

  const saveUserEdit = async () => {
    if (!editingUser) return;
    setSubmitting(true);
    try {
      const expiryVal = editForm.induction_expiry ? new Date(editForm.induction_expiry).toISOString() : null;

      const { error } = await supabase.from('users').update({
        name: editForm.name,
        age: Number(editForm.age),
        nationality: editForm.nationality,
        induction_expiry: expiryVal 
      }).eq('id', editingUser.id);

      if (error) throw error;

      showToast('อัปเดตข้อมูลพนักงานสำเร็จ', 'success');
      logAction('EDIT_USER', editingUser.name, `Updated Profile`);
      setIsEditModalOpen(false);
      loadData();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleExport = () => {
    let exportData = [];
    let fileName = '';

    if (activeTab === 'USERS') {
      exportData = dataList.map(user => ({
        'Name': user.name,
        'National ID': user.national_id,
        'Vendor': user.vendors?.name || 'N/A',
        'Role': user.role,
        'Age': user.age || '',
        'Nationality': user.nationality || '',
        'Status': user.induction_expiry ? 'Certified' : 'Pending',
        'Induction Expiry': user.induction_expiry ? new Date(user.induction_expiry).toLocaleDateString() : '-'
      }));
      fileName = `Personnel_List_${new Date().toISOString().split('T')[0]}.xlsx`;
    } else if (activeTab === 'VENDORS') {
      exportData = dataList.map(vendor => ({
        'Company Name': vendor.name,
        'Status': vendor.status,
        'Registry Date': new Date(vendor.created_at).toLocaleDateString()
      }));
      fileName = `Vendor_List_${new Date().toISOString().split('T')[0]}.xlsx`;
    }

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, activeTab);
    XLSX.writeFile(wb, fileName);
    showToast('Exported Successfully', 'success');
  };

  // ✅ แก้ไขปัญหาการนำเข้า: รองรับหัวตารางไฟล์จริงของคุณ และแก้ปัญหาเลขยกกำลัง (Scientific Notation)
  const handleUserImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary', cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data: any[] = XLSX.utils.sheet_to_json(ws);
        let success = 0;
        let fail = 0;
        
        for (const row of data) {
          // ✅ ดึงค่าจากหัวตารางที่มีช่องว่างตามไฟล์ Excel จริงของคุณ
          const name = (row['Name'] || '').toString().trim();
          
          // ✅ จัดการเลขบัตรประชาชน (แก้ปัญหา 1.1457E+12)
          let nid = (row['National ID'] || '').toString().trim();
          if (nid.includes('E+') || nid.includes('e+')) {
              nid = Number(nid).toLocaleString('fullwide', {useGrouping:false});
          }

          // ✅ ใช้ Vendor ตามหัวตารางในไฟล์
          const vName = (row['Vendor'] || '').toString().trim();
          
          if (name && nid) {
            const vendor = allVendors.find(v => v.name === vName);
            
            // ✅ ค้นหาพนักงานเดิมเพื่อดึง ID (ป้องกัน Error 23503 ประวัติการสอบหาย)
            const { data: exist } = await supabase
                .from('users')
                .select('id')
                .eq('national_id', nid)
                .maybeSingle();

            const payload: any = {
              name,
              national_id: nid,
              vendor_id: vendor?.id || null,
              role: row['Role'] || 'USER',
              age: row['Age'] ? Number(row['Age']) : null,
              nationality: row['Nationality'] || 'ไทย (Thai)',
              induction_expiry: processExcelDate(row['Induction Expiry']), // ✅ นำเข้า Induction Expiry
              pdpa_agreed: true
            };

            // ✅ ถ้ามีอยู่แล้วให้ใช้ ID เดิมเพื่ออัปเดต ถ้าไม่มีให้สร้าง UUID ใหม่
            payload.id = exist ? exist.id : generateUUID();

            const { error } = await supabase
                .from('users')
                .upsert([payload], { 
                    onConflict: 'national_id_hash', // ✅ อ้างอิงตามกฎ UNIQUE ของระบบ Secure Node
                    ignoreDuplicates: false 
                });

            if (!error) success++; else { console.error("Upsert Error Detail:", error); fail++; }
          }
        }
        showToast(fail > 0 ? `นำเข้าสำเร็จ ${success}, ล้มเหลว ${fail}` : `นำเข้าสำเร็จ ${success} รายการ`, fail > 0 ? 'error' : 'success');
        loadData();
      } catch (err) { 
        console.error("Reader Error:", err);
        showToast('รูปแบบไฟล์ไม่ถูกต้อง', 'error'); 
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const handleVendorImport = (e: React.ChangeEvent<HTMLInputElement>) => {
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
          const name = row['CompanyName'] || row['Name'];
          if (name) {
            const { error } = await supabase.from('vendors').upsert([{ name, status: 'APPROVED' }], { onConflict: 'name' });
            if (!error) successCount++;
          }
        }
        showToast(`Imported ${successCount} vendors`, 'success');
        loadData();
      } catch (err) { showToast('Invalid File Format', 'error'); }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const handleAddVendor = async () => {
    const name = window.prompt("ชื่อบริษัทใหม่ (New Company Name):");
    if (!name) return;
    const { error } = await supabase.from('vendors').insert([{ name, status: 'PENDING' }]);
    if (error) showToast(error.message, 'error');
    else { showToast('ลงทะเบียนบริษัทแล้ว กรุณาตรวจสอบและอนุมัติ', 'success'); logAction('CREATE_VENDOR', name); loadData(); }
  };

  const handleDeleteVendor = async (id: string, name: string) => {
    if (!window.confirm(`ยืนยันการลบบริษัท "${name}"?`)) return;
    const { error } = await supabase.from('vendors').delete().eq('id', id);
    if (error) showToast("Cannot delete: Active links exist", 'error');
    else { showToast('Deleted', 'success'); logAction('DELETE_VENDOR', name); loadData(); }
  };

  const handleAddUser = async () => {
    const name = window.prompt("ชื่อ-นามสกุล:");
    const nid = window.prompt("เลขบัตรประชาชน:");
    if (!name || !nid) return;
    const { error } = await supabase.from('users').insert([{ id: generateUUID(), name, national_id: nid, role: 'USER' }]);
    if (error) showToast(error.message, 'error'); else { showToast('Success', 'success'); loadData(); }
  };

  const handleDeleteUser = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    const { error } = await supabase.from('users').delete().eq('id', id);
    if (error) showToast(error.message, 'error'); else { showToast('Deleted', 'success'); loadData(); }
  };

  const handleResetTraining = async (id: string, name: string) => {
    if(!window.confirm("Reset induction status for this user?")) return;
    const { error } = await supabase.from('users').update({ induction_expiry: null }).eq('id', id);
    if (error) showToast(error.message, 'error'); else { showToast('Reset Complete', 'success'); logAction('RESET_TRAINING', name); loadData(); }
  };

  const filtered = activeTab === 'LOGS' ? logs : dataList.filter(item => 
    (item.name || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
    (item.national_id || '').includes(searchQuery)
  );

  return (
    <div className="space-y-6 text-left animate-in fade-in duration-500 pb-10 relative">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 border-b border-slate-200 pb-6">
        <div>
          <h2 className="text-2xl md:text-3xl font-black text-slate-900 uppercase">Directory Control</h2>
          <div className="text-slate-400 font-bold text-[10px] uppercase tracking-[0.2em] mt-2 flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" /> Security Compliance Node
          </div>
        </div>
        <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200 shadow-inner overflow-x-auto no-scrollbar">
          <TabButton active={activeTab === 'VENDORS'} onClick={() => setActiveTab('VENDORS')} icon={<Building2 size={14}/>} label="Vendors" />
          <TabButton active={activeTab === 'USERS'} onClick={() => setActiveTab('USERS')} icon={<Users size={14}/>} label="Personnel" />
          <TabButton active={activeTab === 'LOGS'} onClick={() => setActiveTab('LOGS')} icon={<History size={14}/>} label="Audit" />
        </div>
      </div>

      <div className="bg-white rounded-[2rem] md:rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden min-h-[600px]">
        <div className="p-5 md:p-6 border-b border-slate-100 flex flex-col md:flex-row justify-between gap-4 bg-slate-50/50">
          {activeTab !== 'LOGS' ? (
            <div className="relative flex-1 group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
              <input className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all shadow-sm" placeholder={`Search ${activeTab.toLowerCase()}...`} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>
          ) : <div className="text-slate-400 font-black text-[10px] uppercase px-2 flex items-center gap-2"><ShieldCheck size={14} /> System Access History</div>}
          
          <div className="flex flex-wrap gap-2 md:ml-auto">
            {activeTab !== 'LOGS' && (
              <>
                <input type="file" ref={activeTab === 'USERS' ? userFileInputRef : vendorFileInputRef} className="hidden" accept=".xlsx, .xls" onChange={activeTab === 'USERS' ? handleUserImport : handleVendorImport} />
                <button onClick={() => (activeTab === 'USERS' ? userFileInputRef : vendorFileInputRef).current?.click()} className="bg-emerald-50 text-emerald-600 border border-emerald-100 px-4 py-3 rounded-xl font-black text-[10px] uppercase hover:bg-emerald-100 transition-all flex items-center justify-center gap-2 shadow-sm"><Upload size={14}/> Import Excel</button>
                <button onClick={handleExport} className="bg-white text-slate-600 border border-slate-200 px-4 py-3 rounded-xl font-black text-[10px] uppercase hover:bg-slate-50 transition-all flex items-center justify-center gap-2 shadow-sm"><Download size={14}/> Export</button>
                <button onClick={activeTab === 'USERS' ? handleAddUser : handleAddVendor} className="bg-blue-600 text-white px-6 py-3 rounded-xl font-black text-[10px] uppercase hover:bg-slate-900 transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2"><Plus size={14}/> New Entry</button>
              </>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          {loading ? <div className="p-32 text-center"><Loader2 className="animate-spin text-blue-500 mx-auto" size={32}/></div> : (
            <table className="w-full text-left min-w-[900px]">
              <thead className="bg-slate-50/50 text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">
                <tr>
                  <th className="px-8 py-5 text-left">Profile / Identity</th>
                  <th className="px-8 py-5 text-left">Compliance / Status</th>
                  <th className="px-8 py-5 text-center">Protocol Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {activeTab === 'LOGS' ? (
                  logs.map((log: any) => (
                    <tr key={log.id} className="hover:bg-slate-50/30 transition-colors">
                      <td className="px-8 py-5 text-[11px] font-black text-slate-500 font-mono tracking-tighter">{new Date(log.created_at).toLocaleString('th-TH')}</td>
                      <td className="px-8 py-5 text-xs font-bold text-slate-700">{log.admin_email}</td>
                      <td className="px-8 py-5 text-xs font-black text-slate-600 uppercase">{log.action}</td>
                      <td className="px-8 py-5 text-xs text-slate-600 font-bold uppercase">{log.target}</td>
                    </tr>
                  ))
                ) : (
                  filtered.map(item => (
                    <tr key={item.id} className="hover:bg-slate-50/30 transition-colors group text-left">
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-3">
                           <div className="w-10 h-10 rounded-2xl bg-slate-100 text-slate-400 group-hover:bg-blue-600 group-hover:text-white transition-all flex items-center justify-center font-black text-xs shadow-inner">{item.name?.charAt(0)}</div>
                           <div><div className="font-black text-slate-800 uppercase text-xs truncate max-w-[200px]">{item.name}</div>{activeTab === 'USERS' && <div className="text-[10px] text-slate-400 font-mono mt-0.5 tracking-tighter">ID: {item.national_id}</div>}</div>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        {activeTab === 'VENDORS' ? (
                          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[9px] font-black border uppercase shadow-sm ${item.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : item.status === 'REJECTED' ? 'bg-red-50 text-red-600 border-red-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>
                            {item.status || 'PENDING'}
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1 text-left">
                            <span className="text-slate-500 font-black text-[10px] uppercase bg-slate-50 px-3 py-1 rounded-xl border w-fit shadow-sm">{item.vendors?.name || 'EXTERNAL'}</span>
                            {item.induction_expiry && <span className="text-[9px] font-black text-emerald-600 flex items-center gap-1 ml-1"><CheckCircle size={10}/> Certified Exp: {new Date(item.induction_expiry).toLocaleDateString('th-TH')}</span>}
                          </div>
                        )}
                      </td>
                      <td className="px-8 py-5">
                        <div className="flex justify-center gap-2">
                          {activeTab === 'VENDORS' && item.status !== 'APPROVED' && (
                            <button onClick={() => handleUpdateVendorStatus(item.id, item.name, 'APPROVED')} className="p-2.5 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 shadow-lg active:scale-90 transition-all"><CheckCircle size={16} /></button>
                          )}
                          {activeTab === 'VENDORS' && item.status === 'PENDING' && (
                            <button onClick={() => handleUpdateVendorStatus(item.id, item.name, 'REJECTED')} title="Reject" className="p-2.5 rounded-xl border text-red-500 hover:bg-red-50 active:scale-90 transition-all"><Ban size={16} /></button>
                          )}
                          <button onClick={() => activeTab === 'VENDORS' ? handleEditVendor(item.id, item.name) : handleEditUser(item)} className="p-2.5 rounded-xl border border-slate-100 text-slate-400 hover:text-blue-600 hover:bg-blue-50 active:scale-90 transition-all"><Edit3 size={16} /></button>
                          {activeTab === 'USERS' && (
                            <button onClick={() => handleResetTraining(item.id, item.name)} title="Reset Compliance" className="p-2.5 rounded-xl border border-amber-100 text-amber-500 hover:bg-amber-50 transition-all active:scale-90"><RotateCcw size={16} /></button>
                          )}
                          <button onClick={() => activeTab === 'VENDORS' ? handleDeleteVendor(item.id, item.name) : handleDeleteUser(item.id, item.name)} className="p-2.5 rounded-xl border border-slate-100 text-slate-300 hover:text-red-500 hover:bg-red-50 active:scale-90 transition-all"><Trash2 size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* 📝 EDIT USER MODAL (Fixed Container Hydration) */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => setIsEditModalOpen(false)} />
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl border relative z-10 p-8 text-left animate-in zoom-in-95 duration-300">
              <div className="flex justify-between items-center mb-6 border-b pb-4">
                  <div><h3 className="text-xl font-black text-slate-900 uppercase">Edit Profile</h3><p className="text-[10px] text-blue-500 font-bold uppercase tracking-widest mt-1">ID: {editingUser?.national_id}</p></div>
                  <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-red-500 transition-colors"><X size={24}/></button>
              </div>
              <div className="space-y-4">
                  <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Full Name</label><input className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold shadow-inner" value={editForm.name} onChange={e=>setEditForm({...editForm, name: e.target.value})}/></div>
                  <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Age / อายุ</label><input type="number" className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold shadow-inner" value={editForm.age} onChange={e=>setEditForm({...editForm, age: e.target.value})}/></div>
                      <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Nationality</label><input className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold shadow-inner" value={editForm.nationality} onChange={e=>setEditForm({...editForm, nationality: e.target.value})}/></div>
                  </div>
                  <div className="bg-amber-50 p-5 rounded-3xl border border-amber-100 shadow-sm mt-4 text-left">
                      <label className="text-[10px] font-black text-amber-600 uppercase flex items-center gap-2 mb-3"><CalendarClock size={16}/> Induction Expiry (Override)</label>
                      <input type="date" className="w-full bg-white border border-amber-200 p-3 rounded-xl font-bold outline-none focus:border-amber-500 transition-all" value={editForm.induction_expiry} onChange={e=>setEditForm({...editForm, induction_expiry: e.target.value})}/>
                  </div>
              </div>
              <div className="flex gap-3 mt-8">
                  <button onClick={()=>setIsEditModalOpen(false)} className="flex-1 py-4 bg-slate-50 text-slate-400 font-black rounded-2xl text-[10px] uppercase border border-slate-200 hover:bg-slate-100 transition-all active:scale-95">Cancel</button>
                  <button onClick={saveUserEdit} disabled={submitting} className="flex-1 py-4 bg-blue-600 text-white font-black rounded-2xl text-[10px] uppercase shadow-lg shadow-blue-200 hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                    {submitting ? <Loader2 className="animate-spin" size={16} /> : 'Save Protocol'}
                  </button>
              </div>
          </div>
        </div>
      )}
    </div>
  );
};

const TabButton = ({ active, onClick, icon, label }: any) => (
  <button onClick={onClick} className={`px-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all whitespace-nowrap active:scale-95 ${active ? 'bg-white text-blue-600 shadow-md border-b-2 border-blue-500' : 'text-slate-400 hover:text-slate-600 hover:bg-white/50'}`}>{icon} {label}</button>
);

export default VendorManager;