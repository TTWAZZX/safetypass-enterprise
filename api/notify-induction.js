import { cleanText, isRateLimited, requireAuthenticatedUser } from './_auth.js';
import { createInductionPassMessage } from './_lineMessages.js';
import { createDeliveryResponse, getLineDestinations, getLinkedLineRecipient, pushLineNotification } from './_lineClient.js';

const MAX_NOTIFICATION_AGE_MS = 30 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  const auth = await requireAuthenticatedUser(req, res);
  if (!auth) return;
  if (await isRateLimited(`induction:${auth.user.id}`, 60 * 1000)) {
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
      select: 'name,induction_verification_token,induction_expiry,line_user_id,line_identity_verified_at,vendors(name)',
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
    const verificationToken = cleanText(profile.induction_verification_token, 36);
    if (!verificationToken) return res.status(422).json({ message: 'Pass verification is unavailable' });
    const vendorRelation = Array.isArray(profile.vendors) ? profile.vendors[0] : profile.vendors;
    const vendor = cleanText(vendorRelation?.name, 120) || 'ไม่มีสังกัด';
    const message = createInductionPassMessage({
      name,
      vendor,
      score: Number(result.score) || 0,
      totalQuestions: Number(result.total_questions) || 0,
      expiryDate: profile.induction_expiry,
      verificationToken,
    });

    const targetState = getLineDestinations(lineGroupId, getLinkedLineRecipient(profile));
    const results = await pushLineNotification({ accessToken: lineAccessToken, message, destinations: targetState.destinations, flow: 'induction' });
    const delivery = createDeliveryResponse(results, targetState);
    if (!delivery.success) {
      return res.status(502).json({ ...delivery, code: 'LINE_DELIVERY_FAILED', message: 'Failed to send LINE notification' });
    }
    return res.status(200).json(delivery);
  } catch (error) {
    console.error('Induction notification error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}
