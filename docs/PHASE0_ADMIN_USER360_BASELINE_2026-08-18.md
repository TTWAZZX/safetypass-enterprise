# Phase 0 — Admin User 360 and Multi-Program Baseline

วันที่ตรวจสอบ: 18 สิงหาคม 2026
สถานะ: **PASS — PHASE 0 GATES CLOSED; พร้อมเริ่ม Phase 1 แบบ Local/Feature-Flag Development แต่ยังห้ามแก้ Production**

## 1. วัตถุประสงค์และขอบเขต

Phase 0 รอบนี้ตรวจสอบความพร้อมสำหรับการขยายหน้า Admin `Edit Profile` ให้จัดการข้อมูลผู้ใช้แบบครบวงจร โดยครอบคลุม:

- ข้อมูลส่วนตัวและบริษัท/Vendor
- สิทธิ์ `CONTRACTOR` และ `SUPPLIER_OUTSOURCE` แบบหลายโปรแกรมต่อผู้ใช้หนึ่งคน
- รายละเอียด Supplier/Outsource และช่วงวันที่เข้าใช้งาน
- สถานะบัญชี บทบาท PIN และการอบรม
- การเปิดดูและการแก้ไขเลขบัตรประชาชนอย่างปลอดภัย
- การเชื่อมต่อหน้า User, Exam, Work Permit, Digital Pass, Reports และ Audit Log

งานใน Phase 0 เป็นการตรวจสอบและสร้าง baseline เท่านั้น ไม่มีการ apply migration, เปลี่ยนข้อมูล Production หรือ deploy application

## 2. Repository และ Production Schema Baseline

- Branch: `main`
- Commit: `83d50a8` (`Add secure role management and readable audit history`)
- Worktree ก่อนเริ่ม: สะอาด
- Local migrations: 32 ไฟล์
- SQL database tests: 21 ไฟล์
- Supabase linked dry-run: `upToDate: true`
- Pending migrations/seeds/roles: ไม่มี
- Production database changed by this audit: ไม่เปลี่ยน
- Deployment triggered by this audit: ไม่มี

หลักฐาน backup/restore ล่าสุดใน repository เป็นวันที่ 4 สิงหาคม 2026:

- `docs/phase4-production-rollout-backup-evidence.json`
- `docs/phase1-backup-restore-evidence.json`

หลักฐานเดิมยืนยัน encrypted backup และ isolated restore ได้ แต่ไม่ถือเป็น backup สดสำหรับ rollout งานรอบใหม่ ต้องสร้างและตรวจ checksum ใหม่ก่อน Phase ที่มีการแก้ Production

## 3. แผนผังข้อมูลปัจจุบัน

```text
Supabase Auth
  email = <national_id>@safetypass.com
          |
          v
public.users ---------------------------------------------+
  id, national_id, fingerprint/hash, profile, role,       |
  is_active, induction_expiry, line_user_id               |
          |                                                |
          +--> user_training_access                        |
          |      (user_id, program_code)                   |
          |       |- CONTRACTOR                            |
          |       `- SUPPLIER_OUTSOURCE                    |
          |             participant/work/access/pass       |
          |                                                |
          +--> exam_history / exam_logs                    |
          +--> work_permits                                |
          +--> supplier_outsource_passes                   |
          `--> audit_logs (เฉพาะ mutation บางส่วนในปัจจุบัน)
```

แหล่งข้อมูลหลัก:

| ข้อมูล | Source of truth ปัจจุบัน |
|---|---|
| Profile/สถานะบัญชี | `public.users` |
| โปรแกรมที่ผู้ใช้ได้รับ | `public.user_training_access` |
| Contractor induction | `users.induction_expiry` และ `exam_history` |
| Contractor work permit | `public.work_permits` |
| Supplier access/pass | `user_training_access` และ `supplier_outsource_passes` |
| ผลสอบ | `exam_history`/`exam_logs` |
| ตัวตนสำหรับ Login | Supabase Auth email และ `users.national_id_fingerprint` |

## 4. สิ่งที่ระบบรองรับอยู่แล้ว

1. `user_training_access` ใช้ primary key `(user_id, program_code)` และรองรับทั้ง `CONTRACTOR` กับ `SUPPLIER_OUTSOURCE` ผู้ใช้จึงมีสองโปรแกรมพร้อมกันได้โดยไม่ต้องแก้ `users.role`.
2. หน้า User เรียก `getMyTrainingPrograms()` และสร้าง readiness แยกตามโปรแกรม.
3. `admin_set_training_access` รองรับเพิ่ม/ถอดทั้งสองโปรแกรมในระดับฐานข้อมูล แต่ยังไม่มี service/UI ใช้งานและไม่มี regression test เฉพาะทาง.
4. `admin_set_supplier_outsource_access` มี validation ของ participant/work/date และ revoke Supplier pass เมื่อรายละเอียดสิทธิ์เปลี่ยนหรือถูกถอด.
5. ผลสอบ Work Permit และ Supplier ถูกแยกด้วย `exam_type`; Digital Pass และ readiness มี flow แยกแล้ว.
6. การแก้ `users` และ `vendors` โดยแอดมินมี database-side Audit Trigger ที่บันทึกเฉพาะชื่อ field ไม่คัดลอกค่าข้อมูลส่วนตัวลง log.
7. การเปลี่ยนบทบาทและ Reset PIN มี RPC/API ที่แยกจาก profile edit อยู่แล้ว.

