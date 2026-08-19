export interface AdminPromotionCandidate {
  is_active?: boolean | null;
  pdpa_agreed?: boolean | null;
  last_login?: string | null;
}

export type AdminPromotionCheckCode = 'ACCOUNT_ACTIVE' | 'PDPA_AGREED' | 'HAS_LOGGED_IN';

export interface AdminPromotionCheck {
  code: AdminPromotionCheckCode;
  label: string;
  passed: boolean;
}

export interface AdminPromotionReadiness {
  eligible: boolean;
  checks: AdminPromotionCheck[];
  statusLabel: string;
  statusTone: 'emerald' | 'amber' | 'red' | 'slate';
}

export const getAdminPromotionReadiness = (
  user: AdminPromotionCandidate,
): AdminPromotionReadiness => {
  const accountActive = user.is_active === true;
  const pdpaAgreed = user.pdpa_agreed === true;
  const hasLoggedIn = Boolean(user.last_login);
  const checks: AdminPromotionCheck[] = [
    { code: 'ACCOUNT_ACTIVE', label: 'บัญชีเปิดใช้งาน', passed: accountActive },
    { code: 'PDPA_AGREED', label: 'ยอมรับ PDPA แล้ว', passed: pdpaAgreed },
    { code: 'HAS_LOGGED_IN', label: 'ลงทะเบียนและเข้าสู่ระบบสำเร็จแล้ว', passed: hasLoggedIn },
  ];

  if (!accountActive) {
    return { eligible: false, checks, statusLabel: 'บัญชีถูกระงับ', statusTone: 'red' };
  }
  if (!pdpaAgreed && !hasLoggedIn) {
    return { eligible: false, checks, statusLabel: 'ลงทะเบียนไม่ครบ', statusTone: 'amber' };
  }
  if (!pdpaAgreed) {
    return { eligible: false, checks, statusLabel: 'รอยอมรับ PDPA', statusTone: 'amber' };
  }
  if (!hasLoggedIn) {
    return { eligible: false, checks, statusLabel: 'รอเข้าใช้งาน', statusTone: 'slate' };
  }

  return { eligible: true, checks, statusLabel: 'พร้อมใช้งาน', statusTone: 'emerald' };
};
