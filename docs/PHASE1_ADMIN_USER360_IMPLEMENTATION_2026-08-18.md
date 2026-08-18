# Phase 1 — Admin User 360 Implementation Report

วันที่ตรวจสอบ: 18 สิงหาคม 2026
สถานะ: **IMPLEMENTATION GATES PASS — LOCAL/ISOLATED UAT ONLY; PRODUCTION ROLLOUT BLOCKED**

## 1. ขอบเขตที่ดำเนินการแล้ว

- เพิ่ม Admin User 360 read model ที่รวม Profile, Vendor, Training Programs, Exam, Work Permit, Supplier Pass, PIN/Auth summary และ Audit history รายบุคคล
- เพิ่ม atomic RPC สำหรับแก้ Profile และ Training Programs ใน transaction เดียว
- เพิ่มโปรแกรมใหม่ก่อนถอดโปรแกรมเดิม เพื่อรักษา invariant ของ Active User
- ป้องกันการถอด Contractor ขณะที่ยังมี Work Permit ที่ Active
- บังคับ Supplier mutation ให้ผ่าน authoritative Supplier RPC และ revoke Digital Pass เดิมเมื่อ entitlement เปลี่ยน
- เปลี่ยน Admin directory ให้ส่งเลขบัตรแบบ masked จาก server แต่ยังค้นหาด้วยเลขเต็มแบบ server-side ได้
- เพิ่ม service-role-only identity operation ledger สำหรับ correction saga โดยไม่เก็บเลขบัตรเต็ม
- เพิ่ม Audit Events สำหรับ Program, Supplier entitlement, Supplier Pass revocation และ User 360 update
- เพิ่ม `actor_user_id` ใน Audit และ mask synthetic Auth email ที่มีเลขบัตร 13 หลัก
- ปฏิเสธ reason ที่มีเลขบัตร 13 หลัก เพื่อป้องกัน PII หลุดเข้า Audit
- เพิ่ม TypeScript contracts และ service methods สำหรับ User 360
- เชื่อม Admin Edit Profile กับ User 360 ผ่าน runtime feature flag ที่ default เป็น `false`
- เมื่อเปิด flag หน้าแก้ไขใช้ atomic RPC, แสดง Linked Records แบบ read-only และบังคับ Change Reason
- เมื่อปิด flag หน้าเดิมและ legacy profile RPC ยังทำงานเหมือนเดิม
- คง legacy RPC signatures และ flow เดิมไว้เพื่อ backward compatibility

## 2. ไฟล์ที่แก้หรือเพิ่ม

Phase 0 prerequisite ที่อยู่ใน worktree เดียวกัน:

- `src/services/userReadiness.ts`
- `src/components/UserPanel.tsx`
- `src/__tests__/userReadiness.test.ts`
- `supabase/migrations/20260818103000_admin_training_access_guards.sql`
- `supabase/tests/admin_training_access_guards_test.sql`
- `docs/PHASE0_ADMIN_USER360_BASELINE_2026-08-18.md`
- `docs/ADMIN_USER360_SECURITY_CONTRACT_2026-08-18.md`
- `docs/phase0-admin-user360-isolated-evidence.json`

Phase 1 foundation:

- `supabase/migrations/20260818120000_admin_user360_foundation.sql`
- `supabase/tests/admin_user360_foundation_test.sql`
- `src/types.ts`
- `src/services/supabaseApi.ts`
- `src/components/VendorManager.tsx`
- `src/services/auditPresentation.ts`
- `src/__tests__/auditPresentation.test.ts`
- `scripts/check-e2e.mjs`
- `docs/PHASE1_ADMIN_USER360_IMPLEMENTATION_2026-08-18.md`

Phase 1 privileged identity workflow:

- `supabase/migrations/20260818143000_admin_identity_privileged_workflow.sql`
- `supabase/tests/admin_identity_privileged_workflow_test.sql`
- `api/_adminIdentity.js`
- `api/set-auth-pin.js`
- `src/components/AdminIdentityControls.tsx`
- `src/__tests__/adminIdentityApi.test.ts`

## 3. Database regression บน isolated Docker UAT

Environment: `safetypass-phase5-dr-uat-20260805`
Production database: **ไม่ถูกเชื่อมต่อหรือแก้ไข**

ผลการตรวจ:

- Phase 1 migration compile/apply: PASS
- Phase 1 SQL regression: PASS และ transaction fixture rollback สำเร็จ
- Phase 0 training guard regression หลัง Phase 1: PASS
- Test fixture users หลัง rollback: `0`
- Audit email ที่ขึ้นต้นด้วยเลข 13 หลักหลัง migration: `0`
- Audit actor UUID column: present
- Snapshot counts หลัง regression:
  - users: `446`
  - user_training_access: `447`
  - exam_history: `1009`
  - work_permits: `361`
  - supplier_outsource_passes: `1`

SQL scenarios ที่ผ่าน:

