import { describe, expect, it } from 'vitest';
import { calculateSupplierDashboardMetrics } from '../services/dashboardMetrics';
import { SupplierOutsourceReportRow } from '../types';

const makeRow = (overrides: Partial<SupplierOutsourceReportRow>): SupplierOutsourceReportRow => ({
  user_id: crypto.randomUUID(), company: 'บริษัททดสอบ', name: 'ผู้ใช้ทดสอบ', national_id: null,
  participant_type: 'supplier', work_type: 'Driver', access_start_date: null, access_end_date: null,
  passed_at: null, expires_at: null, last_score: null, total_questions: null, last_status: null,
  last_test_at: null, verification_token: null, test_date: null, expiration_date: null,
  score: null, result_status: null, ...overrides,
});

describe('Supplier & Outsource dashboard metrics', () => {
  it('separates active, near-expiry, and action-required access correctly', () => {
    const now = Date.parse('2026-07-26T00:00:00.000Z');
    const result = calculateSupplierDashboardMetrics([
      makeRow({ result_status: 'PASSED', expiration_date: '2027-07-26T00:00:00.000Z' }),
      makeRow({ participant_type: 'outsource', result_status: 'PASSED', expiration_date: '2026-08-01T00:00:00.000Z' }),
      makeRow({ result_status: 'FAILED' }),
      makeRow({ participant_type: 'outsource' }),
    ], now);

    expect(result).toEqual({
      entitled: 4, activePasses: 2, actionRequired: 2, nearExpiry: 1,
      passRate: 67, suppliers: 2, outsource: 2,
    });
  });

  it('treats an expired passed result as requiring action', () => {
    const result = calculateSupplierDashboardMetrics([
      makeRow({ result_status: 'PASSED', expiration_date: '2026-01-01T00:00:00.000Z' }),
    ], Date.parse('2026-07-26T00:00:00.000Z'));
    expect(result.activePasses).toBe(0);
    expect(result.actionRequired).toBe(1);
    expect(result.passRate).toBe(100);
  });
});
