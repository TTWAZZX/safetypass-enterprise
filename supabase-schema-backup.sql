


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."check_user_exists"("search_id" "text") RETURNS TABLE("name" "text", "age" integer, "nationality" "text", "vendor_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY 
  SELECT u.name, u.age, u.nationality, u.vendor_id
  FROM public.users u
  WHERE u.national_id_hash = encode(digest(search_id, 'sha256'), 'hex');
END;
$$;


ALTER FUNCTION "public"."check_user_exists"("search_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."encrypt_user_data"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  secret_key text := 'YOUR_SUPER_SECRET_KEY'; 
BEGIN
  -- ถ้ามีการส่ง national_id มาใหม่ (ไม่ใช่ค่าว่าง และไม่ใช่ค่าเดิม)
  IF NEW.national_id IS NOT NULL AND NEW.national_id <> 'PROTECTED' THEN
    -- 1. เข้ารหัสเก็บลงช่อง Cipher (ใช้ PGP Symmetric Key)
    NEW.national_id_cipher := pgp_sym_encrypt(NEW.national_id, secret_key);
    
    -- 2. สร้าง Hash เก็บไว้ค้นหา (SHA256)
    NEW.national_id_hash := encode(digest(NEW.national_id, 'sha256'), 'hex');
    
    -- 3. ลบข้อมูลจริงทิ้ง! เปลี่ยนเป็นคำว่า PROTECTED
    NEW.national_id := 'PROTECTED';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."encrypt_user_data"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_decrypted_id"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- ถอดรหัสเฉพาะแถวที่เป็นของตัวเอง (auth.uid())
  RETURN pgp_sym_decrypt(
    (SELECT national_id_cipher::bytea FROM public.users WHERE id = auth.uid()), 
    'YOUR_SUPER_SECRET_KEY' -- ⚠️ ต้องตรงกับข้างบน
  );
END;
$$;


ALTER FUNCTION "public"."get_my_decrypted_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.users 
    WHERE id = auth.uid() 
    AND role = 'ADMIN'
  );
END;
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_exam_attempt"("exam_type_param" "text", "answers" "jsonb", "permit_no_param" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  q_record RECORD;
  current_score INT := 0;
  total_questions INT := 0;
  passing_score INT;
  is_passed BOOLEAN;
  user_uuid UUID;
BEGIN
  -- ดึง User ID จาก Session
  user_uuid := auth.uid();
  IF user_uuid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- 1. ตรวจคำตอบ
  FOR q_record IN SELECT id, correct_choice_index FROM questions WHERE type = exam_type_param AND is_active = true
  LOOP
    total_questions := total_questions + 1;
    IF (answers->>q_record.id::text)::int = q_record.correct_choice_index THEN
      current_score := current_score + 1;
    END IF;
  END LOOP;

  -- 2. ดึงเกณฑ์คะแนน
  SELECT value::int INTO passing_score FROM system_config 
  WHERE key = lower(exam_type_param) || '_passing_score';

  IF passing_score IS NULL THEN passing_score := 7; END IF;
  is_passed := current_score >= passing_score;

  -- 3. บันทึก Log
  INSERT INTO exam_logs (user_id, exam_type, score, passed)
  VALUES (user_uuid, exam_type_param, current_score, is_passed);

  -- 4. อัปเดต Status ในตาราง users
  IF is_passed THEN
    IF exam_type_param = 'INDUCTION' THEN
      UPDATE public.users 
      SET induction_expiry = now() + interval '1 year' 
      WHERE id = user_uuid;
    ELSIF exam_type_param = 'WORK_PERMIT' THEN
      INSERT INTO work_permits (user_id, permit_no, expire_date)
      VALUES (user_uuid, permit_no_param, now() + interval '5 days');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'score', current_score,
    'passed', is_passed,
    'total', total_questions
  );
END;
$$;


ALTER FUNCTION "public"."submit_exam_attempt"("exam_type_param" "text", "answers" "jsonb", "permit_no_param" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admin_email" "text",
    "action" "text",
    "target" "text",
    "details" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exam_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "exam_type" "text" NOT NULL,
    "score" integer NOT NULL,
    "total_questions" integer NOT NULL,
    "status" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."exam_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exam_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "exam_type" "text" NOT NULL,
    "score" integer NOT NULL,
    "passed" boolean NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "note" "text"
);


