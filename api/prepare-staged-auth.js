import { getSupabaseConfig, getSupabaseServiceConfig, isRateLimited } from './_auth.js';
import { createHash, randomBytes } from 'node:crypto';

const statusCache = new Map();
const STATUS_CACHE_MS = 2_000;

const safeJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return {};
  }
};

const authRequest = async (url, anonKey, path, body, accessToken) => {
  const response = await fetch(`${url}${path}`, {
    method: path === '/auth/v1/user' ? 'PUT' : 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken || anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, status: response.status, data: await safeJson(response) };
};

const sessionResult = (result) => {
  const accessToken = result.data?.access_token;
  const refreshToken = result.data?.refresh_token;
  return result.ok && typeof accessToken === 'string' && typeof refreshToken === 'string'
    ? { accessToken, refreshToken }
    : null;
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(200).json({ ok: false });

  const nationalId = typeof req.body?.nationalId === 'string' ? req.body.nationalId : '';
  const statusOnly = req.body?.action === 'status';
  if (!/^[0-9]{13}$/.test(nationalId)) {
    return statusOnly
      ? res.status(400).json({ message: 'Invalid identity' })
      : res.status(200).json({ ok: false });
  }

  const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const clientKey = forwardedFor || 'unknown';
  const identityKey = createHash('sha256').update(nationalId).digest('hex');
  const cached = statusCache.get(identityKey);
  if (statusOnly && cached && cached.expiresAt > Date.now()) {
    return res.status(200).json({ status: cached.status });
  }
  if (cached && cached.expiresAt <= Date.now()) statusCache.delete(identityKey);

  if (statusOnly && (
    isRateLimited(`registration-status-client:${clientKey}`, 750)
    || isRateLimited(`registration-status-identity:${identityKey}`, 1500)
  )) {
    return res.status(429).json({ message: 'Please wait before checking again' });
  }
  if (!statusOnly && isRateLimited(`prepare-staged-auth:${clientKey}`, 750)) {
    return res.status(200).json({ ok: false });
  }

  try {
    const { url, anonKey } = getSupabaseConfig();
    const { serviceKey } = getSupabaseServiceConfig();
    const statusResponse = await fetch(`${url}/rest/v1/rpc/check_user_exists`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ search_id: nationalId }),
    });
    const statusRows = await safeJson(statusResponse);
    const status = Array.isArray(statusRows) ? statusRows[0] : null;
    if (statusOnly) {
      if (!statusResponse.ok) {
        return res.status(503).json({ message: 'Registration service is unavailable' });
      }
      const safeStatus = status ? {
        user_exists: status.user_exists === true,
        requires_registration: status.requires_registration === true,
        is_active: status.is_active !== false,
      } : null;
      statusCache.set(identityKey, { status: safeStatus, expiresAt: Date.now() + STATUS_CACHE_MS });
      return res.status(200).json({ status: safeStatus });
    }
    if (!statusResponse.ok
      || status?.user_exists !== true
      || status?.is_active !== true) {
      return res.status(200).json({ ok: false });
    }

    const email = `${nationalId}@safetypass.com`;
    const bootstrapPassword = `SafetyPass-bootstrap-v2-${randomBytes(32).toString('base64url')}`;
    const legacyPinPassword = `SafetyPass-${nationalId}-${nationalId.slice(-4)}`;

    const signUp = await authRequest(url, anonKey, '/auth/v1/signup', {
      email,
      password: bootstrapPassword,
      data: { password_scheme: 'bootstrap-v2', must_change_pin: true },
    });
    let session = sessionResult(signUp);

    if (!session) {
      const pinLogin = await authRequest(
        url,
        anonKey,
        '/auth/v1/token?grant_type=password',
        { email, password: legacyPinPassword },
      );
      session = sessionResult(pinLogin);
    }

    if (!session) {
      const legacyLogin = await authRequest(
        url,
        anonKey,
        '/auth/v1/token?grant_type=password',
        { email, password: nationalId },
      );
      session = sessionResult(legacyLogin);
      // Keep the legacy credential unchanged until the authenticated user
      // chooses a private PIN v2 in the registration or migration screen.
    }

    if (!session) return res.status(200).json({ ok: false });
    return res.status(200).json({
      ok: true,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    });
  } catch {
    return statusOnly
      ? res.status(503).json({ message: 'Registration service is unavailable' })
      : res.status(503).json({ ok: false });
  }
}
