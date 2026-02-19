export default async function handler(req, res) {
  // รับเฉพาะ Method POST
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const { name, vendor, score, maxScore } = req.body;

  // ดึงค่าความลับจาก Environment Variables ใน Vercel
  const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
  const LINE_GROUP_ID = process.env.LINE_GROUP_ID;

  if (!LINE_ACCESS_TOKEN || !LINE_GROUP_ID) {
    return res.status(500).json({ message: 'LINE Credentials Missing' });
  }

  // 🎨 ออกแบบ Flex Message (เปลี่ยนสี/ข้อความได้ตามใจชอบ)
  const flexMessage = {
    to: LINE_GROUP_ID,
    messages: [
      {
        type: 'flex',
        altText: `แจ้งเตือน: ${name} สอบ Work Permit ผ่านแล้ว!`,
        contents: {
          type: "bubble",
          size: "kilo",
          header: {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "text",
                text: "✅ WORK PERMIT APPROVED",
                color: "#ffffff",
                weight: "bold",
                size: "sm"
              }
            ],
            backgroundColor: "#10b981", // สีเขียว Emerald
            paddingAll: "12px"
          },
          body: {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "text",
                text: "ผู้รับเหมาผ่านการทดสอบ",
                weight: "bold",
                size: "xl",
                color: "#1e293b",
                wrap: true
              },
              {
                type: "box",
                layout: "vertical",
                margin: "lg",
                spacing: "sm",
                contents: [
                  {
                    type: "box",
                    layout: "baseline",
                    spacing: "sm",
                    contents: [
                      { type: "text", text: "ชื่อ", color: "#64748b", size: "sm", flex: 2 },
                      { type: "text", text: name, wrap: true, color: "#0f172a", size: "sm", flex: 5, weight: "bold" }
                    ]
                  },
                  {
                    type: "box",
                    layout: "baseline",
                    spacing: "sm",
                    contents: [
                      { type: "text", text: "บริษัท", color: "#64748b", size: "sm", flex: 2 },
                      { type: "text", text: vendor || "ไม่มีสังกัด", wrap: true, color: "#0f172a", size: "sm", flex: 5 }
                    ]
                  },
                  {
                    type: "box",
                    layout: "baseline",
                    spacing: "sm",
                    contents: [
                      { type: "text", text: "คะแนน", color: "#64748b", size: "sm", flex: 2 },
                      { type: "text", text: `${score} / ${maxScore}`, wrap: true, color: "#3b82f6", size: "sm", flex: 5, weight: "bold" }
                    ]
                  },
                  {
                    type: "box",
                    layout: "baseline",
                    spacing: "sm",
                    contents: [
                      { type: "text", text: "อายุบัตร", color: "#64748b", size: "sm", flex: 2 },
                      { type: "text", text: "5 วัน", wrap: true, color: "#ef4444", size: "sm", flex: 5, weight: "bold" }
                    ]
                  }
                ]
              }
            ],
            paddingAll: "20px"
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