- Full-ID search คืนเฉพาะ masked directory payload
- User 360 payload ไม่มี full national ID
- Contractor → Both สำเร็จแบบ atomic
- Supplier entitlement change revoke pass เดิมและสร้าง Audit
- Active Work Permit บล็อก Both → Supplier-only และ rollback Profile ทั้งชุด
- Expired Work Permit อนุญาตให้ถอด Contractor โดยไม่ลบ Permit history
- Active User ที่ไม่มี Program ถูกปฏิเสธ
- Non-admin อ่าน User 360 ไม่ได้
- Feature flag เริ่มต้นเป็นปิด, Admin เปิดได้และ non-admin อ่านไม่ได้
- Authenticated client อ่าน identity operation ledger ไม่ได้
- Audit ไม่เก็บเลขบัตรเต็มใน details, reason หรือ actor email

## 4. Application quality gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npm test` | PASS — 28 files / 153 tests |
| `npm run check:text` | PASS |
| `npm run build` | PASS |
| `npm run test:e2e` | PASS |
| `npm run check:api-budget` | PASS — 12/12 endpoints |
| `npm run check:ux` | PASS |
| `npm run check:bundle` | PASS |

E2E ครอบคลุม login, user flows, retake/resume, admin, import/export, mobile และ accessibility โดยใช้ mock backend; ไม่มีการเรียก Production mutation

## 5. Privileged identity implementation

- Reveal ใช้ server-side Admin PIN step-up token ที่ผูกกับ actor และหมดอายุภายใน 5 นาที; ค่าที่เปิดดูหมดอายุใน 60 วินาทีและ response เป็น `no-store`
- Full-ID Export สร้าง CSV ฝั่ง server, ต้องยืนยัน PDPA แบบ explicit ทั้ง UI/API และจำกัดสูงสุด 100 ผู้ใช้ต่อคำขอ
- Correct National ID ใช้ service-role saga: Prepare → Supabase Auth update → atomic finalize; เมื่อ finalize ล้มเหลวจะ compensate Auth และ rollback หรือระบุ `RECOVERY_REQUIRED`
- Recovery ตรวจ fingerprint ของ Auth/public state ก่อนเลือก finalize หรือ rollback และทุก attempt ถูกปิดด้วยผลสำเร็จ/ล้มเหลว
- Durable rate limit: Reveal 5 ครั้ง/5 นาที, Export 1 ครั้ง/10 นาที, Correct 3 ครั้ง/วัน และ Recover 5 ครั้ง/ชั่วโมงต่อ Admin
- Audit บันทึก actor, target, action, outcome และเหตุผล แต่ปฏิเสธ reason/metadata ที่มีเลข 13 หลักและไม่เก็บเลขบัตรเต็มใน ledger
- Automated tests ครอบคลุม step-up, reveal success/denial, export confirmation, correction success, compensation rollback, recovery-required, rate limit, RLS และการรักษา Exam/Work Permit history

UI ทั้ง User 360 และ privileged controls ยังอยู่หลัง runtime feature flag ที่ default เป็น `false`; จึงยังไม่เปิดใช้งานใน Production

## 6. ความเสี่ยงคงเหลือและ rollout requirements

- Migration มี controlled redaction สำหรับ legacy `audit_logs.admin_email` ที่เป็น `<13 digits>@...` พร้อมเติม `actor_user_id`; ก่อน Production ต้องทดสอบกับ encrypted restore ล่าสุดและตรวจ row impact
- Production migration order ต้องเป็น Phase 0 guard → Phase 1 foundation → privileged identity workflow
- ต้องสร้าง encrypted Production backup ใหม่, ตรวจ checksum และ restore ก่อนขออนุมัติ apply migration
- ต้องเปิด UI ผ่าน feature flag และมี kill switch ระหว่าง rollout
- ต้องทดสอบ Auth correction/compensation กับ staging Supabase จริง เนื่องจาก unit/E2E รอบนี้ mock Auth Admin API และ SQL UAT ไม่มี GoTrue runtime
- Step-up token เป็น stateless HMAC อายุสั้น; การ revoke ทันทีก่อนหมดอายุทำได้ด้วยการหมุน `AUTH_PIN_PEPPER` เท่านั้น
- Full-ID CSV ที่ดาวน์โหลดแล้วอยู่นอกการควบคุมของระบบ จึงต้องมี operational policy สำหรับ storage, retention และ incident handling

## 7. ข้อสรุป

Phase 1 implementation ผ่าน source, unit, TypeScript, build, browser E2E, accessibility และ isolated SQL UAT แล้ว รวม User 360, atomic program update และ privileged Reveal/Export/Correct/Recover โดยไม่ Deploy และไม่ Apply Migration ไป Production ระบบเดิมและ feature-flag-off path ยังผ่าน regression ครบ สถานะพร้อมเข้าสู่ **staging rollout validation** แต่ยังไม่พร้อม Production จนกว่าจะผ่าน backup/restore, staging Auth integration และ change approval
