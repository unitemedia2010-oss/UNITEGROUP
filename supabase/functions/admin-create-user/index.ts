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
const ALLOWED_ROLES = new Set(Object.keys(ROLE_RANK));
const ALLOWED_STATUS = new Set(["active", "inactive"]);

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
      // Fall through to legacy hosted key.
    }
  }

  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

function clean(value: unknown): string | null {
  const result = String(value ?? "").trim();
  return result || null;
}

function roleCanCreate(callerRole: string, targetRole: string) {
  const callerRank = ROLE_RANK[callerRole] || 0;
  const targetRank = ROLE_RANK[targetRole] || 999;
  if (callerRole === "SUPER_ADMIN") return targetRank <= callerRank;
  return targetRank < callerRank;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ message: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const privilegedKey = readPrivilegedKey();
  if (!supabaseUrl || !privilegedKey) {
    return json({ message: "Thiếu SUPABASE_URL hoặc privileged key trong Edge Function." }, 500);
  }

  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ message: "Thiếu access token." }, 401);

  const admin = createClient(supabaseUrl, privilegedKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json({ message: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn." }, 401);

  const { data: caller, error: callerError } = await admin
    .from("profiles")
    .select("id,role_type,status,department,area,branch,team,department_id,area_id,branch_id,team_id")
    .eq("id", userData.user.id)
    .single();

  if (callerError || !caller || caller.status !== "active" || (ROLE_RANK[caller.role_type] || 0) < ROLE_RANK.LEADER) {
    return json({ message: "Tài khoản hiện tại không có quyền tạo tài khoản cấp dưới." }, 403);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ message: "JSON body không hợp lệ." }, 400);
  }

  const email = String(payload.email || "").trim().toLowerCase();
  const password = String(payload.password || "");
  const employeeCode = String(payload.employee_code || "").trim().toUpperCase();
  const fullName = String(payload.full_name || "").trim();
  const roleType = String(payload.role_type || "SALE").trim().toUpperCase();
  let department = clean(payload.department);
  let area = clean(payload.area);
  let branch = clean(payload.branch);
  let team = clean(payload.team);
  const status = String(payload.status || "active").trim().toLowerCase();
  const minDays = Number(payload.min_days_per_month ?? 12);
  const mustChangePassword = payload.must_change_password === undefined
    ? password === "12345678"
    : Boolean(payload.must_change_password);

  if (!/^\S+@\S+\.\S+$/.test(email)) return json({ message: "Email chưa hợp lệ." }, 422);
  if (password.length < 8) return json({ message: "Mật khẩu cần tối thiểu 8 ký tự." }, 422);
  if (employeeCode.length < 3 || employeeCode.length > 40) return json({ message: "Mã nhân sự phải từ 3 đến 40 ký tự." }, 422);
  if (fullName.length < 2 || fullName.length > 120) return json({ message: "Họ tên chưa hợp lệ." }, 422);
  if (!ALLOWED_ROLES.has(roleType)) return json({ message: "Vai trò chưa hợp lệ." }, 422);
  if (!roleCanCreate(caller.role_type, roleType)) return json({ message: `Vai trò ${caller.role_type} không được tạo tài khoản ${roleType}.` }, 403);
  if (!ALLOWED_STATUS.has(status)) return json({ message: "Trạng thái chưa hợp lệ." }, 422);
  if (!Number.isInteger(minDays) || minDays < 0 || minDays > 31) return json({ message: "Chỉ tiêu tháng phải từ 0 đến 31 ngày." }, 422);

  // Khóa scope theo tuyến quản lý: cấp dưới không thể được tạo ngoài phạm vi của người tạo.
  if (caller.role_type === "AREA_MANAGER") {
    area = clean(caller.area);
    if (!area) return json({ message: "Tài khoản Quản lý khu vực chưa được cấu hình Khu vực." }, 422);
  } else if (caller.role_type === "BRANCH_MANAGER") {
    area = clean(caller.area);
    branch = clean(caller.branch);
    if (!area || !branch) return json({ message: "Tài khoản Quản lý chi nhánh chưa được cấu hình đủ Khu vực và Chi nhánh." }, 422);
  } else if (caller.role_type === "LEADER") {
    area = clean(caller.area);
    branch = clean(caller.branch);
    team = clean(caller.team);
    if (!area || !branch || !team) return json({ message: "Tài khoản Leader chưa được cấu hình đủ Khu vực, Chi nhánh và Team." }, 422);
  }

  if (roleType === "LEADER" && (!area || !branch || !team)) return json({ message: "LEADER cần có đủ Khu vực, Chi nhánh và Team." }, 422);
  if (roleType === "BRANCH_MANAGER" && (!area || !branch)) return json({ message: "Quản lý chi nhánh cần có đủ Khu vực và Chi nhánh." }, 422);
  if (roleType === "AREA_MANAGER" && !area) return json({ message: "Quản lý khu vực cần có Khu vực." }, 422);

  const [emailLookup, codeLookup] = await Promise.all([
    admin.from("profiles").select("id").ilike("email", email).limit(1),
    admin.from("profiles").select("id").ilike("employee_code", employeeCode).limit(1)
  ]);
  if (emailLookup.error || codeLookup.error) {
    return json({ message: emailLookup.error?.message || codeLookup.error?.message || "Không kiểm tra được dữ liệu trùng." }, 500);
  }
  if (emailLookup.data?.length || codeLookup.data?.length) return json({ message: "Email hoặc mã nhân sự đã tồn tại." }, 409);

  // Nếu hồ sơ nhân sự đã được import, tự liên kết theo email và ưu tiên scope từ hồ sơ đó.
  const { data: employee } = await admin
    .from("employees")
    .select("id,department,area,branch,team,department_id,area_id,branch_id,team_id")
    .or(`work_email.eq.${email},personal_email.eq.${email}`)
    .limit(1)
    .maybeSingle();
  if (employee) {
    department = department || clean(employee.department);
    area = area || clean(employee.area);
    branch = branch || clean(employee.branch);
    team = team || clean(employee.team);
  }

  async function findOrCreateUnit(unitType: string, value: string | null, parentId: string | null) {
    if (!value) return null;
    let query = admin.from("org_units").select("id").eq("unit_type", unitType).or(`name.ilike.${value},code.ilike.${value}`);
    query = parentId ? query.eq("parent_id", parentId) : query.is("parent_id", null);
    const { data: existing } = await query.limit(1).maybeSingle();
    if (existing?.id) return existing.id as string;
    const code = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toUpperCase().slice(0, 48) || unitType.toUpperCase();
    const { data: created, error } = await admin.from("org_units").insert({ unit_type: unitType, code, name: value, parent_id: parentId }).select("id").single();
    if (error) throw error;
    return created.id as string;
  }

  let departmentId = employee?.department_id || null;
  let areaId = employee?.area_id || null;
  let branchId = employee?.branch_id || null;
  let teamId = employee?.team_id || null;
  try {
    const companyId = await findOrCreateUnit("company", "UNITE GROUP", null);
    if (!departmentId) departmentId = await findOrCreateUnit("department", department, companyId);
    if (!areaId) areaId = await findOrCreateUnit("area", area, companyId);
    if (!branchId) branchId = await findOrCreateUnit("branch", branch, areaId || companyId);
    if (!teamId) teamId = await findOrCreateUnit("team", team, branchId || areaId || companyId);
  } catch (error) {
    return json({ message: `Không tạo được cây tổ chức: ${error instanceof Error ? error.message : String(error)}` }, 500);
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { employee_code: employeeCode, full_name: fullName, role_type: roleType, department, area, branch, team }
  });
  if (createError || !created.user) {
    const statusCode = /already|registered|exists/i.test(createError?.message || "") ? 409 : 400;
    return json({ message: createError?.message || "Không tạo được Auth user." }, statusCode);
  }

  const profile = {
    id: created.user.id,
    employee_code: employeeCode,
    full_name: fullName,
    email,
    phone: null,
    role_type: roleType,
    department,
    area,
    branch,
    team,
    status,
    min_days_per_month: minDays,
    employee_record_id: employee?.id || null,
    department_id: departmentId,
    area_id: areaId,
    branch_id: branchId,
    team_id: teamId,
    must_change_password: mustChangePassword
  };

  const { error: profileError } = await admin.from("profiles").insert(profile);
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    const statusCode = profileError.code === "23505" ? 409 : 500;
    return json({ message: `Không tạo được hồ sơ; Auth user đã được hoàn tác. ${profileError.message}` }, statusCode);
  }

  if (teamId || branchId || areaId || departmentId) {
    const primaryUnitId = teamId || branchId || areaId || departmentId;
    await admin.from("org_memberships").insert({ profile_id: created.user.id, role_type: roleType, org_unit_id: primaryUnitId, is_primary: true });
  }

  return json({ ok: true, user_id: created.user.id, profile }, 201);
});
