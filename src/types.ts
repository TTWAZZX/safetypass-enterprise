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
  WORK_PERMIT = 'WORK_PERMIT',
  SUPPLIER_OUTSOURCE = 'SUPPLIER_OUTSOURCE'
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

export interface QuestionRevision {
  id: string;
  question_id: string;
  revision_no: number;
  change_type: 'BASELINE' | 'CREATE' | 'SAVE' | 'PUBLISH' | 'UNPUBLISH' | 'RESTORE';
  note?: string | null;
  changed_by?: string | null;
  changed_by_name: string;
  changed_at: string;
  snapshot: Question;
  is_current: boolean;
}

export interface Vendor {
  id: string;
  name: string;
  status: VendorStatus;
  created_at?: string;
}

export interface VendorNameMatch {
  id: string;
  name: string;
  status: VendorStatus;
  match_type: 'EXACT' | 'SIMILAR';
  match_score: number;
}

export interface VendorSaveResult {
  saved: boolean;
  created: boolean;
  reason: 'SAVED' | 'EXACT' | 'SIMILAR';
  vendor: Pick<Vendor, 'id' | 'name' | 'status'> | null;
  matches: VendorNameMatch[];
}

// ✅ User ปรับปรุงใหม่รองรับ avatar_url จาก LINE
export interface User {
  id: string;
  national_id: string;
  name: string;
  age?: number | null;           
  date_of_birth?: string | null; 
  nationality?: string;   
  vendor_id: string | null;
  induction_expiry: string | null; 
  role: 'ADMIN' | 'USER' | string; 
  is_active?: boolean;           
  avatar_url?: string | null;    // ✅ เพิ่มฟิลด์รูปโปรไฟล์
  created_at: string;
  vendors?: {             
    name: string;
    status?: VendorStatus;
  };
  vendor_request_created?: boolean;
  vendor_resolution?: 'SELECTED' | 'EXISTING_APPROVED' | 'EXISTING_PENDING' | 'CREATED_PENDING';
  pin_setup_pending?: boolean;
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
  status?: 'ACTIVE' | 'EXPIRED';
  created_at?: string;
}

// ✅ เพิ่ม Audit Log Type สำหรับหน้า VendorManager
export interface AuditLog {
  id: string;
  actor_user_id?: string | null;
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

export type TrainingProgram = 'CONTRACTOR' | 'SUPPLIER_OUTSOURCE';
export type SupplierOutsourceType = 'supplier' | 'outsource';
export type SupplierOutsourceWorkType = 'Driver' | 'Passenger' | 'Trainee';

export interface TrainingAccess {
  user_id: string;
  program_code: TrainingProgram;
  participant_type: SupplierOutsourceType | null;
  work_type: SupplierOutsourceWorkType | null;
  passed_at: string | null;
  expires_at: string | null;
  access_start_date?: string | null;
  access_end_date?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminUser360Profile {
  id: string;
  masked_national_id: string;
  name: string;
  age: number | null;
  date_of_birth: string | null;
  nationality: string | null;
  vendor_id: string | null;
  vendor: Pick<Vendor, 'id' | 'name' | 'status'> | null;
  role: 'ADMIN' | 'USER' | string;
  is_active: boolean;
  pdpa_agreed: boolean;
  induction_expiry: string | null;
  avatar_url: string | null;
  line_connected: boolean;
  created_at: string;
  last_login: string | null;
}

export interface AdminUser360Exam {
  id: string;
  exam_type: ExamType;
  score: number;
  total_questions: number;
  status: 'PASSED' | 'FAILED';
  created_at: string;
}

export interface AdminUser360SupplierPass {
  id: string;
  issued_at: string;
  expires_at: string;
  status: 'ACTIVE' | 'REVOKED';
  created_at: string;
}

export interface AdminUser360AuthSecurity {
  pin_version: number;
  failed_attempts: number;
  locked_until: string | null;
  pin_changed_at: string | null;
  pin_reset_state: 'NONE' | 'PENDING' | 'ACTIVE' | null;
  pin_reset_expires_at: string | null;
}

export interface AdminUser360 {
  profile: AdminUser360Profile;
  programs: Array<Omit<TrainingAccess, 'user_id'>>;
  recent_exams: AdminUser360Exam[];
  recent_work_permits: Array<Omit<WorkPermitSession, 'user_id'>>;
  supplier_passes: AdminUser360SupplierPass[];
  auth_security: AdminUser360AuthSecurity | null;
  recent_audit: AuditLog[];
}

export interface AdminUser360UpdateInput {
  userId: string;
  name: string;
  age: number | null;
  dateOfBirth: string | null;
  nationality: string;
  vendorId: string | null;
  inductionExpiry: string | null;
  programs: TrainingProgram[];
  participantType?: SupplierOutsourceType | null;
  workType?: SupplierOutsourceWorkType | null;
  accessStartDate?: string | null;
  accessEndDate?: string | null;
  reason: string;
}

export interface SupplierOutsourceStatus {
  participant_type: SupplierOutsourceType;
  work_type: SupplierOutsourceWorkType;
  access_start_date: string | null;
  access_end_date: string | null;
  passed_at: string | null;
  expires_at: string | null;
  last_score: number | null;
  total_questions: number | null;
  last_status: 'PASSED' | 'FAILED' | null;
  last_test_at: string | null;
  verification_token: string | null;
}

export interface SupplierOutsourceReportRow extends SupplierOutsourceStatus {
  user_id: string;
  company: string;
  name: string;
  national_id: string | null;
  test_date: string | null;
  expiration_date: string | null;
  score: number | null;
  result_status: 'PASSED' | 'FAILED' | null;
}

export interface ExternalRegistrationNotificationRecipient {
  id: string;
  display_name: string | null;
  email: string;
  purpose: 'EXTERNAL_REGISTRATION_ADMIN';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type ExternalRegistrationApplicationStatus =
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'NEED_MORE_INFO'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

export type ExternalRegistrationCompanyResolution =
  | 'UNRESOLVED'
  | 'MATCHED_EXISTING'
  | 'LINKED_PENDING'
  | 'CREATED_NEW'
  | 'REJECTED';

export interface ExternalRegistrationApplicationRow {
  id: string;
  request_no: string;
  company_name_submitted: string;
  vendor_id: string | null;
  vendor_name: string | null;
  vendor_status: VendorStatus | null;
  company_resolution: ExternalRegistrationCompanyResolution;
  first_name_th: string;
  last_name_th: string;
  first_name_en: string;
  last_name_en: string;
  job_title: string;
  login_email: string;
  phone: string;
  status: ExternalRegistrationApplicationStatus;
  admin_note: string | null;
  rejection_reason: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  types: Array<{ type_code: string; target_system: string }>;
  coordinators: Array<{ name: string; is_primary: boolean; display_order: number }>;
}

export interface ExternalRegistrationApplicationDetail {
  application: ExternalRegistrationApplicationRow & {
    pdpa_agreed: boolean;
    pdpa_agreed_at: string | null;
    reviewed_by: string | null;
    created_at: string;
    updated_at: string;
  };
  vendor: { id: string; name: string; status: VendorStatus } | null;
  types: Array<{ type_code: string; target_system: string }>;
  coordinators: Array<{ name: string; is_primary: boolean; display_order: number }>;
  history: Array<{
    from_status: string | null;
    to_status: string;
    note: string | null;
    changed_by: string | null;
    created_at: string;
  }>;
}
