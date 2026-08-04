import { getSupabaseConfig, isRateLimited } from './_auth.js';

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
  if (!/^[0-9]{13}$/.test(nationalId)) return res.status(200).json({ ok: false });

  const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (isRateLimited(`prepare-staged-auth:${forwardedFor || 'unknown'}`, 750)) {
    return res.status(200).json({ ok: false });
  }

  try {
    const { url, anonKey } = getSupabaseConfig();
    const statusResponse = await fetch(`${url}/rest/v1/rpc/check_user_exists`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ search_id: nationalId }),
    });
    const statusRows = await safeJson(statusResponse);
    const status = Array.isArray(statusRows) ? statusRows[0] : null;
    if (!statusResponse.ok
      || status?.user_exists !== true
      || status?.is_active !== true) {
      return res.status(200).json({ ok: false });
    }

    const email = `${nationalId}@safetypass.com`;
    const pinPassword = `SafetyPass-${nationalId}-${nationalId.slice(-4)}`;

    const signUp = await authRequest(url, anonKey, '/auth/v1/signup', {
      email,
      password: pinPassword,
      data: { password_scheme: 'pin-v1' },
    });
    let session = sessionResult(signUp);

    if (!session) {
      const pinLogin = await authRequest(
        url,
        anonKey,
        '/auth/v1/token?grant_type=password',
        { email, password: pinPassword },
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
      if (session) {
        const passwordUpdate = await authRequest(
          url,
          anonKey,
          '/auth/v1/user',
          { password: pinPassword, data: { password_scheme: 'pin-v1' } },
          session.accessToken,
        );
        if (!passwordUpdate.ok) session = null;
      }
    }

    if (!session) return res.status(200).json({ ok: false });
    return res.status(200).json({
      ok: true,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    });
  } catch {
    return res.status(503).json({ ok: false });
  }
}
