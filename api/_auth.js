const requestLimits = new Map();

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('Missing Supabase server configuration');
  return { url: url.replace(/\/$/, ''), anonKey };
}

export async function requireAuthenticatedUser(req, res) {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Authentication required' });
    return null;
  }

  let config;
  try {
    config = getSupabaseConfig();
  } catch {
    res.status(500).json({ message: 'Server authentication is not configured' });
    return null;
  }

  try {
    const response = await fetch(`${config.url}/auth/v1/user`, {
      headers: { apikey: config.anonKey, Authorization: authorization },
    });
    if (!response.ok) {
      res.status(401).json({ message: 'Invalid or expired session' });
      return null;
    }
    return { user: await response.json(), config, authorization };
  } catch {
    res.status(503).json({ message: 'Authentication service is unavailable' });
    return null;
  }
}

export function isRateLimited(key, intervalMs) {
  const now = Date.now();
  const previous = requestLimits.get(key);
  if (previous && now - previous < intervalMs) return true;
  requestLimits.set(key, now);
  return false;
}

export function cleanText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/[\u0000-\u001F\u007F]/g, '');
  return text.length > 0 && text.length <= maxLength ? text : null;
}
