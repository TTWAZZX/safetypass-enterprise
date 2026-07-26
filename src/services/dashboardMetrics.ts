import { SupplierOutsourceReportRow } from '../types';

export interface SupplierDashboardMetrics {
  entitled: number;
  activePasses: number;
  actionRequired: number;
  nearExpiry: number;
  passRate: number;
  suppliers: number;
  outsource: number;
}

export const calculateSupplierDashboardMetrics = (
  rows: SupplierOutsourceReportRow[],
  nowMs = Date.now(),
): SupplierDashboardMetrics => {
  const nearExpiryLimit = nowMs + 30 * 24 * 60 * 60 * 1000;
  const activePasses = rows.filter((row) => row.result_status === 'PASSED'
    && Boolean(row.expiration_date)
    && new Date(row.expiration_date as string).getTime() > nowMs);
  const nearExpiry = activePasses.filter((row) => {
    const expiry = new Date(row.expiration_date as string).getTime();
    return expiry <= nearExpiryLimit;
  }).length;
  const tested = rows.filter((row) => row.result_status !== null);
  const passedTests = tested.filter((row) => row.result_status === 'PASSED').length;

  return {
    entitled: rows.length,
    activePasses: activePasses.length,
    actionRequired: rows.length - activePasses.length,
    nearExpiry,
    passRate: tested.length > 0 ? Math.round((passedTests / tested.length) * 100) : 0,
    suppliers: rows.filter((row) => row.participant_type === 'supplier').length,
    outsource: rows.filter((row) => row.participant_type === 'outsource').length,
  };
};