## 5. ช่องว่างและความเสี่ยงก่อน Phase 1

### Critical — ต้องออกแบบก่อนเปิดใช้

1. **เลขบัตรผูกกับ Login หลายจุด**
   - Auth email ใช้รูปแบบ `<national_id>@safetypass.com`.
   - Registration, login, session status, PIN reset และ staged-auth อ้างอิงรูปแบบนี้.
   - การแก้เฉพาะ `users.national_id` จะทำให้ Profile, fingerprint และ Auth identity ไม่ตรงกัน และอาจทำให้ผู้ใช้ Login ไม่ได้.
   - ต้องใช้ privileged server workflow พร้อม validation, compensation/recovery และ dedicated tests; ห้ามรวมเป็น input ธรรมดาใน `admin_update_user_profile`.

2. **หน้ารายชื่อส่งเลขบัตรเต็มถึง Browser**
   - `admin_get_directory_page` คืน `u.national_id` เต็ม แล้ว `VendorManager` จึง mask ภายหลัง.
   - ต้องเปลี่ยน list RPC ให้คืน masked value เท่านั้น และสร้าง reveal endpoint แบบรายคนพร้อม re-auth/audit/short-lived UI state.

3. **การบันทึก Profile และสิทธิ์ยังไม่เป็น transaction เดียว**
   - `admin_update_user_profile`, `admin_set_training_access` และ `admin_set_supplier_outsource_access` เป็นคนละ RPC.
   - หาก UI เรียกต่อกันแล้วคำสั่งหนึ่งล้มเหลว จะเกิดข้อมูลครึ่งสำเร็จ.
   - Phase 1 ต้องมี RPC orchestration เดียว หรือกำหนด transaction boundary ที่ชัดเจน.

### High

4. **Audit ยังไม่ครอบคลุม Training Access และการ Reveal ข้อมูล**
   - Trigger ปัจจุบันครอบคลุม `users` และ `vendors` เท่านั้น.
   - การเพิ่ม/ถอดโปรแกรม การแก้ Supplier access การ revoke pass และการเปิดดูเลขบัตรเต็มยังไม่มี audit contract ที่ครบ.

5. **Generic training RPC ไม่รักษา Supplier pass lifecycle**
   - `admin_set_training_access` สามารถแก้/ลบ `SUPPLIER_OUTSOURCE` แต่ไม่มี logic revoke pass เทียบเท่า `admin_set_supplier_outsource_access`.
   - UI ใหม่ต้องไม่เรียก generic RPC กับ Supplier โดยตรง หรือ Phase 1 ต้องรวม logic ให้เหลือเส้นทาง authoritative เดียว.

6. **ผู้ใช้อาจเหลือศูนย์โปรแกรม แต่หน้า User fallback เป็น Contractor**
   - หน้า User ใช้ `programs.length > 0 ? programs : ['CONTRACTOR']`.
   - หากแอดมินถอดทุกโปรแกรม ฐานข้อมูลจะไม่มีสิทธิ์ แต่ UI จะตีความเป็น Contractor.
   - ต้องบังคับอย่างน้อยหนึ่งโปรแกรมและนำ fallback นี้ออกหรือจำกัดให้เฉพาะ legacy migration state.

7. **Profile validation ยังไม่ครบ**
   - RPC ปัจจุบันแก้ชื่อ อายุ สัญชาติ Vendor และ induction expiry เท่านั้น.
   - ยังไม่มี validation ที่ครบสำหรับชื่อว่าง ช่วงอายุ ความสัมพันธ์ `date_of_birth`/`age` และเหตุผลการ override.
   - `date_of_birth` มีในข้อมูลแต่หน้า Edit ใช้ `age` โดยตรง ทำให้สองค่าไม่สอดคล้องกันได้.

### Medium

