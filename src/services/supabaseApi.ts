import { supabase } from './supabaseClient'
import { User, Vendor, ExamType, Question, WorkPermitSession, Choice } from '../types'

export const api = {

  /* =====================================================
     1. AUTH & REGISTRATION (SECURE MODE 🔒)
  ===================================================== */

  login: async (nationalId: string): Promise<User> => {
    const email = `${nationalId}@safetypass.com`
    const password = nationalId 

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    if (authError) throw new Error('เข้าสู่ระบบไม่สำเร็จ: ' + authError.message)

    // 1. ดึงข้อมูล Profile ทั่วไป (จะได้ national_id = "PROTECTED")
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*, vendors(*)')
      .eq('id', authData.user?.id)
      .single()

    if (userError || !userData) throw new Error('ไม่พบข้อมูลผู้ใช้งานในระบบ')
    
    // 2. 🔐 SECURE DECRYPT: เรียก RPC เพื่อถอดรหัสเลขบัตรจริงมาแสดงผล
    const { data: realId, error: decryptError } = await supabase.rpc('get_my_decrypted_id');
    
    if (decryptError) console.error("Decryption failed:", decryptError);

    return {
      ...userData,
      national_id: realId || userData.national_id, 
      vendor_id: userData.vendor_id 
    } as unknown as User
  },

  checkUser: async (nationalId: string) => {
    const { data, error } = await supabase
      .rpc('check_user_exists', { search_id: nationalId })
      .maybeSingle();
      
    if (error) {
        console.error("Check user error:", error);
        return null;
    }
    
    const userData = data as any;

    if (userData && userData.vendor_id) {
        const { data: vendor } = await supabase.from('vendors').select('name').eq('id', userData.vendor_id).single();
        return { ...userData, vendors: vendor };
    }
    
    return userData;
  },

  register: async (
    nationalId: string,
    name: string,
    vendorId: string,
    age: number,
    nationality: string,
    otherVendorName?: string
  ): Promise<User> => {

    let finalVendorId = vendorId
    if (otherVendorName) {
      const { data: newVendor, error: vError } = await supabase
        .from('vendors').insert({ name: otherVendorName, status: 'PENDING' }).select().single()
      if (vError) throw new Error('สร้างบริษัทไม่สำเร็จ: ' + vError.message)
      finalVendorId = newVendor.id
    }

    // ---------------------------------------------------------
    // ✅ 1. ตรวจสอบข้อมูลที่ Admin Import ไว้ก่อนหน้า (Conflict Check)
    // ---------------------------------------------------------
    const { data: existingUser } = await supabase
        .rpc('check_user_exists', { search_id: nationalId })
        .maybeSingle();

    const email = `${nationalId}@safetypass.com`
    const password = nationalId 

    let authUser = null;
    
    // 2. ลองสมัครบัญชี Auth
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { national_id: nationalId, name: name } }
    });

    if (signUpError) {
        // ถ้าบัญชีมีอยู่แล้ว (เช่น Admin เคยลงทะเบียนให้ หรือเคยกดสมัครแล้ว) ให้ทำการ Sign In แทน
        if (signUpError.status === 422 || signUpError.message.includes('already registered')) {
            const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
                email,
                password
            });
            if (signInError) throw new Error('บัญชีนี้ถูกใช้งานแล้ว แต่รหัสผ่านไม่ถูกต้อง');
            authUser = signInData.user;
        } else {
            throw new Error(signUpError.message);
        }
    } else {
        authUser = signUpData.user;
    }

    if (!authUser) throw new Error('ไม่สามารถเชื่อมต่อระบบยืนยันตัวตนได้');

    // ---------------------------------------------------------
    // ✅ 3. ใช้ upsert โดยอ้างอิงจาก national_id_hash (Fix Duplicate Key)
    // ---------------------------------------------------------
    const payload: any = {
      name,
      national_id: nationalId,
      age,             
      nationality,    
      vendor_id: finalVendorId,
      role: 'USER',
      pdpa_agreed: true,
      pdpa_agreed_at: new Date().toISOString()
    };

    // ถ้า Admin Import ข้อมูลไว้แล้ว ให้ใช้ ID เดิมของพนักงานคนนั้นเพื่อ Update ทับ
    if (existingUser && (existingUser as any).id) {
        payload.id = (existingUser as any).id;
    } else {
        payload.id = authUser.id;
    }

    const { data: newUser, error: dbError } = await supabase
      .from('users')
      .upsert(payload, { onConflict: 'national_id_hash' }) 
      .select('*, vendors(*)')
      .single()

    if (dbError) {
        console.error("Database Upsert Error:", dbError);
        throw new Error('ลงทะเบียนไม่สำเร็จ: ' + dbError.message);
    }
    
    return { ...newUser, national_id: nationalId } as unknown as User
  },

  /* =====================================================
     2. VENDOR MANAGEMENT
  ===================================================== */

  getVendors: async (): Promise<Vendor[]> => {
    const { data } = await supabase
      .from('vendors')
      .select('*')
      .eq('status', 'APPROVED')
      .order('name')
    return data || []
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
     3. SYSTEM SETTINGS
  ===================================================== */

  getSystemSettings: async () => {
    const { data } = await supabase.from('system_config').select('*');
    const config: Record<string, string> = {};
    data?.forEach((item: any) => {
      config[item.key] = item.value;
    });
    return config;
  },

  getPassingScore: async (key: string) => {
    const { data } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', key)
      .single()
    return Number(data?.value || 80) // Default 80
  },

  updateSystemSetting: async (key: string, value: number) => {
    await supabase
      .from('system_config')
      .upsert({ key, value: value.toString() })
  },
  
  updatePassingScore: async (key: string, value: number) => {
    await supabase
      .from('system_config')
      .update({ value: value.toString() })
      .eq('key', key)
  },

  /* =====================================================
     4. QUESTIONS CRUD
  ===================================================== */

  getQuestions: async (type: ExamType): Promise<Question[]> => {
    const { data, error } = await supabase
      .from('questions')
      .select('*') 
      .eq('type', type)
      .eq('is_active', true);

    if (error) return [];

    return (data || []).map((q: any) => ({
      ...q,
      choices_json: typeof q.choices_json === 'string' ? JSON.parse(q.choices_json) : q.choices_json
    } as Question));
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
    const { error } = await supabase.from('questions').insert(question)
    if (error) throw error
  },

  updateQuestion: async (id: string, updates: Partial<Question>) => {
    const { error } = await supabase.from('questions').update(updates).eq('id', id)
    if (error) throw error
  },

  deleteQuestion: async (id: string) => {
    const { error } = await supabase.from('questions').delete().eq('id', id)
    if (error) throw error
  },

  /* =====================================================
     5. EXAM SUBMISSION & HISTORY
  ===================================================== */

  deleteUser: async (userId: string) => {
    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', userId);
    if (error) throw error;
    return true;
  },

  submitExamResult: async (
    type: ExamType,
    score: number,
    totalQuestions: number,
    passed: boolean,
    permitNo?: string
  ) => {
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      await supabase.from('exam_history').insert([{
        user_id: user.id,
        exam_type: type,
        score: score,
        total_questions: totalQuestions,
        status: passed ? 'PASSED' : 'FAILED'
      }]);

      await supabase.from('exam_logs').insert({ 
        user_id: user.id, 
        exam_type: type, 
        score, 
        passed 
      });
      
      if (passed) {
        if (type === 'INDUCTION') {
          const nextYear = new Date();
          nextYear.setFullYear(nextYear.getFullYear() + 1);
          await supabase.from('users').update({ induction_expiry: nextYear.toISOString() }).eq('id', user.id);
        } else if (type === 'WORK_PERMIT') {
          const expireDate = new Date();
          expireDate.setDate(expireDate.getDate() + 5); 
          await supabase.from('work_permits').insert([{
            user_id: user.id,
            permit_no: permitNo || `WP-${Date.now().toString().slice(-6)}`,
            expire_date: expireDate.toISOString(),
            status: 'ACTIVE'
          }]);
        }
      }
    }
    return { success: true };
  },

  // ✅ ฟังก์ชันคำนวณคะแนนและบันทึกผล
  submitExamWithAnswers: async (
    type: ExamType,
    answers: Record<string, any>, 
    permitNo?: string
  ) => {
    const { data: questions, error } = await supabase
      .from('questions')
      .select('*')
      .eq('type', type);

    if (error || !questions) throw new Error('ไม่สามารถดึงข้อมูลข้อสอบได้');

    const config = await api.getSystemSettings();
    const thresholdKey = type === 'INDUCTION' ? 'PASSING_SCORE_INDUCTION' : 'PASSING_SCORE_WORK_PERMIT';
    
    // ✅ Fix: Default Passing Score เป็น 80 หากดึงค่าไม่ได้ ป้องกันปัญหา 2/2 Failed
    const threshold = Number(config[thresholdKey] || 80);

    let score = 0;
    questions.forEach((q) => {
      const userAns = answers[q.id];
      if (userAns === undefined) return;

      const choices = typeof q.choices_json === 'string' ? JSON.parse(q.choices_json) : q.choices_json;

      if (q.pattern === 'SHORT_ANSWER') {
          const correctText = choices[0]?.correct_answer?.toLowerCase().trim();
          if (userAns.toString().toLowerCase().trim() === correctText) score++;
      } 
      else if (q.pattern === 'MATCHING') {
          const isAllCorrect = choices.every((p: any, idx: number) => userAns[idx] === idx);
          if (isAllCorrect) score++;
      }
      else {
          // Check for MC, T/F
          if (choices[userAns]?.is_correct === true || userAns === q.correct_choice_index) score++;
      }
    });

    const passedPercent = questions.length > 0 ? (score / questions.length) * 100 : 0;
    // ✅ Fix: ใช้ >= เพื่อให้ 80% พอดีก็ถือว่าผ่าน
    const passed = passedPercent >= threshold; 
    
    await api.submitExamResult(type, score, questions.length, passed, permitNo);

    return { score, passed };
  },

  /* =====================================================
     6. ADMIN DASHBOARD & STATS
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
        { name: 'Work Permit', value: wp }
      ]
    };
  },

  getAllExamHistory: async () => {
    const { data, error } = await supabase
      .from('exam_history')
      .select(`*, users (name, national_id, vendors (name))`)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  getReportData: async () => {
    const { data, error } = await supabase
      .from('exam_history')
      .select(`
        created_at, exam_type, score, total_questions, status,
        users ( national_id, name, age, nationality, vendors ( name ) )
      `)
      .order('created_at', { ascending: false });

    if (error) return [];

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

  getActiveWorkPermit: async (userId: string): Promise<WorkPermitSession | null> => {
    const { data } = await supabase
      .from('work_permits')
      .select('*')
      .eq('user_id', userId)
      .gt('expire_date', new Date().toISOString())
      .limit(1)
      .maybeSingle()
    return data || null
  }
}