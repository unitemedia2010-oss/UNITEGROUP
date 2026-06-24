const UNITE_HR = Object.freeze({
  SHEET_ID: '1pZopMrsmC2jmTP6gFmW1U9bpOYIOVf4ojll0-Ul7yCI',
  SUPABASE_FUNCTION_URL: 'https://yoxpuohxstudwmtglito.supabase.co/functions/v1/google-workspace-bridge',
  ROOT_FOLDER_NAME: 'UNITE_HR_DATA',
  EMPLOYEE_SHEET: 'NHAN_SU_SYNC',
  DIRECTORY_SHEET: 'DANH_BA_TO_CHUC',
  CONFIG_SHEET: 'CAU_HINH',
  LOG_SHEET: 'SYNC_LOG',
  MAX_FILE_BYTES: 8 * 1024 * 1024,
  EDITABLE_START_COLUMN: 2,
  EDITABLE_END_COLUMN: 18,
  SYNC_STATUS_COLUMN: 23,
  SYNC_ERROR_COLUMN: 24,
  HEADERS: [
    'STT tổ chức', 'Mã nhân sự', 'Họ tên', 'Phòng ban', 'Khu vực', 'Chi nhánh', 'Team',
    'Chức danh', 'Cấp bậc', 'Loại công việc', 'Email công việc', 'Email cá nhân',
    'Điện thoại', 'Ngày vào làm', 'Ngày chính thức', 'Ngày nghỉ', 'Trạng thái',
    'Chất lượng dữ liệu', 'Tuyến tổ chức',
    '_employee_id', '_sync_version', '_updated_at', '_sync_status', '_sync_error',
    '_original_employee_code', '_org_sort_key', '_hierarchy_rank', '_source_row_order'
  ]
});

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('UNITE HR')
    .addItem('1. Thiết lập Workspace', 'setupUniteHrWorkspace')
    .addSeparator()
    .addItem('Làm mới nhân sự từ Supabase', 'pullEmployeesFromSupabase')
    .addItem('Khôi phục thứ tự tổ chức', 'restoreOrganizationOrder')
    .addItem('Làm mới danh bạ tổ chức', 'refreshOrganizationDirectory')
    .addItem('Hiện / Ẩn cột kỹ thuật', 'toggleTechnicalColumns')
    .addSeparator()
    .addItem('Đồng bộ các dòng đang chọn', 'pushSelectedRowsToSupabase')
    .addItem('Đồng bộ tất cả dòng đã sửa', 'pushAllChangedRowsToSupabase')
    .addSeparator()
    .addItem('Cấu hình email HR xem file', 'setHrViewerEmails')
    .addItem('Xem cấu hình', 'showWorkspaceConfig')
    .addItem('Kiểm tra kết nối', 'testWorkspaceConnection')
    .addToUi();
}

function onEdit(e) {
  try {
    const range = e && e.range;
    if (!range) return;
    const sheet = range.getSheet();
    if (sheet.getName() !== UNITE_HR.EMPLOYEE_SHEET || range.getRow() <= 1) return;
    const firstColumn = range.getColumn();
    const lastColumn = range.getLastColumn();
    if (lastColumn < UNITE_HR.EDITABLE_START_COLUMN || firstColumn > UNITE_HR.EDITABLE_END_COLUMN) return;
    sheet.getRange(range.getRow(), UNITE_HR.SYNC_STATUS_COLUMN).setValue('CHANGED');
    sheet.getRange(range.getRow(), UNITE_HR.SYNC_ERROR_COLUMN).clearContent();
  } catch (error) {
    console.error(error);
  }
}

