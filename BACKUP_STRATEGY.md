# SafetyPass Enterprise — Database Backup Strategy

## ภาพรวม
ระบบนี้ใช้ Supabase (PostgreSQL) เป็น Backend ซึ่งมี built-in backup mechanisms ระดับ enterprise

---

## 1. Supabase Built-in Backups (ทำอัตโนมัติ ไม่ต้องตั้งค่าเอง)

| Plan | Backup Type | Retention |
|------|-------------|-----------|
| Free | Point-in-Time Recovery (PITR) | ไม่รวม |
| Pro | Daily automated backups | 7 วัน |
| Pro + PITR add-on | Continuous WAL archiving | 7–30 วัน |

**วิธีดู/restore backup บน Supabase:**
1. ไปที่ Supabase Dashboard → Project → Settings → Database
2. คลิก **Backups** → เลือก restore point
3. กด **Restore** (ระบบจะหยุดชั่วคราวประมาณ 5-15 นาที)

---

## 2. Manual Export (ทำเองเป็นประจำ)

### วิธีที่ 1: pg_dump ผ่าน Supabase connection string
```bash
pg_dump \
  "postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres" \
  --no-owner \
  --no-acl \
  -Fc \
  -f backup_$(date +%Y%m%d_%H%M%S).dump
```

### วิธีที่ 2: Export ผ่าน Supabase Dashboard
- Dashboard → Table Editor → เลือก table → Download CSV
- ทำทีละตาราง: `users`, `exam_history`, `work_permits`, `questions`, `vendors`

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

### Restore จาก pg_dump file:
```bash
pg_restore \
  -d "postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres" \
  --no-owner \
  --no-acl \
  backup_YYYYMMDD_HHMMSS.dump
```

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
- **ทดสอบ restore** อย่างน้อยปีละ 1 ครั้ง เพื่อให้มั่นใจว่า backup ใช้งานได้จริง
- **Monitor Supabase dashboard** สำหรับ disk usage และ connection limits

---

*อัปเดตล่าสุด: 2026*
