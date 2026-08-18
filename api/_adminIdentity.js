import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  cleanText, getAuthPinPepper, getSupabaseServiceConfig, isRateLimited, requireAdminUser,
} from './_auth.js';
import { createSecurePinPassword } from './_pin.js';

const STEP_UP_TTL_MS = 5 * 60_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID_PATTERN = /^\d{13}$/;
const safeJson = async (response) => response.json().catch(() => null);
const encode = (value) => Buffer.from(value).toString('base64url');
const fingerprint = (nationalId) => createHash('sha256').update(nationalId).digest('hex');

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
  const data = await safeJson(response);
  if (!response.ok) {
    const error = new Error(typeof data?.message === 'string' ? data.message : 'Identity service request failed');
    error.status = response.status;
    throw error;
  }
  return data;
};

const updateAuthUser = async (config, userId, nationalId, metadata = {}) => {
  const response = await fetch(`${config.url}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: `${nationalId}@safetypass.com`,
      email_confirm: true,
      password: createSecurePinPassword(nationalId, nationalId.slice(-6), getAuthPinPepper()),
      user_metadata: {
        ...metadata,
        password_scheme: 'pin-v2-admin-reset',
        must_change_pin: true,
      },
    }),
  });
  return { ok: response.ok, data: await safeJson(response) };
};

const getAuthUser = async (config, userId) => {
  const response = await fetch(`${config.url}/auth/v1/admin/users/${userId}`, {
    headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}` },
  });
  const data = await safeJson(response);
  if (!response.ok || data?.id !== userId) throw new Error('Target authentication account was not found');
  return data;
};

const createStepUpToken = (actorId, pepper) => {
  const payload = {
    actorId,
    issuedAt: Date.now(),
    expiresAt: Date.now() + STEP_UP_TTL_MS,
    nonce: randomBytes(16).toString('base64url'),
    scope: 'admin-identity',
  };
  const encoded = encode(JSON.stringify(payload));
  const signature = createHmac('sha256', pepper).update(encoded).digest('base64url');
  return { token: `${encoded}.${signature}`, expiresAt: new Date(payload.expiresAt).toISOString() };
};

const verifyStepUpToken = (token, actorId, pepper) => {
  if (typeof token !== 'string' || token.length > 1500) return false;
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra) return false;
  const expected = createHmac('sha256', pepper).update(encoded).digest();
  let received;
  try { received = Buffer.from(signature, 'base64url'); } catch { return false; }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    return payload.actorId === actorId
      && payload.scope === 'admin-identity'
      && Number(payload.issuedAt) <= Date.now()
      && Number(payload.expiresAt) > Date.now()
      && Number(payload.expiresAt) - Number(payload.issuedAt) <= STEP_UP_TTL_MS;
  } catch { return false; }
};

const verifyAdminPin = async (auth, pin, pepper) => {
  const email = String(auth.user?.email || '').toLowerCase();
  const match = email.match(/^(\d{13})@safetypass\.com$/);
  if (!match || !/^\d{4}(?:\d{2})?$/.test(pin)) return false;
  const nationalId = match[1];
  if (pin.length === 4 && pin !== nationalId.slice(-4)) return false;
  const passwords = pin.length === 6
    ? [createSecurePinPassword(nationalId, pin, pepper)]
    : [`SafetyPass-${nationalId}-${pin}`, nationalId];
  for (const password of passwords) {
    const response = await fetch(`${auth.config.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: auth.config.anonKey,
        Authorization: `Bearer ${auth.config.anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });
    const data = await safeJson(response);
    if (response.ok && data?.user?.id === auth.user.id) return true;
  }
  return false;
};

const validateReason = (value) => {
  const reason = cleanText(value, 500);
  if (!reason || /(^|[^0-9])[0-9]{13}([^0-9]|$)/.test(reason)) return null;
  return reason;
};

const beginAction = async (config, actorId, targetId, operation, reason) => serviceRpc(
  config,
  'service_begin_admin_identity_action',
  { actor_id_param: actorId, target_id_param: targetId || null, operation_param: operation, reason_param: reason },
);

const completeAction = async (config, attemptId, actorId, action, reason, succeeded, errorCode, metadata = {}) => serviceRpc(
  config,
  'service_complete_admin_identity_action',
  {
    attempt_id_param: attemptId,
    actor_id_param: actorId,
    action_param: action,
    reason_param: reason,
    succeeded_param: succeeded,
    error_code_param: errorCode || null,
    metadata_param: metadata,
  },
);

