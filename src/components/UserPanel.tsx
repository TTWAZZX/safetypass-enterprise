import React, { useState, useEffect, useRef } from 'react';
import {
  User, WorkPermitSession, ExamType, SupplierOutsourceStatus,
  SupplierOutsourceType, SupplierOutsourceWorkType,
} from '../types';
import { api as mockApi } from '../services/supabaseApi';
import { supabase } from '../services/supabaseClient'; 
import { addOneYearIsoDate, getTodayIsoDate } from '../utils/accessDates';
import { getLiffProfileSyncRedirectUri, LIFF_ID } from '../utils/liffProfileSync';
import { useTranslation } from '../context/LanguageContext';
import ExamSystem from './ExamSystem';
import DigitalCard from './DigitalCard'; 
import ExamHistory from './ExamHistory'; 
import {
  BookOpen,
  Lock,
  ChevronRight,
  Ticket,
  QrCode,
  X,
  FileText,
  Download,
  ShieldCheck,
  Edit3,
  Save,
  RotateCcw,
  RefreshCw,
  Clock,
  Loader2, 
  Calendar, 
  Globe2,
  CheckCircle2,
  AlertTriangle,
  ArrowRightCircle,
  Maximize2,
  Ban, // ✅ เพิ่มไอคอน Ban
  Building2 // ✅ เพิ่มไอคอนตึก
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useToastContext } from './ToastProvider';
import liff from '@line/liff'; // ✅ นำเข้า LINE LIFF
import { useDialogFocus } from '../hooks/useDialogFocus';
import UserReadinessSummary from './UserReadinessSummary';
import { getUserReadiness } from '../services/userReadiness';
import { getExpiryLabel, getExpiryStatus } from '../services/expiryStatus';

const maskNationalID = (id: string) => {
  if (!id || id.length < 13) return id;
  return `${id.substring(0, 1)}-${id.substring(1, 5)}-XXXXX-${id.substring(10, 12)}-${id.substring(12)}`;
};

// ✅ เพิ่มฟังก์ชันคำนวณอายุจากวันเกิด
const calculateAge = (dobString: string | null | undefined) => {
  if (!dobString) return '-';
  const birthday = new Date(dobString);
  if (isNaN(birthday.getTime())) return '-';
  const today = new Date();
  let age = today.getFullYear() - birthday.getFullYear();
  const m = today.getMonth() - birthday.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthday.getDate())) {
    age--;
  }
  return age;
};

interface UserPanelProps {
  user: User;
  onUserUpdate: (user: User) => void;
}

