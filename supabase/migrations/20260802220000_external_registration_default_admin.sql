begin;

-- Production notification recipient explicitly requested for External Registration.
-- This is configuration only; the feature flag remains unchanged.
insert into public.external_registration_notification_recipients(
  display_name, email, purpose, is_active
)
values (
  'Sattaya Admin',
  'sattaya_w@thaisummit-harness.co.th',
  'EXTERNAL_REGISTRATION_ADMIN',
  true
)
on conflict (lower(email), purpose) do update
set display_name = excluded.display_name,
    is_active = true,
    updated_at = now();

commit;
