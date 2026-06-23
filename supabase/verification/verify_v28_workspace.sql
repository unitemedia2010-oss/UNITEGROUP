select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'employees'
  and column_name in ('sync_version','sheet_synced_at','sheet_row_number')
order by column_name;

select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'hr_case_attachments'
  and column_name in (
    'storage_provider','external_file_id','external_folder_id',
    'external_url','sync_status','deleted_at'
  )
order by column_name;

select to_regclass('public.workspace_sync_logs') as workspace_sync_logs;