function setupUniteHrWorkspace() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', UNITE_HR.SHEET_ID);
  props.setProperty('SUPABASE_FUNCTION_URL', UNITE_HR.SUPABASE_FUNCTION_URL);

  if (!props.getProperty('INTEGRATION_SECRET')) {
    props.setProperty('INTEGRATION_SECRET', createSecret_());
  }

  const root = getOrCreateRootFolder_();
  const folders = [
    '01_HO_SO_NHAN_SU',
    '02_YEU_CAU_HR',
    '03_HOP_DONG',
    '04_BIEN_BAN',
    '05_BAO_CAO',
    '99_ARCHIVE'
  ];
  folders.forEach(name => getOrCreateChildFolder_(root, name));

  const ss = getSpreadsheet_();
  ensureEmployeeSheet_(ss);
  ensureDirectorySheet_(ss);
  ensureConfigSheet_(ss, root.getId());
  ensureLogSheet_(ss);
  applyEmployeeSheetFormatting_(ss.getSheetByName(UNITE_HR.EMPLOYEE_SHEET));

  writeSyncLog_('setup', 'completed', 0, 0, 0, {
    rootFolderId: root.getId(),
    rootFolderUrl: root.getUrl()
  });

  SpreadsheetApp.getUi().alert(
    'Thiết lập hoàn tất',
    'Đã tạo cấu trúc Sheet và thư mục Drive.\n\nBước tiếp theo: Deploy Apps Script dạng Web app, sau đó chép Web app URL và Integration Secret sang Supabase Secrets.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function setHrViewerEmails() {
  const ui = SpreadsheetApp.getUi();
  const current = PropertiesService.getScriptProperties().getProperty('HR_VIEWER_EMAILS') || '';
  const response = ui.prompt(
    'Email HR được xem file Drive',
    'Nhập email hoặc Google Group, cách nhau bằng dấu phẩy. Ví dụ: hr@unitegroup.vn, admin@gmail.com',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;
  PropertiesService.getScriptProperties().setProperty('HR_VIEWER_EMAILS', response.getResponseText().trim());
  const ss = getSpreadsheet_();
  const root = getOrCreateRootFolder_();
  ensureConfigSheet_(ss, root.getId());
  ui.alert('Đã lưu danh sách email HR. File tải lên sau thời điểm này sẽ được cấp quyền xem tự động.');
}

function showWorkspaceConfig() {
  const props = PropertiesService.getScriptProperties();
  const values = [
    ['SHEET_ID', props.getProperty('SHEET_ID') || UNITE_HR.SHEET_ID],
    ['SUPABASE_FUNCTION_URL', props.getProperty('SUPABASE_FUNCTION_URL') || UNITE_HR.SUPABASE_FUNCTION_URL],
    ['DRIVE_ROOT_FOLDER_ID', props.getProperty('DRIVE_ROOT_FOLDER_ID') || 'Chưa thiết lập'],
    ['INTEGRATION_SECRET', props.getProperty('INTEGRATION_SECRET') || 'Chưa thiết lập'],
    ['HR_VIEWER_EMAILS', props.getProperty('HR_VIEWER_EMAILS') || 'Chưa cấu hình']
  ];
  const text = values.map(row => `${row[0]}: ${row[1]}`).join('\n');
  SpreadsheetApp.getUi().alert('Cấu hình UNITE HR', text, SpreadsheetApp.getUi().ButtonSet.OK);
}

function testWorkspaceConnection() {
  const response = callSupabaseBridge_({ action: 'health' });
  SpreadsheetApp.getUi().alert(
    response && response.ok ? 'Kết nối thành công' : 'Kết nối chưa hoàn tất',
    JSON.stringify(response, null, 2),
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function pullEmployeesFromSupabase() {
  const ui = SpreadsheetApp.getUi();
  try {
    const response = callSupabaseBridge_({ action: 'sheet_pull_employees' });
    const rows = Array.isArray(response.rows) ? response.rows : [];
    const sheet = ensureEmployeeSheet_(getSpreadsheet_());
    const values = rows.map((employee, index) => employeeToSheetRow_(employee, index));

    const maxRows = Math.max(sheet.getMaxRows(), values.length + 1);
    if (sheet.getMaxRows() < maxRows) sheet.insertRowsAfter(sheet.getMaxRows(), maxRows - sheet.getMaxRows());
    sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), UNITE_HR.HEADERS.length).clearContent();
    if (values.length) sheet.getRange(2, 1, values.length, UNITE_HR.HEADERS.length).setValues(values);

    applyEmployeeSheetFormatting_(sheet);
    writeDirectoryRows_(rows);
    writeSyncLog_('sheet_pull', 'completed', rows.length, rows.length, 0, {});
    ui.alert('Đã làm mới dữ liệu', `Đã tải ${rows.length} hồ sơ từ Supabase xuống Sheet.`, ui.ButtonSet.OK);
  } catch (error) {
    writeSyncLog_('sheet_pull', 'failed', 0, 0, 1, { error: error.message });
    ui.alert('Không thể làm mới dữ liệu', error.message, ui.ButtonSet.OK);
  }
}

function pushSelectedRowsToSupabase() {
  const sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== UNITE_HR.EMPLOYEE_SHEET) {
    SpreadsheetApp.getUi().alert(`Hãy mở sheet ${UNITE_HR.EMPLOYEE_SHEET} trước.`);
    return;
  }
  const range = sheet.getActiveRange();
  if (!range || range.getRow() <= 1) {
    SpreadsheetApp.getUi().alert('Hãy chọn một hoặc nhiều dòng nhân sự cần đồng bộ.');
    return;
  }
  const start = Math.max(2, range.getRow());
  const end = range.getLastRow();
  pushRows_(sheet, createRowNumbers_(start, end));
}

