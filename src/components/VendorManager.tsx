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
  XCircle, 
  Loader2,
  Trash2,
  Edit3, // ✅ นำปุ่มแก้ไขกลับมาแล้ว
  UserPlus,
  Upload,
  Download,
  History
} from 'lucide-react';

const VendorManager: React.FC = () => {
  const { showToast } = useToastContext();
  const [activeTab, setActiveTab] = useState<'USERS' | 'VENDORS' | 'LOGS'>('VENDORS');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [dataList, setDataList] = useState<any[]>([]);
  const [allVendors, setAllVendors] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  
  const userFileInputRef = useRef<HTMLInputElement>(null);
  const vendorFileInputRef = useRef<HTMLInputElement>(null);

  // 🟢 Helper: บันทึก Audit Log
  const logAction = async (action: string, target: string, details: string = '') => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('audit_logs').insert([{
        admin_email: user?.email || 'Unknown Admin',
        action,
        target,
        details
      }]);
    } catch (err) {
      console.error('Failed to log action', err);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. ดึงข้อมูลหลักตาม Tab
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

      // 2. ดึง Vendor List สำรองไว้เสมอ (สำหรับใช้ใน Dropdown หรือ Import)
      const { data: vData } = await supabase.from('vendors').select('id, name').eq('status', 'APPROVED');
      setAllVendors(vData || []);

    } catch (err: any) {
      showToast('ไม่สามารถโหลดข้อมูลได้: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [activeTab]);

  // ================= [ EDIT FUNCTIONS - กู้คืนกลับมาแล้ว ] =================
  const handleEditVendor = async (id: string, currentName: string) => {
    const newName = window.prompt("แก้ไขชื่อบริษัท:", currentName);
    if (!newName || newName === currentName) return;
    const { error } = await supabase.from('vendors').update({ name: newName }).eq('id', id);
    if (error) showToast(error.message, 'error');
    else { 
      showToast('แก้ไขชื่อบริษัทสำเร็จ', 'success'); 
      logAction('EDIT_VENDOR', currentName, `Changed to ${newName}`);
      loadData(); 
    }
  };

  const handleEditUser = async (user: any) => {
    const newName = window.prompt("แก้ไขชื่อพนักงาน:", user.name);
    if (!newName || newName === user.name) return;
    const { error } = await supabase.from('users').update({ name: newName }).eq('id', user.id);
    if (error) showToast(error.message, 'error');
    else { 
      showToast('แก้ไขข้อมูลสำเร็จ', 'success'); 
      logAction('EDIT_USER', user.name, `Changed name to ${newName}`);
      loadData(); 
    }
  };

  // ================= [ EXCEL EXPORT ] =================
  const handleExport = () => {
    let exportData = [];
    let fileName = '';

    if (activeTab === 'USERS') {
      exportData = dataList.map(user => ({
        'Name': user.name,
        'National ID': user.national_id,
        'Vendor': user.vendors?.name || 'N/A',
        'Role': user.role,
        'Training Status': user.induction_expiry ? 'Passed' : 'Not Passed'
      }));
      fileName = `SafetyPass_Users_${new Date().toISOString().split('T')[0]}.xlsx`;
    } else if (activeTab === 'VENDORS') {
      exportData = dataList.map(vendor => ({
        'Company Name': vendor.name,
        'Status': vendor.status,
        'Created At': new Date(vendor.created_at).toLocaleDateString()
      }));
      fileName = `SafetyPass_Vendors_${new Date().toISOString().split('T')[0]}.xlsx`;
    }

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, activeTab === 'USERS' ? "Users" : "Vendors");
    XLSX.writeFile(wb, fileName);
    
    logAction('EXPORT', activeTab, `Exported ${activeTab.toLowerCase()} list`);
    showToast('ดาวน์โหลดไฟล์ Excel เรียบร้อย', 'success');
  };

  // ================= [ EXCEL IMPORT ] =================
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
        let successCount = 0; let failCount = 0;

        for (const row of data) {
          const name = row['Name'];
          const nid = row['NationalID'] || row['National ID'];
          const vName = row['VendorName'] || row['Vendor'];

          if (name && nid) {
            const vendor = allVendors.find(v => v.name === vName);
            const { error } = await supabase.from('users').insert([{
              name: name,
              national_id: String(nid),
              vendor_id: vendor?.id || null,
              role: 'USER'
            }]);
            if (!error) successCount++; else failCount++;
          }
        }
        logAction('BULK_IMPORT_USERS', `${successCount} Users`, `Failed: ${failCount}`);
        showToast(`นำเข้าสำเร็จ ${successCount} คน`, 'success');
        loadData();
      } catch (err) { showToast('ไฟล์ไม่ถูกต้อง', 'error'); }
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
        let successCount = 0; let failCount = 0;

        for (const row of data) {
          const name = row['CompanyName'] || row['Company Name'] || row['Name'];
          if (name) {
            const { error } = await supabase.from('vendors').insert([{ name, status: 'APPROVED' }]);
            if (!error) successCount++; else failCount++;
          }
        }
        logAction('BULK_IMPORT_VENDORS', `${successCount} Vendors`, `Failed: ${failCount}`);
        showToast(`นำเข้าสำเร็จ ${successCount} แห่ง`, 'success');
        loadData();
      } catch (err) { showToast('ไฟล์ไม่ถูกต้อง', 'error'); }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  // ================= [ CRUD ACTIONS ] =================
  const handleAddVendor = async () => {
    const name = window.prompt("ระบุชื่อบริษัทใหม่:");
    if (!name) return;
    const { error } = await supabase.from('vendors').insert([{ name, status: 'APPROVED' }]);
    if (error) showToast(error.message, 'error');
    else { showToast('เพิ่มบริษัทสำเร็จ', 'success'); logAction('CREATE_VENDOR', name); loadData(); }
  };
  const handleDeleteVendor = async (id: string, name: string) => {
    if (!window.confirm(`ยืนยันการลบบริษัท "${name}"?`)) return;
    const { error } = await supabase.from('vendors').delete().eq('id', id);
    if (error) showToast("ลบไม่ได้เนื่องจากมีข้อมูลเชื่อมโยง", 'error');
    else { showToast('ลบสำเร็จ', 'success'); logAction('DELETE_VENDOR', name); loadData(); }
  };
  const handleAddUser = async () => {
    const name = window.prompt("ชื่อ-นามสกุล พนักงาน:");
    const nationalId = window.prompt("เลขบัตรประชาชน:");
    if (!name || !nationalId) return;
    const vendorName = window.prompt("ชื่อบริษัทสังกัด:");
    const vendor = allVendors.find(v => v.name === vendorName);
    const { error } = await supabase.from('users').insert([{ name, national_id: nationalId, vendor_id: vendor?.id || null, role: 'USER' }]);
    if (error) showToast(error.message, 'error'); else { showToast('เพิ่มสำเร็จ', 'success'); logAction('CREATE_USER', name); loadData(); }
  };
  const handleDeleteUser = async (id: string, name: string) => {
    if (!window.confirm(`ยืนยันการลบ "${name}"?`)) return;
    const { error } = await supabase.from('users').delete().eq('id', id);
    if (error) showToast(error.message, 'error'); else { showToast('ลบสำเร็จ', 'success'); logAction('DELETE_USER', name); loadData(); }
  };
  const handleResetTraining = async (id: string, name: string) => {
    if(!window.confirm("รีเซ็ตสถานะการอบรม?")) return;
    const { error } = await supabase.from('users').update({ induction_expiry: null }).eq('id', id);
    if (error) showToast(error.message, 'error'); else { showToast('รีเซ็ตสำเร็จ', 'success'); logAction('RESET_TRAINING', name); loadData(); }
  };

  const filtered = activeTab === 'LOGS' ? logs : dataList.filter(item => 
    (item.name || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
    (item.national_id || '').includes(searchQuery)
  );

  return (
    <div className="p-8 space-y-6 text-left animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-black text-slate-900 leading-none">Management Center</h2>
          <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mt-2">Enterprise Resource Planning</p>
        </div>
        <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
          <TabButton active={activeTab === 'USERS'} onClick={() => setActiveTab('USERS')} icon={<Users size={16}/>} label="Users" />
          <TabButton active={activeTab === 'VENDORS'} onClick={() => setActiveTab('VENDORS')} icon={<Building2 size={16}/>} label="Vendors" />
          <TabButton active={activeTab === 'LOGS'} onClick={() => setActiveTab('LOGS')} icon={<History size={16}/>} label="Audit Logs" />
        </div>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden min-h-[500px]">
        {/* Toolbar */}
        <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row justify-between gap-4 bg-slate-50/30">
          {activeTab !== 'LOGS' && (
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
              <input 
                className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:border-blue-500 transition-all shadow-sm"
                placeholder="ค้นหารายชื่อ..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          )}
          
          <div className="flex gap-2 ml-auto">
            {activeTab === 'USERS' && (
              <>
                <input type="file" ref={userFileInputRef} className="hidden" accept=".xlsx, .xls" onChange={handleUserImport} />
                <button onClick={() => userFileInputRef.current?.click()} className="bg-emerald-50 text-emerald-600 border border-emerald-100 px-4 py-3 rounded-2xl font-black text-xs uppercase flex items-center gap-2 hover:bg-emerald-100 transition-all">
                  <Upload size={16}/> Import Users
                </button>
                <button onClick={handleExport} className="bg-white text-slate-600 border border-slate-200 px-4 py-3 rounded-2xl font-black text-xs uppercase flex items-center gap-2 hover:border-blue-500 hover:text-blue-600 transition-all">
                  <Download size={16}/> Export
                </button>
                <button onClick={handleAddUser} className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-black text-xs uppercase flex items-center gap-2 hover:bg-slate-900 transition-all shadow-lg shadow-blue-100">
                  <UserPlus size={16}/> Add User
                </button>
              </>
            )}

            {activeTab === 'VENDORS' && (
              <>
                <input type="file" ref={vendorFileInputRef} className="hidden" accept=".xlsx, .xls" onChange={handleVendorImport} />
                <button onClick={() => vendorFileInputRef.current?.click()} className="bg-emerald-50 text-emerald-600 border border-emerald-100 px-4 py-3 rounded-2xl font-black text-xs uppercase flex items-center gap-2 hover:bg-emerald-100 transition-all">
                  <Upload size={16}/> Import Vendors
                </button>
                <button onClick={handleExport} className="bg-white text-slate-600 border border-slate-200 px-4 py-3 rounded-2xl font-black text-xs uppercase flex items-center gap-2 hover:border-blue-500 hover:text-blue-600 transition-all">
                  <Download size={16}/> Export
                </button>
                <button onClick={handleAddVendor} className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-black text-xs uppercase flex items-center gap-2 hover:bg-slate-900 transition-all shadow-lg shadow-blue-100">
                  <Plus size={16}/> Add Vendor
                </button>
              </>
            )}
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-20 text-center text-slate-300 font-black uppercase text-xs tracking-widest"><Loader2 className="animate-spin mx-auto mb-4" size={32}/> Loading Data...</div>
          ) : (
            <table className="w-full text-left">
              <thead className="bg-slate-50/50 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                <tr>
                  {activeTab === 'LOGS' ? (
                    <>
                      <th className="px-8 py-4">Time</th>
                      <th className="px-8 py-4">Admin</th>
                      <th className="px-8 py-4">Action</th>
                      <th className="px-8 py-4">Details</th>
                    </>
                  ) : (
                    <>
                      <th className="px-8 py-4">Name / Information</th>
                      <th className="px-8 py-4">Status / Company</th>
                      <th className="px-8 py-4 text-center">Actions</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {activeTab === 'LOGS' ? (
                  filtered.map((log: any) => (
                    <tr key={log.id} className="hover:bg-slate-50/30">
                      <td className="px-8 py-4 text-xs font-bold text-slate-500">{new Date(log.created_at).toLocaleString()}</td>
                      <td className="px-8 py-4 text-xs font-bold">{log.admin_email}</td>
                      <td className="px-8 py-4"><span className="bg-slate-100 px-2 py-1 rounded text-[10px] font-black uppercase">{log.action}</span></td>
                      <td className="px-8 py-4 text-xs text-slate-600">
                        <div className="font-bold text-slate-900">{log.target}</div>
                        <div className="text-slate-400">{log.details}</div>
                      </td>
                    </tr>
                  ))
                ) : (
                  filtered.map(item => (
                    <tr key={item.id} className="hover:bg-slate-50/30 transition-colors">
                      <td className="px-8 py-5">
                        <div className="font-black text-slate-900 leading-none mb-1">{item.name}</div>
                        {activeTab === 'USERS' && <div className="text-[10px] text-slate-400 font-bold">{item.national_id}</div>}
                      </td>
                      <td className="px-8 py-5">
                        {activeTab === 'VENDORS' ? (
                          <span className={`px-3 py-1 rounded-lg text-[10px] font-black border ${item.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>
                            {item.status}
                          </span>
                        ) : (
                          <span className="text-blue-600 font-black text-[10px] uppercase bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-100">{item.vendors?.name || 'Unassigned'}</span>
                        )}
                      </td>
                      <td className="px-8 py-5">
                        <div className="flex justify-center gap-2">
                          
                          {/* ✅ กู้คืนปุ่มแก้ไขกลับมาแล้ว */}
                          <button 
                            onClick={() => activeTab === 'VENDORS' ? handleEditVendor(item.id, item.name) : handleEditUser(item)}
                            title="Edit"
                            className="p-2.5 rounded-xl border border-slate-100 text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-all"
                          >
                            <Edit3 size={16} />
                          </button>

                          {activeTab === 'USERS' && (
                            <button onClick={() => handleResetTraining(item.id, item.name)} title="Reset Training" className="p-2.5 rounded-xl border border-amber-100 text-amber-600 hover:bg-amber-50 transition-all"><RotateCcw size={16} /></button>
                          )}
                          
                          {activeTab === 'VENDORS' && item.status === 'PENDING' && (
                            <button onClick={() => api.approveVendor(item.id).then(loadData)} className="p-2.5 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm"><CheckCircle size={16} /></button>
                          )}

                          <button onClick={() => activeTab === 'VENDORS' ? handleDeleteVendor(item.id, item.name) : handleDeleteUser(item.id, item.name)} title="Delete" className="p-2.5 rounded-xl border border-red-50 text-red-400 hover:text-white hover:bg-red-500 transition-all"><Trash2 size={16} /></button>
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
    </div>
  );
};

const TabButton = ({ active, onClick, icon, label }: any) => (
  <button onClick={onClick} className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase flex items-center gap-2 transition-all whitespace-nowrap ${active ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
    {icon} {label}
  </button>
);

export default VendorManager;