-- Chạy sau khi tạo Auth user tại Authentication > Users và bật Auto Confirm.

begin;

insert into public.profiles (
  id, employee_code, full_name, email, phone, role_type,
  department, area, branch, team, status, min_days_per_month
)
select
  u.id, 'ADMIN001', 'Nguyễn Phi Trường', lower(u.email), null,
  'SUPER_ADMIN', 'Vận hành', null, null, 'MEDIA', 'active', 0
from auth.users u
where lower(u.email)=lower('unitemedia2010@gmail.com')
on conflict (id) do update set
  employee_code=excluded.employee_code,
  full_name=excluded.full_name,
  email=excluded.email,
  role_type='SUPER_ADMIN',
  status='active',
  min_days_per_month=0;

commit;

select id,email,full_name,employee_code,role_type,status
from public.profiles
where lower(email)=lower('unitemedia2010@gmail.com');
