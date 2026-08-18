import {
  cleanText, getAuthPinPepper, getSupabaseServiceConfig, isRateLimited, requireAdminUser,
} from './_auth.js';
import { createSecurePinPassword } from './_pin.js';

const safeJson = async (response) => response.json().catch(() => null);

const authorizedRpc = async (auth, name, body) => {
  const response = await fetch(`${auth.config.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: auth.config.anonKey,
      Authorization: auth.authorization,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, data: await safeJson(response) };
};

const serviceRpc = async (config, name, body) => {
  const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, data: await safeJson(response) };
};

export const handleAdminResetUserPin = async (req, res) => {
  const auth = await requireAdminUser(req, res);
  if (!auth) return undefined;

  const userId = cleanText(req.body?.userId, 36);
  if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return res.status(400).json({ message: 'Invalid user ID' });
  }
  if (userId === auth.user.id) return res.status(400).json({ message: 'Administrators cannot reset their own PIN here' });

  const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (isRateLimited(`admin-reset-user-pin:${auth.user.id}:${userId}:${forwardedFor || 'unknown'}`, 1500)) {
    return res.status(429).json({ message: 'Please wait before resetting this PIN again' });
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
    let resetUserId = userId;
    let authUserResponse = await fetch(`${config.url}/auth/v1/admin/users/${resetUserId}`, {
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
      },
    });
    let targetAuthUser = await safeJson(authUserResponse);

    // Legacy registrations can have one valid Auth identity whose UUID differs
    // from the surviving public profile UUID. Recover only that unambiguous
    // case through the service-role atomic relink RPC, then continue normally.
    if (!authUserResponse.ok) {
      const relink = await serviceRpc(config, 'service_relink_orphaned_profile_for_pin_reset', {
        actor_id_param: auth.user.id,
        target_user_id_param: userId,
      });
      const canonicalUserId = String(relink.data?.user_id || '');
      if (!relink.ok || !/^[0-9a-f-]{36}$/i.test(canonicalUserId)) {
        return res.status(409).json({ message: 'This user does not have a resettable authentication account' });
      }
      resetUserId = canonicalUserId;
      authUserResponse = await fetch(`${config.url}/auth/v1/admin/users/${resetUserId}`, {
        headers: {
          apikey: config.serviceKey,
          Authorization: `Bearer ${config.serviceKey}`,
        },
      });
      targetAuthUser = await safeJson(authUserResponse);
    }

    const targetEmail = String(targetAuthUser?.email || '').toLowerCase();
    const emailMatch = targetEmail.match(/^(\d{13})@safetypass\.com$/);
    if (!authUserResponse.ok || !emailMatch || targetAuthUser?.id !== resetUserId) {
      return res.status(409).json({ message: 'This user does not have a resettable authentication account' });
    }

    const begin = await serviceRpc(config, 'service_begin_admin_pin_reset', {
      actor_id_param: auth.user.id,
      user_id_param: resetUserId,
    });
    if (!begin.ok || begin.data?.reset_state !== 'PENDING') {
      const message = typeof begin.data?.message === 'string' ? begin.data.message : 'Unable to prepare PIN reset';
      return res.status(400).json({ message });
    }

    const nationalId = emailMatch[1];
    const temporaryPin = nationalId.slice(-6);
    const password = createSecurePinPassword(nationalId, temporaryPin, pepper);
    const passwordResponse = await fetch(`${config.url}/auth/v1/admin/users/${resetUserId}`, {
      method: 'PUT',
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        password,
        user_metadata: {
          ...(targetAuthUser.user_metadata || {}),
          password_scheme: 'pin-v2-admin-reset',
          must_change_pin: true,
        },
      }),
    });
    if (!passwordResponse.ok) {
      return res.status(503).json({ message: 'Unable to update the temporary authentication PIN; retry the reset' });
    }

    const activated = await serviceRpc(config, 'service_activate_admin_pin_reset', {
      actor_id_param: auth.user.id,
      user_id_param: resetUserId,
    });
    if (!activated.ok || activated.data?.reset_state !== 'ACTIVE') {
      return res.status(503).json({ message: 'PIN was prepared but reset activation failed; retry the reset' });
    }

    return res.status(200).json({
      ok: true,
      expiresAt: activated.data.expires_at,
    });
  } catch {
    return res.status(503).json({ message: 'PIN reset service is unavailable' });
  }
};