const UserPanel: React.FC<UserPanelProps> = ({ user, onUserUpdate }) => {
  const { t, language } = useTranslation();
  const { showToast } = useToastContext();

  const [activeStage, setActiveStage] = useState<'IDLE' | 'INDUCTION' | 'WORK_PERMIT' | 'SUPPLIER_OUTSOURCE'>('IDLE');
  const [activePermit, setActivePermit] = useState<WorkPermitSession | null>(null);
  const [showQRFullScreen, setShowQRFullScreen] = useState(false);
  const [viewingManual, setViewingManual] = useState<ExamType | null>(null);
  const [showCard, setShowCard] = useState(false);
  const [cardType, setCardType] = useState<'INDUCTION' | 'WORK_PERMIT' | 'SUPPLIER_OUTSOURCE'>('INDUCTION');
  const [showHistory, setShowHistory] = useState(false);
  const [supplierOutsourceEnabled, setSupplierOutsourceEnabled] = useState(false);
  const [supplierStatus, setSupplierStatus] = useState<SupplierOutsourceStatus | null>(null);
  const [showSupplierEnrollment, setShowSupplierEnrollment] = useState(false);
  const [supplierParticipantType, setSupplierParticipantType] = useState<SupplierOutsourceType>('supplier');
  const [supplierWorkType, setSupplierWorkType] = useState<SupplierOutsourceWorkType>('Driver');
  const [supplierStartDate, setSupplierStartDate] = useState('');
  const [supplierEndDate, setSupplierEndDate] = useState('');
  const [supplierSaving, setSupplierSaving] = useState(false);

  // Profile Edit States
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(user.name);
  const [editAge, setEditAge] = useState(user.age || ''); // เก็บอายุไว้เหมือนเดิม
  const [editDob, setEditDob] = useState((user as any).date_of_birth || ''); // ✅ เพิ่ม State วันเกิด
  const [editNationality, setEditNationality] = useState(user.nationality || 'ไทย (Thai)');
  const [isOtherNationality, setIsOtherNationality] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // ✅ State สำหรับ Gatekeeper Modal (บังคับกรอกวันเกิด)
  const [showDobModal, setShowDobModal] = useState(!(user as any).date_of_birth);
  const [dobInput, setDobInput] = useState((user as any).date_of_birth || '');
  const [isSavingDob, setIsSavingDob] = useState(false);
  const supplierDialogRef = useRef<HTMLDivElement>(null);
  const manualDialogRef = useRef<HTMLDivElement>(null);
  const qrDialogRef = useRef<HTMLDivElement>(null);
  const dobDialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(showSupplierEnrollment, supplierDialogRef, () => setShowSupplierEnrollment(false));
  useDialogFocus(Boolean(viewingManual), manualDialogRef, () => setViewingManual(null));
  useDialogFocus(showQRFullScreen, qrDialogRef, () => setShowQRFullScreen(false));
  useDialogFocus(showDobModal, dobDialogRef, () => undefined);
  
  // ✅ State สำหรับจัดการข้อมูล Vendor ในหน้า Edit Profile
  const [vendorsList, setVendorsList] = useState<{id: string, name: string}[]>([]);
  const [editVendorId, setEditVendorId] = useState(user.vendor_id || '');
  
  // ✅ 1. State สำหรับสถานะปุ่มโหลด LINE
  const [isSyncingLine, setIsSyncingLine] = useState(false);
  const liffInitPromiseRef = useRef<Promise<void> | null>(null);

  // ดึงรูปจาก LINE และบันทึกลง Database เมื่อผู้ใช้เลือกทำเองเท่านั้น
  const handleSyncLineProfile = async () => {
    if (isBanned || isSyncingLine) return;

    const redirectUri = getLiffProfileSyncRedirectUri(window.location);
    if (!redirectUri) {
      showToast('การ Sync รูป LINE ใช้ได้บนเว็บไซต์หลักเท่านั้น', 'info');
      return;
    }

    setIsSyncingLine(true);
    try {
      // LIFF is optional: initialise it only after the user explicitly asks
      // to sync a LINE profile picture, never while the dashboard loads.
      if (!liffInitPromiseRef.current) {
        liffInitPromiseRef.current = liff.init({ liffId: LIFF_ID }).catch((error) => {
          liffInitPromiseRef.current = null;
          throw error;
        });
      }
      await liffInitPromiseRef.current;

      if (!liff.isLoggedIn()) {
        // ถ้าผู้ใช้เปิดผ่านเบราว์เซอร์ปกติ(Chrome/Safari) จะเด้งไปล็อกอิน LINE
        liff.login({ redirectUri });
        return;
      }

      // ถ้าเปิดในแอป LINE หรือล็อกอินแล้ว ดึงข้อมูลได้ทันที!
      const profile = await liff.getProfile();
      const newAvatarUrl = profile.pictureUrl;

      if (!newAvatarUrl) {
        showToast('ไม่พบรูปโปรไฟล์ใน LINE ของคุณ', 'error');
        return;
      }

      // 1. บันทึกรูปภาพลงฐานข้อมูล
      const { error } = await supabase
        .from('users')
        .update({ avatar_url: newAvatarUrl })
        .eq('id', user.id);

      if (error) throw error;
      if (profile.userId) await mockApi.linkMyLineIdentity(profile.userId);

      // 2. อัปเดตหน้าจอให้เปลี่ยนรูปทันที
      onUserUpdate({ ...user, avatar_url: newAvatarUrl });
      showToast('ซิงค์รูปโปรไฟล์จาก LINE สำเร็จ!', 'success');

    } catch (err: any) {
      console.error(err);
      showToast('ไม่สามารถเชื่อมต่อ LINE ได้', 'error');
    } finally {
      setIsSyncingLine(false);
    }
  };

  // 🔥 เช็คสถานะการโดนแบน (ดึงจาก user.is_active ที่เราเพิ่งเพิ่มในฐานข้อมูล)
  // ใช้ (user as any) ป้องกัน TypeScript error เผื่อใน types.ts ยังไม่ได้เพิ่ม
  const isBanned = (user as any).is_active === false;

  // ✅ 1. Focus Mode Logic: จัดการการแสดงผล Bottom Nav ในระดับ CSS
  useEffect(() => {
    const bottomNav = document.querySelector('nav.md\\:hidden');
    if (activeStage !== 'IDLE' || showCard || viewingManual || showHistory) {
      bottomNav?.classList.add('hidden');
    } else {
      bottomNav?.classList.remove('hidden');
    }
    // Cleanup เมื่อออกหน้า
    return () => bottomNav?.classList.remove('hidden');
  }, [activeStage, showCard, viewingManual, showHistory]);

  // ดึงข้อมูล Work Permit
  useEffect(() => {
    const fetchPermit = async () => {
        try {
            const data = await mockApi.getActiveWorkPermit(user.id);
            setActivePermit(data);
        } catch (error) {
            console.error("Error fetching permit:", error);
        }
    };
    fetchPermit();
  }, [user.id]);

  const loadSupplierStatus = async () => {
    try {
      const flags = await mockApi.getPublicFeatureFlags();
      setSupplierOutsourceEnabled(flags.supplierOutsourceEnabled);
      if (flags.supplierOutsourceEnabled) setSupplierStatus(await mockApi.getMySupplierOutsourceStatus());
    } catch (error) {
      console.error('Supplier and Outsource status error:', error);
    }
  };

  useEffect(() => {
    loadSupplierStatus();
  }, [user.id]);

  useEffect(() => {
    if (!supplierStatus) return;
    setSupplierParticipantType(supplierStatus.participant_type);
    setSupplierWorkType(supplierStatus.work_type);
    setSupplierStartDate(supplierStatus.access_start_date || '');
    setSupplierEndDate(supplierStatus.access_end_date || '');
  }, [supplierStatus]);

  const handleSupplierEnrollment = async () => {
    if (supplierStartDate && supplierEndDate && supplierEndDate < supplierStartDate) {
      showToast('วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น', 'error');
      return;
    }
    const accessChanged = Boolean(supplierStatus) && (
      supplierParticipantType !== supplierStatus?.participant_type
      || supplierWorkType !== supplierStatus?.work_type
      || supplierStartDate !== (supplierStatus?.access_start_date || '')
      || supplierEndDate !== (supplierStatus?.access_end_date || '')
    );
    const hasActivePass = Boolean(
      supplierStatus?.verification_token
      && supplierStatus.expires_at
      && new Date(supplierStatus.expires_at) > new Date()
    );
    if (accessChanged && hasActivePass && !window.confirm(
      'การเปลี่ยนประเภทผู้ใช้ ประเภทงาน หรือช่วงวันที่ จะยกเลิกบัตรเดิมและต้องสอบใหม่ ต้องการดำเนินการต่อหรือไม่?'
    )) return;
    setSupplierSaving(true);
    try {
      await mockApi.addMySupplierOutsourceAccess({
        participantType: supplierParticipantType,
        workType: supplierWorkType,
        accessStartDate: supplierStartDate || undefined,
        accessEndDate: supplierEndDate || undefined,
      });
      let notificationSent = true;
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (!accessToken) throw new Error('Session unavailable');
        const response = await fetch('/api/notify-admin-supplier-access', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!response.ok) throw new Error('LINE notification failed');
      } catch (notificationError) {
        notificationSent = false;
        console.error('Supplier and Outsource access notification error:', notificationError);
      }
      await loadSupplierStatus();
      setShowSupplierEnrollment(false);
      showToast(
        notificationSent
          ? (supplierStatus ? 'อัปเดตสิทธิ์และแจ้งแอดมินทาง LINE แล้ว' : 'เพิ่มสิทธิ์และแจ้งแอดมินทาง LINE แล้ว')
          : 'บันทึกสิทธิ์เรียบร้อยแล้ว แต่ส่งข้อความ LINE ไม่สำเร็จ',
        notificationSent ? 'success' : 'warning',
      );
    } catch (error: any) {
      showToast('เพิ่มสิทธิ์ไม่สำเร็จ: ' + error.message, 'error');
    } finally {
      setSupplierSaving(false);
    }
  };

  const openSupplierEnrollment = () => {
    const today = getTodayIsoDate();
    const selectedStartDate = supplierStatus?.access_start_date || today;
    setSupplierStartDate(selectedStartDate);
    setSupplierEndDate(supplierStatus?.access_end_date || addOneYearIsoDate(selectedStartDate));
    setShowSupplierEnrollment(true);
  };

  // ✅ 2. ดึงรายชื่อบริษัททั้งหมดมาเก็บไว้ทำ Dropdown ตอนกด Edit
  useEffect(() => {
    const fetchVendorsList = async () => {
        const { data } = await supabase
          .from('vendors')
          .select('id, name')
          .eq('status', 'APPROVED')
          .order('name');
        if (data) setVendorsList(data);
    };
    fetchVendorsList();
  }, []);

  // ซิงค์ข้อมูลตอนเปิดโหมดแก้ไข
  useEffect(() => {
    if (isEditing) {
      setEditVendorId(user.vendor_id || '');
      const standardList = ['ไทย (Thai)', 'พม่า (Myanmar)', 'กัมพูชา (Cambodian)', 'ลาว (Lao)'];
      if (user.nationality && !standardList.includes(user.nationality)) {
        setIsOtherNationality(true);
      } else {
        setIsOtherNationality(false);
      }
    }
  }, [isEditing, user.nationality, user.vendor_id]);

  const hasInduction = user.induction_expiry && new Date(user.induction_expiry) > new Date();
  const isNearExpiry = user.induction_expiry && (new Date(user.induction_expiry).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24) < 30;
  const supplierPassActive = Boolean(supplierStatus?.expires_at && new Date(supplierStatus.expires_at) > new Date());
  const supplierPassNearExpiry = Boolean(supplierStatus?.expires_at
    && (new Date(supplierStatus.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24) < 30);
  const permitExpiryStatus = getExpiryStatus(activePermit?.expire_date);
  const permitNearExpiry = permitExpiryStatus.state === 'EXPIRING' || permitExpiryStatus.state === 'URGENT';
  const supplierExpiryStatus = getExpiryStatus(supplierStatus?.expires_at);
  const readiness = getUserReadiness({
    isActive: !isBanned,
    hasInduction: Boolean(hasInduction),
    hasActivePermit: Boolean(activePermit),
  });

  const handleReadinessAction = () => {
    if (readiness.primaryAction === 'START_INDUCTION') setActiveStage('INDUCTION');
    if (readiness.primaryAction === 'START_PERMIT') setActiveStage('WORK_PERMIT');
    if (readiness.primaryAction === 'VIEW_PERMIT') {
      setCardType('WORK_PERMIT');
      setShowCard(true);
    }
  };

  // ✅ 3.1 ฟังก์ชันบันทึกข้อมูล (รวมอัปเดต Vendor ID และ วันเกิด ลง Database)
  const handleUpdateProfile = async () => {
    if (!editName.trim()) return showToast('กรุณากรอกชื่อ-นามสกุล', 'error');
    setIsSaving(true);
    try {
      const payload = { 
        name: editName, 
        age: Number(editAge) || null, 
        date_of_birth: editDob || null, // ✅ สิ่งที่เพิ่มเข้ามา: เซฟวันเกิดด้วย
        nationality: editNationality,
        vendor_id: editVendorId || null
      };

      const { error } = await supabase
        .from('users')
        .update(payload)
        .eq('id', user.id);

      if (error) throw error;

      // หาชื่อบริษัทที่เพิ่งเลือกมาแสดงแบบ Real-time บน UI โดยไม่ต้องโหลดหน้าใหม่
      const selectedVendor = vendorsList.find(v => v.id === editVendorId);

      onUserUpdate({ 
        ...user, 
        name: editName, 
        age: Number(editAge), 
        date_of_birth: editDob || null, // ✅ อัปเดต State ให้มีวันเกิด
        nationality: editNationality,
        vendor_id: editVendorId || null,
        vendors: selectedVendor ? { name: selectedVendor.name } : null
      } as any); // ป้องกัน Error แดงใน TypeScript ถ้ายังไม่ได้แก้ไฟล์ types.ts

      showToast('อัปเดตข้อมูลส่วนตัวเรียบร้อยแล้ว', 'success');
      setIsEditing(false);
    } catch (err: any) {
      showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // ✅ 3.2 ฟังก์ชันบันทึกข้อมูลสำหรับหน้าต่างบังคับกรอก (Gatekeeper Modal)
  const handleSaveDob = async () => {
    if (!dobInput) return showToast('กรุณาระบุวัน/เดือน/ปีเกิด', 'error');
    setIsSavingDob(true);
    try {
      // คำนวณอายุจากวันเกิดที่เลือก เพื่อเซฟคู่กัน (ให้ของเดิมไม่พัง)
      const calculatedAge = calculateAge(dobInput);
      const payload = { 
        date_of_birth: dobInput, 
        age: calculatedAge !== '-' ? Number(calculatedAge) : null 
      };

      const { error } = await supabase.from('users').update(payload).eq('id', user.id);
      if (error) throw error;
      
      onUserUpdate({ ...user, ...payload } as any);
      setShowDobModal(false);
      showToast('บันทึกข้อมูลสำเร็จ เข้าสู่ระบบพร้อมใช้งาน', 'success');
    } catch (err: any) {
      showToast('บันทึกไม่สำเร็จ: ' + err.message, 'error');
    } finally {
      setIsSavingDob(false);
    }
  };

  const handleResetExam = async () => {
    if(!window.confirm("คุณต้องการล้างประวัติการอบรมเพื่อเริ่มสอบใหม่ใช่หรือไม่?")) return;
    setIsSaving(true);
    try {
      const { error } = await supabase.rpc('reset_my_induction');
      if (error) throw error;
      onUserUpdate({ ...user, induction_expiry: null });
      showToast('รีเซ็ตสถานะการอบรมแล้ว คุณสามารถเริ่มสอบใหม่ได้ทันที', 'success');
    } catch (err: any) {
      showToast('ไม่สามารถรีเซ็ตได้: ' + err.message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // ✅ Focus Mode Render: ซ่อนทุกอย่างเพื่อโชว์หน้าเฉพาะทาง
  if (showCard) return <DigitalCard user={user} onBack={() => setShowCard(false)} type={cardType} permit={activePermit} supplierStatus={supplierStatus} />;
  if (showHistory) return <ExamHistory userId={user.id} onBack={() => setShowHistory(false)} />;
  
  if (activeStage !== 'IDLE' && !isBanned) {
    return (
      <div className="animate-in fade-in zoom-in-95 duration-300">
        <ExamSystem
          type={activeStage === 'INDUCTION' ? ExamType.INDUCTION : activeStage === 'WORK_PERMIT' ? ExamType.WORK_PERMIT : ExamType.SUPPLIER_OUTSOURCE}
          user={user}
          onComplete={(u) => {
            onUserUpdate(u);
            setActiveStage('IDLE');
            showToast('บันทึกผลการสอบเรียบร้อยแล้ว', 'success');
            if (activeStage === 'INDUCTION') {
                // Verify จาก DB ก่อนแสดงบัตร เพื่อป้องกันการแสดงบัตรจากข้อมูล client
                setTimeout(async () => {
                    const { data: freshUser } = await supabase
                        .from('users')
                        .select('induction_expiry')
                        .eq('id', user.id)
                        .single();
                    if (freshUser?.induction_expiry) {
                        onUserUpdate({ ...u, induction_expiry: freshUser.induction_expiry });
                        setCardType('INDUCTION');
                        setShowCard(true);
                    }
                }, 1000);
            }
            if (activeStage === 'WORK_PERMIT') {
                setTimeout(async () => {
                    const data = await mockApi.getActiveWorkPermit(user.id);
                    setActivePermit(data);
                    setCardType('WORK_PERMIT');
                    setShowCard(true);
                }, 1500);
            }
            if (activeStage === 'SUPPLIER_OUTSOURCE') {
                setTimeout(async () => {
                    await loadSupplierStatus();
                    setCardType('SUPPLIER_OUTSOURCE');
                    setShowCard(true);
                }, 1000);
            }
          }}
          onBack={() => setActiveStage('IDLE')}
        />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-slate-50/50 pb-24 text-left">
      
      {/* 🎨 Background Pattern Overlay */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-40" 
            style={{ backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)', backgroundSize: '24px 24px' }}>
      </div>

      <div className="relative z-10 max-w-2xl mx-auto p-4 space-y-6 md:space-y-8 animate-in fade-in duration-500">
        
        {/* 🚨 BANNED ALERT BANNER (แสดงเมื่อถูกระงับสิทธิ์) */}
        {isBanned && (
          <div className="bg-red-500 rounded-[2rem] p-5 shadow-lg shadow-red-500/20 flex items-start md:items-center gap-4 animate-in slide-in-from-top-4 border-2 border-red-400 mt-4 mx-1">
             <div className="bg-white/20 p-3 rounded-full shrink-0">
                <Ban className="text-white w-8 h-8" />
             </div>
             <div className="text-white text-left flex-1">
                <h3 className="font-black text-lg md:text-xl uppercase tracking-wider leading-tight">Account Suspended</h3>
                <p className="text-[10px] md:text-xs font-bold opacity-90 mt-1 leading-relaxed">
                  สิทธิ์การใช้งานของคุณถูกระงับชั่วคราว คุณไม่สามารถทำแบบทดสอบหรือเข้าปฏิบัติงานในพื้นที่ได้ โปรดติดต่อเจ้าหน้าที่ Safety
                </p>
             </div>
          </div>
        )}

        {/* 🟢 Hero Section: Floating Identity Card */}
        <div className={`relative ${!isBanned ? 'pt-4' : 'pt-2'}`}>
          <div className="absolute top-20 left-1/2 -translate-x-1/2 w-3/4 h-20 bg-blue-500/20 blur-[60px] rounded-full pointer-events-none"></div>
          <div className={`absolute top-0 left-0 right-0 h-36 rounded-[2.5rem] shadow-sm overflow-hidden ${isBanned ? 'bg-gradient-to-r from-red-600 to-rose-900' : 'bg-gradient-to-r from-blue-600 to-indigo-800'}`}>
               <div
                 className="absolute inset-0 opacity-20"
                 style={{
                   backgroundImage: 'linear-gradient(135deg, rgba(255, 255, 255, 0.18) 25%, transparent 25%, transparent 50%, rgba(255, 255, 255, 0.18) 50%, rgba(255, 255, 255, 0.18) 75%, transparent 75%, transparent)',
                   backgroundSize: '8px 8px',
                 }}
               />
          </div>

          <div className={`relative z-10 mx-2 md:mx-6 bg-white rounded-[2rem] p-5 md:p-6 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.1)] border mt-16 flex flex-col md:flex-row gap-5 items-start md:items-center ${isBanned ? 'border-red-200' : 'border-slate-100'}`}>
              <div className="relative self-center md:self-start">
                  <div className="w-24 h-24 rounded-[1.5rem] bg-white p-1.5 shadow-lg -mt-16 md:mt-0 relative z-20 group">
                      <div className={`w-full h-full rounded-2xl flex items-center justify-center text-4xl font-black border uppercase shadow-inner overflow-hidden relative ${isBanned ? 'bg-red-50 text-red-600 border-red-100' : 'bg-gradient-to-br from-slate-50 to-slate-100 text-blue-600 border-slate-200'}`}>
                          
                          {/* โชว์รูปโปรไฟล์ ถ้ามีรูปให้แสดงรูป ถ้าไม่มีให้แสดงตัวอักษรย่อ */}
                          {user.avatar_url ? (
                              <img src={user.avatar_url} alt="Profile" className="w-full h-full object-cover" />
                          ) : (
                              user.name ? user.name.charAt(0) : '?'
                          )}
                          
                          {/* 🟢 ปุ่ม Sync LINE ซ่อนอยู่ จะโชว์ตอนเอาเมาส์ชี้ */}
                          {!isBanned && (
                              <button 
                                  onClick={handleSyncLineProfile} 
                                  disabled={isSyncingLine}
                                  aria-label="ซิงค์รูปโปรไฟล์จาก LINE"
                                  className="absolute inset-0 bg-slate-900/60 backdrop-blur-[2px] flex flex-col items-center justify-center text-white opacity-0 md:group-hover:opacity-100 transition-opacity duration-300"
                              >
                                  {isSyncingLine ? <Loader2 size={24} className="animate-spin" /> : <RefreshCw size={24} className="mb-1" />}
                                  <span className="text-[8px] uppercase tracking-widest font-black text-center leading-tight">Sync<br/>LINE</span>
                              </button>
                          )}
                      </div>

                      {/* 🟢 Badge ไอคอน LINE มุมขวาบน (เพื่อให้กดได้ง่ายๆ ในมือถือ) */}
                      {!isBanned && (
                          <button 
                              onClick={handleSyncLineProfile}
                              disabled={isSyncingLine}
                              aria-label="ซิงค์รูปโปรไฟล์จาก LINE"
                              className="absolute -top-2 -right-2 bg-[#06C755] text-white p-1.5 rounded-full shadow-lg border-2 border-white hover:scale-110 active:scale-95 transition-all z-30" 
                              title="ซิงค์รูปโปรไฟล์จาก LINE"
                          >
                              <RefreshCw size={12} className={isSyncingLine ? "animate-spin" : ""} />
                          </button>
                      )}
                  </div>
                  {/* ✅ Badge เปลี่ยนสีตามสถานะแบน */}
                  <div className={`absolute -bottom-3 left-1/2 -translate-x-1/2 text-white text-[9px] font-black px-3 py-1.5 rounded-full uppercase tracking-widest border-4 border-white shadow-md flex items-center gap-1 whitespace-nowrap z-30 ${isBanned ? 'bg-red-600' : 'bg-slate-900'}`}>
                      {isBanned ? <><Ban size={10} /> Suspended</> : <><ShieldCheck size={10} /> {user.role === 'ADMIN' ? 'Admin' : 'User'}</>}
                  </div>
              </div>

              <div className="flex-1 w-full pt-4 md:pt-0 text-center md:text-left">
                  {isEditing ? (
                    <div className="space-y-3 text-left">
                        <input className="text-lg font-bold text-slate-900 border-b-2 border-blue-500 outline-none w-full bg-slate-50 px-3 py-2 rounded-t-lg transition-all" value={editName} onChange={(e) => setEditName(e.target.value)} />
                        {/* ✅ เพิ่มช่องวันเกิดคู่กับอายุ */}
                        <div className="grid grid-cols-2 gap-3 mb-3">
                            <div>
                              <label className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Date of Birth</label>
                              <input 
                                type="date" 
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-xs outline-none focus:border-blue-500" 
                                value={editDob} 
                                onChange={(e) => {
                                  setEditDob(e.target.value);
                                  // คำนวณอายุแล้วเปลี่ยนค่าในช่อง Age อัตโนมัติ
                                  const newAge = calculateAge(e.target.value);
                                  if (newAge !== '-') setEditAge(newAge.toString());
                                }} 
                                max={new Date().toISOString().split("T")[0]} 
                              />
                            </div>
                            <div>
                              <label className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Age (Auto)</label>
                              <input 
                                type="number" 
                                className="w-full bg-slate-100 text-slate-500 border border-slate-200 rounded-xl px-3 py-2 font-bold text-xs outline-none cursor-not-allowed" 
                                value={editAge} 
                                readOnly // ล็อกไว้ให้คำนวณจากวันเกิดอย่างเดียว
                                placeholder="-"
                              />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3">
                            <div>
                              <label className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Nationality</label>
                              <select className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-xs outline-none focus:border-blue-500" value={isOtherNationality ? 'OTHER' : editNationality} onChange={(e) => {
                                  const val = e.target.value;
                                  if (val === 'OTHER') { setIsOtherNationality(true); setEditNationality(''); } 
                                  else { setIsOtherNationality(false); setEditNationality(val); }
                                }}>
                                <option value="ไทย (Thai)">ไทย (Thai)</option>
                                <option value="พม่า (Myanmar)">พม่า (Myanmar)</option>
                                <option value="กัมพูชา (Cambodian)">กัมพูชา (Cambodian)</option>
                                <option value="ลาว (Lao)">ลาว (Lao)</option>
                                <option value="OTHER">อื่นๆ / Other</option>
                              </select>
                            </div>
                        </div>

                        {/* ✅ Dropdown สำหรับเลือกบริษัท (Vendor) ในโหมดแก้ไข */}
                        <div className="mt-1">
                            <label className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Company / Vendor</label>
                            <select 
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-xs outline-none focus:border-blue-500 mt-1" 
                                value={editVendorId} 
                                onChange={(e) => setEditVendorId(e.target.value)}
                            >
                                <option value="">-- ไม่ระบุสังกัดบริษัท (None) --</option>
                                {vendorsList.map(v => (
                                    <option key={v.id} value={v.id}>{v.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                  ) : (
                    <div className="w-full flex flex-col items-center md:items-start">
                        {/* 1. ชื่อและตำแหน่ง */}
                        <div className="text-center md:text-left mb-4">
                            <h2 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight uppercase leading-none">{user.name}</h2>
                            <p className="text-[10px] md:text-xs font-bold text-blue-700 uppercase tracking-widest mt-1.5 flex items-center justify-center md:justify-start gap-1.5">
                               <ShieldCheck size={14} className={isBanned ? 'text-red-700' : 'text-blue-700'} />
                               <span className={isBanned ? 'text-red-700' : 'text-blue-700'}>
                                  {user.role === 'ADMIN' ? 'System Administrator' : 'Authorized Personnel'}
                               </span>
                            </p>
                        </div>

                        {/* 2. 📊 Enterprise Data Grid (กล่องแสดงข้อมูล) */}
                        <div className={`w-full rounded-2xl p-4 md:p-5 border text-left grid grid-cols-2 gap-y-4 gap-x-4 shadow-sm relative overflow-hidden ${isBanned ? 'bg-red-50/50 border-red-100' : 'bg-slate-50 border-slate-100'}`}>
                            
                            {/* ลายน้ำพื้นหลังบางๆ */}
                            <div className="absolute -right-4 -bottom-4 opacity-[0.03] pointer-events-none">
                                <QrCode size={100} />
                            </div>
                            
                            {/* แถวที่ 1: สังกัด และ เลขบัตร */}
                            <div className="col-span-2 md:col-span-1 z-10">
                                <span className="text-[8px] md:text-[9px] text-slate-600 font-black uppercase tracking-widest flex items-center gap-1">
                                    <Building2 size={10}/> Company / Vendor
                                </span>
                                <span className="text-xs md:text-sm font-bold text-slate-800 truncate block mt-0.5">
                                    {user.vendors?.name || 'ไม่มีสังกัดบริษัท (EXTERNAL)'}
                                </span>
                            </div>
                            <div className="col-span-2 md:col-span-1 z-10">
                                <span className="text-[8px] md:text-[9px] text-slate-600 font-black uppercase tracking-widest flex items-center gap-1">
                                    <Ticket size={10}/> National ID / Passport
                                </span>
                                <span className="text-xs md:text-sm font-bold text-slate-800 font-mono mt-0.5 flex items-center gap-1.5">
                                    {maskNationalID(user.national_id)} 
                                    <Lock size={10} className={isBanned ? 'text-red-400' : 'text-emerald-500'} />
                                </span>
                            </div>

                            {/* เส้นแบ่ง */}
                            <div className="col-span-2 h-px bg-slate-200/60 my-0.5 z-10"></div>

                            {/* แถวที่ 2: วันเกิด/อายุ และ สัญชาติ */}
                            <div className="col-span-1 z-10">
                                <span className="text-[8px] md:text-[9px] text-slate-600 font-black uppercase tracking-widest flex items-center gap-1">
                                    <Calendar size={10}/> DOB & Age
                                </span>
                                <span className="text-xs md:text-sm font-bold text-slate-800 mt-0.5 flex flex-wrap items-baseline gap-1">
                                    {(user as any).date_of_birth ? new Date((user as any).date_of_birth).toLocaleDateString(language === 'th' ? 'th-TH' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '-'} 
                                    <span className="text-[10px] md:text-[11px] text-blue-600 font-black bg-blue-50 px-1.5 py-0.5 rounded-md border border-blue-100">
                                        {user.age ? `${user.age} Y` : '-'}
                                    </span>
                                </span>
                            </div>
                            <div className="col-span-1 z-10">
                                <span className="text-[8px] md:text-[9px] text-slate-600 font-black uppercase tracking-widest flex items-center gap-1">
                                    <Globe2 size={10}/> Nationality
                                </span>
                                <span className="text-xs md:text-sm font-bold text-slate-800 mt-0.5 block">
                                    {user.nationality || 'ไม่ระบุ'}
                                </span>
                            </div>

                        </div>
                    </div>
                  )}
              </div>

              <div className="flex gap-2 w-full md:w-auto mt-2 md:mt-0 justify-center">
                  {isEditing ? (
                    <div className="flex gap-2 w-full flex-col md:flex-row">
                        <button onClick={handleUpdateProfile} disabled={isSaving} className="flex-1 w-full bg-emerald-700 text-white py-2.5 px-4 rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all hover:bg-emerald-800">
                          {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
                        </button>
                        <button onClick={() => setIsEditing(false)} className="w-full md:w-auto px-4 py-2.5 bg-slate-100 text-slate-500 rounded-xl text-[10px] font-black uppercase hover:bg-slate-200">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setIsEditing(true)} aria-label="แก้ไขข้อมูลส่วนตัว" className="p-3 bg-slate-50 text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all active:scale-90 border border-transparent hover:border-blue-100"><Edit3 size={18} /></button>
                  )}
              </div>
          </div>
        </div>

        <UserReadinessSummary
          language={language}
          readiness={readiness}
          onPrimaryAction={handleReadinessAction}
        />

        {/* 🔵 Safety Journey Timeline */}
        <div className="space-y-5 px-1">
          <div className="flex items-center justify-between">
             <div className="flex items-center gap-3">
               <div className={`w-1.5 h-6 rounded-full shadow-sm ${isBanned ? 'bg-red-500' : 'bg-blue-600'}`}></div>
               <h3 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em]">Safety Journey</h3>
             </div>
             <button onClick={() => setShowHistory(true)} className="text-[10px] font-bold text-blue-700 flex items-center gap-1 hover:text-blue-800 uppercase bg-blue-50 px-3 py-1.5 rounded-full">
                History <ChevronRight size={12} />
             </button>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {/* ส่ง isBanned ไปให้ StageCard ล็อกการทำงาน */}
            <StageCard
              title={t('user.stage1')} 
              isActive={hasInduction}
              isNearExpiry={isNearExpiry}
              expiryDate={user.induction_expiry}
              icon={<BookOpen size={24} />}
              onClick={() => { if (hasInduction && !isNearExpiry) { setCardType('INDUCTION'); setShowCard(true); } else setActiveStage('INDUCTION'); }}
              onRetake={() => { if(window.confirm("คุณต้องการเริ่มสอบ Induction ใหม่ใช่หรือไม่?")) setActiveStage('INDUCTION'); }}
              disabled={isBanned} // ✅ ล็อกปุ่มถ้าโดนแบน
              isBanned={isBanned}
              buttonText={hasInduction && !isNearExpiry ? (language === 'th' ? "แสดงบัตรดิจิทัล" : "Show Digital ID") : (language === 'th' ? "เริ่มการอบรม" : "Start Induction Exam")}
              color="blue"
            />

            <StageCard
              title={t('user.stage2')} 
              isActive={!!activePermit}
              isNearExpiry={permitNearExpiry}
              expiryDate={activePermit?.expire_date}
              icon={!hasInduction ? <Lock size={24} /> : <Ticket size={24} />}
              onClick={() => { if (activePermit) { setCardType('WORK_PERMIT'); setShowCard(true); } else if (hasInduction) setActiveStage('WORK_PERMIT'); }}
              onRetake={() => { if(window.confirm("คุณต้องการเริ่มสอบ Work Permit ใหม่ใช่หรือไม่?")) setActiveStage('WORK_PERMIT'); }}
              disabled={!hasInduction || isBanned} // ✅ ล็อกปุ่มถ้าโดนแบน หรือยังไม่ผ่าน Induction
              isBanned={isBanned}
              permitNo={activePermit?.permit_no}
              buttonText={!!activePermit ? (language === 'th' ? "ดูใบอนุญาต" : "View Permit") : (language === 'th' ? "ขอใบอนุญาตทำงาน" : "Get Work Permit")}
              color="indigo"
            />

            {supplierOutsourceEnabled && (
              <div className="rounded-[2rem] border border-emerald-100 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-4">
                    <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-600"><ShieldCheck size={24}/></div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-black uppercase text-slate-900">Supplier & Outsource</h4>
                        <span className={`rounded-full px-2 py-1 text-[8px] font-black uppercase ${supplierPassActive ? 'bg-emerald-100 text-emerald-700' : supplierStatus ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                          {supplierPassActive ? (supplierPassNearExpiry ? 'ใกล้หมดอายุ' : 'ผ่าน') : supplierStatus?.last_status === 'FAILED' ? 'ไม่ผ่าน' : supplierStatus ? 'พร้อมสอบ' : 'ยังไม่มีสิทธิ์'}
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] font-bold text-slate-600">
                        {supplierStatus ? `${supplierStatus.participant_type} • ${supplierStatus.work_type}` : 'สำหรับ Supplier ส่งสินค้า/เข้าพื้นที่ชั่วคราว และ Outsource งานทั่วไป'}
                      </p>
                      {supplierStatus && (
                        <div className="mt-2 flex flex-wrap gap-2 text-[9px] font-bold text-slate-500">
                          <span>คะแนน {supplierStatus.last_score ?? '-'} / {supplierStatus.total_questions ?? '-'}</span>
                          <span>•</span>
                          <span>หมดอายุ {supplierStatus.expires_at ? new Date(supplierStatus.expires_at).toLocaleDateString(language === 'th' ? 'th-TH' : 'en-US') : '-'}</span>
                          {supplierStatus.expires_at && <><span>•</span><span className={supplierExpiryStatus.state === 'URGENT' || supplierExpiryStatus.state === 'EXPIRING' ? 'text-amber-700' : supplierExpiryStatus.state === 'EXPIRED' ? 'text-red-700' : ''}>{getExpiryLabel(supplierExpiryStatus, language)}</span></>}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {supplierStatus && (
                      <button disabled={isBanned} onClick={() => supplierPassActive && !supplierPassNearExpiry ? (setCardType('SUPPLIER_OUTSOURCE'), setShowCard(true)) : setActiveStage('SUPPLIER_OUTSOURCE')} className="flex-1 rounded-xl bg-emerald-700 px-4 py-3 text-[9px] font-black uppercase tracking-widest text-white hover:bg-emerald-800 disabled:opacity-40">
                        {supplierPassActive && !supplierPassNearExpiry ? 'ดูบัตร' : 'เริ่มสอบ'}
                      </button>
                    )}
                    {supplierStatus && supplierPassActive && !supplierPassNearExpiry && (
                      <button
                        disabled={isBanned}
                        onClick={() => {
                          if (window.confirm('คุณต้องการเริ่มสอบ Supplier & Outsource ใหม่ใช่หรือไม่?')) {
                            setActiveStage('SUPPLIER_OUTSOURCE');
                          }
                        }}
                        className="flex-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[9px] font-black uppercase tracking-widest text-amber-700 disabled:opacity-40"
                      >
                        สอบใหม่ / Retake
                      </button>
                    )}
                    <button disabled={isBanned} onClick={openSupplierEnrollment} className="flex-1 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[9px] font-black uppercase tracking-widest text-emerald-700 disabled:opacity-40">
                      {supplierStatus ? 'แก้ไขข้อมูล' : 'เพิ่มสิทธิ์'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!hasInduction && !activePermit && !isBanned && (
              <div className="bg-blue-50/50 border-2 border-dashed border-blue-200 rounded-[2rem] p-8 text-center animate-in zoom-in">
                <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm">
                  <ArrowRightCircle size={32} className="text-blue-500 animate-soft-pulse" />
                </div>
                <h4 className="text-sm font-black text-blue-900 uppercase tracking-tight mb-2">Welcome to SafetyPass</h4>
                <p className="text-[10px] text-blue-600/70 font-bold uppercase tracking-widest leading-relaxed max-w-[200px] mx-auto">Please complete the Induction Training to unlock your digital safety identity.</p>
              </div>
            )}
          </div>
        </div>

        {showSupplierEnrollment && supplierOutsourceEnabled && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
            <div ref={supplierDialogRef} role="dialog" aria-modal="true" aria-labelledby="supplier-enrollment-title" tabIndex={-1} className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl focus:outline-none">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <h3 id="supplier-enrollment-title" className="text-lg font-black uppercase text-slate-900">Supplier & Outsource</h3>
                  <p className="mt-1 text-[10px] font-bold text-slate-600">เพิ่มหรือแก้ไขประเภทผู้ใช้และลักษณะงาน</p>
                </div>
                <button onClick={() => setShowSupplierEnrollment(false)} aria-label="ปิดหน้าต่าง Supplier & Outsource" className="min-h-11 min-w-11 rounded-full bg-slate-100 p-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"><X size={18}/></button>
              </div>
              <div className="space-y-3">
                <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400">ประเภทผู้ใช้
                  <select value={supplierParticipantType} onChange={(e) => setSupplierParticipantType(e.target.value as SupplierOutsourceType)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-bold normal-case text-slate-700">
                    <option value="supplier">Supplier ส่งสินค้า/เข้าพื้นที่ชั่วคราว</option>
                    <option value="outsource">Outsource งานทั่วไป</option>
                  </select>
                </label>
                <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400">ประเภทงาน
                  <select value={supplierWorkType} onChange={(e) => setSupplierWorkType(e.target.value as SupplierOutsourceWorkType)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-bold normal-case text-slate-700">
                    <option value="Driver">Driver</option><option value="Passenger">Passenger</option><option value="Trainee">Trainee</option>
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">วันที่เริ่ม
                    <input type="date" value={supplierStartDate} onChange={(e) => {
                      setSupplierStartDate(e.target.value);
                      setSupplierEndDate(addOneYearIsoDate(e.target.value));
                    }} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-bold text-slate-700" />
                  </label>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">วันที่สิ้นสุด
                    <input type="date" min={supplierStartDate || undefined} value={supplierEndDate} onChange={(e) => setSupplierEndDate(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-bold text-slate-700" />
                  </label>
                </div>
                <button onClick={handleSupplierEnrollment} disabled={supplierSaving} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-4 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50">
                  {supplierSaving ? <Loader2 size={16} className="animate-spin"/> : <Save size={16}/>} บันทึกสิทธิ์
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 🟡 Resource Guides */}
        <div className="space-y-4 px-1 text-left">
           <h3 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em] ml-2">Safety Manuals</h3>
           <div className={`grid gap-4 ${supplierOutsourceEnabled ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2'}`}>
              <ResourceCard 
                icon={<BookOpen size={20} />} 
                title="Induction" 
                desc="Basic Safety Rules" 
                onClick={() => window.open('https://qdodmxrecioltwdryhec.supabase.co/storage/v1/object/public/manuals/induction.pdf', '_blank', 'noopener,noreferrer')} 
              />
              {supplierOutsourceEnabled && <ResourceCard
                icon={<ShieldCheck size={20} />}
                title="Supplier & Outsource"
                desc="Temporary Access"
                onClick={() => window.open('https://qdodmxrecioltwdryhec.supabase.co/storage/v1/object/public/manuals/supplier_outsource.pdf', '_blank', 'noopener,noreferrer')}
              />}
              <ResourceCard 
                icon={<Ticket size={20} />} 
                title="Work Permit" 
                desc="High Risk Work" 
                onClick={() => window.open('https://qdodmxrecioltwdryhec.supabase.co/storage/v1/object/public/manuals/work_permit.pdf', '_blank', 'noopener,noreferrer')} 
              />
           </div>
        </div>

        {/* Active Permit Visual - 🚫 ซ่อนถ้าโดนแบน */}
        {activePermit && !isBanned && (
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-[2rem] p-6 text-white shadow-2xl relative overflow-hidden group mx-1 animate-in zoom-in-95">
            <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform duration-500"><QrCode size={120} /></div>
            <div className="relative z-10 flex items-center gap-6">
              
              {/* 🔥 แก้ไข URL เข้ารหัส permit_no สำหรับ QR เล็กในหน้าแรก */}
              <button type="button" aria-label="ขยาย QR Code ใบอนุญาต" className="bg-white p-2.5 rounded-2xl shadow-lg active:scale-95 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-400" onClick={() => setShowQRFullScreen(true)}>
                <QRCodeSVG title="QR Code สำหรับตรวจสอบใบอนุญาต" value={`${window.location.origin}/verify?id=${encodeURIComponent(user.national_id)}&permit=${encodeURIComponent(activePermit.permit_no)}`} size={112} />
              </button>

              <div className="text-left">
                <div className="flex items-center gap-2 mb-2"><span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_10px_#10b981]"></span><div className="text-slate-400 font-bold uppercase tracking-widest text-[9px]">Active Permit</div></div>
                <h4 className="text-2xl font-black mb-3 tracking-tight text-white">{activePermit.permit_no}</h4>
                <button onClick={() => setShowQRFullScreen(true)} className="bg-white/10 hover:bg-white/20 text-white px-5 py-2 rounded-xl font-black text-[9px] transition-all flex items-center gap-2 backdrop-blur-sm border border-white/10 uppercase tracking-widest">Tap to Expand</button>
              </div>
            </div>
          </div>
        )}

        {/* ✅ Manual Viewer Modal */}
        {viewingManual && (
          <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-md z-[100] flex flex-col items-center justify-center p-0 md:p-4"> 
            <div ref={manualDialogRef} role="dialog" aria-modal="true" aria-labelledby="manual-dialog-title" tabIndex={-1} className="bg-white w-full h-full md:max-w-4xl md:h-[90vh] md:rounded-[2.5rem] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300 shadow-2xl focus:outline-none">
              
              {/* 1. ส่วนหัว (Header) */}
              <div className="p-4 md:p-6 border-b flex justify-between items-center bg-slate-50 flex-shrink-0 z-10 relative">
                <div className="flex items-center gap-3 md:gap-4 text-left">
                  <div className="p-2 md:p-3 bg-blue-600 text-white rounded-xl md:rounded-2xl shadow-lg">
                    <FileText size={20} className="md:w-6 md:h-6" />
                  </div>
                  <div>
                      <h3 id="manual-dialog-title" className="text-base md:text-lg font-black text-slate-900 leading-tight">{viewingManual} Manual</h3>
                      <p className="text-[9px] md:text-[10px] text-slate-400 font-bold uppercase tracking-widest">Safety Documentation</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                    <a 
                        href={`https://qdodmxrecioltwdryhec.supabase.co/storage/v1/object/public/manuals/${viewingManual.toLowerCase()}.pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 md:p-3 hover:bg-blue-50 text-blue-500 rounded-xl transition-all"
                        title="Open in new tab"
                    >
                        <Globe2 size={20} className="md:w-6 md:h-6" />
                    </a>
                    <button onClick={() => setViewingManual(null)} aria-label="ปิดคู่มือ" className="min-h-11 min-w-11 p-2 md:p-3 hover:bg-red-50 text-slate-600 hover:text-red-600 rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <X size={20} className="md:w-6 md:h-6" />
                    </button>
                </div>
              </div>

              {/* 2. ส่วนแสดง PDF */}
              <div className="flex-grow bg-slate-200 relative overflow-hidden">
                <iframe 
                    src={`https://docs.google.com/viewer?url=${encodeURIComponent(`https://qdodmxrecioltwdryhec.supabase.co/storage/v1/object/public/manuals/${viewingManual.toLowerCase()}.pdf`)}&embedded=true`}
                    className="w-full h-full border-none absolute inset-0" 
                    title="Manual Viewer" 
                />
              </div>
              
            </div>
          </div>
        )}

        {/* QR Fullscreen Overlay */}
        {showQRFullScreen && activePermit && !isBanned && (
          <div ref={qrDialogRef} role="dialog" aria-modal="true" aria-label="QR Code ใบอนุญาตแบบเต็มจอ" tabIndex={-1} className="fixed inset-0 bg-slate-950 z-[200] flex flex-col items-center justify-center text-white p-6 animate-in fade-in duration-300 backdrop-blur-xl focus:outline-none" onClick={() => setShowQRFullScreen(false)}>
            <button aria-label="ปิด QR Code" className="absolute top-8 right-8 min-h-11 min-w-11 p-4 text-white/70 hover:text-white transition-all focus:outline-none focus:ring-2 focus:ring-blue-400" onClick={() => setShowQRFullScreen(false)}><X size={32} /></button>
            <div className="bg-white p-10 rounded-[3rem] shadow-[0_0_80px_rgba(59,130,246,0.4)] animate-in zoom-in duration-500">
              
              {/* 🔥 แก้ไข URL เข้ารหัส permit_no สำหรับ QR แบบ Fullscreen */}
              <QRCodeSVG title="QR Code สำหรับตรวจสอบใบอนุญาตแบบเต็มจอ" value={`${window.location.origin}/verify?id=${encodeURIComponent(user.national_id)}&permit=${encodeURIComponent(activePermit.permit_no)}`} size={300} />
              
            </div>
            <div className="mt-10 text-3xl font-black tracking-[0.3em] uppercase border-b-2 border-blue-500 pb-4">{activePermit.permit_no}</div>
            <div className="mt-6 text-blue-400 font-bold text-xs uppercase tracking-[0.3em] flex items-center gap-2"><ShieldCheck size={16} /> Authenticated Access</div>
          </div>
        )}

        {/* 🛑 Gatekeeper Modal: บังคับกรอกวันเกิด (เด้งทับทุกอย่าง ไม่มีปุ่มปิด) */}
        {showDobModal && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/80 backdrop-blur-md p-4 animate-in fade-in duration-300">
            <div ref={dobDialogRef} role="dialog" aria-modal="true" aria-labelledby="dob-dialog-title" tabIndex={-1} className="bg-white p-6 md:p-8 rounded-[2rem] shadow-2xl max-w-sm w-full text-center animate-in zoom-in-95 focus:outline-none">
              <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-blue-100">
                <Calendar className="text-blue-600 w-8 h-8" />
              </div>
              <h2 id="dob-dialog-title" className="text-xl font-black text-slate-800 uppercase mb-2">อัปเดตข้อมูลส่วนตัว</h2>
              <p className="text-[10px] md:text-xs text-slate-500 mb-6 font-bold leading-relaxed px-2">
                เพื่อความถูกต้องของข้อมูลความปลอดภัย กรุณาระบุ <span className="text-blue-600">วัน/เดือน/ปีเกิด (ค.ศ.)</span> ของคุณก่อนเข้าใช้งานระบบ
              </p>
              
              <div className="text-left mb-6">
                 <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Date of Birth / วันเกิด</label>
                 <input 
                   type="date" 
                   className="w-full border-2 border-slate-200 p-4 rounded-xl font-bold text-slate-700 outline-none focus:border-blue-500 transition-all shadow-inner mt-1"
                   value={dobInput}
                   onChange={(e) => setDobInput(e.target.value)}
                   max={new Date().toISOString().split("T")[0]} 
                 />
                 {/* แสดงอายุแบบ Real-time หลังจากเลือกวันเกิด */}
                 {dobInput && calculateAge(dobInput) !== '-' && (
                    <p className="text-[9px] text-emerald-600 font-bold mt-2 ml-1">
                      <CheckCircle2 size={10} className="inline mr-1 -mt-0.5" /> 
                      อายุของคุณคือ {calculateAge(dobInput)} ปี
                    </p>
                 )}
              </div>
              
              <button 
                onClick={handleSaveDob}
                disabled={isSavingDob || !dobInput}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-black py-4 rounded-2xl transition-all shadow-lg shadow-blue-200 active:scale-95 uppercase tracking-widest text-[11px] flex items-center justify-center gap-2"
              >
                {isSavingDob ? <Loader2 size={16} className="animate-spin" /> : <><Save size={16} /> บันทึกข้อมูลและเข้าใช้งาน</>}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

// 🔵 Premium Shared UI Components
const ResourceCard = ({ icon, title, desc, onClick }: any) => (
  <button onClick={onClick} className="bg-white p-5 rounded-[1.5rem] border border-slate-100 active:bg-slate-50 hover:shadow-lg transition-all flex flex-col items-center text-center gap-3 group relative overflow-hidden">
    <div className="p-4 bg-slate-50 text-blue-600 rounded-2xl group-active:bg-blue-600 group-active:text-white transition-all shadow-inner">{icon}</div>
    <div className="min-w-0">
      <h4 className="font-black text-slate-800 text-xs truncate uppercase tracking-tight mb-1">{title}</h4>
      <div className="text-[9px] text-slate-600 font-bold uppercase truncate tracking-wide">{desc}</div>
    </div>
  </button>
);

// ✅ StageCard ฉบับแก้ไข: รองรับสถานะถูกแบน (BANNED) อย่างสมบูรณ์แบบ
const StageCard = ({ title, isActive, isNearExpiry, expiryDate, icon, onClick, onRetake, disabled, permitNo, buttonText, color = 'blue', isBanned }: any) => {
    const { language } = useTranslation();
    const expiryStatus = getExpiryStatus(expiryDate);
    const expiryLabel = getExpiryLabel(expiryStatus, language);
    
    // คำนวณสถานะของการ์ด
    const statusType = isBanned ? 'BANNED' : disabled ? 'LOCKED' : isActive && !isNearExpiry ? 'PASSED' : isNearExpiry ? 'WARNING' : 'READY';
    
    // เช็คว่าควร Disable การกระทำไหม
    const isActionDisabled = disabled || isBanned;
    
    return (
        <div className={`group p-0.5 rounded-[2rem] transition-all duration-500 ${!isActionDisabled ? 'hover:-translate-y-1' : ''}`}>
            <div className={`bg-white p-5 rounded-[1.8rem] border-2 transition-all relative overflow-hidden shadow-sm h-full flex flex-col justify-between ${
                statusType === 'BANNED' ? 'border-red-100 bg-red-50/30 opacity-80' 
                : disabled ? 'border-slate-100 opacity-60 grayscale cursor-not-allowed' 
                : statusType === 'PASSED' ? 'border-emerald-100 glow-emerald' 
                : statusType === 'WARNING' ? 'border-amber-100 glow-amber'
                : `border-slate-100 hover:border-${color}-200 hover:shadow-lg`
            }`}>
                
                {/* 🏷️ Badge มุมขวาบน */}
                <div className={`absolute top-4 right-4 flex items-center gap-1.5 px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest ${
                  statusType === 'PASSED' ? 'bg-emerald-50 text-emerald-800' :
                  statusType === 'WARNING' ? 'bg-amber-50 text-amber-800 animate-soft-pulse' :
                  statusType === 'BANNED' ? 'bg-red-100 text-red-700' :
                  'bg-slate-50 text-slate-600'
                }`}>
                  {statusType === 'PASSED' && <CheckCircle2 size={10} />}
                  {statusType === 'WARNING' && <AlertTriangle size={10} />}
                  {statusType === 'BANNED' && <Ban size={10} />}
                  {statusType === 'LOCKED' && <Lock size={10} />}
                  {statusType !== 'LOCKED' && statusType}
                </div>
                
                <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-4">
                        <div className={`p-3.5 rounded-2xl shadow-sm transition-all duration-500 ${
                            statusType === 'BANNED' ? 'bg-red-50 text-red-500' :
                            statusType === 'PASSED' ? 'bg-emerald-50 text-emerald-600 shadow-emerald-200' : 
                            disabled ? 'bg-slate-100 text-slate-400' : 
                            `bg-${color}-50 text-${color}-600 group-hover:bg-${color}-600 group-hover:text-white`
                        }`}>
                            {icon}
                        </div>
                        <div className="text-left">
                            <h4 className="font-black text-slate-800 text-sm leading-tight mb-1 uppercase tracking-tight">{title}</h4>
                            <div className={`text-[9px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                                statusType === 'BANNED' ? 'text-red-700' :
                                statusType === 'PASSED' ? 'text-emerald-700' :
                                disabled ? 'text-slate-600' :
                                `text-${color}-700`
                            }`}>
                                {statusType === 'PASSED' ? <CheckCircle2 size={10} /> : 
                                 statusType === 'BANNED' ? <AlertTriangle size={10} /> : 
                                 disabled ? <Lock size={10} /> : 
                                 <div className={`w-2 h-2 rounded-full bg-${color}-500 animate-pulse`}></div>}
                                 
                                {statusType === 'PASSED' ? 'Training Passed' : 
                                 statusType === 'BANNED' ? 'Access Revoked' : 
                                 disabled ? 'Locked Content' : 'Ready to Start'}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex items-end justify-between border-t border-slate-50 pt-4 mt-auto">
                    <div className="text-left">
                        {statusType === 'BANNED' ? (
                             <div className="flex flex-col">
                                 <span className="text-[8px] font-black text-red-700 uppercase tracking-widest">Status</span>
                                 <span className="text-[10px] font-bold text-red-600">Suspended</span>
                             </div>
                        ) : expiryDate ? (
                            <div className="flex flex-col">
                                <span className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Valid Until</span>
                                <span className={`text-[10px] font-bold ${expiryStatus.state === 'EXPIRED' ? 'text-red-700' : isNearExpiry ? 'text-amber-700' : 'text-slate-600'}`}>{new Date(expiryDate).toLocaleDateString(language === 'th' ? 'th-TH' : 'en-US')}</span>
                                <span className={`mt-0.5 text-[9px] font-black ${expiryStatus.state === 'EXPIRED' ? 'text-red-700' : expiryStatus.state === 'URGENT' || expiryStatus.state === 'EXPIRING' ? 'text-amber-700' : 'text-slate-500'}`}>{expiryLabel}</span>
                            </div>
                        ) : (
                            <div className="flex flex-col">
                                <span className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Action Required</span>
                                <span className="text-[10px] font-bold text-slate-600">Step Not Started</span>
                            </div>
                        )}
                    </div>
                    
                    <div className="flex gap-2">
                        {/* ปุ่มสอบใหม่ - ซ่อนถ้าถูกแบน */}
                        {isActive && !isActionDisabled && onRetake && (
                            <button 
                              onClick={(e) => { e.stopPropagation(); onRetake(); }} 
                              className="p-2.5 rounded-xl bg-slate-50 text-slate-400 hover:text-blue-600 hover:bg-blue-50 border border-slate-100 transition-all active:scale-90"
                              title="สอบใหม่ (Retake)"
                            >
                                <RotateCcw size={16} />
                            </button>
                        )}
                        
                        <button 
                          disabled={isActionDisabled}
                          onClick={(e) => { e.stopPropagation(); onClick(); }} 
                          className={`px-5 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center gap-2 transition-all shadow-md active:scale-95 ${
                            statusType === 'BANNED' ? 'bg-red-100 text-red-400 cursor-not-allowed shadow-none' :
                            statusType === 'PASSED' ? 'bg-slate-900 text-white hover:bg-slate-800 shadow-slate-200' : 
                            disabled ? 'bg-slate-100 text-slate-400 cursor-not-allowed shadow-none' : 
                            `bg-${color}-600 text-white hover:bg-${color}-700 shadow-${color}-200`
                          }`}
                        >
                            {statusType === 'BANNED' ? 'Suspended' : buttonText} {!isActive && !isActionDisabled && <ChevronRight size={12} />}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// 💀 Skeleton Loader Component
export const UserPanelSkeleton = () => {
  return (
    <div className="max-w-2xl mx-auto p-4 space-y-8 animate-pulse text-left">
      {/* Hero Skeleton */}
      <div className="relative mt-16">
         <div className="bg-slate-200 h-40 rounded-[2rem] w-full border border-slate-100"></div>
         <div className="absolute -top-12 left-6 w-24 h-24 bg-slate-200 rounded-[1.5rem] border-4 border-white"></div>
         <div className="ml-32 mt-4 space-y-3 absolute top-6">
            <div className="h-6 w-40 bg-slate-200 rounded-full"></div>
            <div className="flex gap-2">
                <div className="h-5 w-24 bg-slate-200 rounded-full"></div>
                <div className="h-5 w-20 bg-slate-200 rounded-full"></div>
            </div>
         </div>
      </div>

      {/* Journey Skeleton */}
      <div className="space-y-4">
         <div className="flex justify-between items-center px-1">
             <div className="h-4 w-32 bg-slate-200 rounded-full"></div>
             <div className="h-6 w-20 bg-slate-200 rounded-full"></div>
         </div>
         <div className="h-40 bg-slate-100 rounded-[2rem] border border-slate-200 p-5 flex flex-col justify-between">
            <div className="flex gap-4">
               <div className="w-12 h-12 bg-slate-200 rounded-2xl"></div>
               <div className="space-y-2 flex-1 pt-1">
                  <div className="h-4 w-1/3 bg-slate-200 rounded-full"></div>
                  <div className="h-3 w-1/4 bg-slate-200 rounded-full"></div>
               </div>
            </div>
            <div className="flex justify-between items-end mt-4">
                <div className="space-y-1">
                    <div className="h-2 w-16 bg-slate-200 rounded-full"></div>
                    <div className="h-3 w-24 bg-slate-200 rounded-full"></div>
                </div>
                <div className="h-10 w-32 bg-slate-200 rounded-xl"></div>
            </div>
         </div>
      </div>
      
      {/* Resources Skeleton */}
      <div className="grid grid-cols-2 gap-4">
          <div className="h-32 bg-slate-100 rounded-[1.5rem] border border-slate-200"></div>
          <div className="h-32 bg-slate-100 rounded-[1.5rem] border border-slate-200"></div>
      </div>
    </div>
  );
};

export default UserPanel;
