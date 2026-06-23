import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

const ROLE_RANK: Record<string, number> = {
  SALE: 10,
  EMPLOYEE: 10,
  TTS: 10,
  NVPT: 10,
  LEADER: 20,
  BRANCH_MANAGER: 30,
  AREA_MANAGER: 40,
  HR: 50,
  ADMIN: 60,
  SUPER_ADMIN: 70
};
const ACCOUNT_MANAGER_ROLES = new Set(["HR", "ADMIN", "SUPER_ADMIN"]);
const ALLOWED_ROLES = new Set(Object.keys(ROLE_RANK));
const DEFAULT_PASSWORD = "12345678";
const MAX_CREATE_BATCH = 30;

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
      const first = Object.values(parsed).find(value => typeof value === "string" && value);
      if (typeof first === "string") return first;
    } catch {
      // Fall through to hosted legacy key.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

function clean(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function validEmail(value: string | null) {
  return Boolean(value && /^\S+@\S+\.\S+$/.test(value));
}

function employeeEmail(employee: Record<string, unknown>) {
  const work = clean(employee.work_email)?.toLowerCase() || null;
  const personal = clean(employee.personal_email)?.toLowerCase() || null;
  return validEmail(work) ? work : validEmail(personal) ? personal : work || personal;
}

function roleCanCreate(callerRole: string, targetRole: string) {
  const callerRank = ROLE_RANK[callerRole] || 0;
  const targetRank = ROLE_RANK[targetRole] || 999;
  if (callerRole === "SUPER_ADMIN") return targetRank <= callerRank;
  return targetRank < callerRank;
}

function suggestRole(employee: Record<string, unknown>) {
  const text = normalize([
    employee.hierarchy_label,
    employee.employment_level,
    employee.title,
    employee.employment_type,
    employee.department
  ].filter(Boolean).join(" "));

  if (/quan ly khu vuc|giam doc khu vuc|tpkd/.test(text)) return "AREA_MANAGER";
  if (/quan ly chi nhanh|truong chi nhanh|qlcn/.test(text)) return "BRANCH_MANAGER";
  if (/\bleader\b|truong nhom/.test(text)) return "LEADER";
  if (/\bnvpt\b/.test(text)) return "NVPT";
  if (/\btts\b|thuc tap/.test(text)) return "TTS";
  if (/kinh doanh|sale|sales/.test(text)) return "SALE";
  return "EMPLOYEE";
}

function scopeProblem(employee: Record<string, unknown>, role: string) {
  const department = clean(employee.department);
  const area = clean(employee.area);
  const branch = clean(employee.branch);
  const team = clean(employee.team);
  if (role === "AREA_MANAGER" && !area) return "Quản lý khu vực chưa có Khu vực.";
  if (role === "BRANCH_MANAGER" && (!area || !branch)) return "Quản lý chi nhánh chưa có đủ Khu vực và Chi nhánh.";
  if (role === "LEADER" && (!area || !branch || !team)) return "Leader chưa có đủ Khu vực, Chi nhánh và Team.";
  if (role === "SALE" && (!area || !branch || !team)) return "Nhân sự kinh doanh chưa có đủ Khu vực, Chi nhánh và Team.";
  if (["EMPLOYEE", "TTS", "NVPT"].includes(role) && !department && !area) return "Nhân sự chưa có Phòng ban hoặc Khu vực.";
  return "";
}

async function listAllAuthUsers(admin: ReturnType<typeof createClient>) {
  const users: Array<Record<string, unknown>> = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const pageUsers = data?.users || [];
    users.push(...pageUsers);
    if (pageUsers.length < 1000) break;
  }
  return users;
}

async function findOrCreateUnit(
  admin: ReturnType<typeof createClient>,
  unitType: string,
  value: string | null,
  parentId: string | null
) {
  if (!value) return null;
  let query = admin.from("org_units").select("id").eq("unit_type", unitType).or(`name.ilike.${value},code.ilike.${value}`);
  query = parentId ? query.eq("parent_id", parentId) : query.is("parent_id", null);
  const { data: existing } = await query.limit(1).maybeSingle();
  if (existing?.id) return existing.id as string;
  const code = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toUpperCase().slice(0, 48) || unitType.toUpperCase();
  const { data: created, error } = await admin.from("org_units")
    .insert({ unit_type: unitType, code, name: value, parent_id: parentId })
    .select("id").single();
  if (error) throw error;
  return created.id as string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ message: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const privilegedKey = readPrivilegedKey();
  if (!supabaseUrl || !privilegedKey) return json({ message: "Thiếu cấu hình Supabase backend." }, 500);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ message: "Thiếu access token." }, 401);

  const admin = createClient(supabaseUrl, privilegedKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json({ message: "Phiên đăng nhập không hợp lệ." }, 401);

  const { data: caller, error: callerError } = await admin.from("profiles")
    .select("id,role_type,status")
    .eq("id", userData.user.id).single();
  if (callerError || !caller || caller.status !== "active" || !ACCOUNT_MANAGER_ROLES.has(caller.role_type)) {
    return json({ message: "Chỉ HR, ADMIN hoặc SUPER_ADMIN được quản lý tài khoản hàng loạt." }, 403);
  }

  let payload: Record<string, unknown>;
  try { payload = await req.json(); }
  catch { return json({ message: "JSON body không hợp lệ." }, 400); }
  const action = String(payload.action || "preview");

  const { data: employees, error: employeeError } = await admin.from("employees")
    .select("id,employee_code,full_name,work_email,personal_email,phone,department,area,branch,team,title,employment_level,employment_type,employment_status,data_quality,department_id,area_id,branch_id,team_id,hierarchy_label")
    .order("full_name").limit(5000);
  if (employeeError) return json({ message: employeeError.message }, 500);

  const { data: profiles, error: profileError } = await admin.from("profiles")
    .select("id,email,employee_code,employee_record_id,role_type,status")
    .limit(5000);
  if (profileError) return json({ message: profileError.message }, 500);

  let authUsers: Array<Record<string, unknown>> = [];
  try { authUsers = await listAllAuthUsers(admin); }
  catch (error) { return json({ message: `Không đọc được danh sách Auth: ${error instanceof Error ? error.message : String(error)}` }, 500); }

  const profileByEmployee = new Map((profiles || []).filter(p => p.employee_record_id).map(p => [String(p.employee_record_id), p]));
  const profileByEmail = new Map((profiles || []).filter(p => p.email).map(p => [String(p.email).toLowerCase(), p]));
  const profileByCode = new Map((profiles || []).filter(p => p.employee_code).map(p => [String(p.employee_code).toUpperCase(), p]));
  const authByEmail = new Map(authUsers.filter(u => u.email).map(u => [String(u.email).toLowerCase(), u]));

  const emailCounts = new Map<string, number>();
  for (const employee of employees || []) {
    const email = employeeEmail(employee as Record<string, unknown>);
    if (email) emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
  }

  function inspect(employee: Record<string, unknown>, requestedRole?: string) {
    const id = String(employee.id);
    const code = String(employee.employee_code || "").trim().toUpperCase();
    const email = employeeEmail(employee);
    const suggestedRole = String(requestedRole || suggestRole(employee)).toUpperCase();
    const existingProfile = profileByEmployee.get(id) || (email ? profileByEmail.get(email) : null) || (code ? profileByCode.get(code) : null);
    const existingAuth = email ? authByEmail.get(email) : null;
    let eligible = true;
    let status = "eligible";
    let message = "Đủ điều kiện tạo tài khoản.";

    if (employee.employment_status !== "active") {
      eligible = false; status = "inactive"; message = "Chỉ tạo tài khoản cho nhân sự đang làm.";
    } else if (!code) {
      eligible = false; status = "missing_code"; message = "Thiếu mã nhân sự.";
    } else if (!email) {
      eligible = false; status = "missing_email"; message = "Thiếu email hợp lệ.";
    } else if (!validEmail(email)) {
      eligible = false; status = "invalid_email"; message = "Email chưa đúng định dạng.";
    } else if ((emailCounts.get(email) || 0) > 1) {
      eligible = false; status = "duplicate_email"; message = "Email đang xuất hiện ở nhiều hồ sơ nhân sự.";
    } else if (existingProfile) {
      eligible = false; status = "existing"; message = `Đã có tài khoản ${existingProfile.role_type || ""}.`;
    } else if (!ALLOWED_ROLES.has(suggestedRole)) {
      eligible = false; status = "invalid_role"; message = "Vai trò tài khoản chưa hợp lệ.";
    } else if (!roleCanCreate(caller.role_type, suggestedRole)) {
      eligible = false; status = "role_forbidden"; message = `${caller.role_type} không được tạo vai trò ${suggestedRole}.`;
    } else {
      const problem = scopeProblem(employee, suggestedRole);
      if (problem) {
        eligible = false; status = "missing_scope"; message = problem;
      } else if (existingAuth) {
        status = "auth_orphan";
        message = "Auth đã tồn tại nhưng chưa có hồ sơ; hệ thống sẽ liên kết và đặt lại mật khẩu tạm.";
      }
    }

    return {
      employee_id: id,
      employee_code: code,
      full_name: employee.full_name || "",
      email,
      phone: employee.phone || null,
      department: employee.department || null,
      area: employee.area || null,
      branch: employee.branch || null,
      team: employee.team || null,
      title: employee.title || null,
      employment_level: employee.employment_level || null,
      employment_type: employee.employment_type || null,
      suggested_role: suggestedRole,
      eligible,
      status,
      message
    };
  }

  if (action === "preview") {
    const rows = (employees || []).map(employee => inspect(employee as Record<string, unknown>));
    const summary = rows.reduce((acc: Record<string, number>, row) => {
      acc.total++;
      acc[row.status] = (acc[row.status] || 0) + 1;
      if (row.eligible) acc.eligible++;
      return acc;
    }, { total: 0, eligible: 0 });
    return json({ ok: true, rows, summary });
  }

  if (action !== "create") return json({ message: "Action không hợp lệ." }, 422);
  const requested = Array.isArray(payload.records) ? payload.records as Array<Record<string, unknown>> : [];
  if (!requested.length) return json({ message: "Chưa chọn nhân sự cần tạo tài khoản." }, 422);
  if (requested.length > MAX_CREATE_BATCH) return json({ message: `Mỗi lô tối đa ${MAX_CREATE_BATCH} tài khoản.` }, 422);

  const employeeById = new Map((employees || []).map(employee => [String(employee.id), employee as Record<string, unknown>]));
  const results: Array<Record<string, unknown>> = [];

  for (const record of requested) {
    const employeeId = String(record.employee_id || "");
    const employee = employeeById.get(employeeId);
    if (!employee) {
      results.push({ ok: false, employee_id: employeeId, status: "not_found", message: "Không tìm thấy hồ sơ nhân sự." });
      continue;
    }
    const roleType = String(record.role_type || suggestRole(employee)).toUpperCase();
    const inspection = inspect(employee, roleType);
    if (!inspection.eligible) {
      results.push({ ok: false, employee_id: employeeId, employee_code: inspection.employee_code, status: inspection.status, message: inspection.message });
      continue;
    }

    const email = String(inspection.email).toLowerCase();
    const code = String(inspection.employee_code).toUpperCase();
    let authUser = authByEmail.get(email) as Record<string, unknown> | undefined;
    let createdNewAuth = false;

    try {
      if (authUser?.id) {
        const { data: updated, error } = await admin.auth.admin.updateUserById(String(authUser.id), {
          password: DEFAULT_PASSWORD,
          email_confirm: true,
          user_metadata: { full_name: inspection.full_name, employee_code: code, role_type: roleType }
        });
        if (error || !updated.user) throw error || new Error("Không cập nhật được Auth user hiện có.");
        authUser = updated.user as unknown as Record<string, unknown>;
      } else {
        const { data: created, error } = await admin.auth.admin.createUser({
          email,
          password: DEFAULT_PASSWORD,
          email_confirm: true,
          user_metadata: { full_name: inspection.full_name, employee_code: code, role_type: roleType }
        });
        if (error || !created.user) throw error || new Error("Không tạo được Auth user.");
        authUser = created.user as unknown as Record<string, unknown>;
        authByEmail.set(email, authUser);
        createdNewAuth = true;
      }

      let departmentId = clean(employee.department_id);
      let areaId = clean(employee.area_id);
      let branchId = clean(employee.branch_id);
      let teamId = clean(employee.team_id);
      const department = clean(employee.department);
      const area = clean(employee.area);
      const branch = clean(employee.branch);
      const team = clean(employee.team);

      const companyId = await findOrCreateUnit(admin, "company", "UNITE GROUP", null);
      if (!departmentId) departmentId = await findOrCreateUnit(admin, "department", department, companyId);
      if (!areaId) areaId = await findOrCreateUnit(admin, "area", area, companyId);
      if (!branchId) branchId = await findOrCreateUnit(admin, "branch", branch, areaId || companyId);
      if (!teamId) teamId = await findOrCreateUnit(admin, "team", team, branchId || areaId || companyId);

      const profilePayload = {
        id: String(authUser.id),
        employee_code: code,
        full_name: inspection.full_name,
        email,
        phone: inspection.phone,
        role_type: roleType,
        department,
        area,
        branch,
        team,
        status: "active",
        min_days_per_month: 12,
        employee_record_id: employeeId,
        department_id: departmentId,
        area_id: areaId,
        branch_id: branchId,
        team_id: teamId,
        must_change_password: true
      };
      const { error: insertError } = await admin.from("profiles").insert(profilePayload);
      if (insertError) throw insertError;

      const primaryUnitId = teamId || branchId || areaId || departmentId;
      if (primaryUnitId) {
        await admin.from("org_memberships").insert({
          profile_id: String(authUser.id), role_type: roleType, org_unit_id: primaryUnitId, is_primary: true
        });
      }

      profileByEmployee.set(employeeId, profilePayload);
      profileByEmail.set(email, profilePayload);
      profileByCode.set(code, profilePayload);
      results.push({
        ok: true,
        employee_id: employeeId,
        employee_code: code,
        email,
        role_type: roleType,
        status: createdNewAuth ? "created" : "linked",
        message: createdNewAuth ? "Đã tạo tài khoản." : "Đã liên kết Auth hiện có và đặt lại mật khẩu tạm."
      });
    } catch (error) {
      if (createdNewAuth && authUser?.id) await admin.auth.admin.deleteUser(String(authUser.id));
      results.push({
        ok: false,
        employee_id: employeeId,
        employee_code: code,
        email,
        role_type: roleType,
        status: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const created = results.filter(row => row.ok).length;
  return json({ ok: true, created, failed: results.length - created, results });
});
