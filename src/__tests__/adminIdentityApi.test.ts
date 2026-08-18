import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/set-auth-pin.js';

const adminId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000002';
const operationId = '30000000-0000-4000-8000-000000000003';
const attemptId = '40000000-0000-4000-8000-000000000004';
const adminNationalId = '1999999999999';
const oldNationalId = '1234567890123';
const newNationalId = '1888888888881';
const pepper = 'test-pin-pepper-that-is-longer-than-32-characters';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

const invoke = async (body: Record<string, unknown>, ip: string) => {
  let status = 0;
  let responseBody: any;
  let sentBody: any;
  const headers = new Map<string, string>();
  const response = {
    setHeader: vi.fn((name: string, value: string) => headers.set(name.toLowerCase(), value)),
    status(value: number) { status = value; return this; },
    json(value: unknown) { responseBody = value; return this; },
    send(value: unknown) { sentBody = value; return this; },
  };
  await handler({
    method: 'POST', body, headers: { authorization: 'Bearer admin-access-token', 'x-forwarded-for': ip },
  }, response);
  return { status, body: responseBody, sentBody, headers };
};

const configure = () => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  process.env.AUTH_PIN_PEPPER = pepper;
};

const obtainStepUp = async (ip: string) => {
  const upstream = vi.fn()
    .mockResolvedValueOnce(jsonResponse({ id: adminId, email: `${adminNationalId}@safetypass.com` }))
    .mockResolvedValueOnce(jsonResponse(true))
    .mockResolvedValueOnce(jsonResponse({ user: { id: adminId }, access_token: 'discarded-token' }));
  vi.stubGlobal('fetch', upstream);
  const result = await invoke({ action: 'admin-identity-step-up', pin: '123456' }, ip);
  expect(result.status).toBe(200);
  expect(result.headers.get('cache-control')).toBe('no-store');
  expect(result.body.stepUpToken).toBeTypeOf('string');
  expect(JSON.stringify(result.body)).not.toContain(adminNationalId);
  return result.body.stepUpToken as string;
};

