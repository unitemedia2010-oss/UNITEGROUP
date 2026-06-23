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
      // Fall through to legacy hosted key.
    }
  }

  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

function clean(value: unknown): string | null {
  const result = String(value ?? "").trim();
  return result || null;
}

function statusValue(value: unknown) {
  return ["active", "resigned", "reserved", "unknown"].includes(String(value)) ? String(value) : "unknown";
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
  const records = Array.isArray(body.records) ? body.records as Record<string, unknown>[] : [];
  const totalRows = Number(body.total_rows || records.length || 0);
  const finalize = Boolean(body.finalize);
  if (!records.length || records.length > 75) return json({ message: "Mỗi request cần từ 1 đến 75 dòng." }, 422);

  let batchId = clean(body.batch_id);
  if (!batchId) {
    const { data: batch, error } = await admin.from("employee_import_batches").insert({
      file_name: fileName, total_rows: totalRows, status: "importing", uploaded_by: userData.user.id
    }).select("id").single();
    if (error || !batch) return json({ message: error?.message || "Không tạo được đợt nhập dữ liệu." }, 500);
    batchId = batch.id;
  }

  async function findOrCreateUnit(unitType: string, codeValue: string | null, nameValue: string | null, parentId: string | null) {
    const code = clean(codeValue);
    const name = clean(nameValue);
    if (!code || !name) return null;
    let query = admin.from("org_units").select("id").eq("unit_type", unitType).ilike("code", code);
    query = parentId ? query.eq("parent_id", parentId) : query.is("parent_id", null);
    const { data: existing } = await query.maybeSingle();
    if (existing?.id) return existing.id as string;
    const { data: created, error } = await admin.from("org_units").insert({ unit_type: unitType, code, name, parent_id: parentId }).select("id").single();
    if (error) throw error;
    return created.id as string;
  }

  const companyId = await findOrCreateUnit("company", "UNITE", "UNITE GROUP", null);
  let processed = 0;
  let imported = 0;
  let warningRows = 0;
  let invalidRows = 0;

  for (const record of records) {
    processed++;
    const rowNumber = Number(record.row_number || processed);
    const fullName = clean(record.full_name);
    const employeeCode = clean(record.employee_code)?.toUpperCase() || null;
    const workEmail = clean(record.work_email)?.toLowerCase() || null;
    const personalEmail = clean(record.personal_email)?.toLowerCase() || null;
    const warnings = Array.isArray(record.warnings) ? record.warnings.map(String) : [];

    if (!fullName) {
      invalidRows++;
      await admin.from("employee_import_rows").upsert({
        batch_id: batchId, row_number: rowNumber, employee_code: employeeCode, full_name: null,
        normalized_data: record, warnings, import_status: "failed", error_message: "Thiếu họ tên"
      }, { onConflict: "batch_id,row_number" });
      continue;
    }
    if (warnings.length) warningRows++;

    try {
      const department = clean(record.department);
      const area = clean(record.area);
      const branch = clean(record.branch);
      const team = clean(record.team);
      const departmentId = department ? await findOrCreateUnit("department", department.toUpperCase(), department, companyId) : null;
      const areaId = area ? await findOrCreateUnit("area", area.toUpperCase(), area, companyId) : null;
      const branchParent = areaId || companyId;
      const branchId = branch ? await findOrCreateUnit("branch", branch.toUpperCase(), branch, branchParent) : null;
      const teamParent = branchId || areaId || companyId;
      const teamId = team ? await findOrCreateUnit("team", `${team}-${branch || area || "UNITE"}`.toUpperCase(), team, teamParent) : null;

      let employeeId: string | null = null;
      if (employeeCode) {
        const { data } = await admin.from("employees").select("id").ilike("employee_code", employeeCode).maybeSingle();
        employeeId = data?.id || null;
      }
      if (!employeeId && (workEmail || personalEmail)) {
        let emailQuery = admin.from("employees").select("id");
        emailQuery = workEmail && personalEmail
          ? emailQuery.or(`work_email.eq.${workEmail},personal_email.eq.${personalEmail}`)
          : workEmail ? emailQuery.eq("work_email", workEmail) : emailQuery.eq("personal_email", personalEmail);
        const { data } = await emailQuery.limit(1).maybeSingle();
        employeeId = data?.id || null;
      }
      if (!employeeId) {
        const { data } = await admin.from("employees").select("id").eq("source_file", fileName).eq("source_row", rowNumber).maybeSingle();
        employeeId = data?.id || null;
      }

      const employeePayload = {
        employee_code: employeeCode,
        full_name: fullName,
        work_email: workEmail,
        personal_email: personalEmail,
        phone: clean(record.phone),
        department, area, branch, team,
        title: clean(record.title),
        employment_level: clean(record.employment_level),
        employment_type: clean(record.employment_type),
        gender: clean(record.gender),
        nickname: clean(record.nickname),
        start_date: clean(record.start_date),
        official_date: clean(record.official_date),
        end_date: clean(record.end_date),
        employment_status: statusValue(record.employment_status),
        photo_url: clean(record.photo_url),
        source_row: rowNumber,
        source_row_order: rowNumber,
        source_file: fileName,
        data_quality: warnings.length ? "needs_review" : "ok",
        department_id: departmentId,
        area_id: areaId,
        branch_id: branchId,
        team_id: teamId,
        updated_at: new Date().toISOString()
      };

      if (employeeId) {
        const { error } = await admin.from("employees").update(employeePayload).eq("id", employeeId);
        if (error) throw error;
      } else {
        const { data, error } = await admin.from("employees").insert(employeePayload).select("id").single();
        if (error) throw error;
        employeeId = data.id;
      }

      const privateData = (record.private_data && typeof record.private_data === "object") ? record.private_data as Record<string, unknown> : {};
      const privatePayload = {
        employee_id: employeeId,
        birth_date: clean(privateData.birth_date), ethnicity: clean(privateData.ethnicity), religion: clean(privateData.religion),
        nationality: clean(privateData.nationality), citizen_id: clean(privateData.citizen_id), social_insurance_no: clean(privateData.social_insurance_no),
        tax_code: clean(privateData.tax_code), address_line: clean(privateData.address_line), district: clean(privateData.district), province: clean(privateData.province),
        starting_salary: privateData.starting_salary ?? null, current_salary: privateData.current_salary ?? null,
        bank_account: clean(privateData.bank_account), bank_name: clean(privateData.bank_name), probation_start: clean(privateData.probation_start),
        probation_end: clean(privateData.probation_end), probation_status: clean(privateData.probation_status), related_documents: clean(privateData.related_documents),
        official_contract_type: clean(privateData.official_contract_type), contract_expiry: clean(privateData.contract_expiry), contract_file_url: clean(privateData.contract_file_url),
        handover_status: clean(privateData.handover_status), handover_date: clean(privateData.handover_date), updated_at: new Date().toISOString()
      };
      const hasPrivate = Object.entries(privatePayload).some(([key, value]) => key !== "employee_id" && key !== "updated_at" && value !== null && value !== "");
      if (hasPrivate) {
        const { error } = await admin.from("employee_private").upsert(privatePayload, { onConflict: "employee_id" });
        if (error) throw error;
      }

      await admin.from("employee_import_rows").upsert({
        batch_id: batchId, row_number: rowNumber, employee_code: employeeCode, full_name: fullName,
        normalized_data: record, warnings, import_status: "imported", employee_id: employeeId, error_message: null
      }, { onConflict: "batch_id,row_number" });

      if (workEmail || personalEmail) {
        const candidates = [workEmail, personalEmail].filter(Boolean) as string[];
        const { data: matchingProfiles } = await admin.from("profiles").select("id,email").in("email", candidates);
        for (const profile of matchingProfiles || []) {
          await admin.from("profiles").update({
            employee_record_id: employeeId, department, area, branch, team,
            department_id: departmentId, area_id: areaId, branch_id: branchId, team_id: teamId,
            title: clean(record.employment_level) || clean(record.title)
          }).eq("id", profile.id);
        }
      }
      imported++;
    } catch (error) {
      invalidRows++;
      await admin.from("employee_import_rows").upsert({
        batch_id: batchId, row_number: rowNumber, employee_code: employeeCode, full_name: fullName,
        normalized_data: record, warnings, import_status: "failed", error_message: error instanceof Error ? error.message : String(error)
      }, { onConflict: "batch_id,row_number" });
    }
  }

  if (finalize) {
    const { data: rowStats } = await admin.from("employee_import_rows").select("import_status,warnings").eq("batch_id", batchId);
    const valid = (rowStats || []).filter((row) => row.import_status === "imported" && (!row.warnings || row.warnings.length === 0)).length;
    const warning = (rowStats || []).filter((row) => row.import_status === "imported" && row.warnings?.length).length;
    const invalid = (rowStats || []).filter((row) => row.import_status === "failed").length;
    await admin.from("employee_import_batches").update({
      valid_rows: valid, warning_rows: warning, invalid_rows: invalid, status: invalid ? "completed" : "completed",
      completed_at: new Date().toISOString(), summary: { valid, warning, invalid }
    }).eq("id", batchId);
  }

  return json({ ok: true, batch_id: batchId, processed, imported, warning_rows: warningRows, invalid_rows: invalidRows });
});