ALTER TABLE "public"."exam_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."questions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "content_th" "text" NOT NULL,
    "content_en" "text" NOT NULL,
    "choices_json" "jsonb" NOT NULL,
    "correct_choice_index" integer NOT NULL,
    "type" "text" DEFAULT 'MULTIPLE_CHOICE'::"text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "image_url" "text",
    "pattern" "text" DEFAULT 'MULTIPLE_CHOICE'::"text",
    CONSTRAINT "check_question_pattern" CHECK (("pattern" = ANY (ARRAY['MULTIPLE_CHOICE'::"text", 'TRUE_FALSE'::"text", 'MATCHING'::"text", 'SHORT_ANSWER'::"text"])))
);


ALTER TABLE "public"."questions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_config" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL
);


ALTER TABLE "public"."system_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "national_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "vendor_id" "uuid",
    "role" "text" DEFAULT 'USER'::"text",
    "induction_expiry" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "age" integer DEFAULT 0,
    "nationality" "text" DEFAULT 'ไทย (Thai)'::"text",
    "pdpa_agreed" boolean DEFAULT false,
    "pdpa_agreed_at" timestamp with time zone,
    "national_id_cipher" "text",
    "national_id_hash" "text",
    "is_active" boolean DEFAULT true,
    "date_of_birth" "date",
    "avatar_url" "text",
    "last_login" timestamp with time zone,
    CONSTRAINT "users_role_check" CHECK (("role" = ANY (ARRAY['ADMIN'::"text", 'USER'::"text"])))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "status" "text" DEFAULT 'PENDING'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "remark" "text",
    CONSTRAINT "check_vendor_status" CHECK (("status" = ANY (ARRAY['PENDING'::"text", 'APPROVED'::"text", 'REJECTED'::"text"]))),
    CONSTRAINT "vendors_status_check" CHECK (("status" = ANY (ARRAY['PENDING'::"text", 'APPROVED'::"text", 'REJECTED'::"text"])))
);


ALTER TABLE "public"."vendors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."work_permits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "permit_no" "text" NOT NULL,
    "expire_date" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "status" "text" DEFAULT 'ACTIVE'::"text"
);


ALTER TABLE "public"."work_permits" OWNER TO "postgres";


ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exam_history"
    ADD CONSTRAINT "exam_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exam_logs"
    ADD CONSTRAINT "exam_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."questions"
    ADD CONSTRAINT "questions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_config"
    ADD CONSTRAINT "system_config_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_national_id_hash_key" UNIQUE ("national_id_hash");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_national_id_hash_unique" UNIQUE ("national_id_hash");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."work_permits"
    ADD CONSTRAINT "work_permits_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "idx_users_national_id_hash" ON "public"."users" USING "btree" ("national_id_hash");



ALTER TABLE ONLY "public"."exam_history"
    ADD CONSTRAINT "exam_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exam_logs"
    ADD CONSTRAINT "exam_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id");



ALTER TABLE ONLY "public"."work_permits"
    ADD CONSTRAINT "work_permits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



CREATE POLICY "Active questions are viewable" ON "public"."questions" FOR SELECT USING (("is_active" = true));



CREATE POLICY "Admin Full Access Exam" ON "public"."exam_history" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Admin Full Access Permits" ON "public"."work_permits" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Admin Full Access Users" ON "public"."users" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Admin Full Access Vendors" ON "public"."vendors" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Admins can insert logs" ON "public"."audit_logs" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Admins can manage questions" ON "public"."questions" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'ADMIN'::"text")))));



CREATE POLICY "Admins can view all exam history" ON "public"."exam_history" FOR SELECT TO "authenticated" USING ((( SELECT "users"."role"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = 'ADMIN'::"text"));



CREATE POLICY "Admins can view logs" ON "public"."audit_logs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Admins see all logs" ON "public"."exam_logs" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'ADMIN'::"text")))));



CREATE POLICY "Allow All for Admins" ON "public"."vendors" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for authenticated" ON "public"."system_config" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Authenticated users can add vendors" ON "public"."vendors" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can view questions" ON "public"."questions" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Config Full Access" ON "public"."system_config" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Enable all for admins on users" ON "public"."users" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Enable all for admins on vendors" ON "public"."vendors" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Enable insert for authenticated users" ON "public"."exam_history" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Enable insert for authenticated users only" ON "public"."users" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Enable insert for authenticated users only" ON "public"."work_permits" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Enable insert for everyone" ON "public"."vendors" FOR INSERT WITH CHECK (true);



