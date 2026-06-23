begin;

-- V30: vận hành nhân sự nâng cao, yêu cầu chỉnh sửa hồ sơ và bắt buộc đổi mật khẩu lần đầu.
alter table public.profiles
  add column if not exists must_change_password boolean not null default false,
  add column if not exists password_changed_at timestamptz;


create or replace function public.complete_first_password_change()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set must_change_password = false,
      password_changed_at = now()
  where id = auth.uid();
  return found;
end;
$$;
revoke all on function public.complete_first_password_change() from public;
grant execute on function public.complete_first_password_change() to authenticated;



-- Tự chuẩn hóa Khu vực/Chi nhánh/Team khi HR chỉnh trực tiếp trên app.
create or replace function public.resolve_org_unit_id(
  p_unit_type text,
  p_name text,
  p_parent_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_code text;
begin
  if nullif(trim(coalesce(p_name,'')), '') is null then return null; end if;
  select id into v_id
  from public.org_units
  where unit_type = p_unit_type
    and lower(trim(name)) = lower(trim(p_name))
    and parent_id is not distinct from p_parent_id
  limit 1;
  if v_id is not null then return v_id; end if;
  v_code := left(upper(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '_', 'g')), 36)
            || '_' || substr(md5(coalesce(p_parent_id::text,'ROOT') || lower(trim(p_name))),1,6);
  insert into public.org_units(unit_type, code, name, parent_id)
  values (p_unit_type, v_code, trim(p_name), p_parent_id)
  returning id into v_id;
  return v_id;
exception when unique_violation then
  select id into v_id
  from public.org_units
  where unit_type = p_unit_type
    and lower(trim(name)) = lower(trim(p_name))
    and parent_id is not distinct from p_parent_id
  limit 1;
  return v_id;
end;
$$;

create or replace function public.resolve_employee_scope_ids()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  v_company_id := public.resolve_org_unit_id('company', 'UNITE GROUP', null);
  new.department_id := public.resolve_org_unit_id('department', new.department, v_company_id);
  new.area_id := public.resolve_org_unit_id('area', new.area, v_company_id);
  new.branch_id := public.resolve_org_unit_id('branch', new.branch, coalesce(new.area_id, v_company_id));
  new.team_id := public.resolve_org_unit_id('team', new.team, coalesce(new.branch_id, new.area_id, v_company_id));
  return new;
end;
$$;

drop trigger if exists trg_resolve_employee_scope_ids on public.employees;
create trigger trg_resolve_employee_scope_ids
before insert or update of department, area, branch, team
on public.employees
for each row execute function public.resolve_employee_scope_ids();

revoke all on function public.resolve_org_unit_id(text,text,uuid) from public;
revoke all on function public.resolve_employee_scope_ids() from public;

-- Giữ hồ sơ tài khoản đồng bộ với hồ sơ nhân sự đã liên kết (không tự đổi email đăng nhập).
create or replace function public.sync_linked_profile_from_employee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set employee_code = coalesce(new.employee_code, employee_code),
      full_name = coalesce(new.full_name, full_name),
      phone = coalesce(new.phone, phone),
      department = new.department,
      area = new.area,
      branch = new.branch,
      team = new.team,
      department_id = new.department_id,
      area_id = new.area_id,
      branch_id = new.branch_id,
      team_id = new.team_id
  where employee_record_id = new.id;
  return new;
end;
$$;

drop trigger if exists trg_sync_linked_profile_from_employee on public.employees;
create trigger trg_sync_linked_profile_from_employee
after insert or update of employee_code, full_name, phone, department, area, branch, team, department_id, area_id, branch_id, team_id
on public.employees
for each row execute function public.sync_linked_profile_from_employee();

