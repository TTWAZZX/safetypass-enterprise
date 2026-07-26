-- Synthetic records used only in the disposable local Phase 1 database.
insert into public.vendors(id, name, status)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Phase 1 Test Vendor', 'APPROVED');

-- Simulate a record that still stores a raw national ID.
insert into public.users(
  id, national_id, name, vendor_id, role, pdpa_agreed, is_active, national_id_hash
) values (
  '11111111-1111-4111-8111-111111111111',
  '1000000000001',
  'Phase One User',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'USER',
  true,
  true,
  encode(extensions.digest('1000000000001', 'sha256'), 'hex')
);

-- Simulate a duplicate staged row that has no hash yet. It must be preserved.
insert into public.users(
  id, national_id, name, vendor_id, role, pdpa_agreed, is_active
) values (
  '55555555-5555-4555-8555-555555555555',
  '1000000000001',
  'Phase One Duplicate Stage',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'USER',
  false,
  true
);

-- Simulate a legacy encrypted record without duplicating the legacy key in test source.
create trigger trg_phase1_legacy_encrypt
before insert on public.users
for each row execute function public.encrypt_user_data();

insert into public.users(
  id, national_id, name, vendor_id, role, pdpa_agreed, is_active
) values (
  '22222222-2222-4222-8222-222222222222',
  '1000000000002',
  'Phase One Admin',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'ADMIN',
  true,
  true
);

drop trigger trg_phase1_legacy_encrypt on public.users;
