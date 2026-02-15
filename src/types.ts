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

// ✅ Choice รองรับ 2 ภาษา
export interface Choice {
  text_th: string;
  text_en: string;
  is_correct: boolean;
}

// ✅ Question ปรับปรุงใหม่รองรับรูปภาพประกอบ (image_url)
export interface Question {
  id: string;
  content_th: string;
  content_en: string;
  choices_json: Choice[]; // Supabase JSON Storage
  type: ExamType;
  image_url: string | null; // เพิ่มเพื่อรองรับระบบรูปภาพประกอบโจทย์
  correct_choice_index?: number; // ตัวเลือกที่ถูกต้อง (Index 0-3)
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
  age?: number;           // เพิ่มอายุ
  nationality?: string;   // เพิ่มสัญชาติ
  vendor_id: string;
  induction_expiry: string | null; 
  role: UserRole | 'ADMIN' | 'USER';
  created_at: string;
  vendors?: {             // สำหรับ Join ข้อมูลจาก Supabase
    name: string;
  };
}

export interface ExamLog {
  id: string;
  user_id: string;
  exam_type: ExamType;    // ปรับให้ตรงกับ Database Schema (exam_type)
  score: number;
  total_questions?: number;
  status: 'PASSED' | 'FAILED'; // ปรับจาก boolean เป็น String Status ตาม API ใหม่
  created_at: string;     // ปรับจาก timestamp เป็น created_at ตาม Supabase standard
  users?: User;           // สำหรับแสดงผลใน Admin Dashboard
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