create table if not exists public.employee_correction_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  note text not null,
  proposed_changes jsonb not null default '{}'::jsonb,
  status text not null default 'submitted' check (status in ('submitted','in_review','approved','rejected','completed','cancelled')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists employee_correction_employee_idx
  on public.employee_correction_requests(employee_id, status, created_at desc);
create index if not exists employee_correction_requester_idx
  on public.employee_correction_requests(requested_by, created_at desc);

create or replace function public.can_edit_employee_record(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles me
    join public.employees e on e.id = p_employee_id
    where me.id = auth.uid() and me.status = 'active'
      and (
        me.role_type in ('HR','ADMIN','SUPER_ADMIN')
        or (me.role_type = 'AREA_MANAGER' and (
          (me.area_id is not null and me.area_id = e.area_id)
          or (nullif(trim(me.area),'') is not null and lower(trim(me.area)) = lower(trim(coalesce(e.area,''))))
        ))
        or (me.role_type = 'BRANCH_MANAGER' and (
          (me.branch_id is not null and me.branch_id = e.branch_id)
          or (nullif(trim(me.branch),'') is not null and lower(trim(me.branch)) = lower(trim(coalesce(e.branch,''))))
        ))
      )
  );
$$;

revoke all on function public.can_edit_employee_record(uuid) from public;
grant execute on function public.can_edit_employee_record(uuid) to authenticated;

alter table public.employee_correction_requests enable row level security;
grant select, insert, update on public.employee_correction_requests to authenticated;

-- Người dùng/manager được gửi yêu cầu cho hồ sơ trong phạm vi nhìn thấy.
drop policy if exists "Users create correction requests" on public.employee_correction_requests;
create policy "Users create correction requests"
on public.employee_correction_requests
for insert
to authenticated
with check (
  requested_by = auth.uid()
  and public.can_view_employee(employee_id)
);

-- Người gửi, HR và quản lý trong phạm vi được xem.
drop policy if exists "Scoped users view correction requests" on public.employee_correction_requests;
create policy "Scoped users view correction requests"
on public.employee_correction_requests
for select
to authenticated
using (
  requested_by = auth.uid()
  or public.has_hr_global_access()
  or public.can_edit_employee_record(employee_id)
);

-- Chỉ HR/Admin/SUPER_ADMIN xử lý trạng thái yêu cầu.
drop policy if exists "HR manages correction requests" on public.employee_correction_requests;
create policy "HR manages correction requests"
on public.employee_correction_requests
for update
to authenticated
using (public.has_hr_global_access())
with check (public.has_hr_global_access());

-- Cho quản lý khu vực/chi nhánh sửa dữ liệu công khai đúng phạm vi.
drop policy if exists "Scoped managers update employees" on public.employees;
create policy "Scoped managers update employees"
on public.employees
for update
to authenticated
using (public.can_edit_employee_record(id))
with check (public.can_edit_employee_record(id));

-- Tự gửi thông báo cho HR khi có yêu cầu sửa hồ sơ.
create or replace function public.notify_employee_correction_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_name text;
begin
  select full_name into v_employee_name from public.employees where id = new.employee_id;
  insert into public.notifications(recipient_id, title, message, type, created_by)
  select p.id,
         'Yêu cầu sửa hồ sơ nhân sự',
         coalesce(v_employee_name, 'Nhân sự') || ': ' || left(new.note, 400),
         'warn',
         new.requested_by
  from public.profiles p
  where p.status = 'active' and p.role_type in ('HR','ADMIN','SUPER_ADMIN');
  return new;
end;
$$;

drop trigger if exists trg_notify_employee_correction_request on public.employee_correction_requests;
create trigger trg_notify_employee_correction_request
after insert on public.employee_correction_requests
for each row execute function public.notify_employee_correction_request();

-- Tự cập nhật updated_at.
create or replace function public.touch_employee_correction_request()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if new.status in ('approved','rejected','completed') and new.reviewed_at is null then
    new.reviewed_at := now();
    new.reviewed_by := coalesce(new.reviewed_by, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_touch_employee_correction_request on public.employee_correction_requests;
create trigger trg_touch_employee_correction_request
before update on public.employee_correction_requests
for each row execute function public.touch_employee_correction_request();

commit;
