/**
 * 🛡️ SAFETYPASS GLOBAL TYPE DEFINITIONS
 * Last Updated: 2026
 */

export enum VendorStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED'
}

export enum ExamType {
  INDUCTION = 'INDUCTION',
  WORK_PERMIT = 'WORK_PERMIT'
}

export enum UserRole {
  ADMIN = 'ADMIN',
  USER = 'USER'
}

// ✅ 1. เพิ่ม QuestionPattern เพื่อรองรับข้อสอบหลายรูปแบบตามที่รัน SQL ไป
export enum QuestionPattern {
  MULTIPLE_CHOICE = 'MULTIPLE_CHOICE',
  TRUE_FALSE = 'TRUE_FALSE',
  MATCHING = 'MATCHING',
  SHORT_ANSWER = 'SHORT_ANSWER'
}

// ✅ Choice รองรับ 2 ภาษา (ใช้สำหรับ MULTIPLE_CHOICE และ TRUE_FALSE)
export interface Choice {
  text_th: string;
  text_en: string;
  is_correct: boolean;
}

// ✅ 2. เพิ่ม Interface สำหรับข้อสอบแบบจับคู่ (Matching)
export interface MatchingPair {
  left_text_th: string;
  left_text_en: string;
  right_text_th: string;
  right_text_en: string;
}

// ✅ Question ปรับปรุงใหม่รองรับหลายรูปแบบและรูปภาพประกอบ
export interface Question {
  id: string;
  content_th: string;
  content_en: string;
  choices_json: any; // ปรับเป็น any เพื่อรองรับทั้ง Choice[] และ MatchingPair[]
  type: ExamType;    // ประเภทวิชาที่สอบ (Induction / WP)
  
  // ✅ เพิ่มฟิลด์ pattern เพื่อระบุรูปแบบข้อสอบ (ปรนัย, ถูกผิด, จับคู่, อัตนัย)
  pattern: QuestionPattern | string; 
  
  image_url: string | null; 
  correct_choice_index?: number; 
  
  // ✅ เพิ่มฟิลด์สำหรับ SHORT_ANSWER (อัตนัย)
  correct_answer_keywords?: string[]; 
  
  is_active: boolean;
  created_at?: string;
}

export interface Vendor {
  id: string;
  name: string;
  status: VendorStatus;
  created_at?: string;
}

// ✅ User ปรับปรุงใหม่รองรับ Age และ Nationality ตามหน้า Register
export interface User {
  id: string;
  national_id: string;
  name: string;
  age?: number;           
  nationality?: string;   
  vendor_id: string;
  induction_expiry: string | null; 
  role: UserRole | 'ADMIN' | 'USER';
  created_at: string;
  vendors?: {             
    name: string;
  };
}

export interface ExamLog {
  id: string;
  user_id: string;
  exam_type: ExamType;    
  score: number;
  total_questions?: number;
  status: 'PASSED' | 'FAILED'; 
  created_at: string;     
  users?: User;           
}

export interface WorkPermitSession {
  id: string;
  user_id: string;
  permit_no: string;
  expire_date: string;
  created_at?: string;
}

// ✅ เพิ่ม Audit Log Type สำหรับหน้า VendorManager
export interface AuditLog {
  id: string;
  admin_email: string;
  action: string;
  target: string;
  details: string;
  created_at: string;
}

// ✅ เพิ่ม System Settings Type สำหรับหน้า SettingsManager
export interface SystemSettings {
  key: string;
  value: any;
}