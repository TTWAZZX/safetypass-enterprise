import { describe, expect, it } from 'vitest';
import { buildDirectoryFilterSummary } from '../services/directoryFilterSummary';

describe('directory filter summary', () => {
  it('returns no chips for the unfiltered directory', () => {
    expect(buildDirectoryFilterSummary({ search: '', vendorId: '', certificate: '' })).toEqual([]);
  });

  it('describes each active filter without changing its value', () => {
    expect(buildDirectoryFilterSummary({ search: ' สมชาย ', vendorId: 'vendor-1', vendorName: 'TSH', certificate: 'EXPIRING' })).toEqual([
      { kind: 'search', label: 'ค้นหา: สมชาย' },
      { kind: 'vendor', label: 'บริษัท: TSH' },
      { kind: 'certificate', label: 'สิทธิ์: ใกล้หมดอายุ' },
    ]);
  });

  it('uses a safe external-company label', () => {
    expect(buildDirectoryFilterSummary({ search: '', vendorId: 'EXTERNAL', certificate: '' })[0].label).toContain('ไม่ระบุสังกัด');
  });
});

