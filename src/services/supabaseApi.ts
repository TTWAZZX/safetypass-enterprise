import { supabase } from './supabaseClient'
import {
  User, Vendor, ExamType, Question, WorkPermitSession, SupplierOutsourceStatus,
  SupplierOutsourceReportRow, SupplierOutsourceType, SupplierOutsourceWorkType,
  TrainingProgram,
} from '../types'

const createPinPassword = (nationalId: string, pin: string) => `SafetyPass-${nationalId}-${pin}`;

const USER_PROFILE_SELECT = [
  'id', 'national_id', 'name', 'vendor_id', 'role', 'induction_expiry',
  'created_at', 'age', 'nationality', 'pdpa_agreed', 'pdpa_agreed_at',
  'is_active', 'date_of_birth', 'avatar_url', 'last_login', 'vendors(*)',
].join(',');

export const api = {

/* =====================================================
      1. AUTH & REGISTRATION (HYBRID SECURITY MODE 🔒)
  ===================================================== */

  login: async (nationalId: string, pin?: string): Promise<User> => {

    // 🔥 1. PRE-CHECK: ด่านตรวจก่อนเข้า Auth
    // วิ่งไปเช็คในตาราง users ก่อนว่า แอดมินสร้างชื่อคนนี้รอไว้หรือยัง?
    const { data: preCheckUsers, error: preCheckError } = await supabase.rpc('check_user_exists', {
      search_id: nationalId,
    });
    if (preCheckError) throw new Error('ไม่สามารถตรวจสอบสถานะบัญชีได้');

    if (preCheckUsers && preCheckUsers.length > 0) {
      const preCheckUser = preCheckUsers[0];
      // โดนแอดมินแบนตั้งแต่ยังไม่เข้า
      if (preCheckUser.is_active === false) {
         throw new Error('บัญชีของคุณถูกระงับสิทธิ์ชั่วคราว โปรดติดต่อเจ้าหน้าที่ Safety');
      }
      // ✅ ด่านสกัดสำคัญ: แอดมินเพิ่มชื่อให้แล้ว แต่ผู้ใช้ยังไม่เคยกดยอมรับ PDPA
      if (preCheckUser.requires_registration === true) {
         throw new Error('REQUIRE_REGISTER'); // เตะกลับไปหน้า Register อัตโนมัติ
      }
    }

    // 2. ดำเนินการ Login กับ Supabase Auth ตามปกติ (สำหรับคนที่ PDPA = true แล้ว)
    const email = `${nationalId}@safetypass.com`
    const expectedPin = nationalId.slice(-4);
    if (pin && pin !== expectedPin) {
      throw new Error('PIN must match the last four digits of the national ID');
    }
    const password = pin ? createPinPassword(nationalId, pin) : nationalId;

    let { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    // Existing accounts used the national ID as their password. Allow a one-time
    // migration after the user confirms the last four digits, then replace it.
    if (authError && pin) {
      const legacy = await supabase.auth.signInWithPassword({ email, password: nationalId });
      if (!legacy.error) {
        authData = legacy.data;
        authError = null;
        const { error: updateError } = await supabase.auth.updateUser({
          password: createPinPassword(nationalId, pin),
        });
        if (updateError) throw updateError;
      }
    }

    if (authError) {
      // ดักจับคนแปลกหน้าที่ไม่เคยมีในระบบเลย พยายามจะมาล็อกอิน
      if (authError.message.includes('Invalid login credentials')) {
          throw new Error('ไม่พบข้อมูล: กรุณาลงทะเบียนและยอมรับเงื่อนไขก่อนเข้าใช้งาน');
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
      ...userData,
      national_id: realId || userData.national_id, 
      vendor_id: userData.vendor_id 
    } as unknown as User
  },

  checkUser: async (nationalId: string): Promise<any> => {
    const { data, error } = await supabase.rpc('check_user_exists', {
      search_id: nationalId,
    });
      
    if (error) {
        console.error("Check user error:", error);
        return null;
    }
    
    const status = data?.[0] as any;
    if (!status?.user_exists) return null;
    return {
      pdpa_agreed: !status.requires_registration,
      is_active: status.is_active,
    };
  },

  register: async (
    nationalId: string,
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
    const email = `${nationalId}@safetypass.com`;
    const password = createPinPassword(nationalId, nationalId.slice(-4));

    let authUser = null;

    // 1. พยายาม SignUp (สร้างบัญชี Auth)
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } }
    });

    if (signUpError) {
      // ดักจับกรณีเคยลงทะเบียน Auth ไว้แล้ว (Error 422)
      if (signUpError.status === 422 || signUpError.message.includes('already registered') || signUpError.message.includes('User already registered')) {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw new Error('already registered'); 
        authUser = signInData.user;
      } else {
        throw signUpError;
      }
    } else {
      authUser = signUpData.user;
    }

    if (!authUser) throw new Error('ไม่สามารถเชื่อมต่อระบบยืนยันตัวตนได้');

    const registrationArgs = {
      national_id_param: nationalId,
      name_param: name,
      vendor_id_param: vendorId || null,
      age_param: Number.isFinite(age) ? age : null,
      nationality_param: nationality,
      other_vendor_name_param: otherVendorName?.trim() || null,
    };
    const registrationResponse = trainingSelection
      ? await supabase.rpc('complete_registration_v2', {
          ...registrationArgs,
          program_codes_param: trainingSelection.programs,
          participant_type_param: trainingSelection.participantType || null,
          work_type_param: trainingSelection.workType || null,
          access_start_date_param: trainingSelection.accessStartDate || null,
          access_end_date_param: trainingSelection.accessEndDate || null,
        })
      : await supabase.rpc('complete_registration', registrationArgs);
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

  getPendingVendors: async (): Promise<Vendor[]> => {
    const { data } = await supabase
      .from('vendors')
      .select('*')
      .eq('status', 'PENDING')
    return data || []
  },

  approveVendor: async (id: string) => {
    const { error } = await supabase.from('vendors')
      .update({ status: 'APPROVED' })
      .eq('id', id);
    if (error) throw error;
  },

  rejectVendor: async (id: string) => {
    const { error } = await supabase.from('vendors')
      .update({ status: 'REJECTED' })
      .eq('id', id);
    if (error) throw error;
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
    const { error } = await supabase.rpc('admin_save_question', {
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
  },

  updateQuestion: async (id: string, updates: Partial<Question>) => {
    const { error } = await supabase.rpc('admin_save_question', {
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
  },

  deleteQuestion: async (id: string) => {
    const { error } = await supabase.rpc('admin_delete_question', { question_id_param: id })
    if (error) throw error
  },

  /* =====================================================
      5. EXAM SUBMISSION & HISTORY
  ===================================================== */

  deleteUser: async (userId: string) => {
    // Note: ควรใช้ handleDeleteUser ใน VendorManager เพื่อ Cascade Delete
    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', userId);
    if (error) throw error;
    return true;
  },

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