function pushAllChangedRowsToSupabase() {
  const sheet = ensureEmployeeSheet_(getSpreadsheet_());
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    SpreadsheetApp.getUi().alert('Sheet chưa có dữ liệu.');
    return;
  }
  const statuses = sheet.getRange(2, UNITE_HR.SYNC_STATUS_COLUMN, lastRow - 1, 1).getDisplayValues();
  const rows = [];
  statuses.forEach((item, index) => {
    if (String(item[0]).toUpperCase() === 'CHANGED' || String(item[0]).toUpperCase() === 'ERROR') rows.push(index + 2);
  });
  if (!rows.length) {
    SpreadsheetApp.getUi().alert('Không có dòng nào đang chờ đồng bộ.');
    return;
  }
  pushRows_(sheet, rows);
}

function pushRows_(sheet, rowNumbers) {
  const ui = SpreadsheetApp.getUi();
  const chunks = chunk_(rowNumbers, 75);
  let success = 0;
  let failed = 0;

  chunks.forEach(rowChunk => {
    const payloadRows = rowChunk.map(row => sheetRowToEmployee_(sheet, row));
    let response;
    try {
      response = callSupabaseBridge_({ action: 'sheet_push_employees', rows: payloadRows });
    } catch (error) {
      rowChunk.forEach(row => {
        sheet.getRange(row, UNITE_HR.SYNC_STATUS_COLUMN).setValue('ERROR');
        sheet.getRange(row, UNITE_HR.SYNC_ERROR_COLUMN).setValue(error.message);
      });
      failed += rowChunk.length;
      return;
    }

    const results = Array.isArray(response.results) ? response.results : [];
    rowChunk.forEach((row, index) => {
      const result = results[index] || { ok: false, message: 'Không nhận được kết quả.' };
      if (result.ok) {
        sheet.getRange(row, 21).setValue(result.sync_version || '');
        sheet.getRange(row, 22).setValue(result.updated_at || new Date());
        sheet.getRange(row, UNITE_HR.SYNC_STATUS_COLUMN).setValue('SYNCED');
        sheet.getRange(row, UNITE_HR.SYNC_ERROR_COLUMN).clearContent();
        sheet.getRange(row, 25).setValue(result.employee_code || sheet.getRange(row, 2).getValue() || '');
        success++;
      } else {
        sheet.getRange(row, UNITE_HR.SYNC_STATUS_COLUMN).setValue(result.conflict ? 'CONFLICT' : 'ERROR');
        sheet.getRange(row, UNITE_HR.SYNC_ERROR_COLUMN).setValue(result.message || 'Không đồng bộ được.');
        failed++;
      }
    });
  });

  writeSyncLog_('sheet_push', failed ? (success ? 'partial' : 'failed') : 'completed', rowNumbers.length, success, failed, {});
  ui.alert('Đồng bộ hoàn tất', `Thành công: ${success}\nLỗi/xung đột: ${failed}`, ui.ButtonSet.OK);
}

