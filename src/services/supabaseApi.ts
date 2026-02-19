import { supabase } from './supabaseClient'
import { User, Vendor, ExamType, Question, WorkPermitSession, Choice } from '../types'
// ✅ แก้ไข Import ให้ถูกต้อง
import SHA256 from 'crypto-js/sha256';

export const api = {

  /* =====================================================
      1. AUTH & REGISTRATION (HYBRID SECURITY MODE 🔒)
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
    // ✅ แก้ไขการเรียกใช้ Hash เป็น SHA256
    const hash = SHA256(nationalId).toString();
    
    const { data, error } = await supabase
      .from('users')
      .select('*, vendors(*)')
      .or(`national_id.eq.${nationalId},national_id_hash.eq.${hash}`)
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
    // ใช้ checkUser ของเราเองที่รองรับทั้ง Hash และเลขจริง
    const existingUser = await api.checkUser(nationalId);

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
    
    // ✅ แก้ไขการเรียกใช้ Hash เป็น SHA256
    const nationalIdHash = SHA256(nationalId).toString();

    const payload: any = {
      name,
      national_id: nationalId,
      national_id_hash: nationalIdHash, // เพิ่ม Hash ลงไปใน Payload ด้วย
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
      3. SYSTEM SETTINGS (FIXED: UPSERT ✅)
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
      .maybeSingle() // ✅ เปลี่ยนเป็น maybeSingle เพื่อกัน Error กรณีไม่เจอค่า
    return Number(data?.value || 80) // Default 80
  },

  // ✅ ฟังก์ชันพระเอก: ใช้ upsert เพื่อ "สร้างใหม่" หรือ "อัปเดต" ในคำสั่งเดียว
  updateSystemSetting: async (key: string, value: number | string) => {
    const { error } = await supabase
      .from('system_config')
      .upsert(
        { key, value: String(value) }, 
        { onConflict: 'key' } // 👈 สำคัญ: ระบุว่าให้เช็คซ้ำที่คอลัมน์ key
      );
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
    // Note: ควรใช้ handleDeleteUser ใน VendorManager เพื่อ Cascade Delete
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

  // ✅ เวอร์ชัน Super Compatible: ตรวจทั้งเลขข้อถูก และ Flag ใน Choice (จบปัญหาคะแนนไม่ตรง)
  submitExamWithAnswers: async (
    type: ExamType,
    answers: Record<string, any>, 
    permitNo?: string
  ) => {
    // 1. ดึงเฉลยจาก Database
    const { data: questions, error } = await supabase
      .from('questions')
      .select('*')
      .eq('type', type);

    if (error || !questions) throw new Error('ไม่สามารถดึงข้อมูลข้อสอบได้');

    // 2. ดึงเกณฑ์คะแนน (Default 80)
    const config = await api.getSystemSettings();
    const thresholdKey = type === 'INDUCTION' ? 'PASSING_SCORE_INDUCTION' : 'PASSING_SCORE_WORK_PERMIT';
    const threshold = Number(config[thresholdKey] || 80);

    let score = 0;

    console.log("🔥 START GRADING DEBUG 🔥");

    // 3. เริ่มตรวจคำตอบ
    questions.forEach((q, index) => {
      const userAns = answers[q.id];
      
      // ถ้า User ไม่ตอบ -> ข้าม (ผิด)
      if (userAns === undefined || userAns === null) {
          console.log(`Q${index+1}: No Answer (FAIL)`);
          return;
      }

      // เตรียมข้อมูลเฉลย
      let choices = q.choices_json;
      if (typeof choices === 'string') {
        try { choices = JSON.parse(choices); } catch (e) { choices = []; }
      }

      let isCorrect = false;

      // ---------------------------------------------------------
      // 🔍 วิธีที่ 1: ตรวจแบบ Text (สำหรับ Short Answer)
      // ---------------------------------------------------------
      if (q.pattern === 'SHORT_ANSWER' || q.pattern === 'short_answer') {
          const correctText = choices[0]?.correct_answer?.toString().toLowerCase().trim();
          const userText = userAns.toString().toLowerCase().trim();
          if (userText === correctText) isCorrect = true;
      } 
      // ---------------------------------------------------------
      // 🔍 วิธีที่ 2: ตรวจแบบ Matching (จับคู่)
      // ---------------------------------------------------------
      else if (q.pattern === 'MATCHING' || q.pattern === 'matching') {
          if (Array.isArray(userAns)) {
            isCorrect = choices.every((p: any, idx: number) => Number(userAns[idx]) === idx);
          }
      }
      // ---------------------------------------------------------
      // 🔍 วิธีที่ 3: ตรวจแบบ Choice (Multiple Choice / True-False)
      // ---------------------------------------------------------
      else {
          const userIndex = Number(userAns); // แปลงคำตอบ User เป็นตัวเลข (Index)
          
          // ✅ CHECK 3.1: เทียบกับคอลัมน์ correct_answer ใน Database (ถ้ามี)
          // เช่น DB เก็บ "0" แล้ว User ส่งมา 0
          if (q.correct_answer !== null && q.correct_answer !== undefined) {
              if (Number(q.correct_answer) === userIndex) {
                  isCorrect = true;
              }
          }

          // ✅ CHECK 3.2: ถ้ายังไม่ถูก ให้ลองไปดูใน JSON Choice ว่ามี is_correct: true ไหม
          if (!isCorrect && choices[userIndex]) {
              const val = choices[userIndex].is_correct;
              const isFlagged = 
                  val === true || 
                  String(val).toLowerCase() === 'true'; // รองรับ "true"
              
              if (isFlagged) isCorrect = true;
          }
      }

      if (isCorrect) score++;
      
      // 🛑 LOG ดูผลการตรวจรายข้อ (กด F12 ดูได้เลย)
      console.log(`Q${index+1} (${q.id}): UserAns=${userAns}, DB_Correct=${q.correct_answer} -> ${isCorrect ? '✅ PASS' : '❌ FAIL'}`);
    });

    console.log(`🏁 FINAL SCORE: ${score}/${questions.length}`);
    console.log("🔥 END GRADING DEBUG 🔥");

    // 4. คำนวณผลลัพธ์ผ่าน/ไม่ผ่าน
    const passedPercent = questions.length > 0 ? (score / questions.length) * 100 : 0;
    const passed = passedPercent >= threshold; 
    
    // 5. บันทึกลง Database
    await api.submitExamResult(type, score, questions.length, passed, permitNo);

    return { score, passed };
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

  // ✅ แก้ไข: ลบคอมเมนต์ภาษาไทยออก (สำคัญมาก)
  getReportData: async () => {
    const { data, error } = await supabase
      .from('exam_history')
      .select(`
        created_at, exam_type, score, total_questions, status,
        users ( 
            national_id,
            name, 
            age, 
            nationality, 
            vendors ( name ) 
        )
      `)
      .order('created_at', { ascending: false });

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