import { AuditLog } from '../types';

type AuditDetails = Record<string, unknown>;

export interface AuditPresentation {
  actionLabel: string;
  targetLabel: string;
  summary: string;
  actorLabel: string;
  technicalReference: string;
  tone: 'blue' | 'emerald' | 'amber' | 'red' | 'violet' | 'slate';
}

const ACTION_LABELS: Record<string, { label: string; tone: AuditPresentation['tone'] }> = {
  ADMIN_USER_CREATED: { label: 'เพิ่มผู้ใช้งานใหม่', tone: 'emerald' },
  ADMIN_USER_DELETED: { label: 'ลบข้อมูลผู้ใช้งาน', tone: 'red' },
  ADMIN_USER_ARCHIVED: { label: 'ระงับบัญชีผู้ใช้งาน', tone: 'red' },
  ADMIN_USER_REACTIVATED: { label: 'เปิดใช้งานบัญชีอีกครั้ง', tone: 'emerald' },
  ADMIN_USER_UPDATED: { label: 'แก้ไขข้อมูลผู้ใช้งาน', tone: 'blue' },
  ADMIN_INDUCTION_RESET: { label: 'รีเซตสถานะการอบรม', tone: 'amber' },
  ADMIN_PIN_RESET: { label: 'รีเซต PIN ผู้ใช้งาน', tone: 'violet' },
  ADMIN_VENDOR_CREATED: { label: 'เพิ่มบริษัทใหม่', tone: 'emerald' },
  ADMIN_VENDOR_DELETED: { label: 'ลบข้อมูลบริษัท', tone: 'red' },
  ADMIN_VENDOR_ARCHIVED: { label: 'เก็บบริษัทออกจากรายการใช้งาน', tone: 'red' },
  ADMIN_VENDOR_UPDATED: { label: 'แก้ไขข้อมูลบริษัท', tone: 'blue' },
  EXTERNAL_REGISTRATION_EMAIL_RECIPIENT_ADDED: { label: 'เพิ่มผู้รับอีเมลแจ้งเตือน', tone: 'emerald' },
  EXTERNAL_REGISTRATION_EMAIL_RECIPIENT_UPDATED: { label: 'แก้ไขผู้รับอีเมลแจ้งเตือน', tone: 'blue' },
  EXTERNAL_REGISTRATION_EMAIL_RECIPIENT_DISABLED: { label: 'ปิดผู้รับอีเมลแจ้งเตือน', tone: 'red' },
  EXTERNAL_REGISTRATION_FEATURE_TOGGLED: { label: 'เปลี่ยนสถานะระบบรับสมัครภายนอก', tone: 'amber' },
  EXTERNAL_REGISTRATION_APPLICATION_UNDER_REVIEW: { label: 'รับคำขอไว้ตรวจสอบ', tone: 'blue' },
  EXTERNAL_REGISTRATION_APPLICATION_NEED_MORE_INFO: { label: 'ขอข้อมูลเพิ่มเติม', tone: 'amber' },
  EXTERNAL_REGISTRATION_APPLICATION_APPROVED: { label: 'อนุมัติคำขอลงทะเบียน', tone: 'emerald' },
  EXTERNAL_REGISTRATION_APPLICATION_REJECTED: { label: 'ไม่อนุมัติคำขอลงทะเบียน', tone: 'red' },
  EXTERNAL_REGISTRATION_APPLICATION_CANCELLED: { label: 'ยกเลิกคำขอลงทะเบียน', tone: 'red' },
  EXTERNAL_REGISTRATION_APPLICATION_DELETED: { label: 'นำคำขอออกจากรายการ', tone: 'red' },
  ORPHANED_AUTH_PROFILE_REPAIRED: { label: 'ซ่อมแซมบัญชีที่เชื่อมต่อไม่สมบูรณ์', tone: 'violet' },
  DUPLICATE_AUTH_PROFILE_ARCHIVED: { label: 'จัดเก็บบัญชีซ้ำ', tone: 'amber' },
};

