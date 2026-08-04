import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/prepare-staged-auth.js';

const nationalId = '1777777777788';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const invoke = async (ip: string) => {
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
    body: { nationalId },
    headers: { 'x-forwarded-for': ip },
  }, response);

  return { status: responseStatus, body: responseBody };
};

describe('prepare-staged-auth API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
  });

  it('returns a new staged session without probing password login', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
        user_exists: true, requires_registration: true, is_active: true,
      }]))
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'new-access', refresh_token: 'new-refresh',
      }));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke('192.0.2.10');

    expect(result).toEqual({
      status: 200,
      body: { ok: true, accessToken: 'new-access', refreshToken: 'new-refresh' },
    });
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(String(upstream.mock.calls[1][0])).toContain('/auth/v1/signup');
  });

  it('keeps expected existing-account failures server-side', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
        user_exists: true, requires_registration: true, is_active: true,
      }]))
      .mockResolvedValueOnce(jsonResponse({ message: 'User already registered' }, 422))
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'existing-access', refresh_token: 'existing-refresh',
      }));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke('192.0.2.11');

    expect(result).toEqual({
      status: 200,
      body: { ok: true, accessToken: 'existing-access', refreshToken: 'existing-refresh' },
    });
    expect(upstream).toHaveBeenCalledTimes(3);
    expect(String(upstream.mock.calls[2][0])).toContain('/auth/v1/token?grant_type=password');
  });

  it('prepares a replacement Auth identity for an active registered orphan', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
        user_exists: true, requires_registration: false, is_active: true,
      }]))
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'repair-access', refresh_token: 'repair-refresh',
      }));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke('192.0.2.12');

    expect(result).toEqual({
      status: 200,
      body: { ok: true, accessToken: 'repair-access', refreshToken: 'repair-refresh' },
    });
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(String(upstream.mock.calls[1][0])).toContain('/auth/v1/signup');
  });
});
