import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/send-external-registration-submission.js';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const invoke = async (token: string) => {
  let status = 0;
  let body: any;
  const response = {
    status(value: number) { status = value; return this; },
    json(value: unknown) { body = value; return this; },
  };
  await handler({
    method: 'POST',
    body: { requestNo: 'EXT-LOCAL-UAT', trackingToken: token },
    headers: {},
  }, response);
  return { status, body };
};

describe('external registration submission email API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('reads the protected outbox with the server-only service role', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
    const upstream = vi.fn().mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal('fetch', upstream);

    const result = await invoke('tracking-token-service-boundary');

    expect(result).toEqual({ status: 200, body: { success: true, sent: 0 } });
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(String(upstream.mock.calls[0][0])).toContain('get_external_registration_email_batch');
    expect(upstream.mock.calls[0][1]?.headers).toMatchObject({
      apikey: 'service-role-test-key',
      Authorization: 'Bearer service-role-test-key',
    });
  });

  it('fails closed when the service-role secret is unavailable', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);

    const result = await invoke('tracking-token-no-service-role');

    expect(result).toEqual({ status: 500, body: { message: 'Email service is not configured' } });
    expect(upstream).not.toHaveBeenCalled();
  });
});
