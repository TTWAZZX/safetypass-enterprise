import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/send-external-registration-submission.js';
import resultHandler from '../../api/send-external-registration-result.js';
import { sendExternalRegistrationEmail } from '../../api/_externalRegistrationEmail.js';

vi.mock('../../api/_externalRegistrationEmail.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../api/_externalRegistrationEmail.js')>(),
  sendExternalRegistrationEmail: vi.fn(),
}));

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const invoke = async (token: string, method = 'POST', authorization = '') => {
  let status = 0;
  let body: any;
  const response = {
    setHeader: vi.fn(),
    status(value: number) { status = value; return this; },
    json(value: unknown) { body = value; return this; },
  };
  await (method === 'GET' ? resultHandler : handler)({
    method,
    body: { requestNo: 'EXT-LOCAL-UAT', trackingToken: token },
    headers: { authorization },
  }, response);
  return { status, body };
};

describe('external registration submission email API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.mocked(sendExternalRegistrationEmail).mockReset();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('sends only a claimed email and returns a summary without recipient or SMTP details', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'publishable-test-key');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key');
    const outboxId = '27c6fe13-a398-4b97-a0e0-d31f78701450';
    const leaseId = 'a17c661b-8486-4813-946a-ec011f4fd64a';
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
        id: outboxId, lease_id: leaseId, template_key: 'external_registration_admin_notice',
        recipient_email: 'internal@example.test', payload: { requestNo: 'EXT-LOCAL-UAT' },
      }]))
      .mockResolvedValueOnce(jsonResponse(true));
    vi.stubGlobal('fetch', upstream);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(sendExternalRegistrationEmail).mockRejectedValueOnce(new Error('SMTP internal details'));

    expect(await invoke('tracking-token-one-email')).toEqual({ status: 502, body: { success: false, sent: 0 } });
    expect(sendExternalRegistrationEmail).toHaveBeenCalledWith(expect.objectContaining({
      messageId: `<external-registration-${outboxId}@safetypass-enterprise.vercel.app>`,
    }));
    expect(JSON.parse(upstream.mock.calls[1][1].body)).toEqual({
      outbox_id_param: outboxId, lease_id_param: leaseId, sent_param: false,
    });
  });

  it('only allows the scheduler to run an unfiltered retry batch', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'publishable-test-key');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key');
    vi.stubEnv('CRON_SECRET', 'local-cron-secret');
    const upstream = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal('fetch', upstream);

    expect((await invoke('', 'GET', 'Bearer invalid')).status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
    expect(await invoke('', 'GET', 'Bearer local-cron-secret')).toEqual({
      status: 200, body: { success: true, sent: 0 },
    });
    expect(upstream.mock.calls[0][0]).toContain('service_reconcile_expired_email_claims');
    expect(JSON.parse(upstream.mock.calls[1][1].body)).toEqual({});
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
    expect(String(upstream.mock.calls[0][0])).toContain('service_claim_external_registration_emails');
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
