import { describe, expect, it } from 'vitest';
import { presentAuditLog } from '../services/auditPresentation';
import { AuditLog } from '../types';

const log = (values: Partial<AuditLog>): AuditLog => ({
  id: 'log-1',
  admin_email: 'admin@example.com',
  action: 'ADMIN_VENDOR_CREATED',
  target: 'vendors:123',
  details: '{}',
  created_at: '2026-08-17T03:00:00Z',
  ...values,
});

describe('audit presentation', () => {
  it('translates vendor actions and hides the UUID behind a readable target', () => {
    const result = presentAuditLog(log({}));
    expect(result.actionLabel).toBe('เพิ่มบริษัทใหม่');
    expect(result.targetLabel).toBe('ข้อมูลบริษัท');
    expect(result.technicalReference).toContain('vendors:123');
  });

  it('recognizes role changes from the recorded changed fields', () => {
    const result = presentAuditLog(log({
      action: 'ADMIN_USER_UPDATED',
      target: 'users:456',
      details: JSON.stringify({ changed_fields: ['role'] }),
    }));
    expect(result.actionLabel).toBe('เปลี่ยนสิทธิ์ผู้ใช้งาน');
    expect(result.summary).toContain('ผู้ดูแลระบบ');
    expect(result.tone).toBe('violet');
  });

  it('explains external registration status changes', () => {
    const result = presentAuditLog(log({
      action: 'EXTERNAL_REGISTRATION_APPLICATION_APPROVED',
      target: 'EXT-2026-001',
      details: '{}',
    }));
    expect(result.actionLabel).toBe('อนุมัติคำขอลงทะเบียน');
    expect(result.targetLabel).toBe('คำขอ EXT-2026-001');
  });
});
