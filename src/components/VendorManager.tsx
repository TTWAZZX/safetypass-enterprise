import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { api } from '../services/supabaseApi';
import { useToastContext } from './ToastProvider';
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
  Edit3,
  UserPlus
} from 'lucide-react';

const VendorManager: React.FC = () => {
  const { showToast } = useToastContext();
  const [activeTab, setActiveTab] = useState<'USERS' | 'VENDORS'>('VENDORS');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [dataList, setDataList] = useState<any[]>([]);
  const [allVendors, setAllVendors] = useState<any[]>([]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'VENDORS') {
        const { data, error } = await supabase.from('vendors').select('*').order('name', { ascending: true });
        if (error) throw error;
        setDataList(data || []);
      } else {
        const { data, error } = await supabase.from('users').select('*, vendors(name)').order('name', { ascending: true });
        if (error) throw error;
        setDataList(data || []);
      }
      
      const { data: vData } = await supabase.from('vendors').select('id, name').eq('status', 'APPROVED');
      setAllVendors(vData || []);
      
    } catch (err: any) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [activeTab]);

  // --- Vendor Actions ---
  const handleAddVendor = async () => {
    const name = window.prompt("ระบุชื่อบริษัทใหม่:");
    if (!name) return;
    const { error } = await supabase.from('vendors').insert([{ name, status: 'APPROVED' }]);
    if (error) showToast(error.message, 'error');
    else { showToast('เพิ่มบริษัทสำเร็จ', 'success'); loadData(); }
  };

  const handleEditVendor = async (id: string, currentName: string) => {
    const newName = window.prompt("แก้ไขชื่อบริษัท:", currentName);
    if (!newName || newName === currentName) return;
    const { error } = await supabase.from('vendors').update({ name: newName }).eq('id', id);
    if (error) showToast(error.message, 'error');
    else { showToast('แก้ไขชื่อบริษัทสำเร็จ', 'success'); loadData(); }
  };

  const handleDeleteVendor = async (id: string, name: string) => {
    if (!window.confirm(`ยืนยันการลบบริษัท "${name}"?`)) return;
    const { error } = await supabase.from('vendors').delete().eq('id', id);
    if (error) showToast("ไม่สามารถลบได้เนื่องจากมีข้อมูลเชื่อมโยง", 'error');
    else { showToast('ลบบริษัทสำเร็จ', 'success'); loadData(); }
  };

  // --- User Actions ---
  const handleAddUser = async () => {
    const name = window.prompt("ชื่อ-นามสกุล พนักงาน:");
    const nationalId = window.prompt("เลขบัตรประชาชน (13 หลัก):");
    if (!name || !nationalId) return;

    const vendorName = window.prompt("ระบุชื่อบริษัท (ตัวอย่าง: Thai Safety):");
    const vendor = allVendors.find(v => v.name === vendorName);

    const { error } = await supabase.from('users').insert([{ 
      name, 
      national_id: nationalId, 
      vendor_id: vendor?.id || null,
      role: 'USER'
    }]);
    
    if (error) showToast(error.message, 'error');
    else { showToast('เพิ่มพนักงานสำเร็จ', 'success'); loadData(); }
  };

  const handleEditUser = async (user: any) => {
    const newName = window.prompt("แก้ไขชื่อพนักงาน:", user.name);
    if (!newName) return;
    const { error } = await supabase.from('users').update({ name: newName }).eq('id', user.id);
    if (error) showToast(error.message, 'error');
    else { showToast('แก้ไขข้อมูลสำเร็จ', 'success'); loadData(); }
  };

  const handleDeleteUser = async (id: string, name: string) => {
    if (!window.confirm(`ยืนยันการลบพนักงาน "${name}"?`)) return;
    const { error } = await supabase.from('users').delete().eq('id', id);
    if (error) showToast(error.message, 'error');
    else { showToast('ลบพนักงานสำเร็จ', 'success'); loadData(); }
  };

  // ✅ แก้ไขฟังก์ชันรีเซ็ตที่เคยติดแดง
  const handleResetTraining = async (id: string) => {
    if(!window.confirm("ต้องการรีเซ็ตสถานะการอบรม?")) return;
    const { error } = await supabase.from('users').update({ induction_expiry: null }).eq('id', id);
    if (error) showToast(error.message, 'error');
    else { showToast('รีเซ็ตสำเร็จ', 'success'); loadData(); }
  };

  const filtered = dataList.filter(item => 
    (item.name || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
    (item.national_id || '').includes(searchQuery)
  );

  return (
    <div className="p-8 space-y-6 text-left animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-black text-slate-900 leading-none">Management</h2>
          <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mt-2">Vendor & User Controls</p>
        </div>
        <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200 shadow-sm">
          <button onClick={() => setActiveTab('USERS')} className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase flex items-center gap-2 transition-all ${activeTab === 'USERS' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}>
            <Users size={16}/> Users
          </button>
          <button onClick={() => setActiveTab('VENDORS')} className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase flex items-center gap-2 transition-all ${activeTab === 'VENDORS' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}>
            <Building2 size={16}/> Vendors
          </button>
        </div>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex justify-between gap-4 bg-slate-50/30">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
            <input 
              className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:border-blue-500 transition-all shadow-sm"
              placeholder="ค้นหารายชื่อ..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button 
            onClick={activeTab === 'VENDORS' ? handleAddVendor : handleAddUser}
            className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-black text-xs uppercase flex items-center gap-2 hover:bg-slate-900 transition-all shadow-lg shadow-blue-100"
          >
            {activeTab === 'VENDORS' ? <><Plus size={16}/> Add Vendor</> : <><UserPlus size={16}/> Add User</>}
          </button>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-20 text-center text-slate-300 font-black uppercase text-xs tracking-widest"><Loader2 className="animate-spin mx-auto mb-4" size={32}/> Loading...</div>
          ) : (
            <table className="w-full text-left">
              <thead className="bg-slate-50/50 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                <tr>
                  <th className="px-8 py-4">Name / Information</th>
                  <th className="px-8 py-4">Status / Affiliation</th>
                  <th className="px-8 py-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map(item => (
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
                        <button onClick={() => activeTab === 'VENDORS' ? handleEditVendor(item.id, item.name) : handleEditUser(item)} className="p-2.5 rounded-xl border border-slate-100 text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-all"><Edit3 size={16} /></button>
                        
                        {activeTab === 'USERS' && (
                          <button onClick={() => handleResetTraining(item.id)} className="p-2.5 rounded-xl border border-amber-100 text-amber-600 hover:bg-amber-50 transition-all"><RotateCcw size={16} /></button>
                        )}
                        
                        {activeTab === 'VENDORS' && item.status === 'PENDING' && (
                          <button onClick={() => api.approveVendor(item.id).then(loadData)} className="p-2.5 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm"><CheckCircle size={16} /></button>
                        )}

                        <button onClick={() => activeTab === 'VENDORS' ? handleDeleteVendor(item.id, item.name) : handleDeleteUser(item.id, item.name)} className="p-2.5 rounded-xl border border-red-50 text-red-400 hover:text-white hover:bg-red-500 transition-all"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default VendorManager;