function doGet() {
  return jsonOutput_({
    ok: true,
    service: 'UNITE HR Google Workspace Bridge',
    sheetId: UNITE_HR.SHEET_ID,
    configured: Boolean(PropertiesService.getScriptProperties().getProperty('INTEGRATION_SECRET'))
  });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    verifyIntegrationSecret_(body.integrationSecret);
    switch (body.action) {
      case 'upload_case_file':
        return jsonOutput_(uploadCaseFile_(body));
      case 'delete_file':
        return jsonOutput_(deleteDriveFile_(body.fileId));
      case 'health':
        return jsonOutput_({ ok: true, rootFolderId: getOrCreateRootFolder_().getId() });
      case 'replace_employee_sheet':
        return jsonOutput_(replaceEmployeeSheetFromApp_(body));
      default:
        return jsonOutput_({ ok: false, message: 'Action không được hỗ trợ.' });
    }
  } catch (error) {
    console.error(error);
    return jsonOutput_({ ok: false, message: error.message || String(error) });
  }
}

function replaceEmployeeSheetFromApp_(body) {
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const sheet = ensureEmployeeSheet_(getSpreadsheet_());
  const values = rows.map((item, index) => employeeToSheetRow_(item, index));
  const requiredRows = Math.max(2, values.length + 1);
  if (sheet.getMaxRows() < requiredRows) sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
  sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), UNITE_HR.HEADERS.length).clearContent();
  if (values.length) sheet.getRange(2, 1, values.length, UNITE_HR.HEADERS.length).setValues(values);
  applyEmployeeSheetFormatting_(sheet);
  refreshOrganizationDirectoryFromRows_(rows);
  writeSyncLog_('app_to_sheet', 'completed', rows.length, rows.length, 0, {});
  return { ok: true, total: rows.length };
}

