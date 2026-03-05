// ไฟล์: api/notify-admin.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const { vendorName, adminEmail } = req.body;

  // 🔒 ดึงค่าจาก Vercel Environment Variables
  const LINE_TOKEN = process.env.LINE_ACCESS_TOKEN; 
  const ADMIN_LINE_USER_ID = process.env.ADMIN_LINE_USER_ID;

  if (!LINE_TOKEN || !ADMIN_LINE_USER_ID) {
      console.warn("❌ LINE Credentials not found in Vercel Env Vars.");
      return res.status(500).json({ message: "Server configuration error: Missing LINE Tokens" });
  }

  // ⏰ รูปแบบเวลา
  const timestamp = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

  // 🎨 สร้าง Flex Message ระดับ Premium
  const flexMessage = {
    type: "flex",
    altText: `🚨 มีบริษัทใหม่ลงทะเบียน: ${vendorName}`,
    contents: {
      type: "bubble",
      size: "mega",
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
                color: "#EAB308",
                size: "xxs",
                weight: "bold",
                flex: 0
              }
            ],
            paddingBottom: "5px"
          },
          {
            type: "text",
            text: "New Vendor Request",
            color: "#FFFFFF",
            size: "xl",
            weight: "bold"
          }
        ],
        backgroundColor: "#0F172A",
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
            text: "มีการขอเพิ่มรายชื่อบริษัทใหม่เข้าสู่ระบบ กรุณาตรวจสอบและดำเนินการอนุมัติ",
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
            type: "box", // ✅ แก้ไขแล้ว (ลบ quote ที่เกินมา)
            layout: "vertical",
            margin: "lg",
            spacing: "md", // ✅ แก้ไขแล้ว (ลบ quote ที่เกินมา)
            contents: [
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  {
                    type: "text",
                    text: "🏢 บริษัท",
                    color: "#94A3B8",
                    size: "sm",
                    flex: 3
                  },
                  {
                    type: "text",
                    text: vendorName,
                    color: "#0F172A",
                    size: "sm",
                    weight: "bold",
                    flex: 7,
                    wrap: true
                  }
                ]
              },
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  {
                    type: "text",
                    text: "👤 ผู้ติดต่อ",
                    color: "#94A3B8",
                    size: "sm",
                    flex: 3
                  },
                  {
                    type: "text",
                    text: adminEmail || 'User',
                    color: "#0F172A",
                    size: "sm",
                    weight: "bold",
                    flex: 7,
                    wrap: true
                  }
                ]
              },
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  {
                    type: "text",
                    text: "⏰ เวลา",
                    color: "#94A3B8",
                    size: "sm",
                    flex: 3
                  },
                  {
                    type: "text",
                    text: timestamp,
                    color: "#0F172A",
                    size: "sm",
                    weight: "bold",
                    flex: 7,
                    wrap: true
                  }
                ]
              }
            ]
          }
        ],
        paddingAll: "20px"
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "text",
                text: "ระบบจัดการ VENDOR",
                size: "xs",
                color: "#10B981",
                weight: "bold",
                align: "center"
              }
            ],
            backgroundColor: "#ECFDF5",
            paddingAll: "10px",
            cornerRadius: "8px"
          }
        ],
        paddingAll: "20px",
        paddingTop: "0px"
      },
      styles: {
        footer: {
          separator: false
        }
      }
    }
  };

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_TOKEN}`
      },
      body: JSON.stringify({
        to: ADMIN_LINE_USER_ID,
        messages: [flexMessage]
      })
    });

    if (!response.ok) {
      const errRes = await response.text();
      console.error("LINE API Error:", errRes);
      return res.status(response.status).json({ message: 'Failed to send LINE notification' });
    }

    return res.status(200).json({ message: 'Notification sent successfully' });
  } catch (error) {
    console.error("Fetch Error:", error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}