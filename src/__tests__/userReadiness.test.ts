import { describe, expect, it } from 'vitest';
import { getUserReadiness } from '../services/userReadiness';

describe('getUserReadiness', () => {
  it('never presents a suspended user as ready', () => {
    expect(getUserReadiness({ isActive: false, hasInduction: true, hasActivePermit: true })).toEqual({ code: 'SUSPENDED', tone: 'danger', primaryAction: 'NONE' });
  });

  it('asks for induction before a work permit', () => {
    expect(getUserReadiness({ isActive: true, hasInduction: false, hasActivePermit: false }).code).toBe('INDUCTION_REQUIRED');
  });

  it('asks for a permit only after induction is active', () => {
    expect(getUserReadiness({ isActive: true, hasInduction: true, hasActivePermit: false })).toEqual({ code: 'PERMIT_REQUIRED', tone: 'warning', primaryAction: 'START_PERMIT' });
  });

  it('presents ready only when both existing requirements are active', () => {
    expect(getUserReadiness({ isActive: true, hasInduction: true, hasActivePermit: true })).toEqual({ code: 'READY', tone: 'success', primaryAction: 'VIEW_PERMIT' });
  });
});

