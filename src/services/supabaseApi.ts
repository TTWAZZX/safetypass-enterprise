import { supabase } from './supabaseClient'
import { User, Vendor, ExamType, Question, WorkPermitSession, Choice } from '../types'

export const api = {

  /* =====================================================
     1. AUTH & REGISTRATION
  ===================================================== */

  login: async (nationalId: string): Promise<User> => {
    const email = `${nationalId}@safetypass.com`
    const password = nationalId 

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    if (authError) throw new Error('เข้าสู่ระบบไม่สำเร็จ: ' + authError.message)

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*, vendors(*)')
      .eq('id', authData.user?.id)
      .single()

    if (userError || !userData) throw new Error('ไม่พบข้อมูลผู้ใช้งานในระบบ')
    
    return {
      ...userData,
      vendor_id: userData.vendor_id 
    } as unknown as User
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

    // ✅ เพิ่ม Logic ตรวจสอบข้อมูล Placeholder (จากการ Import)
    // ถ้ามีข้อมูลที่ Admin Import ไว้แล้ว ให้ลบออกก่อน เพื่อให้การสมัครสมาชิกสร้างข้อมูลใหม่ที่ผูกกับ Auth ID ได้ถูกต้อง
    const { data: existingUser } = await supabase.from('users').select('id').eq('national_id', nationalId).single();
    if (existingUser) {
        // ลบข้อมูล Placeholder เก่าทิ้ง
        await supabase.from('users').delete().eq('national_id', nationalId);
    }

    const email = `${nationalId}@safetypass.com`
    const password = nationalId 

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { national_id: nationalId, name: name } }
    })

    if (authError) throw new Error(authError.message)
    if (!authData.user) throw new Error('Auth Error')

    // ✅ Insert ข้อมูลใหม่ครบทุกช่อง (Age, Nationality)
    const { data: newUser, error: dbError } = await supabase
      .from('users')
      .insert({
        id: authData.user.id,
        national_id: nationalId,
        name,
        age,            
        nationality,    
        vendor_id: finalVendorId,
        role: 'USER'
      })
      .select('*, vendors(*)')
      .single()

    if (dbError) throw new Error('บันทึก Profile ไม่สำเร็จ: ' + dbError.message)
    return newUser as unknown as User
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
    await supabase.from('vendors')
      .update({ status: 'APPROVED' })
      .eq('id', id)
  },

  rejectVendor: async (id: string) => {
    await supabase.from('vendors')
      .update({ status: 'REJECTED' })
      .eq('id', id)
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

    return Number(data?.value || 0)
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
      .select('id, content_th, content_en, choices_json, type, image_url, correct_choice_index')
      .eq('type', type)
      .eq('is_active', true);

    if (error) {
      console.error("Error fetching questions:", error);
      return [];
    }

    return (data || []).map((q: any) => ({
      id: q.id,
      content_th: q.content_th,
      content_en: q.content_en,
      type: q.type as ExamType,
      image_url: q.image_url,
      correct_choice_index: q.correct_choice_index,
      choices_json: (
        typeof q.choices_json === 'string'
          ? JSON.parse(q.choices_json)
          : q.choices_json
      ) as Choice[]
    } as Question));
  },

  getAllQuestions: async (): Promise<Question[]> => {
    const { data } = await supabase
      .from('questions')
      .select('*')
      .order('created_at', { ascending: false })

    return (data || []).map(q => ({
      ...q,
      choices_json:
        typeof q.choices_json === 'string'
          ? JSON.parse(q.choices_json)
          : q.choices_json
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

  submitExamWithAnswers: async (
    type: ExamType,
    answers: Record<string, number>,
    permitNo?: string
  ) => {
    const { data: questions, error } = await supabase
      .from('questions')
      .select('id, correct_choice_index, choices_json')
      .eq('type', type);

    if (error || !questions) throw new Error('ไม่สามารถดึงข้อมูลข้อสอบได้');

    const config = await api.getSystemSettings();
    const thresholdKey = type === 'INDUCTION' ? 'PASSING_SCORE_INDUCTION' : 'PASSING_SCORE_WORK_PERMIT';
    const threshold = Number(config[thresholdKey] || 80);

    let score = 0;
    questions.forEach((q) => {
      const userChoiceIndex = answers[q.id];
      if (userChoiceIndex !== undefined) {
        const choices = typeof q.choices_json === 'string' ? JSON.parse(q.choices_json) : q.choices_json;
        if (choices[userChoiceIndex]?.is_correct === true || userChoiceIndex === q.correct_choice_index) {
          score++;
        }
      }
    });

    const passedPercent = (score / questions.length) * 100;
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
        created_at,
        exam_type,
        score,
        total_questions,
        status,
        users (
          national_id,
          name,
          age,
          nationality,
          vendors ( name )
        )
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