const FIELD_LABELS: Record<string, string> = {
  name: 'ชื่อ',
  age: 'อายุ',
  nationality: 'สัญชาติ',
  vendor_id: 'บริษัท',
  role: 'สิทธิ์การใช้งาน',
  is_active: 'สถานะบัญชี',
  induction_expiry: 'วันหมดอายุการอบรม',
  pdpa_agreed: 'การยอมรับ PDPA',
  status: 'สถานะ',
};

const parseDetails = (value: AuditLog['details']): AuditDetails => {
  if (!value) return {};
  if (typeof value === 'object') return value as unknown as AuditDetails;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as AuditDetails : {};
  } catch {
    return {};
  }
};

const getTargetLabel = (log: AuditLog, details: AuditDetails) => {
  if (log.action.startsWith('EXTERNAL_REGISTRATION_APPLICATION_')) return `คำขอ ${log.target}`;
  if (log.action.includes('EMAIL_RECIPIENT')) return typeof details.email === 'string' ? details.email : 'ผู้รับอีเมลแจ้งเตือน';
  if (log.action === 'EXTERNAL_REGISTRATION_FEATURE_TOGGLED') return 'ระบบรับสมัครบุคคลภายนอก';
  if (log.action.includes('VENDOR')) return 'ข้อมูลบริษัท';
  if (log.action.includes('USER') || log.action === 'ADMIN_PIN_RESET') return 'ข้อมูลผู้ใช้งาน';
  if (log.action.includes('AUTH_PROFILE')) return 'บัญชีผู้ใช้งาน';
  return 'รายการระบบ';
};

const getSummary = (log: AuditLog, details: AuditDetails) => {
  const fields = Array.isArray(details.changed_fields)
    ? details.changed_fields.filter((field): field is string => typeof field === 'string' && field !== 'record_created' && field !== 'record_deleted')
    : [];
  if (log.action === 'ADMIN_USER_UPDATED' && fields.includes('role')) return 'เปลี่ยนสิทธิ์ระหว่างผู้ใช้งานทั่วไปและผู้ดูแลระบบ';
  if (fields.length > 0) return `ข้อมูลที่เปลี่ยน: ${fields.map((field) => FIELD_LABELS[field] || field).join(', ')}`;
  if (log.action === 'EXTERNAL_REGISTRATION_FEATURE_TOGGLED') return details.enabled === true ? 'เปิดรับคำขอลงทะเบียนจากบุคคลภายนอก' : 'ปิดรับคำขอลงทะเบียนจากบุคคลภายนอก';
  if (log.action.includes('EMAIL_RECIPIENT') && typeof details.email === 'string') return `อีเมล: ${details.email}`;
  if (log.action === 'ADMIN_PIN_RESET' && typeof details.expires_at === 'string') return `PIN ชั่วคราวใช้ได้ถึง ${new Date(details.expires_at).toLocaleString('th-TH')}`;
  if (typeof details.rejection_reason === 'string' && details.rejection_reason) return `เหตุผล: ${details.rejection_reason}`;
  if (typeof details.note === 'string' && details.note) return `หมายเหตุ: ${details.note}`;
  if (typeof details.reason === 'string' && details.reason) return `เหตุผล: ${details.reason}`;
  return 'ระบบบันทึกการดำเนินการนี้เรียบร้อยแล้ว';
};

export const presentAuditLog = (log: AuditLog): AuditPresentation => {
  const details = parseDetails(log.details);
  const mapped = ACTION_LABELS[log.action] || { label: 'ดำเนินการในระบบ', tone: 'slate' as const };
  const roleChanged = log.action === 'ADMIN_USER_UPDATED'
    && Array.isArray(details.changed_fields)
    && details.changed_fields.includes('role');
  return {
    actionLabel: roleChanged ? 'เปลี่ยนสิทธิ์ผู้ใช้งาน' : mapped.label,
    targetLabel: getTargetLabel(log, details),
    summary: getSummary(log, details),
    actorLabel: log.admin_email === 'system@migration.local' ? 'ระบบอัตโนมัติ' : log.admin_email,
    technicalReference: `${log.action} · ${log.target}`,
    tone: roleChanged ? 'violet' : mapped.tone,
  };
};
