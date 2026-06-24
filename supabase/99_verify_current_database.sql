-- V33 verification: chạy sau 01 → 07.

select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='profiles'
  and column_name in ('must_change_password','password_changed_at')
order by column_name;

select
  to_regclass('public.employee_correction_requests') as employee_correction_requests,
  to_regclass('public.employee_data_quality_issues_v32') as employee_data_quality_issues_v32,
  to_regclass('public.org_unit_conflicts_v32') as org_unit_conflicts_v32,
  to_regclass('public.employee_import_integrity_v33') as employee_import_integrity_v33,
  to_regclass('public.org_units_without_active_employees_v33') as org_units_without_active_employees_v33;

select proname
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and proname in (
  'can_edit_employee_record','complete_first_password_change',
  'hr_clean_text_v32','hr_department_v32','hr_area_v32','hr_employment_type_v32','hr_bank_name_v32',
  'standardize_employee_v32','standardize_employee_private_v32','standardize_org_unit_v32','standardize_profile_v32'
)
order by proname;

select event_object_table, trigger_name
from information_schema.triggers
where trigger_schema='public'
  and trigger_name in ('trg_00_standardize_employee_v32','trg_standardize_employee_private_v32','trg_00_standardize_org_unit_v32','trg_standardize_profile_v32')
order by event_object_table, trigger_name;

select severity, issue_code, count(*) as total
from public.employee_data_quality_issues_v32
group by severity, issue_code
order by severity, issue_code;

select department, area, branch, team, count(*) as employees
from public.employees
where employment_status='active'
group by department, area, branch, team
order by department, area, branch, team
limit 100;

select * from public.org_unit_conflicts_v32 order by unit_type, normalized_name;


-- V33 import integrity
select count(*) as employees_total,
       count(*) filter (where employment_status = 'active') as active_total,
       count(*) filter (where source_fingerprint is not null) as fingerprinted_total
from public.employees;

select * from public.org_units_without_active_employees_v33 order by unit_type, name;

select import_identity_strength, count(*)
from public.employee_import_integrity_v33
group by import_identity_strength
order by import_identity_strength;

-- BLĐ phải có 4 người đang làm theo file nguồn đã kiểm tra.
select employee_code, full_name, department, area, title, employment_status
from public.employees
where lower(coalesce(department,'')) in ('blđ','bld')
order by source_row_order nulls last, employee_code;
