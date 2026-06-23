select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='profiles'
  and column_name in ('must_change_password','password_changed_at')
order by column_name;

select to_regclass('public.employee_correction_requests') as employee_correction_requests;

select proname
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and proname in ('can_edit_employee_record','complete_first_password_change')
order by proname;
