import { cleanText, getSupabaseServiceConfig, isRateLimited, requireAuthenticatedUser } from './_auth.js';

export async function handleLinkLineIdentity(req, res) {
  const auth = await requireAuthenticatedUser(req, res);
  if (!auth) return;
  const token = cleanText(req.body?.lineAccessToken, 4096);
  if (!token) return res.status(400).json({ message: 'LINE access token is required' });
  if (await isRateLimited(`line-identity:${auth.user.id}`, 1500)) {
    return res.status(429).json({ message: 'Please wait before trying again' });
  }

  const channelId = process.env.LINE_LOGIN_CHANNEL_ID?.trim();
  if (!channelId || !/^\d+$/.test(channelId)) {
    return res.status(503).json({ message: 'LINE login is not configured' });
  }

  try {
    const verificationUrl = new URL('https://api.line.me/oauth2/v2.1/verify');
    verificationUrl.searchParams.set('access_token', token);
    const verification = await fetch(verificationUrl, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (verification.status >= 500 || verification.status === 429) {
      return res.status(503).json({ message: 'LINE login is unavailable' });
    }
    const claims = verification.ok ? await verification.json() : null;
    if (String(claims?.client_id) !== channelId || !(Number(claims?.expires_in) > 0)) {
      return res.status(403).json({ message: 'LINE session is invalid or expired' });
    }

    const response = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return res.status(response.status === 401 || response.status === 403 ? 403 : 503)
        .json({ message: 'Unable to verify LINE profile' });
    }
    const profile = await response.json();
    if (!/^U[0-9a-f]{32}$/i.test(profile?.userId || '')) {
      return res.status(403).json({ message: 'Invalid LINE profile' });
    }
    const pictureUrl = typeof profile.pictureUrl === 'string'
      && /^https:\/\/profile\.line-scdn\.net\//i.test(profile.pictureUrl)
      && profile.pictureUrl.length <= 2048 ? profile.pictureUrl : null;

    const config = getSupabaseServiceConfig();
    const stored = await fetch(`${config.url}/rest/v1/rpc/service_store_verified_line_identity`, {
      method: 'POST',
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id_param: auth.user.id,
        line_user_id_param: profile.userId,
        picture_url_param: pictureUrl,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (stored.status === 409) return res.status(409).json({ message: 'LINE account is already linked' });
    if (!stored.ok) return res.status(503).json({ message: 'Unable to save LINE profile' });
    if (await stored.json() !== true) return res.status(403).json({ message: 'Account is not eligible to link LINE' });
    return res.status(200).json({ avatarUrl: pictureUrl });
  } catch {
    return res.status(503).json({ message: 'LINE account verification is unavailable' });
  }
}
