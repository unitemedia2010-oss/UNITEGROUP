import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

const ALLOWED_UPLOAD_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function readPrivilegedKey() {
  const named = Deno.env.get("SUPABASE_SECRET_KEY");
  if (named) return named;
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.default === "string" && parsed.default) return parsed.default;
      const first = Object.values(parsed).find((value) => typeof value === "string" && value);
      if (typeof first === "string") return first;
    } catch {
      // Fall through.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

function readPublicKey() {
  return Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
}

function clean(value: unknown) {
  const result = String(value ?? "").trim();
  return result || null;
}

function base64Bytes(base64: string) {
  const normalized = base64.replace(/^data:[^;]+;base64,/, "");
  return Math.floor(normalized.length * 3 / 4);
}

async function fetchAllEmployees(admin: ReturnType<typeof createClient>) {
  const rows: Record<string, unknown>[] = [];
  const pageSize = 800;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from("employees")
      .select("id,employee_code,full_name,work_email,personal_email,phone,department,area,branch,team,title,employment_level,employment_type,start_date,official_date,end_date,employment_status,data_quality,sync_version,updated_at,source_row,source_row_order,department_rank,hierarchy_rank,hierarchy_level,hierarchy_label,org_sort_key,original_employee_code")
      .order("department_rank", { ascending: true })
      .order("hierarchy_rank", { ascending: true })
      .order("area", { ascending: true, nullsFirst: false })
      .order("branch", { ascending: true, nullsFirst: false })
      .order("team", { ascending: true, nullsFirst: false })
      .order("source_row_order", { ascending: true, nullsFirst: false })
      .order("full_name", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function callAppsScript(payload: Record<string, unknown>) {
  const url = Deno.env.get("GOOGLE_APPS_SCRIPT_URL") || "";
  const secret = Deno.env.get("GOOGLE_WORKSPACE_SHARED_SECRET") || "";
  if (!url || !secret) throw new Error("Chưa cấu hình GOOGLE_APPS_SCRIPT_URL hoặc GOOGLE_WORKSPACE_SHARED_SECRET.");

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, integrationSecret: secret }),
    redirect: "follow"
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try { body = text ? JSON.parse(text) : {}; }
  catch { body = { message: text }; }
  if (!response.ok || body.ok === false) {
    throw new Error(String(body.message || body.error || `Apps Script trả lỗi ${response.status}`));
  }
  return body;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ message: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const privilegedKey = readPrivilegedKey();
  const publicKey = readPublicKey();
  if (!supabaseUrl || !privilegedKey) return json({ message: "Thiếu cấu hình Supabase trong Edge Function." }, 500);

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ message: "JSON body không hợp lệ." }, 400); }

  const action = String(body.action || "");
  const sharedSecret = Deno.env.get("GOOGLE_WORKSPACE_SHARED_SECRET") || "";
  const isScriptRequest = Boolean(sharedSecret && String(body.integrationSecret || "") === sharedSecret);

  const admin = createClient(supabaseUrl, privilegedKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  if (action === "health") {
    return json({ ok: true, service: "google-workspace-bridge", appsScriptConfigured: Boolean(Deno.env.get("GOOGLE_APPS_SCRIPT_URL")) });
  }

  if (action === "sheet_pull_employees") {
    if (!isScriptRequest) return json({ message: "Integration secret không hợp lệ." }, 401);
    try {
      const rows = await fetchAllEmployees(admin);
      await admin.from("workspace_sync_logs").insert({
        sync_type: "sheet_pull", status: "completed", total_rows: rows.length,
        success_rows: rows.length, completed_at: new Date().toISOString()
      });
      return json({ ok: true, rows, total: rows.length });
    } catch (error) {
      return json({ message: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  if (action === "sheet_push_employees") {
    if (!isScriptRequest) return json({ message: "Integration secret không hợp lệ." }, 401);
    const incoming = Array.isArray(body.rows) ? body.rows as Record<string, unknown>[] : [];
    if (!incoming.length || incoming.length > 100) return json({ message: "Mỗi lần đồng bộ cần từ 1 đến 100 dòng." }, 422);

    const allowedFields = [
      "employee_code", "full_name", "work_email", "personal_email", "phone",
      "department", "area", "branch", "team", "title", "employment_level",
      "employment_type", "start_date", "official_date", "end_date",
      "employment_status", "data_quality"
    ];
    const results: Record<string, unknown>[] = [];
    let success = 0;
    let failed = 0;

    for (const item of incoming) {
      const id = clean(item.employee_id);
      const expectedVersion = Number(item.sync_version || 0);
      if (!id) {
        failed++;
        results.push({ ok: false, message: "Thiếu employee_id." });
        continue;
      }
      const { data: existing, error: lookupError } = await admin
        .from("employees").select("id,sync_version,employee_code").eq("id", id).maybeSingle();
      if (lookupError || !existing) {
        failed++;
        results.push({ ok: false, employee_id: id, message: lookupError?.message || "Không tìm thấy nhân sự." });
        continue;
      }
      if (expectedVersion && Number(existing.sync_version) !== expectedVersion) {
        failed++;
        results.push({ ok: false, employee_id: id, conflict: true, current_version: existing.sync_version, message: "Dữ liệu trên hệ thống đã thay đổi. Hãy làm mới Sheet." });
        continue;
      }

      const originalEmployeeCode = clean(item.original_employee_code);
      const currentEmployeeCode = clean(existing.employee_code);
      if (originalEmployeeCode && currentEmployeeCode && originalEmployeeCode.toLowerCase() !== currentEmployeeCode.toLowerCase()) {
        failed++;
        results.push({
          ok: false,
          employee_id: id,
          conflict: true,
          message: "Dòng Sheet đã bị lệch khỏi employee_id sau khi lọc/sắp xếp. Hãy chạy Làm mới nhân sự từ Supabase trước khi sửa tiếp."
        });
        continue;
      }

      const patch: Record<string, unknown> = { sheet_synced_at: new Date().toISOString() };
      for (const field of allowedFields) {
        if (Object.prototype.hasOwnProperty.call(item, field)) patch[field] = clean(item[field]);
      }
      if (!patch.full_name) {
        failed++;
        results.push({ ok: false, employee_id: id, message: "Họ tên không được để trống." });
        continue;
      }
      if (!new Set(["active", "resigned", "reserved", "unknown"]).has(String(patch.employment_status || "unknown"))) patch.employment_status = "unknown";
      if (!new Set(["ok", "needs_review", "invalid"]).has(String(patch.data_quality || "needs_review"))) patch.data_quality = "needs_review";

      const requestedCode = clean(patch.employee_code);
      if (requestedCode && (!currentEmployeeCode || requestedCode.toLowerCase() !== currentEmployeeCode.toLowerCase())) {
        const { data: duplicate, error: duplicateError } = await admin
          .from("employees")
          .select("id,full_name,employee_code")
          .ilike("employee_code", requestedCode)
          .neq("id", id)
          .limit(1)
          .maybeSingle();
        if (duplicateError) {
          failed++;
          results.push({ ok: false, employee_id: id, message: duplicateError.message });
          continue;
        }
        if (duplicate) {
          failed++;
          results.push({
            ok: false,
            employee_id: id,
            message: `Mã nhân sự ${requestedCode} đang thuộc hồ sơ ${duplicate.full_name || duplicate.id}. Hãy dùng mã khác hoặc làm mới Sheet.`
          });
          continue;
        }
      }

      const { data: updated, error: updateError } = await admin
        .from("employees")
        .update(patch)
        .eq("id", id)
        .select("id,employee_code,sync_version,updated_at,hierarchy_rank,hierarchy_label,org_sort_key,source_row_order")
        .single();
      if (updateError) {
        failed++;
        results.push({ ok: false, employee_id: id, message: updateError.message });
      } else {
        success++;
        results.push({
          ok: true,
          employee_id: id,
          employee_code: updated.employee_code,
          sync_version: updated.sync_version,
          updated_at: updated.updated_at,
          hierarchy_rank: updated.hierarchy_rank,
          hierarchy_label: updated.hierarchy_label,
          org_sort_key: updated.org_sort_key,
          source_row_order: updated.source_row_order
        });
      }
    }

    await admin.from("workspace_sync_logs").insert({
      sync_type: "sheet_push", status: failed ? (success ? "partial" : "failed") : "completed",
      total_rows: incoming.length, success_rows: success, failed_rows: failed,
      details: { results }, completed_at: new Date().toISOString()
    });
    return json({ ok: failed === 0, success, failed, results }, failed && !success ? 422 : 200);
  }

  // Các thao tác file từ app bắt buộc có JWT của người dùng.
  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token || !publicKey) return json({ message: "Thiếu access token." }, 401);

  const userClient = createClient(supabaseUrl, publicKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return json({ message: "Phiên đăng nhập không hợp lệ." }, 401);
  const userId = authData.user.id;

  if (action === "sync_sheet_from_app") {
    const { data: profile } = await admin.from("profiles").select("role_type,status").eq("id", userId).single();
    if (!profile || profile.status !== "active" || !["HR","ADMIN","SUPER_ADMIN"].includes(profile.role_type)) {
      return json({ message: "Chỉ HR/Admin/SUPER_ADMIN được đồng bộ Google Sheet." }, 403);
    }
    try {
      const rows = await fetchAllEmployees(admin);
      const result = await callAppsScript({ action: "replace_employee_sheet", rows });
      await admin.from("workspace_sync_logs").insert({
        sync_type: "app_to_sheet", status: "completed", requested_by: userId,
        total_rows: rows.length, success_rows: rows.length,
        details: { apps_script: result }, completed_at: new Date().toISOString()
      });
      return json({ ok: true, total: rows.length });
    } catch (error) {
      return json({ message: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  if (action === "upload_case_file") {
    const caseId = clean(body.case_id);
    const messageId = clean(body.message_id);
    const fileName = clean(body.file_name);
    const mimeType = clean(body.mime_type) || "application/octet-stream";
    const base64 = String(body.base64 || "").replace(/^data:[^;]+;base64,/, "");
    if (!caseId || !fileName || !base64) return json({ message: "Thiếu thông tin file hoặc hồ sơ." }, 422);
    if (!ALLOWED_UPLOAD_TYPES.has(mimeType)) return json({ message: "Định dạng file chưa được hỗ trợ." }, 422);
    const sizeBytes = Number(body.size_bytes || base64Bytes(base64));
    if (sizeBytes > MAX_UPLOAD_BYTES) return json({ message: "File Drive hiện giới hạn 8 MB." }, 413);

    const { data: canAccess, error: accessError } = await userClient.rpc("can_access_case", { p_case_id: caseId });
    if (accessError || canAccess !== true) return json({ message: "Bạn không có quyền tải file lên hồ sơ này." }, 403);

    const { data: caseRow, error: caseError } = await admin
      .from("hr_cases").select("id,case_code,title").eq("id", caseId).single();
    if (caseError || !caseRow) return json({ message: "Không tìm thấy hồ sơ HR." }, 404);
    const { data: uploader } = await admin.from("profiles").select("email,full_name").eq("id", userId).single();

    try {
      const driveResult = await callAppsScript({
        action: "upload_case_file",
        caseId,
        caseCode: caseRow.case_code || caseId,
        caseTitle: caseRow.title || "Ho so HR",
        fileName,
        mimeType,
        sizeBytes,
        base64,
        uploaderId: userId,
        uploaderEmail: uploader?.email || authData.user.email || "",
        uploaderName: uploader?.full_name || ""
      });

      const { data: attachment, error: insertError } = await userClient
        .from("hr_case_attachments")
        .insert({
          case_id: caseId,
          message_id: messageId,
          storage_path: null,
          storage_provider: "google_drive",
          external_file_id: driveResult.fileId,
          external_folder_id: driveResult.folderId || null,
          external_url: driveResult.viewUrl || null,
          original_name: fileName,
          mime_type: mimeType,
          size_bytes: sizeBytes,
          uploaded_by: userId,
          sync_status: "ready"
        })
        .select("*")
        .single();
      if (insertError) {
        await callAppsScript({ action: "delete_file", fileId: driveResult.fileId }).catch(() => null);
        throw insertError;
      }
      await admin.from("workspace_sync_logs").insert({
        sync_type: "drive_upload", status: "completed", requested_by: userId,
        total_rows: 1, success_rows: 1, details: { case_id: caseId, file_id: driveResult.fileId },
        completed_at: new Date().toISOString()
      });
      return json({ ok: true, attachment });
    } catch (error) {
      return json({ message: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  if (action === "open_case_file") {
    const attachmentId = clean(body.attachment_id);
    if (!attachmentId) return json({ message: "Thiếu attachment_id." }, 422);
    const { data: attachment, error } = await userClient
      .from("hr_case_attachments")
      .select("id,case_id,storage_provider,external_url,external_file_id,deleted_at")
      .eq("id", attachmentId)
      .single();
    if (error || !attachment || attachment.deleted_at) return json({ message: "Không tìm thấy file." }, 404);
    const { data: canAccess } = await userClient.rpc("can_access_case", { p_case_id: attachment.case_id });
    if (canAccess !== true) return json({ message: "Bạn không có quyền mở file." }, 403);
    if (attachment.storage_provider !== "google_drive" || !attachment.external_url) return json({ message: "File này không nằm trên Google Drive." }, 422);
    return json({ ok: true, url: attachment.external_url, fileId: attachment.external_file_id });
  }

  if (action === "delete_case_file") {
    const attachmentId = clean(body.attachment_id);
    if (!attachmentId) return json({ message: "Thiếu attachment_id." }, 422);
    const { data: attachment, error } = await userClient
      .from("hr_case_attachments")
      .select("*").eq("id", attachmentId).single();
    if (error || !attachment) return json({ message: "Không tìm thấy file." }, 404);
    const { data: profile } = await admin.from("profiles").select("role_type").eq("id", userId).single();
    const canDelete = attachment.uploaded_by === userId || ["HR", "ADMIN", "SUPER_ADMIN"].includes(profile?.role_type || "");
    if (!canDelete) return json({ message: "Bạn không có quyền xóa file." }, 403);
    try {
      if (attachment.external_file_id) await callAppsScript({ action: "delete_file", fileId: attachment.external_file_id });
      const { error: updateError } = await admin.from("hr_case_attachments")
        .update({ deleted_at: new Date().toISOString(), sync_status: "deleted" })
        .eq("id", attachmentId);
      if (updateError) throw updateError;
      return json({ ok: true });
    } catch (err) {
      return json({ message: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  return json({ message: "Action không được hỗ trợ." }, 404);
});
