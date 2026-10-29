import { cleanText, isRateLimited, requireAuthenticatedUser } from './_auth.js';
import { createDeliveryResponse, getLineDestinations, pushLineNotification } from './_lineClient.js';
import { createWorkPermitPassMessage } from './_lineMessages.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  const auth = await requireAuthenticatedUser(req, res);
  if (!auth) return;

  const permitNo = cleanText(req.body?.permitNo, 32);
  if (!permitNo || !/^\d{10}$/.test(permitNo)) {
    return res.status(400).json({ message: 'Invalid permit number' });
  }
  if (isRateLimited(`work-permit:${auth.user.id}:${permitNo}`, 60 * 1000)) {
    return res.status(429).json({ message: 'Please wait before sending another notification' });
  }

  const lineAccessToken = process.env.LINE_ACCESS_TOKEN;
  const lineGroupId = process.env.LINE_GROUP_ID;
  if (!lineAccessToken || !lineGroupId) {
    return res.status(500).json({ message: 'LINE credentials missing' });
  }

  const headers = { apikey: auth.config.anonKey, Authorization: auth.authorization };
  const permitQuery = new URLSearchParams({
    select: 'permit_no,expire_date,status',
    user_id: `eq.${auth.user.id}`,
    permit_no: `eq.${permitNo}`,
    status: 'eq.ACTIVE',
    expire_date: `gt.${new Date().toISOString()}`,
    limit: '1',
  });
  const profileQuery = new URLSearchParams({
    select: 'name,line_user_id,vendors(name)',
    id: `eq.${auth.user.id}`,
    limit: '1',
  });
  const historyQuery = new URLSearchParams({
    select: 'score,total_questions',
    user_id: `eq.${auth.user.id}`,
    exam_type: 'eq.WORK_PERMIT',
    status: 'eq.PASSED',
    order: 'created_at.desc',
    limit: '1',
  });

  try {
    const [permitResponse, profileResponse, historyResponse] = await Promise.all([
      fetch(`${auth.config.url}/rest/v1/work_permits?${permitQuery}`, { headers }),
      fetch(`${auth.config.url}/rest/v1/users?${profileQuery}`, { headers }),
      fetch(`${auth.config.url}/rest/v1/exam_history?${historyQuery}`, { headers }),
    ]);
    if (!permitResponse.ok || !profileResponse.ok || !historyResponse.ok) {
      return res.status(503).json({ message: 'Exam details are unavailable' });
    }

    const [permits, profiles, history] = await Promise.all([
      permitResponse.json(), profileResponse.json(), historyResponse.json(),
    ]);
    const permit = permits?.[0];
    const profile = profiles?.[0];
    const examResult = history?.[0];
    if (!permit) return res.status(403).json({ message: 'No active permit was found for this user' });
    if (!profile || !examResult) return res.status(403).json({ message: 'Passed exam details were not found' });

    const score = Number(examResult.score);
    const totalQuestions = Number(examResult.total_questions);
    if (!Number.isFinite(score) || !Number.isFinite(totalQuestions) || totalQuestions <= 0) {
      return res.status(422).json({ message: 'Invalid exam score' });
    }
    const vendorRelation = Array.isArray(profile.vendors) ? profile.vendors[0] : profile.vendors;
    const message = createWorkPermitPassMessage({
      permitNo: permit.permit_no,
      name: cleanText(profile.name, 120) || 'Verified user',
      vendor: cleanText(vendorRelation?.name, 120) || 'ไม่มีสังกัด',
      score,
      totalQuestions,
    });
    const targetState = getLineDestinations(lineGroupId, cleanText(profile.line_user_id, 40));
    const results = await pushLineNotification({ accessToken: lineAccessToken, message, destinations: targetState.destinations, flow: 'work_permit' });
    const delivery = createDeliveryResponse(results, targetState);
    if (!delivery.success) {
      return res.status(502).json({ ...delivery, code: 'LINE_DELIVERY_FAILED', message: 'Failed to send LINE notification' });
    }
    return res.status(200).json(delivery);
  } catch (error) {
    console.error('[line-notification]', {
      event: 'handler_failed',
      flow: 'work_permit',
      error: String(error?.message || 'Internal Server Error').slice(0, 300),
    });
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}
