import { cleanText, isRateLimited, requireAdminUser } from './_auth.js';
import { renderExternalRegistrationTestEmail, sendExternalRegistrationEmail } from './_externalRegistrationEmail.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });
  const auth = await requireAdminUser(req, res);
  if (!auth) return;
  if (isRateLimited(`external-registration-email-test:${auth.user.id}`, 60 * 1000)) {
    return res.status(429).json({ message: 'Please wait before sending another test email' });
  }

  const recipientEmail = cleanText(req.body?.recipientEmail, 320);
  const recipientName = cleanText(req.body?.recipientName, 160) || '';
  if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    return res.status(400).json({ message: 'Invalid recipient email' });
  }

  try {
    const message = renderExternalRegistrationTestEmail(recipientName);
    await sendExternalRegistrationEmail({ to: recipientEmail, ...message });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('External registration test email failed:', error);
    return res.status(503).json({ message: error?.message || 'Email service is unavailable' });
  }
}
