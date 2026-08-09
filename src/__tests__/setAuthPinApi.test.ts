import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/set-auth-pin.js';

const nationalId = '1234567890123';
const userId = '10000000-0000-4000-8000-000000000001';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const invoke = async (body: unknown, ip: string, authorization = 'Bearer user-access-token') => {
  let status = 0;
  let responseBody: any;
  const response = {
    setHeader: vi.fn(),
    status(value: number) { status = value; return this; },
    json(value: unknown) { responseBody = value; return this; },
  };
  await handler({
    method: 'POST', body, headers: { authorization, 'x-forwarded-for': ip },
  }, response);
  return { status, body: responseBody };
};

describe('set-auth-pin API', () => {
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
    process.env.AUTH_PIN_PEPPER = 'test-pin-pepper-that-is-longer-than-32-characters';
  };

  it('updates only the authenticated matching identity and records PIN v2', async () => {
    configure();
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: userId,
        email: `${nationalId}@safetypass.com`,
        user_metadata: { name: 'Existing User' },
      }))
      .mockResolvedValueOnce(jsonResponse({ id: userId }))
      .mockResolvedValueOnce(jsonResponse(null))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'v2-access', refresh_token: 'v2-refresh' }));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke({ nationalId, pin: '246801' }, '192.0.2.20');
    const adminBody = JSON.parse(String(upstream.mock.calls[1][1]?.body));

    expect(result).toEqual({
      status: 200,
      body: { ok: true, accessToken: 'v2-access', refreshToken: 'v2-refresh' },
    });
    expect(String(upstream.mock.calls[1][0])).toContain(`/auth/v1/admin/users/${userId}`);
    expect(adminBody.user_metadata).toEqual({
      name: 'Existing User', password_scheme: 'pin-v2', must_change_pin: false,
    });
    expect(adminBody.password).not.toContain(nationalId);
    expect(adminBody.password).not.toContain('246801');
    expect(String(upstream.mock.calls[2][0])).toContain('complete_auth_pin_change');
    expect(JSON.parse(String(upstream.mock.calls[2][1]?.body))).toEqual({
      user_id_param: userId,
      national_id_param: nationalId,
    });
    expect(String(upstream.mock.calls[3][0])).toContain('/auth/v1/token?grant_type=password');
  });

  it('rejects changing a different national ID', async () => {
    configure();
    const upstream = vi.fn().mockResolvedValueOnce(jsonResponse({
      id: userId,
      email: `9999999999999@safetypass.com`,
      user_metadata: {},
    }));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke({ nationalId, pin: '246801' }, '192.0.2.21');

    expect(result.status).toBe(400);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('requires an authenticated session', async () => {
    configure();
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);

    const result = await invoke({ nationalId, pin: '246801' }, '192.0.2.22', '');

    expect(result.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('accepts a memorable six-digit PIN', async () => {
    configure();
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: userId, email: `${nationalId}@safetypass.com`, user_metadata: {},
      }))
      .mockResolvedValueOnce(jsonResponse({ id: userId }))
      .mockResolvedValueOnce(jsonResponse(null))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access', refresh_token: 'refresh' }));
    vi.stubGlobal('fetch', upstream);

    expect((await invoke({ nationalId, pin: '111111' }, '192.0.2.23')).status).toBe(200);
  });

  it.each([
    ['000000', '192.0.2.24'],
    ['123456', '192.0.2.25'],
    ['890123', '192.0.2.26'],
  ])('accepts any six-digit permanent PIN %s', async (pin, ip) => {
    configure();
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: userId, email: `${nationalId}@safetypass.com`, user_metadata: {},
      }))
      .mockResolvedValueOnce(jsonResponse({ id: userId }))
      .mockResolvedValueOnce(jsonResponse(null))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access', refresh_token: 'refresh' }));
    vi.stubGlobal('fetch', upstream);

    expect((await invoke({ nationalId, pin }, ip)).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(4);
  });
});
