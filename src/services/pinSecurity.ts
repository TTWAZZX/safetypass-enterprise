export const LEGACY_PIN_LENGTH = 4;
export const SECURE_PIN_LENGTH = 6;

export const createLegacyPinPassword = (nationalId: string, pin: string) => (
  `SafetyPass-${nationalId}-${pin}`
);

export const getSecurePinError = (_nationalId: string, pin: string): string | null => {
  if (!/^\d{6}$/.test(pin)) return 'PIN ใหม่ต้องเป็นตัวเลข 6 หลัก';
  return null;
};