8. หน้า Admin ยังไม่มี read model รายคนที่รวม Profile, Programs, Supplier status, Exam, Permit, Pass, Auth/PIN summary และ Audit history.
9. ผลสอบและประวัติเป็นข้อมูล integrity สูง ต้องเป็น read-only; การ “แก้” ต้องแปลงเป็นคำสั่ง revoke/reset/retest พร้อมเหตุผล.
10. รายงานและ export บางเส้นทางยังใช้เลขบัตรเต็ม จึงต้องกำหนด permission/export policy แยกจาก reveal ใน UI.
11. ยังไม่มี automated test สำหรับ Admin เปลี่ยน `SUPPLIER_OUTSOURCE -> BOTH -> CONTRACTOR` และตรวจการเชื่อมโยงทั้งหน้า User/Exam/Card/Report.

## 6. Current Admin Edit Profile Baseline

หน้า `VendorManager` ปัจจุบันแก้ได้:

- ชื่อ
- อายุ
- สัญชาติ
- Vendor
- Induction expiry override

ยังไม่รวม:

- วันเดือนปีเกิดและการคำนวณอายุ
- โปรแกรม Contractor/Supplier
- Supplier participant/work/access window
- สถานะและประวัติข้อสอบ/Permit/Pass
- การ reveal/correct เลขบัตร
- Account/PIN/LINE summary ใน dialog เดียว
- เหตุผลประกอบ high-integrity actions

## 7. Regression Baseline วันที่ 18 สิงหาคม 2026

| Check | ผลลัพธ์ |
|---|---|
| Unit tests | PASS — baseline เดิม 27 files, 144 tests |
| Production Assurance E2E | PASS — login, user, retake/resume, admin, import/export, mobile, accessibility |
| Production build | PASS |
| Text encoding | PASS |
| UX standards | PASS |
| API budget | PASS — 12/12 deployable endpoints |
| Accessibility | PASS — WCAG A/AA mobile login view |
| TypeScript `tsc --noEmit` | **FAIL (pre-existing ณ เวลา audit ครั้งแรก; ปิด Gate แล้ว)** |
| Supabase linked dry-run | PASS — remote up to date, no pending changes |

TypeScript failure ปัจจุบัน:

```text
src/__tests__/userReadiness.test.ts
readonly ["CONTRACTOR"] cannot be assigned to mutable TrainingProgram[]
```

ปัญหานี้เกิดบน commit/worktree ที่สะอาดก่อนเริ่มเปลี่ยนฟีเจอร์ จึงบันทึกเป็น baseline gap ไม่ใช่ regression จาก Phase 0 แต่ต้องแก้และทำให้ typecheck ผ่านก่อนเริ่ม implementation ของ Phase 1.

## 8. ข้อกำหนดสถาปัตยกรรมสำหรับ Phase 1

1. ใช้ forward-only additive migration; ห้ามแก้ migration ที่ apply แล้ว.
2. สร้าง admin user-detail read model แยกจาก paginated directory list.
3. Directory list คืนเลขบัตรแบบ mask จาก server; full ID ห้ามอยู่ใน list payload.
4. Reveal full ID ใช้ endpoint/RPC เฉพาะ, admin re-auth, audit event และไม่ cache.
5. National ID correction เป็น workflow แยกจาก Save Profile และต้อง sync Public Profile + Fingerprint + Supabase Auth พร้อม recovery path.
6. สร้าง authoritative admin profile/program mutation เส้นทางเดียว และบันทึกใน transaction เดียวเท่าที่อยู่ใน PostgreSQL transaction boundary.
7. บังคับอย่างน้อยหนึ่งโปรแกรมต่อผู้ใช้ที่ active.
8. รักษาประวัติ exam/permit/pass; ใช้ revoke/reset/retest แทนการแก้หรือลบประวัติ.
9. เพิ่ม audit สำหรับ training access, pass lifecycle, reveal และ correction โดยไม่บันทึกเลขบัตรเต็ม.
10. ใช้ feature flag และคง compatibility กับ UI/API รุ่นเดิมระหว่าง rollout.

## 9. Regression Matrix ที่ Phase 1 ต้องเพิ่ม

| Scenario | สิ่งที่ต้องยืนยัน |
|---|---|
| Supplier only -> Both | Supplier history/pass เดิมอยู่ครบ; Contractor Induction เปิด; Permit ยังไม่เปิดจนกว่า Induction ผ่าน |
| Contractor only -> Both | Contractor status เดิมอยู่ครบ; Supplier exam เปิด; Supplier pass ยังไม่ถูกออกก่อนสอบผ่าน |
| Both -> Supplier only | Contractor history/permit ไม่ถูกลบ; Contractor action ถูกปิดตาม policy |
| Both -> Contractor only | Supplier active pass ถูก revoke; history ยังอยู่; Supplier UI/action ถูกปิด |
| เปลี่ยน Supplier detail/date | Active Supplier pass ถูก revoke และต้องสอบใหม่ตาม policy |
| พยายามถอดทุกโปรแกรม | Server ปฏิเสธและข้อมูลไม่เปลี่ยน |
| Profile save บาง field ผิด | Transaction rollback ทั้งชุด |
| Reveal national ID | เฉพาะ admin, มี re-auth/audit, list payload ยัง masked |
| Correct national ID | duplicate rejected; Auth/Profile/Fingerprint ตรงกัน; login ด้วย ID ใหม่ได้; ID เก่าใช้ไม่ได้ |
| Legacy user | UI/API รุ่นเดิมยังอ่านและใช้งานได้ระหว่าง rollout |

