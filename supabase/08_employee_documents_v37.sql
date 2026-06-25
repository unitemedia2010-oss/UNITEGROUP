-- Unite HR Portal V37
-- Employee document registry: portraits, CCCD, DOCX/Google Docs and manual verification.

create extension if not exists unaccent;

create table if not exists public.hr_document_settings (
  id text primary key default 'default',
  cccd_folder_id text,
  portrait_folder_id text,
  other_folder_id text,
  extract_docx_images boolean not null default true,
  scan_recursive boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.hr_document_settings(id)
values ('default')
on conflict (id) do nothing;

create table if not exists public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete set null,
  document_type text not null default 'other' check (document_type in (
    'portrait',
    'citizen_id_front',
    'citizen_id_back',
    'citizen_id_combined',
    'employee_dossier',
    'contract',
    'certificate',
    'docx_image',
    'other'
  )),
  drive_file_id text not null,
  parent_drive_file_id text,
  drive_folder_id text,
  drive_view_url text,
  drive_thumbnail_url text,
  file_name text not null,
  normalized_file_name text,
  mime_type text,
  size_bytes bigint,
  source_folder text,
  source_kind text not null default 'mixed' check (source_kind in ('cccd','portrait','mixed','other')),
  is_extracted boolean not null default false,
  is_primary boolean not null default false,
  match_method text not null default 'unmatched' check (match_method in (
    'employee_code',
    'employee_code_and_name',
    'full_name_unique',
    'doc_text_employee_code',
    'doc_text_full_name',
    'fuzzy_suggestion',
    'manual',
    'unmatched'
  )),
  match_confidence numeric(5,2) not null default 0 check (match_confidence >= 0 and match_confidence <= 100),
  verification_status text not null default 'unmatched' check (verification_status in ('verified','pending','unmatched','rejected')),
  candidate_employee_ids uuid[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  matched_by uuid references public.profiles(id) on delete set null,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  last_scanned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists employee_documents_drive_file_uidx
  on public.employee_documents(drive_file_id);
create index if not exists employee_documents_employee_idx
  on public.employee_documents(employee_id, document_type, verification_status);
create index if not exists employee_documents_status_idx
  on public.employee_documents(verification_status, document_type, last_scanned_at desc);
create index if not exists employee_documents_parent_idx
  on public.employee_documents(parent_drive_file_id)
  where parent_drive_file_id is not null;

-- One primary portrait per employee.
create unique index if not exists employee_documents_primary_portrait_uidx
  on public.employee_documents(employee_id)
  where employee_id is not null and document_type = 'portrait' and is_primary = true and verification_status = 'verified';

create or replace function public.touch_employee_document_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists employee_documents_touch_updated_at on public.employee_documents;
create trigger employee_documents_touch_updated_at
before update on public.employee_documents
for each row execute function public.touch_employee_document_updated_at();

create or replace function public.set_primary_employee_portrait(p_document_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
begin
  if not public.has_hr_global_access() then
    raise exception 'Không có quyền đặt ảnh đại diện';
  end if;

  select employee_id into v_employee_id
  from public.employee_documents
  where id = p_document_id
    and document_type = 'portrait'
    and verification_status = 'verified';

  if v_employee_id is null then
    raise exception 'Ảnh chưa được xác minh hoặc chưa liên kết nhân sự';
  end if;

  update public.employee_documents
  set is_primary = false
  where employee_id = v_employee_id and document_type = 'portrait';

  update public.employee_documents
  set is_primary = true, verified_by = auth.uid(), verified_at = coalesce(verified_at, now())
  where id = p_document_id;

  update public.employees e
  set photo_url = d.drive_thumbnail_url,
      updated_at = now()
  from public.employee_documents d
  where d.id = p_document_id and e.id = d.employee_id;

  return true;
end;
$$;

revoke all on function public.set_primary_employee_portrait(uuid) from public;
grant execute on function public.set_primary_employee_portrait(uuid) to authenticated;

alter table public.hr_document_settings enable row level security;
alter table public.employee_documents enable row level security;

grant select, insert, update, delete on public.hr_document_settings to authenticated;
grant select, insert, update, delete on public.employee_documents to authenticated;

-- Folder configuration and raw documents are restricted to HR/Admin/Super Admin.
drop policy if exists "HR manages document settings" on public.hr_document_settings;
create policy "HR manages document settings"
on public.hr_document_settings
for all to authenticated
using (public.has_hr_global_access())
with check (public.has_hr_global_access());

drop policy if exists "HR views employee documents" on public.employee_documents;
create policy "HR views employee documents"
on public.employee_documents
for select to authenticated
using (public.has_hr_global_access());

drop policy if exists "HR creates employee documents" on public.employee_documents;
create policy "HR creates employee documents"
on public.employee_documents
for insert to authenticated
with check (public.has_hr_global_access());

drop policy if exists "HR updates employee documents" on public.employee_documents;
create policy "HR updates employee documents"
on public.employee_documents
for update to authenticated
using (public.has_hr_global_access())
with check (public.has_hr_global_access());

drop policy if exists "HR deletes employee documents" on public.employee_documents;
create policy "HR deletes employee documents"
on public.employee_documents
for delete to authenticated
using (public.has_hr_global_access());

-- HR-friendly summary view for dashboards and audit.
create or replace view public.employee_document_summary_v37
with (security_invoker = true)
as
select
  d.id,
  d.employee_id,
  e.employee_code,
  e.full_name,
  d.document_type,
  d.file_name,
  d.mime_type,
  d.source_kind,
  d.is_extracted,
  d.is_primary,
  d.match_method,
  d.match_confidence,
  d.verification_status,
  d.drive_file_id,
  d.drive_view_url,
  d.drive_thumbnail_url,
  d.last_scanned_at,
  d.created_at,
  d.updated_at
from public.employee_documents d
left join public.employees e on e.id = d.employee_id;

grant select on public.employee_document_summary_v37 to authenticated;

comment on table public.employee_documents is 'Registry of employee-related Drive files. CCCD and other private documents are HR-only.';
comment on column public.employee_documents.candidate_employee_ids is 'Candidates proposed by matcher when automatic linking is unsafe.';
comment on column public.employee_documents.metadata is 'Drive metadata, DOCX text excerpt, extraction source, and matcher diagnostics.';
