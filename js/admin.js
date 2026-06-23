"use strict";

/* UWS_PAGE_SCOPE */
(() => {

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  supabase,
  ADMIN_ROLES,
  SHIFT_LABELS,
  STATUS_LABELS,
  REASON_LABELS,
  formatDate,
  toISODate,
  getMonday,
  addDays,
  getCurrentUserAndProfile,
  showMessage
} = window.UWS;

let currentUser = null;
let currentProfile = null;
let selectedWeekStart = getMonday(new Date());
let selectedAdminMonth = new Date();
selectedAdminMonth.setDate(1);
selectedAdminMonth.setHours(0, 0, 0, 0);

let allSchedules = [];

const weekStartInput = document.getElementById("adminWeekStart");
const adminMonthTitle = document.getElementById("adminMonthTitle");
const adminMonthSummary = document.getElementById("adminMonthSummary");
let adminMonthRowsByDate = {};
const profileSettingsTable = document.getElementById("profileSettingsTable");
const profileSettingsMessage = document.getElementById("profileSettingsMessage");
const createAccountMessage = document.getElementById("createAccountMessage");
const createAccountBtn = document.getElementById("createAccountBtn");
const accountAdminPanel = document.getElementById("accountAdminPanel");
const dangerZonePanel = document.getElementById("dangerZonePanel");
const TIME_META_REGEX = /\[\[UWS_TIME:(\d{2}:\d{2})-(\d{2}:\d{2})\]\]\s*/;
const OFF_SUBMITTED_MARKER = "[[UWS_OFF_SUBMITTED]]";
const deleteScheduleModal = document.getElementById("deleteScheduleModal");
const deleteConfirmPassword = document.getElementById("deleteConfirmPassword");
const deleteScheduleMessage = document.getElementById("deleteScheduleMessage");

const changePasswordModal = document.getElementById("changePasswordModal");
const currentPasswordInput = document.getElementById("currentPasswordInput");
const newPasswordInput = document.getElementById("newPasswordInput");
const confirmNewPasswordInput = document.getElementById("confirmNewPasswordInput");
const changePasswordMessage = document.getElementById("changePasswordMessage");
let createAccountBusy = false;
let profileSettingsCache = [];
let scopeProfilesCache = [];
const MANAGED_ROLES = ["SALE","EMPLOYEE","TTS","NVPT","LEADER","BRANCH_MANAGER","AREA_MANAGER","HR","ADMIN","SUPER_ADMIN"];
const ROLE_RANK = { SALE:10, EMPLOYEE:10, TTS:10, NVPT:10, LEADER:20, BRANCH_MANAGER:30, AREA_MANAGER:40, HR:50, ADMIN:60, SUPER_ADMIN:70 };
const ROLE_LABELS = { SALE:"SALE", EMPLOYEE:"NHÂN VIÊN", TTS:"TTS", NVPT:"NVPT", LEADER:"LEADER", BRANCH_MANAGER:"QUẢN LÝ CHI NHÁNH", AREA_MANAGER:"QUẢN LÝ KHU VỰC", HR:"HR", ADMIN:"ADMIN", SUPER_ADMIN:"SUPER_ADMIN" };

const adminAreaFilter = document.getElementById("adminAreaFilter");
const adminBranchFilter = document.getElementById("adminBranchFilter");
const adminTeamFilter = document.getElementById("adminTeamFilter");
const adminScopeNote = document.getElementById("adminScopeNote");
const profileManagerModal = document.getElementById("profileManagerModal");
const profileSearchInput = document.getElementById("profileSearchInput");
const profileSearchSummary = document.getElementById("profileSearchSummary");
const excelExportModal = document.getElementById("excelExportModal");
const excelExportMonth = document.getElementById("excelExportMonth");
const excelExportArea = document.getElementById("excelExportArea");
const excelExportBranch = document.getElementById("excelExportBranch");
const excelExportTeam = document.getElementById("excelExportTeam");
const excelExportStatus = document.getElementById("excelExportStatus");
const excelExportMessage = document.getElementById("excelExportMessage");
const excelExportScopeNote = document.getElementById("excelExportScopeNote");
const downloadExcelBtn = document.getElementById("downloadExcelBtn");

function getAdminCreateUserUrl() {
  return `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/admin-create-user`;
}

function getCreateAccountDeployHint() {
  return "Chạy trong thư mục project: npx supabase link --project-ref yoxpuohxstudwmtglito; npx supabase functions deploy admin-create-user --no-verify-jwt";
}

function setCreateAccountBusy(isBusy) {
  createAccountBusy = isBusy;
  if (!createAccountBtn) return;
  createAccountBtn.disabled = isBusy;
  createAccountBtn.textContent = isBusy ? "Đang tạo..." : "Tạo tài khoản";
}

async function readJsonResponse(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function getCreateAccountErrorMessage(status, statusText, body = {}) {
  const detail = body.message || body.error || body.msg || body.error_description || `${status} ${statusText}`;
  if (status === 404) {
    return `Edge Function admin-create-user chưa được deploy hoặc sai project ref (endpoint trả 404). ${getCreateAccountDeployHint()}`;
  }
  if (status === 401) {
    return `Phiên đăng nhập hoặc JWT của Edge Function không hợp lệ. Hãy đăng nhập lại; nếu vừa deploy function, nhớ dùng --no-verify-jwt. Chi tiết: ${detail}`;
  }
  if (status === 403) {
    return `Tài khoản hiện tại không có quyền tạo vai trò hoặc phạm vi đã chọn. Chi tiết: ${detail}`;
  }
  if (status === 409) {
    return `Email hoặc mã nhân sự đã tồn tại. Chi tiết: ${detail}`;
  }
  if (status === 422) {
    return `Dữ liệu tài khoản chưa hợp lệ. Chi tiết: ${detail}`;
  }
  if (status >= 500) {
    return `Edge Function đang lỗi server. Kiểm tra biến môi trường bảo mật và log của Edge Function. Chi tiết: ${detail}`;
  }
  return detail;
}

async function checkCreateUserFunctionAvailability() {
  if (!canCreateAccounts() || !createAccountMessage) return;

  try {
    const res = await fetch(getAdminCreateUserUrl(), {
      method: "OPTIONS",
      headers: {
        apikey: SUPABASE_ANON_KEY
      }
    });

    if (res.status === 404) {
      showMessage(createAccountMessage, `Chưa deploy Edge Function admin-create-user nên chưa tạo được tài khoản từ web. ${getCreateAccountDeployHint()}`, "warn");
      return;
    }

    if (!res.ok && res.status >= 500) {
      showMessage(createAccountMessage, `Edge Function đang phản hồi lỗi ${res.status}. Kiểm tra Supabase Function logs trước khi tạo tài khoản.`, "warn");
    }
  } catch (err) {
    showMessage(createAccountMessage, `Chưa kết nối được Edge Function admin-create-user. Nếu bấm tạo tài khoản đang báo Failed to fetch thì gần như chắc function chưa deploy/CORS chưa có. ${getCreateAccountDeployHint()}`, "warn");
  }
}

function getWeekDates() {
  return Array.from({ length: 7 }, (_, i) => addDays(selectedWeekStart, i));
}

function getAdminMonthStart() {
  return new Date(selectedAdminMonth.getFullYear(), selectedAdminMonth.getMonth(), 1);
}

function getAdminMonthEnd() {
  return new Date(selectedAdminMonth.getFullYear(), selectedAdminMonth.getMonth() + 1, 0);
}

function getAdminGridDates() {
  const start = getAdminMonthStart();
  const end = getAdminMonthEnd();
  const startDay = start.getDay();
  const startOffset = startDay === 0 ? 6 : startDay - 1;
  const gridStart = addDays(start, -startOffset);
  const endDay = end.getDay();
  const endOffset = endDay === 0 ? 0 : 7 - endDay;
  const gridEnd = addDays(end, endOffset);

  const dates = [];
  let cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    dates.push(new Date(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function sameAdminMonth(date) {
  return date.getMonth() === selectedAdminMonth.getMonth() && date.getFullYear() === selectedAdminMonth.getFullYear();
}

function isToday(date) {
  const now = new Date();
  return date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
}

function parseScheduleNote(note) {
  const raw = String(note || "");
  const match = raw.match(TIME_META_REGEX);
  if (!match) return { cleanNote: raw.trim(), timeText: "" };
  return {
    cleanNote: raw.replace(TIME_META_REGEX, "").trim(),
    timeText: `${match[1]} - ${match[2]}`
  };
}

const LEAVE_PERIOD_LABELS = {
  full_shift: "Toàn bộ ca",
  first_half: "Nửa đầu ca",
  last_half: "Nửa cuối ca",
  custom: "Theo giờ"
};

function normalizeTime(value) {
  return value ? String(value).slice(0, 5) : "";
}

function formatLeavePeriod(row) {
  const period = row.leave_period || "full_shift";
  const start = normalizeTime(row.leave_start_time);
  const end = normalizeTime(row.leave_end_time);
  if (start && end) return `${LEAVE_PERIOD_LABELS[period] || "Theo giờ"} • ${start} - ${end}`;
  return `${LEAVE_PERIOD_LABELS[period] || "Toàn bộ ca"} • ${SHIFT_LABELS[row.shift] || row.shift}`;
}

function requireShiftLabel(row) {
  if (row.is_off || row.shift === "off") return "OFF";
  const meta = parseScheduleNote(row.note);
  return `${SHIFT_LABELS[row.shift] || row.shift}${meta.timeText ? ` • ${escapeHtml(meta.timeText)}` : ""}`;
}

function displayProfileName(profile) {
  const name = String(profile?.full_name || "").trim();
  if (name && !name.includes("@")) return name;
  return profile?.employee_code || profile?.email || "Nhân sự";
}

function isSuperAdmin() {
  return currentProfile?.role_type === "SUPER_ADMIN";
}

function isAdmin() {
  return currentProfile?.role_type === "ADMIN";
}

function isLeader() { return currentProfile?.role_type === "LEADER"; }
function isBranchManager() { return currentProfile?.role_type === "BRANCH_MANAGER"; }
function isAreaManager() { return currentProfile?.role_type === "AREA_MANAGER"; }
function isHR() { return currentProfile?.role_type === "HR"; }


function canCreateAccounts() {
  return (ROLE_RANK[currentProfile?.role_type] || 0) >= ROLE_RANK.LEADER;
}

function allowedChildRoles() {
  const role = currentProfile?.role_type;
  const rank = ROLE_RANK[role] || 0;
  return MANAGED_ROLES.filter(target => role === "SUPER_ADMIN" ? ROLE_RANK[target] <= rank : ROLE_RANK[target] < rank);
}

function configureAccountCreatorUI() {
  const canCreate = canCreateAccounts();
  accountAdminPanel?.classList.toggle("hidden", !canCreate);
  if (!canCreate) return;

  const allowed = allowedChildRoles();
  const roleSelect = document.getElementById("newAccountRole");
  if (roleSelect) {
    const previous = roleSelect.value;
    roleSelect.innerHTML = allowed.map(role => `<option value="${role}">${ROLE_LABELS[role] || role}</option>`).join("");
    roleSelect.value = allowed.includes(previous) ? previous : (allowed.includes("SALE") ? "SALE" : allowed[0] || "SALE");
  }

  const role = currentProfile?.role_type || "";
  const eyebrow = document.getElementById("accountPanelEyebrow");
  const title = document.getElementById("accountPanelTitle");
  const description = document.getElementById("accountPanelDescription");
  if (eyebrow) eyebrow.textContent = role;
  if (title) title.textContent = role === "SUPER_ADMIN" ? "Quản trị & tạo tài khoản" : "Tạo tài khoản cấp dưới";
  if (description) description.textContent = role === "SUPER_ADMIN"
    ? "SUPER_ADMIN có thể tạo mọi cấp tài khoản và mở cửa sổ quản lý hồ sơ toàn hệ thống."
    : "Hệ thống tự giới hạn vai trò và phạm vi Khu vực / Chi nhánh / Team theo tài khoản đang đăng nhập.";

  const areaInput = document.getElementById("newAccountArea");
  const branchInput = document.getElementById("newAccountBranch");
  const teamInput = document.getElementById("newAccountTeam");
  const lock = (input, value, locked) => {
    if (!input) return;
    if (locked) input.value = value || "";
    input.readOnly = locked;
    input.classList.toggle("scope-locked", locked);
  };
  lock(areaInput, currentProfile?.area, ["AREA_MANAGER","BRANCH_MANAGER","LEADER"].includes(role));
  lock(branchInput, currentProfile?.branch, ["BRANCH_MANAGER","LEADER"].includes(role));
  lock(teamInput, currentProfile?.team, role === "LEADER");
}

function normalizeScopeValue(value) {
  return String(value || "").trim().toLocaleLowerCase("vi");
}

function uniqueSorted(values) {
  return [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "vi"));
}

function getOperationalScope() {
  const own = {
    area: String(currentProfile?.area || "").trim(),
    branch: String(currentProfile?.branch || "").trim(),
    team: String(currentProfile?.team || "").trim()
  };
  if (isLeader()) return own;
  if (isBranchManager()) return { area: own.area, branch: own.branch, team: String(adminTeamFilter?.value || "").trim() };
  if (isAreaManager()) return { area: own.area, branch: String(adminBranchFilter?.value || "").trim(), team: String(adminTeamFilter?.value || "").trim() };
  return {
    area: String(adminAreaFilter?.value || "").trim(),
    branch: String(adminBranchFilter?.value || "").trim(),
    team: String(adminTeamFilter?.value || "").trim()
  };
}

function profileMatchesScope(profile, scope = getOperationalScope()) {
  if (!profile) return false;
  if (scope.area && normalizeScopeValue(profile.area) !== normalizeScopeValue(scope.area)) return false;
  if (scope.branch && normalizeScopeValue(profile.branch) !== normalizeScopeValue(scope.branch)) return false;
  if (scope.team && normalizeScopeValue(profile.team) !== normalizeScopeValue(scope.team)) return false;
  return true;
}

function getScopedProfiles() {
  return scopeProfilesCache.filter(profile => profile.status === "active" && profileMatchesScope(profile));
}

function setSelectOptions(select, values, allLabel, selectedValue = "", disabled = false) {
  if (!select) return;
  const normalizedSelected = normalizeScopeValue(selectedValue);
  const hasSelected = values.some(value => normalizeScopeValue(value) === normalizedSelected);
  const safeValues = selectedValue && !hasSelected ? [selectedValue, ...values] : values;
  select.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>${safeValues.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
  select.value = selectedValue || "";
  select.disabled = disabled;
}

function rebuildAdminBranchFilter({ preserve = true } = {}) {
  if (!adminBranchFilter) return;
  const selectedArea = (isLeader() || isBranchManager() || isAreaManager())
    ? String(currentProfile?.area || "").trim()
    : String(adminAreaFilter?.value || "").trim();
  const previous = preserve ? String(adminBranchFilter.value || "").trim() : "";
  const branches = uniqueSorted(scopeProfilesCache
    .filter(profile => !selectedArea || normalizeScopeValue(profile.area) === normalizeScopeValue(selectedArea))
    .map(profile => profile.branch));
  if (isLeader() || isBranchManager()) {
    const ownBranch = String(currentProfile?.branch || "").trim();
    setSelectOptions(adminBranchFilter, branches, ownBranch ? "Chi nhánh được phân quyền" : "Chưa cấu hình chi nhánh", ownBranch, true);
  } else {
    const canKeep = branches.some(value => normalizeScopeValue(value) === normalizeScopeValue(previous));
    setSelectOptions(adminBranchFilter, branches, "Tất cả chi nhánh", canKeep ? previous : "", false);
  }
}

function rebuildAdminTeamFilter({ preserve = true } = {}) {
  if (!adminTeamFilter) return;
  const scope = getOperationalScope();
  const previous = preserve ? String(adminTeamFilter.value || "").trim() : "";
  const teams = uniqueSorted(scopeProfilesCache
    .filter(profile => !scope.area || normalizeScopeValue(profile.area) === normalizeScopeValue(scope.area))
    .filter(profile => !scope.branch || normalizeScopeValue(profile.branch) === normalizeScopeValue(scope.branch))
    .map(profile => profile.team));
  if (isLeader()) {
    const ownTeam = String(currentProfile?.team || "").trim();
    setSelectOptions(adminTeamFilter, teams, ownTeam ? "Team của Leader" : "Chưa cấu hình team", ownTeam, true);
  } else {
    const canKeep = teams.some(team => normalizeScopeValue(team) === normalizeScopeValue(previous));
    setSelectOptions(adminTeamFilter, teams, "Tất cả team", canKeep ? previous : "", false);
  }
}

function updateAdminScopeNote() {
  if (!adminScopeNote) return;
  const scope = getOperationalScope();
  const role = currentProfile?.role_type;
  if (isLeader() && (!scope.area || !scope.branch || !scope.team)) {
    adminScopeNote.textContent = "Leader chưa được cấu hình đủ Khu vực, Chi nhánh và Team."; return;
  }
  if (isBranchManager() && (!scope.area || !scope.branch)) {
    adminScopeNote.textContent = "Quản lý chi nhánh chưa được cấu hình đủ Khu vực và Chi nhánh."; return;
  }
  if (isAreaManager() && !scope.area) {
    adminScopeNote.textContent = "Quản lý khu vực chưa được cấu hình Khu vực."; return;
  }
  const parts = [];
  if (scope.area) parts.push(`Khu vực ${scope.area}`);
  if (scope.branch) parts.push(`Chi nhánh ${scope.branch}`);
  if (scope.team) parts.push(`Team ${scope.team}`);
  adminScopeNote.textContent = parts.length ? `Phạm vi ${role}: ${parts.join(" • ")}.` : "Đang xem toàn bộ dữ liệu được phân quyền.";
}

async function loadScopeProfiles() {
  let { data, error } = await supabase
    .from("profiles")
    .select("id, employee_code, full_name, role_type, department, area, branch, team, email, status")
    .in("role_type", MANAGED_ROLES)
    .order("full_name", { ascending: true });
  if (error && /column profiles\.(area|branch|department) does not exist/i.test(error.message || "")) {
    const fallback = await supabase.from("profiles").select("id, employee_code, full_name, role_type, department, area, branch, team, email, status").in("role_type", MANAGED_ROLES).order("full_name", { ascending: true });
    data = (fallback.data || []).map(profile => ({ ...profile, department: null, branch: null })); error = fallback.error;
  }
  if (error) { scopeProfilesCache = []; if (adminScopeNote) adminScopeNote.textContent = `Không tải được phạm vi nhân sự: ${error.message}`; return; }
  scopeProfilesCache = data || [];
  const areas = uniqueSorted(scopeProfilesCache.map(profile => profile.area));
  const ownArea = String(currentProfile?.area || "").trim();
  if (isLeader() || isBranchManager() || isAreaManager()) setSelectOptions(adminAreaFilter, areas, ownArea ? "Khu vực được phân quyền" : "Chưa cấu hình khu vực", ownArea, true);
  else {
    const previousArea = String(adminAreaFilter?.value || "").trim();
    const canKeepArea = areas.some(area => normalizeScopeValue(area) === normalizeScopeValue(previousArea));
    setSelectOptions(adminAreaFilter, areas, "Tất cả khu vực", canKeepArea ? previousArea : "", false);
  }
  rebuildAdminBranchFilter({ preserve: true });
  rebuildAdminTeamFilter({ preserve: true });
  updateAdminScopeNote();
}

async function refreshOperationalData() {
  await Promise.all([
    loadMetrics(),
    loadMonthSummary(),
    loadPendingSchedules(),
    loadPendingLeaves(),
    loadAllSchedules()
  ]);
}

function applyRoleBasedUi() {
  const superOnlyEls = document.querySelectorAll(".super-admin-only");
  superOnlyEls.forEach(el => el.classList.toggle("hidden", !isSuperAdmin()));
  configureAccountCreatorUI();

  const roleLabel = currentProfile?.role_type || "USER";
  const menuBtn = document.getElementById("accountMenuBtn");
  if (menuBtn && !menuBtn.querySelector(".role-pill")) {
    const pill = document.createElement("span");
    pill.className = "role-pill";
    pill.textContent = roleLabel;
    menuBtn.insertBefore(pill, menuBtn.querySelector(".chevron"));
  }
}


function closeAccountMenu() {
  document.getElementById("accountMenu")?.classList.add("hidden");
  document.getElementById("accountMenuBtn")?.setAttribute("aria-expanded", "false");
}

function toggleAccountMenu(event) {
  event?.stopPropagation();
  const menu = document.getElementById("accountMenu");
  const btn = document.getElementById("accountMenuBtn");
  if (!menu || !btn) return;

  const willOpen = menu.classList.contains("hidden");
  menu.classList.toggle("hidden", !willOpen);
  btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function requireAdmin() {
  const result = await getCurrentUserAndProfile();
  currentUser = result.user;
  currentProfile = result.profile;

  if (!currentUser || !currentProfile) {
    window.location.href = "./index.html";
    return false;
  }

  if (currentProfile.status !== "active") {
    await supabase.auth.signOut();
    window.location.href = "./index.html";
    return false;
  }

  if (currentProfile.must_change_password) {
    window.location.href = "./change-password.html";
    return false;
  }

  if (!ADMIN_ROLES.includes(currentProfile.role_type)) {
    window.location.href = "./employee.html";
    return false;
  }

  applyRoleBasedUi();
  return true;
}

async function loadMetrics() {
  const weekDates = getWeekDates();
  const start = toISODate(weekDates[0]);
  const end = toISODate(weekDates[6]);
  const allowedIds = new Set(getScopedProfiles().map(profile => profile.id));

  const [pendingScheduleRes, approvedScheduleRes, pendingLeaveRes] = await Promise.all([
    supabase.from("schedule_requests").select("employee_id").eq("status", "pending"),
    supabase.from("schedule_requests").select("employee_id").eq("status", "approved").gte("work_date", start).lte("work_date", end),
    supabase.from("leave_requests").select("employee_id").eq("status", "pending")
  ]);

  const countScoped = rows => (rows || []).filter(row => allowedIds.has(row.employee_id)).length;
  const employeeCount = getScopedProfiles().filter(profile => ["SALE","EMPLOYEE","TTS","NVPT"].includes(profile.role_type)).length;

  document.getElementById("pendingScheduleCount").textContent = countScoped(pendingScheduleRes.data);
  document.getElementById("approvedWeekCount").textContent = countScoped(approvedScheduleRes.data);
  document.getElementById("pendingLeaveCount").textContent = countScoped(pendingLeaveRes.data);
  document.getElementById("employeeCount").textContent = employeeCount;
}

function renderProfileSettings(query = "") {
  if (!profileSettingsTable || !isSuperAdmin()) return;

  const normalized = String(query || "").trim().toLocaleLowerCase("vi");
  const filtered = !normalized
    ? profileSettingsCache
    : profileSettingsCache.filter(profile => [
        profile.employee_code,
        profile.full_name,
        profile.email,
        profile.role_type,
        profile.department,
        profile.area,
        profile.branch,
        profile.team,
        profile.status
      ].some(value => String(value || "").toLocaleLowerCase("vi").includes(normalized)));

  if (profileSearchSummary) {
    profileSearchSummary.textContent = normalized
      ? `Tìm thấy ${filtered.length}/${profileSettingsCache.length} tài khoản phù hợp.`
      : `Đang hiển thị ${profileSettingsCache.length} tài khoản.`;
  }

  if (!filtered.length) {
    profileSettingsTable.innerHTML = `<tr><td colspan="11" class="empty-row">Không tìm thấy tài khoản phù hợp.</td></tr>`;
    return;
  }

  profileSettingsTable.innerHTML = filtered.map(profile => `
    <tr data-profile-id="${profile.id}">
      <td><b>${escapeHtml(profile.employee_code || "")}</b></td>
      <td><input class="profile-name-input" type="text" value="${escapeHtml(profile.full_name || "")}" placeholder="Nhập họ tên" /></td>
      <td><span class="muted">${escapeHtml(profile.email || "")}</span></td>
      <td>
        <select class="profile-role-input">
          ${MANAGED_ROLES.map(role => `<option value="${role}" ${profile.role_type === role ? "selected" : ""}>${role}</option>`).join("")}
        </select>
      </td>
      <td><input class="profile-department-input" type="text" value="${escapeHtml(profile.department || "")}" placeholder="Phòng ban" /></td>
      <td><input class="profile-area-input" type="text" value="${escapeHtml(profile.area || "")}" placeholder="Khu vực" /></td>
      <td><input class="profile-branch-input" type="text" value="${escapeHtml(profile.branch || "")}" placeholder="Chi nhánh" /></td>
      <td><input class="profile-team-input" type="text" value="${escapeHtml(profile.team || "")}" placeholder="Team" /></td>
      <td><input class="profile-target-input" type="number" min="0" max="31" value="${Number(profile.min_days_per_month || 0)}" /></td>
      <td>
        <select class="profile-status-input">
          <option value="active" ${profile.status === "active" ? "selected" : ""}>active</option>
          <option value="inactive" ${profile.status === "inactive" ? "selected" : ""}>inactive</option>
        </select>
      </td>
      <td><button class="btn primary profile-save-btn" type="button" data-profile-id="${profile.id}">Lưu</button></td>
    </tr>
  `).join("");
}

async function loadProfileSettings() {
  if (!profileSettingsTable || !isSuperAdmin()) return;

  profileSettingsTable.innerHTML = `<tr><td colspan="11" class="empty-row">Đang tải danh sách tài khoản...</td></tr>`;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, employee_code, full_name, email, phone, role_type, department, area, branch, team, status, min_days_per_month")
    .in("role_type", MANAGED_ROLES)
    .order("role_type", { ascending: true })
    .order("employee_code", { ascending: true });

  if (error) {
    profileSettingsCache = [];
    profileSettingsTable.innerHTML = `<tr><td colspan="11" class="empty-row">${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  profileSettingsCache = data || [];
  renderProfileSettings(profileSearchInput?.value || "");
}

function openProfileManager() {
  if (!isSuperAdmin()) return;
  profileManagerModal?.classList.remove("hidden");
  document.body.classList.add("modal-open");
  loadProfileSettings().then(() => profileSearchInput?.focus());
}

function closeProfileManager() {
  profileManagerModal?.classList.add("hidden");
  document.body.classList.remove("modal-open");
  if (profileSettingsMessage) showMessage(profileSettingsMessage, "");
}

async function updateProfileSetting(profileId) {
  if (!isSuperAdmin()) {
    showMessage(profileSettingsMessage, "Chỉ SUPER_ADMIN mới được quản trị tài khoản.", "err");
    return;
  }

  const row = document.querySelector(`tr[data-profile-id="${profileId}"]`);
  if (!row) return;

  const fullName = row.querySelector(".profile-name-input")?.value.trim();
  const roleType = row.querySelector(".profile-role-input")?.value;
  const department = row.querySelector(".profile-department-input")?.value.trim();
  const area = row.querySelector(".profile-area-input")?.value.trim();
  const branch = row.querySelector(".profile-branch-input")?.value.trim();
  const team = row.querySelector(".profile-team-input")?.value.trim();
  const minDays = Number(row.querySelector(".profile-target-input")?.value || 0);
  const status = row.querySelector(".profile-status-input")?.value;

  if (profileId === currentUser?.id && (roleType !== "SUPER_ADMIN" || status !== "active")) {
    showMessage(profileSettingsMessage, "Không thể tự hạ quyền hoặc khóa tài khoản SUPER_ADMIN đang đăng nhập.", "err");
    await loadProfileSettings();
    return;
  }

  if (!fullName || fullName.length < 2) {
    showMessage(profileSettingsMessage, "Vui lòng nhập họ tên hợp lệ.", "err");
    return;
  }

  if (Number.isNaN(minDays) || minDays < 0 || minDays > 31) {
    showMessage(profileSettingsMessage, "Chỉ tiêu tháng phải từ 0 đến 31 ngày.", "err");
    return;
  }

  if (roleType === "LEADER" && (!area || !branch || !team)) {
    showMessage(profileSettingsMessage, "Hồ sơ LEADER cần có đủ Khu vực, Chi nhánh và Team.", "err");
    return;
  }
  if (roleType === "BRANCH_MANAGER" && (!area || !branch)) {
    showMessage(profileSettingsMessage, "Hồ sơ Quản lý chi nhánh cần có đủ Khu vực và Chi nhánh.", "err");
    return;
  }
  if (roleType === "AREA_MANAGER" && !area) {
    showMessage(profileSettingsMessage, "Hồ sơ Quản lý khu vực cần có Khu vực.", "err");
    return;
  }

  showMessage(profileSettingsMessage, "Đang lưu cấu hình nhân sự...");

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: fullName,
      role_type: roleType,
      department: department || null,
      area: area || null,
      branch: branch || null,
      team: team || null,
      min_days_per_month: minDays,
      status
    })
    .eq("id", profileId);

  if (error) {
    showMessage(profileSettingsMessage, error.message, "err");
    return;
  }

  showMessage(profileSettingsMessage, "Đã lưu cấu hình nhân sự.", "ok");
  await refreshAll();
}

function getAccountFormPayload() {
  return {
    email: document.getElementById("newAccountEmail")?.value.trim() || "",
    password: document.getElementById("newAccountPassword")?.value || "",
    employee_code: document.getElementById("newAccountCode")?.value.trim() || "",
    full_name: document.getElementById("newAccountName")?.value.trim() || "",
    role_type: document.getElementById("newAccountRole")?.value || "SALE",
    department: document.getElementById("newAccountDepartment")?.value.trim() || null,
    area: document.getElementById("newAccountArea")?.value.trim() || null,
    branch: document.getElementById("newAccountBranch")?.value.trim() || null,
    team: document.getElementById("newAccountTeam")?.value.trim() || null,
    min_days_per_month: Number(document.getElementById("newAccountTarget")?.value || 0),
    status: document.getElementById("newAccountStatus")?.value || "active"
  };
}

function clearAccountForm(options = {}) {
  ["newAccountEmail", "newAccountPassword", "newAccountCode", "newAccountName", "newAccountDepartment", "newAccountArea", "newAccountBranch"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const team = document.getElementById("newAccountTeam");
  const target = document.getElementById("newAccountTarget");
  const role = document.getElementById("newAccountRole");
  const status = document.getElementById("newAccountStatus");
  if (team) team.value = "UNITE";
  if (target) target.value = "12";
  if (role) role.value = "SALE";
  if (status) status.value = "active";
  if (options.clearMessage !== false) showMessage(createAccountMessage, "");
}

function validateAccountPayload(payload) {
  if (!payload.email || !payload.email.includes("@")) return "Email đăng nhập chưa hợp lệ.";
  if (!payload.password || payload.password.length < 8) return "Mật khẩu tạm cần tối thiểu 8 ký tự.";
  if (!payload.employee_code || payload.employee_code.length < 3) return "Mã nhân sự chưa hợp lệ.";
  if (!payload.full_name || payload.full_name.length < 2) return "Họ tên hiển thị chưa hợp lệ.";
  if (!Number.isFinite(payload.min_days_per_month) || payload.min_days_per_month < 0 || payload.min_days_per_month > 31) return "Chỉ tiêu tháng phải từ 0 đến 31 ngày.";
  if (!MANAGED_ROLES.includes(payload.role_type)) return "Vai trò chưa hợp lệ.";
  if (!allowedChildRoles().includes(payload.role_type)) return `Bạn không được tạo tài khoản ${payload.role_type}.`;
  if (payload.role_type === "LEADER" && (!payload.area || !payload.branch || !payload.team)) return "LEADER cần đủ Khu vực, Chi nhánh và Team.";
  if (payload.role_type === "BRANCH_MANAGER" && (!payload.area || !payload.branch)) return "Quản lý chi nhánh cần đủ Khu vực và Chi nhánh.";
  if (payload.role_type === "AREA_MANAGER" && !payload.area) return "Quản lý khu vực cần có Khu vực.";
  return "";
}

async function createAccount() {
  if (createAccountBusy) return;

  if (!canCreateAccounts()) {
    showMessage(createAccountMessage, "Tài khoản hiện tại không có quyền tạo tài khoản cấp dưới.", "err");
    return;
  }

  const payload = getAccountFormPayload();
  const validationError = validateAccountPayload(payload);
  if (validationError) {
    showMessage(createAccountMessage, validationError, "err");
    return;
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) {
    showMessage(createAccountMessage, "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.", "err");
    return;
  }

  showMessage(createAccountMessage, "Đang tạo tài khoản qua Edge Function admin-create-user...");

  setCreateAccountBusy(true);
  try {
    const res = await fetch(getAdminCreateUserUrl(), {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const json = await readJsonResponse(res);

    if (!res.ok) {
      const message = getCreateAccountErrorMessage(res.status, res.statusText, json);
      showMessage(createAccountMessage, `Không tạo được tài khoản: ${message}`, "err");
      return;
    }

    clearAccountForm({ clearMessage: false });
    showMessage(createAccountMessage, "Đã tạo tài khoản và hồ sơ nhân sự. Nhân sự có thể đăng nhập ngay.", "ok");
    await refreshAll();
  } catch (err) {
    showMessage(createAccountMessage, `Không gọi được Edge Function admin-create-user. Endpoint hiện tại: ${getAdminCreateUserUrl()}. ${getCreateAccountDeployHint()}. Chi tiết trình duyệt: ${err.message}`, "err");
  } finally {
    setCreateAccountBusy(false);
  }
}

async function loadMonthSummary() {
  const startIso = toISODate(getAdminMonthStart());
  const endIso = toISODate(getAdminMonthEnd());

  const [scheduleRes, offRes] = await Promise.all([
    supabase
      .from("schedule_requests")
      .select("id, work_date, shift, status, note, submitted_at, profiles:employee_id(full_name, employee_code, area, team, email, role_type)")
      .gte("work_date", startIso)
      .lte("work_date", endIso)
      .in("status", ["pending", "approved"])
      .order("work_date", { ascending: true })
      .order("submitted_at", { ascending: true }),
    supabase
      .from("unavailability")
      .select("id, unavailable_date, shift, status, note, created_at, profiles:employee_id(full_name, employee_code, area, team, email, role_type)")
      .gte("unavailable_date", startIso)
      .lte("unavailable_date", endIso)
      .eq("status", "active")
      .order("unavailable_date", { ascending: true })
  ]);

  if (scheduleRes.error || offRes.error) {
    adminMonthSummary.innerHTML = `<div class="empty-row">${escapeHtml(scheduleRes.error?.message || offRes.error?.message || "Không tải được lịch tháng.")}</div>`;
    return;
  }

  adminMonthTitle.textContent = `Đang xem Tháng ${selectedAdminMonth.getMonth() + 1}/${selectedAdminMonth.getFullYear()}`;

  const offRows = (offRes.data || [])
    .filter(row => String(row.note || "").includes(OFF_SUBMITTED_MARKER))
    .map(row => ({
      ...row,
      id: `off:${row.id}`,
      work_date: row.unavailable_date,
      shift: "off",
      status: "off",
      is_off: true,
      note: String(row.note || "").replace(OFF_SUBMITTED_MARKER, "").trim()
    }));

  const scopedSchedules = (scheduleRes.data || []).filter(row => profileMatchesScope(row.profiles));
  const scopedOffRows = offRows.filter(row => profileMatchesScope(row.profiles));
  const rowsAll = [...scopedSchedules, ...scopedOffRows];
  const byDate = {};
  rowsAll.forEach(row => {
    const iso = String(row.work_date).slice(0, 10);
    byDate[iso] ||= [];
    byDate[iso].push(row);
  });
  adminMonthRowsByDate = byDate;

  const dates = getAdminGridDates();
  adminMonthSummary.innerHTML = dates.map(date => {
    const iso = toISODate(date);
    const rows = byDate[iso] || [];
    const approved = rows.filter(row => row.status === "approved").length;
    const pending = rows.filter(row => row.status === "pending").length;
    const offCount = rows.filter(row => row.status === "off").length;
    const weeklyOff = date.getDay() === 0;
    const isOtherMonth = !sameAdminMonth(date) ? "is-other-month" : "";
    const isTodayClass = isToday(date) ? "is-today" : "";
    const eventClass = rows.length ? "has-events" : "";
    const pendingClass = pending ? "has-pending" : "";
    const approvedClass = approved ? "has-approved" : "";
    const offClass = offCount ? "has-off" : "";
    const weeklyOffClass = weeklyOff ? "is-weekly-off" : "";

    const existingEventsHtml = rows.length
      ? rows.map(row => `
          <div class="admin-event ${row.status}">
            <div class="admin-event-name">${escapeHtml(displayProfileName(row.profiles))}</div>
            <div class="admin-event-meta">${escapeHtml(requireShiftLabel(row))}</div>
          </div>
        `).join("")
      : "";
    const eventsHtml = weeklyOff
      ? `<div class="admin-weekly-off"><b>Chủ Nhật</b><span>Nghỉ hàng tuần</span></div>${existingEventsHtml}`
      : (existingEventsHtml || `<div class="admin-empty-cell">Trống</div>`);

    return `
      <div class="calendar-cell admin-calendar-cell ${isOtherMonth} ${isTodayClass} ${eventClass} ${pendingClass} ${approvedClass} ${offClass} ${weeklyOffClass}" data-date="${iso}">
        <div class="cell-top">
          <div>
            <div class="date-number">${date.getDate()}</div>
            <div class="date-small">${formatDate(iso)}</div>
          </div>
          <div class="admin-day-stats">
            ${weeklyOff ? `<span class="admin-chip weekly-off">CN OFF</span>` : `
              <span class="admin-chip ok">Duyệt ${approved}</span>
              <span class="admin-chip pending">Chờ ${pending}</span>
              ${offCount ? `<span class="admin-chip off">OFF ${offCount}</span>` : ""}
            `}
          </div>
        </div>
        <div class="admin-events-wrap">${eventsHtml}</div>
      </div>
    `;
  }).join("");
}

async function loadPendingSchedules() {
  const { data, error } = await supabase
    .from("schedule_requests")
    .select("*, profiles:employee_id(employee_code,full_name,role_type,area,team)")
    .eq("status", "pending")
    .order("work_date", { ascending: true })
    .order("submitted_at", { ascending: true });

  const tbody = document.getElementById("pendingScheduleTable");
  if (error) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-row">${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  const scopedData = (data || []).filter(row => profileMatchesScope(row.profiles));
  if (!scopedData.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-row">Không có yêu cầu chờ duyệt trong phạm vi đang chọn.</td></tr>`;
    return;
  }

  tbody.innerHTML = scopedData.map(row => {
    const meta = parseScheduleNote(row.note);
    return `
      <tr>
        <td><input type="checkbox" class="schedule-check" value="${row.id}" /></td>
        <td><b>${escapeHtml(displayProfileName(row.profiles))}</b><br><span class="muted">${escapeHtml(row.profiles?.employee_code || "")}</span></td>
        <td>${escapeHtml(row.profiles?.role_type || "")}</td>
        <td>${escapeHtml(row.profiles?.area || "")}</td>
        <td>${escapeHtml(row.profiles?.team || "")}</td>
        <td>${formatDate(row.work_date)}</td>
        <td>${SHIFT_LABELS[row.shift] || row.shift}${meta.timeText ? `<br><span class="muted">${escapeHtml(meta.timeText)}</span>` : ""}</td>
        <td>${escapeHtml(meta.cleanNote || "")}</td>
      </tr>
    `;
  }).join("");
}

async function loadPendingLeaves() {
  const { data, error } = await supabase
    .from("leave_requests")
    .select("*, profiles:employee_id(employee_code,full_name,role_type,area,team)")
    .eq("status", "pending")
    .order("leave_date", { ascending: true });

  const tbody = document.getElementById("pendingLeaveTable");
  if (error) {
    tbody.innerHTML = `<tr><td colspan="11" class="empty-row">${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  const scopedData = (data || []).filter(row => profileMatchesScope(row.profiles));
  if (!scopedData.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="empty-row">Không có yêu cầu xin nghỉ chờ duyệt trong phạm vi đang chọn.</td></tr>`;
    return;
  }

  tbody.innerHTML = scopedData.map(row => `
    <tr>
      <td><input type="checkbox" class="leave-check" value="${row.id}" /></td>
      <td><b>${escapeHtml(displayProfileName(row.profiles))}</b><br><span class="muted">${escapeHtml(row.profiles?.employee_code || "")}</span></td>
      <td>${escapeHtml(row.profiles?.area || "")}</td>
      <td>${escapeHtml(row.profiles?.team || "")}</td>
      <td>${formatDate(row.leave_date)}</td>
      <td>${escapeHtml(formatLeavePeriod(row))}</td>
      <td>${REASON_LABELS[row.leave_type] || row.leave_type}</td>
      <td>${row.is_late_notice ? '<span class="badge rejected">Sát giờ</span>' : '<span class="badge approved">Bình thường</span>'}</td>
      <td>${escapeHtml(row.reason_note || "")}</td>
    </tr>
  `).join("");
}

async function loadAllSchedules() {
  const weekDates = getWeekDates();
  const start = toISODate(weekDates[0]);
  const end = toISODate(weekDates[6]);

  const { data, error } = await supabase
    .from("schedule_requests")
    .select("*, profiles:employee_id(employee_code,full_name,role_type,area,team)")
    .gte("work_date", start)
    .lte("work_date", end)
    .order("work_date", { ascending: true });

  const tbody = document.getElementById("allScheduleTable");
  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-row">${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  allSchedules = (data || []).filter(row => profileMatchesScope(row.profiles));
  if (!allSchedules.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-row">Chưa có lịch trong tuần và phạm vi đang chọn.</td></tr>`;
    return;
  }

  tbody.innerHTML = allSchedules.map(row => {
    const meta = parseScheduleNote(row.note);
    return `
      <tr>
        <td><b>${escapeHtml(displayProfileName(row.profiles))}</b><br><span class="muted">${escapeHtml(row.profiles?.employee_code || "")}</span></td>
        <td>${escapeHtml(row.profiles?.role_type || "")}</td>
        <td>${escapeHtml(row.profiles?.area || "")}</td>
        <td>${escapeHtml(row.profiles?.team || "")}</td>
        <td>${formatDate(row.work_date)}</td>
        <td>${SHIFT_LABELS[row.shift] || row.shift}${meta.timeText ? `<br><span class="muted">${escapeHtml(meta.timeText)}</span>` : ""}</td>
        <td><span class="badge ${row.status}">${STATUS_LABELS[row.status] || row.status}</span></td>
      </tr>
    `;
  }).join("");
}

function getCheckedValues(selector) {
  return Array.from(document.querySelectorAll(selector + ":checked")).map(el => el.value);
}

async function updateSchedules(status) {
  const ids = getCheckedValues(".schedule-check");
  const msg = document.getElementById("adminScheduleMessage");

  if (!ids.length) {
    showMessage(msg, "Chưa chọn yêu cầu nào.", "err");
    return;
  }

  const { error } = await supabase
    .from("schedule_requests")
    .update({
      status,
      reviewed_by: currentUser.id,
      reviewed_at: new Date().toISOString()
    })
    .in("id", ids);

  if (error) {
    showMessage(msg, error.message, "err");
    return;
  }

  showMessage(msg, status === "approved" ? "Đã duyệt lịch đã chọn." : "Đã từ chối lịch đã chọn.", "ok");
  await refreshAll();
}

async function updateLeaves(status) {
  const ids = getCheckedValues(".leave-check");
  const msg = document.getElementById("adminLeaveMessage");

  if (!ids.length) {
    showMessage(msg, "Chưa chọn yêu cầu nghỉ nào.", "err");
    return;
  }

  const { error } = await supabase
    .from("leave_requests")
    .update({
      status,
      reviewed_by: currentUser.id,
      reviewed_at: new Date().toISOString()
    })
    .in("id", ids);

  if (error) {
    showMessage(msg, error.message, "err");
    return;
  }

  showMessage(msg, status === "approved" ? "Đã duyệt nghỉ đã chọn." : "Đã từ chối nghỉ đã chọn.", "ok");
  await refreshAll();
}



function clearPasswordForm() {
  if (currentPasswordInput) currentPasswordInput.value = "";
  if (newPasswordInput) newPasswordInput.value = "";
  if (confirmNewPasswordInput) confirmNewPasswordInput.value = "";
  showMessage(changePasswordMessage, "");
}

function openChangePasswordModal() {
  clearPasswordForm();
  changePasswordModal?.classList.remove("hidden");
  setTimeout(() => currentPasswordInput?.focus(), 50);
}

function closeChangePasswordModal() {
  changePasswordModal?.classList.add("hidden");
  clearPasswordForm();
}

async function submitChangePassword() {
  const currentPassword = currentPasswordInput?.value || "";
  const newPassword = newPasswordInput?.value || "";
  const confirmPassword = confirmNewPasswordInput?.value || "";

  if (!currentPassword || !newPassword || !confirmPassword) {
    showMessage(changePasswordMessage, "Vui lòng nhập đầy đủ thông tin.", "err");
    return;
  }

  if (newPassword.length < 8) {
    showMessage(changePasswordMessage, "Mật khẩu mới cần tối thiểu 8 ký tự.", "err");
    return;
  }

  if (newPassword !== confirmPassword) {
    showMessage(changePasswordMessage, "Mật khẩu mới nhập lại chưa khớp.", "err");
    return;
  }

  if (currentPassword === newPassword) {
    showMessage(changePasswordMessage, "Mật khẩu mới không nên trùng mật khẩu hiện tại.", "err");
    return;
  }

  const email = currentUser?.email || currentProfile?.email;
  if (!email) {
    showMessage(changePasswordMessage, "Không tìm thấy email tài khoản. Vui lòng đăng nhập lại.", "err");
    return;
  }

  showMessage(changePasswordMessage, "Đang xác thực mật khẩu hiện tại...");

  const verifyRes = await supabase.auth.signInWithPassword({
    email,
    password: currentPassword
  });

  if (verifyRes.error) {
    showMessage(changePasswordMessage, "Mật khẩu hiện tại chưa đúng.", "err");
    return;
  }

  showMessage(changePasswordMessage, "Mật khẩu hiện tại đúng. Đang cập nhật mật khẩu mới...");

  const updateRes = await supabase.auth.updateUser({
    password: newPassword
  });

  if (updateRes.error) {
    showMessage(changePasswordMessage, `Không đổi được mật khẩu: ${updateRes.error.message}`, "err");
    return;
  }

  showMessage(changePasswordMessage, "Đổi mật khẩu thành công.", "ok");

  setTimeout(() => {
    closeChangePasswordModal();
  }, 700);
}


function openDeleteScheduleModal() {
  if (!isSuperAdmin()) {
    alert("Chỉ SUPER_ADMIN mới được xóa toàn bộ lịch làm.");
    return;
  }
  showMessage(deleteScheduleMessage, "");
  if (deleteConfirmPassword) deleteConfirmPassword.value = "";
  deleteScheduleModal?.classList.remove("hidden");
  setTimeout(() => deleteConfirmPassword?.focus(), 80);
}

function closeDeleteScheduleModal() {
  deleteScheduleModal?.classList.add("hidden");
  showMessage(deleteScheduleMessage, "");
  if (deleteConfirmPassword) deleteConfirmPassword.value = "";
}

async function confirmDeleteAllSchedules() {
  if (!isSuperAdmin()) {
    showMessage(deleteScheduleMessage, "Chỉ SUPER_ADMIN mới được xóa toàn bộ lịch làm.", "err");
    return;
  }

  const password = deleteConfirmPassword?.value || "";

  if (!password) {
    showMessage(deleteScheduleMessage, "Vui lòng nhập lại mật khẩu admin.", "err");
    return;
  }

  const adminEmail = currentUser?.email || currentProfile?.email;
  showMessage(deleteScheduleMessage, "Đang xác minh mật khẩu...");

  const { error: authError } = await supabase.auth.signInWithPassword({
    email: adminEmail,
    password
  });

  if (authError) {
    showMessage(deleteScheduleMessage, "Mật khẩu chưa đúng. Không thể xóa lịch.", "err");
    return;
  }

  showMessage(deleteScheduleMessage, "Mật khẩu đúng. Đang chuẩn bị gửi thông báo cho nhân sự...");

  const { data: employees, error: employeeError } = await supabase
    .from("profiles")
    .select("id, full_name, employee_code, role_type, status")
    .in("role_type", ["TTS", "NVPT"])
    .eq("status", "active");

  if (employeeError) {
    showMessage(deleteScheduleMessage, `Không tải được danh sách nhân sự: ${employeeError.message}`, "err");
    return;
  }

  const now = new Date().toISOString();
  const notifications = (employees || []).map(employee => ({
    recipient_id: employee.id,
    title: "Lịch làm đã được reset",
    message: "Admin đã xóa toàn bộ lịch làm và các ngày OFF đã nộp. Vui lòng tạo lại bản nháp và nộp lịch tuần mới.",
    type: "warn",
    created_by: currentUser.id,
    created_at: now
  }));

  if (notifications.length) {
    const { error: notifyError } = await supabase
      .from("notifications")
      .insert(notifications);

    if (notifyError) {
      showMessage(deleteScheduleMessage, `Chưa gửi được thông báo. Hãy chạy database/upgrade-v4.sql trước. Chi tiết: ${notifyError.message}`, "err");
      return;
    }
  }

  showMessage(deleteScheduleMessage, "Đã gửi thông báo. Đang xóa dữ liệu lịch làm...");

  const { error: leaveDeleteError } = await supabase
    .from("leave_requests")
    .delete()
    .gte("submitted_at", "1970-01-01");

  if (leaveDeleteError) {
    showMessage(deleteScheduleMessage, `Lỗi xóa yêu cầu xin nghỉ: ${leaveDeleteError.message}`, "err");
    return;
  }

  const { error: scheduleDeleteError } = await supabase
    .from("schedule_requests")
    .delete()
    .gte("submitted_at", "1970-01-01");

  if (scheduleDeleteError) {
    showMessage(deleteScheduleMessage, `Lỗi xóa lịch làm: ${scheduleDeleteError.message}`, "err");
    return;
  }

  const { data: offRows, error: offLoadError } = await supabase
    .from("unavailability")
    .select("id, note")
    .eq("status", "active");

  if (offLoadError) {
    showMessage(deleteScheduleMessage, `Lỗi tải danh sách OFF: ${offLoadError.message}`, "err");
    return;
  }

  const offIds = (offRows || [])
    .filter(row => String(row.note || "").includes(OFF_SUBMITTED_MARKER))
    .map(row => row.id);

  if (offIds.length) {
    const { error: offDeleteError } = await supabase
      .from("unavailability")
      .delete()
      .in("id", offIds);

    if (offDeleteError) {
      showMessage(deleteScheduleMessage, `Lỗi xóa các ngày OFF: ${offDeleteError.message}`, "err");
      return;
    }
  }

  showMessage(deleteScheduleMessage, `Đã xóa toàn bộ lịch làm, ${offIds.length} ngày OFF và gửi thông báo cho ${notifications.length} tài khoản.`, "ok");

  setTimeout(async () => {
    closeDeleteScheduleModal();
    await refreshAll();
  }, 900);
}


function monthValueFromDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthRange(monthValue) {
  const [year, month] = String(monthValue || "").split("-").map(Number);
  const safeDate = Number.isInteger(year) && Number.isInteger(month)
    ? new Date(year, month - 1, 1)
    : new Date(selectedAdminMonth);
  const start = new Date(safeDate.getFullYear(), safeDate.getMonth(), 1);
  const end = new Date(safeDate.getFullYear(), safeDate.getMonth() + 1, 0);
  return { start, end, startIso: toISODate(start), endIso: toISODate(end) };
}

function weekdayLabel(dateIso) {
  const day = new Date(`${dateIso}T00:00:00`).getDay();
  return ["Chủ Nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"][day];
}

function normalizeExportTeam(value) {
  return normalizeScopeValue(value);
}

function getExcelExportScope() {
  const own = {
    area: String(currentProfile?.area || "").trim(),
    branch: String(currentProfile?.branch || "").trim(),
    team: String(currentProfile?.team || "").trim()
  };
  if (isLeader()) return own;
  if (isBranchManager()) return { area: own.area, branch: own.branch, team: String(excelExportTeam?.value || "").trim() };
  if (isAreaManager()) return { area: own.area, branch: String(excelExportBranch?.value || "").trim(), team: String(excelExportTeam?.value || "").trim() };
  return {
    area: String(excelExportArea?.value || "").trim(),
    branch: String(excelExportBranch?.value || "").trim(),
    team: String(excelExportTeam?.value || "").trim()
  };
}

function rebuildExcelBranchOptions({ preserve = true } = {}) {
  if (!excelExportBranch) return;
  const selectedArea = ["LEADER","BRANCH_MANAGER","AREA_MANAGER"].includes(currentProfile?.role_type)
    ? String(currentProfile?.area || "").trim()
    : String(excelExportArea?.value || "").trim();
  const previous = preserve ? String(excelExportBranch.value || "").trim() : "";
  const branches = uniqueSorted(scopeProfilesCache
    .filter(profile => profile.status === "active")
    .filter(profile => !selectedArea || normalizeScopeValue(profile.area) === normalizeScopeValue(selectedArea))
    .map(profile => profile.branch));

  if (isLeader() || isBranchManager()) {
    const ownBranch = String(currentProfile?.branch || "").trim();
    setSelectOptions(excelExportBranch, branches, ownBranch ? "Chi nhánh được phân quyền" : "Chưa cấu hình chi nhánh", ownBranch, true);
  } else {
    const canKeep = branches.some(branch => normalizeScopeValue(branch) === normalizeScopeValue(previous));
    setSelectOptions(excelExportBranch, branches, "Tất cả chi nhánh", canKeep ? previous : "", false);
  }
}

function rebuildExcelTeamOptions({ preserve = true } = {}) {
  if (!excelExportTeam) return;
  const scope = getExcelExportScope();
  const previous = preserve ? String(excelExportTeam.value || "").trim() : "";
  const teams = uniqueSorted(scopeProfilesCache
    .filter(profile => profile.status === "active")
    .filter(profile => !scope.area || normalizeScopeValue(profile.area) === normalizeScopeValue(scope.area))
    .filter(profile => !scope.branch || normalizeScopeValue(profile.branch) === normalizeScopeValue(scope.branch))
    .map(profile => profile.team));

  if (isLeader()) {
    const ownTeam = String(currentProfile?.team || "").trim();
    setSelectOptions(excelExportTeam, teams, ownTeam ? "Team của Leader" : "Chưa cấu hình team", ownTeam, true);
  } else {
    const canKeep = teams.some(team => normalizeScopeValue(team) === normalizeScopeValue(previous));
    setSelectOptions(excelExportTeam, teams, "Tất cả team", canKeep ? previous : "", false);
  }
}

function updateExcelScopeNote() {
  if (!excelExportScopeNote) return;
  const { area, branch, team } = getExcelExportScope();
  if (isLeader()) {
    excelExportScopeNote.textContent = area && branch && team
      ? `Leader chỉ xuất bảng chấm công của Khu vực ${area} • Chi nhánh ${branch} • Team ${team}.`
      : "Leader chưa được cấu hình đủ Khu vực, Chi nhánh và Team; vui lòng liên hệ cấp quản lý.";
    return;
  }
  if (isBranchManager()) {
    excelExportScopeNote.textContent = area && branch
      ? `Quản lý chi nhánh chỉ xuất dữ liệu Khu vực ${area} • Chi nhánh ${branch}${team ? ` • Team ${team}` : " • Tất cả team"}.`
      : "Tài khoản chưa được cấu hình đủ Khu vực và Chi nhánh.";
    return;
  }
  if (isAreaManager()) {
    excelExportScopeNote.textContent = area
      ? `Quản lý khu vực chỉ xuất dữ liệu Khu vực ${area}${branch ? ` • Chi nhánh ${branch}` : " • Tất cả chi nhánh"}${team ? ` • Team ${team}` : ""}.`
      : "Tài khoản chưa được cấu hình Khu vực.";
    return;
  }
  const parts = [area ? `Khu vực ${area}` : "Tất cả khu vực", branch ? `Chi nhánh ${branch}` : "Tất cả chi nhánh", team ? `Team ${team}` : "Tất cả team"];
  excelExportScopeNote.textContent = `Phạm vi xuất: ${parts.join(" • ")}.`;
}

async function populateExcelScopeOptions() {
  if (!scopeProfilesCache.length) await loadScopeProfiles();
  const areas = uniqueSorted(scopeProfilesCache.filter(profile => profile.status === "active").map(profile => profile.area));
  if (["LEADER","BRANCH_MANAGER","AREA_MANAGER"].includes(currentProfile?.role_type)) {
    const ownArea = String(currentProfile?.area || "").trim();
    setSelectOptions(excelExportArea, areas, ownArea ? "Khu vực được phân quyền" : "Chưa cấu hình khu vực", ownArea, true);
  } else {
    const previousArea = String(excelExportArea?.value || "").trim();
    const canKeepArea = areas.some(area => normalizeScopeValue(area) === normalizeScopeValue(previousArea));
    setSelectOptions(excelExportArea, areas, "Tất cả khu vực", canKeepArea ? previousArea : "", false);
  }
  rebuildExcelBranchOptions({ preserve: true });
  rebuildExcelTeamOptions({ preserve: true });
  updateExcelScopeNote();
}

async function openExcelExportModal() {
  if (excelExportMonth) excelExportMonth.value = monthValueFromDate(selectedAdminMonth);
  if (excelExportStatus) excelExportStatus.value = "approved";
  showMessage(excelExportMessage, "");
  await populateExcelScopeOptions();
  excelExportModal?.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeExcelExportModal() {
  excelExportModal?.classList.add("hidden");
  document.body.classList.remove("modal-open");
  showMessage(excelExportMessage, "");
}

function setExcelExportBusy(isBusy) {
  if (!downloadExcelBtn) return;
  downloadExcelBtn.disabled = isBusy;
  downloadExcelBtn.textContent = isBusy ? "Đang tạo bảng chấm công..." : "Tải bảng chấm công tháng";
}

function autoFitWorksheet(ws, rows, maxWidth = 34, headerRow = 1) {
  const widths = [];
  rows.forEach(row => row.forEach((value, index) => {
    const textLength = String(value ?? "").length;
    widths[index] = Math.max(widths[index] || 8, Math.min(maxWidth, textLength + 2));
  }));
  ws["!cols"] = widths.map(wch => ({ wch }));
  if (rows.length) {
    ws["!autofilter"] = {
      ref: `A${headerRow}:${window.XLSX.utils.encode_col((rows[headerRow - 1]?.length || 1) - 1)}${rows.length}`
    };
  }
  ws["!freeze"] = { xSplit: 0, ySplit: headerRow };
}

function attendanceShiftCode(shift) {
  if (shift === "full_day") return "X";
  if (shift === "morning") return "S";
  if (shift === "afternoon") return "CH";
  return shift ? String(shift).toUpperCase() : "";
}

function attendanceShiftCredit(shift) {
  if (shift === "full_day") return 1;
  if (shift === "morning" || shift === "afternoon") return 0.5;
  return 0;
}

function parseClockMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function approvedLeaveHours(row) {
  if (row?.status !== "approved") return 0;
  const start = parseClockMinutes(row.leave_start_time);
  const end = parseClockMinutes(row.leave_end_time);
  if (start === null || end === null || end <= start) return 0;
  return Math.round(((end - start) / 60) * 100) / 100;
}

function approvedLeaveCredit(row, plannedCredit) {
  if (row?.status !== "approved") return 0;
  const period = row.leave_period || "full_shift";
  if (period === "full_shift") return plannedCredit > 0 ? plannedCredit : 1;
  if (period === "first_half" || period === "last_half") {
    return Math.min(plannedCredit > 0 ? plannedCredit : 0.5, 0.5);
  }
  return 0;
}

function leaveAttendanceLabel(row) {
  const pendingSuffix = row.status === "pending" ? "?" : "";
  const period = row.leave_period || "full_shift";
  if (period === "first_half") return `NĐ${pendingSuffix}`;
  if (period === "last_half") return `NC${pendingSuffix}`;
  if (period === "custom") {
    const start = normalizeTime(row.leave_start_time);
    const end = normalizeTime(row.leave_end_time);
    return `N ${start}${start && end ? "-" : ""}${end}${pendingSuffix}`.trim();
  }
  return `N${pendingSuffix}`;
}

function shortWeekdayLabel(dateIso) {
  const day = new Date(`${dateIso}T00:00:00`).getDay();
  return ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][day];
}

function excelSafeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "tat-ca-team";
}

function makeAttendanceWorksheet({ profiles, schedules, offs, leaves, busyRows, monthValue, selectedArea, selectedBranch, selectedTeam }) {
  const [year, month] = monthValue.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const profileMap = new Map(profiles.map(profile => [profile.id, profile]));

  const schedulesByEmployeeDate = new Map();
  schedules.forEach(row => {
    const key = `${row.employee_id}|${row.work_date}`;
    if (!schedulesByEmployeeDate.has(key)) schedulesByEmployeeDate.set(key, []);
    schedulesByEmployeeDate.get(key).push(row);
  });
  const offsByEmployeeDate = new Map();
  offs.forEach(row => offsByEmployeeDate.set(`${row.employee_id}|${row.unavailable_date}`, row));
  const leavesByEmployeeDate = new Map();
  leaves.forEach(row => {
    const key = `${row.employee_id}|${row.leave_date}`;
    if (!leavesByEmployeeDate.has(key)) leavesByEmployeeDate.set(key, []);
    leavesByEmployeeDate.get(key).push(row);
  });
  const busyByEmployeeDate = new Map();
  busyRows.forEach(row => {
    const key = `${row.employee_id}|${row.unavailable_date}`;
    if (!busyByEmployeeDate.has(key)) busyByEmployeeDate.set(key, []);
    busyByEmployeeDate.get(key).push(row);
  });

  const staticHeaders = ["STT", "Mã NV", "Họ tên", "Vai trò", "Khu vực", "Chi nhánh", "Team"];
  const dayHeaders = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const dateIso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return `${String(day).padStart(2, "0")}-${shortWeekdayLabel(dateIso)}`;
  });
  const totalHeaders = ["Công lịch", "Nghỉ quy đổi", "Giờ nghỉ", "Công dự kiến", "OFF", "Lịch bận", "Chờ duyệt"];
  const headers = [...staticHeaders, ...dayHeaders, ...totalHeaders];

  const title = `BẢNG CHẤM CÔNG THÁNG ${String(month).padStart(2, "0")}/${year}`;
  const scopeParts = [];
  if (selectedArea) scopeParts.push(`Khu vực: ${selectedArea}`);
  if (selectedBranch) scopeParts.push(`Chi nhánh: ${selectedBranch}`);
  if (selectedTeam) scopeParts.push(`Team: ${selectedTeam}`);
  const scopeText = scopeParts.length ? scopeParts.join(" • ") : "Phạm vi: Tất cả khu vực, chi nhánh và team";
  const legend = "Ký hiệu: X=Cả ngày | S=Buổi sáng | CH=Buổi chiều | OFF=Nghỉ | N=Nghỉ cả ca | NĐ=Nghỉ nửa đầu | NC=Nghỉ nửa cuối | ?=Chờ duyệt | CN=Chủ Nhật";
  const rows = [[title], [scopeText], [legend], [], headers];
  const summaryRows = [["STT", "Mã NV", "Họ tên", "Vai trò", "Khu vực", "Chi nhánh", "Team", "Công lịch", "Nghỉ quy đổi", "Giờ nghỉ", "Công dự kiến", "Ngày OFF", "Lịch bận", "Lịch chờ", "Đơn nghỉ chờ"]];

  profiles.slice().sort((a, b) => displayProfileName(a).localeCompare(displayProfileName(b), "vi")).forEach((profile, profileIndex) => {
    let plannedCredit = 0;
    let leaveCredit = 0;
    let leaveHours = 0;
    let offCount = 0;
    let busyCount = 0;
    let pendingScheduleCount = 0;
    let pendingLeaveCount = 0;
    const dayCells = [];

    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateIso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const isSunday = new Date(`${dateIso}T00:00:00`).getDay() === 0;
      const key = `${profile.id}|${dateIso}`;
      const daySchedules = schedulesByEmployeeDate.get(key) || [];
      const approvedSchedules = daySchedules.filter(row => row.status === "approved");
      const pendingSchedules = daySchedules.filter(row => row.status === "pending");
      const offRow = offsByEmployeeDate.get(key) || null;
      const dayLeaves = leavesByEmployeeDate.get(key) || [];
      const approvedLeaves = dayLeaves.filter(row => row.status === "approved");
      const pendingLeaves = dayLeaves.filter(row => row.status === "pending");
      const dayBusy = busyByEmployeeDate.get(key) || [];

      if (isSunday) {
        dayCells.push("CN");
        continue;
      }

      let dayPlanned = approvedSchedules.reduce((sum, row) => sum + attendanceShiftCredit(row.shift), 0);
      dayPlanned = Math.min(dayPlanned, 1);
      if (!offRow) plannedCredit += dayPlanned;
      pendingScheduleCount += pendingSchedules.length;
      pendingLeaveCount += pendingLeaves.length;

      let dayLeaveCredit = 0;
      approvedLeaves.forEach(row => {
        dayLeaveCredit += approvedLeaveCredit(row, offRow ? 0 : dayPlanned);
        leaveHours += approvedLeaveHours(row);
      });
      dayLeaveCredit = Math.min(dayLeaveCredit, offRow ? 0 : (dayPlanned > 0 ? dayPlanned : 1));
      leaveCredit += dayLeaveCredit;
      if (offRow) offCount += 1;
      if (dayBusy.length) busyCount += 1;

      const approvedCode = approvedSchedules.map(row => attendanceShiftCode(row.shift)).filter(Boolean).join("+");
      const pendingCode = pendingSchedules.map(row => `${attendanceShiftCode(row.shift)}?`).filter(Boolean).join("+");
      const leaveCode = approvedLeaves.map(leaveAttendanceLabel).filter(Boolean).join("+");
      const pendingLeaveCode = pendingLeaves.map(leaveAttendanceLabel).filter(Boolean).join("+");
      const parts = [];
      if (offRow) {
        const conflictCode = [approvedCode, pendingCode].filter(Boolean).join("+");
        parts.push(conflictCode ? `OFF/${conflictCode}!` : "OFF");
      } else {
        if (approvedCode) parts.push(approvedCode);
        if (pendingCode) parts.push(pendingCode);
        if (leaveCode) parts.push(leaveCode);
        if (pendingLeaveCode) parts.push(pendingLeaveCode);
        if (!parts.length && dayBusy.length) {
          const busyLabels = [...new Set(dayBusy.map(row => row.shift === "morning" ? "B:S" : row.shift === "afternoon" ? "B:CH" : "B"))];
          parts.push(busyLabels.join("+"));
        }
      }
      dayCells.push(parts.join("/") || "");
    }

    const expectedCredit = Math.max(0, Math.round((plannedCredit - leaveCredit) * 100) / 100);
    rows.push([
      profileIndex + 1, profile.employee_code || "", displayProfileName(profile), profile.role_type || "", profile.area || "", profile.branch || "", profile.team || "",
      ...dayCells,
      Math.round(plannedCredit * 100) / 100, Math.round(leaveCredit * 100) / 100, Math.round(leaveHours * 100) / 100,
      expectedCredit, offCount, busyCount, pendingScheduleCount + pendingLeaveCount
    ]);
    summaryRows.push([
      profileIndex + 1, profile.employee_code || "", displayProfileName(profile), profile.role_type || "", profile.area || "", profile.branch || "", profile.team || "",
      Math.round(plannedCredit * 100) / 100, Math.round(leaveCredit * 100) / 100, Math.round(leaveHours * 100) / 100,
      expectedCredit, offCount, busyCount, pendingScheduleCount, pendingLeaveCount
    ]);
  });

  const ws = window.XLSX.utils.aoa_to_sheet(rows);
  const lastCol = window.XLSX.utils.encode_col(headers.length - 1);
  const lastRow = rows.length;
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: headers.length - 1 } }
  ];
  ws["!autofilter"] = { ref: `A5:${lastCol}${lastRow}` };
  ws["!freeze"] = { xSplit: 7, ySplit: 5 };
  ws["!cols"] = [
    { wch: 5 }, { wch: 17 }, { wch: 25 }, { wch: 13 }, { wch: 20 }, { wch: 16 }, { wch: 15 },
    ...Array.from({ length: daysInMonth }, () => ({ wch: 7 })),
    { wch: 11 }, { wch: 13 }, { wch: 10 }, { wch: 13 }, { wch: 8 }, { wch: 10 }, { wch: 10 }
  ];
  ws["!rows"] = [{ hpt: 24 }, { hpt: 20 }, { hpt: 34 }, { hpt: 8 }, { hpt: 30 }];

  const wsSummary = window.XLSX.utils.aoa_to_sheet(summaryRows);
  autoFitWorksheet(wsSummary, summaryRows, 26, 1);
  return { ws, wsSummary, profileMap };
}

