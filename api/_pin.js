import { createHmac } from 'node:crypto';

export const createSecurePinPassword = (nationalId, pin, pepper) => (
  `SafetyPass-v2-${createHmac('sha256', pepper).update(`${nationalId}:${pin}`).digest('base64url')}`
);

export const getPermanentPinError = (nationalId, pin) => {
  if (!/^\d{6}$/.test(String(pin || ''))) return 'PIN must contain exactly 6 digits';
  if (pin === nationalId?.slice(-6)) return 'Choose a PIN different from your initial PIN';
  return null;
};
