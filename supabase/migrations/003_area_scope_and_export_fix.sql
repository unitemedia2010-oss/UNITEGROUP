-- UNITE WORK SCHEDULE V23
-- 1) Fix missing flexible-leave columns used by monthly attendance export.
-- 2) Add area/branch/department scope to profiles.
-- 3) Restrict LEADER access to employees in the same non-empty area AND team.

begin;

alter table public.profiles
  add column if not exists area text;

alter table public.leave_requests
  add column if not exists leave_period text not null default 'full_shift';
alter table public.leave_requests
  add column if not exists leave_start_time time;
alter table public.leave_requests
  add column if not exists leave_end_time time;

update public.leave_requests
set leave_period = 'full_shift'
where leave_period is null
   or leave_period not in ('full_shift', 'first_half', 'last_half', 'custom');

alter table public.leave_requests
  alter column leave_period set default 'full_shift';
alter table public.leave_requests
  alter column leave_period set not null;

update public.leave_requests
set leave_start_time = null,
    leave_end_time = null
where leave_period = 'full_shift';

update public.leave_requests
set leave_period = 'full_shift',
    leave_start_time = null,
    leave_end_time = null
where leave_period in ('first_half', 'last_half', 'custom')
  and (leave_start_time is null or leave_end_time is null or leave_start_time >= leave_end_time);

alter table public.leave_requests
  drop constraint if exists leave_requests_leave_period_check;
alter table public.leave_requests
  add constraint leave_requests_leave_period_check
  check (leave_period in ('full_shift', 'first_half', 'last_half', 'custom'));

alter table public.leave_requests
  drop constraint if exists leave_requests_time_range_check;
alter table public.leave_requests
  add constraint leave_requests_time_range_check
  check (
    (leave_period = 'full_shift' and leave_start_time is null and leave_end_time is null)
    or
    (leave_period in ('first_half', 'last_half', 'custom')
      and leave_start_time is not null
      and leave_end_time is not null
      and leave_start_time < leave_end_time)
  );

create index if not exists profiles_area_team_idx
  on public.profiles (lower(coalesce(area, '')), lower(coalesce(team, '')));

create or replace function public.can_manage_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles me
    join public.profiles target on target.id = p_employee_id
    where me.id = auth.uid()
      and me.status = 'active'
      and (
        me.role_type in ('ADMIN', 'SUPER_ADMIN')
        or (
          me.role_type = 'LEADER'
          and (
            target.id = me.id
            or (
              nullif(trim(me.area), '') is not null
              and nullif(trim(me.team), '') is not null
              and lower(trim(coalesce(target.area, ''))) = lower(trim(me.area))
              and lower(trim(coalesce(target.team, ''))) = lower(trim(me.team))
            )
          )
        )
      )
  );
$$;

revoke all on function public.can_manage_employee(uuid) from public;
grant execute on function public.can_manage_employee(uuid) to authenticated;

-- Profiles: staff see self; LEADER sees same area+team; ADMIN/SUPER_ADMIN see all.
drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "Admins can manage profiles" on public.profiles;
drop policy if exists "Users and admins can view profiles" on public.profiles;
drop policy if exists "Users and scoped managers can view profiles" on public.profiles;
create policy "Users and scoped managers can view profiles"
on public.profiles for select to authenticated
using (id = auth.uid() or public.can_manage_employee(id));

-- Schedule requests.
drop policy if exists "Admins can manage schedules" on public.schedule_requests;
drop policy if exists "Users can view own schedules" on public.schedule_requests;
drop policy if exists "Users and scoped managers can view schedules" on public.schedule_requests;
create policy "Users and scoped managers can view schedules"
on public.schedule_requests for select to authenticated
using (employee_id = auth.uid() or public.can_manage_employee(employee_id));

drop policy if exists "Admins can update schedules" on public.schedule_requests;
drop policy if exists "Scoped managers can update schedules" on public.schedule_requests;
create policy "Scoped managers can update schedules"
on public.schedule_requests for update to authenticated
using (public.can_manage_employee(employee_id))
with check (public.can_manage_employee(employee_id));

-- Busy/OFF data.
drop policy if exists "Admins can manage unavailability" on public.unavailability;
drop policy if exists "Users can view own unavailability" on public.unavailability;
drop policy if exists "Users and scoped managers can view unavailability" on public.unavailability;
create policy "Users and scoped managers can view unavailability"
on public.unavailability for select to authenticated
using (employee_id = auth.uid() or public.can_manage_employee(employee_id));

-- Leave requests.
drop policy if exists "Admins can manage leave requests" on public.leave_requests;
drop policy if exists "Users can view own leave requests" on public.leave_requests;
drop policy if exists "Users and scoped managers can view leave requests" on public.leave_requests;
create policy "Users and scoped managers can view leave requests"
on public.leave_requests for select to authenticated
using (employee_id = auth.uid() or public.can_manage_employee(employee_id));

drop policy if exists "Admins can update leave requests" on public.leave_requests;
drop policy if exists "Scoped managers can update leave requests" on public.leave_requests;
create policy "Scoped managers can update leave requests"
on public.leave_requests for update to authenticated
using (public.can_manage_employee(employee_id))
with check (public.can_manage_employee(employee_id));

-- Notifications remain private to the recipient, with scoped visibility for managers.
drop policy if exists "Admins can manage notifications" on public.notifications;
drop policy if exists "Users can view own notifications" on public.notifications;
drop policy if exists "Users and scoped managers can view notifications" on public.notifications;
create policy "Users and scoped managers can view notifications"
on public.notifications for select to authenticated
using (recipient_id = auth.uid() or public.can_manage_employee(recipient_id));

-- Calendar counters must obey the same scope.
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
    and (sr.employee_id = auth.uid() or public.can_manage_employee(sr.employee_id))
  group by sr.work_date, sr.shift
  order by sr.work_date, sr.shift;
$$;

revoke all on function public.get_schedule_counts(date,date) from public;
grant execute on function public.get_schedule_counts(date,date) to authenticated;

commit;
