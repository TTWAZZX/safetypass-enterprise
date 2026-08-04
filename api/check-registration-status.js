import { cleanText, getSupabaseServiceConfig, isRateLimited } from './_auth.js';
import { createHash } from 'node:crypto';

const safeJson = async (response) => response.json().catch(() => null);
const statusCache = new Map();
const STATUS_CACHE_MS = 2_000;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  const nationalId = cleanText(req.body?.nationalId, 13);
  if (!nationalId || !/^\d{13}$/.test(nationalId)) {
    return res.status(400).json({ message: 'Invalid identity' });
  }

  const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const clientKey = forwardedFor || 'unknown';
  const identityKey = createHash('sha256').update(nationalId).digest('hex');
  const cached = statusCache.get(identityKey);
  if (cached && cached.expiresAt > Date.now()) {
    return res.status(200).json({ status: cached.status });
  }
  if (cached) statusCache.delete(identityKey);

  if (isRateLimited(`registration-status-client:${clientKey}`, 750)
      || isRateLimited(`registration-status-identity:${identityKey}`, 1500)) {
    return res.status(429).json({ message: 'Please wait before checking again' });
  }

  let config;
  try {
    config = getSupabaseServiceConfig();
  } catch {
    return res.status(503).json({ message: 'Registration service is not configured' });
  }

  try {
    const response = await fetch(`${config.url}/rest/v1/rpc/check_user_exists`, {
      method: 'POST',
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ search_id: nationalId }),
    });
    const rows = await safeJson(response);
    if (!response.ok) throw new Error('Registration status RPC failed');

    const status = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    const safeStatus = status ? {
      user_exists: status.user_exists === true,
      requires_registration: status.requires_registration === true,
      is_active: status.is_active !== false,
    } : null;
    statusCache.set(identityKey, { status: safeStatus, expiresAt: Date.now() + STATUS_CACHE_MS });
    return res.status(200).json({ status: safeStatus });
  } catch {
    return res.status(503).json({ message: 'Registration service is unavailable' });
  }
}
