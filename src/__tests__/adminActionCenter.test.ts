import { describe, expect, it } from 'vitest';
import { buildAdminActionItems } from '../services/adminActionCenter';

describe('buildAdminActionItems', () => {
  it('returns an empty center when no action is required', () => {
    expect(buildAdminActionItems({ failedExams: 0, suspendedUsers: 0, noCertificate: 0, expiredCertificates: 0, expiringCertificates: 0, supplierActions: 0 })).toEqual([]);
  });

  it('combines certificate states without changing source counts', () => {
    const items = buildAdminActionItems({ failedExams: 2, suspendedUsers: 1, noCertificate: 3, expiredCertificates: 4, expiringCertificates: 5, supplierActions: 6 });
    expect(items.find((item) => item.kind === 'COMPLIANCE')).toMatchObject({ count: 12, priority: 'high', destination: 'users' });
    expect(items.find((item) => item.kind === 'SUPPLIER')?.count).toBe(6);
  });

  it('treats near-expiry-only compliance as medium priority', () => {
    const items = buildAdminActionItems({ failedExams: 0, suspendedUsers: 0, noCertificate: 0, expiredCertificates: 0, expiringCertificates: 2, supplierActions: 0 });
    expect(items[0]).toMatchObject({ kind: 'COMPLIANCE', priority: 'medium' });
  });
});

