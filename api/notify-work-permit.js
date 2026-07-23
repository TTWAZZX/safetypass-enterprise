import { cleanText, isRateLimited, requireAuthenticatedUser } from './_auth.js';
import { createLoginButton } from './_lineMessages.js';

export default async function handler(req, res) {
  // รับเฉพาะ Method POST
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // ✅ รับค่าจาก Frontend (ดึงมาครบถ้วนเหมือนเดิม)
  const auth = await requireAuthenticatedUser(req, res);
  if (!auth) return;

  const permitNo = cleanText(req.body?.permitNo, 32);
  if (!permitNo || !/^\d{10}$/.test(permitNo)) {
    return res.status(400).json({ message: 'Invalid permit number' });
  }
  if (isRateLimited(`work-permit:${auth.user.id}:${permitNo}`, 60 * 1000)) {
    return res.status(429).json({ message: 'Please wait before sending another notification' });
  }

  const permitQuery = new URLSearchParams({
    select: 'permit_no,expire_date,status',
    user_id: `eq.${auth.user.id}`,
    permit_no: `eq.${permitNo}`,
    status: 'eq.ACTIVE',
    expire_date: `gt.${new Date().toISOString()}`,
    limit: '1',
  });
  let permitRecord;
  try {
    const permitResponse = await fetch(`${auth.config.url}/rest/v1/work_permits?${permitQuery}`, {
      headers: { apikey: auth.config.anonKey, Authorization: auth.authorization },
    });
    const permits = permitResponse.ok ? await permitResponse.json() : [];
    if (!Array.isArray(permits) || permits.length !== 1) {
      return res.status(403).json({ message: 'No active permit was found for this user' });
    }
    permitRecord = permits[0];
  } catch {
    return res.status(503).json({ message: 'Permit verification is unavailable' });
  }

  const profileQuery = new URLSearchParams({
    select: 'name,vendors(name)',
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

  let profile;
  let examResult;
  try {
    const headers = { apikey: auth.config.anonKey, Authorization: auth.authorization };
    const [profileResponse, historyResponse] = await Promise.all([
      fetch(`${auth.config.url}/rest/v1/users?${profileQuery}`, { headers }),
      fetch(`${auth.config.url}/rest/v1/exam_history?${historyQuery}`, { headers }),
    ]);
    if (!profileResponse.ok || !historyResponse.ok) {
      return res.status(503).json({ message: 'Exam details are unavailable' });
    }
    const [profiles, history] = await Promise.all([profileResponse.json(), historyResponse.json()]);
    profile = profiles?.[0];
    examResult = history?.[0];
    if (!profile || !examResult) {
      return res.status(403).json({ message: 'Passed exam details were not found' });
    }
  } catch {
    return res.status(503).json({ message: 'Exam details are unavailable' });
  }

  const vendorRelation = Array.isArray(profile.vendors) ? profile.vendors[0] : profile.vendors;
  const name = cleanText(profile.name, 120) || 'Verified user';
  const vendor = cleanText(vendorRelation?.name, 120) || 'ไม่มีสังกัด';
  const score = Number(examResult.score);
  const maxScore = Number(examResult.total_questions);
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) {
    return res.status(422).json({ message: 'Invalid exam score' });
  }
  const status = 'PASSED';

  // ตรวจสอบสถานะการสอบ
  const isPassed = status === 'PASSED';

  const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
  const LINE_GROUP_ID = process.env.LINE_GROUP_ID;

  // 🌐 ตั้งค่า URL ของเว็บคุณ
  const BASE_URL = "https://safetypass-enterprise.vercel.app";

  if (!LINE_ACCESS_TOKEN || !LINE_GROUP_ID) {
    return res.status(500).json({ message: 'LINE Credentials Missing' });
  }

  // 🎨 ออกแบบ Flex Message แบบ Premium Enterprise
  const flexMessage = {
    to: LINE_GROUP_ID,
    messages: [
      {
        type: 'flex',
        altText: isPassed ? `สอบผ่าน: ${name}` : `สอบไม่ผ่าน: ${name}`,
        contents: {
          type: "bubble",
          size: "mega", // อัปเกรดขนาดให้ใหญ่ขึ้นเพื่อให้ข้อความไม่เบียดกัน
          header: {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  {
                    type: "text",
                    text: "SECURITY COMPLIANCE NODE",
                    color: "#EAB308", // สีทอง Premium
                    size: "xxs",
                    weight: "bold",
                    flex: 0
                  }
                ],
                paddingBottom: "5px"
              },
              {
                type: "text",
                text: isPassed ? "PERMIT APPROVED" : "ASSESSMENT FAILED",
                color: isPassed ? "#10B981" : "#EF4444", // เขียวถ้าผ่าน แดงถ้าตก
                weight: "bold",
                size: "lg",
                wrap: true
              }
            ],
            backgroundColor: "#0F172A", // สีน้ำเงินเข้มหรูหรา
            paddingAll: "20px",
            paddingTop: "22px",
            paddingBottom: "22px"
          },
          body: {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "text",
                text: "สรุปผลการทดสอบความปลอดภัยก่อนเข้างาน (Safety Induction & Work Permit)",
                weight: "regular",
                size: "xs",
                color: "#64748B",
                wrap: true,
                margin: "none"
              },
              {
                type: "separator",
                margin: "lg",
                color: "#E2E8F0"
              },
              {
                type: "box",
                layout: "vertical",
                margin: "lg",
                spacing: "md",
                contents: [
                  {
                    type: "box",
                    layout: "horizontal",
                    contents: [
                      { type: "text", text: "ใบอนุญาต", color: "#94A3B8", size: "sm", flex: 3 },
                      { 
                        type: "text", 
                        text: permitRecord.permit_no || "-",
                        wrap: true, 
                        color: "#0F172A", 
                        size: "sm", 
                        flex: 7, 
                        weight: "bold" 
                      }
                    ]
                  },
                  {
                    type: "box",
                    layout: "horizontal",
                    contents: [
                      { type: "text", text: "ชื่อ", color: "#94A3B8", size: "sm", flex: 3 },
                      { type: "text", text: name, wrap: true, color: "#0F172A", size: "sm", flex: 7, weight: "bold" }
                    ]
                  },
                  {
                    type: "box",
                    layout: "horizontal",
                    contents: [
                      { type: "text", text: "บริษัท", color: "#94A3B8", size: "sm", flex: 3 },
                      { type: "text", text: vendor || "ไม่มีสังกัด", wrap: true, color: "#0F172A", size: "sm", flex: 7, weight: "bold" }
                    ]
                  },
                  {
                    type: "box",
                    layout: "horizontal",
                    contents: [
                      { type: "text", text: "คะแนน", color: "#94A3B8", size: "sm", flex: 3 },
                      { 
                        type: "text", 
                        text: `${score} / ${maxScore}`, 
                        wrap: true, 
                        color: isPassed ? "#10B981" : "#EF4444", 
                        size: "sm", 
                        flex: 7, 
                        weight: "bold" 
                      }
                    ]
                  },
                  {
                    type: "box",
                    layout: "horizontal",
                    contents: [
                      { type: "text", text: "สถานะ", color: "#94A3B8", size: "sm", flex: 3 },
                      { 
                        type: "text", 
                        text: isPassed ? "ผ่านเกณฑ์ (บัตร 5 วัน)" : "ไม่ผ่านเกณฑ์ (สอบใหม่)", 
                        wrap: true, 
                        color: isPassed ? "#10B981" : "#EF4444", 
                        size: "sm", 
                        flex: 7, 
                        weight: "bold" 
                      }
                    ]
                  }
                ]
              }
            ],
            paddingAll: "20px"
          },
          // 🔗 ✅ ส่วนปุ่มกด (รักษาระบบและลิงก์เดิมไว้ 100%)
          footer: {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            paddingAll: "20px",
            paddingTop: "0px",
            contents: [
              {
                type: "button",
                style: "primary",
                height: "sm",
                color: "#3B82F6", // สีฟ้าน้ำทะเล
                action: {
                  type: "uri",
                  label: "ดูใบเซอร์ / Digital Pass",
                  "uri": `https://safetypass-enterprise.vercel.app/verify?permit=${encodeURIComponent(permitNo)}`
                }
              },
              {
                type: "button",
                style: "secondary",
                height: "sm",
                action: {
                  type: "uri",
                  label: "ระงับสิทธิ์สอบ (Admin)",
                  uri: `${BASE_URL}/admin?search=${encodeURIComponent(permitNo)}`
                }
              },
              createLoginButton()
            ]
          }
        }
      }
    ]
  };

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`
      },
      body: JSON.stringify(flexMessage)
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("LINE API Error:", errorData);
      return res.status(response.status).json({ error: errorData });
    }

    return res.status(200).json({ success: true, message: 'Notification sent!' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
