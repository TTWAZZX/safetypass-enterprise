const requestLimits = new Map();

export function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL
    || process.env.NEXT_PUBLIC_SUPABASE_URL
    || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('Missing Supabase server configuration');
  return { url: url.replace(/\/$/, ''), anonKey };
}

export function getSupabaseServiceConfig() {
  const { url, anonKey } = getSupabaseConfig();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('Missing Supabase service role configuration');
  return { url, anonKey, serviceKey };
}

export function getAuthPinPepper() {
  const pepper = process.env.AUTH_PIN_PEPPER;
  if (!pepper || pepper.length < 32) throw new Error('Missing or weak authentication PIN pepper');
  return pepper;
}

export function isPinV2Enforced() {
  return process.env.AUTH_PIN_V2_ENFORCEMENT === 'true';
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

export async function requireAdminUser(req, res) {
  const auth = await requireAuthenticatedUser(req, res);
  if (!auth) return null;

  try {
    const response = await fetch(`${auth.config.url}/rest/v1/rpc/get_my_admin_status`, {
      method: 'POST',
      headers: {
        apikey: auth.config.anonKey,
        Authorization: auth.authorization,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!response.ok) {
      res.status(403).json({ message: 'Admin access required' });
      return null;
    }
    const value = await response.json();
    const isAdmin = value === true
      || value?.[0] === true
      || value?.[0]?.get_my_admin_status === true;
    if (!isAdmin) {
      res.status(403).json({ message: 'Admin access required' });
      return null;
    }
    return auth;
  } catch {
    res.status(503).json({ message: 'Admin authorization service is unavailable' });
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
