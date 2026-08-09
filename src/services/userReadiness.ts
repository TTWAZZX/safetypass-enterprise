export type UserReadinessCode = 'SUSPENDED' | 'INDUCTION_REQUIRED' | 'PERMIT_REQUIRED' | 'READY';

export interface UserReadinessResult {
  code: UserReadinessCode;
  tone: 'danger' | 'warning' | 'success';
  primaryAction: 'NONE' | 'START_INDUCTION' | 'START_PERMIT' | 'VIEW_PERMIT';
}

/** Presentation-only summary. Server-side authorization remains authoritative. */
export const getUserReadiness = ({
  isActive,
  hasInduction,
  hasActivePermit,
}: {
  isActive: boolean;
  hasInduction: boolean;
  hasActivePermit: boolean;
}): UserReadinessResult => {
  if (!isActive) return { code: 'SUSPENDED', tone: 'danger', primaryAction: 'NONE' };
  if (!hasInduction) return { code: 'INDUCTION_REQUIRED', tone: 'warning', primaryAction: 'START_INDUCTION' };
  if (!hasActivePermit) return { code: 'PERMIT_REQUIRED', tone: 'warning', primaryAction: 'START_PERMIT' };
  return { code: 'READY', tone: 'success', primaryAction: 'VIEW_PERMIT' };
};