async function loadLeaveRowsForExport(startIso, endIso, includeAllStatuses) {
  const statuses = includeAllStatuses ? ["approved", "pending"] : ["approved"];
  let result = await supabase
    .from("leave_requests")
    .select("id, employee_id, leave_date, shift, leave_type, leave_period, leave_start_time, leave_end_time, status, reason_note")
    .gte("leave_date", startIso)
    .lte("leave_date", endIso)
    .in("status", statuses)
    .order("leave_date", { ascending: true });

  if (result.error && /leave_period|leave_start_time|leave_end_time|column/i.test(result.error.message || "")) {
    const fallback = await supabase
      .from("leave_requests")
      .select("id, employee_id, leave_date, shift, leave_type, status, reason_note")
      .gte("leave_date", startIso)
      .lte("leave_date", endIso)
      .in("status", statuses)
      .order("leave_date", { ascending: true });
    return {
      data: (fallback.data || []).map(row => ({
        ...row,
        leave_period: "full_shift",
        leave_start_time: null,
        leave_end_time: null
      })),
      error: fallback.error,
      compatibilityMode: !fallback.error
    };
  }
  return { ...result, compatibilityMode: false };
}

async function downloadMonthlyExcel() {
  if (!window.XLSX) {
    showMessage(excelExportMessage, "Thư viện Excel chưa tải được. Hãy kiểm tra mạng rồi tải lại trang.", "err");
    return;
  }

  const monthValue = excelExportMonth?.value;
  if (!monthValue) {
    showMessage(excelExportMessage, "Vui lòng chọn tháng chấm công.", "err");
    return;
  }

  const { area: selectedArea, branch: selectedBranch, team: selectedTeam } = getExcelExportScope();
  if (isLeader() && (!selectedArea || !selectedBranch || !selectedTeam)) {
    showMessage(excelExportMessage, "Hồ sơ Leader chưa có đủ Khu vực, Chi nhánh và Team.", "err");
    return;
  }
  if (isBranchManager() && (!selectedArea || !selectedBranch)) {
    showMessage(excelExportMessage, "Hồ sơ Quản lý chi nhánh chưa có đủ Khu vực và Chi nhánh.", "err");
    return;
  }
  if (isAreaManager() && !selectedArea) {
    showMessage(excelExportMessage, "Hồ sơ Quản lý khu vực chưa có Khu vực.", "err");
    return;
  }

  const { startIso, endIso } = getMonthRange(monthValue);
  const includeAllStatuses = excelExportStatus?.value === "all";
  setExcelExportBusy(true);
  showMessage(excelExportMessage, "Đang tổng hợp bảng chấm công theo từng ngày trong tháng...");

  try {
    const [profileRes, scheduleRes, unavailableRes, leaveRes] = await Promise.all([
      supabase.from("profiles").select("id, employee_code, full_name, role_type, department, area, branch, team, email, status").eq("status", "active").order("full_name", { ascending: true }),
      supabase.from("schedule_requests").select("id, employee_id, work_date, shift, status, note, submitted_at").gte("work_date", startIso).lte("work_date", endIso).in("status", includeAllStatuses ? ["approved", "pending"] : ["approved"]).order("work_date", { ascending: true }),
      supabase.from("unavailability").select("id, employee_id, unavailable_date, shift, status, note, created_at").gte("unavailable_date", startIso).lte("unavailable_date", endIso).eq("status", "active").order("unavailable_date", { ascending: true }),
      loadLeaveRowsForExport(startIso, endIso, includeAllStatuses)
    ]);

    const firstError = profileRes.error || scheduleRes.error || unavailableRes.error || leaveRes.error;
    if (firstError) throw firstError;

    const matches = profile => (!selectedArea || normalizeScopeValue(profile.area) === normalizeScopeValue(selectedArea))
      && (!selectedBranch || normalizeScopeValue(profile.branch) === normalizeScopeValue(selectedBranch))
      && (!selectedTeam || normalizeScopeValue(profile.team) === normalizeScopeValue(selectedTeam));
    const profiles = (profileRes.data || []).filter(matches);
    const allowedIds = new Set(profiles.map(profile => profile.id));
    const schedules = (scheduleRes.data || []).filter(row => allowedIds.has(row.employee_id));
    const unavailability = (unavailableRes.data || []).filter(row => allowedIds.has(row.employee_id));
    const offs = unavailability.filter(row => String(row.note || "").includes(OFF_SUBMITTED_MARKER));
    const busyRows = unavailability.filter(row => !String(row.note || "").includes(OFF_SUBMITTED_MARKER));
    const leaves = (leaveRes.data || []).filter(row => allowedIds.has(row.employee_id));

    const { ws: wsAttendance, wsSummary, profileMap } = makeAttendanceWorksheet({
      profiles, schedules, offs, leaves, busyRows, monthValue, selectedArea, selectedBranch, selectedTeam
    });

    const scheduleRows = [["STT", "Mã NV", "Họ tên", "Vai trò", "Khu vực", "Chi nhánh", "Team", "Ngày", "Thứ", "Ca làm", "Khung giờ", "Trạng thái", "Ghi chú"]];
    schedules.forEach((row, index) => {
      const profile = profileMap.get(row.employee_id) || {};
      const meta = parseScheduleNote(row.note);
      scheduleRows.push([index + 1, profile.employee_code || "", displayProfileName(profile), profile.role_type || "", profile.area || "", profile.branch || "", profile.team || "", row.work_date, weekdayLabel(row.work_date), SHIFT_LABELS[row.shift] || row.shift, meta.timeText || "", STATUS_LABELS[row.status] || row.status, meta.cleanNote || ""]);
    });

    const offRows = [["STT", "Mã NV", "Họ tên", "Vai trò", "Khu vực", "Chi nhánh", "Team", "Ngày OFF", "Thứ", "Ca", "Ghi chú"]];
    offs.forEach((row, index) => {
      const profile = profileMap.get(row.employee_id) || {};
      offRows.push([index + 1, profile.employee_code || "", displayProfileName(profile), profile.role_type || "", profile.area || "", profile.branch || "", profile.team || "", row.unavailable_date, weekdayLabel(row.unavailable_date), SHIFT_LABELS[row.shift] || row.shift || "OFF", String(row.note || "").replace(OFF_SUBMITTED_MARKER, "").trim()]);
    });

    const busyExportRows = [["STT", "Mã NV", "Họ tên", "Vai trò", "Khu vực", "Chi nhánh", "Team", "Ngày bận", "Thứ", "Ca bận", "Lý do/Ghi chú"]];
    busyRows.forEach((row, index) => {
      const profile = profileMap.get(row.employee_id) || {};
      busyExportRows.push([index + 1, profile.employee_code || "", displayProfileName(profile), profile.role_type || "", profile.area || "", profile.branch || "", profile.team || "", row.unavailable_date, weekdayLabel(row.unavailable_date), SHIFT_LABELS[row.shift] || row.shift || "Bận", String(row.note || "").trim()]);
    });

    const leaveRows = [["STT", "Mã NV", "Họ tên", "Vai trò", "Khu vực", "Chi nhánh", "Team", "Ngày nghỉ", "Thứ", "Hình thức", "Khung giờ", "Lý do", "Trạng thái", "Ghi chú"]];
    leaves.forEach((row, index) => {
      const profile = profileMap.get(row.employee_id) || {};
      const timeText = row.leave_start_time && row.leave_end_time ? `${String(row.leave_start_time).slice(0, 5)} - ${String(row.leave_end_time).slice(0, 5)}` : "";
      leaveRows.push([index + 1, profile.employee_code || "", displayProfileName(profile), profile.role_type || "", profile.area || "", profile.branch || "", profile.team || "", row.leave_date, weekdayLabel(row.leave_date), LEAVE_PERIOD_LABELS[row.leave_period] || row.leave_period || "Toàn bộ ca", timeText, REASON_LABELS[row.leave_type] || row.leave_type || "", STATUS_LABELS[row.status] || row.status, row.reason_note || ""]);
    });

    const wb = window.XLSX.utils.book_new();
    const scopeSubject = [selectedArea ? `Khu vực ${selectedArea}` : "Tất cả khu vực", selectedBranch ? `Chi nhánh ${selectedBranch}` : "Tất cả chi nhánh", selectedTeam ? `Team ${selectedTeam}` : "Tất cả team"].join(" • ");
    wb.Props = { Title: `Bảng chấm công tháng ${monthValue}`, Subject: scopeSubject, Author: "Unite Work Schedule", CreatedDate: new Date() };

    const wsSchedules = window.XLSX.utils.aoa_to_sheet(scheduleRows);
    const wsOff = window.XLSX.utils.aoa_to_sheet(offRows);
    const wsBusy = window.XLSX.utils.aoa_to_sheet(busyExportRows);
    const wsLeaves = window.XLSX.utils.aoa_to_sheet(leaveRows);
    autoFitWorksheet(wsSchedules, scheduleRows, 34, 1);
    autoFitWorksheet(wsOff, offRows, 34, 1);
    autoFitWorksheet(wsBusy, busyExportRows, 34, 1);
    autoFitWorksheet(wsLeaves, leaveRows, 34, 1);

    window.XLSX.utils.book_append_sheet(wb, wsAttendance, "Bang cham cong");
    window.XLSX.utils.book_append_sheet(wb, wsSummary, "Tong hop thang");
    window.XLSX.utils.book_append_sheet(wb, wsSchedules, "Lich lam");
    window.XLSX.utils.book_append_sheet(wb, wsOff, "Ngay OFF");
    window.XLSX.utils.book_append_sheet(wb, wsBusy, "Lich ban");
    window.XLSX.utils.book_append_sheet(wb, wsLeaves, "Xin nghi");

    const filename = `bang-cham-cong-${monthValue}-${excelSafeName(selectedArea || "tat-ca-khu-vuc")}-${excelSafeName(selectedBranch || "tat-ca-chi-nhanh")}-${excelSafeName(selectedTeam || "tat-ca-team")}.xlsx`;
    window.XLSX.writeFile(wb, filename, { compression: true });
    const compatText = leaveRes.compatibilityMode ? " Dữ liệu nghỉ cũ được quy đổi về nghỉ toàn ca vì database chưa có các cột nghỉ linh hoạt." : "";
    showMessage(excelExportMessage, `Đã tải ${filename}: ${profiles.length} nhân sự, ${schedules.length} lịch làm, ${offs.length} OFF, ${leaves.length} đơn nghỉ.${compatText}`, "ok");
  } catch (error) {
    const migrationHint = /profiles\.area|column area|area does not exist/i.test(error.message || "")
      ? " Hãy chạy migration 003_area_scope_and_export_fix.sql trước."
      : "";
    showMessage(excelExportMessage, `Không thể tạo bảng chấm công: ${error.message || error}.${migrationHint}`, "err");
  } finally {
    setExcelExportBusy(false);
  }
}


