export type ExpiryState = 'NONE' | 'VALID' | 'EXPIRING' | 'URGENT' | 'EXPIRED';

export interface ExpiryStatus {
  state: ExpiryState;
  daysRemaining: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** UI-only expiry classification; it does not replace existing access checks. */
export const getExpiryStatus = (
  value: string | null | undefined,
  now = new Date(),
): ExpiryStatus => {
  if (!value) return { state: 'NONE', daysRemaining: null };
  const expiry = new Date(value);
  if (Number.isNaN(expiry.getTime())) return { state: 'NONE', daysRemaining: null };

  const difference = expiry.getTime() - now.getTime();
  const daysRemaining = Math.ceil(difference / DAY_MS);
  if (difference <= 0) return { state: 'EXPIRED', daysRemaining: 0 };
  if (daysRemaining <= 7) return { state: 'URGENT', daysRemaining };
  if (daysRemaining <= 30) return { state: 'EXPIRING', daysRemaining };
  return { state: 'VALID', daysRemaining };
};

export const getExpiryLabel = (status: ExpiryStatus, language: 'th' | 'en') => {
  if (status.state === 'NONE') return language === 'th' ? 'ไม่ระบุวันหมดอายุ' : 'No expiry date';
  if (status.state === 'EXPIRED') return language === 'th' ? 'หมดอายุแล้ว' : 'Expired';
  if (status.daysRemaining === 1) return language === 'th' ? 'เหลือ 1 วัน' : '1 day remaining';
  return language === 'th'
    ? `เหลือ ${status.daysRemaining} วัน`
    : `${status.daysRemaining} days remaining`;
};

