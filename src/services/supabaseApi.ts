import { supabase } from './supabaseClient'
import { User, Vendor, ExamType, Question, WorkPermitSession } from '../types'

export const api = {

  /* =====================================================
     1. AUTH
  ===================================================== */

  login: async (nationalId: string): Promise<User> => {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('national_id', nationalId)
      .single()

    if (error || !data) throw new Error('ไม่พบผู้ใช้งาน')
    return data as User
  },

  register: async (
    nationalId: string,
    name: string,
    vendorId: string,
    otherVendorName?: string
  ): Promise<User> => {

    let finalVendorId = vendorId

    if (otherVendorName) {
      const { data: newVendor, error: vError } = await supabase
        .from('vendors')
        .insert({ name: otherVendorName, status: 'PENDING' })
        .select()
        .single()

      if (vError) throw new Error('สร้างบริษัทไม่สำเร็จ')
      finalVendorId = newVendor.id
    }

    const { data, error } = await supabase
      .from('users')
      .insert({
        national_id: nationalId,
        name,
        vendor_id: finalVendorId,
        role: 'USER'
      })
      .select()
      .single()

    if (error) throw new Error('ลงทะเบียนไม่สำเร็จ')
    return data as User
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

  getPassingScore: async (key: string) => {
    const { data } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', key)
      .single()

    return Number(data?.value || 0)
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
    const { data } = await supabase
      .from('questions')
      .select('*')
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
      .select('*')
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

  submitExam: async (
    userId: string,
    type: ExamType,
    score: number,
    passed: boolean,
    permitNo?: string
  ) => {

    await supabase.from('exam_logs').insert({
      user_id: userId,
      exam_type: type,
      score,
      passed
    })

    if (passed) {
      const now = new Date()

      if (type === 'INDUCTION') {
        const nextYear = new Date()
        nextYear.setFullYear(now.getFullYear() + 1)

        await supabase
          .from('users')
          .update({ induction_expiry: nextYear.toISOString() })
          .eq('id', userId)
      }

      if (type === 'WORK_PERMIT' && permitNo) {
        const expire = new Date()
        expire.setDate(now.getDate() + 5)

        await supabase.from('work_permits').insert({
          user_id: userId,
          permit_no: permitNo,
          expire_date: expire.toISOString()
        })
      }
    }

    return { passed, score }
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

    const { data: users } =
      await supabase.from('users').select('id');

    const { data: vendors } =
      await supabase.from('vendors')
        .select('id')
        .eq('status', 'PENDING');

    const { data: permits } =
      await supabase.from('work_permits')
        .select('id')
        .gt('expire_date', new Date().toISOString());

    const { data: logs } =
      await supabase.from('exam_logs')
        .select('passed');

    const passed =
      logs?.filter(l => l.passed).length || 0;

    const failed =
      logs?.filter(l => !l.passed).length || 0;

    return {
      totalUsers: users?.length || 0,
      pendingVendors: vendors?.length || 0,
      activePermits: permits?.length || 0,
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
        users!exam_logs_user_id_fkey (
          national_id,
          name,
          vendors (
            name
          )
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching report:', error);
      return [];
    }

    return (data || []).map((log: any) => ({
      timestamp: new Date(log.created_at).toLocaleString('th-TH'),
      national_id: log.users?.national_id || '-',
      name: log.users?.name || '-',
      vendor: log.users?.vendors?.name || '-',
      exam_type: log.exam_type,
      score: log.score,
      result: log.passed ? 'PASSED' : 'FAILED'
    }));
  }

}
