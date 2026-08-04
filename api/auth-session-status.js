import { getSupabaseServiceConfig, isPinV2Enforced, requireAuthenticatedUser } from './_auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method Not Allowed' });

  const auth = await requireAuthenticatedUser(req, res);
  if (!auth) return undefined;

  const email = String(auth.user?.email || '').toLowerCase();
  const nationalId = email.endsWith('@safetypass.com') ? email.slice(0, -'@safetypass.com'.length) : '';
  if (!/^\d{13}$/.test(nationalId)) return res.status(403).json({ message: 'Unsupported authentication identity' });

  let config;
  try {
    config = getSupabaseServiceConfig();
  } catch {
    return res.status(503).json({ message: 'Authentication service is not configured' });
  }

  try {
    const response = await fetch(`${config.url}/rest/v1/rpc/get_auth_login_context`, {
      method: 'POST',
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ national_id_param: nationalId }),
    });
    const context = await response.json().catch(() => null);
    if (!response.ok || !context?.user_exists || !context?.is_active) {
      return res.status(403).json({ message: 'Account is not available' });
    }
    return res.status(200).json({
      requiresPinUpgrade: isPinV2Enforced() && Number(context.pin_version || 1) < 2,
    });
  } catch {
    return res.status(503).json({ message: 'Authentication service is unavailable' });
  }
}
