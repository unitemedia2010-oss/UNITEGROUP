-- VERIFY UNITE HR PORTAL V27

select table_name
from information_schema.tables
where table_schema='public'
  and table_name in (
    'profiles','schedule_requests','unavailability','leave_requests','schedule_settings','notifications',
    'org_units','employees','employee_private','org_memberships','reporting_edges',
    'announcements','announcement_targets','announcement_recipients',
    'hr_cases','hr_case_messages','hr_case_attachments','activity_logs',
    'employee_import_batches','employee_import_rows'
  )
order by table_name;

select p.proname, pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
  'current_app_role','can_manage_employee','can_view_employee','can_access_case',
  'publish_announcement','mark_announcement_receipt','link_profiles_to_employees',
  'get_schedule_counts','remind_unread_announcements'
)
order by p.proname;

select id,name,public,file_size_limit from storage.buckets where id='hr-case-files';
select email,role_type,status,area,branch,team from public.profiles order by created_at desc;
