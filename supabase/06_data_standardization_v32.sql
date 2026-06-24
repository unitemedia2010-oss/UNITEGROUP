begin;

-- V32: chuẩn hóa dữ liệu HR, giữ đối chiếu không phân biệt hoa/thường
-- và bổ sung báo cáo chất lượng dữ liệu để tránh ghép nhầm hồ sơ.

create or replace function public.hr_clean_text_v32(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(regexp_replace(trim(coalesce(p_value, '')), '[[:space:]]+', ' ', 'g'), '');
$$;

create or replace function public.hr_department_v32(p_value text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare v text := lower(coalesce(public.hr_clean_text_v32(p_value), ''));
begin
  return case
    when v in ('kinh doanh', 'sale') then 'Kinh Doanh'
    when v in ('kế toán', 'ke toan') then 'Kế Toán'
    when v = 'hr' then 'HR'
    when v in ('admin', 'hành chính', 'hanh chinh') then 'Admin'
    when v in ('blđ', 'bld', 'ban lãnh đạo', 'ban lanh dao') then 'BLĐ'
    when v in ('trợ lý', 'tro ly') then 'Trợ Lý'
    when v in ('bảo vệ', 'bao ve') then 'Bảo Vệ'
    when v = 'central real' then 'Central Real'
    when v in ('marketing', 'media') then 'Marketing'
    when v = '' then null
    else public.hr_clean_text_v32(p_value)
  end;
end;
$$;

create or replace function public.hr_area_v32(p_value text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare v text := lower(coalesce(public.hr_clean_text_v32(p_value), ''));
begin
  return case
    when v = 'tinh hoa' then 'Tinh Hoa'
    when v in ('kỳ tài', 'ky tai') then 'Kỳ Tài'
    when v in ('tiên phong', 'tien phong') then 'Tiên Phong'
    when v in ('khai phá', 'khai pha') then 'Khai Phá'
    when v in ('bức phá', 'buc pha') then 'Bức Phá'
    when v = '' then null
    else public.hr_clean_text_v32(p_value)
  end;
end;
$$;

create or replace function public.hr_employment_type_v32(p_value text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare v text := lower(coalesce(public.hr_clean_text_v32(p_value), ''));
begin
  return case
    when v in ('full time', 'fulltime') then 'Full Time'
    when v in ('part time', 'parttime') then 'Part Time'
    when v = 'ctv' then 'CTV'
    when v = 'tts' then 'TTS'
    when v = '' then null
    else public.hr_clean_text_v32(p_value)
  end;
end;
$$;

create or replace function public.hr_bank_name_v32(p_value text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare v text := lower(coalesce(public.hr_clean_text_v32(p_value), ''));
begin
  return case
    when v = 'acb' then 'ACB'
    when v = 'sacombank' then 'Sacombank'
    when v in ('mb', 'mb bank', 'mb bak', 'mbbank') then 'MB Bank'
    when v in ('vietcombank', 'vcb') then 'Vietcombank'
    when v in ('techcombank', 'techcom', 'tcb') then 'Techcombank'
    when v in ('tpbank', 'tp bank') then 'TPBank'
    when v in ('vietinbank', 'viettinbank') then 'VietinBank'
    when v in ('bidv', 'bidv bank') then 'BIDV'
    when v in ('vpbank', 'vp bank') then 'VPBank'
    when v = 'vib' then 'VIB'
    when v in ('timo bank', 'timo') then 'Timo'
    when v = 'vikki bank' then 'Vikki Bank'
    when v = '' then null
    else public.hr_clean_text_v32(p_value)
  end;
end;
$$;

create or replace function public.standardize_employee_v32()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.employee_code := upper(public.hr_clean_text_v32(new.employee_code));
  new.original_employee_code := coalesce(public.hr_clean_text_v32(new.original_employee_code), new.employee_code);
  new.full_name := public.hr_clean_text_v32(new.full_name);
  new.nickname := public.hr_clean_text_v32(new.nickname);
  new.work_email := lower(public.hr_clean_text_v32(new.work_email));
  new.personal_email := lower(public.hr_clean_text_v32(new.personal_email));
  new.phone := nullif(regexp_replace(coalesce(public.hr_clean_text_v32(new.phone), ''), '[^0-9+]', '', 'g'), '');
  new.department := public.hr_department_v32(new.department);
  new.area := public.hr_area_v32(new.area);
  new.branch := upper(public.hr_clean_text_v32(new.branch));
  new.team := upper(public.hr_clean_text_v32(new.team));
  new.title := public.hr_clean_text_v32(new.title);
  new.employment_level := public.hr_clean_text_v32(new.employment_level);
  new.employment_type := public.hr_employment_type_v32(new.employment_type);
  new.gender := case
    when lower(coalesce(public.hr_clean_text_v32(new.gender), '')) in ('nữ', 'nu', 'female') then 'Nữ'
    when lower(coalesce(public.hr_clean_text_v32(new.gender), '')) in ('nam', 'male') then 'Nam'
    else public.hr_clean_text_v32(new.gender)
  end;
  new.source_file := public.hr_clean_text_v32(new.source_file);
  return new;
end;
$$;

drop trigger if exists trg_standardize_employee_v32 on public.employees;
drop trigger if exists trg_00_standardize_employee_v32 on public.employees;
create trigger trg_00_standardize_employee_v32
before insert or update of employee_code, original_employee_code, full_name, nickname, work_email, personal_email,
  phone, department, area, branch, team, title, employment_level, employment_type, gender, source_file
on public.employees
for each row execute function public.standardize_employee_v32();

create or replace function public.standardize_employee_private_v32()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.bank_name := public.hr_bank_name_v32(new.bank_name);
  new.bank_account := nullif(regexp_replace(coalesce(public.hr_clean_text_v32(new.bank_account), ''), '[[:space:].-]+', '', 'g'), '');
  new.citizen_id := nullif(regexp_replace(coalesce(public.hr_clean_text_v32(new.citizen_id), ''), '[[:space:].-]+', '', 'g'), '');
  new.social_insurance_no := public.hr_clean_text_v32(new.social_insurance_no);
  new.tax_code := public.hr_clean_text_v32(new.tax_code);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_standardize_employee_private_v32 on public.employee_private;
create trigger trg_standardize_employee_private_v32
before insert or update of bank_name, bank_account, citizen_id, social_insurance_no, tax_code
on public.employee_private
for each row execute function public.standardize_employee_private_v32();

create or replace function public.standardize_org_unit_v32()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.code := upper(public.hr_clean_text_v32(new.code));
  new.name := case
    when new.unit_type = 'company' then upper(public.hr_clean_text_v32(new.name))
    when new.unit_type = 'department' then public.hr_department_v32(new.name)
    when new.unit_type = 'area' then public.hr_area_v32(new.name)
    when new.unit_type in ('branch', 'team') then upper(public.hr_clean_text_v32(new.name))
    else public.hr_clean_text_v32(new.name)
  end;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_00_standardize_org_unit_v32 on public.org_units;
create trigger trg_00_standardize_org_unit_v32
before insert or update of unit_type, code, name
on public.org_units
for each row execute function public.standardize_org_unit_v32();

create or replace function public.standardize_profile_v32()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.employee_code := upper(public.hr_clean_text_v32(new.employee_code));
  new.full_name := public.hr_clean_text_v32(new.full_name);
  new.email := lower(public.hr_clean_text_v32(new.email));
  new.phone := nullif(regexp_replace(coalesce(public.hr_clean_text_v32(new.phone), ''), '[^0-9+]', '', 'g'), '');
  new.department := public.hr_department_v32(new.department);
  new.area := public.hr_area_v32(new.area);
  new.branch := upper(public.hr_clean_text_v32(new.branch));
  new.team := upper(public.hr_clean_text_v32(new.team));
  new.title := public.hr_clean_text_v32(new.title);
  return new;
end;
$$;

drop trigger if exists trg_standardize_profile_v32 on public.profiles;
create trigger trg_standardize_profile_v32
before insert or update of employee_code, full_name, email, phone, department, area, branch, team, title
on public.profiles
for each row execute function public.standardize_profile_v32();

-- Backfill qua chính các trigger mới; không thay UUID và không ghép/xóa hồ sơ.
update public.employees
set employee_code = employee_code,
    original_employee_code = original_employee_code,
    full_name = full_name,
    nickname = nickname,
    work_email = work_email,
    personal_email = personal_email,
    phone = phone,
    department = department,
    area = area,
    branch = branch,
    team = team,
    title = title,
    employment_level = employment_level,
    employment_type = employment_type,
    gender = gender,
    source_file = source_file;

update public.employee_private
set bank_name = bank_name,
    bank_account = bank_account,
    citizen_id = citizen_id,
    social_insurance_no = social_insurance_no,
    tax_code = tax_code;

update public.org_units
set code = code,
    name = name;

update public.profiles
set employee_code = employee_code,
    full_name = full_name,
    email = email,
    phone = phone,
    department = department,
    area = area,
    branch = branch,
    team = team,
    title = title;

create index if not exists employees_department_area_branch_team_v32_idx
  on public.employees (
    lower(coalesce(department, '')),
    lower(coalesce(area, '')),
    lower(coalesce(branch, '')),
    lower(coalesce(team, ''))
  );
create index if not exists employees_work_email_v32_idx on public.employees(lower(work_email)) where work_email is not null;
create index if not exists employees_personal_email_v32_idx on public.employees(lower(personal_email)) where personal_email is not null;
create index if not exists employees_phone_v32_idx on public.employees(phone) where phone is not null;
create index if not exists employees_nickname_v32_idx on public.employees(lower(nickname)) where nickname is not null;
create index if not exists employee_private_bank_name_v32_idx on public.employee_private(lower(bank_name)) where bank_name is not null;
create index if not exists employee_private_bank_account_v32_idx on public.employee_private(bank_account) where bank_account is not null;

-- Một dòng cho mỗi vấn đề; view chỉ báo cáo, không tự gộp các hồ sơ có khả năng trùng.
create or replace view public.employee_data_quality_issues_v32
with (security_invoker = true)
as
with duplicate_code as (
  select lower(employee_code) value_key
  from public.employees
  where nullif(trim(employee_code), '') is not null
  group by lower(employee_code)
  having count(*) > 1
), duplicate_email as (
  select value_key
  from (
    select id, lower(work_email) value_key from public.employees where nullif(trim(work_email), '') is not null
    union all
    select id, lower(personal_email) value_key from public.employees where nullif(trim(personal_email), '') is not null
  ) x
  group by value_key
  having count(distinct id) > 1
), duplicate_phone as (
  select phone value_key
  from public.employees
  where nullif(trim(phone), '') is not null
  group by phone
  having count(*) > 1
), team_conflict as (
  select lower(team) team_key
  from public.employees
  where nullif(trim(team), '') is not null
  group by lower(team)
  having count(distinct concat_ws('|', lower(coalesce(department,'')), lower(coalesce(area,'')), lower(coalesce(branch,'')))) > 1
)
select e.id employee_id, e.employee_code, e.full_name, 'missing_employee_code' issue_code,
       'Thiếu mã nhân sự' issue_label, 'warning' severity
from public.employees e where nullif(trim(e.employee_code), '') is null
union all
select e.id, e.employee_code, e.full_name, 'missing_email', 'Thiếu cả email công việc và email cá nhân', 'warning'
from public.employees e where nullif(trim(e.work_email), '') is null and nullif(trim(e.personal_email), '') is null
union all
select e.id, e.employee_code, e.full_name, 'duplicate_employee_code', 'Mã nhân sự đang trùng', 'error'
from public.employees e join duplicate_code d on d.value_key = lower(e.employee_code)
union all
select e.id, e.employee_code, e.full_name, 'duplicate_email', 'Email đang được dùng cho nhiều hồ sơ', 'error'
from public.employees e join duplicate_email d on d.value_key in (lower(e.work_email), lower(e.personal_email))
union all
select e.id, e.employee_code, e.full_name, 'duplicate_phone', 'Số điện thoại đang được dùng cho nhiều hồ sơ', 'error'
from public.employees e join duplicate_phone d on d.value_key = e.phone
union all
select e.id, e.employee_code, e.full_name, 'team_multiple_paths', 'Team xuất hiện ở nhiều tuyến Phòng ban/Khu vực/Chi nhánh', 'warning'
from public.employees e join team_conflict t on t.team_key = lower(e.team)
union all
select e.id, e.employee_code, e.full_name, 'incomplete_bank', 'Thông tin ngân hàng chưa đủ tên ngân hàng và số tài khoản', 'warning'
from public.employees e
join public.employee_private p on p.employee_id = e.id
where (p.bank_name is null) <> (p.bank_account is null);

grant select on public.employee_data_quality_issues_v32 to authenticated;

create or replace view public.org_unit_conflicts_v32
with (security_invoker = true)
as
select
  unit_type,
  parent_id,
  lower(name) as normalized_name,
  count(*) as duplicate_count,
  array_agg(id order by created_at) as unit_ids,
  array_agg(code order by created_at) as unit_codes
from public.org_units
where status = 'active'
group by unit_type, parent_id, lower(name)
having count(*) > 1;

grant select on public.org_unit_conflicts_v32 to authenticated;

-- Đồng bộ cờ chất lượng để bộ lọc trên Portal phản ánh dữ liệu thực tế.
update public.employees e
set data_quality = case
  when exists (
    select 1 from public.employee_data_quality_issues_v32 q
    where q.employee_id = e.id and q.severity = 'error'
  ) then 'invalid'
  when exists (
    select 1 from public.employee_data_quality_issues_v32 q
    where q.employee_id = e.id
  ) then 'needs_review'
  else 'ok'
end;

commit;