function refreshOrganizationDirectoryFromRows_(rows) {
  const sheet = ensureDirectorySheet_(getSpreadsheet_());
  const headers = ['STT', 'Mã nhân sự', 'Họ tên', 'Phòng ban', 'Khu vực', 'Chi nhánh', 'Team', 'Chức danh', 'Cấp bậc', 'Loại công việc', 'Email công việc', 'Email cá nhân', 'Điện thoại', 'Ngày vào làm', 'Ngày chính thức', 'Ngày nghỉ', 'Trạng thái', 'Chất lượng dữ liệu', 'Tuyến tổ chức'];
  const values = rows.map((item, index) => employeeToSheetRow_(item, index).slice(0, 19));
  sheet.clear();
  if (sheet.getMaxColumns() < headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (values.length) {
    if (sheet.getMaxRows() < values.length + 1) sheet.insertRowsAfter(sheet.getMaxRows(), values.length + 1 - sheet.getMaxRows());
    sheet.getRange(2, 1, values.length, headers.length).setValues(values);
  }
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(3);
  sheet.getRange(1, 1, 1, headers.length).setBackground('#741f2b').setFontColor('#ffffff').setFontWeight('bold');
  sheet.getRange(2, 14, Math.max(values.length, 1), 3).setNumberFormat('dd/MM/yyyy');
  ensureFilterRange_(sheet, headers.length);
  applyHierarchyRowColors_(sheet, Math.max(values.length + 1, 2));
}

function uploadCaseFile_(body) {
  const name = sanitizeFileName_(body.fileName || 'file');
  const mimeType = String(body.mimeType || 'application/octet-stream');
  const sizeBytes = Number(body.sizeBytes || 0);
  if (!body.base64) throw new Error('Thiếu dữ liệu file.');
  if (sizeBytes > UNITE_HR.MAX_FILE_BYTES) throw new Error('File vượt quá giới hạn 8 MB.');

  const decoded = Utilities.base64Decode(String(body.base64).replace(/^data:[^;]+;base64,/, ''));
  if (decoded.length > UNITE_HR.MAX_FILE_BYTES) throw new Error('File vượt quá giới hạn 8 MB sau khi giải mã.');

  const root = getOrCreateRootFolder_();
  const caseRoot = getOrCreateChildFolder_(root, '02_YEU_CAU_HR');
  const yearFolder = getOrCreateChildFolder_(caseRoot, String(new Date().getFullYear()));
  const caseFolderName = sanitizeFolderName_(body.caseCode || body.caseId || 'HO_SO_HR');
  const caseFolder = getOrCreateChildFolder_(yearFolder, caseFolderName);

  const blob = Utilities.newBlob(decoded, mimeType, name);
  const file = caseFolder.createFile(blob);
  file.setDescription(JSON.stringify({
    caseId: body.caseId || null,
    caseCode: body.caseCode || null,
    uploaderId: body.uploaderId || null,
    uploaderEmail: body.uploaderEmail || null,
    uploadedAt: new Date().toISOString()
  }));

  const viewers = getViewerEmails_();
  if (body.uploaderEmail) viewers.push(String(body.uploaderEmail).trim());
  uniqueStrings_(viewers).forEach(email => {
    try { if (email) file.addViewer(email); } catch (error) { console.warn(`Không cấp quyền cho ${email}: ${error.message}`); }
  });

  writeSyncLog_('drive_upload', 'completed', 1, 1, 0, {
    caseId: body.caseId,
    fileId: file.getId(),
    fileName: name
  });

  return {
    ok: true,
    fileId: file.getId(),
    folderId: caseFolder.getId(),
    viewUrl: file.getUrl(),
    name: file.getName(),
    mimeType: file.getMimeType(),
    sizeBytes: decoded.length
  };
}

function deleteDriveFile_(fileId) {
  if (!fileId) throw new Error('Thiếu fileId.');
  const file = DriveApp.getFileById(String(fileId));
  file.setTrashed(true);
  writeSyncLog_('drive_delete', 'completed', 1, 1, 0, { fileId: fileId });
  return { ok: true };
}

function callSupabaseBridge_(payload) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SUPABASE_FUNCTION_URL') || UNITE_HR.SUPABASE_FUNCTION_URL;
  const secret = props.getProperty('INTEGRATION_SECRET');
  if (!secret) throw new Error('Chưa có INTEGRATION_SECRET. Hãy chạy Thiết lập Workspace trước.');

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(Object.assign({}, payload, { integrationSecret: secret })),
    muteHttpExceptions: true,
    followRedirects: true
  });
  const text = response.getContentText();
  let body;
  try { body = text ? JSON.parse(text) : {}; }
  catch (error) { throw new Error(`Phản hồi không phải JSON: ${text.slice(0, 300)}`); }
  const statusCode = response.getResponseCode();
  // Đồng bộ nhân sự có thể trả 422 nhưng vẫn kèm results chi tiết từng dòng.
  // Trả body về pushRows_ để ghi đúng lỗi vào cột _sync_error.
  if (Array.isArray(body.results)) return body;
  if (statusCode < 200 || statusCode >= 300 || body.ok === false) {
    throw new Error(body.message || body.error || body.error_description || `Supabase trả lỗi ${statusCode}`);
  }
  return body;
}

function verifyIntegrationSecret_(value) {
  const expected = PropertiesService.getScriptProperties().getProperty('INTEGRATION_SECRET');
  if (!expected || String(value || '') !== expected) throw new Error('Integration secret không hợp lệ.');
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID') || UNITE_HR.SHEET_ID;
  return SpreadsheetApp.openById(id);
}

function ensureEmployeeSheet_(ss) {
  let sheet = ss.getSheetByName(UNITE_HR.EMPLOYEE_SHEET);
  if (!sheet) sheet = ss.insertSheet(UNITE_HR.EMPLOYEE_SHEET);
  if (sheet.getMaxColumns() < UNITE_HR.HEADERS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), UNITE_HR.HEADERS.length - sheet.getMaxColumns());
  }
  sheet.getRange(1, 1, 1, UNITE_HR.HEADERS.length).setValues([UNITE_HR.HEADERS]);
  return sheet;
}

