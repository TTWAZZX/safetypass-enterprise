import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/set-auth-pin.js';
import { isRateLimited } from '../../api/_auth.js';
import { getLinkedLineRecipient } from '../../api/_lineClient.js';

const lineUser = 'U11111111111111111111111111111111';
const json = (body: unknown, status = 200) => Response.json(body, { status });

async function link(userId: string, authorization = 'Bearer test-session') {
  let status = 0;
  let body: unknown;
  const response = {
    setHeader: vi.fn(),
    status(value: number) { status = value; return this; },
    json(value: unknown) { body = value; return this; },
  };
  await handler({
    method: 'POST',
    headers: { authorization },
    body: { action: 'link-line-identity', lineAccessToken: 'test-line-token', lineUserId: 'untrusted', userId },
  }, response);
  return { status, body };
}

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'publishable-key');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
  vi.stubEnv('LINE_LOGIN_CHANNEL_ID', '012345');
  vi.stubEnv('SHARED_RATE_LIMIT_ENABLED', 'false');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('verified LINE linking', () => {
  it('stores the identity returned by LINE on the authenticated account', async () => {
    const avatar = 'https://profile.line-scdn.net/test-avatar';
    const upstream = vi.fn()
      .mockResolvedValueOnce(json({ id: 'current-account' }))
      .mockResolvedValueOnce(json({ client_id: '012345', expires_in: 60 }))
      .mockResolvedValueOnce(json({ userId: lineUser, pictureUrl: avatar }))
      .mockResolvedValueOnce(json(true));
    vi.stubGlobal('fetch', upstream);

    expect(await link('different-account')).toEqual({ status: 200, body: { avatarUrl: avatar } });
    expect(String(upstream.mock.calls[1][0])).toContain('/oauth2/v2.1/verify');
    expect(upstream.mock.calls[2][1].headers.Authorization).toBe('Bearer test-line-token');
    expect(JSON.parse(upstream.mock.calls[3][1].body)).toEqual({
      user_id_param: 'current-account',
      line_user_id_param: lineUser,
      picture_url_param: avatar,
    });
  });

  it.each([['another-channel', 60], ['012345', 0]])('rejects an invalid LINE channel or lifetime (%s, %s)', async (channel, expiry) => {
    const upstream = vi.fn().mockResolvedValueOnce(json({ id: `invalid-${channel}-${expiry}` }))
      .mockResolvedValueOnce(json({ client_id: channel, expires_in: expiry }));
    vi.stubGlobal('fetch', upstream);

    expect((await link('unused')).status).toBe(403);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('requires an authenticated SafetyPass user', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    expect((await link('unused', '')).status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('skips direct messages to old links when verified linking is enforced', () => {
    vi.stubEnv('LINE_VERIFIED_LINK_REQUIRED', 'true');
    expect(getLinkedLineRecipient({ line_user_id: lineUser })).toBeNull();
    expect(getLinkedLineRecipient({ line_user_id: lineUser, line_identity_verified_at: '2026-11-23' })).toBe(lineUser);
  });
});

describe('shared rate limit', () => {
  it('uses a hashed key and accepts the result of the shared store', async () => {
    vi.stubEnv('SHARED_RATE_LIMIT_ENABLED', 'true');
    const upstream = vi.fn().mockResolvedValueOnce(json(true)).mockResolvedValueOnce(json(false));
    vi.stubGlobal('fetch', upstream);

    expect(await isRateLimited('registration:sensitive-identity', 750)).toBe(false);
    expect(await isRateLimited('registration:sensitive-identity', 750)).toBe(true);
    const request = JSON.parse(upstream.mock.calls[0][1].body);
    expect(request).toEqual({ key_hash_param: expect.stringMatching(/^[0-9a-f]{64}$/), interval_ms_param: 750 });
    expect(JSON.parse(upstream.mock.calls[1][1].body)).toEqual(request);
  });

  it('does not allow callers through when the shared store is unavailable', async () => {
    vi.stubEnv('SHARED_RATE_LIMIT_ENABLED', 'true');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unavailable')));
    expect(await isRateLimited('shared-service-outage', 750)).toBe(true);
  });
});
