import { cleanText, getSupabaseServiceConfig, isRateLimited } from './_auth.js';
import { deliverExternalRegistrationOutbox } from './_externalRegistrationOutbox.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  const requestNo = cleanText(req.body?.requestNo, 40);
  const trackingToken = cleanText(req.body?.trackingToken, 120);
  if (!requestNo || !trackingToken) return res.status(400).json({ message: 'Request tracking data is required' });
  if (await isRateLimited(`external-registration-submit-email:${requestNo}:${trackingToken}`, 60 * 1000)) {
    return res.status(429).json({ message: 'Please wait before retrying email delivery' });
  }

  let config;
  try { config = getSupabaseServiceConfig(); }
  catch { return res.status(500).json({ message: 'Email service is not configured' }); }

  try {
    const result = await deliverExternalRegistrationOutbox(config, {
      request_no_param: requestNo, tracking_token_param: trackingToken,
    });
    return res.status(result.success ? 200 : 502).json(result);
  } catch {
    return res.status(503).json({ message: 'Email queue is unavailable' });
  }
}