function ensureDirectorySheet_(ss) {
  let sheet = ss.getSheetByName(UNITE_HR.DIRECTORY_SHEET);
  if (!sheet) sheet = ss.insertSheet(UNITE_HR.DIRECTORY_SHEET);
  return sheet;
}

function refreshOrganizationDirectory() {
  const ui = SpreadsheetApp.getUi();
  try {
    const response = callSupabaseBridge_({ action: 'sheet_pull_employees' });
    const rows = Array.isArray(response.rows) ? response.rows : [];
    writeDirectoryRows_(rows);
    ui.alert('Đã làm mới danh bạ tổ chức', `Đã sắp xếp ${rows.length} hồ sơ theo tuyến quản lý và cấp bậc.`, ui.ButtonSet.OK);
  } catch (error) {
    ui.alert('Không thể làm mới danh bạ', error.message, ui.ButtonSet.OK);
  }
}

function writeDirectoryRows_(rows) {
  const sheet = ensureDirectorySheet_(getSpreadsheet_());
  const headers = UNITE_HR.HEADERS.slice(0, 19);
  const values = rows.map((item, index) => employeeToSheetRow_(item, index).slice(0, 19));

  sheet.clear();
  if (sheet.getMaxColumns() < headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (values.length) {
    if (sheet.getMaxRows() < values.length + 1) sheet.insertRowsAfter(sheet.getMaxRows(), values.length + 1 - sheet.getMaxRows());
    sheet.getRange(2, 1, values.length, headers.length).setValues(values);
  }

  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(3);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#741f2b')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');
  sheet.getRange('A:S').setWrap(false);
  sheet.setColumnWidth(1, 90);
  sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(3, 210);
  sheet.setColumnWidths(4, 6, 135);
  sheet.setColumnWidths(10, 9, 125);
  sheet.getRange(2, 14, Math.max(values.length, 1), 3).setNumberFormat('dd/MM/yyyy');
  ensureFilterRange_(sheet, headers.length);
  applyHierarchyRowColors_(sheet, Math.max(values.length + 1, 2));
}

function restoreOrganizationOrder() {
  const sheet = ensureEmployeeSheet_(getSpreadsheet_());
  const lastRow = sheet.getLastRow();
  if (lastRow <= 2) return;
  sheet.getRange(2, 1, lastRow - 1, UNITE_HR.HEADERS.length).sort([
    { column: 27, ascending: true },
    { column: 26, ascending: true },
    { column: 28, ascending: true },
    { column: 3, ascending: true }
  ]);
  const sequence = Array.from({ length: lastRow - 1 }, (_, index) => [index + 1]);
  sheet.getRange(2, 1, sequence.length, 1).setValues(sequence);
  SpreadsheetApp.getUi().alert('Đã khôi phục thứ tự tổ chức từ Ban lãnh đạo xuống nhân viên.');
}

function toggleTechnicalColumns() {
  const sheet = ensureEmployeeSheet_(getSpreadsheet_());
  const first = 20;
  const count = UNITE_HR.HEADERS.length - first + 1;
  if (sheet.isColumnHiddenByUser(first)) sheet.showColumns(first, count);
  else sheet.hideColumns(first, count);
}

function ensureFilterRange_(sheet, columnCount) {
  const lastRow = Math.max(sheet.getLastRow(), 2);
  const current = sheet.getFilter();
  if (current) {
    const range = current.getRange();
    if (range.getColumn() === 1 && range.getNumColumns() === columnCount && range.getNumRows() >= lastRow) return;
    current.remove();
  }
  sheet.getRange(1, 1, lastRow, columnCount).createFilter();
}

function applyHierarchyRowColors_(sheet, lastRow) {
  if (lastRow <= 1) return;
  const dataRange = sheet.getRange(2, 1, lastRow - 1, Math.min(19, sheet.getMaxColumns()));
  const rules = sheet.getConditionalFormatRules().filter(rule => {
    const ranges = rule.getRanges();
    return !ranges.some(range => range.getSheet().getName() === sheet.getName());
  });
  rules.push(
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$S2="Ban lãnh đạo"').setBackground('#f8e7eb').setBold(true).setRanges([dataRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$S2="Quản lý phòng ban"').setBackground('#fff5df').setRanges([dataRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$S2="Quản lý khu vực"').setBackground('#eaf4ff').setRanges([dataRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$S2="Quản lý chi nhánh"').setBackground('#edf8f1').setRanges([dataRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$S2="Leader"').setBackground('#f2effc').setRanges([dataRange]).build()
  );
  sheet.setConditionalFormatRules(rules);
}

function ensureConfigSheet_(ss, rootFolderId) {
  let sheet = ss.getSheetByName(UNITE_HR.CONFIG_SHEET);
  if (!sheet) sheet = ss.insertSheet(UNITE_HR.CONFIG_SHEET);
  const props = PropertiesService.getScriptProperties();
  const rows = [
    ['THAM SỐ', 'GIÁ TRỊ', 'GHI CHÚ'],
    ['SHEET_ID', UNITE_HR.SHEET_ID, 'Google Sheet quản trị HR'],
    ['SUPABASE_FUNCTION_URL', UNITE_HR.SUPABASE_FUNCTION_URL, 'Edge Function trung gian'],
    ['DRIVE_ROOT_FOLDER_ID', rootFolderId, 'Thư mục gốc UNITE HR'],
    ['HR_VIEWER_EMAILS', props.getProperty('HR_VIEWER_EMAILS') || '', 'Danh sách email HR, cách nhau bằng dấu phẩy'],
    ['INTEGRATION_SECRET', props.getProperty('INTEGRATION_SECRET') || '', 'Không chia sẻ công khai']
  ];
  sheet.clear();
  sheet.getRange(1, 1, rows.length, 3).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 3);
  sheet.hideRows(6);
  return sheet;
}

