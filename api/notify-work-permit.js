export default async function handler(req, res) {
  // รับเฉพาะ Method POST
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // ✅ รับค่าจาก Frontend (เพิ่ม status เพื่อเช็คว่าผ่านหรือไม่ผ่าน)
  const { name, vendor, score, maxScore, permitNo, status } = req.body;

  // ตรวจสอบสถานะการสอบ
  const isPassed = status === 'PASSED';

  const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
  const LINE_GROUP_ID = process.env.LINE_GROUP_ID;

  if (!LINE_ACCESS_TOKEN || !LINE_GROUP_ID) {
    return res.status(500).json({ message: 'LINE Credentials Missing' });
  }

  // 🎨 ออกแบบ Flex Message (ปรับเปลี่ยนตามสถานะ Passed/Failed)
  const flexMessage = {
    to: LINE_GROUP_ID,
    messages: [
      {
        type: 'flex',
        altText: isPassed ? `✅ สอบผ่าน: ${name}` : `❌ สอบไม่ผ่าน: ${name}`,
        contents: {
          type: "bubble",
          size: "kilo",
          header: {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "text",
                text: isPassed ? "✅ WORK PERMIT APPROVED" : "❌ ASSESSMENT FAILED",
                color: "#ffffff",
                weight: "bold",
                size: "sm"
              }
            ],
            backgroundColor: isPassed ? "#10b981" : "#ef4444", // สีเขียวถ้าผ่าน สีแดงถ้าไม่ผ่าน
            paddingAll: "12px"
          },
          body: {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "text",
                text: isPassed ? "ผู้รับเหมาผ่านการทดสอบ" : "ผู้รับเหมาไม่ผ่านการทดสอบ",
                weight: "bold",
                size: "lg",
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
                      { type: "text", text: "เลขใบอนุญาต", color: "#64748b", size: "sm", flex: 3 },
                      { 
                        type: "text", 
                        text: permitNo || "-", 
                        wrap: true, 
                        color: isPassed ? "#f59e0b" : "#1e293b", // สีส้มถ้าผ่านเพื่อให้เด่น
                        size: "sm", 
                        flex: 6, 
                        weight: "bold" 
                      }
                    ]
                  },
                  {
                    type: "box",
                    layout: "baseline",
                    spacing: "sm",
                    contents: [
                      { type: "text", text: "ชื่อ", color: "#64748b", size: "sm", flex: 3 },
                      { type: "text", text: name, wrap: true, color: "#0f172a", size: "sm", flex: 6, weight: "bold" }
                    ]
                  },
                  {
                    type: "box",
                    layout: "baseline",
                    spacing: "sm",
                    contents: [
                      { type: "text", text: "บริษัท", color: "#64748b", size: "sm", flex: 3 },
                      { type: "text", text: vendor || "ไม่มีสังกัด", wrap: true, color: "#0f172a", size: "sm", flex: 6 }
                    ]
                  },
                  {
                    type: "box",
                    layout: "baseline",
                    spacing: "sm",
                    contents: [
                      { type: "text", text: "คะแนน", color: "#64748b", size: "sm", flex: 3 },
                      { 
                        type: "text", 
                        text: `${score} / ${maxScore}`, 
                        wrap: true, 
                        color: isPassed ? "#10b981" : "#ef4444", 
                        size: "sm", 
                        flex: 6, 
                        weight: "bold" 
                      }
                    ]
                  },
                  {
                    type: "box",
                    layout: "baseline",
                    spacing: "sm",
                    contents: [
                      { type: "text", text: "สถานะ", color: "#64748b", size: "sm", flex: 3 },
                      { 
                        type: "text", 
                        text: isPassed ? "ผ่านเกณฑ์ (บัตร 5 วัน)" : "ไม่ผ่านเกณฑ์ (สอบใหม่)", 
                        wrap: true, 
                        color: isPassed ? "#10b981" : "#ef4444", 
                        size: "sm", 
                        flex: 6, 
                        weight: "bold" 
                      }
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