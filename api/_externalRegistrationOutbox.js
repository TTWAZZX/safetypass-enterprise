import {
  buildExternalRegistrationEditUrl,
  buildExternalRegistrationTrackingUrl,
  renderExternalRegistrationAdminNotice,
  renderExternalRegistrationApplicantNotice,
  sendExternalRegistrationEmail,
} from './_externalRegistrationEmail.js';

async function callRpc(config, name, body) {
  const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Email queue operation failed (${response.status})`);
  return response.json().catch(() => null);
}

function renderMessage(row) {
  const payload = row.payload || {};
  if (row.template_key === 'external_registration_admin_notice') {
    return renderExternalRegistrationAdminNotice(payload);
  }
  const isResult = row.template_key === 'external_registration_applicant_result';
  if (!isResult && row.template_key !== 'external_registration_applicant_received') {
    throw new Error('Unsupported email template');
  }
  const status = isResult ? payload.status : 'SUBMITTED';
  return renderExternalRegistrationApplicantNotice({
    ...payload,
    status,
    trackingUrl: buildExternalRegistrationTrackingUrl(payload.requestNo, payload.trackingToken),
    editUrl: ['NEED_MORE_INFO', 'REJECTED'].includes(status)
      ? buildExternalRegistrationEditUrl(payload.requestNo, payload.trackingToken)
      : '',
  });
}

export async function deliverExternalRegistrationOutbox(config, filter = {}) {
  const rows = await callRpc(config, 'service_claim_external_registration_emails', filter);
  if (!Array.isArray(rows)) throw new Error('Invalid email queue response');
  const delivery = await Promise.all(rows.map(async (row) => {
    let sent = false;
    try {
      await sendExternalRegistrationEmail({
        to: row.recipient_email,
        messageId: `<external-registration-${row.id}@safetypass-enterprise.vercel.app>`,
        ...renderMessage(row),
      });
      sent = true;
    } catch {
      console.error('External registration email delivery failed', { outboxId: row.id });
    }
    try {
      const recorded = await callRpc(config, 'service_finish_external_registration_email', {
        outbox_id_param: row.id, lease_id_param: row.lease_id, sent_param: sent,
      });
      if (recorded === true) return sent;
    } catch {
      // The lease remains valid until it expires so another worker cannot retry immediately.
    }
    console.error('External registration email delivery could not be confirmed', { outboxId: row.id });
    return false;
  }));
  const sent = delivery.filter(Boolean).length;
  return { success: sent === rows.length, sent };
}

export async function reconcileExternalRegistrationOutbox(config) {
  await callRpc(config, 'service_reconcile_expired_email_claims', {});
}
