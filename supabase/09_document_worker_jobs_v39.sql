-- Unite HR Portal V39
-- Queue-based employee document scanning for a Python worker running on the Media PC.

alter table public.hr_document_settings
  add column if not exists extracted_folder_id text;

create table if not exists public.document_scan_jobs (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid references public.profiles(id) on delete set null,
  trigger_type text not null default 'manual' check (trigger_type in ('manual','scheduled','startup','retry')),
  source_kind text not null default 'all' check (source_kind in ('all','cccd','portrait','other')),
  status text not null default 'pending' check (status in ('pending','processing','completed','failed','cancelled')),
  force_rescan boolean not null default false,
  options jsonb not null default '{}'::jsonb,
  total_files integer not null default 0,
  processed_files integer not null default 0,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  verified_count integer not null default 0,
  pending_count integer not null default 0,
  unmatched_count integer not null default 0,
  error_count integer not null default 0,
  current_file text,
  progress_message text,
  error_message text,
  worker_id text,
  heartbeat_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists document_scan_jobs_status_created_idx
  on public.document_scan_jobs(status, created_at);
create index if not exists document_scan_jobs_requested_by_idx
  on public.document_scan_jobs(requested_by, created_at desc);

create table if not exists public.document_worker_status (
  worker_id text primary key,
  host_name text,
  worker_version text,
  status text not null default 'offline' check (status in ('online','idle','processing','error','offline')),
  current_job_id uuid references public.document_scan_jobs(id) on delete set null,
  last_seen_at timestamptz not null default now(),
  last_scan_at timestamptz,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_document_worker_row()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists document_scan_jobs_touch on public.document_scan_jobs;
create trigger document_scan_jobs_touch
before update on public.document_scan_jobs
for each row execute function public.touch_document_worker_row();

drop trigger if exists document_worker_status_touch on public.document_worker_status;
create trigger document_worker_status_touch
before update on public.document_worker_status
for each row execute function public.touch_document_worker_row();

create or replace function public.request_employee_document_scan(
  p_source_kind text default 'all',
  p_force_rescan boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_job uuid;
begin
  if not public.has_hr_global_access() then
    raise exception 'Không có quyền yêu cầu quét hồ sơ';
  end if;

  if p_source_kind not in ('all','cccd','portrait','other') then
    raise exception 'Nguồn quét không hợp lệ';
  end if;

  select id into v_existing
  from public.document_scan_jobs
  where status in ('pending','processing')
    and source_kind = p_source_kind
  order by created_at desc
  limit 1;

  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.document_scan_jobs(
    requested_by, trigger_type, source_kind, force_rescan, status, progress_message
  ) values (
    auth.uid(), 'manual', p_source_kind, coalesce(p_force_rescan,false), 'pending',
    'Đã xếp hàng. Đang chờ máy Media xử lý.'
  ) returning id into v_job;

  return v_job;
end;
$$;

create or replace function public.cancel_employee_document_scan(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_hr_global_access() then
    raise exception 'Không có quyền hủy yêu cầu quét';
  end if;

  update public.document_scan_jobs
  set status = 'cancelled',
      progress_message = 'Đã hủy theo yêu cầu HR.',
      finished_at = now()
  where id = p_job_id
    and status = 'pending';

  return found;
end;
$$;

revoke all on function public.request_employee_document_scan(text, boolean) from public;
revoke all on function public.cancel_employee_document_scan(uuid) from public;
grant execute on function public.request_employee_document_scan(text, boolean) to authenticated;
grant execute on function public.cancel_employee_document_scan(uuid) to authenticated;

alter table public.document_scan_jobs enable row level security;
alter table public.document_worker_status enable row level security;

grant select on public.document_scan_jobs to authenticated;
grant select on public.document_worker_status to authenticated;

-- HR/Admin can monitor all scan jobs. Inserts are performed through the RPC above.
drop policy if exists "HR views document scan jobs" on public.document_scan_jobs;
create policy "HR views document scan jobs"
on public.document_scan_jobs
for select to authenticated
using (public.has_hr_global_access());

drop policy if exists "HR views document worker status" on public.document_worker_status;
create policy "HR views document worker status"
on public.document_worker_status
for select to authenticated
using (public.has_hr_global_access());

comment on table public.document_scan_jobs is 'Queue consumed by the Media PC Python worker. No image binary is stored in Supabase.';
comment on table public.document_worker_status is 'Heartbeat and current state of the Media PC document worker.';
