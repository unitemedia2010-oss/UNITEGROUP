begin;

-- V33: tăng độ an toàn khi đối chiếu Excel/CSV với Supabase.
-- Không tự gộp hoặc xóa hồ sơ. Chỉ bổ sung dấu vân tay và metadata import.

alter table public.employees
  add column if not exists source_fingerprint text,
  add column if not exists import_identity_strength text,
  add column if not exists last_import_batch_id uuid;

create index if not exists employees_source_fingerprint_v33_idx
  on public.employees(source_fingerprint)
  where source_fingerprint is not null;

create index if not exists employees_source_row_name_v33_idx
  on public.employees(source_row, lower(full_name))
  where source_row is not null and full_name is not null;

create index if not exists employees_active_department_v33_idx
  on public.employees(employment_status, lower(coalesce(department, '')));

create or replace view public.employee_import_integrity_v33
with (security_invoker = true)
as
select
  e.id,
  e.employee_code,
  e.full_name,
  e.employment_status,
  e.department,
  e.area,
  e.branch,
  e.team,
  e.source_file,
  e.source_row,
  e.source_fingerprint,
  e.import_identity_strength,
  e.last_import_batch_id,
  case
    when nullif(trim(e.employee_code), '') is not null then 'strong'
    when nullif(trim(e.work_email), '') is not null
      or nullif(trim(e.personal_email), '') is not null
      or nullif(trim(e.phone), '') is not null then 'medium'
    when p.birth_date is not null then 'weak'
    else 'very_weak'
  end as calculated_identity_strength,
  array_remove(array[
    case when nullif(trim(e.employee_code), '') is null then 'missing_employee_code' end,
    case when nullif(trim(e.work_email), '') is null and nullif(trim(e.personal_email), '') is null then 'missing_email' end,
    case when nullif(trim(e.phone), '') is null then 'missing_phone' end,
    case when e.department = 'Kinh Doanh' and nullif(trim(e.area), '') is null then 'missing_area' end,
    case when e.department = 'Kinh Doanh' and nullif(trim(e.team), '') is null then 'missing_team' end
  ], null) as issues
from public.employees e
left join public.employee_private p on p.employee_id = e.id;

grant select on public.employee_import_integrity_v33 to authenticated;

-- Báo cáo các đơn vị tổ chức không còn nhân sự đang làm.
create or replace view public.org_units_without_active_employees_v33
with (security_invoker = true)
as
select u.id, u.unit_type, u.code, u.name, u.parent_id
from public.org_units u
where u.status = 'active'
  and u.unit_type in ('area', 'branch', 'team')
  and not exists (
    select 1
    from public.employees e
    where e.employment_status = 'active'
      and (
        (u.unit_type = 'area' and e.area_id = u.id) or
        (u.unit_type = 'branch' and e.branch_id = u.id) or
        (u.unit_type = 'team' and e.team_id = u.id)
      )
  );

grant select on public.org_units_without_active_employees_v33 to authenticated;

commit;
