# Phase 1 User 360 — Staging Validation

วันที่ตรวจสอบ: 18 สิงหาคม 2026
สถานะล่าสุด: **PRODUCTION ROLLOUT COMPLETE — USER 360 ENABLED**
หมายเหตุ: ผล NO-GO ของ Staging project เดิมด้านล่างยังคงเป็นหลักฐานที่ถูกต้อง เพราะ project นั้นเป็นฐานของระบบอื่นและไม่ได้ถูกแก้ไข

## ขอบเขตและข้อจำกัด

- ตรวจเฉพาะ Staging แบบ read-only transaction
- ยืนยันว่า Staging project ref แตกต่างจาก Production
- ไม่ Deploy, ไม่ Apply Migration, ไม่เปลี่ยน feature flag และไม่แก้ข้อมูล Production/Staging
- ไม่อ่านหรือบันทึกค่าของ database password, service-role key หรือ PIN pepper ลงรายงาน

## ผล Preflight

คำสั่ง: `npm run check:staging:user360`

- PostgreSQL: 17.6
- Staging Auth users: 116
- Migration history: มี 5 รายการ
- Latest applied migration: `20260426000004`
- Phase migrations `20260818103000`, `20260818120000`, `20260818143000`: ยังไม่ถูก apply
- ตารางฐานที่ต้องใช้ เช่น `public.users`, `vendors`, `questions`, `exam_history`, `work_permits`, `audit_logs`, `user_training_access`, `system_config` และ `user_auth_security`: ไม่มี
- `ADMIN_USER360_ENABLED`: ยังไม่มี เนื่องจาก `system_config` ไม่มี
- Staging-only service-role key และ PIN pepper: ยังไม่ได้กำหนดใน local validation environment
- Public relations ทั้ง 28 รายการเป็นของระบบอื่น เช่น `employees`, `hazard_reports`, `security_personnel_master` และ `violation_reports`
- Auth users ทั้ง 116 รายไม่มี SafetyPass `public.users` profile ให้เชื่อมโยง

## Supabase Branch Attempt

- ตรวจพบ Supabase projects 2 รายการ และไม่มี preview/persistent branch ที่สร้างไว้
- ขอสร้าง preview branch `user360-staging-20260818` ใน region เดิม ขนาด micro และไม่ใช้ `--with-data`
- Supabase ปฏิเสธด้วย HTTP 402 เนื่องจาก organization ปัจจุบันไม่มีสิทธิ์ Branching ใน plan ที่ใช้อยู่
- Branch created: **false**
- Production changed: **false**