function exportCsv() {
  if (!allSchedules.length) {
    alert("Chưa có dữ liệu để xuất.");
    return;
  }

  const headers = ["Mã NV","Họ tên","Loại","Khu vực","Team","Ngày","Ca","Trạng thái"];
  const rows = allSchedules.map(row => [
    row.profiles?.employee_code || "",
    row.profiles?.full_name || "",
    row.profiles?.role_type || "",
    row.profiles?.area || "",
    row.profiles?.team || "",
    row.work_date,
    requireShiftLabel(row),
    STATUS_LABELS[row.status] || row.status
  ]);

  const csv = [headers, ...rows]
    .map(cols => cols.map(v => `"${String(v).replaceAll('"','""')}"`).join(","))
    .join("\n");

  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `unite-work-schedule-${toISODate(selectedWeekStart)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function logout() {
  await supabase.auth.signOut();
  window.location.href = "./index.html";
}


function isCompactAdminCalendar() {
  return window.matchMedia && window.matchMedia("(max-width: 760px)").matches;
}

function ensureAdminDayDetailModal() {
  let modal = document.getElementById("adminDayDetailModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "adminDayDetailModal";
  modal.className = "liquid-day-modal hidden";
  modal.innerHTML = `
    <div class="liquid-day-backdrop" data-close-admin-day-detail></div>
    <div class="liquid-day-card">
      <div class="liquid-day-head">
        <div>
          <p class="eyebrow">Chi tiết lịch làm</p>
          <h2 id="adminDayDetailTitle">Ngày</h2>
          <p id="adminDayDetailSub" class="muted"></p>
        </div>
        <button class="liquid-close" type="button" data-close-admin-day-detail>×</button>
      </div>
      <div id="adminDayDetailBody"></div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelectorAll("[data-close-admin-day-detail]").forEach(el => {
    el.addEventListener("click", closeAdminDayDetailModal);
  });
  return modal;
}