function ensureLogSheet_(ss) {
  let sheet = ss.getSheetByName(UNITE_HR.LOG_SHEET);
  if (!sheet) sheet = ss.insertSheet(UNITE_HR.LOG_SHEET);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Thời gian', 'Loại', 'Trạng thái', 'Tổng', 'Thành công', 'Lỗi', 'Chi tiết']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function applyEmployeeSheetFormatting_(sheet) {
  if (!sheet) return;
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(3);
  sheet.getRange(1, 1, 1, UNITE_HR.HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#741f2b')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');
  sheet.getRange('A:S').setWrap(false);
  sheet.setColumnWidth(1, 90);
  sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(3, 210);
  sheet.setColumnWidths(4, 6, 135);
  sheet.setColumnWidths(10, 9, 125);
  if (sheet.getMaxColumns() >= UNITE_HR.HEADERS.length) {
    sheet.hideColumns(20, UNITE_HR.HEADERS.length - 19);
  }

  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['active', 'resigned', 'reserved', 'unknown'], true)
    .setAllowInvalid(false)
    .build();
  const qualityRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['ok', 'needs_review', 'invalid'], true)
    .setAllowInvalid(false)
    .build();
  if (sheet.getMaxRows() > 1) {
    sheet.getRange(2, 17, sheet.getMaxRows() - 1, 1).setDataValidation(statusRule);
    sheet.getRange(2, 18, sheet.getMaxRows() - 1, 1).setDataValidation(qualityRule);
    sheet.getRange(2, 14, sheet.getMaxRows() - 1, 3).setNumberFormat('dd/MM/yyyy');
    sheet.getRange(2, 2, sheet.getMaxRows() - 1, 1).setNote('Mã nhân sự là khóa duy nhất. Khi đổi mã, hệ thống sẽ kiểm tra trùng trước khi đồng bộ.');
  }

  // Filter phải bao gồm cả cột kỹ thuật ẩn. Nếu chỉ lọc A:Q, dữ liệu hiển thị
  // sẽ bị tách khỏi employee_id và có thể cập nhật nhầm hồ sơ.
  ensureFilterRange_(sheet, UNITE_HR.HEADERS.length);
  applyHierarchyRowColors_(sheet, Math.max(sheet.getLastRow(), 2));
}

