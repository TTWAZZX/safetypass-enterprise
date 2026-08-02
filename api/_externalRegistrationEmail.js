import nodemailer from 'nodemailer';

export const EXTERNAL_REGISTRATION_SENDER = 'safetytsh@gmail.com';
export const EXTERNAL_REGISTRATION_BRAND = 'TSH CTR GatePass';
export const MAIN_SYSTEM_LOGIN_URL = (
  process.env.MAIN_SYSTEM_LOGIN_URL
  || process.env.EXTERNAL_REGISTRATION_LOGIN_URL
  || process.env.APP_URL
  || 'https://safetypass-enterprise.vercel.app/'
).replace(/\/$/, '');

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const isHttpUrl = (value) => /^https?:\/\//i.test(String(value ?? ''));

export const buildExternalRegistrationTrackingUrl = (requestNo, trackingToken) => {
  if (!requestNo || !trackingToken) return '';
  return `${MAIN_SYSTEM_LOGIN_URL}/external-registration/status?request=${encodeURIComponent(requestNo)}&token=${encodeURIComponent(trackingToken)}`;
};

export const buildExternalRegistrationEditUrl = (requestNo, trackingToken) => {
  const trackingUrl = buildExternalRegistrationTrackingUrl(requestNo, trackingToken);
  return trackingUrl ? `${trackingUrl}&mode=edit` : '';
};

const renderActions = (actions = []) => {
  const safeActions = actions.filter((item) => item?.url && isHttpUrl(item.url));
  if (safeActions.length === 0) return '';
  return `<div style="margin-top:26px;text-align:center;">${safeActions.map((item, index) => `<a href="${escapeHtml(item.url)}" style="display:inline-block;${index > 0 ? 'margin-left:8px;background:#fff;color:#1d4ed8;border:1px solid #93c5fd;' : 'background:#1d4ed8;color:#fff;border:1px solid #1d4ed8;'}text-decoration:none;border-radius:12px;padding:13px 20px;font-size:14px;font-weight:700;">${escapeHtml(item.label || 'เปิดลิงก์')}</a>`).join('')}</div>`;
};

const emailLayout = ({ eyebrow, title, intro, body, actions = [], action, secondaryAction, footer = EXTERNAL_REGISTRATION_BRAND }) => `<!doctype html>
<html lang="th"><head><meta charset="UTF-8"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head><body style="margin:0;background:#f1f5f9;color:#0f172a;font-family:Arial,'Noto Sans Thai',sans-serif;">
<div style="padding:32px 16px;"><div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:24px;overflow:hidden;box-shadow:0 12px 32px rgba(15,23,42,.08);">
<div style="background:#0f172a;padding:28px 32px;color:#fff;"><div style="font-size:11px;letter-spacing:2px;font-weight:700;color:#93c5fd;text-transform:uppercase;">${escapeHtml(eyebrow)}</div><h1 style="margin:10px 0 0;font-size:26px;line-height:1.25;">${escapeHtml(title)}</h1></div>
<div style="padding:30px 32px;"><p style="font-size:15px;line-height:1.8;margin:0 0 18px;">${escapeHtml(intro)}</p>${body}${renderActions(actions.length > 0 ? actions : [action, secondaryAction])}</div>
<div style="border-top:1px solid #e2e8f0;padding:18px 32px;color:#64748b;font-size:12px;line-height:1.7;">${escapeHtml(footer)}<br/>อีเมลนี้ถูกส่งจากระบบอัตโนมัติ กรุณาอย่าตอบกลับอีเมลนี้</div>
</div></div></body></html>`;

export function renderExternalRegistrationTestEmail(recipientName = '') {
  const name = recipientName ? `คุณ ${recipientName}` : 'ผู้ดูแลระบบ';
  return {
    subject: `[${EXTERNAL_REGISTRATION_BRAND}] ทดสอบการตั้งค่า Email แจ้งเตือน`,
    text: `เรียน ${name}\n\nอีเมลนี้เป็นการทดสอบการตั้งค่า Email สำหรับ External Registration จาก ${EXTERNAL_REGISTRATION_BRAND}\n\nผู้ส่ง: ${EXTERNAL_REGISTRATION_SENDER}`,
    html: emailLayout({
      eyebrow: EXTERNAL_REGISTRATION_BRAND,
      title: 'ทดสอบการตั้งค่า Email สำเร็จ',
      intro: `เรียน ${name}`,
      body: `<div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:16px;padding:18px 20px;color:#065f46;font-size:14px;line-height:1.8;">ระบบสามารถส่ง Email จาก <strong>${EXTERNAL_REGISTRATION_SENDER}</strong> ได้เรียบร้อยแล้ว</div>`,
      action: { url: MAIN_SYSTEM_LOGIN_URL, label: 'เข้าสู่ระบบหลัก TSH CTR GatePass' },
    }),
  };
}

