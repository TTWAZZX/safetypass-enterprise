import { timingSafeEqual } from 'node:crypto';
import { cleanText, getSupabaseServiceConfig, isRateLimited, requireAdminUser } from './_auth.js';
import { deliverExternalRegistrationOutbox, reconcileExternalRegistrationOutbox } from './_externalRegistrationOutbox.js';

function isAuthorizedCron(req) {
  const secret = process.env.CRON_SECRET;
  const received = req.headers.authorization;
  if (!secret || typeof received !== 'string') return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(received);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const isCron = req.method === 'GET';
  let filter;
  if (isCron) {
    if (!isAuthorizedCron(req)) return res.status(401).json({ message: 'Authentication required' });
  } else if (req.method === 'POST') {
    if (!await requireAdminUser(req, res)) return;
    const applicationId = cleanText(req.body?.applicationId, 36)?.toLowerCase();
    if (!applicationId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(applicationId)) {
      return res.status(400).json({ message: 'Application id is required' });
    }
    if (await isRateLimited(`external-registration-result-email:${applicationId}`, 30 * 1000)) {
      return res.status(429).json({ message: 'Please wait before retrying email delivery' });
    }
    filter = { application_id_param: applicationId };
  } else {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  try {
    const config = getSupabaseServiceConfig();
    if (isCron) await reconcileExternalRegistrationOutbox(config);
    const result = await deliverExternalRegistrationOutbox(config, filter);
    return res.status(result.success ? 200 : 502).json(result);
  } catch {
    return res.status(503).json({ message: 'Email queue is unavailable' });
  }
}
