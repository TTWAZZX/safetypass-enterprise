import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/prepare-staged-auth.js';

const nationalId = '1777777777788';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const invoke = async (ip: string, requestBody: Record<string, unknown> = { nationalId }) => {
  let responseStatus = 0;
  let responseBody: any;
  const response = {
    setHeader: vi.fn(),
    status(status: number) {
      responseStatus = status;
      return this;
    },
    json(body: unknown) {
      responseBody = body;
      return this;
    },
  };

  await handler({
    method: 'POST',
    body: requestBody,
    headers: { 'x-forwarded-for': ip },
  }, response);

  return { status: responseStatus, body: responseBody };
};

describe('prepare-staged-auth API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('serves registration status through the existing server-only function', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
    const upstream = vi.fn().mockResolvedValueOnce(jsonResponse([{
      user_exists: true, requires_registration: true, is_active: true,
    }]));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke('192.0.2.20', {
      nationalId: '1888888888881', action: 'status',
    });

    expect(result).toEqual({ status: 200, body: { status: {
      user_exists: true, requires_registration: true, is_active: true,
    } } });
    expect(upstream.mock.calls[0][1]?.headers).toMatchObject({
      apikey: 'service-role-test-key',
      Authorization: 'Bearer service-role-test-key',
    });
  });

  it('returns a privacy-minimal result and caches a repeated status handoff', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
    const upstream = vi.fn().mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal('fetch', upstream);
    const body = { nationalId: '1888888888882', action: 'status' };

    const first = await invoke('192.0.2.21', body);
    const handoff = await invoke('192.0.2.21', body);

    expect(first).toEqual({ status: 200, body: { status: null } });
    expect(handoff).toEqual(first);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('fails the status action closed without the service role', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);

    const result = await invoke('192.0.2.22', {
      nationalId: '1888888888883', action: 'status',
    });

    expect(result.status).toBe(503);
    expect(result.body).not.toHaveProperty('details');
    expect(upstream).not.toHaveBeenCalled();
  });

  it('returns a new staged session without probing password login', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
        user_exists: true, requires_registration: true, is_active: true,
      }]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ id: '77777777-7777-4777-8777-777777777710' }))
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'new-access', refresh_token: 'new-refresh',
      }));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke('192.0.2.10');

    expect(result).toEqual({
      status: 200,
      body: { ok: true, accessToken: 'new-access', refreshToken: 'new-refresh' },
    });
    expect(upstream).toHaveBeenCalledTimes(4);
    expect(upstream.mock.calls[0][1]?.headers).toMatchObject({
      apikey: 'service-role-test-key',
      Authorization: 'Bearer service-role-test-key',
    });
    expect(String(upstream.mock.calls[1][0])).toContain('/rpc/get_staged_auth_bootstrap_identity');
    expect(String(upstream.mock.calls[2][0])).toContain('/auth/v1/admin/users');
    const signupBody = JSON.parse(String(upstream.mock.calls[2][1]?.body));
    expect(signupBody.password).toMatch(/^SafetyPass-bootstrap-v2-/);
    expect(signupBody.password.length).toBeLessThanOrEqual(72);
    expect(signupBody.password).not.toContain(nationalId);
    expect(signupBody.email_confirm).toBe(true);
    expect(signupBody.user_metadata).toEqual({
      password_scheme: 'bootstrap-v2', must_change_pin: true,
    });
    expect(String(upstream.mock.calls[3][0])).toContain('/auth/v1/token?grant_type=password');
  });

  it('prepares a server-created Auth session for a new self-registration identity', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ id: '77777777-7777-4777-8777-777777777713' }))
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'new-self-access', refresh_token: 'new-self-refresh',
      }));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke('192.0.2.13');

    expect(result).toEqual({
      status: 200,
      body: { ok: true, accessToken: 'new-self-access', refreshToken: 'new-self-refresh' },
    });
    expect(String(upstream.mock.calls[1][0])).toContain('/rpc/get_staged_auth_bootstrap_identity');
    expect(String(upstream.mock.calls[2][0])).toContain('/auth/v1/admin/users');
    const signupBody = JSON.parse(String(upstream.mock.calls[2][1]?.body));
    expect(signupBody.email).toBe(`${nationalId}@safetypass.com`);
    expect(signupBody.password.length).toBeLessThanOrEqual(72);
  });

  it('keeps expected existing-account failures server-side', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
        user_exists: true, requires_registration: true, is_active: true,
      }]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ message: 'User already exists' }, 422))
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'existing-access', refresh_token: 'existing-refresh',
      }));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke('192.0.2.11');

    expect(result).toEqual({
      status: 200,
      body: { ok: true, accessToken: 'existing-access', refreshToken: 'existing-refresh' },
    });
    expect(upstream).toHaveBeenCalledTimes(4);
    expect(String(upstream.mock.calls[1][0])).toContain('/rpc/get_staged_auth_bootstrap_identity');
    expect(String(upstream.mock.calls[2][0])).toContain('/auth/v1/admin/users');
    expect(String(upstream.mock.calls[3][0])).toContain('/auth/v1/token?grant_type=password');
  });

  it('recovers an interrupted staged bootstrap identity and returns a session', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
    const userId = '77777777-7777-4777-8777-777777777777';
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
        user_exists: true, requires_registration: true, is_active: true,
      }]))
      .mockResolvedValueOnce(jsonResponse([{ user_id: userId, recoverable: true }]))
      .mockResolvedValueOnce(jsonResponse({ id: userId }))
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'recovered-access', refresh_token: 'recovered-refresh',
      }));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke('192.0.2.14');

    expect(result).toEqual({
      status: 200,
      body: { ok: true, accessToken: 'recovered-access', refreshToken: 'recovered-refresh' },
    });
    expect(upstream).toHaveBeenCalledTimes(4);
    expect(String(upstream.mock.calls[1][0])).toContain('/rpc/get_staged_auth_bootstrap_identity');
    expect(upstream.mock.calls[1][1]?.headers).toMatchObject({
      apikey: 'service-role-test-key',
      Authorization: 'Bearer service-role-test-key',
    });
    expect(String(upstream.mock.calls[2][0])).toContain(`/auth/v1/admin/users/${userId}`);
    const updateBody = JSON.parse(String(upstream.mock.calls[2][1]?.body));
    expect(updateBody.password).toMatch(/^SafetyPass-bootstrap-v2-/);
    expect(updateBody.user_metadata).toEqual({
      password_scheme: 'bootstrap-v2', must_change_pin: true,
    });
    expect(String(upstream.mock.calls[3][0])).toContain('/auth/v1/token?grant_type=password');
    expect(upstream.mock.calls.some(([url]) => (
      new URL(String(url)).pathname === '/auth/v1/admin/users'
    ))).toBe(false);
  });

  it('prepares a replacement Auth identity for an active registered orphan', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
        user_exists: true, requires_registration: false, is_active: true,
      }]))
      .mockResolvedValueOnce(jsonResponse({ id: '77777777-7777-4777-8777-777777777712' }))
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'repair-access', refresh_token: 'repair-refresh',
      }));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke('192.0.2.12');

    expect(result).toEqual({
      status: 200,
      body: { ok: true, accessToken: 'repair-access', refreshToken: 'repair-refresh' },
    });
    expect(upstream).toHaveBeenCalledTimes(3);
    expect(String(upstream.mock.calls[1][0])).toContain('/auth/v1/admin/users');
    expect(String(upstream.mock.calls[2][0])).toContain('/auth/v1/token?grant_type=password');
  });
});
