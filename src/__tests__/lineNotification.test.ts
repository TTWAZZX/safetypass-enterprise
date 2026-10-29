import { describe, expect, it, vi } from 'vitest';
import { createDeliveryResponse, getLineDestinations, pushLineNotification } from '../../api/_lineClient.js';

const groupId = `C${'1'.repeat(32)}`;
const userId = `U${'2'.repeat(32)}`;
const message = { type: 'text', text: 'test' };

describe('LINE notification delivery', () => {
  it('builds group and direct destinations when the user is linked', () => {
    const state = getLineDestinations(groupId, userId, { requireDirect: true });
    expect(state.destinations.map(({ kind }: { kind: string }) => kind)).toEqual(['group', 'direct']);
    expect(state.directAvailable).toBe(true);
  });

  it('reports a required direct destination as unavailable', () => {
    const state = getLineDestinations(groupId, null, { requireDirect: true });
    const response = createDeliveryResponse([
      { kind: 'group', ok: true, status: 200, lineRequestId: 'request-1' },
    ], state);
    expect(response.success).toBe(false);
    expect(response.delivery.direct.reason).toBe('line_user_id_unavailable');
  });

  it('keeps per-destination outcomes and redacts LINE IDs from logs', async () => {
    const infoLog = vi.fn();
    const errorLog = vi.fn();
    const logger = { ...console, info: infoLog, error: errorLog };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'x-line-request-id': 'group-request' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: `Invalid to: ${userId}` }), {
        status: 400,
        headers: { 'x-line-request-id': 'direct-request' },
      }));
    const state = getLineDestinations(groupId, userId, { requireDirect: true });
    const results = await pushLineNotification({
      accessToken: 'secret-token', message, destinations: state.destinations,
      flow: 'test', fetchImpl, logger,
    });
    const response = createDeliveryResponse(results, state);

    expect(response.success).toBe(false);
    expect(response.delivery.group.ok).toBe(true);
    expect(response.delivery.direct).toMatchObject({ ok: false, status: 400, lineRequestId: 'direct-request' });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(userId);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('secret-token');
  });
});
