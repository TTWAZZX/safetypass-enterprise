import { describe, expect, it } from 'vitest';
import { getImportSummary, prepareUserImportRows, prepareVendorImportRows } from '../services/importValidation';

describe('import preview validation', () => {
  it('preserves valid user mapping and ISO expiry dates', () => {
    const [row] = prepareUserImportRows([{ Name: 'สมชาย', 'National ID': '1234567890123', Vendor: 'TSH', 'Induction Expiry': '2026-03-15' }], [{ id: 'v1', name: 'TSH' }]);
    expect(row).toMatchObject({ rowNumber: 2, name: 'สมชาย', nationalId: '1234567890123', vendorId: 'v1', issues: [] });
    const expiry = new Date(row.inductionExpiry!);
    expect([expiry.getFullYear(), expiry.getMonth() + 1, expiry.getDate()]).toEqual([2026, 3, 15]);
  });

  it('blocks rows missing required identity and warns without changing legacy fallbacks', () => {
    const [row] = prepareUserImportRows([{ Name: '', Vendor: 'Unknown', 'Induction Expiry': 'bad-date' }], []);
    expect(row.issues.filter((issue) => issue.level === 'error')).toHaveLength(2);
    expect(row.issues.filter((issue) => issue.level === 'warning')).toHaveLength(2);
    expect(row.vendorId).toBeNull();
    expect(row.inductionExpiry).toBeNull();
  });

  it('warns about duplicate vendor names inside the selected file', () => {
    const rows = prepareVendorImportRows([{ Name: 'ABC Co.' }, { Name: 'abc co.' }]);
    expect(rows[1].issues[0].level).toBe('warning');
    expect(getImportSummary(rows)).toEqual({ total: 2, ready: 2, warning: 1, error: 0 });
  });
});
