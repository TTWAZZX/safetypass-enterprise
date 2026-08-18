import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/set-auth-pin.js';

const adminId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000002';
const nationalId = '1234567890123';
const pepper = 'test-pin-pepper-that-is-longer-than-32-characters';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const invoke = async (body: unknown, ip: string, authorization = 'Bearer admin-access-token') => {
  let status = 0;
  let responseBody: any;
  const response = {
    setHeader: vi.fn(),
    status(value: number) { status = value; return this; },
    json(value: unknown) { responseBody = value; return this; },
  };
  await handler({
    method: 'POST', body: { action: 'admin-reset-user-pin', ...(body as object) }, headers: { authorization, 'x-forwarded-for': ip },
  }, response);
  return { status, body: responseBody };
};

describe('admin-reset-user-pin API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.AUTH_PIN_PEPPER;
  });

  const configure = () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
    process.env.AUTH_PIN_PEPPER = pepper;
  };

  it('resets a USER to a server-derived temporary last-six PIN and activates the audit state', async () => {
    configure();
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: adminId, email: '1999999999999@safetypass.com' }))
      .mockResolvedValueOnce(jsonResponse(true))
      .mockResolvedValueOnce(jsonResponse({
        id: userId,
        email: `${nationalId}@safetypass.com`,
        user_metadata: { name: 'Reset User' },
      }))
      .mockResolvedValueOnce(jsonResponse({ user_id: userId, reset_state: 'PENDING', expires_at: expiresAt }))
      .mockResolvedValueOnce(jsonResponse({ id: userId }))
      .mockResolvedValueOnce(jsonResponse({ user_id: userId, reset_state: 'ACTIVE', expires_at: expiresAt }));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke({ userId }, '192.0.2.30');
    const authUpdate = JSON.parse(String(upstream.mock.calls[4][1]?.body));
    const expectedDigest = createHmac('sha256', pepper).update(`${nationalId}:890123`).digest('base64url');

    expect(result).toEqual({ status: 200, body: { ok: true, expiresAt } });
    expect(authUpdate.password).toBe(`SafetyPass-v2-${expectedDigest}`);
    expect(authUpdate.password).not.toContain(nationalId);
    expect(authUpdate.password).not.toContain('890123');
    expect(authUpdate.user_metadata).toEqual({
      name: 'Reset User', password_scheme: 'pin-v2-admin-reset', must_change_pin: true,
    });
    expect(String(upstream.mock.calls[3][0])).toContain('admin_begin_pin_reset');
    expect(String(upstream.mock.calls[5][0])).toContain('service_activate_admin_pin_reset');
    expect(JSON.parse(String(upstream.mock.calls[5][1]?.body))).toEqual({
      actor_id_param: adminId,
      user_id_param: userId,
    });
    expect(JSON.stringify(result.body)).not.toContain(nationalId);
    expect(JSON.stringify(result.body)).not.toContain('890123');
  });

  it('rejects non-admin callers before reading the target account', async () => {
    configure();
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: userId, email: `${nationalId}@safetypass.com` }))
      .mockResolvedValueOnce(jsonResponse(false));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke({ userId }, '192.0.2.31', 'Bearer user-access-token');

    expect(result.status).toBe(403);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('does not reset a target rejected by the authorized database boundary', async () => {
    configure();
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: adminId, email: '1999999999999@safetypass.com' }))
      .mockResolvedValueOnce(jsonResponse(true))
      .mockResolvedValueOnce(jsonResponse({ id: userId, email: `${nationalId}@safetypass.com` }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Only USER accounts can be reset' }, 400));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke({ userId }, '192.0.2.32');

    expect(result).toEqual({ status: 400, body: { message: 'Only USER accounts can be reset' } });
    expect(upstream).toHaveBeenCalledTimes(4);
  });

  it('atomically relinks an orphaned legacy profile before resetting its PIN', async () => {
    configure();
    const canonicalUserId = '30000000-0000-4000-8000-000000000003';
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: adminId, email: '1999999999999@safetypass.com' }))
      .mockResolvedValueOnce(jsonResponse(true))
      .mockResolvedValueOnce(jsonResponse({ message: 'User not found' }, 404))
      .mockResolvedValueOnce(jsonResponse({ status: 'RELINKED', user_id: canonicalUserId, old_user_id: userId }))
      .mockResolvedValueOnce(jsonResponse({
        id: canonicalUserId,
        email: `${nationalId}@safetypass.com`,
        user_metadata: { name: 'Legacy Reset User' },
      }))
      .mockResolvedValueOnce(jsonResponse({ user_id: canonicalUserId, reset_state: 'PENDING', expires_at: expiresAt }))
      .mockResolvedValueOnce(jsonResponse({ id: canonicalUserId }))
      .mockResolvedValueOnce(jsonResponse({ user_id: canonicalUserId, reset_state: 'ACTIVE', expires_at: expiresAt }));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke({ userId }, '192.0.2.33');

    expect(result).toEqual({ status: 200, body: { ok: true, expiresAt } });
    expect(String(upstream.mock.calls[3][0])).toContain('service_relink_orphaned_profile_for_pin_reset');
    expect(JSON.parse(String(upstream.mock.calls[3][1]?.body))).toEqual({
      actor_id_param: adminId,
      target_user_id_param: userId,
    });
    expect(String(upstream.mock.calls[4][0])).toContain(`/admin/users/${canonicalUserId}`);
    expect(JSON.parse(String(upstream.mock.calls[5][1]?.body))).toEqual({ user_id_param: canonicalUserId });
    expect(String(upstream.mock.calls[6][0])).toContain(`/admin/users/${canonicalUserId}`);
    expect(JSON.parse(String(upstream.mock.calls[7][1]?.body))).toEqual({
      actor_id_param: adminId,
      user_id_param: canonicalUserId,
    });
  });
});
