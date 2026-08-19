import { describe, expect, it } from 'vitest';
import { getAdminPromotionReadiness } from '../services/adminPromotionReadiness';

describe('getAdminPromotionReadiness', () => {
  it('allows promotion only when all database conditions are satisfied', () => {
    const result = getAdminPromotionReadiness({
      is_active: true,
      pdpa_agreed: true,
      last_login: '2026-08-19T06:00:00.000Z',
    });

    expect(result.eligible).toBe(true);
    expect(result.statusLabel).toBe('พร้อมใช้งาน');
    expect(result.checks.every((check) => check.passed)).toBe(true);
  });

  it('identifies an inactive account before other blockers', () => {
    const result = getAdminPromotionReadiness({
      is_active: false,
      pdpa_agreed: true,
      last_login: '2026-08-19T06:00:00.000Z',
    });

    expect(result.eligible).toBe(false);
    expect(result.statusLabel).toBe('บัญชีถูกระงับ');
    expect(result.checks.find((check) => check.code === 'ACCOUNT_ACTIVE')?.passed).toBe(false);
  });

  it('distinguishes missing PDPA consent from missing login', () => {
    const missingPdpa = getAdminPromotionReadiness({
      is_active: true,
      pdpa_agreed: false,
      last_login: '2026-08-19T06:00:00.000Z',
    });
    const missingLogin = getAdminPromotionReadiness({
      is_active: true,
      pdpa_agreed: true,
      last_login: null,
    });

    expect(missingPdpa.statusLabel).toBe('รอยอมรับ PDPA');
    expect(missingLogin.statusLabel).toBe('รอเข้าใช้งาน');
  });

  it('treats absent fields as incomplete, matching the database guard', () => {
    const result = getAdminPromotionReadiness({});

    expect(result.eligible).toBe(false);
    expect(result.checks.every((check) => !check.passed)).toBe(true);
  });
});
