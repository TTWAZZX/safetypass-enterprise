// src/services/supabaseApi.ts
import { supabase } from './supabaseClient'
import { User, Vendor, ExamType, Question, WorkPermitSession } from '../types'

export const api = {

  /* =====================================================
     1. AUTH (แก้ไขโดเมนเป็น .com เพื่อให้ผ่าน Validation)
  ===================================================== */

  login: async (nationalId: string): Promise<User> => {
    // ✅ แก้จาก @safetypass.local เป็น @safetypass.com
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

    const email = `${nationalId}@safetypass.com`
    const password = nationalId 

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { national_id: nationalId, name: name } }
    })

    if (authError) throw new Error(authError.message)
    if (!authData.user) throw new Error('Auth Error')

    // ✅ Insert ข้อมูลใหม่ครบทุกช่อง
    const { data: newUser, error: dbError } = await supabase
      .from('users')
      .insert({
        id: authData.user.id,
        national_id: nationalId,
        name,
        age,            // เพิ่ม
        nationality,    // เพิ่ม
        vendor_id: finalVendorId,
        role: 'USER'
      })
      .select('*, vendors(*)')
      .single()

    if (dbError) throw new Error('บันทึก Profile ไม่สำเร็จ')
    return newUser as unknown as User
  },

  /* =====================================================
     2. VENDOR
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
     3. SETTINGS (PASSING SCORE)
  ===================================================== */

  getSystemSettings: async () => {
    // เพิ่มฟังก์ชันนี้เพื่อให้ SettingsManager เรียกใช้ได้
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
    // ใช้ upsert เพื่อกัน error กรณีไม่มี key
    await supabase
      .from('system_config')
      .upsert({ key, value: value.toString() })
  },
  
  // คงไว้เพื่อความเข้ากันได้
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
    const { data } = await supabase
      .from('questions')
      .select('id, content_th, content_en, choices_json, type') // ⚠️ เลือกไม่ดึงเฉลยมาแสดง
      .eq('type', type)
      .eq('is_active', true)

    return (data || []).map(q => ({
      ...q,
      choices_json:
        typeof q.choices_json === 'string'
          ? JSON.parse(q.choices_json)
          : q.choices_json
    }))
  },

  getAllQuestions: async (): Promise<Question[]> => {
    const { data } = await supabase
      .from('questions')
      .select('*') // Admin เห็นเฉลยได้
      .order('created_at', { ascending: false })

    return (data || []).map(q => ({
      ...q,
      choices_json:
        typeof q.choices_json === 'string'
          ? JSON.parse(q.choices_json)
          : q.choices_json
    }))
  },

  createQuestion: async (question: Partial<Question>) => {
    const { error } = await supabase
      .from('questions')
      .insert(question)

    if (error) throw error
  },

  updateQuestion: async (id: string, updates: Partial<Question>) => {
    const { error } = await supabase
      .from('questions')
      .update(updates)
      .eq('id', id)

    if (error) throw error
  },

  deleteQuestion: async (id: string) => {
    const { error } = await supabase
      .from('questions')
      .delete()
      .eq('id', id)

    if (error) throw error
  },

  /* =====================================================
     5. EXAM SUBMIT
  ===================================================== */

  submitExam: async (userId: string, type: ExamType, score: number, passed: boolean, permitNo?: string) => {
    console.warn("Deprecated: Please use 'submitExamWithAnswers'");
    const { error } = await supabase.from('exam_logs').insert({ user_id: userId, exam_type: type, score, passed })
    if (error) throw new Error("Please update code to use submitExamWithAnswers");
    return { passed, score }
  },

  // ✅ ใช้ตัวนี้
  submitExamWithAnswers: async (
      type: ExamType,
      answers: Record<string, number>,
      permitNo?: string
  ) => {
      const { data, error } = await supabase.rpc('submit_exam_attempt', {
          exam_type_param: type,
          answers: answers,
          permit_no_param: permitNo
      })

      if (error) throw new Error(error.message)
      return data 
  },

  /* =====================================================
     6. WORK PERMIT
  ===================================================== */

  getActiveWorkPermit: async (
    userId: string
  ): Promise<WorkPermitSession | null> => {

    const { data } = await supabase
      .from('work_permits')
      .select('*')
      .eq('user_id', userId)
      .gt('expire_date', new Date().toISOString())
      .limit(1)
      .maybeSingle()

    return data || null
  },

  /* =====================================================
     7. DASHBOARD STATS
  ===================================================== */

  getDashboardStats: async () => {
    // ใช้ count: 'exact', head: true เพื่อประสิทธิภาพ (ไม่โหลด data)
    const { count: users } = await supabase.from('users').select('*', { count: 'exact', head: true });
    
    const { count: vendors } = await supabase.from('vendors')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'PENDING');

    const { count: permits } = await supabase.from('work_permits')
        .select('*', { count: 'exact', head: true })
        .gt('expire_date', new Date().toISOString());

    // Exam Logs อาจจะต้องโหลดมาคำนวณ passed/failed 
    // หรือสร้าง View ใน DB จะดีกว่า แต่นี่ใช้ท่าเดิมไปก่อน
    const { data: logs } = await supabase.from('exam_logs').select('passed');

    const passed = logs?.filter(l => l.passed).length || 0;
    const failed = logs?.filter(l => !l.passed).length || 0;

    return {
      totalUsers: users || 0,
      pendingVendors: vendors || 0,
      activePermits: permits || 0,
      examSummary: [
        { name: 'Passed', value: passed },
        { name: 'Failed', value: failed }
      ]
    };
  },


  /* =====================================================
     8. REPORT DATA
  ===================================================== */

  getReportData: async () => {
    const { data, error } = await supabase
      .from('exam_logs')
      .select(`
        created_at,
        exam_type,
        score,
        passed,
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
      timestamp: new Date(log.created_at), // ส่งเป็น Object Date ไปเลยเพื่อไปจัด Format ทีหลัง
      national_id: log.users?.national_id || '-',
      name: log.users?.name || '-',
      age: log.users?.age || '-',
      nationality: log.users?.nationality || '-',
      vendor: log.users?.vendors?.name || '-',
      exam_type: log.exam_type,
      score: log.score,
      result: log.passed ? 'PASSED' : 'FAILED'
    }));
  }

}