function closeAdminDayDetailModal() {
  document.getElementById("adminDayDetailModal")?.classList.add("hidden");
}

function openAdminDayDetailModal(dateIso) {
  const modal = ensureAdminDayDetailModal();
  const rows = adminMonthRowsByDate[dateIso] || [];
  const approved = rows.filter(row => row.status === "approved").length;
  const pending = rows.filter(row => row.status === "pending").length;
  const offCount = rows.filter(row => row.status === "off").length;
  const weeklyOff = new Date(`${dateIso}T00:00:00`).getDay() === 0;

  modal.querySelector("#adminDayDetailTitle").textContent = formatDate(dateIso);
  modal.querySelector("#adminDayDetailSub").textContent = weeklyOff
    ? (rows.length
      ? `Chủ Nhật là ngày nghỉ hàng tuần. Có ${rows.length} dữ liệu cũ trong ngày này cần kiểm tra.`
      : "Chủ Nhật là ngày nghỉ hàng tuần.")
    : (rows.length ? `${rows.length} lựa chọn lịch trong ngày này.` : "Ngày này chưa có lịch đăng ký.");

  const eventsHtml = rows.length
    ? rows.map(row => {
        const profile = row.profiles || {};
        const meta = parseScheduleNote(row.note);
        const statusText = row.status === "off" ? "OFF đã chốt" : (STATUS_LABELS[row.status] || row.status);
        return `
          <div class="liquid-event ${row.status}">
            <strong>${escapeHtml(displayProfileName(profile))}</strong>
            <small>${escapeHtml(profile.role_type || "")}${profile.area ? ` • ${escapeHtml(profile.area)}` : ""}${profile.team ? ` • ${escapeHtml(profile.team)}` : ""}</small><br>
            <small><span class="detail-label">Lịch</span>${escapeHtml(requireShiftLabel(row))}</small><br>
            <small><span class="detail-label">Trạng thái</span>${statusText}</small>
            ${meta.cleanNote ? `<p class="liquid-muted">${escapeHtml(meta.cleanNote)}</p>` : ""}
          </div>
        `;
      }).join("")
    : `<div class="liquid-event"><strong>Trống</strong><small>Chưa có nhân sự đăng ký.</small></div>`;

  modal.querySelector("#adminDayDetailBody").innerHTML = `
    <div class="liquid-stat-grid">
      <div class="liquid-stat"><span>Tổng lựa chọn</span><b>${rows.length}</b></div>
      <div class="liquid-stat"><span>Đã duyệt</span><b>${approved}</b></div>
      <div class="liquid-stat"><span>Chờ duyệt</span><b>${pending}</b></div>
      <div class="liquid-stat"><span>OFF</span><b>${offCount}</b></div>
    </div>
    <div class="liquid-event-list">${eventsHtml}</div>
  `;

  modal.classList.remove("hidden");
}

