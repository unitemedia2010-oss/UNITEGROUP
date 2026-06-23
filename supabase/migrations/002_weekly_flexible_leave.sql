-- UNITE WORK SCHEDULE V19
-- Upgrade an existing V16/V18 database for flexible leave requests.
-- Weekly submission and Sunday-off behavior are handled by the frontend;
-- this migration only adds the fields needed for partial-hour leave.

begin;

alter table public.leave_requests
  add column if not exists leave_period text not null default 'full_shift';

alter table public.leave_requests
  add column if not exists leave_start_time time;

alter table public.leave_requests
  add column if not exists leave_end_time time;

update public.leave_requests
set leave_period = 'full_shift'
where leave_period is null;

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