const requireStepUp = (req, auth, pepper) => verifyStepUpToken(req.body?.stepUpToken, auth.user.id, pepper);

const handleStepUp = async (req, res, auth, pepper) => {
  const pin = cleanText(req.body?.pin, 6);
  const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (!pin || isRateLimited(`admin-identity-step-up:${auth.user.id}:${forwardedFor || 'unknown'}`, 1500)) {
    return res.status(429).json({ message: 'Please wait before verifying again' });
  }
  if (!await verifyAdminPin(auth, pin, pepper)) return res.status(401).json({ message: 'PIN verification failed' });
  const stepUp = createStepUpToken(auth.user.id, pepper);
  return res.status(200).json({ ok: true, stepUpToken: stepUp.token, expiresAt: stepUp.expiresAt });
};

const handleReveal = async (req, res, auth, config, pepper) => {
  const userId = cleanText(req.body?.userId, 36);
  const reason = validateReason(req.body?.reason);
  if (!userId || !UUID_PATTERN.test(userId) || !reason) return res.status(400).json({ message: 'Invalid reveal request' });
  const attempt = await beginAction(config, auth.user.id, userId, 'REVEAL', reason);
  if (attempt?.allowed !== true) return res.status(429).json({ message: 'Reveal rate limit exceeded' });
  if (!requireStepUp(req, auth, pepper)) {
    await completeAction(config, attempt.attempt_id, auth.user.id, 'ADMIN_NATIONAL_ID_REVEAL_DENIED', reason, false, 'STEP_UP_REQUIRED');
    return res.status(401).json({ message: 'Recent PIN verification required' });
  }
  try {
    const target = await serviceRpc(config, 'service_get_admin_identity_target', { actor_id_param: auth.user.id, target_id_param: userId });
    if (!ID_PATTERN.test(String(target?.national_id || ''))) throw new Error('Protected identity is unavailable');
    await completeAction(config, attempt.attempt_id, auth.user.id, 'ADMIN_NATIONAL_ID_REVEAL_SUCCEEDED', reason, true, null);
    return res.status(200).json({ nationalId: target.national_id, expiresAt: new Date(Date.now() + 60_000).toISOString() });
  } catch {
    await completeAction(config, attempt.attempt_id, auth.user.id, 'ADMIN_NATIONAL_ID_REVEAL_DENIED', reason, false, 'REVEAL_FAILED').catch(() => null);
    return res.status(503).json({ message: 'Unable to reveal protected identity' });
  }
};

const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const handleExport = async (req, res, auth, config, pepper) => {
  const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds.filter((id) => UUID_PATTERN.test(String(id))) : [];
  const reason = validateReason(req.body?.reason);
  if (!reason || req.body?.confirmed !== true || userIds.length < 1 || userIds.length > 100) {
    return res.status(400).json({ message: 'Explicit export confirmation is required' });
  }
  const attempt = await beginAction(config, auth.user.id, null, 'EXPORT', reason);
  if (attempt?.allowed !== true) return res.status(429).json({ message: 'Full-ID export rate limit exceeded' });
  if (!requireStepUp(req, auth, pepper)) {
    await completeAction(config, attempt.attempt_id, auth.user.id, 'ADMIN_NATIONAL_ID_EXPORT_DENIED', reason, false, 'STEP_UP_REQUIRED');
    return res.status(401).json({ message: 'Recent PIN verification required' });
  }
  try {
    const rows = await serviceRpc(config, 'service_get_admin_identity_export', { actor_id_param: auth.user.id, target_ids_param: userIds });
    const csv = [
      ['User ID', 'National ID', 'Name', 'Vendor'].map(csvCell).join(','),
      ...(Array.isArray(rows) ? rows : []).map((row) => [row.user_id, row.national_id, row.name, row.vendor_name].map(csvCell).join(',')),
    ].join('\r\n');
    await completeAction(config, attempt.attempt_id, auth.user.id, 'ADMIN_NATIONAL_ID_EXPORT_SUCCEEDED', reason, true, null, { target_count: Array.isArray(rows) ? rows.length : 0 });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="protected-identities-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.status(200).send(`\uFEFF${csv}`);
  } catch {
    await completeAction(config, attempt.attempt_id, auth.user.id, 'ADMIN_NATIONAL_ID_EXPORT_DENIED', reason, false, 'EXPORT_FAILED').catch(() => null);
    return res.status(503).json({ message: 'Unable to export protected identities' });
  }
};

