import { cleanText, isRateLimited, requireAuthenticatedUser } from './_auth.js';
import { createSupplierOutsourceAccessNoticeMessage } from './_lineMessages.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });
  const auth = await requireAuthenticatedUser(req, res);
  if (!auth) return;
  if (isRateLimited(`supplier-access-notice:${auth.user.id}`, 60 * 1000)) {
    return res.status(429).json({ message: 'Please wait before sending another notification' });
  }

  const lineAccessToken = process.env.LINE_ACCESS_TOKEN;
  const adminLineUserId = cleanText(process.env.ADMIN_LINE_USER_ID, 40);
  if (!lineAccessToken || !/^U[0-9A-Fa-f]{32}$/.test(adminLineUserId || '')) {
    return res.status(500).json({ message: 'Admin LINE notification is not configured' });
  }

  try {
    const response = await fetch(`${auth.config.url}/rest/v1/rpc/get_my_supplier_outsource_access_notification`, {
      method: 'POST',
      headers: {
        apikey: auth.config.anonKey,
        Authorization: auth.authorization,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!response.ok) return res.status(503).json({ message: 'Access details are unavailable' });
    const rows = await response.json();
    const access = rows?.[0];
    if (!access) return res.status(404).json({ message: 'Supplier and Outsource access was not found' });

    const message = createSupplierOutsourceAccessNoticeMessage({
      name: cleanText(access.name, 120) || 'Verified user',
      vendor: cleanText(access.vendor_name, 120) || 'ไม่มีสังกัด',
      participantType: access.participant_type,
      workType: access.work_type,
      accessStartDate: access.access_start_date,
      accessEndDate: access.access_end_date,
    });
    const lineResponse = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lineAccessToken}` },
      body: JSON.stringify({ to: adminLineUserId, messages: [message] }),
    });
    if (!lineResponse.ok) {
      console.error('LINE API Error: Supplier access notice failed');
      return res.status(502).json({ message: 'Failed to send LINE notification' });
    }
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Supplier access notice error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}
