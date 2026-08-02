import { cleanText, getSupabaseConfig, isRateLimited } from './_auth.js';
import {
  buildExternalRegistrationTrackingUrl,
  renderExternalRegistrationAdminNotice,
  renderExternalRegistrationApplicantNotice,
  sendExternalRegistrationEmail,
} from './_externalRegistrationEmail.js';

async function callRpc(config, name, body) {
  const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.hint || `RPC ${name} failed`);
  return data;
}

function renderQueuedMessage(row, trackingUrl) {
  const payload = row.payload || {};
  if (row.template_key === 'external_registration_admin_notice') {
    return renderExternalRegistrationAdminNotice({
      requestNo: payload.requestNo,
      companyName: payload.companyName,
      applicantName: payload.applicantName,
      types: payload.types,
      email: payload.email,
      phone: payload.phone,
      coordinators: payload.coordinators,
    });
  }
  if (row.template_key === 'external_registration_applicant_received') {
    return renderExternalRegistrationApplicantNotice({
      status: 'SUBMITTED',
      requestNo: payload.requestNo,
      companyName: payload.companyName,
      applicantName: payload.applicantName,
      types: payload.types,
      email: payload.email,
      trackingUrl,
    });
  }
  throw new Error(`Unsupported email template: ${row.template_key}`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  const requestNo = cleanText(req.body?.requestNo, 40);
  const trackingToken = cleanText(req.body?.trackingToken, 120);
  if (!requestNo || !trackingToken) return res.status(400).json({ message: 'Request tracking data is required' });
  if (isRateLimited(`external-registration-submit-email:${requestNo}:${trackingToken}`, 60 * 1000)) {
    return res.status(429).json({ message: 'Please wait before retrying email delivery' });
  }

  let config;
  try { config = getSupabaseConfig(); }
  catch { return res.status(500).json({ message: 'Email service is not configured' }); }

  let rows;
  try {
    rows = await callRpc(config, 'get_external_registration_email_batch', {
      request_no_param: requestNo,
      tracking_token_param: trackingToken,
    });
  } catch (error) {
    console.error('External registration email queue lookup failed:', error);
    return res.status(503).json({ message: 'Email queue is unavailable' });
  }

  const failures = [];
  let sent = 0;
  const trackingUrl = buildExternalRegistrationTrackingUrl(requestNo, trackingToken);
  for (const row of Array.isArray(rows) ? rows : []) {
    try {
      const message = renderQueuedMessage(row, trackingUrl);
      await sendExternalRegistrationEmail({ to: row.recipient_email, ...message });
      await callRpc(config, 'record_external_registration_email_result', {
        outbox_id_param: row.id,
        tracking_token_param: trackingToken,
        sent_param: true,
        error_param: null,
      });
      sent += 1;
    } catch (error) {
      const message = error?.message || 'Email delivery failed';
      failures.push({ recipient: row.recipient_email, message });
      try {
        await callRpc(config, 'record_external_registration_email_result', {
          outbox_id_param: row.id,
          tracking_token_param: trackingToken,
          sent_param: false,
          error_param: message,
        });
      } catch (recordError) {
        console.error('External registration email failure record failed:', recordError);
      }
    }
  }

  if (failures.length > 0) return res.status(502).json({ success: false, sent, failures });
  return res.status(200).json({ success: true, sent });
}
