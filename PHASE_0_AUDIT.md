# Phase 0 — สำรวจและเตรียมความปลอดภัย

วันที่ตรวจสอบ: 26 กรกฎาคม 2026

## ขอบเขต

- ตรวจสถานะ Git และไฟล์ที่เกี่ยวข้อง โดยไม่แก้ข้อมูล Supabase
- ตรวจ Registration, Exam, Digital Pass, QR, LINE, Dashboard และ Excel Export
- ตรวจ Migration และ RLS ทั้งใน Repository และฐานข้อมูลที่เชื่อมต่อ
- สำรองเฉพาะ Public Schema โดยไม่มีข้อมูลแถว
- เก็บผล Audit, Test, Typecheck, Build และ Text encoding เป็น Baseline

## สถานะก่อนเริ่มพัฒนา

- Branch: `main`
- Commit เริ่มต้น: `7dd6d3d`
- Worktree ก่อนเริ่ม: สะอาด
- Local Migration ตรงกับ Remote Migration ครบ 4 รายการ
  - `20260722195000_secure_read_rpcs.sql`
  - `20260722201500_secure_exam_submission.sql`
  - `20260722203000_harden_rls.sql`
  - `20260722210000_add_public_induction_verification.sql`

## Schema backup

- ไฟล์: `supabase-schema-backup-20260726.sql`
- ขอบเขต: Schema `public` เท่านั้น
- ไม่มีคำสั่ง `COPY` หรือ `INSERT INTO` สำหรับข้อมูลแถว
- SHA-256: `5FC8C9D777B383259836B50C211B2F9204099DC7691CC1121B1D80025C8DCF73`

## Baseline verification

- `npm audit`: 0 vulnerabilities
- `npm test`: 27/27 tests passed
- `npx tsc --noEmit`: passed
- `npm run build`: passed
- `npm run check:text`: passed
- Build มีคำเตือนเรื่อง JavaScript chunk ขนาดใหญ่ แต่ไม่ทำให้ Build ล้มเหลว

## แผนที่จุดเชื่อมต่อที่ต้องแก้ใน Phase ถัดไป

### Registration และข้อมูลผู้ใช้

- `src/components/Auth.tsx`
- `src/services/supabaseApi.ts`
- `src/types.ts`
- ตาราง `users` และ `vendors`

ระบบสมัครปัจจุบันสร้าง Auth user, สร้างหรือเลือกบริษัท, เชื่อมข้อมูลผู้ใช้ที่แอดมินเตรียมไว้ และโอนประวัติเดิมด้วยคำสั่งหลายคำสั่งจาก Client จึงต้องรักษา Flow ผู้ใช้เดิมและเพิ่มการตรวจสอบความสมบูรณ์ของข้อมูลก่อนเพิ่มสิทธิ์หลายหลักสูตร

### Exam และ Settings

- `src/components/ExamSystem.tsx`
- `src/components/QuestionManager.tsx`
- `src/components/SettingsManager.tsx`
- `src/services/supabaseApi.ts`
- RPC `get_exam_questions`
- RPC `submit_safety_exam`

ปัจจุบันมีการแยกเพียง `INDUCTION` และ `WORK_PERMIT` หลายจุดใช้เงื่อนไขสองทาง หากเพิ่มประเภทที่สามโดยไม่แก้ทุกจุด ระบบจะตีความเป็น Work Permit ผิดประเภท

### Digital Pass และ QR

- `src/components/UserPanel.tsx`
- `src/components/DigitalCard.tsx`
- `src/components/VerifyPage.tsx`
- RPC `verify_induction_pass`
- RPC `verify_safety_pass`

ต้องเพิ่มประเภทใหม่แบบแยกจากวันหมดอายุ Induction และ Work Permit พร้อมจำกัดข้อมูลเลขบัตรที่หน้า Public verification

### LINE

- `api/_lineMessages.js`
- `api/notify-admin.js`
- `api/notify-induction.js`
- `api/notify-work-permit.js`
- `src/components/ExamSystem.tsx`

ต้องเพิ่ม Endpoint และ Flex Message ของ Supplier & Outsource โดยตรวจผลสอบจาก Server ก่อนส่ง และใช้ UTF-8 ตลอดเส้นทาง

### Dashboard และ Excel

- `src/components/AdminDashboard.tsx`
- `src/components/VendorManager.tsx`
- `src/services/excelExport.ts`
- `src/services/excelImport.ts`

รายงาน Supplier & Outsource ต้องเป็นคนละไฟล์กับรายงานเดิม และต้องใช้คอลัมน์ตามไฟล์ตัวอย่างโดยไม่เปลี่ยนชื่อไฟล์ คอลัมน์ หรือ Flow ของ Export ผู้รับเหมาเดิม

## จุดเสี่ยงที่ต้องแก้ก่อนเปิดฟีเจอร์ใหม่

### ระดับสูง

