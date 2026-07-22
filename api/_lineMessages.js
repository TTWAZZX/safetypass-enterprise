export const APP_URL = 'https://safetypass-enterprise.vercel.app';

export function createLoginButton() {
  return {
    type: 'button',
    style: 'secondary',
    height: 'sm',
    action: {
      type: 'uri',
      label: 'เข้าสู่ระบบ / Login',
      uri: APP_URL,
      altUri: { desktop: APP_URL },
    },
  };
}

export function createInductionPassMessage({ name, vendor, score, totalQuestions, expiryDate, nationalId }) {
  const digitalPassUrl = `${APP_URL}/verify?id=${encodeURIComponent(nationalId)}`;
  const formattedExpiry = new Date(expiryDate).toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return {
    type: 'flex',
    altText: `สอบผ่าน Safety Induction: ${name}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: 'SECURITY COMPLIANCE NODE',
            color: '#EAB308',
            size: 'xxs',
            weight: 'bold',
          },
          {
            type: 'text',
            text: 'INDUCTION PASSED',
            color: '#10B981',
            weight: 'bold',
            size: 'lg',
            wrap: true,
            margin: 'sm',
          },
        ],
        backgroundColor: '#0F172A',
        paddingAll: '20px',
        paddingTop: '22px',
        paddingBottom: '22px',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: 'สรุปผลการทดสอบ Safety Induction',
            size: 'xs',
            color: '#64748B',
            wrap: true,
          },
          { type: 'separator', margin: 'lg', color: '#E2E8F0' },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            spacing: 'md',
            contents: [
              createDetailRow('ชื่อ', name),
              createDetailRow('บริษัท', vendor || 'ไม่มีสังกัด'),
              createDetailRow('คะแนน', `${score} / ${totalQuestions}`, '#10B981'),
              createDetailRow('สถานะ', 'ผ่านเกณฑ์ Safety Induction', '#10B981'),
              createDetailRow('ใช้ได้ถึง', formattedExpiry),
            ],
          },
        ],
        paddingAll: '20px',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '20px',
        paddingTop: '0px',
        contents: [
          {
            type: 'button',
            style: 'primary',
            height: 'sm',
            color: '#3B82F6',
            action: {
              type: 'uri',
              label: 'ดู Digital Safety Pass',
              uri: digitalPassUrl,
              altUri: { desktop: digitalPassUrl },
            },
          },
          createLoginButton(),
        ],
      },
    },
  };
}

function createDetailRow(label, value, valueColor = '#0F172A') {
  return {
    type: 'box',
    layout: 'horizontal',
    contents: [
      { type: 'text', text: label, color: '#94A3B8', size: 'sm', flex: 3 },
      { type: 'text', text: String(value), wrap: true, color: valueColor, size: 'sm', flex: 7, weight: 'bold' },
    ],
  };
}
