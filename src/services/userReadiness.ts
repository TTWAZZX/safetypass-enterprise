import type { TrainingProgram } from '../types';

export type UserReadinessCode = 'SUSPENDED' | 'NO_PROGRAM' | 'NOT_READY' | 'PARTIALLY_READY' | 'READY';
export type ReadinessTone = 'danger' | 'warning' | 'success';
export type ReadinessAction =
  | 'NONE'
  | 'START_INDUCTION'
  | 'START_PERMIT'
  | 'VIEW_CONTRACTOR_CARD'
  | 'START_SUPPLIER_EXAM'
  | 'EDIT_SUPPLIER_ACCESS'
  | 'VIEW_SUPPLIER_CARD';
export type ReadinessTrackStatus =
  | 'READY'
  | 'INDUCTION_REQUIRED'
  | 'PERMIT_REQUIRED'
  | 'SUPPLIER_EXAM_REQUIRED'
  | 'SUPPLIER_ACCESS_UPCOMING'
  | 'SUPPLIER_ACCESS_ENDED';

export interface UserReadinessTrack {
  program: TrainingProgram;
  status: ReadinessTrackStatus;
  ready: boolean;
  nearExpiry: boolean;
  primaryAction: ReadinessAction;
}

export interface UserReadinessResult {
  code: UserReadinessCode;
  tone: ReadinessTone;
  readyCount: number;
  totalCount: number;
  tracks: UserReadinessTrack[];
}

export type SupplierAccessWindowState = 'ACTIVE' | 'UPCOMING' | 'ENDED';

export const getSupplierAccessWindowState = (
  accessStartDate: string | null | undefined,
  accessEndDate: string | null | undefined,
  today: string,
): SupplierAccessWindowState => {
  if (accessStartDate && today < accessStartDate) return 'UPCOMING';
  if (accessEndDate && today > accessEndDate) return 'ENDED';
  return 'ACTIVE';
};

/** Presentation-only summary. Server-side authorization remains authoritative. */
export const getUserReadiness = ({
  isActive,
  programs,
  hasInduction,
  hasActivePermit,
  contractorNearExpiry = false,
  hasSupplierPass = false,
  supplierAccessWindow = 'ACTIVE',
  supplierNearExpiry = false,
}: {
  isActive: boolean;
  programs: TrainingProgram[];
  hasInduction: boolean;
  hasActivePermit: boolean;
  contractorNearExpiry?: boolean;
  hasSupplierPass?: boolean;
  supplierAccessWindow?: SupplierAccessWindowState;
  supplierNearExpiry?: boolean;
}): UserReadinessResult => {
  const uniquePrograms = [...new Set(programs)];
  if (!isActive) {
    return { code: 'SUSPENDED', tone: 'danger', readyCount: 0, totalCount: uniquePrograms.length, tracks: [] };
  }

  const tracks: UserReadinessTrack[] = uniquePrograms.map((program) => {
    if (program === 'CONTRACTOR') {
      if (!hasInduction) return { program, status: 'INDUCTION_REQUIRED', ready: false, nearExpiry: false, primaryAction: 'START_INDUCTION' };
      if (!hasActivePermit) return { program, status: 'PERMIT_REQUIRED', ready: false, nearExpiry: false, primaryAction: 'START_PERMIT' };
      return { program, status: 'READY', ready: true, nearExpiry: contractorNearExpiry, primaryAction: 'VIEW_CONTRACTOR_CARD' };
    }

    if (!hasSupplierPass) return { program, status: 'SUPPLIER_EXAM_REQUIRED', ready: false, nearExpiry: false, primaryAction: 'START_SUPPLIER_EXAM' };
    if (supplierAccessWindow === 'UPCOMING') return { program, status: 'SUPPLIER_ACCESS_UPCOMING', ready: false, nearExpiry: false, primaryAction: 'EDIT_SUPPLIER_ACCESS' };
    if (supplierAccessWindow === 'ENDED') return { program, status: 'SUPPLIER_ACCESS_ENDED', ready: false, nearExpiry: false, primaryAction: 'EDIT_SUPPLIER_ACCESS' };
    return { program, status: 'READY', ready: true, nearExpiry: supplierNearExpiry, primaryAction: 'VIEW_SUPPLIER_CARD' };
  });

  const readyCount = tracks.filter((track) => track.ready).length;
  const totalCount = tracks.length;
  if (totalCount === 0) return { code: 'NO_PROGRAM', tone: 'warning', readyCount, totalCount, tracks };
  if (readyCount === totalCount) return { code: 'READY', tone: 'success', readyCount, totalCount, tracks };
  if (readyCount > 0) return { code: 'PARTIALLY_READY', tone: 'warning', readyCount, totalCount, tracks };
  return { code: 'NOT_READY', tone: 'warning', readyCount, totalCount, tracks };
};
