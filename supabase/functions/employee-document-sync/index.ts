import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function privilegedKey() {
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

function clean(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function ascii(value: unknown) {
  return clean(value)
    .replace(/[đĐ]/g, "d")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}

const NOISE = new Set([
  "cccd", "cmnd", "can", "cuoc", "cong", "dan", "mat", "truoc", "sau", "front", "back",
  "chan", "dung", "portrait", "avatar", "anh", "hinh", "tong", "ho", "so", "hoso", "scan",
  "document", "doc", "docx", "google", "drive", "file", "img", "image", "photo", "copy", "ban",
  "trich", "tu", "the", "moi", "cu", "nhan", "vien"
]);

function normalizedSearchText(value: unknown) {
  return ascii(value)
    .replace(/\.[a-z0-9]{1,6}$/i, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameKey(value: unknown) {
  return normalizedSearchText(value)
    .split(" ")
    .filter((token) => token && !NOISE.has(token) && !/^\d+$/.test(token))
    .join(" ");
}

function codeKey(value: unknown) {
  return ascii(value).replace(/[^a-z0-9]/g, "").toUpperCase();
}

function tokens(value: string) {
  return value.split(" ").filter(Boolean);
}

function diceCoefficient(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const pairs = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const pair = a.slice(i, i + 2);
    pairs.set(pair, (pairs.get(pair) || 0) + 1);
  }
  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const pair = b.slice(i, i + 2);
    const count = pairs.get(pair) || 0;
    if (count > 0) {
      intersection++;
      pairs.set(pair, count - 1);
    }
  }
  return (2 * intersection) / (a.length + b.length - 2);
}

type Employee = {
  id: string;
  employee_code: string | null;
  full_name: string;
  employment_status: string;
  code_key: string;
  name_key: string;
};

type DriveFile = {
  driveFileId?: string;
  parentDriveFileId?: string | null;
  driveFolderId?: string | null;
  driveViewUrl?: string | null;
  driveThumbnailUrl?: string | null;
  fileName?: string;
  parentFileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  sourceFolder?: string;
  sourceKind?: string;
  isExtracted?: boolean;
  textExcerpt?: string;
  imageIndex?: number;
  updatedAt?: string;
  description?: string;
  error?: string;
  [key: string]: unknown;
};

function containsWhole(text: string, candidate: string) {
  if (!candidate) return false;
  return (` ${text} `).includes(` ${candidate} `);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function codeVariants(value: string) {
  const raw = codeKey(value).toLowerCase();
  const variants = new Set<string>();
  if (raw) variants.add(raw);
  const match = raw.match(/^(tvu|u)(\d{2,6})$/);
  if (match) {
    variants.add(`u${match[2]}`);
    variants.add(`tvu${match[2]}`);
  }
  return [...variants].filter((item) => item.length >= 4);
}

function codeMatchesText(code: string, normalized: string, compact: string) {
  for (const variant of codeVariants(code)) {
    const match = variant.match(/^([a-z]+)(\d+)$/);
    if (match) {
      const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(match[1])}\\s*${escapeRegExp(match[2])}([^a-z0-9]|$)`);
      if (pattern.test(normalized)) return true;
    }
    const compactPattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(variant)}([^a-z0-9]|$)`);
    if (compactPattern.test(compact)) return true;
  }
  return false;
}

function preferredEmployee(employees: Employee[]) {
  return [...employees].sort((a, b) =>
    Number(a.employment_status !== "active") - Number(b.employment_status !== "active") ||
    Number(!a.employee_code) - Number(!b.employee_code) ||
    a.name_key.localeCompare(b.name_key)
  )[0];
}

function classifyDocument(file: DriveFile) {
  const sourceKind = String(file.sourceKind || "mixed").toLowerCase();
  const mime = String(file.mimeType || "").toLowerCase();
  const text = normalizedSearchText(`${file.fileName || ""} ${file.parentFileName || ""} ${file.sourceFolder || ""}`);
  const isImage = mime.startsWith("image/") || Boolean(file.isExtracted);
  const isDoc = mime.includes("wordprocessingml") || mime.includes("google-apps.document") || /\bdocx?\b/.test(text);

  if (/\b(hop dong|contract)\b/.test(text)) return "contract";
  if (/\b(chung chi|bang cap|certificate)\b/.test(text)) return "certificate";
  if (sourceKind === "portrait") return isImage ? "portrait" : "employee_dossier";
  if (sourceKind === "cccd") {
    if (/\b(mat truoc|truoc|front)\b/.test(text)) return "citizen_id_front";
    if (/\b(mat sau|sau|back)\b/.test(text)) return "citizen_id_back";
    return isImage ? "citizen_id_combined" : "employee_dossier";
  }
  if (/\b(chan dung|portrait|avatar|hinh tong|anh tong)\b/.test(text)) return "portrait";
  if (/\b(cccd|cmnd|can cuoc)\b/.test(text)) {
    if (/\b(mat truoc|truoc|front)\b/.test(text)) return "citizen_id_front";
    if (/\b(mat sau|sau|back)\b/.test(text)) return "citizen_id_back";
    return "citizen_id_combined";
  }
  if (file.isExtracted) return "docx_image";
  if (isDoc) return "employee_dossier";
  return "other";
}

type MatchIndexes = {
  byCode: Map<string, Employee[]>;
  byName: Map<string, Employee[]>;
  employees: Employee[];
};

function buildMatchIndexes(employees: Employee[]): MatchIndexes {
  const byCode = new Map<string, Employee[]>();
  const byName = new Map<string, Employee[]>();
  for (const employee of employees) {
    if (employee.code_key) {
      const key = employee.code_key.toLowerCase();
      byCode.set(key, [...(byCode.get(key) || []), employee]);
    }
    if (employee.name_key) byName.set(employee.name_key, [...(byName.get(employee.name_key) || []), employee]);
  }
  return { byCode, byName, employees };
}

function matchFile(file: DriveFile, indexes: MatchIndexes) {
  const fileText = normalizedSearchText(`${file.fileName || ""} ${file.parentFileName || ""}`);
  const docText = normalizedSearchText(file.textExcerpt || "");
  const combined = `${fileText} ${docText}`.trim();
  const compact = combined.replace(/\s+/g, "");
  const combinedTokens = new Set(combined.split(" ").filter(Boolean));

  const codeMatches = new Map<string, Employee>();
  for (const [code, found] of indexes.byCode.entries()) {
    if (!combinedTokens.has(code) && !codeMatchesText(code, combined, compact)) continue;
    for (const employee of found || []) codeMatches.set(employee.id, employee);
  }

  const nameHits: Array<{ key: string; employees: Employee[] }> = [];
  for (const [key, found] of indexes.byName.entries()) {
    if (key.length >= 4 && containsWhole(combined, key)) nameHits.push({ key, employees: found });
  }
  const nameMatches = new Map<string, Employee>();
  if (nameHits.length) {
    const maxTokens = Math.max(...nameHits.map((item) => tokens(item.key).length));
    const maxLength = Math.max(...nameHits.filter((item) => tokens(item.key).length === maxTokens).map((item) => item.key.length));
    for (const hit of nameHits) {
      if (tokens(hit.key).length !== maxTokens || hit.key.length !== maxLength) continue;
      for (const employee of hit.employees) nameMatches.set(employee.id, employee);
    }
  }

  const codeList = [...codeMatches.values()];
  const nameList = [...nameMatches.values()];
  if (codeList.length === 1) {
    const employee = codeList[0];
    const nameAlso = nameMatches.has(employee.id);
    return {
      employee,
      method: nameAlso ? "employee_code_and_name" : docText.split(" ").includes(employee.code_key.toLowerCase()) ? "doc_text_employee_code" : "employee_code",
      confidence: nameAlso ? 100 : 98,
      status: "verified",
      candidates: [employee.id]
    };
  }
  if (codeList.length > 1) {
    const activeList = codeList.filter((employee) => employee.employment_status === "active");
    if (activeList.length === 1) {
      return { employee: activeList[0], method: "employee_code", confidence: 96, status: "verified", candidates: codeList.slice(0, 8).map((item) => item.id) };
    }
    return { employee: preferredEmployee(codeList) || null, method: "employee_code", confidence: 75, status: "pending", candidates: codeList.slice(0, 8).map((item) => item.id) };
  }
  if (nameList.length === 1) {
    const employee = nameList[0];
    return {
      employee,
      method: docText.includes(employee.name_key) && !fileText.includes(employee.name_key) ? "doc_text_full_name" : "full_name_unique",
      confidence: 92,
      status: "verified",
      candidates: [employee.id]
    };
  }
  if (nameList.length > 1) {
    const activeList = nameList.filter((employee) => employee.employment_status === "active");
    if (activeList.length === 1) {
      return { employee: activeList[0], method: "full_name_unique", confidence: 94, status: "verified", candidates: nameList.slice(0, 8).map((item) => item.id) };
    }
    return { employee: preferredEmployee(nameList) || null, method: "full_name_unique", confidence: 70, status: "pending", candidates: nameList.slice(0, 8).map((item) => item.id) };
  }

  const useful = nameKey(fileText);
  const usefulTokens = new Set(tokens(useful));
  if (usefulTokens.size >= 2) {
    // Chỉ so gần đúng với tên có ít nhất một token chung để giảm CPU đáng kể.
    const candidates = indexes.employees.filter((employee) => tokens(employee.name_key).some((token) => usefulTokens.has(token)));
    const scored = candidates
      .map((employee) => ({ employee, score: diceCoefficient(useful, employee.name_key) }))
      .filter((item) => item.score >= 0.72)
      .sort((a, b) => b.score - a.score);
    if (scored.length) {
      const top = scored[0];
      const second = scored[1]?.score || 0;
      const safeSuggestion = top.score >= 0.86 && top.score - second >= 0.08;
      return {
        employee: safeSuggestion ? top.employee : null,
        method: "fuzzy_suggestion",
        confidence: Math.round(top.score * 10000) / 100,
        status: "pending",
        candidates: scored.slice(0, 5).map((item) => item.employee.id)
      };
    }
  }
  return { employee: null, method: "unmatched", confidence: 0, status: "unmatched", candidates: [] as string[] };
}

async function callAppsScript(payload: Record<string, unknown>) {
  const url = Deno.env.get("GOOGLE_APPS_SCRIPT_URL") || Deno.env.get("GOOGLE_APPS_SCRIPT_WEBAPP_URL") || Deno.env.get("GOOGLE_WORKSPACE_WEBAPP_URL") || Deno.env.get("APPS_SCRIPT_WEBAPP_URL") || Deno.env.get("APPS_SCRIPT_URL") || "";
  const secret = Deno.env.get("INTEGRATION_SECRET") || Deno.env.get("GOOGLE_WORKSPACE_INTEGRATION_SECRET") || Deno.env.get("GOOGLE_WORKSPACE_SECRET") || "";
  if (!url || !secret) throw new Error("Thiếu GOOGLE_APPS_SCRIPT_URL hoặc INTEGRATION_SECRET trong Supabase Secrets.");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, integrationSecret: secret })
  });
  const text = await response.text();
  let body: Record<string, unknown>;
  try { body = text ? JSON.parse(text) : {}; }
  catch { throw new Error(`Apps Script không trả JSON hợp lệ: ${text.slice(0, 250)}`); }
  if (!response.ok || body.ok === false) throw new Error(String(body.message || body.error || `Apps Script trả lỗi ${response.status}`));
  return body;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ message: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = privilegedKey();
  if (!url || !key) return json({ message: "Thiếu biến môi trường Supabase." }, 500);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ message: "Thiếu access token." }, 401);

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json({ message: "Phiên đăng nhập không hợp lệ." }, 401);

  const { data: caller } = await admin.from("profiles").select("role_type,status").eq("id", userData.user.id).single();
  if (!caller || caller.status !== "active" || !["HR", "ADMIN", "SUPER_ADMIN"].includes(caller.role_type)) {
    return json({ message: "Chỉ HR/Admin/Super Admin được quản lý hồ sơ tài liệu." }, 403);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ message: "JSON body không hợp lệ." }, 400); }

  const action = clean(body.action || "scan").toLowerCase();
  if (action === "health") return json({ ok: true, service: "employee-document-sync-v40.1" });
  if (action !== "scan") return json({ message: "Action không được hỗ trợ." }, 422);

  const { data: settings } = await admin.from("hr_document_settings").select("*").eq("id", "default").maybeSingle();
  const sourceKind = clean(body.source_kind || body.sourceKind || "mixed").toLowerCase();
  const folderId = clean(body.folder_id || body.folderId || (
    sourceKind === "cccd" ? settings?.cccd_folder_id : sourceKind === "portrait" ? settings?.portrait_folder_id : settings?.other_folder_id
  ));
  if (!folderId) return json({ message: `Chưa cấu hình thư mục ${sourceKind}.` }, 422);

  const forceRematch = Boolean(body.force_rematch || body.force_rescan);
  const skipKnown = body.skip_known !== false && !forceRematch;
  let skipFileIds: string[] = [];
  if (skipKnown) {
    const { data: knownRows } = await admin.from("employee_documents")
      .select("drive_file_id")
      .eq("source_kind", ["cccd", "portrait", "mixed", "other"].includes(sourceKind) ? sourceKind : "mixed")
      .not("drive_file_id", "is", null)
      .limit(10000);
    skipFileIds = (knownRows || []).map((row) => clean(row.drive_file_id)).filter(Boolean);
  }

  const requestedBatch = Number(body.max_files || body.maxFiles || 80);
  const batchSize = Math.min(Math.max(Number.isFinite(requestedBatch) ? requestedBatch : 80, 10), 150);
  const appsResult = await callAppsScript({
    action: "scan_employee_documents",
    folderId,
    sourceKind,
    recursive: body.recursive ?? settings?.scan_recursive ?? true,
    extractDocxImages: body.extract_docx_images ?? settings?.extract_docx_images ?? true,
    maxFiles: batchSize,
    skipFileIds
  });

  const files = Array.isArray(appsResult.files) ? appsResult.files as DriveFile[] : [];
  if (!files.length) {
    return json({
      ok: true, folder_id: folderId, source_kind: sourceKind, total: 0,
      inserted: 0, updated: 0, verified: 0, pending: 0, unmatched: 0, errors: 0,
      skipped_known: Number((appsResult.stats as Record<string, unknown> | undefined)?.skipped || 0),
      truncated: Boolean(appsResult.truncated), done: true, apps_script_stats: appsResult.stats || null, preview: []
    });
  }

  const { data: employeeRows, error: employeeError } = await admin.from("employees")
    .select("id,employee_code,full_name,employment_status")
    .not("full_name", "is", null)
    .limit(5000);
  if (employeeError) return json({ message: employeeError.message }, 500);

  const employees: Employee[] = (employeeRows || []).map((employee) => ({
    ...employee,
    code_key: codeKey(employee.employee_code),
    name_key: nameKey(employee.full_name)
  }));
  const indexes = buildMatchIndexes(employees);

  const driveIds = files.map((file) => clean(file.driveFileId)).filter(Boolean);
  const { data: existingRows } = driveIds.length
    ? await admin.from("employee_documents")
      .select("id,drive_file_id,match_method,verification_status,employee_id,is_primary,match_confidence,candidate_employee_ids,matched_by,verified_by,verified_at")
      .in("drive_file_id", driveIds)
    : { data: [] as Record<string, unknown>[] };
  const existingMap = new Map((existingRows || []).map((row) => [clean(row.drive_file_id), row]));

  let inserted = 0;
  let updated = 0;
  let errors = 0;
  const payloads: Record<string, unknown>[] = [];
  const preview: Record<string, unknown>[] = [];

  for (const file of files) {
    try {
      const driveFileId = clean(file.driveFileId);
      const fileName = clean(file.fileName) || "Không tên";
      if (!driveFileId) { errors++; continue; }
      const existing = existingMap.get(driveFileId) as Record<string, unknown> | undefined;
      const match = matchFile(file, indexes);
      const documentType = classifyDocument(file);
      const preserveManual = existing && existing.match_method === "manual" && !forceRematch;
      const payload: Record<string, unknown> = {
        drive_file_id: driveFileId,
        parent_drive_file_id: clean(file.parentDriveFileId) || null,
        drive_folder_id: clean(file.driveFolderId) || null,
        drive_view_url: clean(file.driveViewUrl) || `https://drive.google.com/open?id=${encodeURIComponent(driveFileId)}`,
        drive_thumbnail_url: clean(file.driveThumbnailUrl) || `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveFileId)}&sz=w800`,
        file_name: fileName,
        normalized_file_name: normalizedSearchText(fileName),
        mime_type: clean(file.mimeType) || null,
        size_bytes: Number(file.sizeBytes || 0) || null,
        source_folder: clean(file.sourceFolder) || null,
        source_kind: ["cccd", "portrait", "mixed", "other"].includes(sourceKind) ? sourceKind : "mixed",
        is_extracted: Boolean(file.isExtracted),
        document_type: documentType,
        last_scanned_at: new Date().toISOString(),
        metadata: {
          text_excerpt: clean(file.textExcerpt).slice(0, 6000) || null,
          parent_file_name: clean(file.parentFileName) || null,
          image_index: Number(file.imageIndex || 0) || null,
          updated_at_drive: clean(file.updatedAt) || null,
          drive_description: clean(file.description) || null,
          scan_error: clean(file.error) || null,
          matcher_name_key: nameKey(`${file.fileName || ""} ${file.parentFileName || ""}`)
        }
      };
      if (preserveManual) {
        payload.employee_id = existing?.employee_id || null;
        payload.match_method = existing?.match_method || "manual";
        payload.match_confidence = existing?.match_confidence || 100;
        payload.verification_status = existing?.verification_status || "verified";
        payload.candidate_employee_ids = existing?.candidate_employee_ids || [];
        payload.matched_by = existing?.matched_by || userData.user.id;
        payload.verified_by = existing?.verified_by || userData.user.id;
        payload.verified_at = existing?.verified_at || new Date().toISOString();
        payload.is_primary = Boolean(existing?.is_primary);
      } else {
        payload.employee_id = match.employee?.id || null;
        payload.match_method = match.method;
        payload.match_confidence = match.confidence;
        payload.verification_status = match.status;
        payload.candidate_employee_ids = match.candidates;
        payload.matched_by = userData.user.id;
        payload.verified_by = match.status === "verified" ? userData.user.id : null;
        payload.verified_at = match.status === "verified" ? new Date().toISOString() : null;
        payload.is_primary = Boolean(existing?.is_primary);
      }
      payloads.push(payload);
      if (existing) updated++; else inserted++;
    } catch (error) {
      errors++;
      if (preview.length < 100) preview.push({ file_name: file.fileName, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const savedRows: Record<string, unknown>[] = [];
  for (let i = 0; i < payloads.length; i += 50) {
    const chunk = payloads.slice(i, i + 50);
    const { data, error } = await admin.from("employee_documents")
      .upsert(chunk, { onConflict: "drive_file_id" })
      .select("id,employee_id,document_type,verification_status,match_method,match_confidence,file_name,drive_file_id");
    if (error) {
      errors += chunk.length;
      for (const item of chunk.slice(0, Math.max(0, 100 - preview.length))) preview.push({ file_name: item.file_name, error: error.message });
    } else savedRows.push(...(data || []));
  }

  const verified = savedRows.filter((row) => row.verification_status === "verified").length;
  const pending = savedRows.filter((row) => row.verification_status === "pending").length;
  const unmatched = savedRows.filter((row) => row.verification_status === "unmatched").length;
  preview.push(...savedRows.slice(0, Math.max(0, 100 - preview.length)));

  await admin.from("activity_logs").insert({
    actor_id: userData.user.id,
    action_type: "scan_batch",
    entity_type: "employee_documents",
    entity_id: folderId,
    payload: { source_kind: sourceKind, batch_size: batchSize, total: files.length, inserted, updated, verified, pending, unmatched, errors, skipped_known: skipFileIds.length }
  });

  return json({
    ok: true,
    folder_id: folderId,
    source_kind: sourceKind,
    total: files.length,
    inserted,
    updated,
    verified,
    pending,
    unmatched,
    errors,
    skipped_known: Number((appsResult.stats as Record<string, unknown> | undefined)?.skipped || 0),
    truncated: Boolean(appsResult.truncated),
    done: !Boolean(appsResult.truncated),
    apps_script_stats: appsResult.stats || null,
    preview
  });
});
