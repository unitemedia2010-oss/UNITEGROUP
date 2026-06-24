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
      // Use legacy key below.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

function clean(value: unknown): string | null {
  const result = String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  return result || null;
}

function normalizedKey(value: unknown): string {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("vi");
}

function titleCaseVi(value: unknown): string | null {
  const raw = clean(value)?.toLocaleLowerCase("vi");
  if (!raw) return null;
  return raw.replace(/(^|[\s(/-])([\p{L}])/gu, (_, prefix, letter) => `${prefix}${letter.toLocaleUpperCase("vi")}`);
}

const DEPARTMENT_MAP = new Map<string, string>([
  ["kinh doanh", "Kinh Doanh"], ["kế toán", "Kế Toán"], ["ke toan", "Kế Toán"],
  ["hr", "HR"], ["admin", "Admin"], ["blđ", "BLĐ"], ["bld", "BLĐ"],
  ["trợ lý", "Trợ Lý"], ["tro ly", "Trợ Lý"], ["bảo vệ", "Bảo Vệ"], ["bao ve", "Bảo Vệ"],
  ["central real", "Central Real"], ["marketing", "Marketing"]
]);
const AREA_MAP = new Map<string, string>([
  ["tinh hoa", "Tinh Hoa"], ["kỳ tài", "Kỳ Tài"], ["ky tai", "Kỳ Tài"],
  ["tiên phong", "Tiên Phong"], ["tien phong", "Tiên Phong"], ["khai phá", "Khai Phá"],
  ["khai pha", "Khai Phá"], ["bức phá", "Bức Phá"], ["buc pha", "Bức Phá"]
]);
const EMPLOYMENT_TYPE_MAP = new Map<string, string>([
  ["full time", "Full Time"], ["fulltime", "Full Time"],
  ["part time", "Part Time"], ["parttime", "Part Time"], ["ctv", "CTV"]
]);
const BANK_MAP = new Map<string, string>([
  ["acb", "ACB"], ["sacombank", "Sacombank"], ["mb", "MB Bank"], ["mb bank", "MB Bank"],
  ["mb bak", "MB Bank"], ["vietcombank", "Vietcombank"], ["techcombank", "Techcombank"],
  ["techcom", "Techcombank"], ["tpbank", "TPBank"], ["tp bank", "TPBank"],
  ["vietinbank", "VietinBank"], ["viettinbank", "VietinBank"], ["bidv", "BIDV"],
  ["bidv bank", "BIDV"], ["vpbank", "VPBank"], ["vp bank", "VPBank"], ["vib", "VIB"],
  ["timo bank", "Timo"], ["timo", "Timo"], ["vikki bank", "Vikki Bank"]
]);

function canonical(value: unknown, map: Map<string, string>, fallback = titleCaseVi): string | null {
  const raw = clean(value);
  if (!raw) return null;
  return map.get(normalizedKey(raw)) || fallback(raw);
}

function statusValue(value: unknown) {
  const normalized = String(value ?? "");
  return ["active", "resigned", "reserved", "unknown"].includes(normalized) ? normalized : "unknown";
}

function hasValue(value: unknown) {
  return value !== null && value !== undefined && value !== "";
}

function mergeSafe(existing: Record<string, unknown> | null, incoming: Record<string, unknown>, preserveExisting: boolean, alwaysKeys: string[] = []) {
  if (!existing || !preserveExisting) return incoming;
  const result: Record<string, unknown> = { ...existing };
  Object.entries(incoming).forEach(([key, value]) => {
    if (alwaysKeys.includes(key) || hasValue(value)) result[key] = value;
  });
  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ message: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = privilegedKey();
  if (!url || !key) return json({ message: "Thiếu biến môi trường Supabase trong Edge Function." }, 500);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ message: "Thiếu access token." }, 401);

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json({ message: "Phiên đăng nhập không hợp lệ." }, 401);

  const { data: caller } = await admin.from("profiles").select("role_type,status").eq("id", userData.user.id).single();
  if (!caller || caller.status !== "active" || !["HR", "ADMIN", "SUPER_ADMIN"].includes(caller.role_type)) {
    return json({ message: "Chỉ HR/Admin/Super Admin được nhập dữ liệu nhân sự." }, 403);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ message: "JSON body không hợp lệ." }, 400); }

  const fileName = clean(body.file_name) || "employees.xlsx";
  const sourceSheet = clean(body.source_sheet) || "Danh sách nhân viên";
  const preserveExisting = body.preserve_existing !== false;
  const records = Array.isArray(body.records) ? body.records as Record<string, unknown>[] : [];
  const totalRows = Number(body.total_rows || records.length || 0);
  const finalize = Boolean(body.finalize);
  if (!records.length || records.length > 75) return json({ message: "Mỗi request cần từ 1 đến 75 dòng." }, 422);

  let batchId = clean(body.batch_id);
  if (!batchId) {
    const { data: batch, error } = await admin.from("employee_import_batches").insert({
      file_name: fileName, total_rows: totalRows, status: "importing", uploaded_by: userData.user.id,
      summary: { source_sheet: sourceSheet, preserve_existing: preserveExisting }
    }).select("id").single();
    if (error || !batch) return json({ message: error?.message || "Không tạo được đợt nhập dữ liệu." }, 500);
    batchId = batch.id;
  }

  async function findOrCreateUnit(unitType: string, codeValue: string | null, nameValue: string | null, parentId: string | null) {
    const code = clean(codeValue);
    const name = clean(nameValue);
    if (!code || !name) return null;

    let base = admin.from("org_units").select("id,code,name").eq("unit_type", unitType);
    base = parentId ? base.eq("parent_id", parentId) : base.is("parent_id", null);
    const { data: candidates, error: findError } = await base.limit(500);
    if (findError) throw findError;

    const matches = (candidates || []).filter((unit) =>
      normalizedKey(unit.code) === normalizedKey(code) || normalizedKey(unit.name) === normalizedKey(name)
    );
    if (matches.length > 1) throw new Error(`Trùng đơn vị tổ chức ${unitType}: ${name}. Hãy xử lý dữ liệu tổ chức trước khi nhập.`);
    if (matches[0]?.id) return matches[0].id as string;

    const { data: created, error } = await admin.from("org_units").insert({ unit_type: unitType, code, name, parent_id: parentId }).select("id").single();
    if (error) throw error;
    return created.id as string;
  }

  async function findUniqueEmployee(configure: (query: any) => any, label: string): Promise<string | null> {
    // deno-lint-ignore no-explicit-any
    const base: any = admin.from("employees").select("id");
    // deno-lint-ignore no-explicit-any
    const result: any = await configure(base);
    if (result.error) throw result.error;
    const rows = result.data || [];
    if (rows.length > 1) throw new Error(`Không thể tự ghép hồ sơ vì ${label} đang trùng trên Supabase.`);
    return rows[0]?.id || null;
  }

  const companyId = await findOrCreateUnit("company", "UNITE", "UNITE GROUP", null);
  let processed = 0;
  let imported = 0;
  let warningRows = 0;
  let invalidRows = 0;
  const failures: Array<{ row_number: number; employee_code: string | null; full_name: string | null; message: string }> = [];

  for (const record of records) {
    processed++;
    const rowNumber = Number(record.row_number || processed);
    const fullName = titleCaseVi(record.full_name);
    const employeeCode = clean(record.employee_code)?.toUpperCase() || null;
    const workEmail = clean(record.work_email)?.toLowerCase() || null;
    const personalEmail = clean(record.personal_email)?.toLowerCase() || null;
    const phone = clean(record.phone)?.replace(/[^0-9+]/g, "") || null;
    const warnings = Array.isArray(record.warnings) ? record.warnings.map(String) : [];
    const blockingWarnings = warnings.filter((warning) => /^(Mã nhân sự|Email công việc|Email cá nhân|Số điện thoại) bị trùng trong file$/i.test(warning.trim()));

    if (!fullName) {
      invalidRows++;
      await admin.from("employee_import_rows").upsert({
        batch_id: batchId, row_number: rowNumber, employee_code: employeeCode, full_name: null,
        normalized_data: record, warnings, import_status: "failed", error_message: "Thiếu họ tên"
      }, { onConflict: "batch_id,row_number" });
      failures.push({ row_number: rowNumber, employee_code: employeeCode, full_name: null, message: "Thiếu họ tên" });
      continue;
    }
    if (warnings.length) warningRows++;
    if (blockingWarnings.length) {
      invalidRows++;
      const blockMessage = `Dòng bị khóa để tránh ghép nhầm hồ sơ: ${blockingWarnings.join("; ")}`;
      await admin.from("employee_import_rows").upsert({
        batch_id: batchId, row_number: rowNumber, employee_code: employeeCode, full_name: fullName,
        normalized_data: record, warnings, import_status: "failed", error_message: blockMessage
      }, { onConflict: "batch_id,row_number" });
      failures.push({ row_number: rowNumber, employee_code: employeeCode, full_name: fullName, message: blockMessage });
      continue;
    }

    try {
      const department = canonical(record.department, DEPARTMENT_MAP);
      const area = canonical(record.area, AREA_MAP);
      const branch = clean(record.branch)?.toUpperCase() || null;
      const team = clean(record.team)?.toLocaleUpperCase("vi") || null;
      const employmentType = canonical(record.employment_type, EMPLOYMENT_TYPE_MAP);

      const departmentId = department ? await findOrCreateUnit("department", department.toUpperCase(), department, companyId) : null;
      const areaId = area ? await findOrCreateUnit("area", area.toUpperCase(), area, companyId) : null;
      const branchParent = areaId || companyId;
      const branchId = branch ? await findOrCreateUnit("branch", branch, branch, branchParent) : null;
      const teamParent = branchId || areaId || companyId;
      const teamId = team ? await findOrCreateUnit("team", `${team}-${branch || area || "UNITE"}`.toUpperCase(), team, teamParent) : null;

      // Ghép hồ sơ theo nhiều tín hiệu. Nếu các tín hiệu chỉ sang nhiều UUID khác nhau,
      // dừng dòng đó thay vì tự chọn một hồ sơ và làm lộn dữ liệu.
      const candidateIds = new Set<string>();
      const candidateReasons: string[] = [];
      const addCandidate = (id: string | null, reason: string) => { if (id) { candidateIds.add(id); candidateReasons.push(`${reason}:${id}`); } };

      const clientEmployeeId = clean(record.existing_employee_id);
      if (clientEmployeeId) {
        const { data } = await admin.from("employees").select("id").eq("id", clientEmployeeId).maybeSingle();
        addCandidate(data?.id || null, "client");
      }
      if (employeeCode) addCandidate(await findUniqueEmployee((query: any) => query.ilike("employee_code", employeeCode).limit(2), `mã ${employeeCode}`), "code");
      if (workEmail) {
        addCandidate(await findUniqueEmployee((query: any) => query.ilike("work_email", workEmail).limit(2), `email công việc ${workEmail}`), "work_email");
        addCandidate(await findUniqueEmployee((query: any) => query.ilike("personal_email", workEmail).limit(2), `email chéo ${workEmail}`), "work_email_cross");
      }
      if (personalEmail) {
        addCandidate(await findUniqueEmployee((query: any) => query.ilike("personal_email", personalEmail).limit(2), `email cá nhân ${personalEmail}`), "personal_email");
        addCandidate(await findUniqueEmployee((query: any) => query.ilike("work_email", personalEmail).limit(2), `email chéo ${personalEmail}`), "personal_email_cross");
      }
      if (phone) addCandidate(await findUniqueEmployee((query: any) => query.eq("phone", phone).limit(2), `số điện thoại ${phone}`), "phone");
      const sourceFingerprint = clean(record.source_fingerprint);
      if (sourceFingerprint) addCandidate(await findUniqueEmployee((query: any) => query.eq("source_fingerprint", sourceFingerprint).limit(2), `dấu vân tay dữ liệu ${sourceFingerprint}`), "fingerprint");

      if (candidateIds.size > 1) {
        throw new Error(`Các định danh đang trỏ đến nhiều hồ sơ khác nhau (${candidateReasons.join(", ")}). Hệ thống đã dừng để tránh lộn dữ liệu.`);
      }
      let employeeId = [...candidateIds][0] || null;

      // Fallback an toàn cho hồ sơ thiếu mã/email/điện thoại: họ tên + ngày sinh.
      const birthDate = clean((record.private_data as Record<string, unknown> | undefined)?.birth_date);
      if (!employeeId && birthDate && fullName) {
        const { data: nameCandidates, error: nameError } = await admin.from("employees").select("id").ilike("full_name", fullName).limit(20);
        if (nameError) throw nameError;
        const ids = (nameCandidates || []).map(row => row.id);
        if (ids.length) {
          const { data: birthMatches, error: birthError } = await admin.from("employee_private").select("employee_id").in("employee_id", ids).eq("birth_date", birthDate);
          if (birthError) throw birthError;
          if ((birthMatches || []).length > 1) throw new Error(`Họ tên và ngày sinh đang trùng nhiều hồ sơ: ${fullName} - ${birthDate}.`);
          employeeId = birthMatches?.[0]?.employee_id || null;
        }
      }

      // Dòng nguồn chỉ được dùng khi họ tên cũng khớp; tuyệt đối không ghép theo số dòng đơn lẻ.
      if (!employeeId) {
        employeeId = await findUniqueEmployee((query: any) => query.in("source_file", [fileName, sourceSheet]).eq("source_row", rowNumber).ilike("full_name", fullName).limit(2), `dòng ${rowNumber} và họ tên ${fullName}`);
      }

      let existingEmployee: Record<string, unknown> | null = null;
      if (employeeId) {
        const { data, error } = await admin.from("employees").select("*").eq("id", employeeId).single();
        if (error) throw error;
        existingEmployee = data as Record<string, unknown>;
      }

      const incomingEmployee: Record<string, unknown> = {
        employee_code: employeeCode,
        full_name: fullName,
        work_email: workEmail,
        personal_email: personalEmail,
        phone,
        department, area, branch, team,
        title: titleCaseVi(record.title),
        employment_level: clean(record.employment_level),
        employment_type: employmentType,
        gender: titleCaseVi(record.gender),
        nickname: titleCaseVi(record.nickname),
        start_date: clean(record.start_date),
        official_date: clean(record.official_date),
        end_date: clean(record.end_date),
        employment_status: statusValue(record.employment_status),
        photo_url: clean(record.photo_url),
        source_row: rowNumber,
        source_row_order: rowNumber,
        source_file: fileName,
        source_fingerprint: clean(record.source_fingerprint),
        import_identity_strength: clean(record.identity_strength) || "unknown",
        last_import_batch_id: batchId,
        data_quality: warnings.length ? "needs_review" : "ok",
        department_id: departmentId,
        area_id: areaId,
        branch_id: branchId,
        team_id: teamId,
        updated_at: new Date().toISOString()
      };
      const employeePayload = mergeSafe(existingEmployee, incomingEmployee, preserveExisting, [
        "full_name", "employment_status", "source_row", "source_row_order", "source_file", "source_fingerprint", "import_identity_strength", "last_import_batch_id", "data_quality", "updated_at"
      ]);
      delete employeePayload.id;
      delete employeePayload.created_at;

      if (employeeId) {
        const { error } = await admin.from("employees").update(employeePayload).eq("id", employeeId);
        if (error) throw error;
      } else {
        const { data, error } = await admin.from("employees").insert(employeePayload).select("id").single();
        if (error) throw error;
        employeeId = data.id;
      }

      const privateData = (record.private_data && typeof record.private_data === "object") ? record.private_data as Record<string, unknown> : {};
      const { data: existingPrivate } = await admin.from("employee_private").select("*").eq("employee_id", employeeId).maybeSingle();
      const incomingPrivate: Record<string, unknown> = {
        employee_id: employeeId,
        birth_date: clean(privateData.birth_date), ethnicity: titleCaseVi(privateData.ethnicity), religion: titleCaseVi(privateData.religion),
        nationality: titleCaseVi(privateData.nationality), citizen_id: clean(privateData.citizen_id), social_insurance_no: clean(privateData.social_insurance_no),
        tax_code: clean(privateData.tax_code), address_line: clean(privateData.address_line), district: titleCaseVi(privateData.district), province: titleCaseVi(privateData.province),
        starting_salary: privateData.starting_salary ?? null, current_salary: privateData.current_salary ?? null,
        bank_account: clean(privateData.bank_account), bank_name: canonical(privateData.bank_name, BANK_MAP), probation_start: clean(privateData.probation_start),
        probation_end: clean(privateData.probation_end), probation_status: titleCaseVi(privateData.probation_status), related_documents: clean(privateData.related_documents),
        official_contract_type: titleCaseVi(privateData.official_contract_type), contract_expiry: clean(privateData.contract_expiry), contract_file_url: clean(privateData.contract_file_url),
        handover_status: titleCaseVi(privateData.handover_status), handover_date: clean(privateData.handover_date), updated_at: new Date().toISOString()
      };
      const privatePayload = mergeSafe(existingPrivate as Record<string, unknown> | null, incomingPrivate, preserveExisting, ["employee_id", "updated_at"]);
      delete privatePayload.created_at;
      const hasPrivate = Object.entries(privatePayload).some(([field, value]) => !["employee_id", "updated_at"].includes(field) && hasValue(value));
      if (hasPrivate) {
        const { error } = await admin.from("employee_private").upsert(privatePayload, { onConflict: "employee_id" });
        if (error) throw error;
      }

      await admin.from("employee_import_rows").upsert({
        batch_id: batchId, row_number: rowNumber, employee_code: employeeCode, full_name: fullName,
        normalized_data: record, warnings, import_status: "imported", employee_id: employeeId, error_message: null
      }, { onConflict: "batch_id,row_number" });

      const mergedDepartment = clean(employeePayload.department);
      const mergedArea = clean(employeePayload.area);
      const mergedBranch = clean(employeePayload.branch);
      const mergedTeam = clean(employeePayload.team);
      const candidates = [workEmail, personalEmail].filter(Boolean) as string[];
      if (candidates.length) {
        const { data: matchingProfiles } = await admin.from("profiles").select("id,email").in("email", candidates);
        for (const profile of matchingProfiles || []) {
          await admin.from("profiles").update({
            employee_record_id: employeeId,
            employee_code: clean(employeePayload.employee_code),
            full_name: clean(employeePayload.full_name),
            department: mergedDepartment, area: mergedArea, branch: mergedBranch, team: mergedTeam,
            department_id: employeePayload.department_id || null, area_id: employeePayload.area_id || null,
            branch_id: employeePayload.branch_id || null, team_id: employeePayload.team_id || null,
            title: clean(employeePayload.employment_level) || clean(employeePayload.title)
          }).eq("id", profile.id);
        }
      }
      imported++;
    } catch (error) {
      invalidRows++;
      const message = error instanceof Error ? error.message : String(error);
      await admin.from("employee_import_rows").upsert({
        batch_id: batchId, row_number: rowNumber, employee_code: employeeCode, full_name: fullName,
        normalized_data: record, warnings, import_status: "failed", error_message: message
      }, { onConflict: "batch_id,row_number" });
      failures.push({ row_number: rowNumber, employee_code: employeeCode, full_name: fullName, message });
    }
  }

  if (finalize) {
    const { data: rowStats } = await admin.from("employee_import_rows").select("import_status,warnings").eq("batch_id", batchId);
    const valid = (rowStats || []).filter((row) => row.import_status === "imported" && (!row.warnings || row.warnings.length === 0)).length;
    const warning = (rowStats || []).filter((row) => row.import_status === "imported" && row.warnings?.length).length;
    const invalid = (rowStats || []).filter((row) => row.import_status === "failed").length;
    await admin.from("employee_import_batches").update({
      valid_rows: valid, warning_rows: warning, invalid_rows: invalid, status: "completed",
      completed_at: new Date().toISOString(), summary: { valid, warning, invalid, source_sheet: sourceSheet, preserve_existing: preserveExisting }
    }).eq("id", batchId);
  }

  return json({ ok: true, batch_id: batchId, processed, imported, warning_rows: warningRows, invalid_rows: invalidRows, failures });
});