async function refreshAll() {
  await loadScopeProfiles();
  await loadProfileSettings();
  await refreshOperationalData();
}

document.getElementById("logoutBtn")?.addEventListener("click", logout);
document.getElementById("accountMenuBtn")?.addEventListener("click", toggleAccountMenu);
document.getElementById("accountMenu")?.addEventListener("click", event => event.stopPropagation());
document.getElementById("changePasswordBtn")?.addEventListener("click", () => { closeAccountMenu(); openChangePasswordModal(); });
document.addEventListener("click", event => {
  if (!event.target.closest(".account-menu-wrap")) closeAccountMenu();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeAccountMenu();
});
document.getElementById("submitChangePasswordBtn")?.addEventListener("click", submitChangePassword);
document.querySelectorAll("[data-close-password-modal]").forEach(el => {
  el.addEventListener("click", closeChangePasswordModal);
});
document.getElementById("deleteAllScheduleBtn")?.addEventListener("click", openDeleteScheduleModal);
document.getElementById("confirmDeleteAllScheduleBtn")?.addEventListener("click", confirmDeleteAllSchedules);
document.querySelectorAll("[data-close-delete-modal]").forEach(el => {
  el.addEventListener("click", closeDeleteScheduleModal);
});
document.getElementById("openProfileManagerBtn")?.addEventListener("click", openProfileManager);
document.getElementById("refreshProfilesBtn")?.addEventListener("click", loadProfileSettings);
document.getElementById("refreshProfilesModalBtn")?.addEventListener("click", loadProfileSettings);
profileSearchInput?.addEventListener("input", event => renderProfileSettings(event.target.value));
document.getElementById("profileSearchBtn")?.addEventListener("click", () => renderProfileSettings(profileSearchInput?.value || ""));
profileSearchInput?.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    renderProfileSettings(profileSearchInput.value);
  }
});
document.querySelectorAll("[data-close-profile-manager]").forEach(el => el.addEventListener("click", closeProfileManager));
document.getElementById("openExcelExportBtn")?.addEventListener("click", openExcelExportModal);
downloadExcelBtn?.addEventListener("click", downloadMonthlyExcel);
excelExportArea?.addEventListener("change", () => { rebuildExcelBranchOptions({ preserve: false }); rebuildExcelTeamOptions({ preserve: false }); updateExcelScopeNote(); });
excelExportBranch?.addEventListener("change", () => { rebuildExcelTeamOptions({ preserve: false }); updateExcelScopeNote(); });
excelExportTeam?.addEventListener("change", updateExcelScopeNote);
document.querySelectorAll("[data-close-excel-export]").forEach(el => el.addEventListener("click", closeExcelExportModal));
adminAreaFilter?.addEventListener("change", async () => {
  rebuildAdminBranchFilter({ preserve: false });
  rebuildAdminTeamFilter({ preserve: false });
  updateAdminScopeNote();
  await refreshOperationalData();
});
adminBranchFilter?.addEventListener("change", async () => {
  rebuildAdminTeamFilter({ preserve: false });
  updateAdminScopeNote();
  await refreshOperationalData();
});
adminTeamFilter?.addEventListener("change", async () => {
  updateAdminScopeNote();
  await refreshOperationalData();
});
createAccountBtn?.addEventListener("click", createAccount);
document.getElementById("clearAccountFormBtn")?.addEventListener("click", clearAccountForm);
profileSettingsTable?.addEventListener("click", event => {
  const btn = event.target.closest(".profile-save-btn");
  if (!btn) return;
  updateProfileSetting(btn.dataset.profileId);
});