function employeeToSheetRow_(item, index) {
  return [
    Number(index || 0) + 1,
    item.employee_code || '', item.full_name || '', item.department || '', item.area || '', item.branch || '', item.team || '',
    item.title || '', item.employment_level || '', item.employment_type || '', item.work_email || '', item.personal_email || '',
    item.phone || '', toSheetDate_(item.start_date), toSheetDate_(item.official_date), toSheetDate_(item.end_date),
    item.employment_status || 'unknown', item.data_quality || 'needs_review', item.hierarchy_label || '',
    item.id || '', Number(item.sync_version || 1), item.updated_at || '', 'SYNCED', '',
    item.original_employee_code || item.employee_code || '', item.org_sort_key || '', Number(item.hierarchy_rank || 900),
    Number(item.source_row_order || item.source_row || 999999)
  ];
}

function sheetRowToEmployee_(sheet, row) {
  const values = sheet.getRange(row, 1, 1, UNITE_HR.HEADERS.length).getValues()[0];
  return {
    employee_code: nullableString_(values[1]),
    full_name: nullableString_(values[2]),
    department: nullableString_(values[3]),
    area: nullableString_(values[4]),
    branch: nullableString_(values[5]),
    team: nullableString_(values[6]),
    title: nullableString_(values[7]),
    employment_level: nullableString_(values[8]),
    employment_type: nullableString_(values[9]),
    work_email: nullableString_(values[10]),
    personal_email: nullableString_(values[11]),
    phone: nullableString_(values[12]),
    start_date: dateToIso_(values[13]),
    official_date: dateToIso_(values[14]),
    end_date: dateToIso_(values[15]),
    employment_status: nullableString_(values[16]) || 'unknown',
    data_quality: nullableString_(values[17]) || 'needs_review',
    employee_id: nullableString_(values[19]),
    sync_version: Number(values[20] || 0),
    original_employee_code: nullableString_(values[24])
  };
}

function writeSyncLog_(type, status, total, success, failed, details) {
  try {
    const sheet = ensureLogSheet_(getSpreadsheet_());
    sheet.appendRow([new Date(), type, status, total || 0, success || 0, failed || 0, JSON.stringify(details || {})]);
  } catch (error) {
    console.error(error);
  }
}

function getOrCreateRootFolder_() {
  const props = PropertiesService.getScriptProperties();
  const existingId = props.getProperty('DRIVE_ROOT_FOLDER_ID');
  if (existingId) {
    try { return DriveApp.getFolderById(existingId); }
    catch (error) { console.warn('Root folder cũ không còn truy cập được.'); }
  }
  const folders = DriveApp.getFoldersByName(UNITE_HR.ROOT_FOLDER_NAME);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(UNITE_HR.ROOT_FOLDER_NAME);
  props.setProperty('DRIVE_ROOT_FOLDER_ID', folder.getId());
  return folder;
}

function getOrCreateChildFolder_(parent, name) {
  const folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : parent.createFolder(name);
}

function getViewerEmails_() {
  const raw = PropertiesService.getScriptProperties().getProperty('HR_VIEWER_EMAILS') || '';
  return raw.split(/[;,\n]+/).map(item => item.trim()).filter(Boolean);
}

function createSecret_() {
  const seed = `${Utilities.getUuid()}-${Utilities.getUuid()}-${new Date().getTime()}`;
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed)).replace(/=+$/g, '');
}

function jsonOutput_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function sanitizeFileName_(value) {
  return String(value || 'file').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 160) || 'file';
}

function sanitizeFolderName_(value) {
  return String(value || 'HO_SO_HR').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100) || 'HO_SO_HR';
}

function uniqueStrings_(values) {
  const seen = {};
  return values.filter(value => {
    const key = String(value || '').toLowerCase();
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function nullableString_(value) {
  const result = String(value == null ? '' : value).trim();
  return result || null;
}

function toSheetDate_(value) {
  if (!value) return '';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return isNaN(date.getTime()) ? '' : date;
}

function dateToIso_(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
  }
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return null;
}

function createRowNumbers_(start, end) {
  const rows = [];
  for (let row = start; row <= end; row++) rows.push(row);
  return rows;
}

function chunk_(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}
