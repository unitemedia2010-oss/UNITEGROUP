-- UNITE WORK SCHEDULE V23 - consolidated database setup
-- Run once in Supabase SQL Editor. It is written to be safe on an existing project.

begin;

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  employee_code text unique not null,
  full_name text not null,
  email text unique not null,
  phone text,
  role_type text not null check (role_type in ('TTS', 'NVPT', 'LEADER', 'ADMIN', 'SUPER_ADMIN')),
  area text,
  team text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  min_days_per_month integer not null default 12 check (min_days_per_month between 0 and 31),
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists area text;
alter table public.profiles add column if not exists status text not null default 'active';
alter table public.profiles add column if not exists min_days_per_month integer not null default 12;
alter table public.profiles add column if not exists created_at timestamptz not null default now();

create table if not exists public.schedule_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  shift text not null check (shift in ('morning', 'afternoon', 'full_day')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  note text,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz
);

create table if not exists public.unavailability (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  unavailable_date date not null,
  shift text not null check (shift in ('morning', 'afternoon', 'full_day')),
  reason_type text not null check (reason_type in ('school', 'personal', 'family', 'exam', 'other')),
  note text,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  schedule_request_id uuid references public.schedule_requests(id) on delete set null,
  leave_date date not null,
  shift text not null check (shift in ('morning', 'afternoon', 'full_day')),
  leave_type text not null check (leave_type in ('sick', 'personal', 'school', 'family', 'exam', 'other')),
  leave_period text not null default 'full_shift' check (leave_period in ('full_shift', 'first_half', 'last_half', 'custom')),
  leave_start_time time,
  leave_end_time time,
  reason_note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  is_late_notice boolean not null default false,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz
);

alter table public.leave_requests add column if not exists leave_period text not null default 'full_shift';
alter table public.leave_requests add column if not exists leave_start_time time;
alter table public.leave_requests add column if not exists leave_end_time time;

alter table public.leave_requests drop constraint if exists leave_requests_leave_period_check;
alter table public.leave_requests add constraint leave_requests_leave_period_check
  check (leave_period in ('full_shift', 'first_half', 'last_half', 'custom'));
alter table public.leave_requests drop constraint if exists leave_requests_time_range_check;
alter table public.leave_requests add constraint leave_requests_time_range_check
  check (
    (leave_period = 'full_shift' and leave_start_time is null and leave_end_time is null)
    or
    (leave_period in ('first_half', 'last_half', 'custom')
      and leave_start_time is not null
      and leave_end_time is not null
      and leave_start_time < leave_end_time)
  );

