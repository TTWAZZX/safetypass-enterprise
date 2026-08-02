import { cleanText, isRateLimited, requireAdminUser } from './_auth.js';
import {
  buildExternalRegistrationEditUrl,
  buildExternalRegistrationTrackingUrl,
  renderExternalRegistrationApplicantNotice,
  sendExternalRegistrationEmail,
} from './_externalRegistrationEmail.js';

async function callRpc(config, authorization, name, body) {
  const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.hint || `RPC ${name} failed`);
  return data;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });
  const auth = await requireAdminUser(req, res);
  if (!auth) return;

  const applicationId = cleanText(req.body?.applicationId, 80);
  if (!applicationId) return res.status(400).json({ message: 'Application id is required' });
  if (isRateLimited(`external-registration-result-email:${applicationId}`, 30 * 1000)) {
    return res.status(429).json({ message: 'Please wait before retrying email delivery' });
  }

  let rows;
  try {
    rows = await callRpc(auth.config, auth.authorization, 'admin_get_external_registration_result_email_batch', {
      application_id_param: applicationId,
    });
  } catch (error) {
    console.error('External registration result email queue lookup failed:', error);
    return res.status(503).json({ message: 'Email queue is unavailable' });
  }

  const failures = [];
  let sent = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const payload = row.payload || {};
    try {
      const message = renderExternalRegistrationApplicantNotice({
        status: payload.status,
        requestNo: payload.requestNo,
        companyName: payload.companyName,
        applicantName: payload.applicantName,
        types: payload.types,
        email: payload.email,
        note: payload.note || '',
        trackingUrl: buildExternalRegistrationTrackingUrl(payload.requestNo, payload.trackingToken),
        editUrl: ['NEED_MORE_INFO', 'REJECTED'].includes(payload.status)
          ? buildExternalRegistrationEditUrl(payload.requestNo, payload.trackingToken)
          : '',
      });
      await sendExternalRegistrationEmail({ to: row.recipient_email, ...message });
      await callRpc(auth.config, auth.authorization, 'admin_record_external_registration_email_result', {
        outbox_id_param: row.id,
        sent_param: true,
        error_param: null,
      });
      sent += 1;
    } catch (error) {
      const message = error?.message || 'Email delivery failed';
      failures.push({ recipient: row.recipient_email, message });
      try {
        await callRpc(auth.config, auth.authorization, 'admin_record_external_registration_email_result', {
          outbox_id_param: row.id,
          sent_param: false,
          error_param: message,
        });
      } catch (recordError) {
        console.error('External registration result email failure record failed:', recordError);
      }
    }
  }

  if (failures.length > 0) return res.status(502).json({ success: false, sent, failures });
  return res.status(200).json({ success: true, sent });
}
