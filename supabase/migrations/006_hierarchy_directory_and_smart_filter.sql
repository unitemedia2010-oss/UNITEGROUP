begin;

-- V29: giữ thứ tự tổ chức giống file HR gốc, hỗ trợ lọc/sắp xếp an toàn.
alter table public.employees
  add column if not exists source_row_order integer,
  add column if not exists department_rank integer not null default 900,
  add column if not exists hierarchy_rank integer not null default 900,
  add column if not exists hierarchy_level integer not null default 90,
  add column if not exists hierarchy_label text,
  add column if not exists org_sort_key text,
  add column if not exists original_employee_code text;

create or replace function public.employee_department_rank(p_department text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case
    when lower(trim(coalesce(p_department,''))) in ('blđ','ban lãnh đạo','ban lanh dao') then 10
    when lower(trim(coalesce(p_department,''))) in ('trợ lý','tro ly') then 20
    when lower(trim(coalesce(p_department,''))) in ('kế toán','ke toan') then 30
    when lower(trim(coalesce(p_department,''))) = 'hr' then 40
    when lower(trim(coalesce(p_department,''))) in ('admin','hành chính','hanh chinh') then 50
    when lower(trim(coalesce(p_department,''))) in ('marketing','media') then 60
    when lower(trim(coalesce(p_department,''))) in ('central real','vận hành','van hanh') then 70
    when lower(trim(coalesce(p_department,''))) in ('bảo vệ','bao ve') then 80
    when lower(trim(coalesce(p_department,''))) in ('kinh doanh','sale') then 100
    else 800
  end;
$$;

create or replace function public.employee_hierarchy_rank(
  p_department text,
  p_title text,
  p_level text,
  p_employment_type text
)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := lower(concat_ws(' ', coalesce(p_department,''), coalesce(p_title,''), coalesce(p_level,'')));
  t text := lower(coalesce(p_employment_type,''));
begin
  if v ~ 'tổng giám đốc|tong giam doc' then return 10; end if;
  if v ~ 'phó tổng giám đốc|pho tong giam doc' then return 20; end if;
  if v ~ 'phó giám đốc|pho giam doc' then return 35; end if;
  if v ~ 'giám đốc|giam doc' then return 30; end if;
  if v ~ 'trưởng phòng|truong phong' then return 45; end if;
  if v ~ 'phó phòng|pho phong' then return 50; end if;
  if v ~ 'tpkd|quản lý khu vực|quan ly khu vuc' then return 55; end if;
  if v ~ 'qlcn|quản lý chi nhánh|quan ly chi nhanh' then return 60; end if;
  if v ~ 'leader' then return 70; end if;
  if v ~ 'full ct.*c2|full.*c2' then return 80; end if;
  if v ~ 'part ct.*c2|part.*c2' then return 85; end if;
  if v ~ 'full ct.*c1|full tv.*c1|full.*c1' then return 90; end if;
  if v ~ 'part ct.*c1|part tv.*c1|part.*c1' then return 100; end if;
  if v ~ 'tts|thực tập|thuc tap|nvpt' then return 115; end if;
  if v ~ 'nhân viên|nhan vien|sale' then return 110; end if;
  if t like '%full%' then return 120; end if;
  if t like '%part%' or t like '%ctv%' then return 130; end if;
  return 150;
end;
$$;

create or replace function public.employee_hierarchy_label(
  p_department text,
  p_title text,
  p_level text
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  r integer := public.employee_hierarchy_rank(p_department, p_title, p_level, null);
begin
  return case
    when r <= 20 then 'Ban lãnh đạo'
    when r <= 50 then 'Quản lý phòng ban'
    when r <= 55 then 'Quản lý khu vực'
    when r <= 60 then 'Quản lý chi nhánh'
    when r <= 70 then 'Leader'
    when r <= 100 then 'Nhân sự chính thức'
    when r <= 115 then 'TTS / NVPT'
    else 'Nhân viên / CTV'
  end;
end;
$$;

create or replace function public.set_employee_hierarchy_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.source_row_order := coalesce(new.source_row_order, new.source_row);
  new.original_employee_code := coalesce(new.original_employee_code, new.employee_code);
  new.department_rank := public.employee_department_rank(new.department);
  new.hierarchy_rank := public.employee_hierarchy_rank(new.department, new.title, new.employment_level, new.employment_type);
  new.hierarchy_level := case
    when new.hierarchy_rank <= 20 then 10
    when new.hierarchy_rank <= 50 then 20
    when new.hierarchy_rank <= 55 then 30
    when new.hierarchy_rank <= 60 then 40
    when new.hierarchy_rank <= 70 then 50
    else 60
  end;
  new.hierarchy_label := public.employee_hierarchy_label(new.department, new.title, new.employment_level);
  new.org_sort_key :=
    lpad(new.department_rank::text, 3, '0') || '|' ||
    lpad(new.hierarchy_rank::text, 3, '0') || '|' ||
    lower(coalesce(new.area,'')) || '|' ||
    lower(coalesce(new.branch,'')) || '|' ||
    lower(coalesce(new.team,'')) || '|' ||
    lpad(coalesce(new.source_row_order, 999999)::text, 6, '0') || '|' ||
    lower(coalesce(new.full_name,''));
  return new;
end;
$$;

drop trigger if exists trg_set_employee_hierarchy_fields on public.employees;
create trigger trg_set_employee_hierarchy_fields
before insert or update of department, area, branch, team, title, employment_level, employment_type, source_row, source_row_order, employee_code, full_name
on public.employees
for each row execute function public.set_employee_hierarchy_fields();

-- Backfill dữ liệu đã nhập trước V29.
update public.employees
set
  source_row_order = coalesce(source_row_order, source_row),
  original_employee_code = coalesce(original_employee_code, employee_code),
  department = department;

create index if not exists employees_hierarchy_order_idx
  on public.employees(department_rank, hierarchy_rank, area, branch, team, source_row_order, full_name);
create index if not exists employees_org_sort_key_idx
  on public.employees(org_sort_key);

-- Bộ lọc đã lưu của từng HR/Manager trên app.
create table if not exists public.employee_saved_views (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  sort_config jsonb not null default '{"field":"org_sort_key","direction":"asc"}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(profile_id, name)
);

alter table public.employee_saved_views enable row level security;
grant select, insert, update, delete on public.employee_saved_views to authenticated;

drop policy if exists "Users manage own employee views" on public.employee_saved_views;
create policy "Users manage own employee views"
on public.employee_saved_views
for all
to authenticated
using (profile_id = auth.uid())
with check (profile_id = auth.uid());

commit;