document.getElementById("adminLoadBtn")?.addEventListener("click", async () => {
  selectedWeekStart = getMonday(new Date(weekStartInput.value + "T00:00:00"));
  weekStartInput.value = toISODate(selectedWeekStart);
  await refreshAll();
});
document.getElementById("adminPrevMonthBtn")?.addEventListener("click", async () => {
  selectedAdminMonth.setMonth(selectedAdminMonth.getMonth() - 1);
  await loadMonthSummary();
});
document.getElementById("adminNextMonthBtn")?.addEventListener("click", async () => {
  selectedAdminMonth.setMonth(selectedAdminMonth.getMonth() + 1);
  await loadMonthSummary();
});
document.getElementById("adminTodayBtn")?.addEventListener("click", async () => {
  selectedAdminMonth = new Date();
  selectedAdminMonth.setDate(1);
  selectedAdminMonth.setHours(0, 0, 0, 0);
  await loadMonthSummary();
});
document.getElementById("approveSelectedBtn")?.addEventListener("click", () => updateSchedules("approved"));
document.getElementById("rejectSelectedBtn")?.addEventListener("click", () => updateSchedules("rejected"));
document.getElementById("approveLeaveSelectedBtn")?.addEventListener("click", () => updateLeaves("approved"));
document.getElementById("rejectLeaveSelectedBtn")?.addEventListener("click", () => updateLeaves("rejected"));
document.getElementById("exportCsvBtn")?.addEventListener("click", exportCsv);

