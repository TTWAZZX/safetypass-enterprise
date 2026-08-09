import { describe, expect, it } from 'vitest';
import { getSupplierAccessWindowState, getUserReadiness } from '../services/userReadiness';

const base = {
  isActive: true,
  programs: ['CONTRACTOR'] as const,
  hasInduction: false,
  hasActivePermit: false,
};

describe('getUserReadiness', () => {
  it('never presents a suspended user as ready', () => {
    expect(getUserReadiness({ ...base, isActive: false, programs: ['CONTRACTOR', 'SUPPLIER_OUTSOURCE'] }).code).toBe('SUSPENDED');
  });

  it('requires both contractor steps before contractor access is ready', () => {
    expect(getUserReadiness(base).tracks[0].status).toBe('INDUCTION_REQUIRED');
    expect(getUserReadiness({ ...base, hasInduction: true }).tracks[0].status).toBe('PERMIT_REQUIRED');
    expect(getUserReadiness({ ...base, hasInduction: true, hasActivePermit: true }).code).toBe('READY');
  });

  it('allows Supplier and Outsource access without contractor steps after its own pass', () => {
    const result = getUserReadiness({
      ...base,
      programs: ['SUPPLIER_OUTSOURCE'],
      hasSupplierPass: true,
      supplierAccessWindow: 'ACTIVE',
    });
    expect(result.code).toBe('READY');
    expect(result.tracks[0].primaryAction).toBe('VIEW_SUPPLIER_CARD');
  });

  it('reports partial readiness when only one of two independent programs is ready', () => {
    const result = getUserReadiness({
      ...base,
      programs: ['CONTRACTOR', 'SUPPLIER_OUTSOURCE'],
      hasSupplierPass: true,
      supplierAccessWindow: 'ACTIVE',
    });
    expect(result.code).toBe('PARTIALLY_READY');
    expect(result.readyCount).toBe(1);
    expect(result.totalCount).toBe(2);
  });

  it('does not treat a Supplier pass outside its allowed date window as ready', () => {
    expect(getUserReadiness({ ...base, programs: ['SUPPLIER_OUTSOURCE'], hasSupplierPass: true, supplierAccessWindow: 'UPCOMING' }).tracks[0].status).toBe('SUPPLIER_ACCESS_UPCOMING');
    expect(getUserReadiness({ ...base, programs: ['SUPPLIER_OUTSOURCE'], hasSupplierPass: true, supplierAccessWindow: 'ENDED' }).tracks[0].status).toBe('SUPPLIER_ACCESS_ENDED');
  });

  it('handles inclusive access dates', () => {
    expect(getSupplierAccessWindowState('2026-08-09', '2026-08-09', '2026-08-09')).toBe('ACTIVE');
    expect(getSupplierAccessWindowState('2026-08-10', null, '2026-08-09')).toBe('UPCOMING');
    expect(getSupplierAccessWindowState(null, '2026-08-08', '2026-08-09')).toBe('ENDED');
  });
});
