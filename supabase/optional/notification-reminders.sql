-- TÙY CHỌN: nhắc lại thông báo chưa đọc mỗi giờ.
-- Chỉ chạy sau 004_hr_portal.sql và khi project cho phép extension pg_cron.

create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname = 'unite-remind-unread-announcements';

select cron.schedule(
  'unite-remind-unread-announcements',
  '0 * * * *',
  $$select public.remind_unread_announcements();$$
);