const handleCorrection = async (req, res, auth, config, pepper) => {
  const userId = cleanText(req.body?.userId, 36);
  const newNationalId = cleanText(req.body?.newNationalId, 13);
  const reason = validateReason(req.body?.reason);
  if (!userId || !UUID_PATTERN.test(userId) || !newNationalId || !ID_PATTERN.test(newNationalId) || !reason) {
    return res.status(400).json({ message: 'Invalid correction request' });
  }
  const attempt = await beginAction(config, auth.user.id, userId, 'CORRECT', reason);
  if (attempt?.allowed !== true) return res.status(429).json({ message: 'Correction rate limit exceeded' });
  if (!requireStepUp(req, auth, pepper)) {
    await serviceRpc(config, 'service_finish_admin_identity_attempt', { attempt_id_param: attempt.attempt_id, actor_id_param: auth.user.id, succeeded_param: false, error_code_param: 'STEP_UP_REQUIRED' });
    return res.status(401).json({ message: 'Recent PIN verification required' });
  }

  let operation;
  let targetAuth;
  try {
    targetAuth = await getAuthUser(config, userId);
    const publicTarget = await serviceRpc(config, 'service_get_admin_identity_target', { actor_id_param: auth.user.id, target_id_param: userId });
    if (!ID_PATTERN.test(String(publicTarget?.national_id || ''))
        || String(targetAuth.email || '').toLowerCase() !== `${publicTarget.national_id}@safetypass.com`.toLowerCase()) {
      throw new Error('Auth and public identity do not match');
    }
    operation = await serviceRpc(config, 'service_prepare_national_id_correction', {
      actor_id_param: auth.user.id, target_id_param: userId,
      new_national_id_param: newNationalId, reason_param: reason,
    });
    if (!ID_PATTERN.test(String(operation?.old_national_id || ''))) throw new Error('Existing identity is unavailable');

    const authUpdate = await updateAuthUser(config, userId, newNationalId, targetAuth.user_metadata || {});
    if (!authUpdate.ok) {
      await serviceRpc(config, 'service_fail_prepared_identity_correction', { operation_id_param: operation.operation_id, error_code_param: 'AUTH_UPDATE_FAILED' });
      throw new Error('Authentication identity update failed');
    }
    try {
      await serviceRpc(config, 'service_mark_identity_auth_updated', { operation_id_param: operation.operation_id });
      const finalized = await serviceRpc(config, 'service_finalize_national_id_correction', { operation_id_param: operation.operation_id, new_national_id_param: newNationalId });
      await serviceRpc(config, 'service_finish_admin_identity_attempt', { attempt_id_param: attempt.attempt_id, actor_id_param: auth.user.id, succeeded_param: true, error_code_param: null });
      return res.status(200).json({ ok: true, operationId: operation.operation_id, status: finalized.status, maskedNationalId: operation.new_masked_id, temporaryPinExpiresAt: finalized.temporary_pin_expires_at });
    } catch {
      const compensation = await updateAuthUser(config, userId, operation.old_national_id, targetAuth.user_metadata || {});
      if (compensation.ok) {
        const rolledBack = await serviceRpc(config, 'service_rollback_national_id_correction', { operation_id_param: operation.operation_id, error_code_param: 'FINALIZE_FAILED' });
        await serviceRpc(config, 'service_finish_admin_identity_attempt', { attempt_id_param: attempt.attempt_id, actor_id_param: auth.user.id, succeeded_param: false, error_code_param: 'ROLLED_BACK' });
        return res.status(409).json({ message: 'Correction was rolled back safely', operationId: operation.operation_id, status: rolledBack.status });
      }
      await serviceRpc(config, 'service_mark_identity_recovery_required', { operation_id_param: operation.operation_id, error_code_param: 'COMPENSATION_FAILED' });
      await serviceRpc(config, 'service_finish_admin_identity_attempt', { attempt_id_param: attempt.attempt_id, actor_id_param: auth.user.id, succeeded_param: false, error_code_param: 'RECOVERY_REQUIRED' });
      return res.status(503).json({ message: 'Correction requires administrator recovery', operationId: operation.operation_id, status: 'RECOVERY_REQUIRED' });
    }
  } catch (error) {
    await serviceRpc(config, 'service_finish_admin_identity_attempt', { attempt_id_param: attempt.attempt_id, actor_id_param: auth.user.id, succeeded_param: false, error_code_param: 'CORRECTION_FAILED' }).catch(() => null);
    return res.status(409).json({ message: error?.message === 'National ID already exists' ? error.message : 'Unable to correct protected identity' });
  }
};

