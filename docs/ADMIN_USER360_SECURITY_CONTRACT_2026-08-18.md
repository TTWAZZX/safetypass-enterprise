# Admin User 360 — Security, Identity and Audit Contract

วันที่อนุมัติเป็น baseline: 18 สิงหาคม 2026
ขอบเขต: Contract สำหรับ Phase 1; ยังไม่อนุญาตให้ Deploy หรือ Apply Migration

## 1. Training Program Policy

1. Active User ต้องมีอย่างน้อยหนึ่งโปรแกรมเสมอ.
2. โปรแกรมที่รองรับคือ `CONTRACTOR` และ `SUPPLIER_OUTSOURCE`; ผู้ใช้มีทั้งสองโปรแกรมพร้อมกันได้.
3. การเปลี่ยนจากโปรแกรมหนึ่งไปอีกโปรแกรมหนึ่งต้องเพิ่มโปรแกรมใหม่ก่อนถอดโปรแกรมเดิม และทำใน transaction เดียวเมื่อ Admin User 360 mutation ถูกสร้างใน Phase 1.
4. ห้ามถอด `CONTRACTOR` ขณะที่มี Work Permit ซึ่ง `status = ACTIVE` และ `expire_date > now()`.
5. หากต้องถอด Contractor แอดมินต้อง revoke/expire Work Permit ผ่านคำสั่งเฉพาะพร้อมเหตุผลก่อน.
6. การถอด Contractor ไม่ลบ Induction, Exam หรือ Work Permit history และไม่เขียนทับ `induction_expiry`.
7. การถอด Supplier ต้อง revoke active Supplier pass แต่ไม่ลบ pass หรือ exam history.
8. การเปลี่ยน participant type, work type หรือ access window ของ Supplier ถือว่า entitlement เปลี่ยน ต้อง revoke pass เดิมและสอบใหม่ตาม policy ปัจจุบัน.
9. Inactive User อาจไม่มีโปรแกรมได้เพื่อรองรับ archive/recovery แต่ต้องเพิ่มอย่างน้อยหนึ่งโปรแกรมก่อน reactivate.

## 2. National ID Authorization Matrix

| Operation | Policy |
|---|---|
| Directory/List | Active ADMIN; server ส่งเฉพาะ masked ID |
| Search by ID | Active ADMIN; ทำ server-side; response ยังคง masked |
| Reveal full ID | Active ADMIN + step-up re-auth ไม่เกิน 5 นาที + reason; เปิดครั้งละหนึ่ง user |
| Copy full ID | ใช้ reveal session เดียวกัน; UI ล้างค่าภายใน 60 วินาที |
| Standard export | Masked ID เท่านั้น |
| Full-ID export | Active ADMIN + step-up re-auth + reason + explicit confirmation; server-generated |
| Correct ID | Active ADMIN, ห้ามแก้บัญชีตนเอง, target ต้องเป็น USER, step-up re-auth + reason |

ข้อกำหนดร่วม:

- Full ID ห้ามอยู่ใน list payload, URL, client storage, analytics, console, error message หรือ audit details.
- Response ที่มี Full ID ต้องใช้ `Cache-Control: no-store` และไม่อนุญาต browser/service-worker caching.
- UI ต้อง mask กลับอัตโนมัติภายใน 60 วินาที เมื่อปิด dialog, เปลี่ยน user, sign out หรือ tab ถูกซ่อน.
- Rate limit reveal/correction ต่อ actor และบันทึกทั้ง success/failure.
- Phase 1 ต้องกำหนด step-up mechanism ที่ตรวจฝั่ง server; การยืนยันด้วย state ฝั่ง browser อย่างเดียวไม่เพียงพอ.

## 3. National ID Correction Saga

Supabase Auth และ Public PostgreSQL ไม่อยู่ใน transaction เดียวกัน จึงห้ามอ้างว่าแก้ไขแบบ distributed atomic transaction ได้ ให้ใช้ idempotent saga พร้อม compensation:

1. **Prepare**
   - ตรวจ Admin authorization, recent re-auth, target role และ reason.
   - ตรวจรูปแบบเลข 13 หลัก.
   - คำนวณ fingerprint/hash ฝั่ง trusted server/database และตรวจ unique index.
   - ล็อก target profile และสร้าง correction operation ด้วย correlation ID และสถานะ `PREPARED`.
   - Operation record เก็บ user ID, actor ID, old/new fingerprint, masked values, status และ timestamps; ห้ามเก็บ Full ID.
2. **Update Auth**
   - Service-role endpoint เปลี่ยน Auth email เป็น `<new_id>@safetypass.com`.
   - ใช้ idempotency key/correlation ID เพื่อ retry ได้โดยไม่สร้างผลซ้ำ.