CREATE POLICY "Enable insert for exam_history" ON "public"."exam_history" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Enable insert for exam_logs" ON "public"."exam_logs" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Enable read access for all users" ON "public"."work_permits" FOR SELECT USING (true);



CREATE POLICY "Enable read for exam_history" ON "public"."exam_history" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Everyone can view approved vendors" ON "public"."vendors" FOR SELECT USING (true);



CREATE POLICY "Everyone can view config" ON "public"."system_config" FOR SELECT USING (true);



CREATE POLICY "Only Admin can delete users" ON "public"."users" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "Only Admin can delete vendors" ON "public"."vendors" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "Only Admin can manage questions" ON "public"."questions" USING ("public"."is_admin"());



CREATE POLICY "Only Admin can update config" ON "public"."system_config" FOR UPDATE USING ("public"."is_admin"());



CREATE POLICY "Only Admin can update vendors" ON "public"."vendors" FOR UPDATE USING ("public"."is_admin"());



CREATE POLICY "Public profiles are viewable by everyone" ON "public"."users" FOR SELECT USING (true);



CREATE POLICY "Users can insert own profile" ON "public"."users" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can update own profile" ON "public"."users" FOR UPDATE USING ((("auth"."uid"() = "id") OR "public"."is_admin"()));



CREATE POLICY "Users can view own exam history" ON "public"."exam_history" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own history" ON "public"."exam_history" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own profile" ON "public"."users" FOR SELECT USING ((("auth"."uid"() = "id") OR "public"."is_admin"()));



CREATE POLICY "Users insert own history" ON "public"."exam_history" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users insert own logs" ON "public"."exam_logs" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users insert own permits" ON "public"."work_permits" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users see own logs" ON "public"."exam_logs" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users view own history" ON "public"."exam_history" FOR SELECT USING ((("auth"."uid"() = "user_id") OR "public"."is_admin"()));



CREATE POLICY "Users view own logs" ON "public"."exam_logs" FOR SELECT USING ((("auth"."uid"() = "user_id") OR "public"."is_admin"()));



CREATE POLICY "Users view own permits" ON "public"."work_permits" FOR SELECT USING ((("auth"."uid"() = "user_id") OR "public"."is_admin"()));



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."exam_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."exam_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."questions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."system_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vendors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."work_permits" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."check_user_exists"("search_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_user_exists"("search_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_user_exists"("search_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."encrypt_user_data"() TO "anon";
GRANT ALL ON FUNCTION "public"."encrypt_user_data"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."encrypt_user_data"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_decrypted_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_decrypted_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_decrypted_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."submit_exam_attempt"("exam_type_param" "text", "answers" "jsonb", "permit_no_param" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."submit_exam_attempt"("exam_type_param" "text", "answers" "jsonb", "permit_no_param" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_exam_attempt"("exam_type_param" "text", "answers" "jsonb", "permit_no_param" "text") TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."exam_history" TO "anon";
GRANT ALL ON TABLE "public"."exam_history" TO "authenticated";
GRANT ALL ON TABLE "public"."exam_history" TO "service_role";



GRANT ALL ON TABLE "public"."exam_logs" TO "anon";
GRANT ALL ON TABLE "public"."exam_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."exam_logs" TO "service_role";



GRANT ALL ON TABLE "public"."questions" TO "anon";
GRANT ALL ON TABLE "public"."questions" TO "authenticated";
GRANT ALL ON TABLE "public"."questions" TO "service_role";



GRANT ALL ON TABLE "public"."system_config" TO "anon";
GRANT ALL ON TABLE "public"."system_config" TO "authenticated";
GRANT ALL ON TABLE "public"."system_config" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."vendors" TO "anon";
GRANT ALL ON TABLE "public"."vendors" TO "authenticated";
GRANT ALL ON TABLE "public"."vendors" TO "service_role";



GRANT ALL ON TABLE "public"."work_permits" TO "anon";
GRANT ALL ON TABLE "public"."work_permits" TO "authenticated";
GRANT ALL ON TABLE "public"."work_permits" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







