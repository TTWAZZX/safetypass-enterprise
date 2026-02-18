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
  CalendarClock
} from 'lucide-react';

// ✅ ฟังก์ชันช่วยสร้าง UUID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ✅ ฟังก์ชันแปลงวันที่จาก Excel (รองรับทั้ง Text และ Serial Number)
const processExcelDate = (excelDate: any): string | null => {
    if (!excelDate) return null;

    // กรณีเป็นตัวเลข (Excel Serial Date) เช่น 46387
    if (typeof excelDate === 'number') {
        // Excel เริ่มนับวันที่จาก 30 ธ.ค. 1899
        const date = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
        return !isNaN(date.getTime()) ? date.toISOString() : null;
    }

    // กรณีเป็น String (เช่น "2026-12-31" หรือ "31/12/2026")
    const date = new Date(excelDate);
    return !isNaN(date.getTime()) ? date.toISOString() : null;
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
        query = supabase.from('vendors').select('*').order('name', { ascending: true });
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
    
    let expiryDate = '';
    if (user.induction_expiry) {
        expiryDate = new Date(user.induction_expiry).toISOString().split('T')[0];
    }

    setEditForm({
      name: user.name || '',
      age: user.age || '',
      nationality: user.nationality || 'ไทย (Thai)',
      induction_expiry: expiryDate
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
      logAction('EDIT_USER', editingUser.name, `Updated Profile & Induction Expiry`);
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

  // ✅ แก้ไข: ใช้ processExcelDate เพื่อแปลงวันที่ให้ถูกต้อง
  const handleUserImport = (e: React.ChangeEvent<HTMLInputElement>) => {
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
        let failCount = 0;
        
        for (const row of data) {
          const name = row['Name'];
          const nidRaw = row['NationalID'] || row['National ID'];
          const nid = nidRaw ? String(nidRaw).trim() : null; 
          const vName = row['VendorName'] || row['Vendor'];
          const age = row['Age'] ? Number(row['Age']) : null;
          const nationality = row['Nationality'] || 'ไทย (Thai)';
          
          // ✅ แปลงวันที่ Induction Expiry อย่างฉลาด (รับได้ทั้ง Text และ Number)
          const inductionExpiry = processExcelDate(row['Induction Expiry']);

          if (name && nid) {
            const vendor = allVendors.find(v => v.name === vName);
            
            // 1. เช็คก่อนว่ามี User คนนี้อยู่แล้วหรือยัง
            const { data: existingUser } = await supabase
                .from('users')
                .select('id')
                .eq('national_id', nid)
                .maybeSingle();

            // 2. ใช้ ID เดิม หรือ สร้างใหม่
            const userId = existingUser ? existingUser.id : generateUUID();

            const { error } = await supabase.from('users').upsert([{
              id: userId,
              name, 
              national_id: nid, 
              vendor_id: vendor?.id || null, 
              role: 'USER',
              age: age,
              nationality: nationality,
              induction_expiry: inductionExpiry // ✅ ค่านี้จะถูกต้องแล้ว ไม่เป็นปี 2513
            }], { onConflict: 'national_id' }); 

            if (!error) {
                successCount++;
            } else {
                console.error("Import Error for:", name, error);
                failCount++;
            }
          }
        }
        
        if (failCount > 0) {
            showToast(`Imported ${successCount}, Failed ${failCount}. Check console.`, 'error');
        } else {
            showToast(`Imported ${successCount} entries successfully`, 'success');
        }
        loadData();
      } catch (err) { 
          console.error(err);
          showToast('Invalid File Format or Data Error', 'error'); 
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
    const { error } = await supabase.from('vendors').insert([{ name, status: 'APPROVED' }]);
    if (error) showToast(error.message, 'error');
    else { showToast('Success', 'success'); logAction('CREATE_VENDOR', name); loadData(); }
  };

  const handleDeleteVendor = async (id: string, name: string) => {
    if (!window.confirm(`ยืนยันการลบบริษัท "${name}"?`)) return;
    const { error } = await supabase.from('vendors').delete().eq('id', id);
    if (error) showToast("Cannot delete: Active links exist", 'error');
    else { showToast('Deleted', 'success'); logAction('DELETE_VENDOR', name); loadData(); }
  };

  const handleAddUser = async () => {
    const name = window.prompt("ชื่อ-นามสกุล (Full Name):");
    const nationalId = window.prompt("เลขบัตรประชาชน (National ID):");
    if (!name || !nationalId) return;
    const vendorName = window.prompt("ชื่อบริษัทสังกัด (Affiliation):");
    const vendor = allVendors.find(v => v.name === vendorName);
    
    // ✅ เพิ่มการสร้าง UUID ให้กับการเพิ่ม Manual
    const { error } = await supabase.from('users').insert([{ 
        id: generateUUID(),
        name, 
        national_id: nationalId, 
        vendor_id: vendor?.id || null, 
        role: 'USER' 
    }]);

    if (error) showToast(error.message, 'error'); else { showToast('Success', 'success'); logAction('CREATE_USER', name); loadData(); }
  };

  const handleDeleteUser = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    const { error } = await supabase.from('users').delete().eq('id', id);
    if (error) showToast(error.message, 'error'); else { showToast('Deleted', 'success'); logAction('DELETE_USER', name); loadData(); }
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
      
      {/* 🧭 HEADER & TAB SYSTEM */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 border-b border-slate-200 pb-6">
        <div>
          <h2 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight uppercase leading-none">Directory</h2>
          <div className="text-slate-400 font-bold text-[9px] md:text-[10px] uppercase tracking-[0.2em] mt-2 flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
            Management Access • Secure Node
          </div>
        </div>
        <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200 shadow-inner w-full lg:w-auto overflow-x-auto no-scrollbar">
          <TabButton active={activeTab === 'VENDORS'} onClick={() => setActiveTab('VENDORS')} icon={<Building2 size={14}/>} label="Vendors" />
          <TabButton active={activeTab === 'USERS'} onClick={() => setActiveTab('USERS')} icon={<Users size={14}/>} label="Personnel" />
          <TabButton active={activeTab === 'LOGS'} onClick={() => setActiveTab('LOGS')} icon={<History size={14}/>} label="Audit" />
        </div>
      </div>

      <div className="bg-white rounded-[2rem] md:rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden min-h-[600px]">
        
        {/* 🛠️ TOOLBAR */}
        <div className="p-5 md:p-6 border-b border-slate-100 flex flex-col md:flex-row justify-between gap-4 bg-slate-50/50">
          {activeTab !== 'LOGS' ? (
            <div className="relative flex-1 group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-blue-500 transition-colors" size={18} />
              <input 
                className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all shadow-sm"
                placeholder={`Search ${activeTab.toLowerCase()}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          ) : (
             <div className="flex items-center gap-2 text-slate-400 font-black text-[10px] uppercase tracking-widest px-2">
                <ShieldCheck size={14} /> Security Audit Stream
             </div>
          )}
          
          <div className="flex flex-wrap gap-2 md:ml-auto">
            {activeTab === 'USERS' && (
              <>
                <input type="file" ref={userFileInputRef} className="hidden" accept=".xlsx, .xls" onChange={handleUserImport} />
                <button onClick={() => userFileInputRef.current?.click()} className="flex-1 md:flex-none bg-emerald-50 text-emerald-600 border border-emerald-100 px-4 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-100 transition-all active:scale-95 flex items-center justify-center gap-2">
                  <Upload size={14}/> Import
                </button>
                <button onClick={handleExport} className="flex-1 md:flex-none bg-white text-slate-600 border border-slate-200 px-4 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:border-blue-500 transition-all active:scale-95 flex items-center justify-center gap-2">
                  <Download size={14}/> Export
                </button>
                <button onClick={handleAddUser} className="w-full md:w-auto bg-blue-600 text-white px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-900 transition-all shadow-lg shadow-blue-200 active:scale-95 flex items-center justify-center gap-2">
                  <UserPlus size={14}/> New Entry
                </button>
              </>
            )}

            {activeTab === 'VENDORS' && (
              <>
                <input type="file" ref={vendorFileInputRef} className="hidden" accept=".xlsx, .xls" onChange={handleVendorImport} />
                <button onClick={() => vendorFileInputRef.current?.click()} className="flex-1 md:flex-none bg-emerald-50 text-emerald-600 border border-emerald-100 px-4 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-100 transition-all active:scale-95 flex items-center justify-center gap-2">
                  <Upload size={14}/> Import
                </button>
                <button onClick={handleExport} className="flex-1 md:flex-none bg-white text-slate-600 border border-slate-200 px-4 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:border-blue-500 transition-all active:scale-95 flex items-center justify-center gap-2">
                  <Download size={14}/> Export
                </button>
                <button onClick={handleAddVendor} className="w-full md:w-auto bg-blue-600 text-white px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-900 transition-all shadow-lg shadow-blue-200 active:scale-95 flex items-center justify-center gap-2">
                  <Plus size={14}/> New Vendor
                </button>
              </>
            )}
          </div>
        </div>

        {/* 📊 DATA TABLE */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-32 text-center text-slate-300 font-black uppercase text-[10px] tracking-[0.3em] flex flex-col items-center gap-4">
               <Loader2 className="animate-spin text-blue-500" size={32}/> 
               Accessing Secure Node...
            </div>
          ) : (
            <table className="w-full text-left min-w-[800px]">
              <thead className="bg-slate-50/50 text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">
                <tr>
                  {activeTab === 'LOGS' ? (
                    <>
                      <th className="px-8 py-5">Event Timestamp</th>
                      <th className="px-8 py-5">Administrator</th>
                      <th className="px-8 py-5">Protocol</th>
                      <th className="px-8 py-5">Registry Details</th>
                    </>
                  ) : (
                    <>
                      <th className="px-8 py-5">Identity / Profile</th>
                      <th className="px-8 py-5">Compliance Affiliation</th>
                      <th className="px-8 py-5 text-center">System Actions</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {activeTab === 'LOGS' ? (
                  filtered.map((log: any) => (
                    <tr key={log.id} className="hover:bg-slate-50/30 transition-colors">
                      <td className="px-8 py-5 text-[11px] font-black text-slate-500 font-mono tracking-tighter">
                        {new Date(log.created_at).toLocaleString('th-TH')}
                      </td>
                      <td className="px-8 py-5 text-xs font-bold text-slate-700">{log.admin_email}</td>
                      <td className="px-8 py-5">
                        <span className="bg-slate-100 text-slate-600 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border border-slate-200">
                          {log.action}
                        </span>
                      </td>
                      <td className="px-8 py-5 text-xs text-slate-600">
                        <div className="font-black text-slate-900 uppercase">{log.target}</div>
                        <div className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">{log.details}</div>
                      </td>
                    </tr>
                  ))
                ) : (
                  filtered.map(item => (
                    <tr key={item.id} className="hover:bg-slate-50/30 transition-colors group">
                      <td className="px-8 py-5 text-left">
                        <div className="flex items-center gap-3">
                           <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-400 group-hover:bg-blue-600 group-hover:text-white transition-all flex items-center justify-center font-black text-xs">
                              {item.name ? item.name.charAt(0) : '?'}
                           </div>
                           <div className="min-w-0">
                              <div className="font-black text-slate-800 uppercase text-xs truncate group-hover:text-blue-600 transition-colors">{item.name}</div>
                              {activeTab === 'USERS' && <div className="text-[10px] text-slate-400 font-mono mt-0.5 tracking-tighter">{item.national_id}</div>}
                           </div>
                        </div>
                      </td>
                      <td className="px-8 py-5 text-left">
                        {activeTab === 'VENDORS' ? (
                          <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black border uppercase shadow-sm ${item.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>
                            <div className={`w-1 h-1 rounded-full ${item.status === 'APPROVED' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                            {item.status}
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1">
                            <span className="text-slate-500 font-black text-[9px] uppercase bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-100 truncate max-w-[200px] block w-fit">
                              {item.vendors?.name || 'External / Unassigned'}
                            </span>
                            {/* แสดงสถานะ Induction */}
                            {item.induction_expiry ? (
                              <span className="text-[8px] font-black text-emerald-500 uppercase flex items-center gap-1">
                                <CheckCircle size={8} /> Exp: {new Date(item.induction_expiry).toLocaleDateString('th-TH')}
                              </span>
                            ) : (
                               <span className="text-[8px] font-black text-amber-500 uppercase flex items-center gap-1">
                                <RotateCcw size={8} /> Not Certified
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-8 py-5">
                        <div className="flex justify-center gap-1.5">
                          <button 
                            onClick={() => activeTab === 'VENDORS' ? handleEditVendor(item.id, item.name) : handleEditUser(item)}
                            title="Edit Profile"
                            className="p-2.5 rounded-xl border border-slate-100 text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-all active:scale-90"
                          >
                            <Edit3 size={16} />
                          </button>

                          {activeTab === 'USERS' && (
                            <button onClick={() => handleResetTraining(item.id, item.name)} title="Reset Compliance" className="p-2.5 rounded-xl border border-amber-100 text-amber-500 hover:bg-amber-50 transition-all active:scale-90">
                              <RotateCcw size={16} />
                            </button>
                          )}
                          
                          {activeTab === 'VENDORS' && item.status === 'PENDING' && (
                            <button onClick={() => api.approveVendor(item.id).then(loadData)} className="p-2.5 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 shadow-md active:scale-90 transition-all">
                              <CheckCircle size={16} />
                            </button>
                          )}

                          <button onClick={() => activeTab === 'VENDORS' ? handleDeleteVendor(item.id, item.name) : handleDeleteUser(item.id, item.name)} title="Purge Record" className="p-2.5 rounded-xl border border-slate-100 text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all active:scale-90">
                            <Trash2 size={16} />
                          </button>
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

      {/* ================= 📝 EDIT USER MODAL ================= */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => setIsEditModalOpen(false)} />
          
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl border border-slate-100 overflow-hidden relative z-10 animate-in zoom-in-95 duration-300">
            <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight uppercase">Edit Personnel Profile</h3>
                <p className="text-[10px] text-blue-600 font-bold uppercase tracking-widest mt-1">ID: {editingUser?.national_id}</p>
              </div>
              <button onClick={() => setIsEditModalOpen(false)} className="p-2 hover:bg-white rounded-xl transition-all text-slate-400 hover:text-red-500 border border-transparent hover:border-slate-100">
                <X size={20} />
              </button>
            </div>

            <div className="p-8 space-y-6 overflow-y-auto max-h-[60vh]">
              {/* Name Field */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 flex items-center gap-2">
                   Name-Surname / ชื่อ-นามสกุล
                </label>
                <div className="relative">
                  <input
                    className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold text-slate-800 outline-none focus:border-blue-500 focus:bg-white transition-all shadow-inner"
                    value={editForm.name}
                    onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Age Field */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 flex items-center gap-2">
                    <Calendar size={12} /> Age / อายุ
                  </label>
                  <input
                    type="number"
                    className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold text-slate-800 outline-none focus:border-blue-500 focus:bg-white transition-all shadow-inner"
                    value={editForm.age}
                    onChange={e => setEditForm({ ...editForm, age: e.target.value })}
                  />
                </div>

                {/* Nationality Dropdown */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 flex items-center gap-2">
                    <Globe2 size={12} /> Nationality
                  </label>
                  <select
                    className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold text-slate-800 outline-none focus:border-blue-500 focus:bg-white transition-all appearance-none cursor-pointer shadow-inner"
                    value={isOtherNationality ? 'OTHER' : editForm.nationality}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === 'OTHER') {
                        setIsOtherNationality(true);
                        setEditForm({ ...editForm, nationality: '' });
                      } else {
                        setIsOtherNationality(false);
                        setEditForm({ ...editForm, nationality: val });
                      }
                    }}
                  >
                    <option value="ไทย (Thai)">ไทย (Thai)</option>
                    <option value="พม่า (Myanmar)">พม่า (Myanmar)</option>
                    <option value="กัมพูชา (Cambodian)">กัมพูชา (Cambodian)</option>
                    <option value="ลาว (Lao)">ลาว (Lao)</option>
                    <option value="OTHER">อื่นๆ / Other</option>
                  </select>
                </div>
              </div>

              {/* Other Nationality Input */}
              {isOtherNationality && (
                <div className="animate-in slide-in-from-top-2 duration-300">
                  <label className="text-[9px] font-black text-blue-500 uppercase tracking-widest ml-1">Specify Other Nationality</label>
                  <input
                    className="w-full bg-blue-50 border-2 border-blue-100 p-4 rounded-2xl font-bold text-blue-600 outline-none focus:border-blue-500 transition-all shadow-sm"
                    placeholder="Enter nationality..."
                    value={editForm.nationality}
                    onChange={e => setEditForm({ ...editForm, nationality: e.target.value })}
                  />
                </div>
              )}

              {/* ✅ ส่วน Override Induction Date (Admin Only Feature) */}
              <div className="pt-4 border-t border-slate-100">
                <div className="bg-amber-50 border border-amber-100 p-4 rounded-2xl">
                    <label className="text-[10px] font-black text-amber-600 uppercase tracking-widest ml-1 flex items-center gap-2 mb-2">
                        <CalendarClock size={14} /> Induction Expiry Override
                    </label>
                    <div className="text-[9px] text-amber-500 mb-2 font-bold leading-tight">
                        * สำหรับผู้ที่มีใบเซอร์จากที่อื่นแล้ว กำหนดวันที่หมดอายุที่นี่เพื่อข้ามการสอบ (Bypass Exam)
                    </div>
                    <input
                        type="date"
                        className="w-full bg-white border border-amber-200 p-3 rounded-xl font-bold text-slate-800 outline-none focus:border-amber-500 transition-all shadow-inner"
                        value={editForm.induction_expiry}
                        onChange={e => setEditForm({ ...editForm, induction_expiry: e.target.value })}
                    />
                </div>
              </div>

            </div>

            <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
              <button 
                onClick={() => setIsEditModalOpen(false)}
                className="flex-1 py-4 bg-white text-slate-500 font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl border border-slate-200 hover:bg-slate-100 transition-all active:scale-95"
              >
                Cancel
              </button>
              <button 
                onClick={saveUserEdit}
                disabled={submitting}
                className="flex-1 py-4 bg-blue-600 text-white font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 className="animate-spin" size={16} /> : 'Save Protocol'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* --- 🔵 SHARED COMPONENTS --- */

const TabButton = ({ active, onClick, icon, label }: any) => (
  <button 
    onClick={onClick} 
    className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all whitespace-nowrap active:scale-95 ${
      active 
        ? 'bg-white text-blue-600 shadow-md' 
        : 'text-slate-400 hover:text-slate-600 hover:bg-white/50'
    }`}
  >
    <span className={active ? 'text-blue-500' : 'opacity-50'}>{icon}</span> 
    {label}
  </button>
);

export default VendorManager;