describe('admin privileged identity API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.AUTH_PIN_PEPPER;
  });

  it('uses server-side PIN verification and a short-lived signed step-up token', async () => {
    configure();
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: adminId, email: `${adminNationalId}@safetypass.com` }))
      .mockResolvedValueOnce(jsonResponse(true))
      .mockResolvedValueOnce(jsonResponse({ user: { id: adminId }, access_token: 'discarded-token' }));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke({ action: 'admin-identity-step-up', pin: '123456' }, '192.0.2.60');
    const signInBody = JSON.parse(String(upstream.mock.calls[2][1]?.body));
    const digest = createHmac('sha256', pepper).update(`${adminNationalId}:123456`).digest('base64url');

    expect(result.status).toBe(200);
    expect(signInBody.password).toBe(`SafetyPass-v2-${digest}`);
    expect(result.body.stepUpToken).not.toContain(adminNationalId);
    expect(new Date(result.body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(5 * 60_000);
  });

  it('reveals one identity with no-store and records a redacted success event', async () => {
    configure();
    const token = await obtainStepUp('192.0.2.61');
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: adminId, email: `${adminNationalId}@safetypass.com` }))
      .mockResolvedValueOnce(jsonResponse(true))
      .mockResolvedValueOnce(jsonResponse({ allowed: true, attempt_id: attemptId }))
      .mockResolvedValueOnce(jsonResponse({ id: userId, national_id: oldNationalId, role: 'USER' }))
      .mockResolvedValueOnce(jsonResponse(null));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke({ action: 'admin-reveal-national-id', userId, reason: 'Verify access document', stepUpToken: token }, '192.0.2.62');

    expect(result.status).toBe(200);
    expect(result.body.nationalId).toBe(oldNationalId);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(String(upstream.mock.calls[4][1]?.body)).not.toContain(oldNationalId);
    expect(new Date(result.body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(60_000);
  });

  it('denies reveal when the step-up token is invalid and records only redacted metadata', async () => {
    configure();
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: adminId, email: `${adminNationalId}@safetypass.com` }))
      .mockResolvedValueOnce(jsonResponse(true))
      .mockResolvedValueOnce(jsonResponse({ allowed: true, attempt_id: attemptId }))
      .mockResolvedValueOnce(jsonResponse(null));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke({ action: 'admin-reveal-national-id', userId, reason: 'Verify access document', stepUpToken: 'tampered.token' }, '192.0.2.67');

    expect(result).toMatchObject({ status: 401, body: { message: 'Recent PIN verification required' } });
    expect(upstream).toHaveBeenCalledTimes(4);
    expect(String(upstream.mock.calls[3][1]?.body)).not.toContain(oldNationalId);
  });

  it('requires explicit confirmation before creating a full-ID export', async () => {
    configure();
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: adminId, email: `${adminNationalId}@safetypass.com` }))
      .mockResolvedValueOnce(jsonResponse(true));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke({ action: 'admin-export-national-ids', userIds: [userId], reason: 'Approved PDPA request' }, '192.0.2.70');

    expect(result).toMatchObject({ status: 400, body: { message: 'Explicit export confirmation is required' } });
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('completes Auth and public identity correction without returning the full ID or PIN', async () => {
    configure();
    const token = await obtainStepUp('192.0.2.63');
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: adminId, email: `${adminNationalId}@safetypass.com` }))
      .mockResolvedValueOnce(jsonResponse(true))
      .mockResolvedValueOnce(jsonResponse({ allowed: true, attempt_id: attemptId }))
      .mockResolvedValueOnce(jsonResponse({ id: userId, email: `${oldNationalId}@safetypass.com`, user_metadata: { name: 'Target' } }))
      .mockResolvedValueOnce(jsonResponse({ id: userId, national_id: oldNationalId, role: 'USER' }))
      .mockResolvedValueOnce(jsonResponse({ operation_id: operationId, old_national_id: oldNationalId, new_masked_id: '188••••••8881' }))
      .mockResolvedValueOnce(jsonResponse({ id: userId }))
      .mockResolvedValueOnce(jsonResponse(null))
      .mockResolvedValueOnce(jsonResponse({ status: 'COMPLETED', temporary_pin_expires_at: expiresAt }))
      .mockResolvedValueOnce(jsonResponse(null));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke({ action: 'admin-correct-national-id', userId, newNationalId, reason: 'Correct verified document', stepUpToken: token }, '192.0.2.64');
    const authUpdate = JSON.parse(String(upstream.mock.calls[6][1]?.body));

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, operationId, status: 'COMPLETED', maskedNationalId: '188••••••8881' });
    expect(JSON.stringify(result.body)).not.toContain(newNationalId);
    expect(authUpdate.email).toBe(`${newNationalId}@safetypass.com`);
    expect(authUpdate.password).not.toContain(newNationalId);
    expect(authUpdate.password).not.toContain(newNationalId.slice(-6));
    expect(authUpdate.user_metadata.must_change_pin).toBe(true);
  });

  it('compensates Auth and marks the operation rolled back when public finalize fails', async () => {
    configure();
    const token = await obtainStepUp('192.0.2.65');
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: adminId, email: `${adminNationalId}@safetypass.com` }))
      .mockResolvedValueOnce(jsonResponse(true))
      .mockResolvedValueOnce(jsonResponse({ allowed: true, attempt_id: attemptId }))
      .mockResolvedValueOnce(jsonResponse({ id: userId, email: `${oldNationalId}@safetypass.com`, user_metadata: {} }))
      .mockResolvedValueOnce(jsonResponse({ id: userId, national_id: oldNationalId, role: 'USER' }))
      .mockResolvedValueOnce(jsonResponse({ operation_id: operationId, old_national_id: oldNationalId, new_masked_id: '188••••••8881' }))
      .mockResolvedValueOnce(jsonResponse({ id: userId }))
      .mockResolvedValueOnce(jsonResponse(null))
      .mockResolvedValueOnce(jsonResponse({ message: 'Injected finalize failure' }, 500))
      .mockResolvedValueOnce(jsonResponse({ id: userId }))
      .mockResolvedValueOnce(jsonResponse({ status: 'ROLLED_BACK', temporary_pin_expires_at: expiresAt }))
      .mockResolvedValueOnce(jsonResponse(null));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke({ action: 'admin-correct-national-id', userId, newNationalId, reason: 'Failure injection rollback', stepUpToken: token }, '192.0.2.66');
    const compensation = JSON.parse(String(upstream.mock.calls[9][1]?.body));

    expect(result).toMatchObject({ status: 409, body: { operationId, status: 'ROLLED_BACK' } });
    expect(compensation.email).toBe(`${oldNationalId}@safetypass.com`);
    expect(compensation.password).not.toContain(oldNationalId);
  });

  it('marks recovery required when both finalize and Auth compensation fail', async () => {
    configure();
    const token = await obtainStepUp('192.0.2.68');
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: adminId, email: `${adminNationalId}@safetypass.com` }))
      .mockResolvedValueOnce(jsonResponse(true))
      .mockResolvedValueOnce(jsonResponse({ allowed: true, attempt_id: attemptId }))
      .mockResolvedValueOnce(jsonResponse({ id: userId, email: `${oldNationalId}@safetypass.com`, user_metadata: {} }))
      .mockResolvedValueOnce(jsonResponse({ id: userId, national_id: oldNationalId, role: 'USER' }))
      .mockResolvedValueOnce(jsonResponse({ operation_id: operationId, old_national_id: oldNationalId, new_masked_id: '188••••••8881' }))
      .mockResolvedValueOnce(jsonResponse({ id: userId }))
      .mockResolvedValueOnce(jsonResponse(null))
      .mockResolvedValueOnce(jsonResponse({ message: 'Injected finalize failure' }, 500))
      .mockResolvedValueOnce(jsonResponse({ message: 'Injected compensation failure' }, 500))
      .mockResolvedValueOnce(jsonResponse(null))
      .mockResolvedValueOnce(jsonResponse(null));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke({ action: 'admin-correct-national-id', userId, newNationalId, reason: 'Failure injection recovery', stepUpToken: token }, '192.0.2.69');

    expect(result).toMatchObject({ status: 503, body: { operationId, status: 'RECOVERY_REQUIRED' } });
    expect(String(upstream.mock.calls[10][0])).toContain('service_mark_identity_recovery_required');
    expect(JSON.stringify(result.body)).not.toContain(newNationalId);
  });
});
