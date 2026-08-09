export const LEGACY_PIN_LENGTH = 4;
export const SECURE_PIN_LENGTH = 6;

const blockedPins = new Set([
  '000000', '123456',
]);

export const createLegacyPinPassword = (nationalId: string, pin: string) => (
  `SafetyPass-${nationalId}-${pin}`
);

export const getSecurePinError = (nationalId: string, pin: string): string | null => {
  if (!/^\d{6}$/.test(pin)) return 'PIN ใหม่ต้องเป็นตัวเลข 6 หลัก';
  if (blockedPins.has(pin)) return 'PIN นี้คาดเดาง่ายเกินไป กรุณาเลือก PIN ใหม่';
  if (nationalId.slice(-6) === pin) return 'PIN ใหม่ต้องไม่ใช่เลข 6 หลักท้ายบัตรประชาชน';
  return null;
};
