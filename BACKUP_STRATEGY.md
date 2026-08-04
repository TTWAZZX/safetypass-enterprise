# SafetyPass Enterprise — Database Backup Strategy

## ภาพรวม
ระบบนี้ใช้ Supabase (PostgreSQL) เป็น Backend แต่ความพร้อมของ backup ขึ้นกับแผนและการตั้งค่าของ project จริง ห้ามสรุปว่ามี backup ที่กู้ได้จากเอกสารนี้เพียงอย่างเดียว ต้องตรวจหน้า Dashboard → Database → Backups และเก็บหลักฐานก่อน rollout ทุกครั้ง

---

## 1. Supabase Built-in Backups

| Plan | Backup Type | Retention |
|------|-------------|-----------|
| Free | ไม่มี daily backup retention ที่ใช้แทน manual off-site backup ได้ | ต้องทำ logical backup เอง |
| Pro | Daily automated backups | 7 วัน |
| Team | Daily automated backups | 14 วัน |
| Enterprise | Daily automated backups | สูงสุด 30 วัน |
| Pro/Team/Enterprise + PITR | Point-in-Time Recovery add-on | ตาม retention ที่ซื้อ |

อ้างอิง: [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups)

**วิธีดู/restore backup บน Supabase:**
1. ไปที่ Supabase Dashboard → Project → Settings → Database
2. คลิก **Backups** → เลือก restore point
3. กด **Restore** (ระบบจะหยุดชั่วคราวประมาณ 5-15 นาที)

---

## 2. Manual Export (ทำเองเป็นประจำ)

### วิธีที่ 1: Supabase CLI (แนะนำสำหรับ logical backup ของ Supabase)
```bash
supabase db dump --db-url "[CONNECTION_STRING]" -f roles.sql --role-only
supabase db dump --db-url "[CONNECTION_STRING]" -f schema.sql
supabase db dump --db-url "[CONNECTION_STRING]" -f data.sql --use-copy --data-only
```

อ้างอิง: [Supabase Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)

### วิธีที่ 2: Export CSV สำหรับตรวจสอบเพิ่มเติมเท่านั้น
- Dashboard → Table Editor → เลือก table → Download CSV
- ทำทีละตาราง: `users`, `exam_history`, `work_permits`, `questions`, `vendors`

CSV ไม่ใช่ full backup และใช้แทน restore point ไม่ได้ เพราะไม่ครอบคลุม Auth identities, functions, triggers, grants, RLS policies และ migration history

### ตารางที่สำคัญที่สุด (backup ก่อนเสมอ)
```
users             ← ข้อมูลพนักงานทั้งหมด (สำคัญมาก)
exam_history      ← ประวัติการสอบ
work_permits      ← ใบอนุญาตทำงาน
vendors           ← รายชื่อบริษัท
questions         ← คลังข้อสอบ
system_config     ← ค่าตั้งระบบ (เกณฑ์คะแนน)
```

---

## 3. แผน Backup ที่แนะนำ

| ความถี่ | ประเภท | วิธีการ |
|---------|--------|---------|
| ทุกวัน (auto) | Full DB | Supabase Pro automated backup |
| ทุกสัปดาห์ (manual) | CSV Export | Export ผ่าน Dashboard หรือ script |
| ก่อน deploy ใหม่ทุกครั้ง | Manual dump | `pg_dump` ดังตัวอย่างด้านบน |
| ทุกเดือน | Archive | เก็บ dump file ไว้ใน Google Drive / S3 |

---

## 4. Restore Procedure (ขั้นตอนกู้ข้อมูล)

### กรณีเร่งด่วน (ข้อมูลหาย/เสียหาย):
1. ปิดการเข้าถึงระบบชั่วคราว (ตั้ง maintenance mode ที่ Vercel)
2. ไป Supabase Dashboard → Backups
3. เลือก restore point ก่อนเหตุการณ์
4. รอ restore เสร็จ (5-15 นาที)
5. ตรวจสอบข้อมูลว่าครบ
6. เปิดระบบใหม่

### Restore จาก logical backup:
```bash
# ใช้ขั้นตอน restore ที่ตรงกับรูปแบบไฟล์จาก Supabase CLI
# และทดสอบใน isolated project/database ก่อนเสมอ
```

ห้ามทดสอบ restore ทับ production และห้ามถือว่า backup ใช้งานได้จนกว่าจะ restore สำเร็จใน isolated environment พร้อมตรวจ row counts และความสัมพันธ์ของข้อมูลสำคัญ

---

## 5. Row Level Security (RLS) — ป้องกันข้อมูลรั่วไหล

ตรวจสอบให้แน่ใจว่าเปิด RLS บนทุกตาราง:
```sql
-- ตรวจสอบสถานะ RLS
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public';

-- เปิด RLS (ถ้ายังไม่ได้เปิด)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_permits ENABLE ROW LEVEL SECURITY;
```

---

## 6. สิ่งที่ต้องระวัง

- **อย่า hardcode connection string** ไว้ใน source code
- **เก็บ SUPABASE_SERVICE_ROLE_KEY** ไว้ใน Vercel Environment Variables เท่านั้น
- **ทดสอบ restore** ก่อน authentication rollout นี้ และอย่างน้อยปีละ 1 ครั้งหลังจากนั้น
- **Monitor Supabase dashboard** สำหรับ disk usage และ connection limits

---

*อัปเดตล่าสุด: 2026-08-04*
