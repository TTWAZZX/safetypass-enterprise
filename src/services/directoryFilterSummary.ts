export type CertificateFilter = '' | 'NO_CERT' | 'EXPIRING' | 'HAS_CERT';

const certificateLabels: Record<Exclude<CertificateFilter, ''>, string> = {
  NO_CERT: 'ไม่มีใบรับรอง/หมดอายุ',
  EXPIRING: 'ใกล้หมดอายุ',
  HAS_CERT: 'มีใบรับรอง',
};

export interface DirectoryFilterChip {
  kind: 'search' | 'vendor' | 'certificate';
  label: string;
}

export const buildDirectoryFilterSummary = ({ search, vendorId, vendorName, certificate }: {
  search: string;
  vendorId: string;
  vendorName?: string;
  certificate: CertificateFilter;
}): DirectoryFilterChip[] => {
  const chips: DirectoryFilterChip[] = [];
  if (search.trim()) chips.push({ kind: 'search', label: `ค้นหา: ${search.trim()}` });
  if (vendorId) chips.push({ kind: 'vendor', label: `บริษัท: ${vendorId === 'EXTERNAL' ? 'ไม่ระบุสังกัด' : vendorName || vendorId}` });
  if (certificate) chips.push({ kind: 'certificate', label: `สิทธิ์: ${certificateLabels[certificate]}` });
  return chips;
};