document.getElementById("checkAllSchedule")?.addEventListener("change", e => {
  document.querySelectorAll(".schedule-check").forEach(cb => cb.checked = e.target.checked);
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeDeleteScheduleModal();
    closeChangePasswordModal();
    closeAdminDayDetailModal();
    closeProfileManager();
    closeExcelExportModal();
  }
});

document.getElementById("checkAllLeave")?.addEventListener("change", e => {
  document.querySelectorAll(".leave-check").forEach(cb => cb.checked = e.target.checked);
});


adminMonthSummary?.addEventListener("click", event => {
  const cell = event.target.closest(".admin-calendar-cell");
  if (!cell || cell.classList.contains("is-other-month")) return;
  openAdminDayDetailModal(cell.dataset.date);
});

let adminLongPressTimer = null;
adminMonthSummary?.addEventListener("touchstart", event => {
  const cell = event.target.closest(".admin-calendar-cell");
  if (!cell || cell.classList.contains("is-other-month")) return;
  adminLongPressTimer = setTimeout(() => openAdminDayDetailModal(cell.dataset.date), 420);
}, { passive: true });
adminMonthSummary?.addEventListener("touchend", () => {
  clearTimeout(adminLongPressTimer);
}, { passive: true });
adminMonthSummary?.addEventListener("touchmove", () => {
  clearTimeout(adminLongPressTimer);
}, { passive: true });

(async function init() {
  const ok = await requireAdmin();
  if (!ok) return;

  weekStartInput.value = toISODate(selectedWeekStart);
  await refreshAll();
  await checkCreateUserFunctionAvailability();
})();
})();
