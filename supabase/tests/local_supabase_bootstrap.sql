create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists vault;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault with schema vault;

alter database phase1test set search_path = '"$user"', public, extensions;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

alter table auth.users add column if not exists instance_id uuid;
alter table auth.users add column if not exists aud text;
alter table auth.users add column if not exists role text;
alter table auth.users add column if not exists email text;
alter table auth.users add column if not exists encrypted_password text;
alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists raw_app_meta_data jsonb;
alter table auth.users add column if not exists raw_user_meta_data jsonb;
alter table auth.users add column if not exists created_at timestamptz;
alter table auth.users add column if not exists updated_at timestamptz;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
