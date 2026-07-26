import { cleanText, isRateLimited, requireAuthenticatedUser } from './_auth.js';
import { createInductionPassMessage } from './_lineMessages.js';

const MAX_NOTIFICATION_AGE_MS = 30 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  const auth = await requireAuthenticatedUser(req, res);
  if (!auth) return;
  if (isRateLimited(`induction:${auth.user.id}`, 60 * 1000)) {
    return res.status(429).json({ message: 'Please wait before sending another notification' });
  }

  const lineAccessToken = process.env.LINE_ACCESS_TOKEN;
  const lineGroupId = process.env.LINE_GROUP_ID;
  if (!lineAccessToken || !lineGroupId) {
    return res.status(500).json({ message: 'LINE credentials missing' });
  }

  try {
    const historyQuery = new URLSearchParams({
      select: 'score,total_questions,created_at',
      user_id: `eq.${auth.user.id}`,
      exam_type: 'eq.INDUCTION',
      status: 'eq.PASSED',
      order: 'created_at.desc',
      limit: '1',
    });
    const profileQuery = new URLSearchParams({
      select: 'name,national_id,induction_expiry,vendors(name)',
      id: `eq.${auth.user.id}`,
      limit: '1',
    });
    const headers = { apikey: auth.config.anonKey, Authorization: auth.authorization };
    const [historyResponse, profileResponse] = await Promise.all([
      fetch(`${auth.config.url}/rest/v1/exam_history?${historyQuery}`, { headers }),
      fetch(`${auth.config.url}/rest/v1/users?${profileQuery}`, { headers }),
    ]);
    if (!historyResponse.ok || !profileResponse.ok) {
      return res.status(503).json({ message: 'Exam verification is unavailable' });
    }

    const [historyRows, profileRows] = await Promise.all([historyResponse.json(), profileResponse.json()]);
    const result = historyRows?.[0];
    const profile = profileRows?.[0];
    const resultAge = result?.created_at ? Date.now() - new Date(result.created_at).getTime() : Infinity;
    const expiryTime = profile?.induction_expiry ? new Date(profile.induction_expiry).getTime() : 0;
    if (!result || !profile || resultAge < 0 || resultAge > MAX_NOTIFICATION_AGE_MS || expiryTime <= Date.now()) {
      return res.status(403).json({ message: 'No recent passed induction exam was found' });
    }

    const name = cleanText(profile.name, 120) || 'Verified user';
    let identityValue = profile.national_id;
    if (!/^\d{13}$/.test(cleanText(identityValue, 13))) {
      const identityResponse = await fetch(`${auth.config.url}/rest/v1/rpc/get_my_decrypted_id`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (identityResponse.ok) identityValue = await identityResponse.json();
    }
    const nationalId = cleanText(identityValue, 13);
    if (!nationalId || !/^\d{13}$/.test(nationalId)) {
      return res.status(422).json({ message: 'Invalid user identity' });
    }
    const vendor = cleanText(profile.vendors?.name, 120) || 'ไม่มีสังกัด';
    const message = createInductionPassMessage({
      name,
      vendor,
      score: Number(result.score) || 0,
      totalQuestions: Number(result.total_questions) || 0,
      expiryDate: profile.induction_expiry,
      nationalId,
    });

    const lineResponse = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${lineAccessToken}`,
      },
      body: JSON.stringify({ to: lineGroupId, messages: [message] }),
    });
    if (!lineResponse.ok) {
      console.error('LINE API Error:', await lineResponse.text());
      return res.status(lineResponse.status).json({ message: 'Failed to send LINE notification' });
    }
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Induction notification error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}