const handleRecovery = async (req, res, auth, config, pepper) => {
  const operationId = cleanText(req.body?.operationId, 36);
  const reason = validateReason(req.body?.reason);
  if (!operationId || !UUID_PATTERN.test(operationId) || !reason) return res.status(400).json({ message: 'Invalid recovery request' });
  if (!requireStepUp(req, auth, pepper)) return res.status(401).json({ message: 'Recent PIN verification required' });
  const operation = await serviceRpc(config, 'service_get_identity_operation', { operation_id_param: operationId });
  if (operation.actor_user_id !== auth.user.id || operation.status !== 'RECOVERY_REQUIRED') return res.status(403).json({ message: 'Recovery operation is not available' });
  const attempt = await beginAction(config, auth.user.id, operation.target_user_id, 'RECOVER', reason);
  if (attempt?.allowed !== true) return res.status(429).json({ message: 'Recovery rate limit exceeded' });
  try {
    const target = await serviceRpc(config, 'service_get_admin_identity_target', { actor_id_param: auth.user.id, target_id_param: operation.target_user_id });
    const targetAuth = await getAuthUser(config, operation.target_user_id);
    const authNationalId = String(targetAuth.email || '').match(/^(\d{13})@safetypass\.com$/)?.[1];
    if (!authNationalId || !ID_PATTERN.test(String(target.national_id || ''))) throw new Error('RECOVERY_IDENTITY_MISMATCH');
    const authFingerprint = fingerprint(authNationalId);
    const publicFingerprint = fingerprint(target.national_id);
    const shouldFinalize = authFingerprint === operation.new_fingerprint || publicFingerprint === operation.new_fingerprint;
    const recoveryNationalId = shouldFinalize
      ? (authFingerprint === operation.new_fingerprint ? authNationalId : target.national_id)
      : (authFingerprint === operation.old_fingerprint ? authNationalId : target.national_id);
    const authUpdate = await updateAuthUser(config, operation.target_user_id, recoveryNationalId, targetAuth.user_metadata || {});
    if (!authUpdate.ok) throw new Error('RECOVERY_AUTH_FAILED');
    const result = shouldFinalize
      ? await serviceRpc(config, 'service_finalize_national_id_correction', { operation_id_param: operationId, new_national_id_param: recoveryNationalId })
      : await serviceRpc(config, 'service_rollback_national_id_correction', { operation_id_param: operationId, error_code_param: 'RECOVERED_TO_ORIGINAL' });
    await serviceRpc(config, 'service_finish_admin_identity_attempt', { attempt_id_param: attempt.attempt_id, actor_id_param: auth.user.id, succeeded_param: true, error_code_param: null });
    return res.status(200).json({ ok: true, operationId, status: result.status, temporaryPinExpiresAt: result.temporary_pin_expires_at });
  } catch (error) {
    const errorCode = error?.message === 'RECOVERY_IDENTITY_MISMATCH' ? 'RECOVERY_IDENTITY_MISMATCH' : 'RECOVERY_FAILED';
    await serviceRpc(config, 'service_finish_admin_identity_attempt', { attempt_id_param: attempt.attempt_id, actor_id_param: auth.user.id, succeeded_param: false, error_code_param: errorCode }).catch(() => null);
    return res.status(errorCode === 'RECOVERY_IDENTITY_MISMATCH' ? 409 : 503).json({ message: errorCode === 'RECOVERY_IDENTITY_MISMATCH' ? 'Recovery identities cannot be verified' : 'Recovery could not be completed' });
  }
};

export const handleAdminIdentityAction = async (req, res) => {
  const auth = await requireAdminUser(req, res);
  if (!auth) return undefined;
  let config;
  let pepper;
  try {
    config = getSupabaseServiceConfig();
    pepper = getAuthPinPepper();
  } catch {
    return res.status(503).json({ message: 'Privileged identity service is not configured' });
  }
  const action = req.body?.action;
  try {
    if (action === 'admin-identity-step-up') return handleStepUp(req, res, auth, pepper);
    if (action === 'admin-reveal-national-id') return handleReveal(req, res, auth, config, pepper);
    if (action === 'admin-export-national-ids') return handleExport(req, res, auth, config, pepper);
    if (action === 'admin-correct-national-id') return handleCorrection(req, res, auth, config, pepper);
    if (action === 'admin-recover-national-id-correction') return handleRecovery(req, res, auth, config, pepper);
    return res.status(400).json({ message: 'Unsupported identity action' });
  } catch (error) {
    const status = Number(error?.status) >= 400 && Number(error?.status) < 500 ? Number(error.status) : 503;
    return res.status(status).json({ message: status === 503 ? 'Privileged identity service is unavailable' : error.message });
  }
};
