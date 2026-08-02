# TSH CTR GatePass — Phase 6 UAT และ Production Operations

เอกสารนี้ใช้สำหรับทดสอบและดูแลฟอร์มลงทะเบียน Contractor, Supplier และ Outsource หลังเปิดใช้งานจริง

## ขอบเขต

- ระบบหลัก: `https://safetypass-enterprise.vercel.app/`
- หน้าลงทะเบียน: `https://safetypass-enterprise.vercel.app/external-registration`
- ผู้ส่ง Email: `TSH CTR GatePass <safetytsh@gmail.com>`
- ผู้รับแจ้งเตือน Admin เริ่มต้น: `sattaya_w@thaisummit-harness.co.th`
- ไม่มี OTP, ไม่มีการสร้าง Password และไม่มีการเชื่อมต่อหรือสร้างบัญชีในระบบภายนอก

## UAT checklist

| ID | ผู้ทดสอบ | ขั้นตอน | ผลที่คาดหวัง |
| --- | --- | --- | --- |
| UAT-01 | ผู้สมัคร | เปิดหน้า `/external-registration` | เห็นฟอร์มภาษาไทยถูกต้องและเลือกประเภทได้หลายรายการ |
| UAT-02 | ผู้สมัคร | เลือก Contractor | แสดงระบบ Contractor Online |
| UAT-03 | ผู้สมัคร | เลือก Supplier และ Outsource | แสดงระบบ Supplier E-Pass เพียงรายการเดียว |
| UAT-04 | ผู้สมัคร | กรอกบริษัทใหม่ ชื่อไทย/อังกฤษ อีเมล โทรศัพท์ และผู้ประสานงาน TSH | ตรวจสอบ required fields ผ่าน |
| UAT-05 | ผู้สมัคร | ยอมรับ PDPA และส่งคำขอ | ได้เลขคำขอ `EXT-ปี-ลำดับ` ทันที ไม่มี OTP หรือ Password |
| UAT-06 | ผู้สมัคร | เปิด Tracking Link | เห็นสถานะ `SUBMITTED` และข้อมูลคำขอ |
| UAT-07 | Admin | เปิดเมนู External Requests | เห็นรายการคำขอและรายละเอียดครบ |
| UAT-08 | Admin | เลือกบริษัทเดิมหรือสร้างบริษัทใหม่ | สถานะบริษัทแยกจากสถานะคำขอ |
| UAT-09 | Admin | กดอนุมัติ | คำขอเป็น `APPROVED` และสร้าง Email ผลลัพธ์ |
| UAT-10 | Admin | กดไม่อนุมัติพร้อมเหตุผล | คำขอเป็น `REJECTED` และเหตุผลถูกบันทึก |
| UAT-11 | ผู้สมัคร | เปิด Email ผลลัพธ์ | ภาษาไทยถูกต้อง มีข้อมูลคำขอ และปุ่มเข้าสู่ระบบหลัก |
| UAT-12 | Admin | ใช้ส่ง Email ผลลัพธ์ซ้ำเมื่อครั้งแรกไม่สำเร็จ | ส่งซ้ำได้โดยไม่แก้สถานะคำขอ |

## วิธีทดสอบแบบปลอดภัย

1. ใช้ผู้สมัครทดสอบ `tawun666956666956@gmail.com` และชื่อบริษัทที่มีคำว่า `UAT` เท่านั้น
2. ห้ามใช้ข้อมูลส่วนบุคคลหรือบริษัทจริงในชุดทดสอบ
3. การทดสอบที่เขียนฐานข้อมูล Production ต้องทำในช่วงเวลาที่ Admin อนุมัติและต้องบันทึกเลขคำขอไว้
4. หลังจบทดสอบ ให้ Admin ปิดคำขอทดสอบตามนโยบายเก็บรักษาข้อมูลของบริษัท ห้ามลบข้อมูลด้วย SQL โดยพลการ
5. หากไม่ต้องการสร้างข้อมูล Production ให้ใช้ `npm run test:e2e:external-registration` และ SQL tests ซึ่งใช้ mock/transaction rollback

## คำสั่งตรวจสอบก่อนเปิดรับคำขอ

```text
npm run check:text
npm run check:external-registration
npm run test:uat:external-registration
npm run test:e2e:external-registration
npm test -- --run
npx tsc --noEmit
npm run build
```

สำหรับฐานข้อมูล ให้รัน SQL tests ที่มี transaction rollback:

```text
npm run test:db:external-registration:submission
npm run test:db:external-registration:admin
```

## Runbook เมื่อ Email มีปัญหา

1. ตรวจว่า `GMAIL_APP_PASSWORD` ยังอยู่ใน Vercel Production Environment Variables และเป็น App Password ที่ถูกต้อง
2. ตรวจรายชื่อผู้รับใน Admin > External Registration Email Settings ว่ายัง Active
3. เปิดรายละเอียดคำขอและกด `ส่ง Email ผลลัพธ์ซ้ำ`
4. ตรวจผลลัพธ์ในหน้า Admin และตรวจกล่อง Spam/Junk ของผู้รับ
5. หากยังไม่สำเร็จ ให้ปิด Feature Flag ชั่วคราว, แจ้งผู้สมัครด้วยเลขคำขอ และเก็บ Error สำหรับแก้ไข

## Runbook ฉุกเฉิน

- ปิดการรับคำขอ: ปิด Feature Flag `EXTERNAL_REGISTRATION_ENABLED` ผ่าน Admin settings
- ห้ามแก้ไขตารางคำขอโดยตรงเพื่อแก้ปัญหาเฉพาะหน้า
- ใช้ status history และ audit log เป็นหลักฐานการดำเนินการ
- เปิดใช้งานกลับหลังตรวจ Email, Admin recipient และ Production smoke ผ่านแล้ว

## เกณฑ์ผ่าน Phase 6

- UAT checklist UAT-01 ถึง UAT-12 ผ่าน หรือมีรายการที่ไม่เกี่ยวข้องถูกบันทึกเหตุผล
- ไม่มีข้อความไทยเพี้ยนหรือ replacement character
- Applicant และ Admin เห็นข้อมูลในขอบเขตสิทธิ์ของตนเอง
- การอนุมัติ/ปฏิเสธและ Email retry ทำงานได้
- ระบบเดิม regression tests ผ่าน
- มี Admin อย่างน้อยหนึ่งคนและมีผู้รับ Email สำรองก่อนเปิดใช้งานเต็มรูปแบบ
