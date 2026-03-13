import React, { useEffect, useState, useRef, useMemo } from 'react';
import { supabase } from '../services/supabaseClient';
import { api } from '../services/supabaseApi';
import { useToastContext } from './ToastProvider';
import * as XLSX from 'xlsx';
import { 
  Users, Building2, Search, Plus, RotateCcw, CheckCircle, Loader2,
  Trash2, Edit3, UserPlus, Upload, Download, History, ShieldCheck,
  X, Globe2, Calendar, CalendarClock, Ban, Clock, CheckCircle2,
  ShieldAlert, ChevronLeft, ChevronRight
} from 'lucide-react';

const maskNationalID = (id: string | null | undefined) => {
  if (!id || id.length < 13) return '-------------';
  return `${id.substring(0, 3)}••••••${id.substring(9)}`;
};

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

const processExcelDate = (excelDate: any): string | null => {
    if (!excelDate) return null;
    try {
        let date: Date | null = null;
        if (typeof excelDate === 'number') {
            date = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
        } else if (typeof excelDate === 'string') {
            const cleanStr = excelDate.trim().replace(/[-.]/g, '/');
            const tryDirect = new Date(cleanStr);
            if (!isNaN(tryDirect.getTime()) && cleanStr.includes('-')) {
                date = tryDirect;
            } else {
                const parts = cleanStr.split('/');
                if (parts.length === 3) {
                    const p0 = parseInt(parts[0]);
                    const p1 = parseInt(parts[1]);
                    const p2 = parseInt(parts[2]);
                    const year = p2 < 100 ? 2000 + p2 : p2;
                    if (p0 > 12) { date = new Date(year, p1 - 1, p0); } 
                    else if (p1 > 12) { date = new Date(year, p0 - 1, p1); } 
                    else { date = new Date(year, p0 - 1, p1); }
                }
            }
        } else if (excelDate instanceof Date) { date = excelDate; }

        if (date && !isNaN(date.getTime())) {
            date.setHours(12, 0, 0, 0); 
            return date.toISOString();
        }
        return null;
    } catch (e) {
        console.error("Date Parse Error:", e);
        return null;
    }
};

