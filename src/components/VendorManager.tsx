import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../services/supabaseClient';
import { api } from '../services/supabaseApi';
import { AuditLog, Vendor, VendorNameMatch, VendorStatus } from '../types';
import { useToastContext } from './ToastProvider';
import { downloadWorkbook } from '../services/excelExport';
import { readFirstWorksheetRows } from '../services/excelImport';
import { 
  Users, Building2, Search, Plus, RotateCcw, CheckCircle, Loader2,
  Trash2, Edit3, UserPlus, Upload, Download, History, ShieldCheck,
  X, Globe2, Calendar, CalendarClock, Ban, Clock, CheckCircle2,
  ShieldAlert, ChevronLeft, ChevronRight, KeyRound
} from 'lucide-react';
import AsyncState from './AsyncState';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { buildDirectoryFilterSummary } from '../services/directoryFilterSummary';
import ImportPreviewDialog from './ImportPreviewDialog';
import VendorImportReviewDialog, { VendorImportReviewItem } from './VendorImportReviewDialog';
import UserRoleDialog from './UserRoleDialog';
import { presentAuditLog } from '../services/auditPresentation';
import {
  getImportSummary,
  prepareUserImportRows,
  prepareVendorImportRows,
  PreparedUserImportRow,
  PreparedVendorImportRow,
} from '../services/importValidation';

const maskNationalID = (id: string | null | undefined) => {
  if (!id || id.length < 13) return '-------------';
  return `${id.substring(0, 3)}••••••${id.substring(9)}`;
};

const normalizeVendorNameForComparison = (name: string) => name
  .trim()
  .toLocaleLowerCase()
  .replace(/[\s\p{P}\p{S}]+/gu, '');

const auditToneClasses = {
  blue: 'bg-blue-50 text-blue-700 border-blue-100',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  amber: 'bg-amber-50 text-amber-800 border-amber-100',
  red: 'bg-red-50 text-red-700 border-red-100',
  violet: 'bg-violet-50 text-violet-700 border-violet-100',
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
};

