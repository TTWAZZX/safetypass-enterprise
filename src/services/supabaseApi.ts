import { supabase } from './supabaseClient'
import {
  User, Vendor, ExamType, Question, WorkPermitSession, SupplierOutsourceStatus,
  SupplierOutsourceReportRow, SupplierOutsourceType, SupplierOutsourceWorkType,
  TrainingProgram, QuestionRevision, VendorNameMatch, VendorSaveResult, VendorStatus,
  ExternalRegistrationNotificationRecipient, ExternalRegistrationApplicationRow,
  ExternalRegistrationApplicationDetail,
} from '../types'
import {
  resolveRegistrationStatus, RegistrationStatus, StagedRegistrationProfile,
} from './registrationAccountState'
import {
  getSecurePinError,
} from './pinSecurity'

export interface AuthLoginResult {
  user: User;
  requiresPinUpgrade: boolean;
}

const USER_PROFILE_SELECT = [
  'id', 'national_id', 'name', 'vendor_id', 'role', 'induction_expiry',
  'created_at', 'age', 'nationality', 'pdpa_agreed', 'pdpa_agreed_at',
  'is_active', 'date_of_birth', 'avatar_url', 'last_login', 'vendors(*)',
].join(',');

const getRegistrationStatus = async (nationalId: string): Promise<RegistrationStatus> => {
  const response = await fetch('/api/prepare-staged-auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nationalId, action: 'status' }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error('ไม่สามารถตรวจสอบสถานะบัญชีได้');
  return resolveRegistrationStatus(result?.status);
};

const ensureRegistrationIdentity = async (
  nationalId: string,
  name = '',
  securePin: string,
) => {
  const email = `${nationalId}@safetypass.com`;
  const pinError = getSecurePinError(nationalId, securePin);
  if (pinError) throw new Error(pinError);
  const { data: sessionData } = await supabase.auth.getSession();
  const currentSession = sessionData.session;

  if (currentSession?.user.email?.toLowerCase() === email.toLowerCase()) {
    return currentSession.user;
  }
  if (currentSession) await supabase.auth.signOut();

  const bootstrapBytes = new Uint8Array(32);
  crypto.getRandomValues(bootstrapBytes);
  const bootstrapPassword = `SafetyPass-bootstrap-v2-${Array.from(
    bootstrapBytes,
    (value) => value.toString(16).padStart(2, '0'),
  ).join('')}`;
  const signUp = await supabase.auth.signUp({
    email,
    password: bootstrapPassword,
    options: { data: { name, password_scheme: 'bootstrap-v2', must_change_pin: true } },
  });
  if (!signUp.error && signUp.data.session?.user) return signUp.data.session.user;
  if (signUp.error && /already registered|already exists|user exists/i.test(signUp.error.message)) {
    throw new Error('บัญชีนี้มีอยู่แล้ว กรุณาเข้าสู่ระบบก่อนดำเนินการลงทะเบียน');
  }
  throw signUp.error || new Error('ไม่สามารถเปิดบัญชีสำหรับการลงทะเบียนได้');
};

const ensureStagedRegistrationIdentity = async (nationalId: string) => {
  const email = `${nationalId}@safetypass.com`;
  const { data: sessionData } = await supabase.auth.getSession();
  const currentSession = sessionData.session;
  if (currentSession?.user.email?.toLowerCase() === email.toLowerCase()) {
    return currentSession.user;
  }
  if (currentSession) await supabase.auth.signOut();

  const response = await fetch('/api/prepare-staged-auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nationalId }),
  });
  const prepared = await response.json().catch(() => null);
  if (!response.ok || prepared?.ok !== true
    || typeof prepared.accessToken !== 'string'
    || typeof prepared.refreshToken !== 'string') {
    throw new Error('ไม่สามารถเตรียมบัญชีสำหรับข้อมูลเดิมได้ กรุณาลองใหม่อีกครั้ง');
  }

  const { data: authData, error: authError } = await supabase.auth.setSession({
    access_token: prepared.accessToken,
    refresh_token: prepared.refreshToken,
  });
  if (authError || !authData.user || authData.user.email?.toLowerCase() !== email.toLowerCase()) {
    await supabase.auth.signOut();
    throw new Error('ไม่สามารถยืนยันบัญชีเดิมได้ กรุณาติดต่อเจ้าหน้าที่ Safety');
  }
  return authData.user;
};