const VendorManager: React.FC<{ initialSearch?: string | null }> = ({ initialSearch }) => {
  const { showToast } = useToastContext();
  
  const [activeTab, setActiveTab] = useState<'USERS' | 'VENDORS' | 'LOGS'>(initialSearch ? 'USERS' : 'VENDORS');
  const [searchQuery, setSearchQuery] = useState(initialSearch || '');
  const [selectedVendorFilter, setSelectedVendorFilter] = useState('');
  const [certFilter, setCertFilter] = useState<'' | 'NO_CERT' | 'EXPIRING' | 'HAS_CERT'>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const [loading, setLoading] = useState(true);
  const [dataList, setDataList] = useState<any[]>([]);
  const [allVendors, setAllVendors] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10); 
  
  const [importingUsers, setImportingUsers] = useState(false);
  const [importingVendors, setImportingVendors] = useState(false);
  
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [editForm, setEditForm] = useState({ 
    name: '', age: '', nationality: '', induction_expiry: '', vendor_id: '' 
  });
  const [isOtherNationality, setIsOtherNationality] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const userFileInputRef = useRef<HTMLInputElement>(null);
  const vendorFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [activeTab, searchQuery, selectedVendorFilter, certFilter, itemsPerPage]);

  const logAction = async (action: string, target: string, details: string = '') => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('audit_logs').insert([{
        admin_email: user?.email || 'System Admin', action, target, details
      }]);
    } catch (err) { console.error('Audit log failure:', err); }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      let query: any;
      if (activeTab === 'VENDORS') {
        query = supabase.from('vendors').select('*').order('created_at', { ascending: false });
      } else if (activeTab === 'USERS') {
        // ✅ สั่งให้ดึง last_login มาด้วย
        query = supabase.from('users').select('*, vendors(name)').order('created_at', { ascending: false });
      } else {
        query = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(2000);
      }

      const { data, error } = await query;
      if (error) throw error;

      if (activeTab === 'LOGS') setLogs(data || []);
      else setDataList(data || []);

      const { data: vData } = await supabase.from('vendors').select('id, name').eq('status', 'APPROVED').order('name');
      setAllVendors(vData || []);

    } catch (err: any) {
      showToast('ไม่สามารถโหลดข้อมูลได้: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [activeTab]);

  // Auto-refresh every 60s (skip LOGS tab to avoid noise)
  useEffect(() => {
    if (activeTab === 'LOGS') return;
    const timer = setInterval(() => { loadData(); }, 60000);
    return () => clearInterval(timer);
  }, [activeTab]);

  const handleUpdateVendorStatus = async (id: string, name: string, newStatus: 'APPROVED' | 'REJECTED') => {
    const confirmMsg = newStatus === 'APPROVED' ? `ยืนยันการอนุมัติบริษัท ${name}?` : `ยืนยันการปฏิเสธบริษัท ${name}?`;
    if (!window.confirm(confirmMsg)) return;
    try {
      const { error } = await supabase.from('vendors').update({ status: newStatus }).eq('id', id);
      if (error) throw error;
      showToast(`ปรับสถานะบริษัท ${name} เป็น ${newStatus} สำเร็จ`, 'success');
      logAction(`VENDOR_${newStatus}`, name, `Status updated to ${newStatus}`);
      loadData();
    } catch (err: any) { showToast(err.message, 'error'); }
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
      induction_expiry: user.induction_expiry ? new Date(user.induction_expiry).toISOString().split('T')[0] : '',
      vendor_id: user.vendor_id || '' 
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
        induction_expiry: expiryVal,
        vendor_id: editForm.vendor_id || null
      }).eq('id', editingUser.id);

      if (error) throw error;
      showToast('อัปเดตข้อมูลพนักงานสำเร็จ', 'success');
      logAction('EDIT_USER', editingUser.name, `Updated Profile including Vendor`);
      setIsEditModalOpen(false);
      loadData();
    } catch (err: any) { showToast(err.message, 'error'); } 
    finally { setSubmitting(false); }
  };

  const handleToggleUserBan = async (id: string, name: string, currentStatus: boolean) => {
      const actionText = currentStatus ? "ระงับสิทธิ์ (Ban)" : "ปลดแบน (Unban)";
      if (!window.confirm(`คุณต้องการ ${actionText} พนักงาน "${name}" ใช่หรือไม่?`)) return;

      try {
          const { error } = await supabase.from('users').update({ is_active: !currentStatus }).eq('id', id);
          if (error) throw error;
          showToast(`${actionText} สำเร็จ`, 'success');
          logAction(currentStatus ? 'BAN_USER' : 'UNBAN_USER', name, `Status changed to ${!currentStatus}`);
          loadData();
      } catch (err: any) {
          showToast(`ไม่สามารถ ${actionText} ได้: ` + err.message, 'error');
      }
  };

  const handleExport = () => {
    let exportData = [];
    let fileName = '';

    if (activeTab === 'USERS') {
      exportData = filtered.map(user => ({
        'Name': user.name,
        'National ID': user.national_id ? "'" + user.national_id : '-',
        'Vendor': user.vendors?.name || 'N/A',
        'Role': user.role,
        'Age': user.age || '',
        'Nationality': user.nationality || '',
        'Status': user.is_active === false ? 'BANNED' : (user.induction_expiry ? 'Certified' : 'Pending'),
        'Induction Expiry': user.induction_expiry ? new Date(user.induction_expiry).toLocaleDateString() : '-',
        'Last Login': user.last_login ? new Date(user.last_login).toLocaleString('th-TH') : 'Never Logged In' // ✅ เพิ่มใน Export
      }));
      fileName = `Personnel_List_${new Date().toISOString().split('T')[0]}.xlsx`;
    } else if (activeTab === 'VENDORS') {
      exportData = filtered.map(vendor => ({
        'Company Name': vendor.name,
        'Status': vendor.status,
        'Registry Date': new Date(vendor.created_at).toLocaleDateString()
      }));
      fileName = `Vendor_List_${new Date().toISOString().split('T')[0]}.xlsx`;
    }

    if(exportData.length === 0) return showToast('ไม่พบข้อมูลที่จะส่งออก', 'error');

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, activeTab);
    XLSX.writeFile(wb, fileName);
    showToast('Exported Successfully', 'success');
  };

  const handleUserImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setImportingUsers(true); 
    
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary', cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data: any[] = XLSX.utils.sheet_to_json(ws);
        
        let success = 0; let fail = 0;

        for (const row of data) {
          const name = (row['Name'] || row['Full Name'] || '').toString().trim();
          let nid = (row['National ID'] || row['ID Card'] || '').toString().trim();
          
          if (nid.includes('E+') || nid.includes('e+')) nid = Number(nid).toLocaleString('fullwide', {useGrouping:false});
          
          const vName = (row['Vendor'] || row['Company'] || '').toString().trim();
          const role = (row['Role'] || 'USER').toString().trim();
          const age = row['Age'] ? Number(row['Age']) : null;
          const nationality = (row['Nationality'] || 'ไทย (Thai)').toString().trim();
          const rawExpiry = row['Induction Expiry'] || row['Expiry Date'];
          const processedExpiry = processExcelDate(rawExpiry);

          if (name && nid) {
            const vendor = allVendors.find(v => v.name.toLowerCase() === vName.toLowerCase());
            const { data: exist } = await supabase.from('users').select('id').eq('national_id', nid).maybeSingle();

            const payload: any = {
              name, 
              national_id: nid, 
              vendor_id: vendor?.id || null, 
              role: role,
              age: age, 
              nationality: nationality,
              induction_expiry: processedExpiry, 
              pdpa_agreed: false, // 🚨 เปลี่ยนจาก true เป็น false
              is_active: true
            };

            let error;
            if (exist) {
              const { error: updateError } = await supabase.from('users').update(payload).eq('id', exist.id);
              error = updateError;
            } else {
              payload.id = generateUUID(); 
              const { error: insertError } = await supabase.from('users').insert([payload]);
              error = insertError;
            }
            if (!error) success++; else { console.error(`❌ Error for ${nid}:`, error.message); fail++; }
          }
        }
        showToast(`นำเข้าพนักงานสำเร็จ ${success} รายการ`, fail > 0 ? 'error' : 'success');
        loadData();
      } catch (err) { 
        console.error("❌ Import Error:", err); 
        showToast('รูปแบบไฟล์ไม่ถูกต้อง', 'error'); 
      } finally {
        setImportingUsers(false); 
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = ''; 
  };

  const handleVendorImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setImportingVendors(true); 
    
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data: any[] = XLSX.utils.sheet_to_json(ws);
        
        let successCount = 0; let skipCount = 0;

        for (const row of data) {
          const rawName = row['Company Name'] || row['Vendor'] || row['Name'];
          if (rawName && rawName.toString().trim() !== '') {
            const trimmedName = rawName.toString().trim();
            const { data: existingVendor } = await supabase.from('vendors').select('name').eq('name', trimmedName).maybeSingle();
            if (existingVendor) { skipCount++; continue; }
            const { error: insertError } = await supabase.from('vendors').insert([{ name: trimmedName, status: 'APPROVED' }]);
            if (!insertError) successCount++;
          }
        }
        if (successCount > 0) { showToast(`นำเข้าบริษัทสำเร็จ ${successCount} บริษัท (ซ้ำ ${skipCount} รายการ)`, 'success'); loadData(); } 
        else if (skipCount > 0) { showToast(`ข้อมูลทั้งหมด ${skipCount} รายการมีอยู่ในระบบแล้ว`, 'info'); } 
        else { showToast('ไม่พบข้อมูลที่จะนำเข้า', 'error'); }
      } catch (err) { 
        console.error("❌ Error:", err); 
        showToast('รูปแบบไฟล์ไม่ถูกต้อง', 'error'); 
      } finally {
        setImportingVendors(false); 
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const handleAddVendor = async () => {
    const name = window.prompt("ชื่อบริษัทใหม่ (New Company Name):");
    if (!name) return;
    
    const { error } = await supabase.from('vendors').insert([{ name, status: 'PENDING' }]);
    
    if (error) {
      showToast(error.message, 'error');
    } else { 
      showToast('ลงทะเบียนบริษัทแล้ว กรุณารอการอนุมัติ', 'success'); 
      logAction('CREATE_VENDOR', name); 
      loadData(); 

      try {
        const { data: { user } } = await supabase.auth.getUser();
        fetch('/api/notify-admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vendorName: name,
            adminEmail: user?.email || 'System Admin'
          })
        }).catch(e => console.error("LINE Admin Notification Trigger Error:", e));
      } catch (err) {
        console.error("Fail to trigger LINE Admin API:", err);
      }
    }
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
    // 🚨 เพิ่ม pdpa_agreed: false เข้าไปใน insert
    const { error } = await supabase.from('users').insert([{ id: generateUUID(), name, national_id: nid, role: 'USER', pdpa_agreed: false }]);
    if (error) showToast(error.message, 'error'); else { showToast('Success', 'success'); loadData(); }
  };

  const handleDeleteUser = async (id: string, name: string) => {
    if (!window.confirm(`⚠️ คำเตือน: คุณกำลังจะลบพนักงาน "${name}"\nประวัติการสอบ ใบอนุญาต และข้อมูล Log ทั้งหมดจะถูกลบถาวร ยืนยันการลบ?`)) return;
    
    setLoading(true);
    try {
      const childTables = ['exam_logs', 'exam_history', 'work_permits'];
      await Promise.all(
        childTables.map(table => supabase.from(table).delete().eq('user_id', id))
      );

      const { error } = await supabase.from('users').delete().eq('id', id);
      
      if (error) {
        throw new Error(`ติดข้อจำกัดฐานข้อมูล: ${error.message}`);
      }

      showToast(`ลบข้อมูลพนักงาน ${name} สำเร็จ`, 'success');
      logAction('DELETE_USER', name, 'Full Cascade Delete Done');
      loadData();
    } catch (err: any) { 
      console.error("Delete Error:", err);
      showToast('ไม่สามารถลบได้: ' + err.message, 'error'); 
    } finally { 
      setLoading(false); 
    }
  };

  const handleResetTraining = async (id: string, name: string) => {
    if(!window.confirm("Reset induction status for this user?")) return;
    const { error } = await supabase.from('users').update({ induction_expiry: null }).eq('id', id);
    if (error) showToast(error.message, 'error'); else { showToast('Reset Complete', 'success'); logAction('RESET_TRAINING', name); loadData(); }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const handleBulkExport = (currentFiltered: any[]) => {
    const selected = currentFiltered.filter(u => selectedIds.has(u.id));
    const exportData = selected.map(user => ({
      'Name': user.name,
      'National ID': user.national_id ? "'" + user.national_id : '-',
      'Vendor': user.vendors?.name || 'N/A',
      'Cert Status': getCertStatus(user).toUpperCase(),
      'Induction Expiry': user.induction_expiry ? new Date(user.induction_expiry).toLocaleDateString() : '-',
      'Last Login': user.last_login ? new Date(user.last_login).toLocaleString('th-TH') : 'Never',
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Selected');
    XLSX.writeFile(wb, `Selected_Users_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast(`Exported ${selected.length} users`, 'success');
  };

  const handleBulkReset = async () => {
    if (!window.confirm(`Reset training for ${selectedIds.size} selected users?`)) return;
    setBulkLoading(true);
    try {
      const ids = Array.from(selectedIds);
      const { error } = await supabase.from('users').update({ induction_expiry: null }).in('id', ids);
      if (error) throw error;
      showToast(`Reset ${ids.length} users`, 'success');
      logAction('BULK_RESET', `${ids.length} users`, 'Bulk training reset');
      setSelectedIds(new Set());
      loadData();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setBulkLoading(false);
    }
  };

  const getCertStatus = (item: any): 'valid' | 'expiring' | 'expired' | 'none' => {
    if (!item.induction_expiry) return 'none';
    const expiry = new Date(item.induction_expiry);
    const now = new Date();
    if (expiry <= now) return 'expired';
    const soon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    return expiry <= soon ? 'expiring' : 'valid';
  };

  const isCertified = (item: any) => {
    const s = getCertStatus(item);
    return s === 'valid' || s === 'expiring';
  };

  const getCertDaysLabel = (item: any): string => {
    if (!item.induction_expiry) return '';
    const diffDays = Math.round((new Date(item.induction_expiry).getTime() - Date.now()) / 86400000);
    return diffDays > 0 ? `หมดอายุอีก ${diffDays} วัน` : `หมดไปแล้ว ${Math.abs(diffDays)} วัน`;
  };

  const filteredRaw = activeTab === 'LOGS' ? logs : dataList.filter(item => {
    const matchesSearch = (item.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (item.national_id || '').includes(searchQuery);

    if (activeTab === 'USERS' && selectedVendorFilter) {
      if (selectedVendorFilter === 'EXTERNAL') {
        if (!matchesSearch || item.vendor_id) return false;
      } else {
        if (!matchesSearch || item.vendor_id !== selectedVendorFilter) return false;
      }
    } else if (!matchesSearch) return false;

    if (activeTab === 'USERS' && certFilter) {
      const cs = getCertStatus(item);
      if (certFilter === 'NO_CERT') return cs === 'none' || cs === 'expired';
      if (certFilter === 'EXPIRING') return cs === 'expiring';
      if (certFilter === 'HAS_CERT') return cs === 'valid';
    }

    return true;
  });

  const filtered = activeTab === 'USERS'
    ? [...filteredRaw].sort((a, b) => {
        const sortKey = (item: any) => {
          const cert = getCertStatus(item);
          const active = !!item.last_login;
          if ((cert === 'none' || cert === 'expired') && active) return 0;
          if ((cert === 'none' || cert === 'expired') && !active) return 1;
          if (cert === 'expiring') return 2;
          return 3; // valid
        };
        return sortKey(a) - sortKey(b);
      })
    : filteredRaw;

  const userStats = useMemo(() => {
    if (activeTab !== 'USERS') return null;
    return {
      total: dataList.length,
      noCert: dataList.filter(u => getCertStatus(u) === 'none').length,
      expired: dataList.filter(u => getCertStatus(u) === 'expired').length,
      expiring: dataList.filter(u => getCertStatus(u) === 'expiring').length,
      valid: dataList.filter(u => getCertStatus(u) === 'valid').length,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataList, activeTab]);

  const totalItems = filtered.length;
  const totalPages = itemsPerPage === -1 ? 1 : Math.ceil(totalItems / itemsPerPage);
  
  const paginatedData = itemsPerPage === -1 
    ? filtered 
    : filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const renderPagination = (position: 'top' | 'bottom') => {
    if (filtered.length === 0) return null;
    return (
      <div className={`bg-slate-50/50 p-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 ${position === 'top' ? 'border-b border-slate-100' : 'mt-auto border-t border-slate-200 rounded-b-[1.5rem] md:rounded-b-[2.5rem]'}`}>
         <div className="flex items-center gap-2 text-[10px] md:text-xs font-bold text-slate-500 w-full sm:w-auto justify-center sm:justify-start">
            <span>แสดง</span>
            <select 
                value={itemsPerPage} 
                onChange={(e) => setItemsPerPage(Number(e.target.value))}
                className="bg-white border border-slate-200 rounded-lg px-2 py-1 outline-none focus:border-blue-500 shadow-sm font-black text-slate-700"
            >
                <option value={10}>10</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={500}>500</option>
                <option value={1000}>1,000</option>
                <option value={-1}>ทั้งหมด (All)</option>
            </select>
            <span>รายการ</span>
            <span className="ml-2 hidden sm:inline text-slate-400 font-medium">| จากทั้งหมด {totalItems} รายการ</span>
         </div>

         <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
            <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="flex items-center gap-1 p-2 md:px-3 md:py-1.5 rounded-xl border border-slate-200 bg-white text-slate-600 disabled:opacity-50 disabled:bg-slate-50 hover:bg-slate-100 hover:text-blue-600 transition-all shadow-sm font-bold text-xs"
            >
                <ChevronLeft size={16} /> <span className="hidden md:inline">ก่อนหน้า</span>
            </button>
            <span className="text-[10px] md:text-xs font-black text-slate-600 bg-white px-4 py-1.5 rounded-xl border border-slate-200 shadow-sm">
                {currentPage} <span className="text-slate-400 mx-1">/</span> {totalPages}
            </span>
            <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages || totalPages === 0}
                className="flex items-center gap-1 p-2 md:px-3 md:py-1.5 rounded-xl border border-slate-200 bg-white text-slate-600 disabled:opacity-50 disabled:bg-slate-50 hover:bg-slate-100 hover:text-blue-600 transition-all shadow-sm font-bold text-xs"
            >
                <span className="hidden md:inline">ถัดไป</span> <ChevronRight size={16} />
            </button>
         </div>
         <span className="sm:hidden text-slate-400 font-bold text-[9px] uppercase mt-1">รวมทั้งหมด {totalItems} รายการ</span>
      </div>
    );
  };

  return (
    <div className="space-y-4 md:space-y-6 text-left animate-in fade-in duration-500 pb-10 relative px-2 md:px-0">
      
      {/* 🟢 Header Section */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 lg:gap-6 border-b border-slate-200 pb-4 lg:pb-6">
        <div>
          <h2 className="text-2xl md:text-3xl font-black text-slate-900 uppercase">Directory Control</h2>
          <div className="text-slate-400 font-bold text-[10px] uppercase tracking-[0.2em] mt-2 flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" /> Security Compliance Node
          </div>
        </div>
        <div className="flex w-full lg:w-auto bg-slate-100 p-1 rounded-2xl border border-slate-200 shadow-inner overflow-x-auto no-scrollbar">
          <TabButton active={activeTab === 'VENDORS'} onClick={() => {setActiveTab('VENDORS'); setSearchQuery(''); setSelectedVendorFilter(''); setCertFilter('');}} icon={<Building2 size={14}/>} label="Vendors" />
          <TabButton active={activeTab === 'USERS'} onClick={() => {setActiveTab('USERS'); setSearchQuery(''); setSelectedVendorFilter(''); setCertFilter('');}} icon={<Users size={14}/>} label="Personnel" />
          <TabButton active={activeTab === 'LOGS'} onClick={() => {setActiveTab('LOGS'); setSearchQuery(''); setSelectedVendorFilter(''); setCertFilter('');}} icon={<History size={14}/>} label="Audit" />
        </div>
      </div>

      {/* 🟢 Main Content Box */}
      <div className="bg-white rounded-[1.5rem] md:rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden min-h-[600px] flex flex-col">
        
        {/* Toolbar */}
        <div className="p-4 md:p-6 border-b border-slate-100 flex flex-col md:flex-row justify-between gap-4 bg-slate-50/50">
          {activeTab !== 'LOGS' ? (
            <div className="flex flex-col md:flex-row gap-3 flex-1 w-full">
              {/* ช่องค้นหา */}
              <div className="relative flex-1 group w-full">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                <input className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-2xl font-bold text-base md:text-sm outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all shadow-sm" placeholder={`Search ${activeTab.toLowerCase()}...`} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              </div>
              
              {/* ตัวกรองบริษัท */}
              {activeTab === 'USERS' && (
                <div className="relative w-full md:w-64">
                  <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <select
                    className="w-full pl-10 pr-8 py-3 bg-white border border-slate-200 rounded-2xl font-bold text-[11px] text-slate-600 outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all shadow-sm appearance-none cursor-pointer truncate"
                    value={selectedVendorFilter}
                    onChange={(e) => setSelectedVendorFilter(e.target.value)}
                  >
                    <option value="">🏢 ทุกบริษัท (All Vendors)</option>
                    {allVendors.map(v => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                    <option value="EXTERNAL">⚠️ ไม่ระบุสังกัด (EXTERNAL)</option>
                  </select>
                </div>
              )}

              {/* ตัวกรองใบเซอร์ */}
              {activeTab === 'USERS' && (
                <div className="flex items-center gap-1.5 w-full md:w-auto flex-wrap">
                  <button
                    onClick={() => setCertFilter('')}
                    className={`flex-1 md:flex-none flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-2xl font-black text-[10px] uppercase tracking-wide border transition-all active:scale-95 ${certFilter === '' ? 'bg-slate-900 text-white border-slate-900 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
                  >
                    <Users size={13}/><span className="hidden sm:inline">ทั้งหมด</span>
                    {userStats && <span className="ml-1 opacity-60 font-medium text-[9px]">{userStats.total}</span>}
                  </button>
                  <button
                    onClick={() => setCertFilter('NO_CERT')}
                    className={`flex-1 md:flex-none flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-2xl font-black text-[10px] uppercase tracking-wide border transition-all active:scale-95 ${certFilter === 'NO_CERT' ? 'bg-rose-500 text-white border-rose-500 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
                  >
                    <ShieldAlert size={13}/><span className="hidden sm:inline">ไม่มี/หมดอายุ</span>
                    {userStats && <span className="ml-1 opacity-60 font-medium text-[9px]">{userStats.noCert + userStats.expired}</span>}
                  </button>
                  <button
                    onClick={() => setCertFilter('EXPIRING')}
                    className={`flex-1 md:flex-none flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-2xl font-black text-[10px] uppercase tracking-wide border transition-all active:scale-95 ${certFilter === 'EXPIRING' ? 'bg-amber-500 text-white border-amber-500 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
                  >
                    <Clock size={13}/><span className="hidden sm:inline">ใกล้หมด</span>
                    {userStats && <span className="ml-1 opacity-60 font-medium text-[9px]">{userStats.expiring}</span>}
                  </button>
                  <button
                    onClick={() => setCertFilter('HAS_CERT')}
                    className={`flex-1 md:flex-none flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-2xl font-black text-[10px] uppercase tracking-wide border transition-all active:scale-95 ${certFilter === 'HAS_CERT' ? 'bg-emerald-500 text-white border-emerald-500 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
                  >
                    <ShieldCheck size={13}/><span className="hidden sm:inline">มีใบเซอร์</span>
                    {userStats && <span className="ml-1 opacity-60 font-medium text-[9px]">{userStats.valid}</span>}
                  </button>
                </div>
              )}
            </div>
          ) : <div className="text-slate-400 font-black text-[10px] uppercase px-2 flex items-center gap-2 w-full"><ShieldCheck size={14} /> System Access History</div>}
          
          <div className="flex flex-wrap gap-2 w-full md:w-auto md:ml-auto">
            {activeTab !== 'LOGS' && (
              <>
                <input type="file" ref={activeTab === 'USERS' ? userFileInputRef : vendorFileInputRef} className="hidden" accept=".xlsx, .xls" onChange={activeTab === 'USERS' ? handleUserImport : handleVendorImport} />
                
                <button 
                  onClick={() => (activeTab === 'USERS' ? userFileInputRef : vendorFileInputRef).current?.click()} 
                  disabled={activeTab === 'USERS' ? importingUsers : importingVendors}
                  className="flex-1 md:flex-none bg-emerald-50 text-emerald-600 border border-emerald-100 px-4 py-3 rounded-xl font-black text-[10px] uppercase hover:bg-emerald-100 transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {(activeTab === 'USERS' ? importingUsers : importingVendors) ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14}/>} 
                  {(activeTab === 'USERS' ? importingUsers : importingVendors) ? 'นำเข้า...' : 'Import'}
                </button>
                
                <button onClick={handleExport} className="flex-1 md:flex-none bg-white text-slate-600 border border-slate-200 px-4 py-3 rounded-xl font-black text-[10px] uppercase hover:bg-slate-50 transition-all flex items-center justify-center gap-2 shadow-sm"><Download size={14}/> Export</button>
                <button onClick={loadData} className="flex-none p-3 bg-slate-50 text-slate-400 rounded-xl hover:text-blue-600 transition-all active:scale-95 shadow-sm"><RotateCcw size={18}/></button>
                <button onClick={activeTab === 'USERS' ? handleAddUser : handleAddVendor} className="w-full sm:w-auto bg-blue-600 text-white px-6 py-3 rounded-xl font-black text-[10px] uppercase hover:bg-slate-900 transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2"><Plus size={14}/> New Entry</button>
              </>
            )}
          </div>
        </div>

        {/* Bulk Actions Bar */}
        {activeTab === 'USERS' && selectedIds.size > 0 && (
          <div className="mx-4 mt-3 bg-slate-900 text-white px-4 py-3 rounded-2xl flex items-center justify-between gap-3 shadow-lg animate-in fade-in duration-200">
            <span className="text-xs font-black">{selectedIds.size} รายการที่เลือก</span>
            <div className="flex gap-2">
              <button onClick={() => handleBulkExport(filtered)} disabled={bulkLoading} className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all active:scale-95">
                <Download size={12}/> Export ที่เลือก
              </button>
              <button onClick={handleBulkReset} disabled={bulkLoading} className="flex items-center gap-1.5 bg-amber-500/80 hover:bg-amber-500 text-white px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all active:scale-95">
                {bulkLoading ? <Loader2 size={12} className="animate-spin"/> : <RotateCcw size={12}/>} Reset Training
              </button>
              <button onClick={() => setSelectedIds(new Set())} className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 transition-all active:scale-95">
                <X size={14}/>
              </button>
            </div>
          </div>
        )}

        {/* 🟢 Data Presentation Area */}
        <div className="flex-1 p-2 md:p-0 bg-slate-50 md:bg-white flex flex-col">
          {loading ? (
            <div className="p-32 text-center flex-1"><Loader2 className="animate-spin text-blue-500 mx-auto" size={32}/></div>
          ) : paginatedData.length === 0 ? (
             <div className="p-20 text-center text-slate-400 font-bold text-sm flex-1">ไม่พบข้อมูล (No Data Found)</div>
          ) : (
            <div className="flex-1 flex flex-col">
              
              {/* ✅ แถบ Pagination ด้านบน */}
              {renderPagination('top')}

              {/* 🖥️ DESKTOP VIEW (TABLE) */}
              <div className="hidden lg:block overflow-x-auto w-full flex-1">
                <table className="w-full text-left min-w-[900px]">
                  <thead className="bg-slate-50/50 text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100 sticky top-0 z-10">
                    <tr>
                      {activeTab === 'USERS' && (
                        <th className="pl-6 pr-2 py-5 w-10">
                          <input
                            type="checkbox"
                            className="w-4 h-4 rounded border-slate-300 cursor-pointer accent-blue-600"
                            checked={paginatedData.length > 0 && paginatedData.every((i: any) => selectedIds.has(i.id))}
                            onChange={() => setSelectedIds(prev =>
                              prev.size === paginatedData.length ? new Set() : new Set(paginatedData.map((i: any) => i.id))
                            )}
                          />
                        </th>
                      )}
                      <th className="px-8 py-5 text-left whitespace-nowrap">Profile / Identity</th>
                      <th className="px-8 py-5 text-left whitespace-nowrap">Compliance / Status</th>
                      <th className="px-8 py-5 text-center whitespace-nowrap">Protocol Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 bg-white">
                    {activeTab === 'LOGS' ? (
                      paginatedData.map((log: any) => (
                        <tr key={log.id} className="hover:bg-slate-50/30 transition-colors">
                          <td className="px-8 py-5 text-[11px] font-black text-slate-500 font-mono tracking-tighter whitespace-nowrap">{new Date(log.created_at).toLocaleString('th-TH')}</td>
                          <td className="px-8 py-5 text-xs font-bold text-slate-700">{log.admin_email}</td>
                          <td className="px-8 py-5 text-xs font-black text-slate-600 uppercase whitespace-nowrap">{log.action}</td>
                          <td className="px-8 py-5 text-xs text-slate-600 font-bold uppercase">{log.target}</td>
                        </tr>
                      ))
                    ) : (
                      paginatedData.map(item => {
                        const itemCs = activeTab === 'USERS' ? getCertStatus(item) : '';
                        const rowBorder = activeTab !== 'USERS' ? '' :
                          item.is_active === false ? 'border-l-4 border-l-red-400' :
                          itemCs === 'none' ? 'border-l-4 border-l-rose-400' :
                          itemCs === 'expired' ? 'border-l-4 border-l-orange-400' :
                          itemCs === 'expiring' ? 'border-l-4 border-l-amber-300' :
                          'border-l-4 border-l-transparent';
                        return (
                        <tr key={item.id} className={`hover:bg-slate-50/30 transition-colors group text-left ${item.is_active === false ? 'bg-red-50/50' : ''} ${rowBorder}`}>
                          {activeTab === 'USERS' && (
                            <td className="pl-6 pr-2 py-5 w-10">
                              <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-slate-300 cursor-pointer accent-blue-600"
                                checked={selectedIds.has(item.id)}
                                onChange={() => toggleSelect(item.id)}
                              />
                            </td>
                          )}
                          <td className="px-8 py-5">
                            <div className="flex items-center gap-3">
                               <div className={`w-10 h-10 shrink-0 rounded-2xl text-white transition-all flex items-center justify-center font-black text-xs shadow-inner uppercase ${item.is_active === false ? 'bg-red-400' : 'bg-slate-200 text-slate-500 group-hover:bg-blue-600'}`}>
                                 {item.name?.charAt(0)}
                               </div>
                               <div className="min-w-0 flex flex-col gap-0.5">
                                 <div className="font-black text-slate-800 uppercase text-xs truncate max-w-[200px] flex items-center gap-2">
                                    {item.name}
                                    {item.is_active === false && <span className="bg-red-500 text-white px-1.5 py-0.5 rounded text-[8px] tracking-widest shrink-0">BANNED</span>}
                                 </div>
                                 {activeTab === 'USERS' && (
                                    <div className="flex items-center gap-2">
                                        <p className="text-[10px] text-slate-400 font-mono tracking-tighter">ID: {maskNationalID(item.national_id)}</p>
                                        {item.last_login ? (
                                            <span className="text-[8px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded flex items-center gap-1 border border-emerald-100">
                                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> Active
                                            </span>
                                        ) : (
                                            <span className="text-[8px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1 border border-slate-200">
                                                <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div> Pending
                                            </span>
                                        )}
                                    </div>
                                 )}
                               </div>
                            </div>
                          </td>
                          <td className="px-8 py-5">
                            {activeTab === 'VENDORS' ? (
                              <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[9px] font-black border uppercase shadow-sm whitespace-nowrap ${item.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : item.status === 'REJECTED' ? 'bg-red-50 text-red-600 border-red-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>
                                {item.status || 'PENDING'}
                              </div>
                            ) : (
                              <div className="flex flex-col gap-1 text-left">
                                <span className="text-slate-500 font-black text-[10px] uppercase bg-slate-50 px-3 py-1 rounded-xl border w-fit shadow-sm truncate max-w-[180px]">{item.vendors?.name || 'EXTERNAL'}</span>
                                {item.is_active === false ? (
                                    <span className="text-[9px] font-black text-red-500 flex items-center gap-1 ml-1 whitespace-nowrap"><Ban size={10}/> Account Suspended</span>
                                ) : itemCs === 'valid' ? (
                                    <span title={getCertDaysLabel(item)} className="text-[9px] font-black text-emerald-600 flex items-center gap-1 ml-1 whitespace-nowrap cursor-help">
                                        <ShieldCheck size={10}/> Exp: {new Date(item.induction_expiry).toLocaleDateString('th-TH')}
                                    </span>
                                ) : itemCs === 'expiring' ? (
                                    <span title={getCertDaysLabel(item)} className="text-[9px] font-black text-amber-500 flex items-center gap-1 ml-1 whitespace-nowrap cursor-help">
                                        <Clock size={10}/> Expiring: {new Date(item.induction_expiry).toLocaleDateString('th-TH')}
                                    </span>
                                ) : itemCs === 'expired' ? (
                                    <span title={getCertDaysLabel(item)} className="text-[9px] font-black text-orange-500 flex items-center gap-1 ml-1 whitespace-nowrap cursor-help">
                                        <CalendarClock size={10}/> Expired: {new Date(item.induction_expiry).toLocaleDateString('th-TH')}
                                    </span>
                                ) : (
                                    <span className="text-[9px] font-black text-rose-400 flex items-center gap-1 ml-1 whitespace-nowrap">
                                        <ShieldAlert size={10}/> No Certification
                                    </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-8 py-5 text-center">
                            <div className="flex justify-center gap-2 flex-wrap">
                              {activeTab === 'VENDORS' && item.status !== 'APPROVED' && (
                                <button onClick={() => handleUpdateVendorStatus(item.id, item.name, 'APPROVED')} className="p-2.5 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 shadow-lg active:scale-90 transition-all"><CheckCircle size={16} /></button>
                              )}
                              {activeTab === 'VENDORS' && item.status === 'PENDING' && (
                                <button onClick={() => handleUpdateVendorStatus(item.id, item.name, 'REJECTED')} title="Reject" className="p-2.5 rounded-xl border text-red-500 hover:bg-red-50 active:scale-90 transition-all"><Ban size={16} /></button>
                              )}
                              <button onClick={() => activeTab === 'VENDORS' ? handleEditVendor(item.id, item.name) : handleEditUser(item)} className="p-2.5 rounded-xl border border-slate-100 text-slate-400 hover:text-blue-600 hover:bg-blue-50 active:scale-90 transition-all shadow-sm"><Edit3 size={16} /></button>
                              {activeTab === 'USERS' && (
                                <>
                                  <button onClick={() => handleResetTraining(item.id, item.name)} title="Reset Compliance" className="p-2.5 rounded-xl border border-amber-100 text-amber-500 hover:bg-amber-50 transition-all active:scale-90 shadow-sm"><RotateCcw size={16} /></button>
                                  <button
                                      onClick={() => handleToggleUserBan(item.id, item.name, item.is_active !== false)}
                                      title={item.is_active !== false ? "Suspend Account" : "Unban Account"}
                                      className={`p-2.5 rounded-xl border transition-all active:scale-90 shadow-sm ${item.is_active !== false ? 'border-red-100 text-red-500 hover:bg-red-50' : 'bg-red-500 text-white hover:bg-red-600 shadow-red-200 shadow-lg'}`}
                                  >
                                      {item.is_active !== false ? <ShieldAlert size={16} /> : <CheckCircle2 size={16} />}
                                  </button>
                                </>
                              )}
                              <button onClick={() => activeTab === 'VENDORS' ? handleDeleteVendor(item.id, item.name) : handleDeleteUser(item.id, item.name)} className="p-2.5 rounded-xl border border-slate-100 text-slate-300 hover:text-red-600 hover:bg-red-50 active:scale-90 transition-all shadow-sm"><Trash2 size={16} /></button>
                            </div>
                          </td>
                        </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* 📱 MOBILE VIEW (CARDS) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 lg:hidden flex-1 pb-4 pt-3">
                 {activeTab === 'LOGS' ? (
                    paginatedData.map((log: any) => (
                      <div key={log.id} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                         <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                            <span className="text-[10px] font-mono text-slate-400">{new Date(log.created_at).toLocaleString('th-TH')}</span>
                            <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-lg uppercase">{log.action}</span>
                         </div>
                         <div>
                            <p className="text-[9px] font-black text-slate-400 uppercase">Admin</p>
                            <p className="text-xs font-bold text-slate-700 truncate">{log.admin_email}</p>
                         </div>
                         <div>
                            <p className="text-[9px] font-black text-slate-400 uppercase">Target</p>
                            <p className="text-xs font-bold text-slate-700 truncate">{log.target}</p>
                         </div>
                      </div>
                    ))
                 ) : (
                    paginatedData.map((item: any) => {
                      const cardCs = activeTab === 'USERS' ? getCertStatus(item) : '';
                      const cardBorder = activeTab !== 'USERS' ? 'border-slate-200' :
                        item.is_active === false ? 'border-red-200' :
                        cardCs === 'none' ? 'border-l-4 border-l-rose-400 border-slate-200' :
                        cardCs === 'expired' ? 'border-l-4 border-l-orange-400 border-slate-200' :
                        cardCs === 'expiring' ? 'border-l-4 border-l-amber-300 border-slate-200' :
                        'border-slate-200';
                      return (
                      <div key={item.id} className={`bg-white p-4 rounded-2xl border shadow-sm flex flex-col gap-4 relative overflow-hidden ${item.is_active === false ? 'bg-red-50/30' : ''} ${cardBorder}`}>
                         {/* Card Header */}
                         <div className="flex items-center gap-3">
                            <div className={`w-12 h-12 shrink-0 rounded-[1rem] text-white flex items-center justify-center font-black text-lg shadow-inner uppercase ${item.is_active === false ? 'bg-red-400' : 'bg-blue-600'}`}>
                               {item.name?.charAt(0)}
                            </div>
                            <div className="min-w-0 flex-1">
                               <div className="flex items-center gap-2">
                                 <h4 className="font-black text-slate-800 uppercase text-sm truncate">{item.name}</h4>
                                 {item.is_active === false && <span className="bg-red-500 text-white px-1.5 py-0.5 rounded text-[8px] tracking-widest shrink-0">BANNED</span>}
                               </div>
                               {activeTab === 'USERS' && (
                                   <div className="flex items-center justify-between mt-1">
                                      <p className="text-[10px] text-slate-400 font-mono truncate">ID: {maskNationalID(item.national_id)}</p>
                                      {item.last_login ? (
                                        <span className="text-[8px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded flex items-center gap-1">
                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> Active
                                        </span>
                                      ) : (
                                        <span className="text-[8px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1">
                                            <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div> Pending
                                        </span>
                                      )}
                                   </div>
                               )}
                               {activeTab === 'VENDORS' && <p className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">Reg: {new Date(item.created_at).toLocaleDateString()}</p>}
                            </div>
                            {activeTab === 'USERS' && (
                              <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-slate-300 cursor-pointer accent-blue-600 shrink-0"
                                checked={selectedIds.has(item.id)}
                                onChange={() => toggleSelect(item.id)}
                              />
                            )}
                         </div>

                         {/* Card Body */}
                         <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex flex-col gap-2">
                           {activeTab === 'USERS' ? (
                             <>
                               <div className="flex justify-between items-center">
                                 <span className="text-[9px] font-black text-slate-400 uppercase">Vendor</span>
                                 <span className="text-[10px] font-black text-slate-700 truncate max-w-[60%] text-right">{item.vendors?.name || 'EXTERNAL'}</span>
                               </div>
                               <div className="flex justify-between items-center">
                                 <span className="text-[9px] font-black text-slate-400 uppercase">Cert</span>
                                 {item.is_active === false ? (
                                    <span className="text-[9px] font-black text-red-500 flex items-center gap-1"><Ban size={10}/> Suspended</span>
                                 ) : cardCs === 'valid' ? (
                                    <span title={getCertDaysLabel(item)} className="text-[9px] font-black text-emerald-600 flex items-center gap-1 cursor-help"><ShieldCheck size={10}/> Certified</span>
                                 ) : cardCs === 'expiring' ? (
                                    <span title={getCertDaysLabel(item)} className="text-[9px] font-black text-amber-500 flex items-center gap-1 cursor-help"><Clock size={10}/> Expiring Soon</span>
                                 ) : cardCs === 'expired' ? (
                                    <span title={getCertDaysLabel(item)} className="text-[9px] font-black text-orange-500 flex items-center gap-1 cursor-help"><CalendarClock size={10}/> Expired</span>
                                 ) : (
                                    <span className="text-[9px] font-black text-rose-400 flex items-center gap-1"><ShieldAlert size={10}/> No Cert</span>
                                 )}
                               </div>
                             </>
                           ) : (
                             <div className="flex justify-between items-center">
                               <span className="text-[9px] font-black text-slate-400 uppercase">Status</span>
                               <div className={`px-2 py-1 rounded-md text-[9px] font-black border uppercase ${item.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : item.status === 'REJECTED' ? 'bg-red-50 text-red-600 border-red-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>
                                  {item.status || 'PENDING'}
                               </div>
                             </div>
                           )}
                         </div>

                         {/* Card Actions */}
                         <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                            {activeTab === 'VENDORS' && item.status !== 'APPROVED' && (
                              <button onClick={() => handleUpdateVendorStatus(item.id, item.name, 'APPROVED')} className="p-2.5 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 active:scale-90 transition-all"><CheckCircle size={14} /></button>
                            )}
                            {activeTab === 'VENDORS' && item.status === 'PENDING' && (
                              <button onClick={() => handleUpdateVendorStatus(item.id, item.name, 'REJECTED')} className="p-2.5 rounded-xl border border-red-200 text-red-500 bg-red-50 active:scale-90 transition-all"><Ban size={14} /></button>
                            )}
                            <button onClick={() => activeTab === 'VENDORS' ? handleEditVendor(item.id, item.name) : handleEditUser(item)} className="p-2.5 rounded-xl border border-slate-200 text-slate-500 bg-white active:scale-90 transition-all"><Edit3 size={14} /></button>
                            {activeTab === 'USERS' && (
                              <>
                                <button onClick={() => handleResetTraining(item.id, item.name)} className="p-2.5 rounded-xl border border-amber-200 text-amber-500 bg-amber-50 active:scale-90 transition-all"><RotateCcw size={14} /></button>
                                <button
                                    onClick={() => handleToggleUserBan(item.id, item.name, item.is_active !== false)}
                                    className={`p-2.5 rounded-xl border transition-all active:scale-90 ${item.is_active !== false ? 'border-red-200 text-red-500 bg-red-50' : 'bg-red-500 text-white'}`}
                                >
                                    {item.is_active !== false ? <ShieldAlert size={14} /> : <CheckCircle2 size={14} />}
                                </button>
                              </>
                            )}
                            <button onClick={() => activeTab === 'VENDORS' ? handleDeleteVendor(item.id, item.name) : handleDeleteUser(item.id, item.name)} className="p-2.5 rounded-xl border border-slate-200 text-slate-400 bg-slate-50 active:scale-90 transition-all"><Trash2 size={14} /></button>
                         </div>
                      </div>
                      );
                    })
                 )}
              </div>
              
              {/* ✅ แถบ Pagination ด้านล่าง */}
              {renderPagination('bottom')}
            </div>
          )}
        </div>
      </div>

      {/* 📝 EDIT USER MODAL */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => setIsEditModalOpen(false)} />
          <div className="bg-white w-full max-w-lg rounded-[2rem] md:rounded-[2.5rem] shadow-2xl border relative z-10 p-6 md:p-8 text-left animate-in zoom-in-95 duration-300 max-h-[95vh] overflow-y-auto mx-4 md:mx-0">
              <div className="flex justify-between items-center mb-6 border-b pb-4 sticky top-0 bg-white z-20">
                  <div>
                    <h3 className="text-lg md:text-xl font-black text-slate-900 uppercase">Edit Profile</h3>
                    <p className="text-[10px] text-blue-500 font-bold uppercase tracking-widest mt-1">ID: {maskNationalID(editingUser?.national_id)}</p>
                  </div>
                  <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-red-500 transition-colors bg-slate-50 p-3 rounded-full"><X size={20}/></button>
              </div>
              <div className="space-y-4">
                  <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Full Name</label>
                      <input className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold text-base shadow-inner outline-none focus:border-blue-500" value={editForm.name} onChange={e=>setEditForm({...editForm, name: e.target.value})}/>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Age / อายุ</label>
                          <input type="number" className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold text-base shadow-inner outline-none focus:border-blue-500" value={editForm.age} onChange={e=>setEditForm({...editForm, age: e.target.value})}/>
                      </div>
                      <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Nationality</label>
                          <select className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold text-base shadow-inner outline-none focus:border-blue-500" value={isOtherNationality ? 'OTHER' : editForm.nationality} onChange={(e) => {
                              const val = e.target.value;
                              if (val === 'OTHER') { setIsOtherNationality(true); setEditForm({...editForm, nationality: ''}); } 
                              else { setIsOtherNationality(false); setEditForm({...editForm, nationality: val}); }
                            }}>
                            <option value="ไทย (Thai)">ไทย (Thai)</option>
                            <option value="พม่า (Myanmar)">พม่า (Myanmar)</option>
                            <option value="กัมพูชา (Cambodian)">กัมพูชา (Cambodian)</option>
                            <option value="ลาว (Lao)">ลาว (Lao)</option>
                            <option value="OTHER">อื่นๆ / Other</option>
                          </select>
                      </div>
                  </div>
                  <div className="space-y-1 mt-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 flex items-center gap-2"><Building2 size={12}/> Company / Vendor</label>
                      <select 
                          className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold shadow-inner outline-none focus:border-blue-500 cursor-pointer text-base truncate" 
                          value={editForm.vendor_id} 
                          onChange={(e) => setEditForm({...editForm, vendor_id: e.target.value})}
                      >
                          <option value="">-- ไม่ระบุสังกัด (EXTERNAL) --</option>
                          {allVendors.map(v => (
                              <option key={v.id} value={v.id}>{v.name}</option>
                          ))}
                      </select>
                  </div>
                  <div className="bg-amber-50 p-4 md:p-5 rounded-3xl border border-amber-100 shadow-sm mt-4 text-left">
                      <label className="text-[10px] font-black text-amber-600 uppercase flex items-center gap-2 mb-3"><CalendarClock size={16}/> Induction Expiry (Override)</label>
                      <input type="date" className="w-full bg-white border border-amber-200 p-3 rounded-xl font-bold text-base outline-none focus:border-amber-500 transition-all" value={editForm.induction_expiry} onChange={e=>setEditForm({...editForm, induction_expiry: e.target.value})}/>
                  </div>
              </div>
              <div className="flex gap-3 mt-6 md:mt-8">
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
  <button onClick={onClick} className={`shrink-0 px-4 md:px-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all whitespace-nowrap active:scale-95 ${active ? 'bg-white text-blue-600 shadow-md border-b-2 border-blue-500' : 'text-slate-400 hover:text-slate-600 hover:bg-white/50'}`}>{icon} {label}</button>
);

export default VendorManager;