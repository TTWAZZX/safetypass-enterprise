export interface AdminActionInput {
  failedExams: number;
  suspendedUsers: number;
  noCertificate: number;
  expiredCertificates: number;
  expiringCertificates: number;
  supplierActions: number;
}

export type AdminActionKind = 'COMPLIANCE' | 'SUSPENDED' | 'RETAKE' | 'SUPPLIER';

export interface AdminActionItem {
  kind: AdminActionKind;
  count: number;
  priority: 'high' | 'medium';
  destination: 'users' | 'supplier';
}

export const buildAdminActionItems = (input: AdminActionInput): AdminActionItem[] => {
  const items: AdminActionItem[] = [
    {
      kind: 'COMPLIANCE',
      count: input.noCertificate + input.expiredCertificates + input.expiringCertificates,
      priority: input.noCertificate + input.expiredCertificates > 0 ? 'high' : 'medium',
      destination: 'users',
    },
    { kind: 'SUSPENDED', count: input.suspendedUsers, priority: 'high', destination: 'users' },
    { kind: 'RETAKE', count: input.failedExams, priority: 'medium', destination: 'users' },
    { kind: 'SUPPLIER', count: input.supplierActions, priority: 'medium', destination: 'supplier' },
  ];

  return items.filter((item) => item.count > 0);
};