1. Policy `users_update_own_or_admin` อนุญาตให้ผู้ใช้แก้แถวของตัวเองแบบกว้าง ไม่มีการจำกัดคอลัมน์ จึงต้องป้องกันการแก้ `role`, สถานะบัญชี และวันหมดอายุจาก Client
2. RPC รุ่นเก่า `submit_exam_attempt` ยังอยู่ในฐานข้อมูลและยังมีสิทธิ์เรียกสำหรับ `authenticated` แม้ระบบปัจจุบันใช้ `submit_safety_exam` แล้ว RPC เก่านี้ไม่มีการตรวจ Induction ก่อนสร้าง Work Permit เทียบเท่า RPC ปัจจุบัน
3. ฟังก์ชันเข้ารหัสเลขบัตรใช้คีย์ตัวอย่างที่ฝังอยู่ในฟังก์ชันฐานข้อมูล ต้องวางแผนหมุนคีย์และย้าย Secret โดยไม่ทำให้ผู้ใช้เดิมเข้าสู่ระบบไม่ได้

### ระดับกลาง

1. Default privileges ของ Schema ให้สิทธิ์กว้างกับ `anon` และ `authenticated` ต้องกำหนด Grant/Revoke ราย Object ให้ชัดเจน
2. RPC บางตัวที่ไม่ควรใช้แบบ Anonymous ยังมี Explicit grant ให้ `anon` แม้ภายในบางฟังก์ชันจะตรวจ `auth.uid()` อยู่แล้ว
3. RPC `check_user_exists` สามารถคืนชื่อ อายุ สัญชาติ และบริษัทจากเลขบัตรที่ค้นหา ต้องจำกัดข้อมูลและป้องกันการไล่ตรวจเลขบัตร
4. Registration ปัจจุบันมีขั้นตอนโอนข้อมูลและลบ Dummy user หลายคำสั่งจาก Client ไม่เป็น Transaction เดียว หากคำสั่งกลางทางล้มเหลวอาจเกิดข้อมูลไม่ครบ

### ระดับต่ำ

1. Production bundle มี Chunk ขนาดใหญ่ ควรแยกโหลด Excel และส่วน Admin เพิ่มเติมภายหลัง โดยไม่ใช่ตัวขวาง Phase 1
2. Test ปัจจุบันครอบคลุม 27 กรณีในระดับ Unit แต่ยังไม่มี Automated end-to-end test สำหรับ Registration, RLS, QR และ LINE

## แนวทาง Phase 1 ที่ปลอดภัย

1. สร้าง Migration ใหม่แบบ Forward-only ห้ามแก้ Migration ที่ Apply แล้ว
2. ปิดหรือถอนสิทธิ์ RPC รุ่นเก่าที่ไม่ใช้ ก่อนเพิ่ม RPC ใหม่
3. จำกัดสิทธิ์แก้ข้อมูลผู้ใช้ โดยให้ข้อมูลสำคัญเปลี่ยนผ่าน RPC ที่ตรวจสอบค่าเท่านั้น
4. เพิ่มตารางสิทธิ์หลักสูตรแบบ Additive โดยไม่เปลี่ยน `role` เดิม
5. Backfill ผู้ใช้เดิมเป็น `CONTRACTOR` ภายใน Transaction และตรวจจำนวนก่อนกับหลัง
6. เพิ่ม `SUPPLIER_OUTSOURCE` เป็นสิทธิ์แยก พร้อม Constraint สำหรับ `supplier`, `outsource`, `Driver`, `Passenger`, `Trainee`
7. เพิ่ม Feature flag ค่าเริ่มต้นเป็นปิด เพื่อ Apply Schema ได้ก่อนโดย UI เดิมไม่เปลี่ยน
8. รัน `supabase db push --dry-run` และทดสอบกับฐาน Local ก่อน Apply Remote

## แผนย้อนกลับ

- ไม่ลบหรือเปลี่ยนความหมายคอลัมน์เดิม
- ไม่เปลี่ยน Role ของผู้ใช้เดิม
- ตารางและคอลัมน์ใหม่ต้องเป็น Additive และ Nullable ตามความเหมาะสม
- Feature ใหม่ต้องปิดได้ด้วย Feature flag โดยไม่ Rollback ข้อมูล
- หาก Deployment มีปัญหา ให้ย้อน Frontend/API ไป Commit ก่อนหน้า และคง Schema ใหม่ที่ยังไม่ถูกใช้งาน
- การแก้ Schema หลัง Apply ให้ใช้ Forward migration เท่านั้น ห้ามแก้ไฟล์ Migration ที่เคยขึ้น Production
- ก่อน Apply ทุกครั้งต้องเทียบ Migration list, ตรวจ Schema backup และบันทึกจำนวนแถวที่ได้รับผลจาก Backfill

## เงื่อนไขผ่าน Phase 0

- Git เริ่มต้นสะอาด
- Migration Local และ Remote ตรงกัน
- มี Schema backup พร้อม Checksum
- Baseline ทุกคำสั่งผ่าน
- ระบุจุดเชื่อมต่อ จุดเสี่ยง และแผนย้อนกลับแล้ว

Phase 0 ผ่านครบ และยังไม่มีการแก้ข้อมูล Supabase หรือเปิดใช้ฟีเจอร์ Supplier & Outsource
