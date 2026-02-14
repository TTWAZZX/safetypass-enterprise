// src/types.ts

export enum VendorStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED'
}

export enum ExamType {
  INDUCTION = 'INDUCTION',
  WORK_PERMIT = 'WORK_PERMIT'
}

// Choice รองรับ 2 ภาษา
export interface Choice {
  text_th: string;
  text_en: string;
  is_correct: boolean;
}

// Question รองรับ 2 ภาษา
export interface Question {
  id: string;
  content_th: string;
  content_en: string;
  choices_json: Choice[]; // Supabase ส่งมาเป็น JSON
  type: ExamType;
}

export interface Vendor {
  id: string;
  name: string;
  status: VendorStatus;
}

export interface User {
  id: string;
  national_id: string;
  name: string;
  vendor_id: string;
  induction_expiry: string | null; // วันหมดอายุ Induction
  role: 'ADMIN' | 'USER';
  created_at: string;
}

export interface ExamLog {
  id: string;
  user_id: string;
  type: ExamType;
  score: number;
  passed: boolean;
  timestamp: string;
}

export interface WorkPermitSession {
  id: string;
  user_id: string;
  permit_no: string;
  expire_date: string;
}