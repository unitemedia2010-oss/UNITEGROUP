import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

const ROLE_RANK: Record<string, number> = { SALE:10, EMPLOYEE:10, TTS:10, NVPT:10, LEADER:20, BRANCH_MANAGER:30, AREA_MANAGER:40, HR:50, ADMIN:60, SUPER_ADMIN:70 };
const ALLOWED_ROLES = new Set(Object.keys(ROLE_RANK));
function roleCanCreate(callerRole: string, targetRole: string) {
  const callerRank = ROLE_RANK[callerRole] || 0;
  const targetRank = ROLE_RANK[targetRole] || 999;
  if (callerRole === "SUPER_ADMIN") return targetRank <= callerRank;
  return targetRank < callerRank;
}

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
    } catch { /* fall through */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

function clean(value: unknown): string | null {
  const result = String(value ?? "").trim();
  return result || null;
}

function fold(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleCase(value: unknown): string | null {
  const raw = clean(value)?.replace(/\s+/g, " ");
  if (!raw) return null;
  return raw.toLocaleLowerCase("vi").replace(/(^|[\s-/])([^\s-/])/g, (_match, prefix, char) => `${prefix}${char.toLocaleUpperCase("vi")}`);
}

function canonicalText(value: unknown, field = ""): string | null {
  const raw = clean(value)?.replace(/\s+/g, " ");
  if (!raw) return null;
  const key = fold(raw);
  const special: Record<string, string> = {
    hr: "HR",
    admin: "Admin",
    bld: "BLĐ",
    "ban lanh dao": "BLĐ",
    "kinh doanh": "Kinh Doanh",
    "tinh hoa": "Tinh Hoa",
    "ky tai": "Kỳ Tài",
    "tien phong": "Tiên Phong",
    "buc pha": "Bức Phá",
    "but pha": "Bức Phá",
    "khai pha": "Khai Phá",
    "full time": "Full Time",
    "part time": "Part Time",
    ctv: "CTV",
    tts: "TTS",
    nvpt: "NVPT",
    ontop: "ONTOP",
    one: "O.N.E",
    "o n e": "O.N.E"
  };
  if (special[key]) return special[key];
  if (field === "employee_code") return raw.toUpperCase();
  if (field === "bank" && /^[a-z0-9]{2,12}$/i.test(raw)) return raw.toUpperCase();
  if (field === "branch" && /^[a-z0-9]{2,6}$/i.test(raw)) return raw.toUpperCase();
  if (field === "team" && (/^[a-z0-9.]{2,6}$/i.test(raw) || raw === raw.toUpperCase())) return raw.toUpperCase();
  if (field === "full_name" && raw === raw.toUpperCase()) return titleCase(raw);
  return raw;
}

function validEmail(value: string | null) {
  return Boolean(value && /^\S+@\S+\.\S+$/.test(value));
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

  const { data: caller } = await admin.from("profiles").select("id,role_type,status").eq("id", userData.user.id).single();
  if (!caller || caller.status !== "active" || !["HR","ADMIN","SUPER_ADMIN"].includes(caller.role_type)) {
    return json({ message: "Chỉ HR/Admin/SUPER_ADMIN được thêm nhân sự mới." }, 403);
  }

  let payload: Record<string, unknown>;
  try { payload = await req.json(); }
  catch { return json({ message: "JSON body không hợp lệ." }, 400); }

  const employeeCode = canonicalText(payload.employee_code, "employee_code") || "";
  const fullName = canonicalText(payload.full_name, "full_name") || "";
  const workEmail = clean(payload.work_email)?.toLowerCase() || null;
  const personalEmail = clean(payload.personal_email)?.toLowerCase() || null;
  const email = validEmail(workEmail) ? workEmail : validEmail(personalEmail) ? personalEmail : null;
  const createAccount = Boolean(payload.create_account && email);
  const roleType = String(payload.role_type || "SALE").trim().toUpperCase();
  const temporaryPassword = String(payload.temporary_password || "12345678");

  if (employeeCode.length < 2) return json({ message: "Mã nhân sự chưa hợp lệ." }, 422);
  if (fullName.length < 2) return json({ message: "Họ tên chưa hợp lệ." }, 422);
  if (workEmail && !validEmail(workEmail)) return json({ message: "Email công việc chưa hợp lệ." }, 422);
  if (personalEmail && !validEmail(personalEmail)) return json({ message: "Email cá nhân chưa hợp lệ." }, 422);
  if (!ALLOWED_ROLES.has(roleType)) return json({ message: "Vai trò tài khoản chưa hợp lệ." }, 422);
  if (!roleCanCreate(caller.role_type, roleType)) return json({ message: `${caller.role_type} không được tạo tài khoản ${roleType}.` }, 403);
  if (createAccount && temporaryPassword.length < 8) return json({ message: "Mật khẩu tạm phải có ít nhất 8 ký tự." }, 422);

  const { data: duplicate } = await admin.from("employees").select("id,employee_code,full_name").ilike("employee_code", employeeCode).limit(1).maybeSingle();
  if (duplicate) return json({ message: `Mã nhân sự ${employeeCode} đã thuộc hồ sơ ${duplicate.full_name}.` }, 409);

  async function findOrCreateUnit(unitType: string, value: string | null, parentId: string | null) {
    if (!value) return null;
    let query = admin.from("org_units").select("id").eq("unit_type", unitType).or(`name.ilike.${value},code.ilike.${value}`);
    query = parentId ? query.eq("parent_id", parentId) : query.is("parent_id", null);
    const { data: existing } = await query.limit(1).maybeSingle();
    if (existing?.id) return existing.id as string;
    const code = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toUpperCase().slice(0,48) || unitType.toUpperCase();
    const { data: created, error } = await admin.from("org_units").insert({ unit_type: unitType, code, name: value, parent_id: parentId }).select("id").single();
    if (error) throw error;
    return created.id as string;
  }

  const department = canonicalText(payload.department, "department");
  const area = canonicalText(payload.area, "area");
  const branch = canonicalText(payload.branch, "branch");
  const team = canonicalText(payload.team, "team");
  let departmentId: string | null = null;
  let areaId: string | null = null;
  let branchId: string | null = null;
  let teamId: string | null = null;
  try {
    const companyId = await findOrCreateUnit("company", "UNITE GROUP", null);
    departmentId = await findOrCreateUnit("department", department, companyId);
    areaId = await findOrCreateUnit("area", area, companyId);
    branchId = await findOrCreateUnit("branch", branch, areaId || companyId);
    teamId = await findOrCreateUnit("team", team, branchId || areaId || companyId);
  } catch (error) {
    return json({ message: `Không tạo được cây tổ chức: ${error instanceof Error ? error.message : String(error)}` }, 500);
  }

  const employeePayload = {
    employee_code: employeeCode,
    full_name: fullName,
    work_email: workEmail,
    personal_email: personalEmail,
    phone: clean(payload.phone),
    nickname: canonicalText(payload.nickname, "nickname"),
    department,
    area,
    branch,
    team,
    title: canonicalText(payload.title, "title"),
    employment_level: canonicalText(payload.employment_level, "level"),
    employment_type: canonicalText(payload.employment_type, "type"),
    start_date: clean(payload.start_date),
    employment_status: "active",
    data_quality: email ? "ok" : "needs_review",
    department_id: departmentId,
    area_id: areaId,
    branch_id: branchId,
    team_id: teamId,
    source_file: "portal_manual"
  };

  const { data: employee, error: employeeError } = await admin.from("employees").insert(employeePayload).select("*").single();
  if (employeeError || !employee) return json({ message: employeeError?.message || "Không tạo được hồ sơ nhân sự." }, employeeError?.code === "23505" ? 409 : 500);

  if (!createAccount) return json({ ok: true, employee, account_created: false }, 201);

  const { data: existingProfile } = await admin.from("profiles").select("id").ilike("email", email!).limit(1).maybeSingle();
  if (existingProfile) {
    await admin.from("employees").delete().eq("id", employee.id);
    return json({ message: "Email đã có tài khoản đăng nhập." }, 409);
  }

  const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
    email: email!,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName, employee_code: employeeCode, role_type: roleType }
  });
  if (createUserError || !createdUser.user) {
    await admin.from("employees").delete().eq("id", employee.id);
    return json({ message: createUserError?.message || "Không tạo được tài khoản đăng nhập." }, 400);
  }

  const profile = {
    id: createdUser.user.id,
    employee_code: employeeCode,
    full_name: fullName,
    email: email!,
    phone: clean(payload.phone),
    role_type: roleType,
    department,
    area,
    branch,
    team,
    status: "active",
    min_days_per_month: 12,
    employee_record_id: employee.id,
    department_id: departmentId,
    area_id: areaId,
    branch_id: branchId,
    team_id: teamId,
    must_change_password: true
  };
  const { error: profileError } = await admin.from("profiles").insert(profile);
  if (profileError) {
    await admin.auth.admin.deleteUser(createdUser.user.id);
    await admin.from("employees").delete().eq("id", employee.id);
    return json({ message: `Không tạo được hồ sơ tài khoản: ${profileError.message}` }, 500);
  }

  const primaryUnitId = teamId || branchId || areaId || departmentId;
  if (primaryUnitId) {
    await admin.from("org_memberships").insert({ profile_id: createdUser.user.id, role_type: roleType, org_unit_id: primaryUnitId, is_primary: true });
  }

  return json({ ok: true, employee, account_created: true, user_id: createdUser.user.id }, 201);
});
