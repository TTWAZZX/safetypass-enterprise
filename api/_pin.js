import { createHmac } from 'node:crypto';

const blockedPermanentPins = new Set(['000000', '123456']);

export const createSecurePinPassword = (nationalId, pin, pepper) => (
  `SafetyPass-v2-${createHmac('sha256', pepper).update(`${nationalId}:${pin}`).digest('base64url')}`
);

export const getPermanentPinError = (nationalId, pin) => {
  if (!/^\d{6}$/.test(String(pin || ''))) return 'PIN must contain exactly 6 digits';
  if (blockedPermanentPins.has(pin)) return 'PIN is too easy to guess';
  if (nationalId.slice(-6) === pin) return 'PIN must not match the last 6 digits of the national ID';
  return null;
};

