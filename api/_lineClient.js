const LINE_USER_ID_PATTERN = /^U[0-9A-Fa-f]{32}$/;

export function getLineDestinations(groupId, lineUserId, { requireDirect = false } = {}) {
  const destinations = [];
  if (typeof groupId === 'string' && groupId.trim()) destinations.push({ kind: 'group', id: groupId.trim() });
  const directId = typeof lineUserId === 'string' ? lineUserId.trim() : '';
  if (LINE_USER_ID_PATTERN.test(directId) && directId !== groupId) destinations.push({ kind: 'direct', id: directId });
  return { destinations, directAvailable: destinations.some(({ kind }) => kind === 'direct'), directRequired: requireDirect };
}

function sanitizeLineError(rawBody) {
  if (!rawBody) return null;
  let value = rawBody;
  try {
    const parsed = JSON.parse(rawBody);
    value = JSON.stringify({
      message: parsed?.message,
      details: Array.isArray(parsed?.details)
        ? parsed.details.slice(0, 5).map((detail) => ({ message: detail?.message, property: detail?.property }))
        : undefined,
    });
  } catch {
    // Keep non-JSON gateway errors after redaction.
  }
  return String(value)
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/\b[UCR][0-9A-Za-z]{20,}\b/g, '[LINE_ID_REDACTED]')
    .slice(0, 500);
}

export async function pushLineNotification({ accessToken, message, destinations, flow, fetchImpl = fetch, logger = console }) {
  logger.info('[line-notification]', { event: 'delivery_started', flow, destinations: destinations.map(({ kind }) => kind) });
  return Promise.all(destinations.map(async ({ kind, id }) => {
    try {
      const response = await fetchImpl('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ to: id, messages: [message] }),
      });
      const rawBody = response.ok ? '' : await response.text();
      const result = {
        kind,
        ok: response.ok,
        status: response.status,
        lineRequestId: response.headers.get('x-line-request-id') || null,
        error: response.ok ? null : sanitizeLineError(rawBody),
      };
      (response.ok ? logger.info : logger.error)('[line-notification]', {
        event: response.ok ? 'delivery_succeeded' : 'delivery_failed', flow, ...result,
      });
      return result;
    } catch (error) {
      const result = { kind, ok: false, status: null, lineRequestId: null, error: sanitizeLineError(error?.message || 'LINE request failed') };
      logger.error('[line-notification]', { event: 'delivery_failed', flow, ...result });
      return result;
    }
  }));
}

export function createDeliveryResponse(results, { directAvailable, directRequired }) {
  const delivery = Object.fromEntries(results.map(({ kind, ok, status, lineRequestId }) => [kind, { ok, status, lineRequestId }]));
  if (!directAvailable) delivery.direct = { ok: false, status: null, reason: 'line_user_id_unavailable' };
  const attemptedSucceeded = results.length > 0 && results.every(({ ok }) => ok);
  const success = attemptedSucceeded && (!directRequired || directAvailable);
  return { success, delivery, destinations: results.filter(({ ok }) => ok).length };
}