## 10. Backup, Rollback และ Rollout Gate

ก่อนแตะ Production ต้อง:

1. สร้าง encrypted backup ใหม่ทั้ง roles/schema/data.
2. ตรวจ SHA-256 ทุกไฟล์และทดสอบ restore ใน isolated environment.
3. บันทึก row counts อย่างน้อย `users`, `user_training_access`, `exam_history`, `work_permits`, `supplier_outsource_passes`, `audit_logs`.
4. รัน migration dry-run และตรวจ grants/RLS.
5. Deploy แบบ application-compatible ก่อนเปิด feature flag.
6. ใช้ synthetic user ทดสอบทุก transition; ห้ามทดสอบ correction/revoke กับผู้ใช้จริง.
7. Rollback application ด้วยการปิด feature flag; schema ใหม่ต้อง additive และปลอดภัยเมื่อยังไม่ถูกใช้.

## 11. Phase 0 Exit / Phase 1 Entry Gate

ผล Phase 0 audit ครั้งแรก: **ผ่านแบบมีเงื่อนไข**

ต้องปิดเงื่อนไขต่อไปนี้ก่อนเริ่มเขียน migration/RPC ของ Phase 1:

- [x] แก้ TypeScript baseline ให้ `tsc --noEmit` ผ่าน
- [x] ยืนยัน policy ว่า Active user ต้องมีอย่างน้อยหนึ่งโปรแกรมเสมอ
- [x] ยืนยัน policy การถอด Contractor ต่อ Work Permit ที่ยัง active
- [x] ยืนยัน policy ว่าใครมีสิทธิ์ reveal/export/correct เลขบัตรเต็ม
- [x] เลือก transaction/recovery design สำหรับการแก้เลขบัตรข้าม Supabase Auth และ Public schema
- [x] กำหนด retention และรูปแบบ Audit event โดยไม่เก็บ PII เต็ม

เงื่อนไขข้างต้นปิดเมื่อวันที่ 18 สิงหาคม 2026 ตาม
`docs/ADMIN_USER360_SECURITY_CONTRACT_2026-08-18.md` และ draft forward-only migration
`20260818103000_admin_training_access_guards.sql` ซึ่งยังไม่ได้ apply กับ Production.

## 12. Gate Closure Result

- TypeScript contract ของ readiness รับ `readonly TrainingProgram[]` และ `tsc --noEmit` ผ่าน.
- หน้า User เริ่มต้นด้วยรายการโปรแกรมว่างและใช้ค่าจากฐานข้อมูลตรง ๆ; ไม่มี Contractor fallback อีกต่อไป.
- เพิ่ม unit test ยืนยัน `NO_PROGRAM`; unit suite ปัจจุบันผ่าน 145/145.
- กำหนด Active User invariant และ Contractor/Work Permit removal policy ใน security contract.
- เพิ่ม forward-only draft migration สำหรับ deferred invariant, last-program guard, active-permit guard และ authoritative Supplier routing.
- เพิ่ม SQL regression สำหรับ last-program, dual-program transition, active Work Permit และ history preservation.
- กำหนด masked/reveal/export/correct authorization, National ID correction saga, compensation/recovery และ redacted audit events แล้ว.
- Migration/SQL regression ไม่ถูก apply หรือ execute กับ Production ตามข้อกำหนดของ Phase 0.
- Linked Supabase dry-run หลังปิด Gate พบ pending เฉพาะ `20260818103000_admin_training_access_guards.sql` และยืนยันว่าไม่มี seed/role change; ไม่มีการ push.
- Migration compile/apply ผ่านบน restored isolated PostgreSQL 17.6 UAT container และ SQL regression ผ่านแบบ transaction rollback.
- Row counts ก่อนและหลัง regression ตรงกัน: users 446, training access 447, exam history 1,009, work permits 361, Supplier passes 1 และ audit logs 204; test users คงเหลือ 0.
- หลักฐาน isolated validation อยู่ที่ `docs/phase0-admin-user360-isolated-evidence.json`; baseline container แยกต่างหากไม่ได้ถูกแก้ไข.

สถานะหลังปิด Gate: **พร้อมเริ่ม Phase 1 implementation**. ก่อน Production rollout ยังต้องสร้าง encrypted backup ใหม่จาก Production, ตรวจ checksum/restore และผ่าน approval gate แยกต่างหาก.
