import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/check-registration-status.js';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const invoke = async (nationalId: string, ip: string) => {
  let status = 0;
  let body: any;
  const response = {
    setHeader: vi.fn(),
    status(value: number) { status = value; return this; },
    json(value: unknown) { body = value; return this; },
  };
  await handler({
    method: 'POST',
    body: { nationalId },
    headers: { 'x-forwarded-for': ip },
  }, response);
  return { status, body, response };
};

describe('registration status API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  const configure = () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  };

  it('uses the server-only role and preserves the staged account contract', async () => {
    configure();
    const upstream = vi.fn().mockResolvedValueOnce(jsonResponse([{
      user_exists: true,
      requires_registration: true,
      is_active: true,
    }]));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke('1888888888881', '192.0.2.31');

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ status: {
      user_exists: true,
      requires_registration: true,
      is_active: true,
    } });
    expect(upstream.mock.calls[0][1]?.headers).toMatchObject({
      apikey: 'service-role-test-key',
      Authorization: 'Bearer service-role-test-key',
    });
  });

  it('returns a privacy-minimal null result for an unknown identity', async () => {
    configure();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse([])));

    const result = await invoke('1888888888882', '192.0.2.32');

    expect(result).toMatchObject({ status: 200, body: { status: null } });
  });

  it('reuses a short sanitized cache for the staged login-to-registration handoff', async () => {
    configure();
    const upstream = vi.fn().mockResolvedValueOnce(jsonResponse([{
      user_exists: true,
      requires_registration: true,
      is_active: true,
    }]));
    vi.stubGlobal('fetch', upstream);

    const first = await invoke('1888888888884', '192.0.2.35');
    const handoff = await invoke('1888888888884', '192.0.2.35');

    expect(first.status).toBe(200);
    expect(handoff).toEqual(expect.objectContaining({
      status: 200,
      body: first.body,
    }));
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the service role is unavailable', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);

    const result = await invoke('1888888888883', '192.0.2.33');

    expect(result).toMatchObject({ status: 503 });
    expect(result.body).not.toHaveProperty('details');
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects malformed identities before contacting Supabase', async () => {
    configure();
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);

    const result = await invoke('123', '192.0.2.34');

    expect(result).toMatchObject({ status: 400 });
    expect(upstream).not.toHaveBeenCalled();
  });
});