create table if not exists public.schedule_settings (
  id uuid primary key default gen_random_uuid(),
  work_date date not null,
  shift text not null check (shift in ('morning', 'afternoon', 'full_day')),
  min_staff integer not null default 2,
  max_staff integer not null default 8,
  note text,
  created_at timestamptz not null default now(),
  unique(work_date, shift)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  message text not null,
  type text not null default 'info' check (type in ('info', 'ok', 'warn', 'err')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

-- Normalize accidental duplicate open records before adding partial unique indexes.
with ranked as (
  select id,
    row_number() over (
      partition by employee_id, work_date
      order by case when status = 'approved' then 0 else 1 end, submitted_at desc, id
    ) as rn
  from public.schedule_requests
  where status in ('pending', 'approved')
)
update public.schedule_requests
set status = 'cancelled'
where id in (select id from ranked where rn > 1);

with ranked as (
  select id,
    row_number() over (
      partition by employee_id, unavailable_date
      order by created_at desc, id
    ) as rn
  from public.unavailability
  where status = 'active'
)
update public.unavailability
set status = 'cancelled'
where id in (select id from ranked where rn > 1);

with ranked as (
  select id,
    row_number() over (
      partition by schedule_request_id
      order by case when status = 'approved' then 0 else 1 end, submitted_at desc, id
    ) as rn
  from public.leave_requests
  where schedule_request_id is not null
    and status in ('pending', 'approved')
)
update public.leave_requests
set status = 'rejected'
where id in (select id from ranked where rn > 1);

create index if not exists schedule_employee_date_idx on public.schedule_requests(employee_id, work_date);
create index if not exists schedule_status_date_idx on public.schedule_requests(status, work_date);
create unique index if not exists schedule_one_open_per_day_idx
  on public.schedule_requests(employee_id, work_date)
  where status in ('pending', 'approved');
create index if not exists unavailability_employee_date_idx on public.unavailability(employee_id, unavailable_date);
create unique index if not exists unavailability_one_active_per_day_idx
  on public.unavailability(employee_id, unavailable_date)
  where status = 'active';
create index if not exists leave_employee_date_idx on public.leave_requests(employee_id, leave_date);
create unique index if not exists leave_one_open_per_schedule_idx
  on public.leave_requests(schedule_request_id)
  where schedule_request_id is not null and status in ('pending', 'approved');
create index if not exists notifications_recipient_created_idx on public.notifications(recipient_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.schedule_requests enable row level security;
alter table public.unavailability enable row level security;
alter table public.leave_requests enable row level security;
alter table public.schedule_settings enable row level security;
alter table public.notifications enable row level security;

create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role_type in ('LEADER', 'ADMIN', 'SUPER_ADMIN')
      and status = 'active'
  );
$$;

create or replace function public.is_super_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role_type = 'SUPER_ADMIN'
      and status = 'active'
  );
$$;

-- Return columns changed across older releases, so PostgreSQL requires a drop first.
drop function if exists public.get_schedule_counts(date, date);

create function public.get_schedule_counts(p_start date, p_end date)
returns table (
  work_date date,
  shift text,
  pending_count bigint,
  approved_count bigint,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select sr.work_date, sr.shift,
    count(*) filter (where sr.status = 'pending'),
    count(*) filter (where sr.status = 'approved'),
    count(*) filter (where sr.status in ('pending', 'approved'))
  from public.schedule_requests sr
  where auth.uid() is not null
    and sr.work_date between p_start and p_end
    and sr.status in ('pending', 'approved')
  group by sr.work_date, sr.shift
  order by sr.work_date, sr.shift;
$$;

create or replace function public.update_my_profile(p_full_name text, p_phone text default null)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare v_profile public.profiles;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if length(trim(coalesce(p_full_name, ''))) < 2 then raise exception 'Họ tên không hợp lệ'; end if;

  update public.profiles
  set full_name = trim(p_full_name), phone = nullif(trim(coalesce(p_phone, '')), '')
  where id = auth.uid() and status = 'active'
  returning * into v_profile;

  if not found then raise exception 'Không tìm thấy hồ sơ đang hoạt động'; end if;
  return v_profile;
end;
$$;

revoke all on function public.is_admin_user() from public;
revoke all on function public.is_super_admin_user() from public;
revoke all on function public.get_schedule_counts(date,date) from public;
revoke all on function public.update_my_profile(text,text) from public;
grant execute on function public.is_admin_user() to authenticated;
grant execute on function public.is_super_admin_user() to authenticated;
grant execute on function public.get_schedule_counts(date,date) to authenticated;
grant execute on function public.update_my_profile(text,text) to authenticated;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.schedule_requests to authenticated;
grant select, insert, update, delete on public.unavailability to authenticated;
grant select, insert, update, delete on public.leave_requests to authenticated;
grant select, insert, update, delete on public.schedule_settings to authenticated;
grant select, insert, update, delete on public.notifications to authenticated;

-- PROFILES
drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "Users and admins can view profiles" on public.profiles;
drop policy if exists "Admins can manage profiles" on public.profiles;
drop policy if exists "Super admins can insert profiles" on public.profiles;
drop policy if exists "Super admins can update profiles" on public.profiles;
drop policy if exists "Super admins can delete profiles" on public.profiles;
create policy "Users and admins can view profiles" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin_user());
create policy "Super admins can insert profiles" on public.profiles for insert to authenticated
  with check (public.is_super_admin_user());
create policy "Super admins can update profiles" on public.profiles for update to authenticated
  using (public.is_super_admin_user()) with check (public.is_super_admin_user());
create policy "Super admins can delete profiles" on public.profiles for delete to authenticated
  using (public.is_super_admin_user());

-- SCHEDULE REQUESTS
drop policy if exists "Users can view own schedules" on public.schedule_requests;
drop policy if exists "Users can create own schedules" on public.schedule_requests;
drop policy if exists "Users can cancel own pending schedules" on public.schedule_requests;
drop policy if exists "Admins can manage schedules" on public.schedule_requests;
drop policy if exists "Admins can update schedules" on public.schedule_requests;
drop policy if exists "Super admins can delete schedules" on public.schedule_requests;
create policy "Users can view own schedules" on public.schedule_requests for select to authenticated
  using (employee_id = auth.uid() or public.is_admin_user());
create policy "Users can create own schedules" on public.schedule_requests for insert to authenticated
  with check (employee_id = auth.uid());
create policy "Users can cancel own pending schedules" on public.schedule_requests for update to authenticated
  using (employee_id = auth.uid() and status = 'pending')
  with check (employee_id = auth.uid() and status in ('pending','cancelled'));
create policy "Admins can update schedules" on public.schedule_requests for update to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());
create policy "Super admins can delete schedules" on public.schedule_requests for delete to authenticated
  using (public.is_super_admin_user());

