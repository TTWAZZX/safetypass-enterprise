import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/auth-login.js';

const nationalId = '1234567890123';
const pepper = 'test-pin-pepper-that-is-longer-than-32-characters';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const invoke = async (pin: string, ip: string) => {
  let status = 0;
  let body: any;
  const response = {
    setHeader: vi.fn(),
    status(value: number) { status = value; return this; },
    json(value: unknown) { body = value; return this; },
  };
  await handler({ method: 'POST', body: { nationalId, pin }, headers: { 'x-forwarded-for': ip } }, response);
  return { status, body, response };
};

describe('auth-login API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.AUTH_PIN_PEPPER;
    delete process.env.AUTH_PIN_V2_ENFORCEMENT;
  });

  const configure = () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
    process.env.AUTH_PIN_PEPPER = pepper;
    process.env.AUTH_PIN_V2_ENFORCEMENT = 'true';
  };

  it('allows an unchanged legacy account once and requires PIN upgrade', async () => {
    configure();
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ user_exists: true, is_active: true, pin_version: 1 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access', refresh_token: 'refresh' }))
      .mockResolvedValueOnce(jsonResponse(null));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke('0123', '192.0.2.1');

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ accessToken: 'access', refreshToken: 'refresh', requiresPinUpgrade: true });
    expect(JSON.parse(String(upstream.mock.calls[1][1]?.body)).password).toBe(`SafetyPass-${nationalId}-0123`);
  });

  it('uses a server-peppered password for PIN v2 without exposing the PIN', async () => {
    configure();
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ user_exists: true, is_active: true, pin_version: 2 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access-v2', refresh_token: 'refresh-v2' }))
      .mockResolvedValueOnce(jsonResponse(null));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke('246801', '192.0.2.2');
    const password = JSON.parse(String(upstream.mock.calls[1][1]?.body)).password;
    const digest = createHmac('sha256', pepper).update(`${nationalId}:246801`).digest('base64url');

    expect(result.status).toBe(200);
    expect(result.body.requiresPinUpgrade).toBe(false);
    expect(password).toBe(`SafetyPass-v2-${digest}`);
    expect(password).not.toContain(nationalId);
    expect(password).not.toContain('246801');
  });

  it('blocks the old four-digit PIN after an account reaches PIN v2', async () => {
    configure();
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ user_exists: true, is_active: true, pin_version: 2 }))
      .mockResolvedValueOnce(jsonResponse({ failed_attempts: 1, locked_until: null }));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke('0123', '192.0.2.3');

    expect(result.status).toBe(401);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(String(upstream.mock.calls[1][0])).toContain('record_auth_login_failure');
  });

  it('honors a persistent database lock before calling Supabase Auth', async () => {
    configure();
    const lockedUntil = new Date(Date.now() + 60_000).toISOString();
    const upstream = vi.fn().mockResolvedValueOnce(jsonResponse({
      user_exists: true, is_active: true, pin_version: 1, locked_until: lockedUntil,
    }));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke('0123', '192.0.2.4');

    expect(result.status).toBe(429);
    expect(result.body.lockedUntil).toBe(lockedUntil);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('recovers only an interrupted bootstrap registration and still requires upgrade', async () => {
    configure();
    const userId = '10000000-0000-4000-8000-000000000001';
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ user_exists: true, user_id: userId, is_active: true, pin_version: 1 }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Invalid credentials' }, 400))
      .mockResolvedValueOnce(jsonResponse({ message: 'Invalid credentials' }, 400))
      .mockResolvedValueOnce(jsonResponse({ id: userId, user_metadata: { password_scheme: 'bootstrap-v2' } }))
      .mockResolvedValueOnce(jsonResponse({ id: userId }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'recovered', refresh_token: 'recovered-refresh' }))
      .mockResolvedValueOnce(jsonResponse(null));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke('0123', '192.0.2.5');

    expect(result.status).toBe(200);
    expect(result.body.requiresPinUpgrade).toBe(true);
    expect(String(upstream.mock.calls[3][0])).toContain(`/auth/v1/admin/users/${userId}`);
    expect(upstream.mock.calls[3][1]?.method).toBeUndefined();
    expect(upstream.mock.calls[4][1]?.method).toBe('PUT');
  });

  it('can pause new legacy migrations without breaking legacy login', async () => {
    configure();
    process.env.AUTH_PIN_V2_ENFORCEMENT = 'false';
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ user_exists: true, is_active: true, pin_version: 1 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access', refresh_token: 'refresh' }))
      .mockResolvedValueOnce(jsonResponse(null));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke('0123', '192.0.2.6');

    expect(result.status).toBe(200);
    expect(result.body.requiresPinUpgrade).toBe(false);
  });

  it('accepts the active last-six temporary PIN and always requires a new PIN', async () => {
    configure();
    process.env.AUTH_PIN_V2_ENFORCEMENT = 'false';
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        user_exists: true,
        is_active: true,
        pin_version: 2,
        pin_reset_state: 'ACTIVE',
        pin_reset_expires_at: expiresAt,
      }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'reset-access', refresh_token: 'reset-refresh' }))
      .mockResolvedValueOnce(jsonResponse(null));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke('890123', '192.0.2.7');
    const password = JSON.parse(String(upstream.mock.calls[1][1]?.body)).password;
    const digest = createHmac('sha256', pepper).update(`${nationalId}:890123`).digest('base64url');

    expect(result.status).toBe(200);
    expect(result.body.requiresPinUpgrade).toBe(true);
    expect(password).toBe(`SafetyPass-v2-${digest}`);
  });

  it('rejects the previous PIN while an admin reset is active', async () => {
    configure();
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        user_exists: true,
        is_active: true,
        pin_version: 2,
        pin_reset_state: 'ACTIVE',
        pin_reset_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      }))
      .mockResolvedValueOnce(jsonResponse({ failed_attempts: 1, locked_until: null }));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke('246801', '192.0.2.8');

    expect(result.status).toBe(401);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(String(upstream.mock.calls[1][0])).toContain('record_auth_login_failure');
  });

  it('does not authenticate while a PIN reset is pending', async () => {
    configure();
    const upstream = vi.fn().mockResolvedValueOnce(jsonResponse({
      user_exists: true,
      is_active: true,
      pin_version: 2,
      pin_reset_state: 'PENDING',
      pin_reset_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    }));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke('890123', '192.0.2.9');

    expect(result.status).toBe(503);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('rejects an expired temporary PIN before calling Supabase Auth', async () => {
    configure();
    const upstream = vi.fn().mockResolvedValueOnce(jsonResponse({
      user_exists: true,
      is_active: true,
      pin_version: 2,
      pin_reset_state: 'ACTIVE',
      pin_reset_expires_at: new Date(Date.now() - 1_000).toISOString(),
    }));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke('890123', '192.0.2.10');

    expect(result.status).toBe(401);
    expect(result.body.message).toContain('expired');
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
