-- UNITE HR PORTAL V27
-- Cổng thông tin HR + cây tổ chức + thông báo xác nhận đọc + trung tâm yêu cầu.
-- Chạy sau 001, 002, 003. Không xóa dữ liệu lịch hiện có.

begin;

create extension if not exists pgcrypto;

-- 1. MỞ RỘNG VAI TRÒ VÀ PHẠM VI
alter table public.profiles drop constraint if exists profiles_role_type_check;
alter table public.profiles add constraint profiles_role_type_check check (
  role_type in (
    'SALE','EMPLOYEE','TTS','NVPT','LEADER','BRANCH_MANAGER','AREA_MANAGER','HR','ADMIN','SUPER_ADMIN'
  )
);

alter table public.profiles add column if not exists department text;
alter table public.profiles add column if not exists branch text;
alter table public.profiles add column if not exists title text;
alter table public.profiles add column if not exists employee_record_id uuid;
alter table public.profiles add column if not exists area_id uuid;
alter table public.profiles add column if not exists branch_id uuid;
alter table public.profiles add column if not exists team_id uuid;
alter table public.profiles add column if not exists department_id uuid;

create table if not exists public.org_units (
  id uuid primary key default gen_random_uuid(),
  unit_type text not null check (unit_type in ('company','department','area','branch','team')),
  code text not null,
  name text not null,
  parent_id uuid references public.org_units(id) on delete restrict,
  status text not null default 'active' check (status in ('active','inactive')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists org_units_type_code_parent_uidx
  on public.org_units(unit_type, lower(code), coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists org_units_parent_idx on public.org_units(parent_id);

-- 2. HỒ SƠ NHÂN SỰ TÁCH KHỎI TÀI KHOẢN ĐĂNG NHẬP
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text,
  full_name text not null,
  work_email text,
  personal_email text,
  phone text,
  department text,
  area text,
  branch text,
  team text,
  title text,
  employment_level text,
  employment_type text,
  gender text,
  nickname text,
  start_date date,
  official_date date,
  end_date date,
  employment_status text not null default 'active' check (employment_status in ('active','resigned','reserved','unknown')),
  photo_url text,
  source_row integer,
  source_file text,
  data_quality text not null default 'ok' check (data_quality in ('ok','needs_review','invalid')),
  department_id uuid references public.org_units(id),
  area_id uuid references public.org_units(id),
  branch_id uuid references public.org_units(id),
  team_id uuid references public.org_units(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists employees_employee_code_uidx
  on public.employees(lower(employee_code)) where employee_code is not null and trim(employee_code) <> '';
create index if not exists employees_scope_idx on public.employees(area_id, branch_id, team_id);
create index if not exists employees_status_idx on public.employees(employment_status);
create unique index if not exists employees_source_row_uidx on public.employees(source_file, source_row) where source_file is not null and source_row is not null;
create index if not exists employees_name_idx on public.employees(lower(full_name));

alter table public.profiles drop constraint if exists profiles_employee_record_id_fkey;
alter table public.profiles add constraint profiles_employee_record_id_fkey
  foreign key (employee_record_id) references public.employees(id) on delete set null;
alter table public.profiles drop constraint if exists profiles_area_id_fkey;
alter table public.profiles add constraint profiles_area_id_fkey foreign key (area_id) references public.org_units(id) on delete set null;
alter table public.profiles drop constraint if exists profiles_branch_id_fkey;
alter table public.profiles add constraint profiles_branch_id_fkey foreign key (branch_id) references public.org_units(id) on delete set null;
alter table public.profiles drop constraint if exists profiles_team_id_fkey;
alter table public.profiles add constraint profiles_team_id_fkey foreign key (team_id) references public.org_units(id) on delete set null;
alter table public.profiles drop constraint if exists profiles_department_id_fkey;
alter table public.profiles add constraint profiles_department_id_fkey foreign key (department_id) references public.org_units(id) on delete set null;

create table if not exists public.employee_private (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  birth_date date,
  ethnicity text,
  religion text,
  nationality text,
  citizen_id text,
  social_insurance_no text,
  tax_code text,
  address_line text,
  district text,
  province text,
  starting_salary numeric,
  current_salary numeric,
  bank_account text,
  bank_name text,
  probation_start date,
  probation_end date,
  probation_status text,
  official_contract_type text,
  contract_expiry date,
  contract_file_url text,
  handover_status text,
  handover_date date,
  related_documents text,
  updated_at timestamptz not null default now()
);

create table if not exists public.org_memberships (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role_type text not null,
  org_unit_id uuid not null references public.org_units(id) on delete cascade,
  is_primary boolean not null default false,
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists org_memberships_profile_idx on public.org_memberships(profile_id);
create index if not exists org_memberships_unit_idx on public.org_memberships(org_unit_id);

create table if not exists public.reporting_edges (
  id uuid primary key default gen_random_uuid(),
  manager_profile_id uuid not null references public.profiles(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  relation_type text not null default 'direct' check (relation_type in ('direct','dotted','temporary')),
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create unique index if not exists reporting_edges_open_uidx
  on public.reporting_edges(manager_profile_id, employee_id, relation_type)
  where effective_to is null;

-- 3. THÔNG BÁO CHÍNH THỨC
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  priority text not null default 'normal' check (priority in ('normal','important','urgent')),
  requires_ack boolean not null default false,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  published_by uuid references public.profiles(id),
  published_at timestamptz,
  expires_at timestamptz,
  attachment_paths text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.announcement_targets (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  target_type text not null check (target_type in ('all','role','department','area','branch','team','user')),
  target_value text,
  created_at timestamptz not null default now()
);
create index if not exists announcement_targets_announcement_idx on public.announcement_targets(announcement_id);

create table if not exists public.announcement_recipients (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  read_at timestamptz,
  acknowledged_at timestamptz,
  reminder_count integer not null default 0,
  last_reminded_at timestamptz,
  primary key (announcement_id, recipient_id)
);
create index if not exists announcement_recipients_recipient_idx
  on public.announcement_recipients(recipient_id, delivered_at desc);

-- 4. TRUNG TÂM YÊU CẦU / BÁO CÁO HR
create table if not exists public.hr_cases (
  id uuid primary key default gen_random_uuid(),
  case_code text unique,
  case_type text not null check (case_type in ('suggestion','incident','document','attendance','profile_update','complaint','hr_support','other')),
  title text not null,
  description text,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'submitted' check (status in ('draft','submitted','in_review','need_info','approved','rejected','closed')),
  visibility_level text not null default 'management' check (visibility_level in ('management','hr_private')),
  creator_id uuid not null references public.profiles(id),
  subject_employee_id uuid references public.employees(id),
  assignee_id uuid references public.profiles(id),
  area_id uuid references public.org_units(id),
  branch_id uuid references public.org_units(id),
  team_id uuid references public.org_units(id),
  due_at timestamptz,
  submitted_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hr_cases_status_idx on public.hr_cases(status, priority, submitted_at desc);
create index if not exists hr_cases_scope_idx on public.hr_cases(area_id, branch_id, team_id);
create index if not exists hr_cases_creator_idx on public.hr_cases(creator_id, submitted_at desc);

create table if not exists public.hr_case_messages (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.hr_cases(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null,
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists hr_case_messages_case_idx on public.hr_case_messages(case_id, created_at);

create table if not exists public.hr_case_attachments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.hr_cases(id) on delete cascade,
  message_id uuid references public.hr_case_messages(id) on delete cascade,
  storage_path text not null,
  original_name text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists hr_case_attachments_case_idx on public.hr_case_attachments(case_id);

create table if not exists public.activity_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action_type text not null,
  entity_type text not null,
  entity_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_logs_entity_idx on public.activity_logs(entity_type, entity_id, created_at desc);

-- 5. NHẬP DỮ LIỆU EXCEL CÓ KIỂM TRA
create table if not exists public.employee_import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  warning_rows integer not null default 0,
  invalid_rows integer not null default 0,
  status text not null default 'preview' check (status in ('preview','importing','completed','failed')),
  summary jsonb not null default '{}'::jsonb,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.employee_import_rows (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.employee_import_batches(id) on delete cascade,
  row_number integer not null,
  employee_code text,
  full_name text,
  normalized_data jsonb not null,
  warnings text[] not null default '{}',
  import_status text not null default 'pending' check (import_status in ('pending','imported','skipped','failed')),
  employee_id uuid references public.employees(id),
  error_message text,
  unique(batch_id, row_number)
);
create index if not exists employee_import_rows_batch_idx on public.employee_import_rows(batch_id, import_status);

-- 6. HÀM QUYỀN
create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = public as $$
  select role_type from public.profiles where id = auth.uid() and status = 'active';
$$;

create or replace function public.try_uuid(p_value text)
returns uuid language plpgsql immutable as $$
begin
  return p_value::uuid;
exception when others then
  return null;
end; $$;

create or replace function public.has_hr_global_access()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() in ('HR','ADMIN','SUPER_ADMIN'), false);
$$;

create or replace function public.is_admin_user()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() in ('LEADER','BRANCH_MANAGER','AREA_MANAGER','HR','ADMIN','SUPER_ADMIN'), false);
$$;

create or replace function public.is_super_admin_user()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() = 'SUPER_ADMIN', false);
$$;

create or replace function public.can_manage_employee(p_employee_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles me
    join public.profiles target on target.id = p_employee_id
    where me.id = auth.uid() and me.status = 'active'
      and (
        me.role_type in ('HR','ADMIN','SUPER_ADMIN')
        or (me.role_type = 'AREA_MANAGER' and (
          (me.area_id is not null and me.area_id = target.area_id)
          or (nullif(trim(me.area),'') is not null and lower(trim(me.area)) = lower(trim(coalesce(target.area,''))))
        ))
        or (me.role_type = 'BRANCH_MANAGER' and (
          (me.branch_id is not null and me.branch_id = target.branch_id)
          or (nullif(trim(me.branch),'') is not null and lower(trim(me.branch)) = lower(trim(coalesce(target.branch,''))))
        ))
        or (me.role_type = 'LEADER' and (
          target.id = me.id
          or (me.team_id is not null and me.team_id = target.team_id)
          or (
            nullif(trim(me.area),'') is not null and nullif(trim(me.team),'') is not null
            and lower(trim(me.area)) = lower(trim(coalesce(target.area,'')))
            and lower(trim(me.team)) = lower(trim(coalesce(target.team,'')))
          )
        ))
      )
  );
$$;

create or replace function public.can_view_employee(p_employee_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles me
    join public.employees e on e.id = p_employee_id
    where me.id = auth.uid() and me.status = 'active'
      and (
        me.employee_record_id = e.id
        or me.role_type in ('HR','ADMIN','SUPER_ADMIN')
        or (me.role_type = 'AREA_MANAGER' and (
          (me.area_id is not null and me.area_id = e.area_id)
          or (nullif(trim(me.area),'') is not null and lower(trim(me.area)) = lower(trim(coalesce(e.area,''))))
        ))
        or (me.role_type = 'BRANCH_MANAGER' and (
          (me.branch_id is not null and me.branch_id = e.branch_id)
          or (nullif(trim(me.branch),'') is not null and lower(trim(me.branch)) = lower(trim(coalesce(e.branch,''))))
        ))
        or (me.role_type = 'LEADER' and (
          (me.team_id is not null and me.team_id = e.team_id)
          or (
            nullif(trim(me.area),'') is not null and nullif(trim(me.branch),'') is not null and nullif(trim(me.team),'') is not null
            and lower(trim(me.area)) = lower(trim(coalesce(e.area,'')))
            and lower(trim(me.branch)) = lower(trim(coalesce(e.branch,'')))
            and lower(trim(me.team)) = lower(trim(coalesce(e.team,'')))
          )
        ))
        or exists (
          select 1 from public.reporting_edges re
          where re.manager_profile_id = me.id and re.employee_id = e.id
            and re.effective_from <= current_date
            and (re.effective_to is null or re.effective_to >= current_date)
        )
      )
  );
$$;

create or replace function public.can_access_case(p_case_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.hr_cases c
    join public.profiles me on me.id = auth.uid() and me.status = 'active'
    where c.id = p_case_id and (
      c.creator_id = me.id or c.assignee_id = me.id
      or me.role_type in ('HR','ADMIN','SUPER_ADMIN')
      or (
        c.visibility_level <> 'hr_private'
        and (
          (me.role_type = 'AREA_MANAGER' and me.area_id is not null and me.area_id = c.area_id)
          or (me.role_type = 'BRANCH_MANAGER' and me.branch_id is not null and me.branch_id = c.branch_id)
          or (me.role_type = 'LEADER' and me.team_id is not null and me.team_id = c.team_id)
        )
      )
    )
  );
$$;

create or replace function public.get_profile_directory(p_ids uuid[])
returns table(id uuid, full_name text, email text, role_type text, area text, branch text, team text)
language sql stable security definer set search_path=public as $$
  select p.id, p.full_name,
    case when p.id=auth.uid() or public.has_hr_global_access() or public.can_manage_employee(p.id) then p.email else null end,
    p.role_type, p.area, p.branch, p.team
  from public.profiles p
  where auth.uid() is not null and p.id=any(coalesce(p_ids,'{}'::uuid[])) and (
    p.id=auth.uid()
    or public.has_hr_global_access()
    or public.can_manage_employee(p.id)
    or exists (
      select 1 from public.hr_cases c
      where (c.creator_id=p.id or c.assignee_id=p.id) and public.can_access_case(c.id)
    )
  );
$$;

revoke all on function public.current_app_role() from public;
revoke all on function public.try_uuid(text) from public;
revoke all on function public.has_hr_global_access() from public;
revoke all on function public.is_admin_user() from public;
revoke all on function public.is_super_admin_user() from public;
revoke all on function public.can_manage_employee(uuid) from public;
revoke all on function public.can_view_employee(uuid) from public;
revoke all on function public.can_access_case(uuid) from public;
revoke all on function public.get_profile_directory(uuid[]) from public;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.try_uuid(text) to authenticated;
grant execute on function public.has_hr_global_access() to authenticated;
grant execute on function public.is_admin_user() to authenticated;
grant execute on function public.is_super_admin_user() to authenticated;
grant execute on function public.can_manage_employee(uuid) to authenticated;
grant execute on function public.can_view_employee(uuid) to authenticated;
grant execute on function public.can_access_case(uuid) to authenticated;
grant execute on function public.get_profile_directory(uuid[]) to authenticated;

-- 7. MÃ HỒ SƠ VÀ PHÁT THÔNG BÁO
create or replace function public.set_case_code()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.case_code is null or trim(new.case_code) = '' then
    new.case_code := 'HR-' || to_char(current_date,'YYMM') || '-' || upper(substr(replace(new.id::text,'-',''),1,6));
  end if;
  return new;
end; $$;
drop trigger if exists trg_set_case_code on public.hr_cases;
create trigger trg_set_case_code before insert on public.hr_cases
for each row execute function public.set_case_code();

create or replace function public.publish_announcement(p_announcement_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if not public.has_hr_global_access() then raise exception 'Không có quyền phát thông báo'; end if;

  update public.announcements
  set status='published', published_by=auth.uid(), published_at=coalesce(published_at,now()), updated_at=now()
  where id=p_announcement_id;
  if not found then raise exception 'Không tìm thấy thông báo'; end if;

  insert into public.announcement_recipients(announcement_id,recipient_id)
  select distinct p_announcement_id, p.id
  from public.profiles p
  where p.status='active' and exists (
    select 1 from public.announcement_targets t
    where t.announcement_id=p_announcement_id and (
      t.target_type='all'
      or (t.target_type='role' and lower(p.role_type)=lower(coalesce(t.target_value,'')))
      or (t.target_type='department' and lower(coalesce(p.department,''))=lower(coalesce(t.target_value,'')))
      or (t.target_type='area' and (p.area_id::text=t.target_value or lower(coalesce(p.area,''))=lower(coalesce(t.target_value,''))))
      or (t.target_type='branch' and (p.branch_id::text=t.target_value or lower(coalesce(p.branch,''))=lower(coalesce(t.target_value,''))))
      or (t.target_type='team' and (p.team_id::text=t.target_value or lower(coalesce(p.team,''))=lower(coalesce(t.target_value,''))))
      or (t.target_type='user' and p.id::text=t.target_value)
    )
  )
  on conflict do nothing;

  insert into public.notifications(recipient_id,title,message,type,created_by)
  select ar.recipient_id, a.title, left(a.body,500),
    case a.priority when 'urgent' then 'err' when 'important' then 'warn' else 'info' end,
    auth.uid()
  from public.announcement_recipients ar
  join public.announcements a on a.id=ar.announcement_id
  where ar.announcement_id=p_announcement_id
    and not exists (
      select 1 from public.notifications n
      where n.recipient_id=ar.recipient_id
        and n.created_by=auth.uid()
        and n.title=a.title
        and n.created_at >= coalesce(a.published_at,now()) - interval '1 minute'
    );

  select count(*) into v_count from public.announcement_recipients where announcement_id=p_announcement_id;
  return v_count;
end; $$;

create or replace function public.mark_announcement_receipt(p_announcement_id uuid, p_ack boolean default false)
returns void language sql security definer set search_path = public as $$
  update public.announcement_recipients
  set read_at=coalesce(read_at,now()),
      acknowledged_at=case when p_ack then coalesce(acknowledged_at,now()) else acknowledged_at end
  where announcement_id=p_announcement_id and recipient_id=auth.uid();
$$;

revoke all on function public.publish_announcement(uuid) from public;
revoke all on function public.mark_announcement_receipt(uuid,boolean) from public;
grant execute on function public.publish_announcement(uuid) to authenticated;
grant execute on function public.mark_announcement_receipt(uuid,boolean) to authenticated;

-- 7B. THÔNG BÁO TỰ ĐỘNG CHO HỒ SƠ HR
create or replace function public.notify_hr_case_created()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.notifications(recipient_id,title,message,type,created_by)
  select distinct p.id,
    'Hồ sơ HR mới ' || coalesce(new.case_code,''),
    left(new.title,500),
    case when new.priority='urgent' then 'err' when new.priority='high' then 'warn' else 'info' end,
    new.creator_id
  from public.profiles p
  where p.status='active' and p.id<>new.creator_id and (
    p.role_type in ('HR','ADMIN','SUPER_ADMIN')
    or (
      new.visibility_level<>'hr_private' and (
        (p.role_type='AREA_MANAGER' and p.area_id is not null and p.area_id=new.area_id)
        or (p.role_type='BRANCH_MANAGER' and p.branch_id is not null and p.branch_id=new.branch_id)
        or (p.role_type='LEADER' and p.team_id is not null and p.team_id=new.team_id)
      )
    )
  );
  return new;
end; $$;

drop trigger if exists trg_notify_hr_case_created on public.hr_cases;
create trigger trg_notify_hr_case_created after insert on public.hr_cases
for each row execute function public.notify_hr_case_created();

create or replace function public.notify_hr_case_message()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_case public.hr_cases%rowtype;
begin
  select * into v_case from public.hr_cases where id=new.case_id;
  insert into public.notifications(recipient_id,title,message,type,created_by)
  select distinct p.id,
    'Phản hồi hồ sơ ' || coalesce(v_case.case_code,'HR'),
    left(new.body,500), 'info', new.sender_id
  from public.profiles p
  where p.status='active' and p.id<>new.sender_id and (
    p.id=v_case.creator_id or p.id=v_case.assignee_id
    or p.role_type in ('HR','ADMIN','SUPER_ADMIN')
    or (
      v_case.visibility_level<>'hr_private' and (
        (p.role_type='AREA_MANAGER' and p.area_id is not null and p.area_id=v_case.area_id)
        or (p.role_type='BRANCH_MANAGER' and p.branch_id is not null and p.branch_id=v_case.branch_id)
        or (p.role_type='LEADER' and p.team_id is not null and p.team_id=v_case.team_id)
      )
    )
  );
  return new;
end; $$;

drop trigger if exists trg_notify_hr_case_message on public.hr_case_messages;
create trigger trg_notify_hr_case_message after insert on public.hr_case_messages
for each row execute function public.notify_hr_case_message();

create or replace function public.notify_hr_case_status()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status is distinct from old.status then
    insert into public.notifications(recipient_id,title,message,type,created_by)
    values (new.creator_id,
      'Cập nhật hồ sơ ' || coalesce(new.case_code,'HR'),
      'Trạng thái mới: ' || new.status,
      case when new.status='rejected' then 'err' when new.status in ('approved','closed') then 'ok' else 'info' end,
      auth.uid())
    on conflict do nothing;
  end if;
  return new;
end; $$;

drop trigger if exists trg_notify_hr_case_status on public.hr_cases;
create trigger trg_notify_hr_case_status after update of status on public.hr_cases
for each row execute function public.notify_hr_case_status();

-- Có thể gọi hàm này mỗi giờ bằng Supabase Cron để nhắc thông báo quan trọng chưa đọc.
create or replace function public.remind_unread_announcements()
returns integer language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
  insert into public.notifications(recipient_id,title,message,type,created_by)
  select ar.recipient_id, 'Nhắc đọc: '||a.title, left(a.body,300),
    case when a.priority='urgent' then 'err' else 'warn' end, a.published_by
  from public.announcement_recipients ar
  join public.announcements a on a.id=ar.announcement_id
  where ar.read_at is null and a.status='published'
    and a.priority in ('important','urgent')
    and a.published_at <= now()-interval '4 hours'
    and (ar.last_reminded_at is null or ar.last_reminded_at <= now()-interval '12 hours')
    and (a.expires_at is null or a.expires_at>now());
  get diagnostics v_count=row_count;
  update public.announcement_recipients ar set reminder_count=reminder_count+1,last_reminded_at=now()
  from public.announcements a
  where a.id=ar.announcement_id and ar.read_at is null and a.status='published'
    and a.priority in ('important','urgent') and a.published_at<=now()-interval '4 hours'
    and (ar.last_reminded_at is null or ar.last_reminded_at<=now()-interval '12 hours');
  return v_count;
end; $$;
revoke all on function public.remind_unread_announcements() from public;

-- 8. RLS
alter table public.org_units enable row level security;
alter table public.employees enable row level security;
alter table public.employee_private enable row level security;
alter table public.org_memberships enable row level security;
alter table public.reporting_edges enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_targets enable row level security;
alter table public.announcement_recipients enable row level security;
alter table public.hr_cases enable row level security;
alter table public.hr_case_messages enable row level security;
alter table public.hr_case_attachments enable row level security;
alter table public.activity_logs enable row level security;
alter table public.employee_import_batches enable row level security;
alter table public.employee_import_rows enable row level security;

grant select,insert,update,delete on public.org_units to authenticated;
grant select,insert,update,delete on public.employees to authenticated;
grant select,insert,update,delete on public.employee_private to authenticated;
grant select,insert,update,delete on public.org_memberships to authenticated;
grant select,insert,update,delete on public.reporting_edges to authenticated;
grant select,insert,update,delete on public.announcements to authenticated;
grant select,insert,update,delete on public.announcement_targets to authenticated;
grant select,insert,update,delete on public.announcement_recipients to authenticated;
grant select,insert,update,delete on public.hr_cases to authenticated;
grant select,insert,update,delete on public.hr_case_messages to authenticated;
grant select,insert,update,delete on public.hr_case_attachments to authenticated;
grant select,insert on public.activity_logs to authenticated;
grant select,insert,update,delete on public.employee_import_batches to authenticated;
grant select,insert,update,delete on public.employee_import_rows to authenticated;
grant usage,select on sequence public.activity_logs_id_seq to authenticated;
grant usage,select on sequence public.employee_import_rows_id_seq to authenticated;

-- Existing notification policies from older versions are narrowed again.
drop policy if exists "Users can view own notifications" on public.notifications;
drop policy if exists "Users and scoped managers can view notifications" on public.notifications;
drop policy if exists "Users can mark own notifications as read" on public.notifications;
drop policy if exists "Super admins can create notifications" on public.notifications;
drop policy if exists "Super admins can delete notifications" on public.notifications;
drop policy if exists "HR can create notifications" on public.notifications;
drop policy if exists "HR can delete notifications" on public.notifications;
create policy "Users can view own notifications" on public.notifications for select to authenticated
  using (recipient_id=auth.uid());
create policy "Users can mark own notifications as read" on public.notifications for update to authenticated
  using (recipient_id=auth.uid()) with check (recipient_id=auth.uid());
create policy "HR can create notifications" on public.notifications for insert to authenticated
  with check (public.has_hr_global_access());
create policy "HR can delete notifications" on public.notifications for delete to authenticated
  using (public.has_hr_global_access());

-- Org units
drop policy if exists "Logged users view org tree" on public.org_units;
create policy "Logged users view org tree" on public.org_units for select to authenticated using (true);
drop policy if exists "Admins manage org tree" on public.org_units;
create policy "Admins manage org tree" on public.org_units for all to authenticated
  using (public.current_app_role() in ('ADMIN','SUPER_ADMIN'))
  with check (public.current_app_role() in ('ADMIN','SUPER_ADMIN'));

-- Employees
drop policy if exists "Scoped users view employees" on public.employees;
create policy "Scoped users view employees" on public.employees for select to authenticated
  using (public.can_view_employee(id));
drop policy if exists "HR manages employees" on public.employees;
create policy "HR manages employees" on public.employees for all to authenticated
  using (public.has_hr_global_access()) with check (public.has_hr_global_access());

drop policy if exists "Employee views own private data" on public.employee_private;
create policy "Employee views own private data" on public.employee_private for select to authenticated
  using (public.has_hr_global_access() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.employee_record_id=employee_id));
drop policy if exists "HR manages private data" on public.employee_private;
create policy "HR manages private data" on public.employee_private for all to authenticated
  using (public.has_hr_global_access()) with check (public.has_hr_global_access());

drop policy if exists "Users view own memberships" on public.org_memberships;
create policy "Users view own memberships" on public.org_memberships for select to authenticated
  using (profile_id=auth.uid() or public.has_hr_global_access());
drop policy if exists "Admins manage memberships" on public.org_memberships;
create policy "Admins manage memberships" on public.org_memberships for all to authenticated
  using (public.current_app_role() in ('ADMIN','SUPER_ADMIN'))
  with check (public.current_app_role() in ('ADMIN','SUPER_ADMIN'));

drop policy if exists "Managers view reporting lines" on public.reporting_edges;
create policy "Managers view reporting lines" on public.reporting_edges for select to authenticated
  using (manager_profile_id=auth.uid() or public.has_hr_global_access());
drop policy if exists "HR manages reporting lines" on public.reporting_edges;
create policy "HR manages reporting lines" on public.reporting_edges for all to authenticated
  using (public.has_hr_global_access()) with check (public.has_hr_global_access());

-- Announcements
drop policy if exists "Published announcements visible to recipients" on public.announcements;
create policy "Published announcements visible to recipients" on public.announcements for select to authenticated
  using (public.has_hr_global_access() or exists (
    select 1 from public.announcement_recipients ar where ar.announcement_id=id and ar.recipient_id=auth.uid()
  ));
drop policy if exists "HR creates announcements" on public.announcements;
create policy "HR creates announcements" on public.announcements for all to authenticated
  using (public.has_hr_global_access()) with check (public.has_hr_global_access());
drop policy if exists "HR manages targets" on public.announcement_targets;
create policy "HR manages targets" on public.announcement_targets for all to authenticated
  using (public.has_hr_global_access()) with check (public.has_hr_global_access());
drop policy if exists "Recipients view receipts" on public.announcement_recipients;
create policy "Recipients view receipts" on public.announcement_recipients for select to authenticated
  using (recipient_id=auth.uid() or public.has_hr_global_access());
drop policy if exists "Recipients update own receipts" on public.announcement_recipients;
create policy "Recipients update own receipts" on public.announcement_recipients for update to authenticated
  using (recipient_id=auth.uid() or public.has_hr_global_access())
  with check (recipient_id=auth.uid() or public.has_hr_global_access());

-- HR cases
drop policy if exists "Scoped users view cases" on public.hr_cases;
create policy "Scoped users view cases" on public.hr_cases for select to authenticated
  using (public.can_access_case(id));
drop policy if exists "Users create cases" on public.hr_cases;
create policy "Users create cases" on public.hr_cases for insert to authenticated
  with check (creator_id=auth.uid());
drop policy if exists "Case participants update cases" on public.hr_cases;
drop policy if exists "HR updates cases" on public.hr_cases;
create policy "HR updates cases" on public.hr_cases for update to authenticated
  using (public.has_hr_global_access())
  with check (public.has_hr_global_access());
drop policy if exists "HR deletes cases" on public.hr_cases;
create policy "HR deletes cases" on public.hr_cases for delete to authenticated
  using (public.has_hr_global_access());

drop policy if exists "Case participants view messages" on public.hr_case_messages;
create policy "Case participants view messages" on public.hr_case_messages for select to authenticated
  using (public.can_access_case(case_id) and (not is_internal or public.has_hr_global_access()));
drop policy if exists "Case participants add messages" on public.hr_case_messages;
create policy "Case participants add messages" on public.hr_case_messages for insert to authenticated
  with check (sender_id=auth.uid() and public.can_access_case(case_id) and (not is_internal or public.has_hr_global_access()));
drop policy if exists "HR manages messages" on public.hr_case_messages;
create policy "HR manages messages" on public.hr_case_messages for update to authenticated
  using (public.has_hr_global_access()) with check (public.has_hr_global_access());

drop policy if exists "Case participants view attachments" on public.hr_case_attachments;
create policy "Case participants view attachments" on public.hr_case_attachments for select to authenticated
  using (public.can_access_case(case_id));
drop policy if exists "Case participants add attachments" on public.hr_case_attachments;
create policy "Case participants add attachments" on public.hr_case_attachments for insert to authenticated
  with check (uploaded_by=auth.uid() and public.can_access_case(case_id));
drop policy if exists "HR deletes attachments" on public.hr_case_attachments;
create policy "HR deletes attachments" on public.hr_case_attachments for delete to authenticated
  using (public.has_hr_global_access());

drop policy if exists "HR views activity logs" on public.activity_logs;
create policy "HR views activity logs" on public.activity_logs for select to authenticated using (public.has_hr_global_access());
drop policy if exists "Users create activity logs" on public.activity_logs;
create policy "Users create activity logs" on public.activity_logs for insert to authenticated with check (actor_id=auth.uid());

drop policy if exists "HR manages import batches" on public.employee_import_batches;
create policy "HR manages import batches" on public.employee_import_batches for all to authenticated
  using (public.has_hr_global_access()) with check (public.has_hr_global_access());
drop policy if exists "HR manages import rows" on public.employee_import_rows;
create policy "HR manages import rows" on public.employee_import_rows for all to authenticated
  using (public.has_hr_global_access()) with check (public.has_hr_global_access());

-- 9. STORAGE RIÊNG TƯ CHO HỒ SƠ HR
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('hr-case-files','hr-case-files',false,15728640,array[
  'image/jpeg','image/png','image/webp','application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]) on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "Case members read HR files" on storage.objects;
create policy "Case members read HR files" on storage.objects for select to authenticated
using (bucket_id='hr-case-files' and public.can_access_case(public.try_uuid(split_part(name,'/',1))));
drop policy if exists "Case members upload HR files" on storage.objects;
create policy "Case members upload HR files" on storage.objects for insert to authenticated
with check (bucket_id='hr-case-files' and public.can_access_case(public.try_uuid(split_part(name,'/',1))));
drop policy if exists "HR deletes HR files" on storage.objects;
create policy "HR deletes HR files" on storage.objects for delete to authenticated
using (bucket_id='hr-case-files' and public.has_hr_global_access());

-- 10. LINK PROFILE VỚI EMPLOYEE THEO EMAIL SAU IMPORT
create or replace function public.link_profiles_to_employees()
returns integer language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
  if not public.has_hr_global_access() then raise exception 'Không có quyền'; end if;
  update public.profiles p set employee_record_id=e.id,
    department=coalesce(p.department,e.department), area=coalesce(p.area,e.area), branch=coalesce(p.branch,e.branch), team=coalesce(p.team,e.team),
    department_id=coalesce(p.department_id,e.department_id), area_id=coalesce(p.area_id,e.area_id), branch_id=coalesce(p.branch_id,e.branch_id), team_id=coalesce(p.team_id,e.team_id)
  from public.employees e
  where p.employee_record_id is null and (
    lower(p.email)=lower(coalesce(e.work_email,'')) or lower(p.email)=lower(coalesce(e.personal_email,''))
  );
  get diagnostics v_count = row_count;
  return v_count;
end; $$;
revoke all on function public.link_profiles_to_employees() from public;
grant execute on function public.link_profiles_to_employees() to authenticated;

-- Realtime: best effort, safe if already present.
do $$ begin
  alter publication supabase_realtime add table public.announcement_recipients;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.hr_cases;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.hr_case_messages;
exception when duplicate_object then null; end $$;

commit;