-- UNAVAILABILITY
drop policy if exists "Users can view own unavailability" on public.unavailability;
drop policy if exists "Users can create own unavailability" on public.unavailability;
drop policy if exists "Users can update own unavailability" on public.unavailability;
drop policy if exists "Admins can manage unavailability" on public.unavailability;
drop policy if exists "Super admins can delete unavailability" on public.unavailability;
create policy "Users can view own unavailability" on public.unavailability for select to authenticated
  using (employee_id = auth.uid() or public.is_admin_user());
create policy "Users can create own unavailability" on public.unavailability for insert to authenticated
  with check (employee_id = auth.uid());
create policy "Users can update own unavailability" on public.unavailability for update to authenticated
  using (employee_id = auth.uid()) with check (employee_id = auth.uid());
create policy "Super admins can delete unavailability" on public.unavailability for delete to authenticated
  using (public.is_super_admin_user());

-- LEAVE REQUESTS
drop policy if exists "Users can view own leave requests" on public.leave_requests;
drop policy if exists "Users can create own leave requests" on public.leave_requests;
drop policy if exists "Admins can manage leave requests" on public.leave_requests;
drop policy if exists "Admins can update leave requests" on public.leave_requests;
drop policy if exists "Super admins can delete leave requests" on public.leave_requests;
create policy "Users can view own leave requests" on public.leave_requests for select to authenticated
  using (employee_id = auth.uid() or public.is_admin_user());
create policy "Users can create own leave requests" on public.leave_requests for insert to authenticated
  with check (employee_id = auth.uid());
create policy "Admins can update leave requests" on public.leave_requests for update to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());
create policy "Super admins can delete leave requests" on public.leave_requests for delete to authenticated
  using (public.is_super_admin_user());

-- SETTINGS
drop policy if exists "All logged in users can view schedule settings" on public.schedule_settings;
drop policy if exists "Admins can manage schedule settings" on public.schedule_settings;
drop policy if exists "Super admins can manage schedule settings" on public.schedule_settings;
create policy "All logged in users can view schedule settings" on public.schedule_settings for select to authenticated using (true);
create policy "Super admins can manage schedule settings" on public.schedule_settings for all to authenticated
  using (public.is_super_admin_user()) with check (public.is_super_admin_user());

-- NOTIFICATIONS
drop policy if exists "Users can view own notifications" on public.notifications;
drop policy if exists "Users can mark own notifications as read" on public.notifications;
drop policy if exists "Admins can create notifications" on public.notifications;
drop policy if exists "Admins can manage notifications" on public.notifications;
drop policy if exists "Super admins can create notifications" on public.notifications;
drop policy if exists "Super admins can delete notifications" on public.notifications;
create policy "Users can view own notifications" on public.notifications for select to authenticated
  using (recipient_id = auth.uid() or public.is_admin_user());
create policy "Users can mark own notifications as read" on public.notifications for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
create policy "Super admins can create notifications" on public.notifications for insert to authenticated
  with check (public.is_super_admin_user());
create policy "Super admins can delete notifications" on public.notifications for delete to authenticated
  using (public.is_super_admin_user());

-- Bootstrap the existing main admin if that Auth user already exists.
insert into public.profiles (id, employee_code, full_name, email, phone, role_type, area, team, status, min_days_per_month)
select u.id, 'ADMIN001', 'Nguyễn Phi Trường', 'unitemedia2010@gmail.com', '', 'SUPER_ADMIN', null, 'MEDIA', 'active', 0
from auth.users u
where lower(u.email) = 'unitemedia2010@gmail.com'
on conflict (id) do update set
  full_name = excluded.full_name,
  email = excluded.email,
  role_type = 'SUPER_ADMIN',
  status = 'active';

-- Prevent new work/OFF/busy registrations on Sunday while preserving old records.
create or replace function public.reject_new_sunday_registration()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_date date;
begin
  if tg_table_name = 'schedule_requests' then
    target_date := new.work_date;
  else
    target_date := new.unavailable_date;
  end if;

  if extract(isodow from target_date) = 7 then
    raise exception 'Chủ Nhật là ngày nghỉ hàng tuần và không cần đăng ký';
  end if;

  return new;
end;
$$;

drop trigger if exists reject_sunday_schedule_request on public.schedule_requests;
create trigger reject_sunday_schedule_request
before insert or update of work_date on public.schedule_requests
for each row execute function public.reject_new_sunday_registration();

drop trigger if exists reject_sunday_unavailability on public.unavailability;
create trigger reject_sunday_unavailability
before insert or update of unavailable_date on public.unavailability
for each row execute function public.reject_new_sunday_registration();

commit;