const VendorManager: React.FC<{ initialSearch?: string | null }> = ({ initialSearch }) => {
  const { showToast } = useToastContext();
  
  const [activeTab, setActiveTab] = useState<'USERS' | 'VENDORS' | 'LOGS'>(initialSearch ? 'USERS' : 'VENDORS');
  const [searchQuery, setSearchQuery] = useState(initialSearch || '');
  const [selectedVendorFilter, setSelectedVendorFilter] = useState('');
  const [certFilter, setCertFilter] = useState<'' | 'NO_CERT' | 'EXPIRING' | 'HAS_CERT'>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [resettingPinUserId, setResettingPinUserId] = useState<string | null>(null);
  const [currentAdminId, setCurrentAdminId] = useState<string | null>(null);
  const [roleDialogUser, setRoleDialogUser] = useState<any | null>(null);
  const [savingUserRole, setSavingUserRole] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [dataList, setDataList] = useState<any[]>([]);
  const [allVendors, setAllVendors] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [userStats, setUserStats] = useState<{ total: number; noCert: number; expired: number; expiring: number; valid: number } | null>(null);
  
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10); 
  
  const [importingUsers, setImportingUsers] = useState(false);
  const [importingVendors, setImportingVendors] = useState(false);
  const [pendingImport, setPendingImport] = useState<
    | { kind: 'USERS'; fileName: string; rows: PreparedUserImportRow[] }
    | { kind: 'VENDORS'; fileName: string; rows: PreparedVendorImportRow[] }
    | null
  >(null);
  
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [editForm, setEditForm] = useState({ 
    name: '', age: '', nationality: '', induction_expiry: '', vendor_id: '' 
  });
  const [isOtherNationality, setIsOtherNationality] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [vendorDialogOpen, setVendorDialogOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [vendorFormName, setVendorFormName] = useState('');
  const [vendorFormStatus, setVendorFormStatus] = useState<VendorStatus>(VendorStatus.PENDING);
  const [vendorMatches, setVendorMatches] = useState<VendorNameMatch[]>([]);
  const [vendorMatchLoading, setVendorMatchLoading] = useState(false);
  const [vendorMatchError, setVendorMatchError] = useState('');
  const [allowSimilarVendor, setAllowSimilarVendor] = useState(false);
  const [savingVendor, setSavingVendor] = useState(false);
  const [vendorDuplicateGroups, setVendorDuplicateGroups] = useState<Array<{
    normalized_name: string;
    vendor_count: number;
    vendors: Array<Pick<Vendor, 'id' | 'name' | 'status' | 'created_at'>>;
  }>>([]);
  const [vendorImportReview, setVendorImportReview] = useState<VendorImportReviewItem[]>([]);
  const [vendorImportReviewOpen, setVendorImportReviewOpen] = useState(false);
  const [resolvingVendorImportId, setResolvingVendorImportId] = useState<string | null>(null);

  const userFileInputRef = useRef<HTMLInputElement>(null);
  const vendorFileInputRef = useRef<HTMLInputElement>(null);
  const editDialogRef = useRef<HTMLDivElement>(null);
  const vendorDialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(isEditModalOpen, editDialogRef, () => setIsEditModalOpen(false));
  useDialogFocus(vendorDialogOpen, vendorDialogRef, () => setVendorDialogOpen(false));

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [activeTab, searchQuery, selectedVendorFilter, certFilter, itemsPerPage]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentAdminId(data.user?.id || null));
  }, []);

  const loadData = async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setLoadError('');
    }
    try {
      const [result, vendorsResult] = await Promise.all([
        api.getDirectoryPage({
          section: activeTab,
          page: currentPage,
          pageSize: itemsPerPage === -1 ? 5000 : itemsPerPage,
          search: activeTab === 'LOGS' ? '' : searchQuery,
          vendorFilter: activeTab === 'USERS' ? selectedVendorFilter : '',
          certFilter: activeTab === 'USERS' ? certFilter : '',
        }),
        supabase.from('vendors').select('id, name').eq('status', 'APPROVED').order('name'),
      ]);

      if (activeTab === 'LOGS') setLogs(result.rows);
      else setDataList(result.rows);
      setTotalItems(result.total);
      setUserStats(activeTab === 'USERS' ? result.stats : null);
      const resultTotalPages = itemsPerPage === -1 ? 1 : Math.max(1, Math.ceil(result.total / itemsPerPage));
      if (currentPage > resultTotalPages) setCurrentPage(resultTotalPages);

      const { data: vData } = vendorsResult;
      setAllVendors(vData || []);

    } catch (err: any) {
      if (!silent) setLoadError(err?.message || 'ไม่สามารถโหลดข้อมูลได้');
      showToast('ไม่สามารถโหลดข้อมูลได้: ' + err.message, 'error');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => loadData(), searchQuery ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [activeTab, currentPage, itemsPerPage, searchQuery, selectedVendorFilter, certFilter]);

  // Auto-refresh every 60s (skip LOGS tab to avoid noise)
  useEffect(() => {
    if (activeTab === 'LOGS') return;
    const timer = setInterval(() => { loadData(true); }, 60000);
    return () => clearInterval(timer);
  }, [activeTab, currentPage, itemsPerPage, searchQuery, selectedVendorFilter, certFilter]);

  const loadVendorDuplicateGroups = async () => {
    try {
      setVendorDuplicateGroups(await api.getVendorDuplicateGroups());
    } catch (duplicateError) {
      console.error('Vendor duplicate report failed:', duplicateError);
      setVendorDuplicateGroups([]);
    }
  };

  useEffect(() => {
    if (activeTab === 'VENDORS') void loadVendorDuplicateGroups();
  }, [activeTab]);

  useEffect(() => {
    if (!vendorDialogOpen || vendorFormName.trim().length < 2) {
      setVendorMatches([]);
      setVendorMatchError('');
      setVendorMatchLoading(false);
      return;
    }

    let active = true;
    setVendorMatchLoading(true);
    setVendorMatchError('');
    const timer = window.setTimeout(() => {
      api.findVendorNameMatches(vendorFormName.trim(), editingVendor?.id)
        .then((matches) => {
          if (active) setVendorMatches(matches);
        })
        .catch((matchError) => {
          console.error('Vendor name match failed:', matchError);
          if (active) {
            setVendorMatches([]);
            setVendorMatchError('ตรวจสอบชื่อบริษัทไม่สำเร็จ กรุณาลองอีกครั้ง');
          }
        })
        .finally(() => {
          if (active) setVendorMatchLoading(false);
        });
    }, 300);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [vendorDialogOpen, vendorFormName, editingVendor?.id]);

  const getAllDirectoryRows = async (section: 'USERS' | 'VENDORS') => {
    const pageSize = 1000;
    const rows: any[] = [];
    let page = 1;
    let total = 0;
    do {
      const result = await api.getDirectoryPage({
        section,
        page,
        pageSize,
        search: searchQuery,
        vendorFilter: section === 'USERS' ? selectedVendorFilter : '',
        certFilter: section === 'USERS' ? certFilter : '',
      });
      rows.push(...result.rows);
      total = result.total;
      if (result.rows.length === 0) break;
      page += 1;
    } while (rows.length < total);
    return rows;
  };

  const handleUpdateVendorStatus = async (id: string, name: string, newStatus: 'APPROVED' | 'REJECTED') => {
    const confirmMsg = newStatus === 'APPROVED' ? `ยืนยันการอนุมัติบริษัท ${name}?` : `ยืนยันการปฏิเสธบริษัท ${name}?`;
    if (!window.confirm(confirmMsg)) return;
    try {
      const result = await api.adminSaveVendor({ id, name, status: newStatus, allowSimilar: true });
      if (!result?.saved) throw new Error('ไม่สามารถปรับสถานะบริษัทได้');
      showToast(`ปรับสถานะบริษัท ${name} เป็น ${newStatus} สำเร็จ`, 'success');
      loadData();
    } catch (err: any) { showToast(err.message, 'error'); }
  };

  const closeVendorDialog = (force = false) => {
    if (savingVendor && !force) return;
    setVendorDialogOpen(false);
    setEditingVendor(null);
    setVendorMatches([]);
    setVendorMatchError('');
    setAllowSimilarVendor(false);
  };

  const handleEditVendor = (vendor: Vendor) => {
    setEditingVendor(vendor);
    setVendorFormName(vendor.name);
    setVendorFormStatus(vendor.status || VendorStatus.PENDING);
    setVendorMatches([]);
    setVendorMatchError('');
    setAllowSimilarVendor(false);
    setVendorDialogOpen(true);
  };

  const handleUseExistingVendor = (match: VendorNameMatch) => {
    setVendorDialogOpen(false);
    setEditingVendor(null);
    setVendorMatches([]);
    setSearchQuery(match.name);
    setCurrentPage(1);
    showToast(`แสดงบริษัทเดิม: ${match.name}`, 'info');
  };

  const handleSaveVendor = async () => {
    const trimmedName = vendorFormName.trim();
    const unchangedName = Boolean(editingVendor)
      && normalizeVendorNameForComparison(trimmedName) === normalizeVendorNameForComparison(editingVendor?.name || '');
    const exactMatch = unchangedName ? undefined : vendorMatches.find((match) => match.match_type === 'EXACT');
    const similarMatches = vendorMatches.filter((match) => match.match_type === 'SIMILAR');
    if (!trimmedName) {
      showToast('กรุณาระบุชื่อบริษัท', 'error');
      return;
    }
    if (exactMatch) {
      showToast(`มีบริษัท ${exactMatch.name} อยู่ในระบบแล้ว`, 'error');
      return;
    }
    if (similarMatches.length > 0 && !allowSimilarVendor) {
      showToast('กรุณาตรวจสอบชื่อที่ใกล้เคียงและยืนยันว่าเป็นคนละบริษัท', 'info');
      return;
    }

    setSavingVendor(true);
    try {
      const result = await api.adminSaveVendor({
        id: editingVendor?.id,
        name: trimmedName,
        status: vendorFormStatus,
        allowSimilar: allowSimilarVendor,
      });

      if (!result.saved) {
        setVendorMatches(result.matches || (result.vendor ? [{
          ...result.vendor,
          match_type: 'EXACT' as const,
          match_score: 1,
        }] : []));
        setAllowSimilarVendor(false);
        showToast(result.reason === 'EXACT' ? 'พบชื่อบริษัทซ้ำในระบบ' : 'พบชื่อบริษัทที่ใกล้เคียง กรุณาตรวจสอบก่อนบันทึก', 'info');
        return;
      }

      showToast(editingVendor ? 'แก้ไขชื่อบริษัทสำเร็จ' : 'เพิ่มบริษัทสำเร็จ', 'success');
      closeVendorDialog(true);
      await Promise.all([loadData(), loadVendorDuplicateGroups()]);

      if (result.created && vendorFormStatus === VendorStatus.PENDING) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.access_token) {
            await fetch('/api/notify-admin', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({ vendorName: trimmedName }),
            });
          }
        } catch (notificationError) {
          console.error('LINE Admin Notification Trigger Error:', notificationError);
        }
      }
    } catch (saveError: any) {
      const message = saveError?.message?.includes('DUPLICATE_VENDOR_NAME')
        ? 'มีชื่อบริษัทนี้อยู่ในระบบแล้ว กรุณาใช้รายการเดิม'
        : saveError?.message || 'บันทึกบริษัทไม่สำเร็จ';
      showToast(message, 'error');
    } finally {
      setSavingVendor(false);
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
      const { error } = await supabase.rpc('admin_update_user_profile', {
        user_id_param: editingUser.id,
        name_param: editForm.name,
        age_param: Number(editForm.age),
        nationality_param: editForm.nationality,
        vendor_id_param: editForm.vendor_id || null,
        induction_expiry_param: expiryVal,
      });

      if (error) throw error;
      showToast('อัปเดตข้อมูลพนักงานสำเร็จ', 'success');
      setIsEditModalOpen(false);
      loadData();
    } catch (err: any) { showToast(err.message, 'error'); } 
    finally { setSubmitting(false); }
  };

  const handleToggleUserBan = async (id: string, name: string, currentStatus: boolean) => {
      const actionText = currentStatus ? "ระงับสิทธิ์ (Ban)" : "ปลดแบน (Unban)";
      if (!window.confirm(`คุณต้องการ ${actionText} พนักงาน "${name}" ใช่หรือไม่?`)) return;

      try {
          const { error } = await supabase.rpc('admin_set_user_active', {
            user_id_param: id,
            is_active_param: !currentStatus,
          });
          if (error) throw error;
          showToast(`${actionText} สำเร็จ`, 'success');
          loadData();
      } catch (err: any) {
          showToast(`ไม่สามารถ ${actionText} ได้: ` + err.message, 'error');
      }
  };

  const handleExport = async () => {
    let exportData = [];
    let fileName = '';

    if (activeTab === 'USERS') {
      const exportRows = await getAllDirectoryRows('USERS');
      exportData = exportRows.map(user => ({
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
      const exportRows = await getAllDirectoryRows('VENDORS');
      exportData = exportRows.map(vendor => ({
        'Company Name': vendor.name,
        'Status': vendor.status,
        'Registry Date': new Date(vendor.created_at).toLocaleDateString()
      }));
      fileName = `Vendor_List_${new Date().toISOString().split('T')[0]}.xlsx`;
    }

    if(exportData.length === 0) return showToast('ไม่พบข้อมูลที่จะส่งออก', 'error');

    const headers = Object.keys(exportData[0]);
    const rows = exportData.map((item) => headers.map((header) => item[header]));
    try {
      await downloadWorkbook(activeTab, headers, rows, fileName);
      showToast('Exported Successfully', 'success');
    } catch (err) {
      console.error('Excel export error:', err);
      showToast('Export failed', 'error');
    }
  };

  const handleUserImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImportingUsers(true);
    try {
      const rows = prepareUserImportRows(await readFirstWorksheetRows(file), allVendors);
      if (rows.length === 0) return showToast('ไม่พบข้อมูลที่จะนำเข้า', 'error');
      setPendingImport({ kind: 'USERS', fileName: file.name, rows });
    } catch (err) {
      console.error('User import preview error:', err);
      showToast('ไม่สามารถอ่านไฟล์ได้ กรุณาตรวจสอบว่าเป็นไฟล์ .xlsx ที่ถูกต้อง', 'error');
    } finally {
      setImportingUsers(false);
    }
  };

  const handleVendorImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImportingVendors(true);
    setVendorImportReview([]);
    try {
      const rows = prepareVendorImportRows(await readFirstWorksheetRows(file));
      if (rows.length === 0) return showToast('ไม่พบข้อมูลที่จะนำเข้า', 'error');
      setPendingImport({ kind: 'VENDORS', fileName: file.name, rows });
    } catch (err) {
      console.error('Vendor import preview error:', err);
      showToast('ไม่สามารถอ่านไฟล์ได้ กรุณาตรวจสอบว่าเป็นไฟล์ .xlsx ที่ถูกต้อง', 'error');
    } finally {
      setImportingVendors(false);
    }
  };

  const confirmPendingImport = async () => {
    if (!pendingImport) return;
    if (pendingImport.kind === 'USERS') {
      setImportingUsers(true);
      let success = 0;
      let fail = 0;
      try {
        for (const row of pendingImport.rows) {
          if (row.issues.some((issue) => issue.level === 'error')) continue;
          const { error } = await supabase.rpc('admin_upsert_staged_user', {
            national_id_param: row.nationalId,
            name_param: row.name,
            vendor_id_param: row.vendorId,
            role_param: row.role,
            age_param: row.age,
            nationality_param: row.nationality,
            induction_expiry_param: row.inductionExpiry,
          });
          if (error) { console.error(`User import row ${row.rowNumber}:`, error.message); fail++; }
          else success++;
        }
        setPendingImport(null);
        showToast(`นำเข้าพนักงานสำเร็จ ${success} รายการ${fail ? ` · ไม่สำเร็จ ${fail}` : ''}`, fail > 0 ? 'error' : 'success');
        await loadData();
      } catch (error: any) {
        console.error('User import failed:', error);
        showToast(error?.message || 'นำเข้าพนักงานไม่สำเร็จ กรุณาลองใหม่', 'error');
      } finally {
        setImportingUsers(false);
      }
      return;
    }

    setImportingVendors(true);
    let successCount = 0;
    let duplicateCount = 0;
    let similarCount = 0;
    const reviewItems: VendorImportReviewItem[] = [];
    try {
      for (const row of pendingImport.rows) {
        if (row.issues.some((issue) => issue.level === 'error')) continue;
        const result = await api.adminSaveVendor({ name: row.name, status: VendorStatus.APPROVED, allowSimilar: false });
        if (result.saved) successCount++;
        else if (result.reason === 'EXACT') {
          duplicateCount++;
          reviewItems.push({
            id: `row-${row.rowNumber}`,
            inputName: row.name,
            reason: 'EXACT',
            matches: result.vendor ? [{ ...result.vendor, match_type: 'EXACT', match_score: 1 }] : [],
            resolution: { kind: 'EXACT_SKIPPED', vendorName: result.vendor?.name },
          });
        } else {
          similarCount++;
          reviewItems.push({ id: `row-${row.rowNumber}`, inputName: row.name, reason: 'SIMILAR', matches: result.matches });
        }
      }
      setPendingImport(null);
      setVendorImportReview(reviewItems);
      setVendorImportReviewOpen(reviewItems.length > 0);
      if (successCount > 0) {
        showToast(`นำเข้าสำเร็จ ${successCount} บริษัท · ซ้ำ ${duplicateCount} · ชื่อคล้ายรอตรวจ ${similarCount}`, 'success');
        await Promise.all([loadData(), loadVendorDuplicateGroups()]);
      } else if (duplicateCount > 0 || similarCount > 0) {
        showToast(`ไม่มีรายการใหม่: ซ้ำ ${duplicateCount} · ชื่อคล้ายรอตรวจ ${similarCount}`, 'info');
      } else showToast('ไม่พบข้อมูลที่จะนำเข้า', 'error');
    } catch (error: any) {
      console.error('Vendor import failed:', error);
      showToast(error?.message || 'นำเข้าบริษัทไม่สำเร็จ กรุณาลองใหม่', 'error');
    } finally {
      setImportingVendors(false);
    }
  };

  const handleUseExistingImportedVendor = (itemId: string, match: VendorNameMatch) => {
    setVendorImportReview((items) => items.map((item) => item.id === itemId
      ? { ...item, resolution: { kind: 'USED_EXISTING', vendorName: match.name } }
      : item));
    showToast(`ใช้บริษัทเดิม ${match.name} และไม่เพิ่มรายการใหม่`, 'success');
  };

  const handleCreateImportedVendor = async (itemId: string) => {
    const item = vendorImportReview.find((candidate) => candidate.id === itemId);
    if (!item || item.reason !== 'SIMILAR' || item.resolution) return;
    setResolvingVendorImportId(itemId);
    try {
      const result = await api.adminSaveVendor({ name: item.inputName, status: VendorStatus.APPROVED, allowSimilar: true });
      if (!result.saved) {
        if (result.reason === 'EXACT' && result.vendor) {
          setVendorImportReview((items) => items.map((candidate) => candidate.id === itemId
            ? {
              ...candidate,
              reason: 'EXACT',
              matches: [{ ...result.vendor!, match_type: 'EXACT', match_score: 1 }],
              resolution: { kind: 'EXACT_SKIPPED', vendorName: result.vendor!.name },
            }
            : candidate));
          showToast(`พบ ${result.vendor.name} ในระบบแล้ว จึงไม่ได้เพิ่มซ้ำ`, 'info');
          return;
        }
        throw new Error('ระบบยังไม่สามารถยืนยันการเพิ่มบริษัทนี้ได้');
      }
      setVendorImportReview((items) => items.map((candidate) => candidate.id === itemId
        ? { ...candidate, resolution: { kind: 'CREATED_NEW', vendorName: result.vendor?.name || item.inputName } }
        : candidate));
      showToast(`เพิ่มบริษัทใหม่ ${result.vendor?.name || item.inputName} แล้ว`, 'success');
      await Promise.all([loadData(), loadVendorDuplicateGroups()]);
    } catch (error: any) {
      showToast(error?.message || 'เพิ่มบริษัทไม่สำเร็จ กรุณาลองใหม่', 'error');
    } finally {
      setResolvingVendorImportId(null);
    }
  };

  const handleAddVendor = () => {
    setEditingVendor(null);
    setVendorFormName('');
    setVendorFormStatus(VendorStatus.PENDING);
    setVendorMatches([]);
    setVendorMatchError('');
    setAllowSimilarVendor(false);
    setVendorDialogOpen(true);
  };

  const handleDeleteVendor = async (id: string, name: string) => {
    if (!window.confirm(`ยืนยันการเก็บบริษัท "${name}" ออกจากรายการใช้งาน? ข้อมูลเชื่อมโยงเดิมจะยังคงอยู่`)) return;
    try {
      await api.adminArchiveVendor(id);
      showToast('เก็บบริษัทแล้ว โดยยังรักษาข้อมูลเชื่อมโยงเดิม', 'success');
      loadData();
    } catch (archiveError: any) {
      showToast(archiveError?.message || 'ไม่สามารถเก็บบริษัทได้', 'error');
    }
  };

  const handleAddUser = async () => {
    const name = window.prompt("ชื่อ-นามสกุล:");
    const nid = window.prompt("เลขบัตรประชาชน:");
    if (!name || !nid) return;
    const { error } = await supabase.rpc('admin_upsert_staged_user', {
      national_id_param: nid,
      name_param: name,
      vendor_id_param: null,
      role_param: 'USER',
      age_param: null,
      nationality_param: 'ไทย (Thai)',
      induction_expiry_param: null,
    });
    if (error) showToast(error.message, 'error'); else { showToast('Success', 'success'); loadData(); }
  };

  const handleDeleteUser = async (id: string, name: string) => {
    if (!window.confirm(`ยืนยันการระงับและเก็บบัญชี "${name}"?\nประวัติการสอบ ใบอนุญาต และ Audit Log จะถูกเก็บไว้ทั้งหมด`)) return;
    
    setLoading(true);
    try {
      await api.adminArchiveUser(id);
      showToast(`เก็บบัญชี ${name} แล้ว โดยรักษาประวัติทั้งหมด`, 'success');
      loadData();
    } catch (err: any) { 
      console.error("Delete Error:", err);
      showToast('ไม่สามารถลบได้: ' + err.message, 'error'); 
    } finally { 
      setLoading(false); 
    }
  };

  const handleResetUserPin = async (id: string, name: string) => {
    const confirmed = window.confirm(
      `รีเซต PIN ของ "${name}" ใช่หรือไม่?\n\nผู้ใช้จะต้องเข้าสู่ระบบด้วยเลขบัตรประชาชน 6 หลักท้ายภายใน 30 นาที และตั้ง PIN ใหม่ก่อนเข้าใช้งาน`,
    );
    if (!confirmed) return;

    setResettingPinUserId(id);
    try {
      await api.adminResetUserPin(id);
      showToast(`รีเซต PIN ของ ${name} แล้ว กรุณาแจ้งให้ใช้เลขบัตร 6 หลักท้ายภายใน 30 นาที`, 'success');
    } catch (error: any) {
      showToast(error?.message || 'ไม่สามารถรีเซต PIN ได้', 'error');
    } finally {
      setResettingPinUserId(null);
    }
  };

  const handleResetTraining = async (id: string, name: string) => {
    if(!window.confirm("Reset induction status for this user?")) return;
    const { error } = await supabase.rpc('admin_reset_induction', { user_ids_param: [id] });
    if (error) showToast(error.message, 'error'); else { showToast('Reset Complete', 'success'); loadData(); }
  };

  const handleConfirmUserRole = async (role: 'ADMIN' | 'USER') => {
    if (!roleDialogUser) return;
    setSavingUserRole(true);
    try {
      const result = await api.adminSetUserRole(roleDialogUser.id, role);
      showToast(result.changed
        ? `เปลี่ยนสิทธิ์ ${roleDialogUser.name} เป็น ${role === 'ADMIN' ? 'ผู้ดูแลระบบ' : 'ผู้ใช้งานทั่วไป'} แล้ว`
        : 'สิทธิ์ผู้ใช้งานไม่มีการเปลี่ยนแปลง', 'success');
      setRoleDialogUser(null);
      await loadData();
    } catch (error: any) {
      const messages: Record<string, string> = {
        'You cannot change your own role': 'ไม่สามารถเปลี่ยนสิทธิ์บัญชีที่กำลังใช้งานอยู่ได้',
        'The last active admin cannot be demoted': 'ไม่สามารถลดสิทธิ์แอดมินที่ Active คนสุดท้ายได้',
        'Only active, fully registered users can become admins': 'เลื่อนเป็นแอดมินได้เฉพาะผู้ใช้ที่ลงทะเบียนสำเร็จและบัญชี Active แล้ว',
      };
      showToast(messages[error?.message] || error?.message || 'เปลี่ยนสิทธิ์ผู้ใช้ไม่สำเร็จ', 'error');
    } finally {
      setSavingUserRole(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const handleBulkExport = async () => {
    const { data, error } = await supabase.rpc('admin_list_users');
    if (error) return showToast('ไม่สามารถโหลดข้อมูลที่เลือกได้', 'error');
    const selected = (data || []).filter((user: any) => selectedIds.has(user.id));
    if (selected.length === 0) return showToast('ไม่พบข้อมูลที่จะส่งออก', 'error');
    const exportData = selected.map(user => ({
      'Name': user.name,
      'National ID': user.national_id ? "'" + user.national_id : '-',
      'Vendor': user.vendors?.name || 'N/A',
      'Cert Status': getCertStatus(user).toUpperCase(),
      'Induction Expiry': user.induction_expiry ? new Date(user.induction_expiry).toLocaleDateString() : '-',
      'Last Login': user.last_login ? new Date(user.last_login).toLocaleString('th-TH') : 'Never',
    }));
    const headers = Object.keys(exportData[0]);
    const rows = exportData.map((item) => headers.map((header) => item[header]));
    try {
      await downloadWorkbook('Selected', headers, rows, `Selected_Users_${new Date().toISOString().split('T')[0]}.xlsx`);
      showToast(`Exported ${selected.length} users`, 'success');
    } catch (err) {
      console.error('Excel export error:', err);
      showToast('Export failed', 'error');
    }
  };

  const handleBulkReset = async () => {
    if (!window.confirm(`Reset training for ${selectedIds.size} selected users?`)) return;
    setBulkLoading(true);
    try {
      const ids = Array.from(selectedIds);
      const { error } = await supabase.rpc('admin_reset_induction', { user_ids_param: ids });
      if (error) throw error;
      showToast(`Reset ${ids.length} users`, 'success');
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

  const totalPages = itemsPerPage === -1 ? 1 : Math.ceil(totalItems / itemsPerPage);
  const paginatedData = activeTab === 'LOGS' ? logs : dataList;

  const renderPagination = (position: 'top' | 'bottom') => {
    if (totalItems === 0) return null;
    return (
      <div className={`bg-slate-50/50 p-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 ${position === 'top' ? 'border-b border-slate-100' : 'mt-auto border-t border-slate-200 rounded-b-[1.5rem] md:rounded-b-[2.5rem]'}`}>
         <div className="flex items-center gap-2 text-[10px] md:text-xs font-bold text-slate-500 w-full sm:w-auto justify-center sm:justify-start">
            <span>แสดง</span>
            <select 
                value={itemsPerPage} 
                onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                aria-label="จำนวนรายการต่อหน้า"
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
            <span className="ml-2 hidden sm:inline text-slate-600 font-medium">| จากทั้งหมด {totalItems} รายการ</span>
         </div>

         <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
            <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                aria-label="หน้าก่อนหน้า"
                className="flex min-h-11 min-w-11 items-center justify-center gap-1 p-2 md:px-3 md:py-1.5 rounded-xl border border-slate-200 bg-white text-slate-600 disabled:opacity-50 disabled:bg-slate-50 hover:bg-slate-100 hover:text-blue-600 transition-all shadow-sm font-bold text-xs"
            >
                <ChevronLeft size={16} /> <span className="hidden md:inline">ก่อนหน้า</span>
            </button>
            <span className="text-[10px] md:text-xs font-black text-slate-600 bg-white px-4 py-1.5 rounded-xl border border-slate-200 shadow-sm">
                {currentPage} <span className="text-slate-400 mx-1">/</span> {totalPages}
            </span>
            <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages || totalPages === 0}
                aria-label="หน้าถัดไป"
                className="flex min-h-11 min-w-11 items-center justify-center gap-1 p-2 md:px-3 md:py-1.5 rounded-xl border border-slate-200 bg-white text-slate-600 disabled:opacity-50 disabled:bg-slate-50 hover:bg-slate-100 hover:text-blue-600 transition-all shadow-sm font-bold text-xs"
            >
                <span className="hidden md:inline">ถัดไป</span> <ChevronRight size={16} />
            </button>
         </div>
         <span className="sm:hidden text-slate-600 font-bold text-[9px] uppercase mt-1">รวมทั้งหมด {totalItems} รายการ</span>
      </div>
    );
  };

  const vendorNameUnchanged = Boolean(editingVendor)
    && normalizeVendorNameForComparison(vendorFormName) === normalizeVendorNameForComparison(editingVendor?.name || '');
  const exactVendorDialogMatch = vendorNameUnchanged
    ? undefined
    : vendorMatches.find((match) => match.match_type === 'EXACT');
  const similarVendorDialogMatches = vendorMatches.filter((match) => match.match_type === 'SIMILAR');
  const vendorSaveDisabled = savingVendor
    || vendorMatchLoading
    || !vendorFormName.trim()
    || Boolean(exactVendorDialogMatch)
    || (similarVendorDialogMatches.length > 0 && !allowSimilarVendor);
  const directoryFilterChips = buildDirectoryFilterSummary({
    search: searchQuery,
    vendorId: activeTab === 'USERS' ? selectedVendorFilter : '',
    vendorName: allVendors.find((vendor) => vendor.id === selectedVendorFilter)?.name,
    certificate: activeTab === 'USERS' ? certFilter : '',
  });
  const clearDirectoryFilters = () => {
    setSearchQuery('');
    setSelectedVendorFilter('');
    setCertFilter('');
    setCurrentPage(1);
  };
  const pendingImportSummary = pendingImport ? getImportSummary(pendingImport.rows) : null;
  const pendingImportDisplayRows = pendingImport?.rows.map((row) => pendingImport.kind === 'USERS'
    ? {
        rowNumber: row.rowNumber,
        primary: row.name,
        secondary: `${row.nationalId || 'ไม่มีเลขประจำตัว'}${row.vendorName ? ` · ${row.vendorName}` : ''}`,
        issues: row.issues,
      }
    : {
        rowNumber: row.rowNumber,
        primary: row.name,
        secondary: 'บริษัท / Vendor',
        issues: row.issues,
      });

  return (
    <div className="space-y-4 md:space-y-6 text-left animate-in fade-in duration-500 pb-10 relative px-2 md:px-0">
      
      {/* 🟢 Header Section */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 lg:gap-6 border-b border-slate-200 pb-4 lg:pb-6">
        <div>
          <h2 className="text-2xl md:text-3xl font-black text-slate-900 uppercase">Directory Control</h2>
          <div className="text-slate-600 font-bold text-[10px] uppercase tracking-[0.2em] mt-2 flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" /> Security Compliance Node
          </div>
        </div>
        <div className="flex w-full lg:w-auto bg-slate-100 p-1 rounded-2xl border border-slate-200 shadow-inner overflow-x-auto no-scrollbar">
          <TabButton active={activeTab === 'VENDORS'} onClick={() => {setActiveTab('VENDORS'); setCurrentPage(1); setSearchQuery(''); setSelectedVendorFilter(''); setCertFilter('');}} icon={<Building2 size={14}/>} label="Vendors" />
          <TabButton active={activeTab === 'USERS'} onClick={() => {setActiveTab('USERS'); setCurrentPage(1); setSearchQuery(''); setSelectedVendorFilter(''); setCertFilter('');}} icon={<Users size={14}/>} label="Personnel" />
          <TabButton active={activeTab === 'LOGS'} onClick={() => {setActiveTab('LOGS'); setCurrentPage(1); setSearchQuery(''); setSelectedVendorFilter(''); setCertFilter('');}} icon={<History size={14}/>} label="ประวัติ" />
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
                <input aria-label={`ค้นหา ${activeTab.toLowerCase()}`} className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-2xl font-bold text-base md:text-sm outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all shadow-sm" placeholder={`Search ${activeTab.toLowerCase()}...`} value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }} />
              </div>
              
              {/* ตัวกรองบริษัท */}
              {activeTab === 'USERS' && (
                <div className="relative w-full md:w-64">
                  <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <select
                    className="w-full pl-10 pr-8 py-3 bg-white border border-slate-200 rounded-2xl font-bold text-[11px] text-slate-600 outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all shadow-sm appearance-none cursor-pointer truncate"
                    value={selectedVendorFilter}
                    onChange={(e) => { setSelectedVendorFilter(e.target.value); setCurrentPage(1); }}
                    aria-label="กรองบริษัทของผู้ใช้"
                  >
                    <option value="">ทุกบริษัท (All Vendors)</option>
                    {allVendors.map(v => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                    <option value="EXTERNAL">ไม่ระบุสังกัด (EXTERNAL)</option>
                  </select>
                </div>
              )}

              {/* ตัวกรองใบเซอร์ */}
              {activeTab === 'USERS' && (
                <div className="flex items-center gap-1.5 w-full md:w-auto flex-wrap">
                  <button
                    onClick={() => setCertFilter('')}
                    className={`min-h-11 flex-1 md:flex-none flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-2xl font-black text-[10px] uppercase tracking-wide border transition-all active:scale-95 ${certFilter === '' ? 'bg-slate-900 text-white border-slate-900 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
                  >
                    <Users size={13}/><span className="hidden sm:inline">ทั้งหมด</span>
                    {userStats && <span className="ml-1 opacity-60 font-medium text-[9px]">{userStats.total}</span>}
                  </button>
                  <button
                    onClick={() => setCertFilter('NO_CERT')}
                    className={`min-h-11 flex-1 md:flex-none flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-2xl font-black text-[10px] uppercase tracking-wide border transition-all active:scale-95 ${certFilter === 'NO_CERT' ? 'bg-rose-500 text-white border-rose-500 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
                  >
                    <ShieldAlert size={13}/><span className="hidden sm:inline">ไม่มี/หมดอายุ</span>
                    {userStats && <span className="ml-1 opacity-60 font-medium text-[9px]">{userStats.noCert + userStats.expired}</span>}
                  </button>
                  <button
                    onClick={() => setCertFilter('EXPIRING')}
                    className={`min-h-11 flex-1 md:flex-none flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-2xl font-black text-[10px] uppercase tracking-wide border transition-all active:scale-95 ${certFilter === 'EXPIRING' ? 'bg-amber-500 text-white border-amber-500 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
                  >
                    <Clock size={13}/><span className="hidden sm:inline">ใกล้หมด</span>
                    {userStats && <span className="ml-1 opacity-60 font-medium text-[9px]">{userStats.expiring}</span>}
                  </button>
                  <button
                    onClick={() => setCertFilter('HAS_CERT')}
                    className={`min-h-11 flex-1 md:flex-none flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-2xl font-black text-[10px] uppercase tracking-wide border transition-all active:scale-95 ${certFilter === 'HAS_CERT' ? 'bg-emerald-500 text-white border-emerald-500 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
                  >
                    <ShieldCheck size={13}/><span className="hidden sm:inline">มีใบเซอร์</span>
                    {userStats && <span className="ml-1 opacity-60 font-medium text-[9px]">{userStats.valid}</span>}
                  </button>
                </div>
              )}
            </div>
          ) : <div className="w-full px-2 text-[10px] font-black text-slate-500 flex items-center gap-2"><ShieldCheck size={14} /> ประวัติการจัดการระบบ</div>}
          
          <div className="flex flex-wrap gap-2 w-full md:w-auto md:ml-auto">
            {activeTab !== 'LOGS' && (
              <>
                <input type="file" ref={activeTab === 'USERS' ? userFileInputRef : vendorFileInputRef} className="hidden" accept=".xlsx" onChange={activeTab === 'USERS' ? handleUserImport : handleVendorImport} />
                
                <button 
                  onClick={() => (activeTab === 'USERS' ? userFileInputRef : vendorFileInputRef).current?.click()} 
                  disabled={activeTab === 'USERS' ? importingUsers : importingVendors}
                  className="min-h-11 flex-1 md:flex-none bg-emerald-50 text-emerald-800 border border-emerald-100 px-4 py-3 rounded-xl font-black text-[10px] uppercase hover:bg-emerald-100 transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {(activeTab === 'USERS' ? importingUsers : importingVendors) ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14}/>} 
                  {(activeTab === 'USERS' ? importingUsers : importingVendors) ? 'นำเข้า...' : 'Import'}
                </button>
                
                <button onClick={handleExport} className="min-h-11 flex-1 md:flex-none bg-white text-slate-600 border border-slate-200 px-4 py-3 rounded-xl font-black text-[10px] uppercase hover:bg-slate-50 transition-all flex items-center justify-center gap-2 shadow-sm"><Download size={14}/> Export</button>
                <button onClick={() => loadData()} className="flex-none min-h-11 min-w-11 p-3 bg-slate-50 text-slate-400 rounded-xl hover:text-blue-600 transition-all active:scale-95 shadow-sm" aria-label="รีเฟรชข้อมูล"><RotateCcw size={18}/></button>
                <button onClick={activeTab === 'USERS' ? handleAddUser : handleAddVendor} className="min-h-11 w-full sm:w-auto bg-blue-600 text-white px-6 py-3 rounded-xl font-black text-[10px] uppercase hover:bg-slate-900 transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2"><Plus size={14}/> New Entry</button>
              </>
            )}
          </div>
        </div>

        {activeTab !== 'LOGS' && (
          <div className="flex flex-col gap-3 border-b border-slate-100 bg-white px-4 py-3 md:flex-row md:items-center md:justify-between md:px-6" aria-live="polite">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-[10px] font-black text-slate-700">พบ {totalItems.toLocaleString('th-TH')} รายการ</span>
              {directoryFilterChips.map((chip) => (
                <span key={chip.kind} className="max-w-full truncate rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-[9px] font-bold text-blue-800" title={chip.label}>
                  {chip.label}
                </span>
              ))}
            </div>
            {directoryFilterChips.length > 0 && (
              <button type="button" onClick={clearDirectoryFilters} className="flex min-h-10 items-center justify-center gap-1.5 self-start rounded-xl border border-slate-200 bg-white px-3 text-[9px] font-black text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-800 md:self-auto">
                <X size={13} aria-hidden="true" /> ล้างตัวกรองทั้งหมด
              </button>
            )}
          </div>
        )}

        {activeTab === 'VENDORS' && vendorDuplicateGroups.length > 0 && (
          <div role="status" className="mx-4 mt-3 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 md:mx-6">
            <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
            <div>
              <p className="text-[10px] font-black text-amber-800">พบข้อมูลชื่อบริษัทซ้ำเดิม {vendorDuplicateGroups.length} กลุ่ม</p>
              <p className="mt-1 text-[9px] font-bold leading-relaxed text-amber-700">ระบบป้องกันการเพิ่มชื่อซ้ำรายการใหม่แล้ว และยังไม่ได้รวม ลบ หรือแก้ข้อมูลเดิมโดยอัตโนมัติ</p>
            </div>
          </div>
        )}

        {activeTab === 'VENDORS' && vendorImportReview.length > 0 && (
          <div role="status" className="mx-4 mt-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 md:mx-6">
            <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-start">
              <div>
                <p className="text-[10px] font-black text-blue-800">รายการจากไฟล์ Import ที่ไม่ได้เพิ่ม {vendorImportReview.length} รายการ</p>
                <p className="mt-1 text-[9px] font-bold text-blue-700">รายการซ้ำถูกข้ามแล้ว · เปิดดูทั้งหมดเพื่อตัดสินใจรายการชื่อใกล้เคียง</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" onClick={() => setVendorImportReviewOpen(true)} className="min-h-11 rounded-xl bg-blue-600 px-4 text-[9px] font-black text-white">ดูทั้งหมดและตัดสินใจ</button>
                <button type="button" onClick={() => { setVendorImportReview([]); setVendorImportReviewOpen(false); }} aria-label="ปิดผลตรวจ Import" className="min-h-11 min-w-11 rounded-xl bg-white p-3 text-blue-700"><X size={15} /></button>
              </div>
            </div>
            <ul className="mt-3 space-y-2">
              {vendorImportReview.slice(0, 5).map((item, index) => (
                <li key={`${item.inputName}-${index}`} className="rounded-xl bg-white/90 px-3 py-2 text-[9px] font-bold text-slate-700">
                  <span className="font-black">{item.inputName}</span>
                  <span className="mx-2 text-blue-400">→</span>
                  {item.reason === 'EXACT' ? 'ซ้ำกับ' : 'ใกล้เคียง'} {item.matches.map((match) => match.name).join(', ') || 'รายการในระบบ'}
                </li>
              ))}
            </ul>
            {vendorImportReview.length > 5 && <p className="mt-2 text-[9px] font-bold text-blue-700">และอีก {vendorImportReview.length - 5} รายการ</p>}
          </div>
        )}

        {/* Bulk Actions Bar */}
        {activeTab === 'USERS' && selectedIds.size > 0 && (
          <div className="mx-4 mt-3 bg-slate-900 text-white px-4 py-3 rounded-2xl flex flex-col items-stretch justify-between gap-3 shadow-lg animate-in fade-in duration-200 sm:flex-row sm:items-center">
            <span className="text-xs font-black">{selectedIds.size} รายการที่เลือก</span>
            <div className="grid grid-cols-[1fr_1fr_44px] gap-2">
              <button onClick={handleBulkExport} disabled={bulkLoading} className="flex min-h-11 items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all active:scale-95">
                <Download size={12}/> Export ที่เลือก
              </button>
              <button onClick={handleBulkReset} disabled={bulkLoading} className="flex min-h-11 items-center gap-1.5 bg-amber-500/80 hover:bg-amber-500 text-white px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all active:scale-95">
                {bulkLoading ? <Loader2 size={12} className="animate-spin"/> : <RotateCcw size={12}/>} Reset Training
              </button>
              <button onClick={() => setSelectedIds(new Set())} aria-label="ล้างรายการที่เลือก" className="min-h-11 min-w-11 p-1.5 rounded-xl bg-white/10 hover:bg-white/20 transition-all active:scale-95">
                <X size={14}/>
              </button>
            </div>
          </div>
        )}

        {/* 🟢 Data Presentation Area */}
        <div className="flex-1 p-2 md:p-0 bg-slate-50 md:bg-white flex flex-col">
          {loading ? (
            <AsyncState variant="loading" title="กำลังโหลดข้อมูลผู้ใช้และบริษัท" className="flex-1" />
          ) : loadError ? (
            <AsyncState variant="error" title="โหลดข้อมูลไม่สำเร็จ" description={loadError} onRetry={() => loadData()} className="flex-1" />
          ) : paginatedData.length === 0 ? (
             <AsyncState variant="empty" title="ไม่พบข้อมูล" description={searchQuery || selectedVendorFilter || certFilter ? 'ลองล้างคำค้นหาหรือตัวกรองแล้วค้นหาอีกครั้ง' : 'เมื่อมีข้อมูลใหม่ รายการจะแสดงในส่วนนี้'} className="flex-1" />
          ) : (
            <div className="flex-1 flex flex-col">
              
              {/* ✅ แถบ Pagination ด้านบน */}
              {renderPagination('top')}

              {/* 🖥️ DESKTOP VIEW (TABLE) */}
              <div className="hidden xl:block overflow-x-auto w-full flex-1">
                <table className="w-full text-left min-w-[900px]">
                  <thead className="bg-slate-50/50 text-[9px] font-black text-slate-600 uppercase tracking-[0.2em] border-b border-slate-100 sticky top-0 z-10">
                    <tr>
                      {activeTab === 'USERS' && (
                        <th className="pl-6 pr-2 py-5 w-10">
                          <input
                            type="checkbox"
                            aria-label="เลือกผู้ใช้ทั้งหมดในหน้านี้"
                            className="w-4 h-4 rounded border-slate-300 cursor-pointer accent-blue-600"
                            checked={paginatedData.length > 0 && paginatedData.every((i: any) => selectedIds.has(i.id))}
                            onChange={() => setSelectedIds(prev =>
                              prev.size === paginatedData.length ? new Set() : new Set(paginatedData.map((i: any) => i.id))
                            )}
                          />
                        </th>
                      )}
                      {activeTab === 'LOGS' ? (
                        <>
                          <th className="px-8 py-5 text-left whitespace-nowrap">วันและเวลา</th>
                          <th className="px-8 py-5 text-left whitespace-nowrap">ผู้ดำเนินการ</th>
                          <th className="px-8 py-5 text-left whitespace-nowrap">กิจกรรม</th>
                          <th className="px-8 py-5 text-left whitespace-nowrap">รายการที่เกี่ยวข้อง</th>
                        </>
                      ) : (
                        <>
                          <th className="px-8 py-5 text-left whitespace-nowrap">Profile / Identity</th>
                          <th className="px-8 py-5 text-left whitespace-nowrap">Compliance / Status</th>
                          <th className="px-8 py-5 text-center whitespace-nowrap">Protocol Actions</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 bg-white">
                    {activeTab === 'LOGS' ? (
                      paginatedData.map((log: AuditLog) => {
                        const audit = presentAuditLog(log);
                        return (
                          <tr key={log.id} className="align-top transition-colors hover:bg-slate-50/50">
                            <td className="px-8 py-5 text-[11px] font-bold text-slate-500 whitespace-nowrap">{new Date(log.created_at).toLocaleString('th-TH')}</td>
                            <td className="px-8 py-5 text-xs font-bold text-slate-700 break-all">{audit.actorLabel}</td>
                            <td className="px-8 py-5">
                              <span className={`inline-flex rounded-full border px-2.5 py-1 text-[9px] font-black ${auditToneClasses[audit.tone]}`}>{audit.actionLabel}</span>
                              <p className="mt-2 max-w-sm text-[10px] font-bold leading-relaxed text-slate-600">{audit.summary}</p>
                            </td>
                            <td className="px-8 py-5">
                              <p className="text-xs font-black text-slate-700">{audit.targetLabel}</p>
                              <details className="mt-2 text-[9px] font-bold text-slate-400">
                                <summary className="cursor-pointer select-none hover:text-blue-600">รายละเอียดทางเทคนิค</summary>
                                <p className="mt-1 max-w-xs break-all font-mono font-medium">{audit.technicalReference}</p>
                              </details>
                            </td>
                          </tr>
                        );
                      })
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
                                aria-label={`เลือก ${item.name}`}
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
                                    {activeTab === 'USERS' && item.role === 'ADMIN' && <span className="bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded text-[8px] tracking-widest shrink-0">ADMIN</span>}
                                 </div>
                                 {activeTab === 'USERS' && (
                                    <div className="flex items-center gap-2">
                                        <p className="text-[10px] text-slate-600 font-mono tracking-tighter">ID: {maskNationalID(item.national_id)}</p>
                                        {item.last_login ? (
                                            <span className="text-[8px] font-bold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded flex items-center gap-1 border border-emerald-100">
                                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> Active
                                            </span>
                                        ) : (
                                            <span className="text-[8px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1 border border-slate-200">
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
                              <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[9px] font-black border uppercase shadow-sm whitespace-nowrap ${item.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-800 border-emerald-100' : item.status === 'REJECTED' ? 'bg-red-50 text-red-700 border-red-100' : 'bg-amber-50 text-amber-800 border-amber-100'}`}>
                                {item.status || 'PENDING'}
                              </div>
                            ) : (
                              <div className="flex flex-col gap-1 text-left">
                                <span className="text-slate-500 font-black text-[10px] uppercase bg-slate-50 px-3 py-1 rounded-xl border w-fit shadow-sm truncate max-w-[180px]">{item.vendors?.name || 'EXTERNAL'}</span>
                                {item.is_active === false ? (
                                    <span className="text-[9px] font-black text-red-500 flex items-center gap-1 ml-1 whitespace-nowrap"><Ban size={10}/> Account Suspended</span>
                                ) : itemCs === 'valid' ? (
                                    <span title={getCertDaysLabel(item)} className="text-[9px] font-black text-emerald-700 flex items-center gap-1 ml-1 whitespace-nowrap cursor-help">
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
                                <button onClick={() => handleUpdateVendorStatus(item.id, item.name, 'APPROVED')} aria-label={`อนุมัติบริษัท ${item.name}`} className="p-2.5 rounded-xl bg-emerald-700 text-white hover:bg-emerald-800 shadow-lg active:scale-90 transition-all"><CheckCircle size={16} /></button>
                              )}
                              {activeTab === 'VENDORS' && item.status === 'PENDING' && (
                                <button onClick={() => handleUpdateVendorStatus(item.id, item.name, 'REJECTED')} title="Reject" className="p-2.5 rounded-xl border text-red-500 hover:bg-red-50 active:scale-90 transition-all"><Ban size={16} /></button>
                              )}
                              <button onClick={() => activeTab === 'VENDORS' ? handleEditVendor(item as Vendor) : handleEditUser(item)} aria-label={`แก้ไข ${item.name}`} className="p-2.5 rounded-xl border border-slate-100 text-slate-600 hover:text-blue-700 hover:bg-blue-50 active:scale-90 transition-all shadow-sm"><Edit3 size={16} /></button>
                              {activeTab === 'USERS' && (
                                <>
                                  <button
                                    onClick={() => setRoleDialogUser(item)}
                                    aria-label={`กำหนดสิทธิ์ของ ${item.name}`}
                                    title="กำหนดสิทธิ์ Admin / User"
                                    className="p-2.5 rounded-xl border border-violet-100 text-violet-600 hover:bg-violet-50 transition-all active:scale-90 shadow-sm"
                                  >
                                    <ShieldCheck size={16} />
                                  </button>
                                  {item.role === 'USER' && item.is_active !== false && (
                                    <button
                                      onClick={() => handleResetUserPin(item.id, item.name)}
                                      disabled={resettingPinUserId === item.id}
                                      aria-label={`รีเซ็ต PIN ของ ${item.name}`}
                                      title="Reset PIN"
                                      className="p-2.5 rounded-xl border border-violet-100 text-violet-600 hover:bg-violet-50 transition-all active:scale-90 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      {resettingPinUserId === item.id ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
                                    </button>
                                  )}
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
                              <button onClick={() => activeTab === 'VENDORS' ? handleDeleteVendor(item.id, item.name) : handleDeleteUser(item.id, item.name)} aria-label={`${activeTab === 'VENDORS' ? 'เก็บบริษัท' : 'เก็บผู้ใช้'} ${item.name}`} className="p-2.5 rounded-xl border border-slate-100 text-slate-600 hover:text-red-700 hover:bg-red-50 active:scale-90 transition-all shadow-sm"><Trash2 size={16} /></button>
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 xl:hidden flex-1 pb-4 pt-3">
                 {activeTab === 'LOGS' ? (
                    paginatedData.map((log: AuditLog) => {
                      const audit = presentAuditLog(log);
                      return (
                        <div key={log.id} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                            <span className="text-[10px] font-bold text-slate-400">{new Date(log.created_at).toLocaleString('th-TH')}</span>
                            <span className={`rounded-full border px-2.5 py-1 text-[9px] font-black ${auditToneClasses[audit.tone]}`}>{audit.actionLabel}</span>
                          </div>
                          <div><p className="text-[9px] font-black text-slate-400">ผู้ดำเนินการ</p><p className="mt-1 break-all text-xs font-bold text-slate-700">{audit.actorLabel}</p></div>
                          <div><p className="text-[9px] font-black text-slate-400">รายการที่เกี่ยวข้อง</p><p className="mt-1 text-xs font-black text-slate-700">{audit.targetLabel}</p><p className="mt-1 text-[10px] font-bold leading-relaxed text-slate-500">{audit.summary}</p></div>
                          <details className="rounded-xl bg-slate-50 p-3 text-[9px] font-bold text-slate-400"><summary className="cursor-pointer select-none">รายละเอียดทางเทคนิค</summary><p className="mt-2 break-all font-mono font-medium">{audit.technicalReference}</p></details>
                        </div>
                      );
                    })
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
                                 {activeTab === 'USERS' && item.role === 'ADMIN' && <span className="bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded text-[8px] tracking-widest shrink-0">ADMIN</span>}
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
                               {activeTab === 'VENDORS' && <p className="text-[10px] text-slate-600 font-mono mt-0.5 truncate">Reg: {new Date(item.created_at).toLocaleDateString()}</p>}
                            </div>
                            {activeTab === 'USERS' && (
                              <input
                                type="checkbox"
                                aria-label={`เลือก ${item.name}`}
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
                                 <span className="text-[9px] font-black text-slate-600 uppercase">Vendor</span>
                                 <span className="text-[10px] font-black text-slate-700 truncate max-w-[60%] text-right">{item.vendors?.name || 'EXTERNAL'}</span>
                               </div>
                               <div className="flex justify-between items-center">
                                 <span className="text-[9px] font-black text-slate-600 uppercase">Cert</span>
                                 {item.is_active === false ? (
                                    <span className="text-[9px] font-black text-red-500 flex items-center gap-1"><Ban size={10}/> Suspended</span>
                                 ) : cardCs === 'valid' ? (
                                    <span title={getCertDaysLabel(item)} className="text-[9px] font-black text-emerald-700 flex items-center gap-1 cursor-help"><ShieldCheck size={10}/> Certified</span>
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
                               <span className="text-[9px] font-black text-slate-600 uppercase">Status</span>
                               <div className={`px-2 py-1 rounded-md text-[9px] font-black border uppercase ${item.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-800 border-emerald-100' : item.status === 'REJECTED' ? 'bg-red-50 text-red-700 border-red-100' : 'bg-amber-50 text-amber-800 border-amber-100'}`}>
                                  {item.status || 'PENDING'}
                               </div>
                             </div>
                           )}
                         </div>

                         {/* Card Actions */}
                         <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                            {activeTab === 'VENDORS' && item.status !== 'APPROVED' && (
                              <button onClick={() => handleUpdateVendorStatus(item.id, item.name, 'APPROVED')} aria-label={`อนุมัติบริษัท ${item.name}`} className="min-h-11 min-w-11 p-2.5 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 active:scale-90 transition-all"><CheckCircle size={14} /></button>
                            )}
                            {activeTab === 'VENDORS' && item.status === 'PENDING' && (
                              <button onClick={() => handleUpdateVendorStatus(item.id, item.name, 'REJECTED')} aria-label={`ไม่อนุมัติบริษัท ${item.name}`} className="min-h-11 min-w-11 p-2.5 rounded-xl border border-red-200 text-red-500 bg-red-50 active:scale-90 transition-all"><Ban size={14} /></button>
                            )}
                            <button onClick={() => activeTab === 'VENDORS' ? handleEditVendor(item as Vendor) : handleEditUser(item)} aria-label={`แก้ไข ${item.name}`} className="min-h-11 min-w-11 p-2.5 rounded-xl border border-slate-200 text-slate-500 bg-white active:scale-90 transition-all"><Edit3 size={14} /></button>
                            {activeTab === 'USERS' && (
                              <>
                                <button onClick={() => setRoleDialogUser(item)} aria-label={`กำหนดสิทธิ์ของ ${item.name}`} className="min-h-11 min-w-11 p-2.5 rounded-xl border border-violet-200 text-violet-600 bg-violet-50 active:scale-90 transition-all"><ShieldCheck size={14} /></button>
                                {item.role === 'USER' && item.is_active !== false && (
                                  <button
                                    onClick={() => handleResetUserPin(item.id, item.name)}
                                    disabled={resettingPinUserId === item.id}
                                    aria-label={`รีเซ็ต PIN ของ ${item.name}`}
                                    className="min-h-11 min-w-11 p-2.5 rounded-xl border border-violet-200 text-violet-600 bg-violet-50 active:scale-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {resettingPinUserId === item.id ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                                  </button>
                                )}
                                <button onClick={() => handleResetTraining(item.id, item.name)} aria-label={`รีเซ็ตการอบรมของ ${item.name}`} className="min-h-11 min-w-11 p-2.5 rounded-xl border border-amber-200 text-amber-500 bg-amber-50 active:scale-90 transition-all"><RotateCcw size={14} /></button>
                                <button
                                    onClick={() => handleToggleUserBan(item.id, item.name, item.is_active !== false)}
                                    aria-label={`${item.is_active !== false ? 'ระงับ' : 'เปิด'}ผู้ใช้ ${item.name}`}
                                    className={`min-h-11 min-w-11 p-2.5 rounded-xl border transition-all active:scale-90 ${item.is_active !== false ? 'border-red-200 text-red-500 bg-red-50' : 'bg-red-500 text-white'}`}
                                >
                                    {item.is_active !== false ? <ShieldAlert size={14} /> : <CheckCircle2 size={14} />}
                                </button>
                              </>
                            )}
                            <button onClick={() => activeTab === 'VENDORS' ? handleDeleteVendor(item.id, item.name) : handleDeleteUser(item.id, item.name)} aria-label={`${activeTab === 'VENDORS' ? 'เก็บบริษัท' : 'เก็บผู้ใช้'} ${item.name}`} className="min-h-11 min-w-11 p-2.5 rounded-xl border border-slate-200 text-slate-400 bg-slate-50 active:scale-90 transition-all"><Trash2 size={14} /></button>
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

      {vendorDialogOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-3 sm:p-5">
          <button type="button" aria-label="ปิดหน้าต่างจัดการบริษัท" className="absolute inset-0 h-full w-full bg-slate-950/65 backdrop-blur-sm" onClick={() => closeVendorDialog()} />
          <div ref={vendorDialogRef} role="dialog" aria-modal="true" aria-labelledby="vendor-dialog-title" tabIndex={-1} className="relative z-10 flex max-h-[calc(100dvh-1.5rem)] w-full max-w-xl flex-col overflow-hidden rounded-[1.75rem] border border-white/50 bg-white shadow-2xl focus:outline-none sm:max-h-[calc(100dvh-2.5rem)] sm:rounded-[2rem]">
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-100 bg-white px-5 py-4 sm:px-7 sm:py-5">
              <div>
                <h3 id="vendor-dialog-title" className="text-lg font-black text-slate-900">{editingVendor ? 'แก้ไขบริษัท' : 'เพิ่มบริษัทใหม่'}</h3>
                <p className="mt-1 text-[9px] font-bold text-slate-500">ระบบจะตรวจชื่อซ้ำและชื่อใกล้เคียงก่อนบันทึก</p>
              </div>
              <button type="button" onClick={() => closeVendorDialog()} disabled={savingVendor} aria-label="ปิด" className="min-h-11 min-w-11 rounded-full bg-slate-100 p-3 text-slate-600 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"><X size={18} /></button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-7">
              <label className="block space-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">ชื่อบริษัท</span>
                <div className="relative">
                  <Building2 size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <input
                    value={vendorFormName}
                    onChange={(event) => {
                      setVendorFormName(event.target.value);
                      setAllowSimilarVendor(false);
                    }}
                    autoComplete="organization"
                    aria-describedby="admin-vendor-match-status"
                    placeholder="พิมพ์ชื่อบริษัท"
                    className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-base font-bold outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                  />
                </div>
              </label>

              <label className="block space-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">สถานะ</span>
                <select value={vendorFormStatus} onChange={(event) => setVendorFormStatus(event.target.value as VendorStatus)} className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base font-bold outline-none focus:border-blue-500 focus:bg-white">
                  <option value={VendorStatus.PENDING}>รออนุมัติ</option>
                  <option value={VendorStatus.APPROVED}>อนุมัติแล้ว</option>
                  <option value={VendorStatus.REJECTED}>ปฏิเสธ</option>
                </select>
              </label>

              <div id="admin-vendor-match-status" className="space-y-3" aria-live="polite">
                {vendorMatchLoading && <p className="flex items-center gap-2 text-[10px] font-bold text-slate-500"><Loader2 size={14} className="animate-spin" /> กำลังตรวจสอบชื่อบริษัท...</p>}
                {vendorMatchError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-[10px] font-bold text-red-700">{vendorMatchError}</p>}

                {exactVendorDialogMatch && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                    <p className="text-[10px] font-black text-red-700">ไม่สามารถบันทึกชื่อซ้ำได้</p>
                    <p className="mt-1 text-sm font-bold text-slate-800">{exactVendorDialogMatch.name}</p>
                    <p className="mt-1 text-[9px] font-bold text-slate-600">สถานะ: {exactVendorDialogMatch.status}</p>
                    <button type="button" onClick={() => handleUseExistingVendor(exactVendorDialogMatch)} className="mt-3 min-h-11 rounded-xl bg-slate-900 px-4 text-[9px] font-black text-white">ไปที่บริษัทนี้</button>
                  </div>
                )}

                {!exactVendorDialogMatch && similarVendorDialogMatches.length > 0 && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <p className="text-[10px] font-black text-amber-800">พบชื่อใกล้เคียง กรุณาตรวจสอบ</p>
                    <div className="mt-3 space-y-2">
                      {similarVendorDialogMatches.map((match) => (
                        <div key={match.id} className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-[10px] font-bold text-slate-800">{match.name}</p>
                            <p className="text-[8px] font-bold text-slate-500">{match.status} · ใกล้เคียง {Math.round(Number(match.match_score) * 100)}%</p>
                          </div>
                          <button type="button" onClick={() => handleUseExistingVendor(match)} className="min-h-11 shrink-0 rounded-lg border border-slate-200 px-3 text-[8px] font-black text-slate-700">ใช้บริษัทนี้ (ไม่สร้างใหม่)</button>
                        </div>
                      ))}
                    </div>
                    <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-white p-3">
                      <input type="checkbox" checked={allowSimilarVendor} onChange={(event) => setAllowSimilarVendor(event.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-600" />
                      <span className="text-[9px] font-bold leading-relaxed text-amber-800">ตรวจสอบแล้ว ยืนยันว่าเป็นคนละบริษัทกับรายการข้างต้น</span>
                    </label>
                  </div>
                )}

                {!vendorMatchLoading && !vendorMatchError && vendorFormName.trim().length >= 2 && vendorMatches.length === 0 && (
                  <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[10px] font-bold text-emerald-700"><CheckCircle size={14} /> ไม่พบชื่อซ้ำหรือชื่อใกล้เคียง</p>
                )}
              </div>
            </div>

            <div className="grid shrink-0 grid-cols-1 gap-2 border-t border-slate-100 bg-white p-4 sm:grid-cols-2 sm:px-7">
              <button type="button" onClick={() => closeVendorDialog()} disabled={savingVendor} className="min-h-12 rounded-2xl border border-slate-200 bg-slate-50 text-[10px] font-black text-slate-600 disabled:opacity-50">ยกเลิก</button>
              <button type="button" onClick={handleSaveVendor} disabled={vendorSaveDisabled} aria-describedby={vendorSaveDisabled ? 'vendor-save-disabled-reason' : undefined} className="min-h-12 rounded-2xl bg-blue-600 text-[10px] font-black text-white shadow-lg shadow-blue-100 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none">
                {savingVendor ? <Loader2 size={16} className="mx-auto animate-spin" /> : editingVendor ? 'บันทึกการแก้ไข' : 'เพิ่มบริษัท'}
              </button>
              {vendorSaveDisabled && !savingVendor && (
                <p id="vendor-save-disabled-reason" className="text-center text-[9px] font-bold text-amber-700 sm:col-span-2">
                  {exactVendorDialogMatch ? 'มีชื่อบริษัทนี้อยู่แล้ว กรุณาใช้รายการเดิม' : similarVendorDialogMatches.length > 0 && !allowSimilarVendor ? 'กรุณายืนยันว่าเป็นคนละบริษัทก่อนบันทึก' : vendorMatchLoading ? 'กรุณารอระบบตรวจสอบชื่อบริษัท' : 'กรุณาระบุชื่อบริษัท'}
                </p>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {pendingImport && pendingImportSummary && pendingImportDisplayRows && createPortal(
        <ImportPreviewDialog
          fileName={pendingImport.fileName}
          kindLabel={pendingImport.kind === 'USERS' ? 'Personnel' : 'Vendors'}
          rows={pendingImportDisplayRows}
          summary={pendingImportSummary}
          busy={pendingImport.kind === 'USERS' ? importingUsers : importingVendors}
          onCancel={() => setPendingImport(null)}
          onConfirm={confirmPendingImport}
        />,
        document.body,
      )}

      {vendorImportReviewOpen && vendorImportReview.length > 0 && typeof document !== 'undefined' && createPortal(
        <VendorImportReviewDialog
          items={vendorImportReview}
          resolvingId={resolvingVendorImportId}
          onClose={() => { if (!resolvingVendorImportId) setVendorImportReviewOpen(false); }}
          onUseExisting={handleUseExistingImportedVendor}
          onCreateNew={handleCreateImportedVendor}
        />,
        document.body,
      )}

      {roleDialogUser && typeof document !== 'undefined' && createPortal(
        <UserRoleDialog
          user={roleDialogUser}
          isCurrentAdmin={roleDialogUser.id === currentAdminId}
          busy={savingUserRole}
          onClose={() => { if (!savingUserRole) setRoleDialogUser(null); }}
          onConfirm={handleConfirmUserRole}
        />,
        document.body,
      )}

      {/* 📝 EDIT USER MODAL */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div aria-hidden="true" className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => setIsEditModalOpen(false)} />
          <div ref={editDialogRef} role="dialog" aria-modal="true" aria-labelledby="edit-profile-dialog-title" tabIndex={-1} className="bg-white w-full max-w-lg rounded-[2rem] md:rounded-[2.5rem] shadow-2xl border relative z-10 p-6 md:p-8 text-left animate-in zoom-in-95 duration-300 max-h-[95vh] overflow-y-auto mx-4 md:mx-0 focus:outline-none">
              <div className="flex justify-between items-center mb-6 border-b pb-4 sticky top-0 bg-white z-20">
                  <div>
                    <h3 id="edit-profile-dialog-title" className="text-lg md:text-xl font-black text-slate-900 uppercase">Edit Profile</h3>
                    <p className="text-[10px] text-blue-500 font-bold uppercase tracking-widest mt-1">ID: {maskNationalID(editingUser?.national_id)}</p>
                  </div>
                  <button onClick={() => setIsEditModalOpen(false)} aria-label="ปิดหน้าต่างแก้ไขผู้ใช้" className="min-h-11 min-w-11 text-slate-600 hover:text-red-600 transition-colors bg-slate-50 p-3 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500"><X size={20}/></button>
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
  <button onClick={onClick} aria-current={active ? 'page' : undefined} className={`min-h-11 shrink-0 px-4 md:px-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all whitespace-nowrap active:scale-95 focus:outline-none focus:ring-2 focus:ring-blue-500 ${active ? 'bg-white text-blue-600 shadow-md border-b-2 border-blue-500' : 'text-slate-600 hover:text-slate-800 hover:bg-white/50'}`}>{icon} {label}</button>
);

export default VendorManager;