3. **Finalize Public Profile**
   - Authorized RPC ล็อก profile อีกครั้ง ตรวจ operation/fingerprint แล้วอัปเดต `national_id`, `national_id_hash` และ `national_id_fingerprint` ใน transaction เดียว.
   - ปิด operation เป็น `COMPLETED` และสร้าง audit event โดยไม่บันทึกเลขเต็ม.
4. **Compensate**
   - หาก Auth update สำเร็จแต่ finalize ล้มเหลว ให้พยายามเปลี่ยน Auth email กลับทันที.
   - หาก compensation สำเร็จ ให้ operation เป็น `ROLLED_BACK`; Profile เดิมและ login เดิมต้องยังใช้ได้.
   - หาก compensation ล้มเหลว ให้ operation เป็น `RECOVERY_REQUIRED`, ระงับ correction ซ้ำ และแจ้งผู้ดูแลผ่าน private channel.
5. **Recover**
   - Recovery job เปรียบเทียบ Auth email ปัจจุบันกับ public fingerprint โดยใช้ Auth user ID/correlation ID.
   - ทำ finalize หรือ rollback แบบ idempotent; ห้ามเดาค่าจาก masked ID.

เกณฑ์สำเร็จ:

- Login ด้วย ID ใหม่สำเร็จและ ID เก่าใช้ไม่ได้.
- Auth email, public national ID และ fingerprint/hash ตรงกัน.
- Vendor, programs, exams, permits, passes และ user UUID เดิมไม่เปลี่ยน.
- Failure injection ทุก boundary ต้องจบเป็น `COMPLETED`, `ROLLED_BACK` หรือ `RECOVERY_REQUIRED`; ห้ามค้างแบบไม่ทราบสถานะ.

## 4. Audit Event Contract

Event ที่ Phase 1 ต้องรองรับ:

- `ADMIN_TRAINING_PROGRAM_ADDED`
- `ADMIN_TRAINING_PROGRAM_REMOVED`
- `ADMIN_SUPPLIER_ACCESS_CHANGED`
- `ADMIN_SUPPLIER_PASS_REVOKED`
- `ADMIN_WORK_PERMIT_REVOKED`
- `ADMIN_NATIONAL_ID_REVEAL_SUCCEEDED`
- `ADMIN_NATIONAL_ID_REVEAL_DENIED`
- `ADMIN_NATIONAL_ID_EXPORT_SUCCEEDED`
- `ADMIN_NATIONAL_ID_EXPORT_DENIED`
- `ADMIN_NATIONAL_ID_CORRECTION_PREPARED`
- `ADMIN_NATIONAL_ID_CORRECTION_COMPLETED`
- `ADMIN_NATIONAL_ID_CORRECTION_ROLLED_BACK`
- `ADMIN_NATIONAL_ID_CORRECTION_RECOVERY_REQUIRED`

Audit payload อนุญาตเฉพาะ:

- event/action
- actor user ID และ admin email
- target user ID
- correlation ID
- reason code และ reason text ที่ผ่านการจำกัดความยาว
- changed field names/program code
- outcome/error code ที่ sanitize แล้ว
- timestamp และ request metadata ที่ไม่ใช่ credential

ห้ามเก็บ:

- เลขบัตรเต็ม ค่าเดิมหรือค่าใหม่
- PIN/password/token/session
- Auth authorization header
- export file contents
- raw exception ที่อาจมี PII

Retention baseline: เก็บ audit อย่างน้อย 365 วัน และห้ามลบอัตโนมัติจนกว่าองค์กรจะอนุมัติ retention schedule และ legal/PDPA review. การ purge ในอนาคตต้องเป็น privileged scheduled job พร้อม audit ของการ purge.

## 5. Backward Compatibility Contract

- RPC signature เดิมต้องยังเรียกได้ใน rollout window.
- Generic Supplier mutation ต้อง route ไป authoritative Supplier RPC เพื่อรักษา pass lifecycle.
- Schema ใหม่ต้อง additive และ UI ใหม่ต้องปิดได้ด้วย feature flag.
- Exam, Permit และ Pass history ห้ามถูก delete/rewrite จาก program mutation.
- User UUID ต้องไม่เปลี่ยนเมื่อแก้ Profile หรือ National ID.
- UI ที่พบ zero programs ต้องแสดง `NO_PROGRAM`; ห้าม fallback เป็น Contractor.

## 6. Phase 1 Required Tests

- Authorization และ non-admin denial สำหรับทุก privileged operation.
- Last-program invariant ทั้ง RPC และ deferred database trigger.
- Active Work Permit blocks Contractor removal; expired/revoked permit does not block.
- Supplier mutation ผ่าน generic RPC ยังคง revoke pass เมื่อ entitlement เปลี่ยน.
- Masked list payload ไม่มี Full ID.
- Reveal success/denial, no-store, expiry, rate limit และ audit redaction.
- Correction happy path และ failure injection หลัง Prepare, Auth update และ Finalize.
- Recovery job idempotency และ preservation ของ UUID/history.
- Legacy UI/API compatibility ระหว่าง feature flag ปิด.