export function renderExternalRegistrationAdminNotice(application) {
  const rows = [
    ['เลขที่คำขอ', application.requestNo],
    ['บริษัท', application.companyName],
    ['ผู้สมัคร', application.applicantName],
    ['ประเภท', application.types],
    ['Email', application.email],
    ['เบอร์โทร', application.phone],
    ['ผู้ประสานงาน TSH', application.coordinators],
  ].map(([label, value]) => `<tr><td style="padding:9px 0;color:#64748b;width:35%;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:9px 0;font-weight:700;vertical-align:top;">${escapeHtml(value)}</td></tr>`).join('');
  return {
    subject: `[External Registration] มีคำขอใหม่ ${application.requestNo}`,
    text: `มีคำขอลงทะเบียนใหม่ ${application.requestNo}\nบริษัท: ${application.companyName}\nผู้สมัคร: ${application.applicantName}\nประเภท: ${application.types}\nEmail: ${application.email}`,
    html: emailLayout({
      eyebrow: 'External Registration',
      title: 'มีคำขอลงทะเบียนใหม่',
      intro: 'กรุณาตรวจสอบข้อมูลและดำเนินการใน Admin Portal',
      body: `<table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.6;">${rows}</table>`,
      action: { url: MAIN_SYSTEM_LOGIN_URL, label: 'เข้าสู่ระบบหลัก (Admin)' },
    }),
  };
}

export function renderExternalRegistrationApplicantNotice({ status, requestNo, companyName, applicantName, types, email, note = '', trackingUrl = '', editUrl = '' }) {
  const statusText = status === 'APPROVED'
    ? 'คำขอของท่านได้รับการอนุมัติแล้ว'
    : status === 'REJECTED'
      ? 'คำขอของท่านไม่ได้รับการอนุมัติ'
      : status === 'NEED_MORE_INFO'
        ? 'กรุณาส่งข้อมูลเพิ่มเติมสำหรับคำขอของท่าน'
        : status === 'UNDER_REVIEW'
          ? 'คำขอของท่านอยู่ระหว่างการตรวจสอบ'
      : 'ระบบได้รับคำขอของท่านแล้ว';
  const noteBlock = note ? `<div style="margin-top:18px;background:#fffbeb;border:1px solid #fde68a;border-radius:16px;padding:16px 18px;color:#92400e;font-size:14px;line-height:1.8;"><strong>หมายเหตุ:</strong><br/>${escapeHtml(note)}</div>` : '';
  const approvedBlock = status === 'APPROVED' ? `<div style="margin-top:18px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:16px;padding:16px 18px;color:#1e40af;font-size:14px;line-height:1.8;">คำขอของท่านได้รับการตรวจสอบและอนุมัติโดย ${EXTERNAL_REGISTRATION_BRAND} แล้ว</div>` : '';
  const safeTrackingUrl = isHttpUrl(trackingUrl) ? trackingUrl : '';
  const safeEditUrl = isHttpUrl(editUrl) ? editUrl : '';
  const editText = safeEditUrl ? `\nแก้ไขข้อมูลและส่งคำขออีกครั้ง: ${safeEditUrl}` : '';
  const trackingText = safeTrackingUrl ? `\nติดตามสถานะคำขอ: ${safeTrackingUrl}` : '';
  return {
    subject: status === 'APPROVED' ? `อนุมัติคำขอลงทะเบียนแล้ว ${requestNo}` : `อัปเดตคำขอลงทะเบียน ${requestNo}`,
    text: `${statusText}\nเลขที่คำขอ: ${requestNo}\nบริษัท: ${companyName}\nประเภท: ${types}\nEmail: ${email}${note ? `\nหมายเหตุ: ${note}` : ''}${editText}${trackingText}`,
    html: emailLayout({
      eyebrow: EXTERNAL_REGISTRATION_BRAND,
      title: statusText,
      intro: `เรียน ${applicantName || 'ผู้สมัคร'}`,
      body: `<table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.6;"><tr><td style="padding:9px 0;color:#64748b;width:35%;">เลขที่คำขอ</td><td style="padding:9px 0;font-weight:700;">${escapeHtml(requestNo)}</td></tr><tr><td style="padding:9px 0;color:#64748b;">บริษัท</td><td style="padding:9px 0;font-weight:700;">${escapeHtml(companyName)}</td></tr><tr><td style="padding:9px 0;color:#64748b;">ประเภท</td><td style="padding:9px 0;font-weight:700;">${escapeHtml(types)}</td></tr><tr><td style="padding:9px 0;color:#64748b;">Email ที่แจ้งไว้</td><td style="padding:9px 0;font-weight:700;">${escapeHtml(email)}</td></tr></table>${approvedBlock}${noteBlock}`,
      actions: [
        { url: ['NEED_MORE_INFO', 'REJECTED'].includes(status) ? safeEditUrl : '', label: status === 'REJECTED' ? 'แก้ไขข้อมูลและส่งคำขอใหม่' : 'แก้ไขและส่งข้อมูลเพิ่มเติม' },
        { url: safeTrackingUrl, label: 'ติดตามสถานะคำขอ' },
        { url: MAIN_SYSTEM_LOGIN_URL, label: 'เข้าสู่ระบบหลัก TSH CTR GatePass' },
      ],
    }),
  };
}

function createTransport() {
  const password = (process.env.GMAIL_APP_PASSWORD || process.env.EMAIL_APP_PASSWORD || '').replace(/\s/g, '');
  if (!password) throw new Error('Gmail sender is not configured');
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EXTERNAL_REGISTRATION_SENDER, pass: password },
  });
}

export async function sendExternalRegistrationEmail({ to, subject, text, html }) {
  return createTransport().sendMail({
    from: `${EXTERNAL_REGISTRATION_BRAND} <${EXTERNAL_REGISTRATION_SENDER}>`,
    to,
    subject,
    text,
    html,
    headers: { 'Content-Language': 'th-TH' },
  });
}
