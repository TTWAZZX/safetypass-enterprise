import { createHmac } from 'node:crypto';
import {
  cleanText, getAuthPinPepper, getSupabaseConfig, getSupabaseServiceConfig, isPinV2Enforced,
  isRateLimited,
} from './_auth.js';

const safeJson = async (response) => response.json().catch(() => null);

const rpc = async (config, name, body) => {
  const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await safeJson(response);
  if (!response.ok) throw new Error(`RPC ${name} failed`);
  return data;
};

const signIn = async (config, email, password) => {
  const response = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  return { ok: response.ok, data: await safeJson(response) };
};

const recoverBootstrapIdentity = async (config, userId, legacyPassword) => {
  if (!/^[0-9a-f-]{36}$/i.test(String(userId || ''))) return false;
  const headers = {
    apikey: config.serviceKey,
    Authorization: `Bearer ${config.serviceKey}`,
    'Content-Type': 'application/json',
  };
  const userResponse = await fetch(`${config.url}/auth/v1/admin/users/${userId}`, { headers });
  const authUser = await safeJson(userResponse);
  if (!userResponse.ok || authUser?.user_metadata?.password_scheme !== 'bootstrap-v2') return false;
  const updateResponse = await fetch(`${config.url}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      password: legacyPassword,
      user_metadata: {
        ...(authUser.user_metadata || {}),
        password_scheme: 'pin-v1-recovered',
        must_change_pin: true,
      },
    }),
  });
  return updateResponse.ok;
};

const securePinIsWeak = (nationalId, pin) => (
  !/^\d{6}$/.test(pin)
  || /^(\d)\1{5}$/.test(pin)
  || ['012345', '123456', '654321', '987654'].includes(pin)
  || nationalId.slice(-6) === pin
);

const createSecurePassword = (nationalId, pin, pepper) => (
  `SafetyPass-v2-${createHmac('sha256', pepper).update(`${nationalId}:${pin}`).digest('base64url')}`
);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  const nationalId = cleanText(req.body?.nationalId, 13);
  const pin = cleanText(req.body?.pin, 6);
  if (!nationalId || !/^\d{13}$/.test(nationalId) || !pin || !/^\d{4}(?:\d{2})?$/.test(pin)) {
    return res.status(400).json({ message: 'Invalid credentials' });
  }

  const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (isRateLimited(`auth-login:${forwardedFor || 'unknown'}:${nationalId}`, 750)) {
    return res.status(429).json({ message: 'Please wait before trying again' });
  }

  let publicConfig;
  let serviceConfig;
  let pinPepper;
  try {
    publicConfig = getSupabaseConfig();
    serviceConfig = getSupabaseServiceConfig();
    pinPepper = getAuthPinPepper();
  } catch {
    return res.status(503).json({ message: 'Authentication service is not configured' });
  }

  try {
    const context = await rpc(serviceConfig, 'get_auth_login_context', { national_id_param: nationalId });
    if (!context?.user_exists) return res.status(401).json({ message: 'Invalid credentials' });
    if (!context.is_active) return res.status(403).json({ message: 'Account is suspended' });
    if (context.locked_until && new Date(context.locked_until).getTime() > Date.now()) {
      return res.status(429).json({ message: 'Account is temporarily locked', lockedUntil: context.locked_until });
    }

    const pinVersion = Number(context.pin_version || 1);
    const isSecurePin = pin.length === 6;
    if (isSecurePin && securePinIsWeak(nationalId, pin)) {
      return res.status(400).json({ message: 'PIN does not meet security requirements' });
    }
    if (!isSecurePin && (pinVersion >= 2 || pin !== nationalId.slice(-4))) {
      await rpc(serviceConfig, 'record_auth_login_failure', { national_id_param: nationalId });
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const email = `${nationalId}@safetypass.com`;
    const passwords = isSecurePin
      ? [createSecurePassword(nationalId, pin, pinPepper)]
      : [`SafetyPass-${nationalId}-${pin}`, nationalId];
    let login = null;
    for (const password of passwords) {
      const result = await signIn(publicConfig, email, password);
      if (result.ok && result.data?.access_token && result.data?.refresh_token) {
        login = result.data;
        break;
      }
    }

    // A new registration can be committed immediately before its final PIN
    // update. If that last network call was interrupted, recover only accounts
    // explicitly marked with the random bootstrap scheme, then force PIN v2.
    if (!login && !isSecurePin && pinVersion < 2) {
      const recovered = await recoverBootstrapIdentity(serviceConfig, context.user_id, passwords[0]);
      if (recovered) {
        const result = await signIn(publicConfig, email, passwords[0]);
        if (result.ok && result.data?.access_token && result.data?.refresh_token) login = result.data;
      }
    }

    if (!login) {
      const failure = await rpc(serviceConfig, 'record_auth_login_failure', { national_id_param: nationalId });
      return res.status(failure?.locked_until ? 429 : 401).json({
        message: failure?.locked_until ? 'Account is temporarily locked' : 'Invalid credentials',
        lockedUntil: failure?.locked_until || null,
      });
    }

    await rpc(serviceConfig, 'record_auth_login_success', {
      national_id_param: nationalId,
      pin_version_param: isSecurePin ? 2 : 1,
    });

    return res.status(200).json({
      accessToken: login.access_token,
      refreshToken: login.refresh_token,
      requiresPinUpgrade: !isSecurePin && isPinV2Enforced(),
    });
  } catch {
    return res.status(503).json({ message: 'Authentication service is unavailable' });
  }
}
