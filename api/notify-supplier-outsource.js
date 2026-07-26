import { cleanText, isRateLimited, requireAuthenticatedUser } from './_auth.js';
import { createSupplierOutsourcePassMessage } from './_lineMessages.js';

const MAX_NOTIFICATION_AGE_MS = 30 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });
  const auth = await requireAuthenticatedUser(req, res);
  if (!auth) return;
  if (isRateLimited(`supplier-outsource:${auth.user.id}`, 60 * 1000)) {
    return res.status(429).json({ message: 'Please wait before sending another notification' });
  }

  const lineAccessToken = process.env.LINE_ACCESS_TOKEN;
  const lineGroupId = process.env.LINE_GROUP_ID;
  if (!lineAccessToken || !lineGroupId) return res.status(500).json({ message: 'LINE credentials missing' });

  try {
    const headers = { apikey: auth.config.anonKey, Authorization: auth.authorization };
    const profileQuery = new URLSearchParams({
      select: 'name,line_user_id,vendors(name)', id: `eq.${auth.user.id}`, limit: '1',
    });
    const accessQuery = new URLSearchParams({
      select: 'participant_type,work_type', user_id: `eq.${auth.user.id}`,
      program_code: 'eq.SUPPLIER_OUTSOURCE', limit: '1',
    });
    const passQuery = new URLSearchParams({
      select: 'verification_token,exam_history_id,issued_at,expires_at,status',
      user_id: `eq.${auth.user.id}`, status: 'eq.ACTIVE', order: 'issued_at.desc', limit: '1',
    });
    const [profileResponse, accessResponse, passResponse] = await Promise.all([
      fetch(`${auth.config.url}/rest/v1/users?${profileQuery}`, { headers }),
      fetch(`${auth.config.url}/rest/v1/user_training_access?${accessQuery}`, { headers }),
      fetch(`${auth.config.url}/rest/v1/supplier_outsource_passes?${passQuery}`, { headers }),
    ]);
    if (!profileResponse.ok || !accessResponse.ok || !passResponse.ok) {
      return res.status(503).json({ message: 'Pass verification is unavailable' });
    }
    const [profiles, accessRows, passRows] = await Promise.all([
      profileResponse.json(), accessResponse.json(), passResponse.json(),
    ]);
    const profile = profiles?.[0];
    const access = accessRows?.[0];
    const pass = passRows?.[0];
    const issuedAge = pass?.issued_at ? Date.now() - new Date(pass.issued_at).getTime() : Infinity;
    if (!profile || !access || !pass || issuedAge < 0 || issuedAge > MAX_NOTIFICATION_AGE_MS
        || new Date(pass.expires_at).getTime() <= Date.now()) {
      return res.status(403).json({ message: 'No recent active Supplier and Outsource pass was found' });
    }

    const historyQuery = new URLSearchParams({
      select: 'score,total_questions,created_at,status', id: `eq.${pass.exam_history_id}`,
      user_id: `eq.${auth.user.id}`, exam_type: 'eq.SUPPLIER_OUTSOURCE', status: 'eq.PASSED', limit: '1',
    });
    const historyResponse = await fetch(`${auth.config.url}/rest/v1/exam_history?${historyQuery}`, { headers });
    const historyRows = historyResponse.ok ? await historyResponse.json() : [];
    const history = historyRows?.[0];
    if (!history) return res.status(403).json({ message: 'Passed exam details were not found' });

    const vendorRelation = Array.isArray(profile.vendors) ? profile.vendors[0] : profile.vendors;
    const message = createSupplierOutsourcePassMessage({
      name: cleanText(profile.name, 120) || 'Verified user',
      vendor: cleanText(vendorRelation?.name, 120) || 'ไม่มีสังกัด',
      participantType: access.participant_type,
      workType: access.work_type,
      score: Number(history.score) || 0,
      totalQuestions: Number(history.total_questions) || 0,
      testDate: history.created_at,
      expiryDate: pass.expires_at,
      verificationToken: pass.verification_token,
    });

    const targets = [lineGroupId];
    const directLineId = cleanText(profile.line_user_id, 40);
    if (/^U[0-9A-Fa-f]{32}$/.test(directLineId) && directLineId !== lineGroupId) targets.push(directLineId);
    const responses = await Promise.all(targets.map((target) => fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lineAccessToken}` },
      body: JSON.stringify({ to: target, messages: [message] }),
    })));
    if (responses.some((response) => !response.ok)) {
      console.error('LINE API Error: Supplier and Outsource notification failed');
      return res.status(502).json({ message: 'Failed to send LINE notification' });
    }
    return res.status(200).json({ success: true, destinations: targets.length });
  } catch (error) {
    console.error('Supplier and Outsource notification error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}
