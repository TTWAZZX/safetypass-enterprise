import {
  cleanText, getAuthPinPepper, getSupabaseServiceConfig, isRateLimited, requireAuthenticatedUser,
} from './_auth.js';
import { handleAdminResetUserPin } from './_adminPinReset.js';
import { handleAdminIdentityAction } from './_adminIdentity.js';
import { createSecurePinPassword, getPermanentPinError } from './_pin.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });
  if (req.body?.action === 'admin-reset-user-pin') return handleAdminResetUserPin(req, res);
  if (String(req.body?.action || '').startsWith('admin-identity-')
      || req.body?.action === 'admin-reveal-national-id'
      || req.body?.action === 'admin-export-national-ids'
      || req.body?.action === 'admin-correct-national-id'
      || req.body?.action === 'admin-recover-national-id-correction') {
    return handleAdminIdentityAction(req, res);
  }

  const auth = await requireAuthenticatedUser(req, res);
  if (!auth) return undefined;

  const nationalId = cleanText(req.body?.nationalId, 13);
  const pin = cleanText(req.body?.pin, 6);
  const expectedEmail = nationalId ? `${nationalId}@safetypass.com` : '';
  if (!nationalId || !/^\d{13}$/.test(nationalId) || !pin || getPermanentPinError(nationalId, pin)
      || auth.user?.email?.toLowerCase() !== expectedEmail.toLowerCase()) {
    return res.status(400).json({ message: 'PIN does not meet security requirements' });
  }

  const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (isRateLimited(`set-auth-pin:${auth.user.id}:${forwardedFor || 'unknown'}`, 750)) {
    return res.status(429).json({ message: 'Please wait before trying again' });
  }

  let config;
  let pepper;
  try {
    config = getSupabaseServiceConfig();
    pepper = getAuthPinPepper();
  } catch {
    return res.status(503).json({ message: 'Authentication service is not configured' });
  }

  try {
    const password = createSecurePinPassword(nationalId, pin, pepper);
    const passwordResponse = await fetch(`${config.url}/auth/v1/admin/users/${auth.user.id}`, {
      method: 'PUT',
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        password,
        user_metadata: {
          ...(auth.user.user_metadata || {}),
          password_scheme: 'pin-v2',
          must_change_pin: false,
        },
      }),
    });
    if (!passwordResponse.ok) {
      return res.status(503).json({ message: 'Unable to update authentication PIN' });
    }

    const stateResponse = await fetch(`${config.url}/rest/v1/rpc/complete_auth_pin_change`, {
      method: 'POST',
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_id_param: auth.user.id, national_id_param: nationalId }),
    });
    if (!stateResponse.ok) return res.status(503).json({ message: 'Unable to synchronize authentication PIN' });

    const sessionResponse = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: expectedEmail, password }),
    });
    const session = await sessionResponse.json().catch(() => null);
    if (!sessionResponse.ok || !session?.access_token || !session?.refresh_token) {
      return res.status(503).json({ message: 'PIN updated but the new session could not be created' });
    }
    return res.status(200).json({
      ok: true,
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
    });
  } catch {
    return res.status(503).json({ message: 'Authentication service is unavailable' });
  }
}