const loadAuthenticatedUserProfile = async (userId: string): Promise<User> => {
  const { data: rawUserData, error: userError } = await supabase
    .from('users')
    .select(USER_PROFILE_SELECT)
    .eq('id', userId)
    .single();

  if (userError || !rawUserData) {
    throw new Error('User profile is unavailable');
  }

  const userData = rawUserData as any;
  const { data: realId, error: decryptError } = await supabase.rpc('get_my_decrypted_id');
  if (decryptError) console.error('Decryption failed:', decryptError);

  return {
    ...userData,
    national_id: realId || userData.national_id,
    vendor_id: userData.vendor_id,
  } as User;
};

export const api = {

/* =====================================================
      1. AUTH & REGISTRATION (HYBRID SECURITY MODE 🔒)
  ===================================================== */

  login: async (nationalId: string, pin?: string): Promise<AuthLoginResult> => {

    // 🔥 1. PRE-CHECK: ด่านตรวจก่อนเข้า Auth
    // วิ่งไปเช็คในตาราง users ก่อนว่า แอดมินสร้างชื่อคนนี้รอไว้หรือยัง?
    const registrationStatus = await getRegistrationStatus(nationalId);
    if (registrationStatus.state === 'SUSPENDED') {
      throw new Error('บัญชีของคุณถูกระงับสิทธิ์ชั่วคราว โปรดติดต่อเจ้าหน้าที่ Safety');
    }
    if (registrationStatus.state === 'STAGED') {
      throw new Error('REQUIRE_REGISTER');
    }

    // 2. ดำเนินการ Login กับ Supabase Auth ตามปกติ (สำหรับคนที่ PDPA = true แล้ว)
    if (!pin || !/^\d{4}(?:\d{2})?$/.test(pin)) {
      throw new Error('กรุณากรอก PIN เดิม 4 หลัก หรือ PIN ใหม่ 6 หลัก');
    }

    const response = await fetch('/api/auth-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nationalId, pin }),
    });
    const loginResult = await response.json().catch(() => null);
    let authError: Error | null = response.ok ? null : new Error(loginResult?.message || 'Invalid login credentials');
    let authData: any = { user: null, session: null };
    let requiresPinUpgrade = loginResult?.requiresPinUpgrade === true;

    if (response.ok && typeof loginResult?.accessToken === 'string'
        && typeof loginResult?.refreshToken === 'string') {
      const { data, error } = await supabase.auth.setSession({
        access_token: loginResult.accessToken,
        refresh_token: loginResult.refreshToken,
      });
      if (error || !data.user || !data.session) {
        authError = error || new Error('Invalid authentication session');
      } else {
        authData = data;
      }
    }

    // Some legacy rows can remain fully registered in public.users after their
    // Supabase Auth identity was removed. Prepare a replacement session and let
    // the database atomically re-link only a verified orphaned USER profile.
    if (authError && pin.length === 4 && registrationStatus.state === 'REGISTERED') {
      let repairIdentityCreated = false;
      try {
        const repairedIdentity = await ensureStagedRegistrationIdentity(nationalId);
        repairIdentityCreated = true;
        const { data: repaired, error: repairError } = await supabase.rpc(
          'repair_my_orphaned_registration',
        );
        if (repairError || repaired !== true) throw repairError || new Error('Profile repair failed');

        const { data: repairedSessionData } = await supabase.auth.getSession();
        if (!repairedSessionData.session) throw new Error('Repair session is missing');
        authData = {
          user: repairedIdentity,
          session: repairedSessionData.session,
        };
        authError = null;
        requiresPinUpgrade = true;
      } catch (repairError) {
        if (repairIdentityCreated) await supabase.auth.signOut();
        console.error('Orphaned Auth profile repair failed:', repairError);
      }
    }

    if (authError) {
      // ดักจับคนแปลกหน้าที่ไม่เคยมีในระบบเลย พยายามจะมาล็อกอิน
      if (/Invalid (?:login )?credentials/i.test(authError.message)) {
        if (registrationStatus.state === 'REGISTERED') {
          throw new Error('บัญชีมีข้อมูลในระบบแต่ไม่สามารถยืนยันตัวตนได้ กรุณาติดต่อเจ้าหน้าที่ Safety');
        }
          throw new Error('ไม่พบข้อมูล: กรุณาลงทะเบียนและยอมรับเงื่อนไขก่อนเข้าใช้งาน');
      }
      if (/temporarily locked/i.test(authError.message)) {
        throw new Error('บัญชีถูกล็อกชั่วคราวจากการกรอก PIN ผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่');
      }
      if (/temporary PIN has expired/i.test(authError.message)) {
        throw new Error('PIN ชั่วคราวหมดอายุแล้ว กรุณาติดต่อแอดมินเพื่อรีเซตอีกครั้ง');
      }
      if (/PIN reset is being prepared/i.test(authError.message)) {
        throw new Error('ระบบกำลังเตรียม PIN ชั่วคราว กรุณารอสักครู่แล้วลองใหม่');
      }
      if (/suspended/i.test(authError.message)) {
        throw new Error('บัญชีของคุณถูกระงับสิทธิ์ชั่วคราว โปรดติดต่อเจ้าหน้าที่ Safety');
      }
      throw new Error('เข้าสู่ระบบไม่สำเร็จ: ' + authError.message);
    }

    // 3. ดึงข้อมูล Profile ทั่วไป (จะได้ national_id = "PROTECTED")
    const { data: rawUserData, error: userError } = await supabase
      .from('users')
      .select(USER_PROFILE_SELECT)
      .eq('id', authData.user?.id)
      .single()

    if (userError || !rawUserData) throw new Error('ไม่พบข้อมูลผู้ใช้งานในระบบ')
    const userData = rawUserData as any;

    // 🔥 บล็อกผู้ใช้ที่โดนแบน (ป้องกันเหนียวไว้อีกชั้น)
    if (userData.is_active === false) {
      await supabase.auth.signOut();
      throw new Error('บัญชีของคุณถูกระงับสิทธิ์ชั่วคราว โปรดติดต่อเจ้าหน้าที่ Safety');
    }
    
    // 4. 🔐 SECURE DECRYPT: เรียก RPC เพื่อถอดรหัสเลขบัตรจริงมาแสดงผล
    const { data: realId, error: decryptError } = await supabase.rpc('get_my_decrypted_id');
    
    if (decryptError) console.error("Decryption failed:", decryptError);

    return {
      user: {
        ...userData,
        national_id: realId || userData.national_id,
        vendor_id: userData.vendor_id,
      } as unknown as User,
      requiresPinUpgrade,
    }
  },

  getCurrentUser: async (): Promise<User> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) throw new Error('User session is unavailable');
    return loadAuthenticatedUserProfile(session.user.id);
  },

  upgradeMyPin: async (nationalId: string, securePin: string): Promise<void> => {
    const pinError = getSecurePinError(nationalId, securePin);
    if (pinError) throw new Error(pinError);
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) throw new Error('ไม่พบ session สำหรับเปลี่ยน PIN');
    const response = await fetch('/api/set-auth-pin', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nationalId, pin: securePin }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true
        || typeof result?.accessToken !== 'string' || typeof result?.refreshToken !== 'string') {
      throw new Error(result?.message || 'ไม่สามารถบันทึก PIN ใหม่ได้');
    }
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
    });
    if (sessionError) throw sessionError;
  },

  checkRegistrationStatus: getRegistrationStatus,

  prepareStagedRegistration: async (nationalId: string): Promise<StagedRegistrationProfile> => {
    await ensureStagedRegistrationIdentity(nationalId);
    const { data, error } = await supabase.rpc('get_my_staged_registration_profile');
    if (error) {
      if (error.message.includes('suspended')) {
        throw new Error('บัญชีของคุณถูกระงับสิทธิ์ชั่วคราว โปรดติดต่อเจ้าหน้าที่ Safety');
      }
      throw new Error('ไม่สามารถดึงข้อมูลที่บริษัทเตรียมไว้ได้');
    }
    if (!data) throw new Error('ไม่พบข้อมูลที่รอเปิดบัญชี กรุณาตรวจสอบเลขบัตรอีกครั้ง');
    return data as StagedRegistrationProfile;
  },

  register: async (
    nationalId: string,
    securePin: string,
    name: string,
    vendorId: string | null, // เปลี่ยนให้รองรับ null
    age: number,
    nationality: string,
    otherVendorName?: string,
    trainingSelection?: {
      programs: TrainingProgram[];
      participantType?: SupplierOutsourceType;
      workType?: SupplierOutsourceWorkType;
      accessStartDate?: string;
      accessEndDate?: string;
    }
  ): Promise<User> => {
    const authUser = await ensureRegistrationIdentity(nationalId, name, securePin);

    if (!authUser) throw new Error('ไม่สามารถเชื่อมต่อระบบยืนยันตัวตนได้');

    const registrationArgs = {
      national_id_param: nationalId,
      name_param: name,
      vendor_id_param: vendorId || null,
      age_param: Number.isFinite(age) ? age : null,
      nationality_param: nationality,
      other_vendor_name_param: otherVendorName?.trim() || null,
    };
    const registrationResponse = await supabase.rpc('complete_registration_v4', {
      ...registrationArgs,
      program_codes_param: trainingSelection?.programs || ['CONTRACTOR'],
      participant_type_param: trainingSelection?.participantType || null,
      work_type_param: trainingSelection?.workType || null,
      access_start_date_param: trainingSelection?.accessStartDate || null,
      access_end_date_param: trainingSelection?.accessEndDate || null,
    });
    const { data: registeredUser, error: registrationError } = registrationResponse;

    if (registrationError) {
      if (registrationError.message.includes('already registered')) {
        await supabase.auth.signOut();
        throw new Error('already registered');
      }
      if (registrationError.message.includes('suspended')) {
        throw new Error('บัญชีของคุณถูกระงับสิทธิ์ชั่วคราว โปรดติดต่อเจ้าหน้าที่ Safety');
      }
      throw new Error('ลงทะเบียนไม่สำเร็จ: ' + registrationError.message);
    }

    await api.upgradeMyPin(nationalId, securePin);

    return { ...registeredUser, national_id: nationalId } as unknown as User;
  },

  /* =====================================================
      2. VENDOR MANAGEMENT
  ===================================================== */

  getVendors: async (): Promise<Vendor[]> => {
    const { data, error } = await supabase.rpc('get_public_registration_vendors');
    if (error) throw error;
    return (data || []) as Vendor[];
  },

  findVendorNameMatches: async (name: string, excludeVendorId?: string | null): Promise<VendorNameMatch[]> => {
    const { data, error } = await supabase.rpc('find_vendor_name_matches', {
      search_name_param: name,
      exclude_vendor_id_param: excludeVendorId || null,
      limit_param: 5,
    });
    if (error) throw error;
    return (data || []) as VendorNameMatch[];
  },

  adminSaveVendor: async (input: {
    id?: string | null;
    name: string;
    status?: VendorStatus | 'PENDING' | 'APPROVED' | 'REJECTED';
    allowSimilar?: boolean;
  }): Promise<VendorSaveResult> => {
    const { data, error } = await supabase.rpc('admin_save_vendor', {
      vendor_id_param: input.id || null,
      name_param: input.name,
      status_param: input.status || 'PENDING',
      allow_similar_param: input.allowSimilar === true,
    });
    if (error) throw error;
    return data as VendorSaveResult;
  },

  getVendorDuplicateGroups: async () => {
    const { data, error } = await supabase.rpc('admin_get_vendor_duplicate_groups');
    if (error) throw error;
    return (data || []) as Array<{
      normalized_name: string;
      vendor_count: number;
      vendors: Array<Pick<Vendor, 'id' | 'name' | 'status' | 'created_at'>>;
    }>;
  },

  adminArchiveVendor: async (id: string) => {
    const { data, error } = await supabase.rpc('admin_archive_vendor', {
      vendor_id_param: id,
    });
    if (error) throw error;
    return data as { archived: boolean; links_preserved: boolean; already_rejected: boolean };
  },

  adminArchiveUser: async (id: string) => {
    const { data, error } = await supabase.rpc('admin_archive_user', {
      user_id_param: id,
    });
    if (error) throw error;
    return data as { archived: boolean; history_preserved: boolean; already_inactive: boolean };
  },

  adminResetUserPin: async (id: string): Promise<{ expiresAt: string }> => {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) throw new Error('ไม่พบ session ของผู้ดูแลระบบ');

    const response = await fetch('/api/admin-reset-user-pin', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId: id }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true || typeof result?.expiresAt !== 'string') {
      throw new Error(result?.message || 'ไม่สามารถรีเซต PIN ได้');
    }
    return { expiresAt: result.expiresAt };
  },

  /* =====================================================
      3. SYSTEM SETTINGS (FIXED: UPSERT ✅)
  ===================================================== */

  getSystemSettings: async () => {
    const { data, error } = await supabase.rpc('get_runtime_system_settings');
    if (error) throw error;
    const config: Record<string, string> = {};
    data?.forEach((item: any) => {
      config[item.key] = item.value;
    });
    return config;
  },

  getPublicSupportLinks: async () => {
    const { data, error } = await supabase.rpc('get_public_support_links');
    if (error) throw error;
    const links = data?.[0];
    return {
      manualUrl: String(links?.manual_url || ''),
      supportUrl: String(links?.support_url || ''),
    };
  },

  getPublicFeatureFlags: async () => {
    const { data, error } = await supabase.rpc('get_public_feature_flags');
    if (error) return { supplierOutsourceEnabled: false };
    return { supplierOutsourceEnabled: Boolean(data?.[0]?.supplier_outsource_enabled) };
  },

  getPassingScore: async (key: string) => {
    const settings = await api.getSystemSettings();
    return Number(settings[key] || 80);
  },

  // ✅ ฟังก์ชันพระเอก: ใช้ upsert เพื่อ "สร้างใหม่" หรือ "อัปเดต" ในคำสั่งเดียว
  updateSystemSetting: async (key: string, value: number | string) => {
    const { error } = await supabase.rpc('admin_update_system_setting', {
      key_param: key,
      value_param: String(value),
    });
    if (error) throw error;
  },

  getExternalRegistrationEmailSettings: async () => {
    const [{ data: recipients, error: recipientsError }, { data: enabled, error: enabledError }] = await Promise.all([
      supabase.rpc('admin_get_external_registration_notification_recipients'),
      supabase.rpc('get_external_registration_feature_flag'),
    ]);
    if (recipientsError) throw recipientsError;
    if (enabledError) throw enabledError;
    return {
      senderEmail: 'safetytsh@gmail.com',
      enabled: Boolean(enabled),
      recipients: (recipients || []) as ExternalRegistrationNotificationRecipient[],
    };
  },

  saveExternalRegistrationEmailRecipient: async (payload: {
    id?: string | null;
    displayName?: string;
    email: string;
    isActive: boolean;
  }) => {
    const { data, error } = await supabase.rpc('admin_save_external_registration_notification_recipient', {
      recipient_id_param: payload.id || null,
      display_name_param: payload.displayName?.trim() || null,
      email_param: payload.email.trim(),
      is_active_param: payload.isActive,
    });
    if (error) throw error;
    return String(data);
  },

  removeExternalRegistrationEmailRecipient: async (id: string) => {
    const { error } = await supabase.rpc('admin_remove_external_registration_notification_recipient', {
      recipient_id_param: id,
    });
    if (error) throw error;
  },

  setExternalRegistrationFeature: async (enabled: boolean) => {
    const { error } = await supabase.rpc('admin_set_external_registration_feature', {
      enabled_param: enabled,
    });
    if (error) throw error;
  },

  getExternalRegistrationApplications: async (filters: { status?: string; search?: string } = {}): Promise<ExternalRegistrationApplicationRow[]> => {
    const { data, error } = await supabase.rpc('admin_get_external_access_applications', {
      status_param: filters.status || null,
      search_param: filters.search?.trim() || null,
      limit_param: 200,
      offset_param: 0,
    });
    if (error) throw error;
    return (data || []) as ExternalRegistrationApplicationRow[];
  },

  getExternalRegistrationApplication: async (id: string): Promise<ExternalRegistrationApplicationDetail> => {
    const { data, error } = await supabase.rpc('admin_get_external_access_application', {
      application_id_param: id,
    });
    if (error) throw error;
    return data as ExternalRegistrationApplicationDetail;
  },

  getExternalRegistrationVendors: async (): Promise<Array<{ id: string; name: string; status: VendorStatus }>> => {
    const { data, error } = await supabase.rpc('admin_get_external_registration_vendors');
    if (error) throw error;
    return (data || []) as Array<{ id: string; name: string; status: VendorStatus }>;
  },

  resolveExternalRegistrationApplication: async (input: {
    applicationId: string;
    action: 'APPROVED' | 'REJECTED' | 'NEED_MORE_INFO' | 'UNDER_REVIEW';
    vendorId?: string | null;
    newCompanyStatus?: 'PENDING' | 'APPROVED';
    adminNote?: string;
    rejectionReason?: string;
  }) => {
    const { data, error } = await supabase.rpc('admin_resolve_external_access_application', {
      application_id_param: input.applicationId,
      action_param: input.action,
      vendor_id_param: input.vendorId || null,
      new_company_status_param: input.newCompanyStatus || 'PENDING',
      admin_note_param: input.adminNote?.trim() || null,
      rejection_reason_param: input.rejectionReason?.trim() || null,
    });
    if (error) throw error;
    return data as { saved: boolean; application_id: string; request_no: string; status: string };
  },

  sendExternalRegistrationResultEmail: async (applicationId: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('ไม่พบ Session ของ Admin');
    const response = await fetch('/api/send-external-registration-result', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ applicationId }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.message || 'ไม่สามารถส่ง Email ผลคำขอได้');
    return result as { success: boolean; sent: number; failures?: Array<{ recipient: string; message: string }> };
  },

  deleteExternalRegistrationApplication: async (applicationId: string, reason?: string) => {
    const { data, error } = await supabase.rpc('admin_delete_external_access_application', {
      application_id_param: applicationId,
      delete_reason_param: reason?.trim() || null,
    });
    if (error) throw error;
    return data as { deleted: boolean; application_id: string; request_no: string; status: string };
  },
  
  // ✅ ปรับปรุง: ให้เรียกใช้ updateSystemSetting แทน เพื่อความชัวร์
  updatePassingScore: async (key: string, value: number) => {
    await api.updateSystemSetting(key, value);
  },

  /* =====================================================
      4. QUESTIONS CRUD
  ===================================================== */

  getQuestions: async (type: ExamType): Promise<Question[]> => {
    const { data, error } = await supabase
      .rpc('get_exam_questions', { exam_type_param: type });

    if (error) return [];

    return (data || []).map((q: any) => {
      let choices = typeof q.choices_json === 'string' ? JSON.parse(q.choices_json) : q.choices_json;

      // 🔒 Strip เฉลยออกก่อนส่งให้ client — ป้องกันการเปิด DevTools ดูเฉลย
      if (Array.isArray(choices)) {
        choices = choices.map((c: any) => {
          const { is_correct, correct_answer, ...safeChoice } = c;
          return safeChoice;
        });
      }

      return { ...q, choices_json: choices } as Question;
    });
  },

  getAllQuestions: async (): Promise<Question[]> => {
    const { data } = await supabase
      .from('questions')
      .select('*')
      .order('created_at', { ascending: false })

    return (data || []).map(q => ({
      ...q,
      choices_json: typeof q.choices_json === 'string' ? JSON.parse(q.choices_json) : q.choices_json
    })) as Question[]
  },

  createQuestion: async (question: Partial<Question>) => {
    const { data, error } = await supabase.rpc('admin_save_question', {
      question_id_param: null,
      exam_type_param: question.type,
      pattern_param: question.pattern,
      content_th_param: question.content_th,
      content_en_param: question.content_en,
      choices_json_param: question.choices_json,
      correct_choice_index_param: question.correct_choice_index ?? 0,
      image_url_param: question.image_url || null,
      is_active_param: question.is_active ?? true,
    })
    if (error) throw error
    return data as string
  },

  updateQuestion: async (id: string, updates: Partial<Question>) => {
    const { data, error } = await supabase.rpc('admin_save_question', {
      question_id_param: id,
      exam_type_param: updates.type,
      pattern_param: updates.pattern,
      content_th_param: updates.content_th,
      content_en_param: updates.content_en,
      choices_json_param: updates.choices_json,
      correct_choice_index_param: updates.correct_choice_index ?? 0,
      image_url_param: updates.image_url || null,
      is_active_param: updates.is_active ?? true,
    })
    if (error) throw error
    return data as string
  },

  getQuestionRevisions: async (questionId: string) => {
    const { data, error } = await supabase.rpc('admin_get_question_revisions', {
      question_id_param: questionId,
    })
    if (error) throw error
    return (data || []) as QuestionRevision[]
  },

  restoreQuestionRevision: async (questionId: string, revisionId: string) => {
    const { data, error } = await supabase.rpc('admin_restore_question_revision', {
      question_id_param: questionId,
      revision_id_param: revisionId,
    })
    if (error) throw error
    return data as string
  },

  deleteQuestion: async (id: string) => {
    const { error } = await supabase.rpc('admin_delete_question', { question_id_param: id })
    if (error) throw error
  },

  /* =====================================================
      5. EXAM SUBMISSION & HISTORY
  ===================================================== */

  submitExamWithAnswers: async (
    type: ExamType,
    answers: Record<string, any>,
    permitNo?: string
  ) => {
    const { data, error: rpcError } = await supabase.rpc('submit_safety_exam', {
      exam_type_param: type,
      answers_param: answers,
      permit_no_param: permitNo || null,
    });
    if (rpcError) throw rpcError;
    return data as {
      score: number;
      passed: boolean;
      perQuestion: Record<string, boolean>;
      verificationToken?: string | null;
      expiresAt?: string | null;
    };
  },

  addMySupplierOutsourceAccess: async (selection: {
    participantType: SupplierOutsourceType;
    workType: SupplierOutsourceWorkType;
    accessStartDate?: string;
    accessEndDate?: string;
  }) => {
    const { error } = await supabase.rpc('add_my_supplier_outsource_access', {
      participant_type_param: selection.participantType,
      work_type_param: selection.workType,
      access_start_date_param: selection.accessStartDate || null,
      access_end_date_param: selection.accessEndDate || null,
    });
    if (error) throw error;
  },

  getMySupplierOutsourceStatus: async (): Promise<SupplierOutsourceStatus | null> => {
    const { data, error } = await supabase.rpc('get_my_supplier_outsource_status');
    if (error) throw error;
    return (data?.[0] as SupplierOutsourceStatus | undefined) || null;
  },

  linkMyLineIdentity: async (lineUserId: string) => {
    const { error } = await supabase.rpc('link_my_line_identity', { line_user_id_param: lineUserId });
    if (error) throw error;
  },

  getSupplierOutsourceReport: async (): Promise<SupplierOutsourceReportRow[]> => {
    const { data, error } = await supabase.rpc('admin_supplier_outsource_report');
    if (error) throw error;
    return (data || []) as SupplierOutsourceReportRow[];
  },

  adminSetSupplierOutsourceAccess: async (payload: {
    userId: string;
    enabled: boolean;
    participantType?: SupplierOutsourceType;
    workType?: SupplierOutsourceWorkType;
    accessStartDate?: string;
    accessEndDate?: string;
  }) => {
    const { error } = await supabase.rpc('admin_set_supplier_outsource_access', {
      user_id_param: payload.userId,
      enabled_param: payload.enabled,
      participant_type_param: payload.participantType || null,
      work_type_param: payload.workType || null,
      access_start_date_param: payload.accessStartDate || null,
      access_end_date_param: payload.accessEndDate || null,
    });
    if (error) throw error;
  },

  adminSetSupplierOutsourceAccessBulk: async (payload: {
    userIds: string[];
    participantType: SupplierOutsourceType;
    workType: SupplierOutsourceWorkType;
    accessStartDate?: string;
    accessEndDate?: string;
  }): Promise<number> => {
    const { data, error } = await supabase.rpc('admin_set_supplier_outsource_access_bulk', {
      user_ids_param: payload.userIds,
      participant_type_param: payload.participantType,
      work_type_param: payload.workType,
      access_start_date_param: payload.accessStartDate || null,
      access_end_date_param: payload.accessEndDate || null,
    });
    if (error) throw error;
    return Number(data || 0);
  },

  getSupplierOutsourceLaunchStatus: async () => {
    const { data, error } = await supabase.rpc('admin_get_supplier_outsource_launch_status');
    if (error) throw error;
    return {
      enabled: Boolean(data?.[0]?.enabled),
      activeQuestionCount: Number(data?.[0]?.active_question_count || 0),
    };
  },

  setSupplierOutsourceFeature: async (enabled: boolean) => {
    const { error } = await supabase.rpc('admin_set_supplier_outsource_feature', { enabled_param: enabled });
    if (error) throw error;
  },

  /* =====================================================
      6. ADMIN DASHBOARD & STATS (DATA EXPORT FIXED ✅)
  ===================================================== */

  getDashboardStats: async () => {
    const { count: users } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const { count: vendors } = await supabase.from('vendors').select('*', { count: 'exact', head: true }).eq('status', 'PENDING');
    const { count: permits } = await supabase.from('work_permits').select('*', { count: 'exact', head: true }).gt('expire_date', new Date().toISOString());

    let { data: history } = await supabase.from('exam_history').select('status, exam_type');

    if (!history || history.length === 0) {
      const { data: logs } = await supabase.from('exam_logs').select('passed, exam_type');
      history = logs?.map(l => ({
        status: l.passed ? 'PASSED' : 'FAILED',
        exam_type: l.exam_type
      })) || [];
    }

    const passed = history.filter(l => l.status === 'PASSED').length;
    const failed = history.filter(l => l.status === 'FAILED').length;
    const induction = history.filter(l => l.exam_type === 'INDUCTION').length;
    const wp = history.filter(l => l.exam_type === 'WORK_PERMIT').length;
    const supplierOutsource = history.filter(l => l.exam_type === 'SUPPLIER_OUTSOURCE').length;

    return {
      totalUsers: users || 0,
      pendingVendors: vendors || 0,
      activePermits: permits || 0,
      examSummary: [
        { name: 'Passed', value: passed },
        { name: 'Failed', value: failed }
      ],
      activityVolume: [
        { name: 'Induction', value: induction },
        { name: 'Work Permit', value: wp },
        { name: 'Supplier & Outsource', value: supplierOutsource }
      ]
    };
  },

  getAllExamHistory: async () => {
    const { data, error } = await supabase.rpc('admin_get_exam_history');
      
    if (error) throw error;
    return data;
  },

  getExamHistoryPage: async (params: {
    page: number;
    pageSize: number;
    search?: string;
    examType?: string;
    status?: string;
    date?: string;
  }): Promise<{ rows: any[]; total: number }> => {
    const { data, error } = await supabase.rpc('admin_get_exam_history_page', {
      p_page: params.page,
      p_page_size: params.pageSize,
      p_search: params.search || null,
      p_exam_type: params.examType && params.examType !== 'ALL' ? params.examType : null,
      p_status: params.status && params.status !== 'ALL' ? params.status : null,
      p_date: params.date || null,
    });
    if (error) throw error;
    const result = (data || {}) as { rows?: any[]; total?: number };
    return { rows: result.rows || [], total: Number(result.total || 0) };
  },

  getDashboardSummary: async (): Promise<{
    total: number;
    passed: number;
    failed: number;
    suspended: number;
    compliance: { noCert: number; expired: number; expiring: number };
    barData: any[];
    trendData: any[];
    vendorData: any[];
  }> => {
    const { data, error } = await supabase.rpc('admin_get_dashboard_summary');
    if (error) throw error;
    const result = (data || {}) as any;
    return {
      total: Number(result.total || 0),
      passed: Number(result.passed || 0),
      failed: Number(result.failed || 0),
      suspended: Number(result.suspended || 0),
      compliance: {
        noCert: Number(result.compliance?.noCert || 0),
        expired: Number(result.compliance?.expired || 0),
        expiring: Number(result.compliance?.expiring || 0),
      },
      barData: result.barData || [],
      trendData: result.trendData || [],
      vendorData: result.vendorData || [],
    };
  },

  getDirectoryPage: async (params: {
    section: 'USERS' | 'VENDORS' | 'LOGS';
    page: number;
    pageSize: number;
    search?: string;
    vendorFilter?: string;
    certFilter?: string;
  }): Promise<{ rows: any[]; total: number; stats: any | null }> => {
    const { data, error } = await supabase.rpc('admin_get_directory_page', {
      p_section: params.section,
      p_page: params.page,
      p_page_size: params.pageSize,
      p_search: params.search || null,
      p_vendor_filter: params.vendorFilter || null,
      p_cert_filter: params.certFilter || null,
    });
    if (error) throw error;
    const result = (data || {}) as { rows?: any[]; total?: number; stats?: any };
    return {
      rows: result.rows || [],
      total: Number(result.total || 0),
      stats: result.stats || null,
    };
  },

  // ✅ แก้ไข: ลบคอมเมนต์ภาษาไทยออก (สำคัญมาก)
  getReportData: async () => {
    const { data, error } = await supabase.rpc('admin_get_exam_history');

    if (error) {
        console.error("Report Fetch Error:", error); // เพิ่ม log เพื่อดู error ชัดๆ
        return [];
    }

    return (data || []).map((log: any) => ({
      timestamp: log.created_at,
      national_id: log.users?.national_id || '-',
      name: log.users?.name || '-',
      age: log.users?.age || '-',
      nationality: log.users?.nationality || '-',
      vendor: log.users?.vendors?.name || '-',
      exam_type: log.exam_type,
      score: `${log.score}/${log.total_questions}`,
      result: log.status
    }));
  },

  getDailyStats: async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { data, error } = await supabase
      .from('exam_history')
      .select('status')
      .gte('created_at', today.toISOString());
    if (error) throw error;

    const total = data?.length || 0;
    const passed = data?.filter(d => d.status === 'PASSED').length || 0;
    const failed = total - passed;

    return { total, passed, failed };
  },

  logNotificationFailure: async (payload: {
    user_id: string;
    exam_type: string;
    error_message: string;
    context?: string;
  }) => {
    // บันทึก LINE notification failure ลงตาราง exam_logs ในฟิลด์ extra
    // หรือถ้ามีตาราง audit_logs ก็ insert ได้เลย
    try {
      await supabase.from('exam_logs').insert({
        user_id: payload.user_id,
        exam_type: payload.exam_type,
        score: -1,           // ค่า sentinel บอกว่านี่คือ notification log ไม่ใช่ผลสอบ
        passed: false,
        note: `LINE_NOTIFY_FAILED: ${payload.error_message}${payload.context ? ' | ' + payload.context : ''}`
      });
    } catch {
      // ถ้า log ไม่สำเร็จก็ไม่ควร throw ออกไปรบกวน UX
    }
  },

  getActiveWorkPermit: async (userId: string): Promise<WorkPermitSession | null> => {
    const { data } = await supabase
      .from('work_permits')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'ACTIVE') // 🔥 เพิ่มบรรทัดนี้: บังคับให้ดึงเฉพาะใบที่ถูกระบุว่า ACTIVE เท่านั้น
      .gt('expire_date', new Date().toISOString())
      .order('created_at', { ascending: false }) 
      .limit(1)
      .maybeSingle()
    return data || null
  }
}
