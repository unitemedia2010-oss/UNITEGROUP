begin;

-- Đồng bộ Google Sheets <-> Supabase.
alter table public.employees
  add column if not exists sync_version integer not null default 1,
  add column if not exists sheet_synced_at timestamptz,
  add column if not exists sheet_row_number integer;

create or replace function public.bump_employee_sync_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if row(new.*) is distinct from row(old.*) then
    new.sync_version := coalesce(old.sync_version, 0) + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bump_employee_sync_version on public.employees;
create trigger trg_bump_employee_sync_version
before update on public.employees
for each row execute function public.bump_employee_sync_version();

-- Chuyển file yêu cầu HR sang Google Drive nhưng vẫn giữ tương thích file cũ trên Supabase Storage.
alter table public.hr_case_attachments
  alter column storage_path drop not null;

alter table public.hr_case_attachments
  add column if not exists storage_provider text not null default 'supabase',
  add column if not exists external_file_id text,
  add column if not exists external_folder_id text,
  add column if not exists external_url text,
  add column if not exists sync_status text not null default 'ready',
  add column if not exists deleted_at timestamptz;

alter table public.hr_case_attachments
  drop constraint if exists hr_case_attachments_storage_provider_check;
alter table public.hr_case_attachments
  add constraint hr_case_attachments_storage_provider_check
  check (storage_provider in ('supabase','google_drive'));

alter table public.hr_case_attachments
  drop constraint if exists hr_case_attachments_location_check;
alter table public.hr_case_attachments
  add constraint hr_case_attachments_location_check
  check (
    (storage_provider = 'supabase' and storage_path is not null)
    or
    (storage_provider = 'google_drive' and external_file_id is not null)
  );

create index if not exists hr_case_attachments_provider_idx
  on public.hr_case_attachments(storage_provider, external_file_id);

create table if not exists public.workspace_sync_logs (
  id bigint generated always as identity primary key,
  sync_type text not null check (sync_type in ('sheet_pull','sheet_push','drive_upload','drive_delete','setup')),
  status text not null check (status in ('started','completed','partial','failed')),
  source text not null default 'google_workspace',
  requested_by uuid references public.profiles(id) on delete set null,
  total_rows integer not null default 0,
  success_rows integer not null default 0,
  failed_rows integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.workspace_sync_logs enable row level security;
grant select on public.workspace_sync_logs to authenticated;

drop policy if exists "HR views workspace sync logs" on public.workspace_sync_logs;
create policy "HR views workspace sync logs"
on public.workspace_sync_logs
for select
to authenticated
using (public.has_hr_global_access());

commit;
