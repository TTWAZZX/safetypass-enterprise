import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/auth-session-status.js';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const invoke = async (authorization = 'Bearer user-access-token') => {
  let status = 0;
  let body: any;
  const response = {
    setHeader: vi.fn(),
    status(value: number) { status = value; return this; },
    json(value: unknown) { body = value; return this; },
  };
  await handler({ method: 'GET', headers: { authorization } }, response);
  return { status, body };
};

describe('auth-session-status API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.AUTH_PIN_V2_ENFORCEMENT;
  });

  const configure = () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
    process.env.AUTH_PIN_V2_ENFORCEMENT = 'true';
  };

  it('requires active saved sessions to migrate when they are still PIN v1', async () => {
    configure();
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'user-1', email: '1234567890123@safetypass.com' }))
      .mockResolvedValueOnce(jsonResponse({ user_exists: true, is_active: true, pin_version: 1 }))
      .mockResolvedValueOnce(jsonResponse([{ user_exists: true, is_active: true, requires_registration: false }]));
    vi.stubGlobal('fetch', upstream);

    expect(await invoke()).toEqual({ status: 200, body: { requiresPinUpgrade: true } });
  });

  it('allows restoring a PIN v2 session', async () => {
    configure();
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'user-1', email: '1234567890123@safetypass.com' }))
      .mockResolvedValueOnce(jsonResponse({ user_exists: true, is_active: true, pin_version: 2 }))
      .mockResolvedValueOnce(jsonResponse([{ user_exists: true, is_active: true, requires_registration: false }]));
    vi.stubGlobal('fetch', upstream);

    expect(await invoke()).toEqual({ status: 200, body: { requiresPinUpgrade: false } });
  });

  it('allows legacy session restoration while enforcement is paused', async () => {
    configure();
    process.env.AUTH_PIN_V2_ENFORCEMENT = 'false';
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'user-1', email: '1234567890123@safetypass.com' }))
      .mockResolvedValueOnce(jsonResponse({ user_exists: true, is_active: true, pin_version: 1 }))
      .mockResolvedValueOnce(jsonResponse([{ user_exists: true, is_active: true, requires_registration: false }]));
    vi.stubGlobal('fetch', upstream);

    expect(await invoke()).toEqual({ status: 200, body: { requiresPinUpgrade: false } });
  });

  it('requires a PIN change after an admin reset even while migration enforcement is paused', async () => {
    configure();
    process.env.AUTH_PIN_V2_ENFORCEMENT = 'false';
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'user-1', email: '1234567890123@safetypass.com' }))
      .mockResolvedValueOnce(jsonResponse({
        user_exists: true, is_active: true, pin_version: 2, pin_reset_state: 'ACTIVE',
      }))
      .mockResolvedValueOnce(jsonResponse([{ user_exists: true, is_active: true, requires_registration: false }]));
    vi.stubGlobal('fetch', upstream);

    expect(await invoke()).toEqual({ status: 200, body: { requiresPinUpgrade: true } });
  });

  it('refuses to restore a staged account before registration and PDPA are complete', async () => {
    configure();
    const upstream = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'user-1', email: '1234567890123@safetypass.com' }))
      .mockResolvedValueOnce(jsonResponse({ user_exists: true, is_active: true, pin_version: 2 }))
      .mockResolvedValueOnce(jsonResponse([{ user_exists: true, is_active: true, requires_registration: true }]));
    vi.stubGlobal('fetch', upstream);

    expect(await invoke()).toEqual({ status: 403, body: { message: 'Account is not available' } });
  });
});
