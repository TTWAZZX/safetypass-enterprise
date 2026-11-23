export const LEGACY_PIN_LENGTH = 4;
export const SECURE_PIN_LENGTH = 6;

export const createLegacyPinPassword = (nationalId: string, pin: string) => (
  `SafetyPass-${nationalId}-${pin}`
);

export const getSecurePinError = (nationalId: string, pin: string): string | null => {
  if (nationalId.length === 13 && pin === nationalId.slice(-6)) return 'กรุณาตั้ง PIN ให้ต่างจาก 6 หลักท้ายเลขบัตร';
  if (!/^\d{6}$/.test(pin)) return 'PIN ใหม่ต้องเป็นตัวเลข 6 หลัก';
  return null;
};