ตามเอกสาร Supabase branch เป็น environment แยกและค่าเริ่มต้นไม่คัดลอก Production data แต่ฟีเจอร์ Branching ต้องใช้ plan ที่รองรับ ดู [Supabase Branching](https://supabase.com/docs/guides/deployment/branching)

## Local Full Auth Integration UAT

Production project ที่ถูกต้อง: `safety-passport-enterprise`
Test target: isolated Docker UAT baseline ของ SafetyPass พร้อม local GoTrue `v2.194.0` และ PostgREST `v14.15`

คำสั่ง: `npm run test:uat:user360-auth:local`

ผล: **PASS_LOCAL_REAL_GOTRUE_AND_POSTGREST**

- Admin PIN step-up ผ่าน GoTrue password grant จริง: PASS
- National ID correction อัปเดต Auth และ public identity: PASS
- Temporary PIN หลัง correction เข้าใช้งานผ่าน GoTrue ได้: PASS
- Injected finalize failure และ Auth compensation rollback: PASS
- Injected finalize + compensation failure สร้าง `RECOVERY_REQUIRED`: PASS
- Recovery reconcile Auth/public แล้ว finalize: PASS
- Exam history และ Active Work Permit ของ target เดิมยังอยู่: PASS
- Audit logs ไม่มีเลขบัตรเต็ม: PASS
- Test profiles, Auth users, operations และ attempts หลัง cleanup: `0`

GoTrue/PostgREST ถูกเปิดเฉพาะ `127.0.0.1` ผ่าน isolated Docker network ไม่มี endpoint ใดชี้ไป Remote Staging หรือ Production

## Local Real Browser User 360 UAT

คำสั่ง: `npm run test:uat:user360-browser:local`

ผล: **PASS_REAL_BROWSER_REAL_GOTRUE_POSTGREST**

- Admin login ผ่าน local GoTrue และโหลด User 360 จาก local PostgREST: PASS
- เพิ่ม Contractor ให้ Supplier & Outsource ผ่าน atomic RPC และคงทั้งสอง Training Programs: PASS
- ป้องกันการถอด Contractor เมื่อมี Active Work Permit: PASS
- Admin PIN step-up, Reveal 60 วินาที, Hide และ Full-ID Export: PASS
- Correct National ID เชื่อม `public.users`, fingerprint/hash และ Auth identity: PASS
- Exam history และ Work Permit ของ user เดิมไม่สูญหาย: PASS
- Audit log ไม่มีเลขบัตร 13 หลักหรืออีเมลที่ขึ้นต้นด้วยเลขบัตรเต็ม: PASS
- User 360 dialog ผ่าน automated WCAG 2 A/AA และ WCAG 2.1 A/AA scan: PASS
- Test fixtures, identity operations และ access attempts ถูก cleanup หลังทดสอบ: PASS

ข้อสังเกต: Docker UAT baseline เก่ามี encoding drift ใน body ของ `mask_national_id()` โดย bullet 6 ตัวจาก migration source ถูกเก็บเป็น `?` 18 ตัว การทดสอบจึงเทียบ UI กับผล RPC จริงและตรวจซ้ำว่าไม่มีเลข 13 หลักหลุดออกมา โดยไม่ได้แก้ schema หรือ Apply Migration ในรอบนี้ ควร rebuild baseline ด้วย UTF-8 ก่อนใช้ตรวจ visual fidelity รอบถัดไป

## Empty Staging Bootstrap Rehearsal

คำสั่ง: `npm run test:db:staging-bootstrap`

ผล: **PASS_DISPOSABLE_STAGING_BOOTSTRAP**

- สร้าง schema-only baseline ที่ `supabase/baselines/20260804180000_public_schema.sql`
- Baseline SHA-256: `8adb12193d28f994eab79b108f31e26201102d3ab2e1e067ea0ac2efa3ea0155`
- ไม่มี table rows, Auth users, national ID 13 หลัก, connection string หรือ service-role secret ใน artifact
- บันทึก migration ledger เดิม 28 versions ถึง `20260804180000`
- Apply forward migrations หลัง boundary 7 ไฟล์ตามลำดับ ถึง `20260818143000`
- SQL regressions สำหรับ PIN reset, staged registration, role management, Training Program guards, User 360 และ privileged identity ผ่านทั้งหมด
- `ADMIN_USER360_ENABLED` คงเป็น `false`
- ฐาน disposable ถูกลบหลังทดสอบ และไม่มี remote project ถูกเปลี่ยนแปลง

Supabase organization และ region ถูกตรวจแบบ read-only แล้ว โดย Production `safety-passport-enterprise` อยู่ที่ `ap-southeast-1` ขณะนี้ organization มี 2 projects และยังไม่มี SafetyPass Staging project ที่ถูกต้อง การสร้าง project ที่สามอาจมีผลต่อ quota/billing จึงต้องได้รับอนุมัติ resource แยกก่อนดำเนินการ

## เหตุผลที่หยุดก่อน Apply

Migration ใน repository เป็น incremental chain ที่ตั้งอยู่บน baseline schema เดิม โดยไฟล์ต้นชุดไม่ได้สร้าง `public.users` ขึ้นใหม่ การ apply เฉพาะ Phase 0/1 ลง Staging ปัจจุบันจะขาด dependency และอาจทิ้ง schema ที่ไม่สมบูรณ์ จึงห้ามใช้ `supabase db push` กับ target นี้จนกว่าจะยืนยัน baseline

## ทางเลือกเพื่อเดินหน้าต่อ

1. Upgrade plan และสร้าง Supabase branch แบบไม่มี Production data จาก SafetyPass Production schema
2. จัดหา Supabase project แยกสำหรับ SafetyPass Staging แล้ว bootstrap ด้วย baseline migration/seed ที่ไม่ใช้ข้อมูล Production
3. ใช้ isolated Docker UAT ต่อสำหรับ database integration และ local GoTrue stack สำหรับ Auth saga จนกว่าจะมี remote Staging — **ดำเนินการแล้วและผ่าน**

ห้าม bootstrap ทับ Staging ref ปัจจุบัน เพราะตรวจยืนยันแล้วว่าเป็นฐานของระบบอื่นและมี Auth users ที่ไม่ได้เชื่อมกับ SafetyPass

## Gate ก่อนทดสอบ Auth Saga

- `npm run check:staging:user360` ต้องเป็น `GO_FOR_CONTROLLED_STAGING_APPLY`
- `SUPABASE_STAGING_SERVICE_ROLE_KEY` ต้องเป็นของ Staging เท่านั้น
- `AUTH_PIN_STAGING_PEPPER` ต้องมีอย่างน้อย 32 ตัวอักษรและไม่ใช้ค่าของ Production
- Feature flag ต้องคงเป็น `false` ระหว่าง migration และ smoke tests
- ต้องมี Staging backup/restore point ก่อน controlled migration apply
- หลัง apply ต้องรัน SQL regressions, Auth correction success, compensation rollback และ recovery-required scenarios ก่อนเปิด flag

## สถานะ Production ณ ก่อน Rollout

Fresh encrypted logical backup และ isolated restore ถูกตรวจแล้วตาม `docs/phase1-user360-production-backup-evidence.json`:

- linked project: `safety-passport-enterprise` (`qdodmxrecioltwdryhec`)
- Windows EFS และ SHA-256 ของ roles/schema/full-schema/data dump: PASS
- Auth/Storage/Public restore: PASS
- Production/restore parity 41 tables: PASS โดยมี expected managed exclusion เฉพาะ `auth.schema_migrations`
- User 360 migration rehearsal บน restored Production copy: PASS
- Protected users/exam/work permit/digital pass counts และ digests: unchanged
- Production `db push --dry-run`: pending เฉพาะ 3 User 360 migrations, seeds `0`, roles `0`
- `ADMIN_USER360_ENABLED` หลัง rehearsal: `false`

Production changed: **false**
Deployment triggered: **false**
Production migration applied: **false**

## Production Rollout Result

- Apply migrations `20260818103000`, `20260818120000`, `20260818143000`: PASS
- Production SQL regressions ทั้ง 3 ชุด: PASS และ rollback fixtures ครบ
- Vercel production build functions: `12/12`
- Deployment: `dpl_GvfzHcgNrf6SceoTyup1m1JYaDdw` — READY
- Production alias: `https://safetypass-enterprise.vercel.app`
- Audited `ADMIN_USER360_ENABLED=true`: PASS
- Authenticated masked User 360 RPC: PASS
- Anonymous browser/API smoke: PASS
- Protected Identity endpoint without authentication: `401`
- Users, exam history, Work Permits, Digital Passes และ Training access หลัง rollout: ไม่ลดลงและไม่มี orphan links
- Audit log ที่มีเลขบัตรเต็ม: `0`

Production changed by approved rollout: **true**
Deployment triggered by approved rollout: **true**
Production migration applied by approved rollout: **true**
