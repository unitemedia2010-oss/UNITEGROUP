"use strict";

(() => {
  const { supabase, ADMIN_ROLES, HR_ROLES, ROLE_LABELS, getCurrentUserAndProfile, formatDate, showMessage } = window.UWS;

  const state = {
    user: null,
    profile: null,
    page: "dashboard",
    announcements: [],
    cases: [],
    profiles: new Map(),
    employees: [],
    orgUnits: [],
    importResult: null,
    employeePage: 1,
    employeePageSize: 30,
    employeeVisibleColumns: null,
    employeeSmartFilter: {},
    activeEmployee: null,
    activeEmployeePrivate: null,
    employeePrivateById: new Map(),
    orgEmployees: [],
    importDiff: [],
    importSelected: new Set(),
    scheduleFrameLoaded: false,
    activeCase: null,
    hrAssignees: [],
    subscriptions: [],
    bulkAccounts: [],
    bulkSelected: new Set(),
    bulkAccountBusy: false
  };

  const CASE_STATUS_LABELS = {
    draft: "Bản nháp", submitted: "Mới gửi", in_review: "Đang xử lý", need_info: "Cần bổ sung",
    approved: "Đã duyệt", rejected: "Từ chối", closed: "Đã đóng"
  };
  const CASE_TYPE_LABELS = {
    suggestion: "Ý kiến / kiến nghị", incident: "Báo cáo sự việc", document: "Nộp giấy tờ",
    attendance: "Chấm công / lịch", profile_update: "Bổ sung hồ sơ", complaint: "Khiếu nại",
    hr_support: "Hỗ trợ HR", other: "Khác"
  };
  const EMPLOYEE_STATUS_LABELS = { active: "Đang làm", resigned: "Đã nghỉ", reserved: "Bảo lưu", unknown: "Chưa rõ" };
  const PAGE_TITLES = {
    dashboard: "Tổng quan", announcements: "Trung tâm thông báo", cases: "Yêu cầu & báo cáo HR", "my-profile": "Hồ sơ của tôi",
    employees: "Danh sách nhân sự", organization: "Cây tổ chức", import: "Nhập dữ liệu Excel", schedule: "Lịch làm & chấm công"
  };

  function $(id) { return document.getElementById(id); }
  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }
  function normalize(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/\s+/g, " ");
  }
  function isHR() { return HR_ROLES.includes(state.profile?.role_type); }
  function isManager() { return ADMIN_ROLES.includes(state.profile?.role_type); }
  function isGlobalAdmin() { return ["ADMIN", "SUPER_ADMIN"].includes(state.profile?.role_type); }
  function canEditEmployeeRecords() { return ["BRANCH_MANAGER", "AREA_MANAGER", "HR", "ADMIN", "SUPER_ADMIN"].includes(state.profile?.role_type); }
  function canCreateEmployees() { return ["HR", "ADMIN", "SUPER_ADMIN"].includes(state.profile?.role_type); }
  function roleLabel(role) { return ROLE_LABELS[role] || role || "Nhân viên"; }
  function formatDateTime(value) { return value ? new Date(value).toLocaleString("vi-VN") : ""; }
  function toLocalDateTimeInput(value) {
    if (!value) return "";
    const date = new Date(value);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }
  function defaultDueAt(priority) {
    const hours = priority === "urgent" ? 4 : priority === "high" ? 24 : priority === "low" ? 168 : 72;
    return new Date(Date.now() + hours * 3600000).toISOString();
  }
  function unique(values) { return [...new Set(values.filter(Boolean))].sort((a,b) => String(a).localeCompare(String(b), "vi")); }
  function uniqueCanonical(values, field = "") {
    const byKey = new Map();
    values.forEach(value => {
      const canonical = canonicalDisplay(value, field);
      const key = normalize(canonical);
      if (!key || byKey.has(key)) return;
      byKey.set(key, canonical);
    });
    return [...byKey.values()].sort((a, b) => String(a).localeCompare(String(b), "vi", { sensitivity: "base" }));
  }
  function sameText(a, b) { return normalize(a) === normalize(b); }
  function titleCaseText(value) {
    const raw = String(value ?? "").trim().replace(/\s+/g, " ");
    if (!raw) return "";
    return raw.toLocaleLowerCase("vi").replace(/(^|[\s-/])([^\s-/])/g, (_, prefix, char) => `${prefix}${char.toLocaleUpperCase("vi")}`);
  }
  function canonicalDisplay(value, field = "") {
    const raw = String(value ?? "").trim().replace(/\s+/g, " ");
    if (!raw) return "";
    const key = normalize(raw);
    const special = {
      "hr": "HR",
      "admin": "Admin",
      "bld": "BLĐ",
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
      "ctv": "CTV",
      "tts": "TTS",
      "nvpt": "NVPT",
      "ontop": "ONTOP",
      "one": "O.N.E",
      "o n e": "O.N.E"
    }[key];
    if (special) return special;
    if (field === "employee_code") return raw.toUpperCase();
    if (field === "bank" && /^[a-z0-9]{2,12}$/i.test(raw)) return raw.toUpperCase();
    if (field === "branch" && /^[a-z0-9]{2,6}$/i.test(raw)) return raw.toUpperCase();
    if (field === "team" && (/^[a-z0-9.]{2,6}$/i.test(raw) || raw === raw.toUpperCase())) return raw.toUpperCase();
    if (field === "full_name" && raw === raw.toUpperCase()) return titleCaseText(raw);
    return raw;
  }
  function employeeDisplay(row, field) {
    if (field === "level") return canonicalDisplay(row.employment_level, field);
    if (field === "type") return canonicalDisplay(row.employment_type, field);
    return canonicalDisplay(row?.[field], field);
  }
  function employeePrivate(rowOrId) {
    const id = typeof rowOrId === "string" ? rowOrId : rowOrId?.id;
    return id ? state.employeePrivateById.get(id) || {} : {};
  }
  function employeeCodeGroup(row) {
    const code = String(row?.employee_code || "").trim().toUpperCase();
    const role = String(row?.suggested_role || row?.role_type || "").trim().toUpperCase();
    const type = normalize(row?.employment_type);
    if (/^TTS/.test(code) || role === "TTS" || type === "tts") return "TTS";
    if (/^NVPT/.test(code) || role === "NVPT") return "NVPT";
    if (/^CTV/.test(code) || type === "ctv") return "CTV";
    if (/^(SALE|SAL|S)[A-Z0-9_-]*/.test(code) || role === "SALE") return "Sale";
    if (/^(LD|LEADER)/.test(code) || role === "LEADER") return "Leader";
    if (/^(QL|BM|AM|TPKD|QLCN)/.test(code) || ["BRANCH_MANAGER", "AREA_MANAGER"].includes(role)) return "Quản lý";
    if (/^U\d+/i.test(code)) return "Khối văn phòng/BLĐ";
    return "Nhân sự khác";
  }
  function valueMatchesSelected(value, selected) {
    return !selected || sameText(value, selected);
  }

  function toast(message, type = "ok", duration = 3200) {
    const host = $("toastHost");
    if (!host) return;
    const item = document.createElement("div");
    item.className = `toast-item ${type}`;
    item.textContent = message;
    host.appendChild(item);
    setTimeout(() => { item.style.opacity = "0"; setTimeout(() => item.remove(), 250); }, duration);
  }

  function setLoading(button, loading, text = "Đang xử lý...") {
    if (!button) return;
    if (loading) {
      button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.textContent = text;
    } else {
      button.disabled = false;
      button.textContent = button.dataset.originalText || button.textContent;
    }
  }

  function openModal(id) { $(id)?.classList.remove("hidden"); }
  function closeModal(id) { $(id)?.classList.add("hidden"); }

  function clearPortalPasswordForm() {
    ["portalCurrentPasswordInput", "portalNewPasswordInput", "portalConfirmNewPasswordInput"].forEach(id => {
      if ($(id)) $(id).value = "";
    });
    showMessage($("portalPasswordMessage"), "");
  }

  function openPortalPasswordModal() {
    clearPortalPasswordForm();
    openModal("portalPasswordModal");
    setTimeout(() => $("portalCurrentPasswordInput")?.focus(), 50);
  }

  function closePortalPasswordModal() {
    closeModal("portalPasswordModal");
    clearPortalPasswordForm();
  }

  async function submitPortalPasswordChange() {
    const currentPassword = $("portalCurrentPasswordInput")?.value || "";
    const newPassword = $("portalNewPasswordInput")?.value || "";
    const confirmPassword = $("portalConfirmNewPasswordInput")?.value || "";
    const message = $("portalPasswordMessage");
    if (!currentPassword || !newPassword || !confirmPassword) return showMessage(message, "Vui lòng nhập đầy đủ thông tin.", "err");
    if (newPassword.length < 8) return showMessage(message, "Mật khẩu mới cần tối thiểu 8 ký tự.", "err");
    if (newPassword !== confirmPassword) return showMessage(message, "Mật khẩu mới nhập lại chưa khớp.", "err");
    if (currentPassword === newPassword) return showMessage(message, "Mật khẩu mới không nên trùng mật khẩu hiện tại.", "err");
    const email = state.user?.email || state.profile?.email;
    if (!email) return showMessage(message, "Không tìm thấy email tài khoản. Vui lòng đăng nhập lại.", "err");

    const button = $("submitPortalPasswordBtn");
    setLoading(button, true, "Đang xác thực...");
    showMessage(message, "Đang xác thực mật khẩu hiện tại...");
    try {
      const verifyRes = await supabase.auth.signInWithPassword({ email, password: currentPassword });
      if (verifyRes.error) return showMessage(message, "Mật khẩu hiện tại chưa đúng.", "err");
      showMessage(message, "Mật khẩu hiện tại đúng. Đang cập nhật mật khẩu mới...");
      const updateRes = await supabase.auth.updateUser({ password: newPassword });
      if (updateRes.error) throw updateRes.error;
      showMessage(message, "Đổi mật khẩu thành công.", "ok");
      toast("Đã đổi mật khẩu thành công.");
      setTimeout(closePortalPasswordModal, 700);
    } catch (error) {
      showMessage(message, `Không đổi được mật khẩu: ${error.message || error}`, "err");
    } finally {
      setLoading(button, false);
    }
  }

  function migrationError(error) {
    const message = error?.message || String(error || "");
    return /does not exist|schema cache|relation .* not found|column .* not found/i.test(message)
      ? "Database chưa được cập nhật đủ migration V30. Hãy chạy các migration còn thiếu trên Supabase."
      : message;
  }

  async function invokeWorkspaceBridge(action, payload = {}) {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");

    const response = await fetch(`${window.UWS.SUPABASE_URL.replace(/\/$/, "")}/functions/v1/google-workspace-bridge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
        "apikey": window.UWS.SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ action, ...payload })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) {
      throw new Error(body.message || body.error || `Google Workspace Bridge trả lỗi ${response.status}.`);
    }
    return body;
  }

  async function invokeProtectedFunction(functionName, payload = {}) {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");

    const response = await fetch(`${window.UWS.SUPABASE_URL.replace(/\/$/, "")}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
        "apikey": window.UWS.SUPABASE_ANON_KEY
      },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) {
      throw new Error(body.message || body.error || `${functionName} trả lỗi ${response.status}.`);
    }
    return body;
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const value = String(reader.result || "");
        resolve(value.includes(",") ? value.split(",").pop() : value);
      };
      reader.onerror = () => reject(reader.error || new Error("Không đọc được file."));
      reader.readAsDataURL(file);
    });
  }

  async function init() {
    const result = await getCurrentUserAndProfile();
    state.user = result.user;
    state.profile = result.profile;
    if (!state.user || !state.profile) {
      window.location.replace("./index.html");
      return;
    }
    if (state.profile.must_change_password) {
      window.location.replace("./change-password.html");
      return;
    }

    applyProfileUI();
    bindEvents();
    await Promise.allSettled([loadDashboard(), loadAnnouncements(), loadCases(), isHR() ? loadHrDirectory() : Promise.resolve()]);
    subscribeRealtime();
    registerServiceWorker();
  }

  function applyProfileUI() {
    const profile = state.profile;
    $("portalUserName").textContent = profile.full_name || profile.email;
    $("portalAvatar").textContent = (profile.full_name || profile.email || "U").trim().charAt(0).toUpperCase();
    const scope = [roleLabel(profile.role_type), profile.area, profile.branch, profile.team].filter(Boolean).join(" • ");
    $("portalUserScope").textContent = scope || roleLabel(profile.role_type);
    $("dashboardGreeting").textContent = `Xin chào, ${profile.full_name || "bạn"}`;
    $("dashboardRolePill").textContent = roleLabel(profile.role_type);

    document.querySelectorAll(".hr-only,.hr-only-control,.hr-only-page").forEach(el => el.classList.toggle("hidden", !isHR()));
    const roleRank = { SALE:10, EMPLOYEE:10, TTS:10, NVPT:10, LEADER:20, BRANCH_MANAGER:30, AREA_MANAGER:40, HR:50, ADMIN:60, SUPER_ADMIN:70 };
    const callerRank = roleRank[profile.role_type] || 0;
    document.querySelectorAll("#newEmployeeRole option").forEach(option => {
      const targetRank = roleRank[option.value] || 999;
      option.disabled = profile.role_type === "SUPER_ADMIN" ? targetRank > callerRank : targetRank >= callerRank;
    });
    document.querySelectorAll(".manager-nav,.manager-card,.manager-page,.manager-filter").forEach(el => el.classList.toggle("hidden", !isManager()));
    renderEmployeeColumnControls();
    if (!isHR() && state.page === "import") goToPage("dashboard");
    if (!isManager() && ["employees", "organization"].includes(state.page)) goToPage("dashboard");
  }

  function bindEvents() {
    document.querySelectorAll(".portal-nav-item[data-page]").forEach(btn => btn.addEventListener("click", () => goToPage(btn.dataset.page)));
    document.querySelectorAll("[data-goto]").forEach(btn => btn.addEventListener("click", () => goToPage(btn.dataset.goto)));
    $("portalMenuBtn")?.addEventListener("click", () => $("portalSidebar")?.classList.toggle("open"));
    $("portalLogoutBtn")?.addEventListener("click", async () => { await supabase.auth.signOut(); window.location.replace("./index.html"); });
    $("portalChangePasswordBtn")?.addEventListener("click", openPortalPasswordModal);
    $("submitPortalPasswordBtn")?.addEventListener("click", submitPortalPasswordChange);
    document.querySelectorAll("[data-close-portal-password]").forEach(el => el.addEventListener("click", closePortalPasswordModal));
    $("portalRefreshBtn")?.addEventListener("click", refreshCurrentPage);
    $("portalInboxBtn")?.addEventListener("click", () => goToPage("announcements"));
    $("openScheduleBtn")?.addEventListener("click", () => goToPage("schedule"));
    $("reloadScheduleFrameBtn")?.addEventListener("click", () => loadScheduleFrame(true));
    $("enableBrowserNotificationsBtn")?.addEventListener("click", enableBrowserNotifications);

    $("createAnnouncementBtn")?.addEventListener("click", async () => {
      openModal("announcementModal");
      await prepareAnnouncementTargetOptions();
    });
    document.querySelectorAll("[data-close-announcement]").forEach(el => el.addEventListener("click", () => closeModal("announcementModal")));
    $("announcementTargetType")?.addEventListener("change", updateAnnouncementTargetUI);
    $("publishAnnouncementBtn")?.addEventListener("click", publishAnnouncement);
    ["announcementSearch","announcementPriorityFilter","announcementReadFilter"].forEach(id => $(id)?.addEventListener("input", renderAnnouncements));

    $("createCaseBtn")?.addEventListener("click", () => openModal("caseCreateModal"));
    document.querySelectorAll("[data-close-case-create]").forEach(el => el.addEventListener("click", () => closeModal("caseCreateModal")));
    document.querySelectorAll("[data-close-case-detail]").forEach(el => el.addEventListener("click", () => closeModal("caseDetailModal")));
    $("submitCaseBtn")?.addEventListener("click", createCase);
    $("sendCaseReplyBtn")?.addEventListener("click", sendCaseReply);
    $("caseStatusUpdate")?.addEventListener("change", updateCaseStatus);
    $("saveCaseAssignmentBtn")?.addEventListener("click", saveCaseAssignment);
    ["caseSearch","caseStatusFilter","casePriorityFilter","caseAreaFilter"].forEach(id => $(id)?.addEventListener("input", renderCases));

    ["employeeSearch","employeeStatusFilter","employeeCodeGroupFilter","employeeDepartmentFilter","employeeAreaFilter","employeeBranchFilter","employeeTeamFilter","employeeTitleFilter","employeeLevelFilter","employeeTypeFilter","employeeBankFilter","employeeQualityFilter","employeeSortSelect","employeeGroupSelect"].forEach(id => $(id)?.addEventListener("input", event => { state.employeePage = 1; rebuildEmployeeFilters(event.target.id); renderEmployees(); }));
    $("employeeColumnButtons")?.addEventListener("click", event => {
      const button = event.target.closest("[data-employee-column]");
      if (!button || button.disabled) return;
      toggleEmployeeColumn(button.dataset.employeeColumn);
    });
    $("exportFilteredEmployeesBtn")?.addEventListener("click", exportFilteredEmployees);
    $("applyEmployeeSmartFilterBtn")?.addEventListener("click", applyEmployeeSmartFilter);
    $("employeeSmartFilter")?.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); applyEmployeeSmartFilter(); } });
    $("clearEmployeeFiltersBtn")?.addEventListener("click", clearEmployeeFilters);
    document.querySelectorAll("[data-close-employee-detail]").forEach(el => el.addEventListener("click", () => closeModal("employeeDetailModal")));
    $("linkProfilesBtn")?.addEventListener("click", linkProfilesToEmployees);
    $("openMyEmployeeDetailBtn")?.addEventListener("click", () => {
      const id = state.profile?.employee_record_id;
      if (id) openEmployeeDetail(id);
    });
    $("addEmployeeBtn")?.addEventListener("click", () => openModal("addEmployeeModal"));
    document.querySelectorAll("[data-close-add-employee]").forEach(el => el.addEventListener("click", () => closeModal("addEmployeeModal")));
    $("createEmployeeBtn")?.addEventListener("click", createEmployee);

    $("bulkCreateAccountsBtn")?.addEventListener("click", openBulkAccountModal);
    document.querySelectorAll("[data-close-bulk-account]").forEach(el => el.addEventListener("click", () => closeModal("bulkAccountModal")));
    $("refreshBulkAccountsBtn")?.addEventListener("click", loadBulkAccountPreview);
    $("selectEligibleBulkBtn")?.addEventListener("click", selectAllEligibleBulkAccounts);
    $("clearBulkSelectionBtn")?.addEventListener("click", clearBulkAccountSelection);
    $("createBulkAccountsBtn")?.addEventListener("click", createBulkAccounts);
    ["bulkAccountSearch","bulkAccountStatusFilter","bulkAccountAreaFilter","bulkAccountBranchFilter","bulkAccountTeamFilter"].forEach(id => $(id)?.addEventListener("input", renderBulkAccountTable));
    $("toggleBulkVisible")?.addEventListener("change", toggleVisibleBulkAccounts);
    $("editEmployeeBtn")?.addEventListener("click", () => renderEmployeeDetail(true));
    $("cancelEmployeeEditBtn")?.addEventListener("click", () => renderEmployeeDetail(false));
    $("saveEmployeeBtn")?.addEventListener("click", saveEmployeeDetail);
    $("reportEmployeeCorrectionBtn")?.addEventListener("click", () => openModal("employeeCorrectionModal"));
    document.querySelectorAll("[data-close-employee-correction]").forEach(el => el.addEventListener("click", () => closeModal("employeeCorrectionModal")));
    $("submitEmployeeCorrectionBtn")?.addEventListener("click", submitEmployeeCorrection);
    document.querySelectorAll("[data-close-org-detail]").forEach(el => el.addEventListener("click", () => closeModal("orgDetailModal")));

    $("hrImportFile")?.addEventListener("change", event => {
      const file = event.target.files?.[0];
      $("hrImportFileName").textContent = file ? `${file.name} • ${(file.size/1024/1024).toFixed(1)} MB` : "Chưa chọn file.";
      $("analyzeImportBtn").disabled = !file;
      state.importResult = null;
      $("commitImportBtn").disabled = true;
    });
    $("analyzeImportBtn")?.addEventListener("click", analyzeImportFile);
    $("commitImportBtn")?.addEventListener("click", commitImport);
    $("syncSheetNowBtn")?.addEventListener("click", syncSheetFromPortal);
    $("importDiffFilter")?.addEventListener("change", renderImportDiff);
    $("selectChangedImportBtn")?.addEventListener("click", selectChangedImportRows);
    $("toggleImportSelection")?.addEventListener("change", toggleAllVisibleImportRows);

    document.addEventListener("click", event => {
      const goto = event.target.closest("[data-goto]");
      if (goto?.dataset.goto) goToPage(goto.dataset.goto);
      const announcement = event.target.closest("[data-announcement-id]");
      if (announcement) markAnnouncement(announcement.dataset.announcementId, announcement.dataset.ack === "true");
      const caseCard = event.target.closest("[data-case-id]");
      if (caseCard) openCaseDetail(caseCard.dataset.caseId);
      const employeeBtn = event.target.closest("[data-employee-id]");
      if (employeeBtn) openEmployeeDetail(employeeBtn.dataset.employeeId);
      const orgBtn = event.target.closest("[data-org-unit-id]");
      if (orgBtn) openOrgDetail(orgBtn.dataset.orgUnitId);
      const importCheckbox = event.target.closest("[data-import-index]");
      if (importCheckbox) {
        const index = Number(importCheckbox.dataset.importIndex);
        if (importCheckbox.checked) state.importSelected.add(index); else state.importSelected.delete(index);
        updateImportCommitState();
      }
      if (window.innerWidth <= 820 && event.target.closest(".portal-nav-item")) $("portalSidebar")?.classList.remove("open");
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") closePortalPasswordModal();
    });
  }

  function goToPage(page) {
    if (page === "import" && !isHR()) return;
    if (["employees","organization"].includes(page) && !isManager()) return;
    state.page = page;
    document.querySelectorAll(".portal-page-section").forEach(el => el.classList.toggle("active", el.id === `page-${page}`));
    document.querySelectorAll(".portal-nav-item[data-page]").forEach(el => el.classList.toggle("active", el.dataset.page === page));
    $("portalPageTitle").textContent = PAGE_TITLES[page] || "Unite HR Portal";
    $("portalBreadcrumb").textContent = page === "dashboard" ? "Cổng thông tin nội bộ" : "UNITE HR PORTAL";
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (page === "announcements") loadAnnouncements();
    if (page === "cases") loadCases();
    if (page === "my-profile") loadMyProfile();
    if (page === "employees") loadEmployees();
    if (page === "organization") loadOrganization();
    if (page === "schedule") loadScheduleFrame();
  }

  async function refreshCurrentPage() {
    const button = $("portalRefreshBtn");
    setLoading(button, true, "Đang tải...");
    try {
      if (state.page === "dashboard") await loadDashboard();
      else if (state.page === "announcements") await loadAnnouncements();
      else if (state.page === "cases") await loadCases();
      else if (state.page === "my-profile") await loadMyProfile();
      else if (state.page === "employees") await loadEmployees();
      else if (state.page === "organization") await loadOrganization();
      else if (state.page === "schedule") loadScheduleFrame(true);
    } finally { setLoading(button, false); }
  }

  function loadScheduleFrame(force = false) {
    const frame = $("scheduleFrame");
    if (!frame) return;
    if (state.scheduleFrameLoaded && !force) return;
    const target = isManager() ? "./admin.html?embedded=1" : "./employee.html?embedded=1";
    frame.src = force ? `${target}&reload=${Date.now()}` : target;
    state.scheduleFrameLoaded = true;
  }

  async function safeCount(table, configure = query => query) {
    try {
      const { count, error } = await configure(supabase.from(table).select("*", { count: "exact", head: true }));
      if (error) return 0;
      return count || 0;
    } catch { return 0; }
  }

  async function loadDashboard() {
    const today = window.UWS.toISODate ? window.UWS.toISODate(new Date()) : new Date().toISOString().slice(0,10);
    const monday = window.UWS.getMonday ? window.UWS.getMonday(new Date()) : new Date();
    const weekStart = window.UWS.toISODate ? window.UWS.toISODate(monday) : today;
    const saturday = window.UWS.addDays ? window.UWS.addDays(monday, 5) : new Date(monday.getTime() + 5 * 86400000);
    const weekEnd = window.UWS.toISODate ? window.UWS.toISODate(saturday) : today;

    const [announcements, cases, employeesResponse, schedulesResponse, todaySchedulesResponse, todayLeavesResponse, todayBusyResponse] = await Promise.all([
      safeCount("announcement_recipients", q => q.eq("recipient_id", state.user.id).is("read_at", null)),
      safeCount("hr_cases", q => q.not("status", "in", '("closed","rejected")')),
      isManager() ? supabase.from("employees").select("id,employment_status") : Promise.resolve({ data: [], error: null }),
      isManager() ? supabase.from("schedule_requests").select("employee_id,status,work_date").gte("work_date", weekStart).lte("work_date", weekEnd).neq("status", "cancelled") : Promise.resolve({ data: [], error: null }),
      isManager() ? supabase.from("schedule_requests").select("employee_id,status").eq("work_date", today).eq("status", "approved") : Promise.resolve({ data: [], error: null }),
      isManager() ? supabase.from("leave_requests").select("employee_id,status").eq("leave_date", today).eq("status", "approved") : Promise.resolve({ data: [], error: null }),
      isManager() ? supabase.from("unavailability").select("employee_id,status").eq("unavailable_date", today).eq("status", "active") : Promise.resolve({ data: [], error: null })
    ]);

    const employees = employeesResponse.data || [];
    const active = employees.filter(row => row.employment_status === "active").length;
    const reserved = employees.filter(row => row.employment_status === "reserved").length;
    const resigned = employees.filter(row => row.employment_status === "resigned").length;
    const total = employees.length;
    const weekSchedules = schedulesResponse.data || [];
    const registered = new Set(weekSchedules.map(row => row.employee_id)).size;
    const missing = Math.max(0, active - registered);
    const pendingSchedules = weekSchedules.filter(row => row.status === "pending").length;
    const workingToday = new Set((todaySchedulesResponse.data || []).map(row => row.employee_id)).size;
    const leaveToday = new Set((todayLeavesResponse.data || []).map(row => row.employee_id)).size;
    const busyToday = new Set((todayBusyResponse.data || []).map(row => row.employee_id)).size;

    $("metricUnread").textContent = announcements;
    $("metricCases").textContent = cases;
    $("metricEmployees").textContent = active;
    $("metricSchedules").textContent = pendingSchedules;
    $("dashboardEmployeeTotal").textContent = `Tổng ${total.toLocaleString("vi-VN")}`;
    $("dashboardActiveEmployees").textContent = active;
    $("dashboardReservedEmployees").textContent = reserved;
    $("dashboardResignedEmployees").textContent = resigned;
    $("dashboardWorkingToday").textContent = workingToday;
    $("dashboardLeaveToday").textContent = leaveToday;
    $("dashboardBusyToday").textContent = busyToday;
    $("dashboardRegisteredWeek").textContent = registered;
    $("dashboardMissingWeek").textContent = missing;
    $("dashboardTodayLabel").textContent = new Date().toLocaleDateString("vi-VN");

    const donut = $("employeeStatusDonut");
    if (donut) {
      const activePct = total ? active / total * 100 : 0;
      const reservedPct = total ? reserved / total * 100 : 0;
      donut.style.background = `conic-gradient(#2f8f62 0 ${activePct}%, #d2a329 ${activePct}% ${activePct + reservedPct}%, #c64b58 ${activePct + reservedPct}% 100%)`;
      donut.innerHTML = `<div><b>${total.toLocaleString("vi-VN")}</b><span>Nhân sự</span></div>`;
    }
    const maxToday = Math.max(1, workingToday, leaveToday, busyToday);
    [["dashboardWorkingBar", workingToday], ["dashboardLeaveBar", leaveToday], ["dashboardBusyBar", busyToday]].forEach(([id,value]) => {
      const el = $(id); if (el) el.style.width = `${Math.max(value ? 8 : 0, value / maxToday * 100)}%`;
    });
    const registrationPct = active ? Math.min(100, registered / active * 100) : 0;
    if ($("dashboardRegistrationBar")) $("dashboardRegistrationBar").style.width = `${registrationPct}%`;
    if ($("dashboardRegistrationText")) $("dashboardRegistrationText").textContent = `${registrationPct.toFixed(0)}% nhân sự đang làm đã có lịch trong tuần ${new Date(`${weekStart}T00:00:00`).toLocaleDateString("vi-VN")} – ${new Date(`${weekEnd}T00:00:00`).toLocaleDateString("vi-VN")}.`;

    updateBadges(announcements, cases);
    renderDashboardFeeds();
  }

  function updateBadges(unread = null, cases = null) {
    const unreadCount = unread ?? state.announcements.filter(a => !a.read_at).length;
    const caseCount = cases ?? state.cases.filter(c => !["closed","rejected"].includes(c.status)).length;
    [["portalInboxBadge", unreadCount],["navUnreadAnnouncements",unreadCount],["navOpenCases",caseCount]].forEach(([id,count]) => {
      const el = $(id); if (!el) return; el.textContent = count; el.classList.toggle("hidden", !count);
    });
    if (navigator.setAppBadge) unreadCount ? navigator.setAppBadge(unreadCount).catch(()=>{}) : navigator.clearAppBadge().catch(()=>{});
  }

  function renderDashboardFeeds() {
    const announcementHost = $("dashboardAnnouncements");
    const caseHost = $("dashboardCases");
    if (announcementHost) {
      const items = state.announcements.slice(0,5);
      announcementHost.innerHTML = items.length ? items.map(item => `
        <article class="portal-feed-item" data-goto="announcements"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.priority_label || "Thông tin")} • ${formatDateTime(item.published_at || item.created_at)}</small></article>`).join("") : '<div class="empty-row">Chưa có thông báo.</div>';
    }
    if (caseHost) {
      const items = state.cases.slice(0,5);
      caseHost.innerHTML = items.length ? items.map(item => `
        <article class="portal-feed-item" data-case-id="${item.id}"><strong>${escapeHtml(item.case_code || "Hồ sơ")} • ${escapeHtml(item.title)}</strong><small>${escapeHtml(CASE_STATUS_LABELS[item.status] || item.status)} • ${formatDateTime(item.submitted_at)}</small></article>`).join("") : '<div class="empty-row">Chưa có yêu cầu.</div>';
    }
  }

  async function loadAnnouncements() {
    try {
      let records = [];
      if (isHR()) {
        const { data, error } = await supabase.from("announcements").select("*").order("created_at", { ascending: false }).limit(100);
        if (error) throw error;
        records = (data || []).map(item => ({ ...item, read_at: item.published_by === state.user.id ? item.published_at : null, acknowledged_at: null }));
      } else {
        const { data, error } = await supabase.from("announcement_recipients")
          .select("announcement_id,delivered_at,read_at,acknowledged_at,announcements(*)")
          .eq("recipient_id", state.user.id).order("delivered_at", { ascending: false }).limit(100);
        if (error) throw error;
        records = (data || []).map(row => ({ ...(row.announcements || {}), ...row }));
      }
      state.announcements = records.map(item => ({ ...item, priority_label: item.priority === "urgent" ? "Khẩn" : item.priority === "important" ? "Quan trọng" : "Thông tin" }));
      renderAnnouncements();
      updateBadges();
      renderDashboardFeeds();
    } catch (error) {
      $("announcementList").innerHTML = `<div class="empty-row">${escapeHtml(migrationError(error))}</div>`;
    }
  }

  function renderAnnouncements() {
    const host = $("announcementList"); if (!host) return;
    const search = normalize($("announcementSearch")?.value);
    const priority = $("announcementPriorityFilter")?.value || "";
    const readFilter = $("announcementReadFilter")?.value || "";
    const items = state.announcements.filter(item => {
      if (search && !normalize(`${item.title} ${item.body}`).includes(search)) return false;
      if (priority && item.priority !== priority) return false;
      if (readFilter === "unread" && item.read_at) return false;
      if (readFilter === "ack" && !item.acknowledged_at) return false;
      return true;
    });
    host.innerHTML = items.length ? items.map(item => `
      <article class="announcement-card ${item.read_at ? "" : "unread"} ${escapeHtml(item.priority || "normal")}">
        <div class="announcement-head"><h3>${escapeHtml(item.title)}</h3><time>${formatDateTime(item.published_at || item.created_at)}</time></div>
        <div class="announcement-meta"><span class="portal-chip ${item.priority}">${escapeHtml(item.priority_label)}</span>${item.requires_ack ? '<span class="portal-chip">Cần xác nhận</span>' : ''}${item.acknowledged_at ? '<span class="portal-chip">Đã xác nhận</span>' : item.read_at ? '<span class="portal-chip">Đã đọc</span>' : '<span class="portal-chip urgent">Chưa đọc</span>'}</div>
        <div class="announcement-body">${escapeHtml(item.body)}</div>
        ${!isHR() ? `<div class="announcement-actions"><button class="btn ${item.requires_ack && !item.acknowledged_at ? "primary" : "ghost"}" data-announcement-id="${item.id || item.announcement_id}" data-ack="${item.requires_ack}">${item.requires_ack ? (item.acknowledged_at ? "Đã xác nhận" : "Tôi đã đọc") : (item.read_at ? "Đã đọc" : "Đánh dấu đã đọc")}</button></div>` : ''}
      </article>`).join("") : '<div class="empty-row">Không có thông báo phù hợp.</div>';
  }

  async function prepareAnnouncementTargetOptions() {
    if (!isHR()) return;
    const type = $("announcementTargetType")?.value || "all";
    const host = $("announcementTargetOptions");
    const hint = $("announcementTargetHint");
    if (!host) return;
    host.innerHTML = "";
    const options = [];
    if (type === "role") {
      Object.entries(ROLE_LABELS).forEach(([value,label]) => options.push({ value, label }));
      if (hint) hint.textContent = "Chọn vai trò nhận thông báo.";
    } else if (["department","area","branch","team"].includes(type)) {
      if (!state.orgUnits.length) {
        const { data } = await supabase.from("org_units").select("id,unit_type,code,name,parent_id,status").eq("status","active").order("name");
        state.orgUnits = data || [];
      }
      state.orgUnits.filter(unit => unit.unit_type === type).forEach(unit => options.push({ value: unit.id, label: `${unit.name} (${unit.code})` }));
      if (hint) hint.textContent = "Chọn đơn vị trong cây tổ chức; app sẽ lưu UUID để tránh trùng tên.";
    } else if (type === "user") {
      const { data } = await supabase.from("profiles").select("id,full_name,email,employee_code").eq("status","active").order("full_name").limit(1000);
      (data || []).forEach(profile => options.push({ value: profile.id, label: `${profile.full_name || profile.email} • ${profile.employee_code || profile.email}` }));
      if (hint) hint.textContent = "Chọn đúng tài khoản người nhận.";
    }
    host.innerHTML = options.map(item => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join("");
  }

  function updateAnnouncementTargetUI() {
    const needsValue = $("announcementTargetType").value !== "all";
    $("announcementTargetValueWrap").classList.toggle("hidden", !needsValue);
    if ($("announcementTargetValue")) $("announcementTargetValue").value = "";
    prepareAnnouncementTargetOptions();
  }

  async function publishAnnouncement() {
    if (!isHR()) return;
    const button = $("publishAnnouncementBtn");
    const title = $("announcementTitle").value.trim();
    const body = $("announcementBody").value.trim();
    const targetType = $("announcementTargetType").value;
    const targetValue = $("announcementTargetValue").value.trim();
    if (!title || !body) return showMessage($("announcementFormMessage"), "Vui lòng nhập tiêu đề và nội dung.", "err");
    if (targetType !== "all" && !targetValue) return showMessage($("announcementFormMessage"), "Vui lòng nhập đối tượng nhận.", "err");
    setLoading(button, true, "Đang phát...");
    try {
      const payload = {
        title, body, priority: $("announcementPriority").value,
        requires_ack: $("announcementRequiresAck").checked,
        status: "draft", expires_at: $("announcementExpiresAt").value || null
      };
      const { data: announcement, error } = await supabase.from("announcements").insert(payload).select("*").single();
      if (error) throw error;
      const { error: targetError } = await supabase.from("announcement_targets").insert({ announcement_id: announcement.id, target_type: targetType, target_value: targetType === "all" ? null : targetValue });
      if (targetError) throw targetError;
      const { data: count, error: publishError } = await supabase.rpc("publish_announcement", { p_announcement_id: announcement.id });
      if (publishError) throw publishError;
      closeModal("announcementModal");
      ["announcementTitle","announcementBody","announcementTargetValue","announcementExpiresAt"].forEach(id => { if ($(id)) $(id).value = ""; });
      toast(`Đã phát thông báo đến ${count || 0} tài khoản.`);
      await loadAnnouncements();
    } catch (error) { showMessage($("announcementFormMessage"), migrationError(error), "err"); }
    finally { setLoading(button, false); }
  }

  async function markAnnouncement(id, ack) {
    if (!id || isHR()) return;
    try {
      const { error } = await supabase.rpc("mark_announcement_receipt", { p_announcement_id: id, p_ack: !!ack });
      if (error) throw error;
      await loadAnnouncements();
      toast(ack ? "Đã xác nhận thông báo." : "Đã đánh dấu đã đọc.");
    } catch (error) { toast(migrationError(error), "err"); }
  }

  async function loadProfileMap(ids = []) {
    const uniqueIds = unique(ids);
    if (!uniqueIds.length) return;
    const missing = uniqueIds.filter(id => !state.profiles.has(id));
    if (!missing.length) return;
    let data = null;
    const rpcResult = await supabase.rpc("get_profile_directory", { p_ids: missing });
    if (!rpcResult.error) data = rpcResult.data;
    else {
      const fallback = await supabase.from("profiles").select("id,full_name,email,role_type,area,branch,team").in("id", missing);
      data = fallback.data;
    }
    (data || []).forEach(profile => state.profiles.set(profile.id, profile));
  }

  async function loadHrDirectory() {
    if (!isHR()) return;
    const { data, error } = await supabase.from("profiles")
      .select("id,full_name,email,role_type,status")
      .in("role_type", ["HR","ADMIN","SUPER_ADMIN"])
      .eq("status", "active")
      .order("full_name");
    if (error) return;
    state.hrAssignees = data || [];
    state.hrAssignees.forEach(profile => state.profiles.set(profile.id, profile));
    const select = $("caseAssigneeUpdate");
    if (select) select.innerHTML = '<option value="">Chưa phân công</option>' + state.hrAssignees.map(profile => `<option value="${profile.id}">${escapeHtml(profile.full_name || profile.email)} • ${escapeHtml(roleLabel(profile.role_type))}</option>`).join("");
  }

  async function loadCases() {
    try {
      const { data, error } = await supabase.from("hr_cases").select("*").order("submitted_at", { ascending: false }).limit(200);
      if (error) throw error;
      state.cases = data || [];
      await loadProfileMap(state.cases.flatMap(item => [item.creator_id,item.assignee_id]).filter(Boolean));
      renderCases();
      updateBadges();
      populateSelect($("caseAreaFilter"), unique(state.cases.map(item => item.area_id)), "Tất cả");
      renderDashboardFeeds();
    } catch (error) { $("caseBoard").innerHTML = `<div class="empty-row">${escapeHtml(migrationError(error))}</div>`; }
  }

  function renderCases() {
    const host = $("caseBoard"); if (!host) return;
    const search = normalize($("caseSearch")?.value);
    const status = $("caseStatusFilter")?.value || "";
    const priority = $("casePriorityFilter")?.value || "";
    const area = $("caseAreaFilter")?.value || "";
    const items = state.cases.filter(item => {
      const creator = state.profiles.get(item.creator_id);
      if (search && !normalize(`${item.case_code} ${item.title} ${item.description} ${creator?.full_name}`).includes(search)) return false;
      if (status && item.status !== status) return false;
      if (priority && item.priority !== priority) return false;
      if (area && item.area_id !== area) return false;
      return true;
    });
    host.innerHTML = items.length ? items.map(item => {
      const creator = state.profiles.get(item.creator_id);
      const assignee = state.profiles.get(item.assignee_id);
      const overdue = item.due_at && new Date(item.due_at) < new Date() && !["approved","rejected","closed"].includes(item.status);
      return `<article class="case-card ${overdue ? "overdue" : ""}" data-case-id="${item.id}">
        <div class="case-card-top"><span class="case-code">${escapeHtml(item.case_code || "HR")}</span><span class="case-status ${item.status}">${escapeHtml(CASE_STATUS_LABELS[item.status] || item.status)}</span></div>
        <h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description || CASE_TYPE_LABELS[item.case_type] || "")}</p>
        <div class="case-card-foot"><span>${escapeHtml(creator?.full_name || "Người gửi")} → ${escapeHtml(assignee?.full_name || "Chưa phân công")}</span><span class="${overdue ? "case-sla" : ""}">${item.due_at ? `Hạn ${formatDateTime(item.due_at)}` : formatDateTime(item.submitted_at)}</span></div>
      </article>`;
    }).join("") : '<div class="empty-row">Không có hồ sơ phù hợp.</div>';
  }

  async function createCase() {
    const button = $("submitCaseBtn");
    const title = $("caseTitle").value.trim();
    const description = $("caseDescription").value.trim();
    if (!title || !description) return showMessage($("caseCreateMessage"), "Vui lòng nhập tiêu đề và nội dung chi tiết.", "err");
    setLoading(button, true, "Đang gửi...");
    try {
      const payload = {
        case_type: $("caseType").value, title, description, priority: $("casePriority").value,
        visibility_level: $("caseVisibility").value, creator_id: state.user.id,
        area_id: state.profile.area_id || null, branch_id: state.profile.branch_id || null, team_id: state.profile.team_id || null,
        due_at: defaultDueAt($("casePriority").value)
      };
      const { data: newCase, error } = await supabase.from("hr_cases").insert(payload).select("*").single();
      if (error) throw error;
      const files = [...($("caseFiles").files || [])];
      for (const file of files) await uploadCaseFile(newCase.id, file, null);
      await supabase.from("activity_logs").insert({ actor_id: state.user.id, action_type: "create", entity_type: "hr_case", entity_id: newCase.id, payload: { case_code: newCase.case_code } });
      closeModal("caseCreateModal");
      ["caseTitle","caseDescription","caseFiles"].forEach(id => { if ($(id)) $(id).value = ""; });
      toast(`Đã gửi hồ sơ ${newCase.case_code || "HR"}.`);
      await loadCases();
    } catch (error) { showMessage($("caseCreateMessage"), migrationError(error), "err"); }
    finally { setLoading(button, false); }
  }

  async function uploadCaseFile(caseId, file, messageId = null) {
    if (file.size > 8 * 1024 * 1024) {
      throw new Error(`${file.name} vượt quá 8 MB. Giai đoạn Apps Script hiện giới hạn 8 MB/file.`);
    }
    const base64 = await fileToBase64(file);
    await invokeWorkspaceBridge("upload_case_file", {
      case_id: caseId,
      message_id: messageId,
      file_name: file.name,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      base64
    });
  }

  async function openCaseDetail(caseId) {
    const item = state.cases.find(row => row.id === caseId);
    if (!item) return;
    state.activeCase = item;
    $("caseDetailCode").textContent = item.case_code || "Hồ sơ HR";
    $("caseDetailTitle").textContent = item.title;
    const creator = state.profiles.get(item.creator_id);
    const assignee = state.profiles.get(item.assignee_id);
    $("caseDetailMeta").innerHTML = [CASE_TYPE_LABELS[item.case_type],CASE_STATUS_LABELS[item.status],item.priority,creator?.full_name,assignee ? `Phụ trách: ${assignee.full_name || assignee.email}` : "Chưa phân công",item.due_at ? `Hạn: ${formatDateTime(item.due_at)}` : null,formatDateTime(item.submitted_at)].filter(Boolean).map(value => `<span class="portal-chip">${escapeHtml(value)}</span>`).join("");
    $("caseDetailDescription").textContent = item.description || "";
    $("caseStatusUpdate").classList.toggle("hidden", !isHR());
    $("caseStatusUpdate").value = "";
    if ($("caseAssigneeUpdate")) $("caseAssigneeUpdate").value = item.assignee_id || "";
    if ($("caseDueAtUpdate")) $("caseDueAtUpdate").value = toLocalDateTimeInput(item.due_at);
    openModal("caseDetailModal");
    await loadCaseConversation(caseId);
  }

  async function loadCaseConversation(caseId) {
    const [{ data: messages }, { data: attachments }] = await Promise.all([
      supabase.from("hr_case_messages").select("*").eq("case_id", caseId).order("created_at"),
      supabase.from("hr_case_attachments").select("*").eq("case_id", caseId).order("created_at")
    ]);
    await loadProfileMap((messages || []).map(row => row.sender_id));
    $("caseMessageList").innerHTML = (messages || []).length ? messages.map(row => {
      const sender = state.profiles.get(row.sender_id);
      return `<article class="case-message ${row.sender_id === state.user.id ? "mine" : ""}">${escapeHtml(row.body)}<small>${escapeHtml(sender?.full_name || "Người dùng")} • ${formatDateTime(row.created_at)}</small></article>`;
    }).join("") : '<div class="empty-row">Chưa có phản hồi.</div>';
    const visibleAttachments = (attachments || []).filter(row => !row.deleted_at);
    $("caseAttachmentList").innerHTML = visibleAttachments.map(row => `
      <button class="attachment-item"
        data-attachment-id="${escapeHtml(row.id)}"
        data-file-provider="${escapeHtml(row.storage_provider || "supabase")}"
        data-file-path="${escapeHtml(row.storage_path || "")}">
        📎 ${escapeHtml(row.original_name)}
        <small>${row.storage_provider === "google_drive" ? "Google Drive" : "Supabase"}</small>
      </button>
    `).join("");
    $("caseAttachmentList").querySelectorAll("[data-attachment-id]").forEach(btn => btn.addEventListener("click", () => {
      openPrivateFile({
        id: btn.dataset.attachmentId,
        provider: btn.dataset.fileProvider,
        path: btn.dataset.filePath
      });
    }));
  }

  async function openPrivateFile(file) {
    try {
      if (file.provider === "google_drive") {
        const result = await invokeWorkspaceBridge("open_case_file", { attachment_id: file.id });
        window.open(result.url, "_blank", "noopener");
        return;
      }
      const { data, error } = await supabase.storage.from("hr-case-files").createSignedUrl(file.path, 120);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener");
    } catch (error) {
      toast(error.message || String(error), "err");
    }
  }

  async function sendCaseReply() {
    if (!state.activeCase) return;
    const body = $("caseReplyBody").value.trim();
    const files = [...($("caseReplyFiles")?.files || [])];
    if (!body && !files.length) return showMessage($("caseDetailMessage"), "Vui lòng nhập phản hồi hoặc chọn file đính kèm.", "err");
    const button = $("sendCaseReplyBtn"); setLoading(button, true, "Đang gửi...");
    try {
      let messageId = null;
      const messageBody = body || `Đã gửi ${files.length} file đính kèm.`;
      const { data: message, error } = await supabase.from("hr_case_messages")
        .insert({ case_id: state.activeCase.id, sender_id: state.user.id, body: messageBody, is_internal: false })
        .select("id").single();
      if (error) throw error;
      messageId = message?.id || null;
      for (const file of files) await uploadCaseFile(state.activeCase.id, file, messageId);
      $("caseReplyBody").value = "";
      if ($("caseReplyFiles")) $("caseReplyFiles").value = "";
      showMessage($("caseDetailMessage"), "", "");
      await loadCaseConversation(state.activeCase.id);
      toast(files.length ? "Đã gửi phản hồi và file đính kèm." : "Đã gửi phản hồi.");
    } catch (error) { showMessage($("caseDetailMessage"), migrationError(error), "err"); }
    finally { setLoading(button, false); }
  }

  async function saveCaseAssignment() {
    if (!isHR() || !state.activeCase) return;
    const assigneeId = $("caseAssigneeUpdate")?.value || null;
    const dueValue = $("caseDueAtUpdate")?.value || "";
    const payload = {
      assignee_id: assigneeId,
      due_at: dueValue ? new Date(dueValue).toISOString() : null,
      updated_at: new Date().toISOString()
    };
    if (assigneeId && state.activeCase.status === "submitted") payload.status = "in_review";
    const button = $("saveCaseAssignmentBtn"); setLoading(button, true, "Đang lưu...");
    try {
      const { error } = await supabase.from("hr_cases").update(payload).eq("id", state.activeCase.id);
      if (error) throw error;
      Object.assign(state.activeCase, payload);
      toast("Đã cập nhật người phụ trách và hạn xử lý.");
      await loadCases();
      await openCaseDetail(state.activeCase.id);
    } catch (error) { showMessage($("caseDetailMessage"), migrationError(error), "err"); }
    finally { setLoading(button, false); }
  }

  async function updateCaseStatus() {
    if (!isHR() || !state.activeCase || !$("caseStatusUpdate").value) return;
    const next = $("caseStatusUpdate").value;
    const payload = { status: next, updated_at: new Date().toISOString() };
    if (["approved","rejected","closed"].includes(next)) payload.resolved_at = new Date().toISOString();
    const { error } = await supabase.from("hr_cases").update(payload).eq("id", state.activeCase.id);
    if (error) return toast(migrationError(error), "err");
    state.activeCase.status = next;
    toast("Đã cập nhật trạng thái hồ sơ.");
    await loadCases();
    await openCaseDetail(state.activeCase.id);
  }

  async function loadMyProfile() {
    const host = $("myProfileContent");
    const id = state.profile?.employee_record_id;
    if (!id) {
      if (host) host.innerHTML = '<div class="empty-row">Tài khoản chưa được liên kết với hồ sơ nhân sự. Hãy liên hệ HR.</div>';
      $("openMyEmployeeDetailBtn").disabled = true;
      return;
    }
    try {
      let employee = state.employees.find(row => row.id === id);
      if (!employee) {
        const { data, error } = await supabase.from("employees").select("*").eq("id", id).single();
        if (error) throw error;
        employee = data;
        if (!state.employees.some(row => row.id === data.id)) state.employees.push(data);
      }
      const fields = [["Mã nhân sự",employee.employee_code],["Họ tên",employee.full_name],["Nick Name",employee.nickname],["Nhóm nhân sự",employeeCodeGroup(employee)],["Phòng ban",employee.department],["Khu vực",employee.area],["Chi nhánh",employee.branch],["Team",employee.team],["Chức danh",employee.title],["Cấp bậc",employee.employment_level],["Email",employee.work_email || employee.personal_email],["Điện thoại",employee.phone],["Trạng thái",EMPLOYEE_STATUS_LABELS[employee.employment_status]]];
      host.innerHTML = `<div class="employee-detail-grid">${fields.map(([label,value])=>`<div class="employee-field"><span>${escapeHtml(label)}</span><b>${escapeHtml(value || "—")}</b></div>`).join("")}</div>`;
      $("openMyEmployeeDetailBtn").disabled = false;
    } catch (error) {
      host.innerHTML = `<div class="empty-row">${escapeHtml(migrationError(error))}</div>`;
    }
  }

  async function loadEmployees() {
    try {
      let response = await supabase
        .from("employees")
        .select("*")
        .order("department_rank", { ascending: true })
        .order("hierarchy_rank", { ascending: true })
        .order("area", { ascending: true, nullsFirst: false })
        .order("branch", { ascending: true, nullsFirst: false })
        .order("team", { ascending: true, nullsFirst: false })
        .order("source_row_order", { ascending: true, nullsFirst: false })
        .order("full_name", { ascending: true })
        .limit(2500);
      if (response.error && /department_rank|hierarchy_rank|source_row_order/i.test(response.error.message || "")) {
        response = await supabase.from("employees").select("*").order("full_name", { ascending: true }).limit(2500);
      }
      if (response.error) throw response.error;
      state.employees = (response.data || []).map(row => ({
        ...row,
        employee_code: canonicalDisplay(row.employee_code, "employee_code") || row.employee_code,
        full_name: canonicalDisplay(row.full_name, "full_name") || row.full_name,
        department: canonicalDisplay(row.department, "department") || row.department,
        area: canonicalDisplay(row.area, "area") || row.area,
        branch: canonicalDisplay(row.branch, "branch") || row.branch,
        team: canonicalDisplay(row.team, "team") || row.team,
        employment_type: canonicalDisplay(row.employment_type, "type") || row.employment_type,
        nickname: canonicalDisplay(row.nickname, "nickname") || row.nickname
      }));
      state.employeePrivateById = new Map();
      if (isHR() && state.employees.length) {
        const privateRes = await supabase.from("employee_private").select("employee_id,bank_name,bank_account").limit(5000);
        if (!privateRes.error) {
          (privateRes.data || []).forEach(row => state.employeePrivateById.set(row.employee_id, row));
        }
      }
      rebuildEmployeeFilters();
      renderEmployees();
    } catch (error) {
      $("employeeTable").innerHTML = `<tr><td colspan="14" class="empty-row">${escapeHtml(migrationError(error))}</td></tr>`;
    }
  }

  function populateSelect(select, values, allLabel = "Tất cả") {
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>` + values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
    const match = values.find(value => sameText(value, current));
    if (match) select.value = match;
  }

  function populateEmployeeFilters() {
    rebuildEmployeeFilters();
  }

  function employeeFilterState() {
    return {
      status: $("employeeStatusFilter")?.value || "",
      codeGroup: $("employeeCodeGroupFilter")?.value || "",
      department: $("employeeDepartmentFilter")?.value || "",
      area: $("employeeAreaFilter")?.value || "",
      branch: $("employeeBranchFilter")?.value || "",
      team: $("employeeTeamFilter")?.value || "",
      title: $("employeeTitleFilter")?.value || "",
      level: $("employeeLevelFilter")?.value || "",
      type: $("employeeTypeFilter")?.value || "",
      bank: $("employeeBankFilter")?.value || "",
      quality: $("employeeQualityFilter")?.value || ""
    };
  }

  function employeeMatchesField(row, field, selected) {
    if (!selected) return true;
    if (field === "status") return row.employment_status === selected;
    if (field === "quality") return row.data_quality === selected;
    if (field === "codeGroup") return sameText(employeeCodeGroup(row), selected);
    if (field === "level") return sameText(row.employment_level, selected);
    if (field === "type") return sameText(row.employment_type, selected);
    if (field === "bank") return sameText(employeePrivate(row).bank_name, selected);
    return sameText(row[field], selected);
  }

  function rowsMatchingEmployeeFilter(filter, skippedFields = []) {
    const skip = new Set(skippedFields);
    return state.employees.filter(row => Object.entries(filter).every(([field, selected]) => skip.has(field) || employeeMatchesField(row, field, selected)));
  }

  function rebuildEmployeeFilters(changedId = "") {
    const filter = employeeFilterState();
    const hierarchy = ["department", "area", "branch", "team"];
    const changedField = {
      employeeDepartmentFilter: "department",
      employeeAreaFilter: "area",
      employeeBranchFilter: "branch",
      employeeTeamFilter: "team"
    }[changedId];
    if (changedField) {
      const changedIndex = hierarchy.indexOf(changedField);
      hierarchy.slice(changedIndex + 1).forEach(field => {
        const id = `employee${field.charAt(0).toUpperCase()}${field.slice(1)}Filter`;
        if ($(id)) $(id).value = "";
        filter[field] = "";
      });
    }

    const codeRows = rowsMatchingEmployeeFilter(filter, ["codeGroup", "department", "area", "branch", "team", "title", "level", "type", "bank"]);
    populateSelect($("employeeCodeGroupFilter"), uniqueCanonical(codeRows.map(employeeCodeGroup), "codeGroup"), "Tất cả nhóm");
    filter.codeGroup = $("employeeCodeGroupFilter")?.value || "";

    const departmentRows = rowsMatchingEmployeeFilter(filter, ["department", "area", "branch", "team", "title", "level", "type", "bank"]);
    populateSelect($("employeeDepartmentFilter"), uniqueCanonical(departmentRows.map(row => row.department), "department"), "Tất cả phòng ban");
    filter.department = $("employeeDepartmentFilter")?.value || "";

    const areaRows = rowsMatchingEmployeeFilter(filter, ["area", "branch", "team", "title", "level", "type", "bank"]);
    populateSelect($("employeeAreaFilter"), uniqueCanonical(areaRows.map(row => row.area), "area"), "Tất cả khu vực");
    filter.area = $("employeeAreaFilter")?.value || "";

    const branchRows = rowsMatchingEmployeeFilter(filter, ["branch", "team", "title", "level", "type", "bank"]);
    populateSelect($("employeeBranchFilter"), uniqueCanonical(branchRows.map(row => row.branch), "branch"), "Tất cả chi nhánh");
    filter.branch = $("employeeBranchFilter")?.value || "";

    const teamRows = rowsMatchingEmployeeFilter(filter, ["team", "title", "level", "type", "bank"]);
    populateSelect($("employeeTeamFilter"), uniqueCanonical(teamRows.map(row => row.team), "team"), "Tất cả team");

    const scopedRows = rowsMatchingEmployeeFilter(employeeFilterState(), ["title", "level", "type", "bank"]);
    populateSelect($("employeeTitleFilter"), uniqueCanonical(scopedRows.map(row => row.title), "title"), "Tất cả chức danh");
    populateSelect($("employeeLevelFilter"), uniqueCanonical(scopedRows.map(row => row.employment_level), "level"), "Tất cả cấp bậc");
    populateSelect($("employeeTypeFilter"), uniqueCanonical(scopedRows.map(row => row.employment_type), "type"), "Tất cả loại công việc");
    if (isHR()) populateSelect($("employeeBankFilter"), uniqueCanonical(scopedRows.map(row => employeePrivate(row).bank_name), "bank"), "Tất cả ngân hàng");
  }

  function findDimensionMention(query, values) {
    const normalizedQuery = normalize(query);
    return values
      .filter(Boolean)
      .sort((a, b) => String(b).length - String(a).length)
      .find(value => normalizedQuery.includes(normalize(value))) || "";
  }

  function parseSmartEmployeeQuery(rawQuery) {
    const query = normalize(rawQuery);
    const filter = { labels: [] };
    if (!query) return filter;

    if (/đang làm|dang lam|đang hoạt động|active/.test(query)) { filter.status = "active"; filter.labels.push("Đang làm"); }
    else if (/đã nghỉ|da nghi|nghỉ việc|resigned/.test(query)) { filter.status = "resigned"; filter.labels.push("Đã nghỉ"); }
    else if (/bảo lưu|bao luu|reserved/.test(query)) { filter.status = "reserved"; filter.labels.push("Bảo lưu"); }

    if (/thiếu mã|thieu ma/.test(query)) { filter.missingCode = true; filter.labels.push("Thiếu mã"); }
    if (/thiếu email|thieu email/.test(query)) { filter.missingEmail = true; filter.labels.push("Thiếu email"); }
    if (/cần rà soát|can ra soat|dữ liệu lỗi|du lieu loi/.test(query)) { filter.quality = "needs_review"; filter.labels.push("Cần rà soát"); }

    const dimensions = {
      codeGroup: findDimensionMention(query, unique(state.employees.map(employeeCodeGroup))),
      department: findDimensionMention(query, unique(state.employees.map(row => row.department))),
      area: findDimensionMention(query, unique(state.employees.map(row => row.area))),
      branch: findDimensionMention(query, unique(state.employees.map(row => row.branch))),
      team: findDimensionMention(query, unique(state.employees.map(row => row.team))),
      title: findDimensionMention(query, unique(state.employees.map(row => row.title))),
      level: findDimensionMention(query, unique(state.employees.map(row => row.employment_level))),
      type: findDimensionMention(query, unique(state.employees.map(row => row.employment_type))),
      bank: findDimensionMention(query, unique([...state.employeePrivateById.values()].map(row => row.bank_name)))
    };
    Object.entries(dimensions).forEach(([key, value]) => {
      if (!value) return;
      filter[key] = value;
      filter.labels.push(value);
    });

    if (/ban lãnh đạo|ban lanh dao|blđ/.test(query)) { filter.maxHierarchyRank = 20; filter.labels.push("Ban lãnh đạo"); }
    else if (/quản lý phòng ban|quan ly phong ban|trưởng phòng|truong phong/.test(query)) { filter.maxHierarchyRank = 50; filter.labels.push("Quản lý phòng ban"); }
    else if (/quản lý khu vực|quan ly khu vuc|tpkd/.test(query)) { filter.hierarchyLabel = "Quản lý khu vực"; filter.labels.push("Quản lý khu vực"); }
    else if (/quản lý chi nhánh|quan ly chi nhanh|qlcn/.test(query)) { filter.hierarchyLabel = "Quản lý chi nhánh"; filter.labels.push("Quản lý chi nhánh"); }
    else if (/leader/.test(query)) { filter.hierarchyLabel = "Leader"; filter.labels.push("Leader"); }
    else if (/tts|thực tập|thuc tap|nvpt/.test(query)) { filter.hierarchyLabel = "TTS / NVPT"; filter.labels.push("TTS / NVPT"); }

    const rankDown = query.match(/(leader|quản lý chi nhánh|quan ly chi nhanh|quản lý khu vực|quan ly khu vuc|trưởng phòng|truong phong)\s+trở xuống/);
    if (rankDown) {
      const map = { "leader": 999, "quản lý chi nhánh": 999, "quan ly chi nhanh": 999, "quản lý khu vực": 999, "quan ly khu vuc": 999, "trưởng phòng": 999, "truong phong": 999 };
      filter.minHierarchyRank = /leader/.test(rankDown[1]) ? 70 : /chi nhánh|chi nhanh/.test(rankDown[1]) ? 60 : /khu vực|khu vuc/.test(rankDown[1]) ? 55 : 45;
      filter.labels.push(`${rankDown[1]} trở xuống`);
    }

    return filter;
  }

  function applyEmployeeSmartFilter() {
    const query = $("employeeSmartFilter")?.value || "";
    state.employeeSmartFilter = parseSmartEmployeeQuery(query);
    state.employeePage = 1;
    renderSmartFilterChips();
    renderEmployees();
  }

  function renderSmartFilterChips() {
    const host = $("employeeSmartFilterChips");
    if (!host) return;
    const labels = state.employeeSmartFilter?.labels || [];
    host.innerHTML = labels.length
      ? labels.map(label => `<span class="portal-chip smart-chip">${escapeHtml(label)}</span>`).join("")
      : '<span class="muted">Chưa áp dụng lọc thông minh.</span>';
  }

  function clearEmployeeFilters() {
    ["employeeSearch","employeeSmartFilter"].forEach(id => { if ($(id)) $(id).value = ""; });
    ["employeeStatusFilter","employeeCodeGroupFilter","employeeDepartmentFilter","employeeAreaFilter","employeeBranchFilter","employeeTeamFilter","employeeTitleFilter","employeeLevelFilter","employeeTypeFilter","employeeBankFilter","employeeQualityFilter"].forEach(id => { if ($(id)) $(id).value = ""; });
    if ($("employeeSortSelect")) $("employeeSortSelect").value = "organization";
    if ($("employeeGroupSelect")) $("employeeGroupSelect").value = "department";
    state.employeeSmartFilter = {};
    state.employeePage = 1;
    renderSmartFilterChips();
    rebuildEmployeeFilters();
    renderEmployees();
  }

  function smartFilterMatches(row) {
    const f = state.employeeSmartFilter || {};
    if (f.status && row.employment_status !== f.status) return false;
    if (f.quality && row.data_quality !== f.quality) return false;
    if (f.department && !sameText(row.department, f.department)) return false;
    if (f.codeGroup && !sameText(employeeCodeGroup(row), f.codeGroup)) return false;
    if (f.area && !sameText(row.area, f.area)) return false;
    if (f.branch && !sameText(row.branch, f.branch)) return false;
    if (f.team && !sameText(row.team, f.team)) return false;
    if (f.title && !sameText(row.title, f.title)) return false;
    if (f.level && !sameText(row.employment_level, f.level)) return false;
    if (f.type && !sameText(row.employment_type, f.type)) return false;
    if (f.bank && !sameText(employeePrivate(row).bank_name, f.bank)) return false;
    if (f.hierarchyLabel && !sameText(row.hierarchy_label, f.hierarchyLabel)) return false;
    if (Number.isFinite(f.maxHierarchyRank) && Number(row.hierarchy_rank || 999) > f.maxHierarchyRank) return false;
    if (Number.isFinite(f.minHierarchyRank) && Number(row.hierarchy_rank || 999) < f.minHierarchyRank) return false;
    if (f.missingCode && String(row.employee_code || "").trim()) return false;
    if (f.missingEmail && (String(row.work_email || "").trim() || String(row.personal_email || "").trim())) return false;
    return true;
  }

  function filteredEmployees() {
    const search = normalize($("employeeSearch")?.value);
    const status = $("employeeStatusFilter")?.value || "";
    const codeGroup = $("employeeCodeGroupFilter")?.value || "";
    const department = $("employeeDepartmentFilter")?.value || "";
    const area = $("employeeAreaFilter")?.value || "";
    const branch = $("employeeBranchFilter")?.value || "";
    const team = $("employeeTeamFilter")?.value || "";
    const title = $("employeeTitleFilter")?.value || "";
    const level = $("employeeLevelFilter")?.value || "";
    const type = $("employeeTypeFilter")?.value || "";
    const bank = $("employeeBankFilter")?.value || "";
    const quality = $("employeeQualityFilter")?.value || "";
    return state.employees.filter(row => {
      const privateData = employeePrivate(row);
      if (search && !normalize(`${row.employee_code} ${row.full_name} ${row.nickname} ${row.work_email} ${row.personal_email} ${row.phone} ${row.department} ${row.area} ${row.branch} ${row.team} ${row.title} ${row.employment_level} ${row.employment_type} ${privateData.bank_name} ${privateData.bank_account}`).includes(search)) return false;
      if (status && row.employment_status !== status) return false;
      if (codeGroup && !sameText(employeeCodeGroup(row), codeGroup)) return false;
      if (department && !sameText(row.department, department)) return false;
      if (area && !sameText(row.area, area)) return false;
      if (branch && !sameText(row.branch, branch)) return false;
      if (team && !sameText(row.team, team)) return false;
      if (title && !sameText(row.title, title)) return false;
      if (level && !sameText(row.employment_level, level)) return false;
      if (type && !sameText(row.employment_type, type)) return false;
      if (bank && !sameText(privateData.bank_name, bank)) return false;
      if (quality && row.data_quality !== quality) return false;
      return smartFilterMatches(row);
    });
  }

  function sortEmployees(rows) {
    const mode = $("employeeSortSelect")?.value || "organization";
    const result = [...rows];
    const compareText = (a, b) => String(a || "").localeCompare(String(b || ""), "vi", { sensitivity: "base" });
    if (mode === "name_asc") return result.sort((a,b) => compareText(a.full_name,b.full_name));
    if (mode === "name_desc") return result.sort((a,b) => compareText(b.full_name,a.full_name));
    if (mode === "code_asc") return result.sort((a,b) => compareText(a.employee_code,b.employee_code));
    if (mode === "start_desc") return result.sort((a,b) => String(b.start_date || "").localeCompare(String(a.start_date || "")) || compareText(a.full_name,b.full_name));
    return result.sort((a,b) =>
      Number(a.department_rank || 900) - Number(b.department_rank || 900) ||
      Number(a.hierarchy_rank || 900) - Number(b.hierarchy_rank || 900) ||
      compareText(a.area,b.area) || compareText(a.branch,b.branch) || compareText(a.team,b.team) ||
      Number(a.source_row_order || a.source_row || 999999) - Number(b.source_row_order || b.source_row || 999999) ||
      compareText(a.full_name,b.full_name)
    );
  }

  function employeeGroupLabel(row, mode) {
    if (mode === "department") return employeeDisplay(row, "department") || "Chưa có phòng ban";
    if (mode === "area") return employeeDisplay(row, "area") || "Chưa có khu vực";
    if (mode === "branch") return employeeDisplay(row, "branch") || "Chưa có chi nhánh";
    if (mode === "team") return employeeDisplay(row, "team") || "Chưa có team";
    if (mode === "hierarchy_label") return row.hierarchy_label || "Nhân viên / CTV";
    return "";
  }

  const EMPLOYEE_COLUMN_STORAGE_KEY = "uws_employee_columns_v2";
  const EMPLOYEE_TABLE_COLUMNS = [
    { key: "employee_code", label: "Mã", exportLabel: "Mã NV", locked: true, render: row => `<b>${tableCellText(employeeDisplay(row, "employee_code"))}</b>`, export: row => employeeDisplay(row, "employee_code") },
    { key: "full_name", label: "Họ tên", locked: true, render: row => tableCellText(employeeDisplay(row, "full_name")), export: row => employeeDisplay(row, "full_name") },
    { key: "nickname", label: "Nick Name", render: row => tableCellText(employeeDisplay(row, "nickname")), export: row => employeeDisplay(row, "nickname") },
    { key: "code_group", label: "Nhóm", exportLabel: "Nhóm nhân sự", render: row => tableCellText(employeeCodeGroup(row)), export: row => employeeCodeGroup(row) },
    { key: "department", label: "Phòng ban", render: row => tableCellText(employeeDisplay(row, "department")), export: row => employeeDisplay(row, "department") },
    { key: "area", label: "Khu vực", render: row => tableCellText(employeeDisplay(row, "area")), export: row => employeeDisplay(row, "area") },
    { key: "branch", label: "Chi nhánh", render: row => tableCellText(employeeDisplay(row, "branch")), export: row => employeeDisplay(row, "branch") },
    { key: "team", label: "Team", render: row => tableCellText(employeeDisplay(row, "team")), export: row => employeeDisplay(row, "team") },
    { key: "title", label: "Chức danh", render: row => tableCellText(row.title), export: row => row.title || "" },
    { key: "level", label: "Cấp bậc", render: row => tableCellText(row.employment_level), export: row => row.employment_level || "" },
    { key: "type", label: "Loại", exportLabel: "Loại công việc", render: row => tableCellText(employeeDisplay(row, "type")), export: row => employeeDisplay(row, "type") },
    { key: "bank", label: "Ngân hàng", hrOnly: true, render: row => tableCellText(employeePrivate(row).bank_name), export: row => employeePrivate(row).bank_name || "" },
    { key: "bank_account", label: "Số TK", exportLabel: "Số tài khoản", hrOnly: true, defaultVisible: false, render: row => tableCellText(employeePrivate(row).bank_account), export: row => employeePrivate(row).bank_account || "" },
    { key: "work_email", label: "Email", defaultVisible: false, render: row => tableCellText(row.work_email || row.personal_email), export: row => row.work_email || row.personal_email || "" },
    { key: "phone", label: "SĐT", defaultVisible: false, render: row => tableCellText(row.phone), export: row => row.phone || "" },
    { key: "quality", label: "Dữ liệu", defaultVisible: false, render: row => tableCellText(row.data_quality), export: row => row.data_quality || "" },
    { key: "status", label: "Trạng thái", render: row => `<span class="badge ${row.employment_status === "active" ? "approved" : row.employment_status === "resigned" ? "rejected" : "pending"}">${escapeHtml(EMPLOYEE_STATUS_LABELS[row.employment_status] || row.employment_status)}</span>`, export: row => EMPLOYEE_STATUS_LABELS[row.employment_status] || row.employment_status || "" }
  ];

  function availableEmployeeColumns() {
    return EMPLOYEE_TABLE_COLUMNS.filter(column => !column.hrOnly || isHR());
  }

  function defaultEmployeeColumnKeys() {
    return availableEmployeeColumns().filter(column => column.defaultVisible !== false).map(column => column.key);
  }

  function ensureEmployeeVisibleColumns() {
    const validKeys = new Set(availableEmployeeColumns().map(column => column.key));
    if (!state.employeeVisibleColumns) {
      let stored = null;
      try { stored = JSON.parse(localStorage.getItem(EMPLOYEE_COLUMN_STORAGE_KEY) || "null"); } catch (_) { stored = null; }
      const initial = Array.isArray(stored) ? stored.filter(key => validKeys.has(key)) : defaultEmployeeColumnKeys();
      state.employeeVisibleColumns = new Set(initial.length ? initial : defaultEmployeeColumnKeys());
    }
    availableEmployeeColumns().filter(column => column.locked).forEach(column => state.employeeVisibleColumns.add(column.key));
    [...state.employeeVisibleColumns].forEach(key => { if (!validKeys.has(key)) state.employeeVisibleColumns.delete(key); });
    return state.employeeVisibleColumns;
  }

  function visibleEmployeeColumns() {
    const selected = ensureEmployeeVisibleColumns();
    return availableEmployeeColumns().filter(column => selected.has(column.key));
  }

  function saveEmployeeVisibleColumns() {
    try { localStorage.setItem(EMPLOYEE_COLUMN_STORAGE_KEY, JSON.stringify([...ensureEmployeeVisibleColumns()])); } catch (_) {}
  }

  function toggleEmployeeColumn(key) {
    const column = availableEmployeeColumns().find(item => item.key === key);
    if (!column || column.locked) return;
    const selected = ensureEmployeeVisibleColumns();
    if (selected.has(key)) selected.delete(key); else selected.add(key);
    saveEmployeeVisibleColumns();
    renderEmployeeColumnControls();
    renderEmployees();
  }

  function renderEmployeeColumnControls() {
    const host = $("employeeColumnButtons");
    if (!host) return;
    const selected = ensureEmployeeVisibleColumns();
    host.innerHTML = availableEmployeeColumns().map(column => `
      <button type="button" class="employee-column-chip ${selected.has(column.key) ? "active" : ""}" data-employee-column="${column.key}" ${column.locked ? "disabled" : ""}>
        ${escapeHtml(column.label)}
      </button>
    `).join("");
  }

  function tableCellText(value, className = "") {
    const display = String(value ?? "").trim() || "—";
    const classSuffix = className ? ` ${className}` : "";
    return `<span class="cell-text${classSuffix}" title="${escapeHtml(display)}">${escapeHtml(display)}</span>`;
  }

  function compactTableCell(value, className = "") {
    const display = String(value ?? "").trim() || "—";
    const classSuffix = className ? ` ${className}` : "";
    return `<span class="cell-clip${classSuffix}" title="${escapeHtml(display)}">${escapeHtml(display)}</span>`;
  }

  function renderEmployees() {
    const rows = sortEmployees(filteredEmployees());
    const pages = Math.max(1, Math.ceil(rows.length / state.employeePageSize));
    state.employeePage = Math.min(state.employeePage, pages);
    const start = (state.employeePage - 1) * state.employeePageSize;
    const pageRows = rows.slice(start, start + state.employeePageSize);
    const groupMode = $("employeeGroupSelect")?.value || "department";
    const columns = visibleEmployeeColumns();
    const table = document.querySelector(".employee-data-grid table");
    if (table) table.style.minWidth = `${Math.min(1420, Math.max(860, columns.length * 122 + 96))}px`;
    if ($("employeeTableHead")) {
      $("employeeTableHead").innerHTML = `<tr>${columns.map(column => `<th data-employee-col="${column.key}">${escapeHtml(column.label)}</th>`).join("")}<th class="employee-action-col"></th></tr>`;
    }
    let lastGroup = null;
    const html = [];
    pageRows.forEach(row => {
      const group = employeeGroupLabel(row, groupMode);
      if (groupMode !== "none" && group !== lastGroup) {
        const groupCount = rows.filter(item => employeeGroupLabel(item, groupMode) === group).length;
        html.push(`<tr class="employee-group-row"><td colspan="${columns.length + 1}"><span>${escapeHtml(group)}</span><b>${groupCount} nhân sự</b></td></tr>`);
        lastGroup = group;
      }
      html.push(`<tr>
        ${columns.map(column => `<td data-employee-col="${column.key}">${column.render(row)}</td>`).join("")}
        <td><button class="btn ghost compact-btn" data-employee-id="${row.id}">Xem</button></td></tr>`);
    });
    $("employeeTable").innerHTML = html.length ? html.join("") : `<tr><td colspan="${columns.length + 1}" class="empty-row">Không có nhân sự phù hợp.</td></tr>`;
    if ($("employeeResultCount")) $("employeeResultCount").textContent = `${rows.length.toLocaleString("vi-VN")} nhân sự`;
    renderPagination(pages);
  }

  function renderPagination(pages) {
    const host = $("employeePagination"); if (!host) return;
    if (pages <= 1) { host.innerHTML = ""; return; }
    const buttons = [];
    for (let page = Math.max(1,state.employeePage-2); page <= Math.min(pages,state.employeePage+2); page++) buttons.push(`<button class="${page===state.employeePage?'active':''}" data-employee-page="${page}">${page}</button>`);
    host.innerHTML = buttons.join("");
    host.querySelectorAll("[data-employee-page]").forEach(btn => btn.addEventListener("click", () => { state.employeePage = Number(btn.dataset.employeePage); renderEmployees(); }));
  }

  function excelSafeName(value) {
    return normalize(value || "tat-ca").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "tat-ca";
  }

  function exportFilteredEmployees() {
    if (!isHR()) return;
    const rows = sortEmployees(filteredEmployees());
    if (!rows.length) return toast("Không có nhân sự phù hợp để xuất file.", "warn");
    const exportColumns = visibleEmployeeColumns().filter(column => typeof column.export === "function");
    const header = ["STT", ...exportColumns.map(column => column.exportLabel || column.label)];
    const body = rows.map((row, index) => [index + 1, ...exportColumns.map(column => column.export(row, index))]);
    const scope = [
      $("employeeDepartmentFilter")?.value,
      $("employeeAreaFilter")?.value,
      $("employeeBranchFilter")?.value,
      $("employeeTeamFilter")?.value,
      $("employeeBankFilter")?.value
    ].filter(Boolean).map(excelSafeName).join("-");
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `danh-sach-nhan-su-da-loc-${scope || "tat-ca"}-${stamp}.xlsx`;

    if (window.XLSX?.utils) {
      const wb = window.XLSX.utils.book_new();
      const ws = window.XLSX.utils.aoa_to_sheet([header, ...body]);
      ws["!cols"] = header.map((label, columnIndex) => ({
        wch: Math.min(34, Math.max(String(label).length + 2, ...body.map(row => String(row[columnIndex] || "").length + 2)))
      }));
      window.XLSX.utils.book_append_sheet(wb, ws, "Danh sach da loc");
      window.XLSX.writeFile(wb, filename, { compression: true });
    } else {
      const csv = [header, ...body].map(cols => cols.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
      const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename.replace(/\.xlsx$/i, ".csv");
      a.click();
      URL.revokeObjectURL(url);
    }
    toast(`Đã xuất ${rows.length.toLocaleString("vi-VN")} nhân sự theo bộ lọc hiện tại.`);
  }

  const EMPLOYEE_EDIT_FIELDS = [
    ["employee_code", "Mã nhân sự"], ["full_name", "Họ tên"], ["nickname", "Nick Name"], ["department", "Phòng ban"], ["area", "Khu vực"], ["branch", "Chi nhánh"], ["team", "Team"],
    ["title", "Chức danh"], ["employment_level", "Cấp bậc"], ["employment_type", "Loại công việc"], ["work_email", "Email công việc"],
    ["personal_email", "Email cá nhân"], ["phone", "Điện thoại"], ["start_date", "Ngày bắt đầu", "date"], ["official_date", "Ngày chính thức", "date"],
    ["employment_status", "Trạng thái", "status"]
  ];
  const PRIVATE_EDIT_FIELDS = [
    ["birth_date", "Ngày sinh", "date"], ["citizen_id", "CCCD"], ["social_insurance_no", "BHXH"], ["tax_code", "Mã số thuế"],
    ["bank_name", "Ngân hàng"], ["bank_account", "Số tài khoản"], ["current_salary", "Lương hiện tại", "number"], ["contract_expiry", "Hết hạn hợp đồng", "date"]
  ];

  async function openEmployeeDetail(id) {
    const employee = state.employees.find(row => row.id === id);
    if (!employee) return;
    state.activeEmployee = employee;
    state.activeEmployeePrivate = null;
    if (isHR()) {
      const { data } = await supabase.from("employee_private").select("*").eq("employee_id", id).maybeSingle();
      state.activeEmployeePrivate = data || {};
    }
    renderEmployeeDetail(false);
    openModal("employeeDetailModal");
  }

  function employeeFieldInput(field, value, type = "text") {
    if (type === "status") {
      return `<select data-employee-edit="${field}"><option value="active" ${value === "active" ? "selected" : ""}>Đang làm</option><option value="reserved" ${value === "reserved" ? "selected" : ""}>Bảo lưu</option><option value="resigned" ${value === "resigned" ? "selected" : ""}>Đã nghỉ</option><option value="unknown" ${value === "unknown" ? "selected" : ""}>Chưa rõ</option></select>`;
    }
    return `<input data-employee-edit="${field}" type="${type}" value="${escapeHtml(value || "")}" />`;
  }

  function renderEmployeeDetail(editMode = false) {
    const employee = state.activeEmployee;
    if (!employee) return;
    $("employeeDetailName").textContent = employee.full_name;
    const publicHtml = EMPLOYEE_EDIT_FIELDS.map(([field,label,type]) => {
      const value = employee[field];
      const shown = type === "date" ? formatDate(value) : field === "employment_status" ? EMPLOYEE_STATUS_LABELS[value] : value;
      return `<div class="employee-field ${editMode ? "is-editing" : ""}"><span>${escapeHtml(label)}</span>${editMode ? employeeFieldInput(field, value, type) : `<b>${escapeHtml(shown || "—")}</b>`}</div>`;
    }).join("");
    let html = `<div class="employee-detail-grid">${publicHtml}</div>`;
    if (isHR()) {
      const privateData = state.activeEmployeePrivate || {};
      const privateHtml = PRIVATE_EDIT_FIELDS.map(([field,label,type]) => {
        const value = privateData[field];
        const shown = type === "date" ? formatDate(value) : type === "number" && value ? Number(value).toLocaleString("vi-VN") : value;
        return `<div class="employee-field ${editMode ? "is-editing" : ""}"><span>${escapeHtml(label)}</span>${editMode ? employeeFieldInput(`private.${field}`, value, type) : `<b>${escapeHtml(shown || "—")}</b>`}</div>`;
      }).join("");
      html += `<div class="employee-private-section"><p class="eyebrow">Dữ liệu riêng tư – chỉ HR/Admin</p><div class="employee-detail-grid">${privateHtml}</div></div>`;
    }
    $("employeeDetailContent").innerHTML = html;
    const editable = canEditEmployeeRecords();
    $("editEmployeeBtn")?.classList.toggle("hidden", !editable || editMode);
    $("saveEmployeeBtn")?.classList.toggle("hidden", !editable || !editMode);
    $("cancelEmployeeEditBtn")?.classList.toggle("hidden", !editable || !editMode);
    $("reportEmployeeCorrectionBtn")?.classList.toggle("hidden", editMode);
    showMessage($("employeeDetailMessage"), "");
  }

  async function saveEmployeeDetail() {
    const employee = state.activeEmployee;
    if (!employee || !canEditEmployeeRecords()) return;
    const button = $("saveEmployeeBtn");
    setLoading(button, true, "Đang lưu...");
    try {
      const employeePatch = { updated_at: new Date().toISOString() };
      const privatePatch = { employee_id: employee.id, updated_at: new Date().toISOString() };
      document.querySelectorAll("[data-employee-edit]").forEach(input => {
        const key = input.dataset.employeeEdit;
        const value = String(input.value || "").trim() || null;
        if (key.startsWith("private.")) privatePatch[key.slice(8)] = value;
        else employeePatch[key] = value;
      });
      if (!employeePatch.employee_code || !employeePatch.full_name && !employee.full_name) throw new Error("Mã nhân sự và họ tên không được để trống.");
      const { data: updated, error } = await supabase.from("employees").update(employeePatch).eq("id", employee.id).select("*").single();
      if (error) throw error;
      if (isHR()) {
        const { error: privateError } = await supabase.from("employee_private").upsert(privatePatch, { onConflict: "employee_id" });
        if (privateError) throw privateError;
        state.activeEmployeePrivate = { ...(state.activeEmployeePrivate || {}), ...privatePatch };
      }
      const index = state.employees.findIndex(row => row.id === employee.id);
      if (index >= 0) state.employees[index] = updated;
      state.activeEmployee = updated;
      renderEmployeeDetail(false);
      renderEmployees();
      toast("Đã cập nhật hồ sơ nhân sự.");
    } catch (error) {
      showMessage($("employeeDetailMessage"), migrationError(error), "err");
    } finally { setLoading(button, false); }
  }

  async function submitEmployeeCorrection() {
    const employee = state.activeEmployee;
    if (!employee) return;
    const note = $("employeeCorrectionNote")?.value.trim();
    const proposal = $("employeeCorrectionProposal")?.value.trim();
    if (!note) return showMessage($("employeeCorrectionMessage"), "Vui lòng mô tả thông tin cần sửa.", "err");
    const button = $("submitEmployeeCorrectionBtn");
    setLoading(button, true, "Đang gửi...");
    try {
      const { error } = await supabase.from("employee_correction_requests").insert({
        employee_id: employee.id,
        requested_by: state.user.id,
        note,
        proposed_changes: proposal ? { free_text: proposal } : {},
        status: "submitted"
      });
      if (error) throw error;
      const { error: caseError } = await supabase.from("hr_cases").insert({
        case_type: "profile_update",
        title: `Yêu cầu sửa hồ sơ: ${employee.full_name}`,
        description: `${note}${proposal ? `\n\nGiá trị đề xuất: ${proposal}` : ""}`,
        priority: "normal",
        status: "submitted",
        visibility_level: "management",
        creator_id: state.user.id,
        subject_employee_id: employee.id,
        area_id: employee.area_id || state.profile.area_id || null,
        branch_id: employee.branch_id || state.profile.branch_id || null,
        team_id: employee.team_id || state.profile.team_id || null,
        due_at: defaultDueAt("normal")
      });
      if (caseError) console.warn("Không tạo được HR case đi kèm:", caseError);
      $("employeeCorrectionNote").value = "";
      $("employeeCorrectionProposal").value = "";
      closeModal("employeeCorrectionModal");
      toast("Đã gửi yêu cầu chỉnh sửa đến HR.");
    } catch (error) { showMessage($("employeeCorrectionMessage"), migrationError(error), "err"); }
    finally { setLoading(button, false); }
  }

  async function createEmployee() {
    if (!canCreateEmployees()) return;
    const body = {
      employee_code: $("newEmployeeCode")?.value.trim(),
      full_name: $("newEmployeeName")?.value.trim(),
      nickname: $("newEmployeeNickname")?.value.trim(),
      work_email: $("newEmployeeWorkEmail")?.value.trim(),
      personal_email: $("newEmployeePersonalEmail")?.value.trim(),
      phone: $("newEmployeePhone")?.value.trim(),
      department: $("newEmployeeDepartment")?.value.trim(),
      area: $("newEmployeeArea")?.value.trim(),
      branch: $("newEmployeeBranch")?.value.trim(),
      team: $("newEmployeeTeam")?.value.trim(),
      title: $("newEmployeeTitle")?.value.trim(),
      employment_level: $("newEmployeeLevel")?.value.trim(),
      employment_type: $("newEmployeeType")?.value,
      start_date: $("newEmployeeStartDate")?.value || null,
      role_type: $("newEmployeeRole")?.value || "SALE",
      create_account: Boolean($("newEmployeeCreateAccount")?.checked),
      temporary_password: "12345678"
    };
    if (!body.employee_code || !body.full_name) return showMessage($("addEmployeeMessage"), "Vui lòng nhập mã nhân sự và họ tên.", "err");
    const button = $("createEmployeeBtn");
    setLoading(button, true, "Đang tạo...");
    try {
      const { data, error } = await supabase.functions.invoke("hr-create-employee", { body });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.message || "Không tạo được nhân sự.");
      closeModal("addEmployeeModal");
      document.querySelectorAll("#addEmployeeModal input").forEach(input => { if (input.type !== "checkbox") input.value = ""; });
      toast(data.account_created ? "Đã tạo nhân sự và tài khoản. Mật khẩu tạm: 12345678." : "Đã tạo hồ sơ nhân sự.");
      await Promise.allSettled([loadEmployees(), loadOrganization(), loadDashboard()]);
    } catch (error) { showMessage($("addEmployeeMessage"), migrationError(error), "err"); }
    finally { setLoading(button, false); }
  }

  async function linkProfilesToEmployees() {
    if (!isHR()) return;
    const button = $("linkProfilesBtn"); setLoading(button, true, "Đang liên kết...");
    try {
      const { data, error } = await supabase.rpc("link_profiles_to_employees");
      if (error) throw error;
      toast(`Đã liên kết ${data || 0} tài khoản theo email.`);
    } catch (error) { toast(migrationError(error), "err"); }
    finally { setLoading(button, false); }
  }


  const BULK_ROLE_OPTIONS = [
    ["SALE", "SALE"],
    ["EMPLOYEE", "NHÂN VIÊN"],
    ["TTS", "TTS"],
    ["NVPT", "NVPT"],
    ["LEADER", "LEADER"],
    ["BRANCH_MANAGER", "QUẢN LÝ CHI NHÁNH"],
    ["AREA_MANAGER", "QUẢN LÝ KHU VỰC"],
    ["HR", "HR"]
  ];

  function bulkStatusLabel(status) {
    return {
      eligible: "Đủ điều kiện",
      auth_orphan: "Auth chưa liên kết",
      existing: "Đã có tài khoản",
      inactive: "Không còn làm",
      missing_code: "Thiếu mã",
      missing_email: "Thiếu email",
      invalid_email: "Email không hợp lệ",
      duplicate_email: "Email bị trùng",
      duplicate_code: "Mã bị trùng",
      missing_scope: "Thiếu phạm vi",
      invalid_role: "Vai trò chưa hợp lệ",
      role_forbidden: "Không đủ quyền",
      created: "Đã tạo",
      linked: "Đã liên kết",
      error: "Lỗi"
    }[status] || status || "Cần rà soát";
  }

  function bulkStatusClass(row) {
    if (["created","linked","existing"].includes(row.status)) return "approved";
    if (row.eligible || row.status === "auth_orphan") return "pending";
    return "rejected";
  }

  function bulkRoleOptions(selected) {
    const roleRank = { SALE:10, EMPLOYEE:10, TTS:10, NVPT:10, LEADER:20, BRANCH_MANAGER:30, AREA_MANAGER:40, HR:50, ADMIN:60, SUPER_ADMIN:70 };
    const callerRank = roleRank[state.profile?.role_type] || 0;
    return BULK_ROLE_OPTIONS
      .filter(([value]) => state.profile?.role_type === "SUPER_ADMIN" ? roleRank[value] <= callerRank : roleRank[value] < callerRank)
      .map(([value,label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`)
      .join("");
  }

  async function openBulkAccountModal() {
    if (!canCreateEmployees()) return;
    openModal("bulkAccountModal");
    if (!state.bulkAccounts.length) await loadBulkAccountPreview();
    else renderBulkAccountTable();
  }

  async function loadBulkAccountPreview() {
    if (!canCreateEmployees() || state.bulkAccountBusy) return;
    const button = $("refreshBulkAccountsBtn");
    state.bulkAccountBusy = true;
    setLoading(button, true, "Đang kiểm tra...");
    showMessage($("bulkAccountMessage"), "Đang đối chiếu hồ sơ nhân sự, Auth và tài khoản hiện có...");
    try {
      const data = await invokeProtectedFunction("hr-bulk-create-users", { action: "preview" });
      state.bulkAccounts = (data.rows || []).map(row => ({ ...row, selected_role: row.suggested_role }));
      state.bulkSelected.clear();
      populateSelect($("bulkAccountAreaFilter"), unique(state.bulkAccounts.map(row => row.area)), "Tất cả khu vực");
      populateSelect($("bulkAccountBranchFilter"), unique(state.bulkAccounts.map(row => row.branch)), "Tất cả chi nhánh");
      populateSelect($("bulkAccountTeamFilter"), unique(state.bulkAccounts.map(row => row.team)), "Tất cả team");
      renderBulkAccountSummary();
      renderBulkAccountTable();
      showMessage($("bulkAccountMessage"), `Đã kiểm tra ${state.bulkAccounts.length.toLocaleString("vi-VN")} hồ sơ.`, "ok");
    } catch (error) {
      showMessage($("bulkAccountMessage"), migrationError(error), "err");
      $("bulkAccountTable").innerHTML = `<tr><td colspan="6" class="empty-row">${escapeHtml(migrationError(error))}</td></tr>`;
    } finally {
      state.bulkAccountBusy = false;
      setLoading(button, false);
    }
  }

  function renderBulkAccountSummary() {
    const rows = state.bulkAccounts;
    const eligible = rows.filter(row => row.eligible).length;
    const existing = rows.filter(row => row.status === "existing").length;
    const review = rows.length - eligible - existing;
    if ($("bulkTotalCount")) $("bulkTotalCount").textContent = rows.length.toLocaleString("vi-VN");
    if ($("bulkEligibleCount")) $("bulkEligibleCount").textContent = eligible.toLocaleString("vi-VN");
    if ($("bulkExistingCount")) $("bulkExistingCount").textContent = existing.toLocaleString("vi-VN");
    if ($("bulkReviewCount")) $("bulkReviewCount").textContent = Math.max(0, review).toLocaleString("vi-VN");
  }

  function filteredBulkAccounts() {
    const search = normalize($("bulkAccountSearch")?.value);
    const status = $("bulkAccountStatusFilter")?.value || "";
    const area = $("bulkAccountAreaFilter")?.value || "";
    const branch = $("bulkAccountBranchFilter")?.value || "";
    const team = $("bulkAccountTeamFilter")?.value || "";
    return state.bulkAccounts.filter(row => {
      if (search && !normalize(`${row.employee_code} ${row.full_name} ${row.email} ${row.department} ${row.area} ${row.branch} ${row.team}`).includes(search)) return false;
      if (status === "eligible" && !(row.eligible && row.status !== "auth_orphan")) return false;
      if (status === "auth_orphan" && row.status !== "auth_orphan") return false;
      if (status === "existing" && row.status !== "existing") return false;
      if (status === "problem" && (row.eligible || row.status === "existing")) return false;
      if (area && row.area !== area) return false;
      if (branch && row.branch !== branch) return false;
      if (team && row.team !== team) return false;
      return true;
    });
  }

  function renderBulkAccountTable() {
    const host = $("bulkAccountTable");
    if (!host) return;
    const rows = filteredBulkAccounts();
    host.innerHTML = rows.length ? rows.map(row => {
      const checked = state.bulkSelected.has(row.employee_id);
      const scope = [row.department, row.area, row.branch, row.team].filter(Boolean).join(" • ") || "Chưa có phạm vi";
      return `<tr class="${row.eligible ? "" : "bulk-row-disabled"}">
        <td><input type="checkbox" data-bulk-select="${row.employee_id}" ${checked ? "checked" : ""} ${row.eligible ? "" : "disabled"} /></td>
        <td><b>${escapeHtml(row.employee_code || "—")}</b><span class="bulk-person-name">${escapeHtml(row.full_name || "—")}</span></td>
        <td>${escapeHtml(row.email || "—")}</td>
        <td><span class="bulk-scope">${escapeHtml(scope)}</span></td>
        <td>${row.eligible
          ? `<select class="bulk-role-select" data-bulk-role="${row.employee_id}">${bulkRoleOptions(row.selected_role || row.suggested_role)}</select>`
          : `<span>${escapeHtml(roleLabel(row.suggested_role))}</span>`}
        </td>
        <td><span class="badge ${bulkStatusClass(row)}">${escapeHtml(bulkStatusLabel(row.status))}</span><small class="bulk-status-message">${escapeHtml(row.message || "")}</small></td>
      </tr>`;
    }).join("") : '<tr><td colspan="6" class="empty-row">Không có hồ sơ phù hợp với bộ lọc.</td></tr>';

    host.querySelectorAll("[data-bulk-select]").forEach(input => input.addEventListener("change", event => {
      const id = event.target.dataset.bulkSelect;
      if (event.target.checked) state.bulkSelected.add(id); else state.bulkSelected.delete(id);
      updateBulkSelectionState();
    }));
    host.querySelectorAll("[data-bulk-role]").forEach(select => select.addEventListener("change", event => {
      const row = state.bulkAccounts.find(item => item.employee_id === event.target.dataset.bulkRole);
      if (row) row.selected_role = event.target.value;
    }));
    updateBulkSelectionState();
  }

  function updateBulkSelectionState() {
    const count = state.bulkSelected.size;
    if ($("bulkSelectedCount")) $("bulkSelectedCount").textContent = `Đã chọn ${count.toLocaleString("vi-VN")}`;
    if ($("createBulkAccountsBtn")) $("createBulkAccountsBtn").disabled = !count || state.bulkAccountBusy;
    const visibleEligible = filteredBulkAccounts().filter(row => row.eligible);
    if ($("toggleBulkVisible")) {
      $("toggleBulkVisible").checked = visibleEligible.length > 0 && visibleEligible.every(row => state.bulkSelected.has(row.employee_id));
      $("toggleBulkVisible").indeterminate = visibleEligible.some(row => state.bulkSelected.has(row.employee_id)) && !$("toggleBulkVisible").checked;
    }
  }

  function selectAllEligibleBulkAccounts() {
    filteredBulkAccounts().filter(row => row.eligible).forEach(row => state.bulkSelected.add(row.employee_id));
    renderBulkAccountTable();
  }

  function clearBulkAccountSelection() {
    state.bulkSelected.clear();
    renderBulkAccountTable();
  }

  function toggleVisibleBulkAccounts(event) {
    filteredBulkAccounts().filter(row => row.eligible).forEach(row => {
      if (event.target.checked) state.bulkSelected.add(row.employee_id);
      else state.bulkSelected.delete(row.employee_id);
    });
    renderBulkAccountTable();
  }

  async function createBulkAccounts() {
    if (!canCreateEmployees() || state.bulkAccountBusy || !state.bulkSelected.size) return;
    const selected = [...state.bulkSelected]
      .map(id => state.bulkAccounts.find(row => row.employee_id === id))
      .filter(row => row?.eligible);
    if (!selected.length) return;
    const accepted = window.confirm(
      `Tạo ${selected.length} tài khoản với mật khẩu tạm 12345678?\n\nNgười dùng sẽ bị buộc đổi mật khẩu ở lần đăng nhập đầu tiên.`
    );
    if (!accepted) return;

    const button = $("createBulkAccountsBtn");
    state.bulkAccountBusy = true;
    setLoading(button, true, "Đang tạo...");
    const progress = $("bulkProgressBar");
    let completed = 0;
    let success = 0;
    let failed = 0;
    const batchSize = 20;

    try {
      for (let index = 0; index < selected.length; index += batchSize) {
        const chunk = selected.slice(index, index + batchSize);
        showMessage($("bulkAccountMessage"), `Đang xử lý ${index + 1}–${Math.min(index + chunk.length, selected.length)} / ${selected.length}...`);
        const data = await invokeProtectedFunction("hr-bulk-create-users", {
          action: "create",
          records: chunk.map(row => ({ employee_id: row.employee_id, role_type: row.selected_role || row.suggested_role }))
        });
        for (const result of data.results || []) {
          const row = state.bulkAccounts.find(item => item.employee_id === result.employee_id);
          if (!row) continue;
          row.status = result.status;
          row.message = result.message;
          row.eligible = !result.ok;
          if (result.ok) {
            success++;
            state.bulkSelected.delete(result.employee_id);
          } else {
            failed++;
          }
        }
        completed += chunk.length;
        if (progress) progress.style.width = `${Math.round(completed / selected.length * 100)}%`;
        renderBulkAccountSummary();
        renderBulkAccountTable();
      }
      showMessage($("bulkAccountMessage"), `Hoàn tất: ${success} tài khoản thành công, ${failed} lỗi/cần rà soát.`, failed ? "warn" : "ok");
      toast(`Đã tạo ${success} tài khoản.`, failed ? "warn" : "ok", 5000);
      await Promise.allSettled([loadHrDirectory(), loadDashboard()]);
    } catch (error) {
      showMessage($("bulkAccountMessage"), migrationError(error), "err");
    } finally {
      state.bulkAccountBusy = false;
      setLoading(button, false);
      updateBulkSelectionState();
    }
  }

  const CLUSTER_COLORS = {
    "tinh hoa": "#ef3340",
    "ky tai": "#f4c430",
    "kỳ tài": "#f4c430",
    "tien phong": "#1976d2",
    "tiên phong": "#1976d2",
    "buc pha": "#2e9b52",
    "bức phá": "#2e9b52",
    "bứt phá": "#2e9b52",
    "khai pha": "#741f2b",
    "khai phá": "#741f2b"
  };

  function clusterColor(name) {
    const key = normalize(name).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return CLUSTER_COLORS[normalize(name)] || CLUSTER_COLORS[key] || "#6b7280";
  }

  async function loadOrganization() {
    try {
      const [{ data: units, error }, { data: employees, error: employeeError }] = await Promise.all([
        supabase.from("org_units").select("*").eq("status","active").order("unit_type").order("name"),
        supabase.from("employees").select("id,employee_code,full_name,title,area,branch,team,area_id,branch_id,team_id,employment_status,hierarchy_label,employment_level")
      ]);
      if (error) throw error;
      if (employeeError) throw employeeError;
      state.orgUnits = units || [];
      state.orgEmployees = employees || [];
      renderOrganization(state.orgEmployees);
    } catch (error) { $("organizationTree").innerHTML = `<div class="empty-row">${escapeHtml(migrationError(error))}</div>`; }
  }

  function renderOrganization(employees) {
    const host = $("organizationTree");
    const activeEmployees = employees.filter(row => row.employment_status === "active");
    const countBy = key => activeEmployees.filter(row => row[key]).reduce((map,row) => map.set(row[key],(map.get(row[key])||0)+1),new Map());
    const areaCount=countBy("area_id"), branchCount=countBy("branch_id"), teamCount=countBy("team_id");
    const hasPeople = (counter, id) => (counter.get(id) || 0) > 0;
    const teams = state.orgUnits.filter(u => u.unit_type === "team" && hasPeople(teamCount, u.id));
    const branches = state.orgUnits.filter(u => u.unit_type === "branch" && (hasPeople(branchCount, u.id) || teams.some(team => team.parent_id === u.id)));
    const areas = state.orgUnits.filter(u => {
      if (u.unit_type !== "area") return false;
      return hasPeople(areaCount, u.id)
        || branches.some(branch => branch.parent_id === u.id)
        || teams.some(team => team.parent_id === u.id);
    });
    host.innerHTML = areas.length ? areas.map(area => {
      const color = clusterColor(area.name);
      const areaBranches = branches.filter(branch => branch.parent_id === area.id);
      const directTeams = teams.filter(team => team.parent_id === area.id);
      return `<section class="org-area interactive" style="--cluster-color:${color}">
        <button class="org-area-head" data-org-unit-id="${area.id}" title="Nhấp để xem toàn bộ nhân sự khu vực ${escapeHtml(area.name)}">
          <span><i class="cluster-dot"></i><b>${escapeHtml(area.name)}</b><small>Khu vực / Cụm</small></span>
          <strong>${areaCount.get(area.id)||0}<small>nhân sự đang làm</small></strong>
        </button>
        <div class="org-branches">
          ${areaBranches.map(branch => {
            const branchTeams = teams.filter(team => team.parent_id === branch.id);
            return `<article class="org-branch interactive" style="--cluster-color:${color}">
              <button class="org-branch-head" data-org-unit-id="${branch.id}" title="Nhấp để xem chi tiết chi nhánh ${escapeHtml(branch.name)}"><span><b>${escapeHtml(branch.name)}</b><small>Chi nhánh</small></span><span class="portal-chip">${branchCount.get(branch.id)||0} người</span></button>
              <div class="org-team-list">${branchTeams.map(team=>`<button class="org-team interactive" data-org-unit-id="${team.id}" title="Xem thành viên Team ${escapeHtml(team.name)}"><span>${escapeHtml(team.name)}</span><b>${teamCount.get(team.id)||0}</b></button>`).join("") || '<div class="empty-row compact-empty">Chưa có Team.</div>'}</div>
            </article>`;
          }).join("") || '<div class="empty-row">Chưa có chi nhánh.</div>'}
          ${directTeams.length ? `<article class="org-branch interactive" style="--cluster-color:${color}"><div class="org-branch-head"><span><b>Team trực thuộc</b><small>Khu vực</small></span></div><div class="org-team-list">${directTeams.map(team=>`<button class="org-team interactive" data-org-unit-id="${team.id}"><span>${escapeHtml(team.name)}</span><b>${teamCount.get(team.id)||0}</b></button>`).join("")}</div></article>` : ""}
        </div>
      </section>`;
    }).join("") : '<div class="empty-row">Chưa có cây tổ chức. Hãy nhập dữ liệu Excel.</div>';
  }

  function openOrgDetail(unitId) {
    const unit = state.orgUnits.find(item => item.id === unitId);
    if (!unit) return;
    let members = state.orgEmployees.filter(row => {
      if (unit.unit_type === "area") return row.area_id === unit.id;
      if (unit.unit_type === "branch") return row.branch_id === unit.id;
      if (unit.unit_type === "team") return row.team_id === unit.id;
      return false;
    });
    members = members.sort((a,b) => Number(a.employment_status !== "active") - Number(b.employment_status !== "active") || String(a.full_name).localeCompare(String(b.full_name), "vi"));
    const active = members.filter(row => row.employment_status === "active").length;
    const leaders = members.filter(row => /leader|quản lý|quan ly/i.test(`${row.title || ""} ${row.hierarchy_label || ""}`)).length;
    $("orgDetailType").textContent = unit.unit_type === "area" ? "Khu vực / Cụm" : unit.unit_type === "branch" ? "Chi nhánh" : "Team";
    $("orgDetailTitle").textContent = unit.name;
    $("orgDetailSummary").innerHTML = `<div><span>Tổng thành viên</span><b>${members.length}</b></div><div><span>Đang làm</span><b>${active}</b></div><div><span>Quản lý / Leader</span><b>${leaders}</b></div>`;
    $("orgMemberTable").innerHTML = members.length ? members.map(row => `<tr><td><b>${escapeHtml(row.employee_code || "—")}</b></td><td>${escapeHtml(row.full_name)}</td><td>${escapeHtml(row.title || row.hierarchy_label || "—")}</td><td>${escapeHtml(row.branch || "—")}</td><td>${escapeHtml(row.team || "—")}</td><td><span class="badge ${row.employment_status === "active" ? "approved" : "rejected"}">${escapeHtml(EMPLOYEE_STATUS_LABELS[row.employment_status] || row.employment_status)}</span></td><td><button class="btn ghost compact-btn" data-employee-id="${row.id}">Xem</button></td></tr>`).join("") : '<tr><td colspan="7" class="empty-row">Chưa có thành viên.</td></tr>';
    openModal("orgDetailModal");
  }

  const IMPORT_COMPARE_FIELDS = [
    "employee_code","full_name","nickname","work_email","personal_email","phone","department","area","branch","team","title",
    "employment_level","employment_type","start_date","official_date","end_date","employment_status"
  ];

  function comparable(value) { return normalize(value); }

  function buildImportDiff(rows, existingRows) {
    const byCode = new Map(existingRows.filter(row => row.employee_code).map(row => [comparable(row.employee_code), row]));
    const byEmail = new Map();
    existingRows.forEach(row => {
      [row.work_email,row.personal_email].filter(Boolean).forEach(email => byEmail.set(comparable(email), row));
    });
    return rows.map((row,index) => {
      const existing = (row.employee_code && byCode.get(comparable(row.employee_code))) ||
        (row.work_email && byEmail.get(comparable(row.work_email))) ||
        (row.personal_email && byEmail.get(comparable(row.personal_email))) || null;
      const changedFields = existing ? IMPORT_COMPARE_FIELDS.filter(field => comparable(row[field]) !== comparable(existing[field])) : [];
      const status = row.warnings.length ? "review" : !existing ? "new" : changedFields.length ? "changed" : "unchanged";
      return { index, row, existing, status, changedFields };
    });
  }

  async function analyzeImportFile() {
    if (!isHR()) return;
    const file = $("hrImportFile").files?.[0];
    if (!file) return;
    const button = $("analyzeImportBtn"); setLoading(button, true, "Đang phân tích...");
    try {
      state.importResult = await window.UWSImportMapper.parseFile(file);
      let existing = state.employees;
      if (!existing.length) {
        const { data, error } = await supabase.from("employees").select("*").limit(3000);
        if (error) throw error;
        existing = data || [];
        state.employees = existing;
      }
      state.importDiff = buildImportDiff(state.importResult.rows, existing);
      state.importSelected = new Set(state.importDiff.filter(item => ["new","changed","review"].includes(item.status)).map(item => item.index));
      renderImportSummary();
      renderImportDiff();
      updateImportCommitState();
      toast(`Đã so sánh ${state.importResult.summary.total} dòng với dữ liệu Supabase.`);
    } catch (error) { showMessage($("importMessage"), error.message, "err"); }
    finally { setLoading(button, false); }
  }

  function renderImportSummary() {
    const summary = state.importResult?.summary; if (!summary) return;
    const newCount = state.importDiff.filter(item => item.status === "new").length;
    const changedCount = state.importDiff.filter(item => item.status === "changed").length;
    const unchangedCount = state.importDiff.filter(item => item.status === "unchanged").length;
    const reviewCount = state.importDiff.filter(item => item.status === "review").length;
    const cards = [["Tổng dòng",summary.total],["Nhân sự mới",newCount],["Có thay đổi",changedCount],["Không thay đổi",unchangedCount],["Cần rà soát",reviewCount],["Đang làm",summary.active],["Đã nghỉ",summary.resigned],["Khu vực / Chi nhánh",`${summary.areas} / ${summary.branches}`]];
    $("importSummary").innerHTML = cards.map(([label,value]) => `<div class="import-summary-card"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`).join("");
  }

  function visibleImportDiff() {
    const mode = $("importDiffFilter")?.value || "all";
    return state.importDiff.filter(item => mode === "all" || item.status === mode);
  }

  function renderImportDiff() {
    const rows = visibleImportDiff();
    const labels = { new: "Nhân sự mới", changed: "Có thay đổi", unchanged: "Không thay đổi", review: "Cần rà soát" };
    $("importDiffTable").innerHTML = rows.length ? rows.slice(0,500).map(item => `<tr class="import-diff-row ${item.status}">
      <td><input type="checkbox" data-import-index="${item.index}" ${state.importSelected.has(item.index) ? "checked" : ""} ${item.status === "unchanged" ? "disabled" : ""} /></td>
      <td>${item.row.row_number}</td><td>${escapeHtml(item.row.employee_code || "—")}</td><td>${escapeHtml(item.row.full_name)}</td>
      <td><span class="diff-status ${item.status}">${labels[item.status]}</span></td>
      <td>${escapeHtml(item.changedFields.length ? item.changedFields.join(", ") : item.status === "new" ? "Tạo mới" : "—")}</td>
      <td>${escapeHtml(item.row.warnings.join("; ") || "—")}</td></tr>`).join("") : '<tr><td colspan="7" class="empty-row">Không có dòng phù hợp.</td></tr>';
    updateImportCommitState();
  }

  function updateImportCommitState() {
    const button = $("commitImportBtn");
    if (!button) return;
    const count = [...state.importSelected].filter(index => {
      const item = state.importDiff[index];
      return item && ["new","changed","review"].includes(item.status);
    }).length;
    button.disabled = count === 0;
    button.textContent = count ? `Đồng bộ ${count} dòng cần đồng bộ` : "Không có dòng cần đồng bộ";
  }

  function selectChangedImportRows() {
    state.importSelected = new Set(state.importDiff.filter(item => ["new","changed","review"].includes(item.status)).map(item => item.index));
    renderImportDiff();
  }

  function toggleAllVisibleImportRows(event) {
    visibleImportDiff().forEach(item => {
      if (item.status === "unchanged") return;
      if (event.target.checked) state.importSelected.add(item.index); else state.importSelected.delete(item.index);
    });
    renderImportDiff();
  }

  async function commitImport() {
    if (!isHR() || !state.importResult?.rows?.length) return;
    const selected = [...state.importSelected].sort((a,b)=>a-b).map(index => state.importDiff[index]).filter(Boolean).map(item => item.row);
    if (!selected.length) return;
    const button = $("commitImportBtn"); setLoading(button, true, "Đang đồng bộ 0%...");
    showMessage($("importMessage"), `Chỉ đồng bộ ${selected.length} dòng đã chọn. Không đóng trang trong lúc xử lý.`);
    try {
      const chunkSize = 50;
      let batchId = null;
      let imported = 0;
      for (let offset=0; offset<selected.length; offset+=chunkSize) {
        const chunk = selected.slice(offset, offset+chunkSize);
        const { data, error } = await supabase.functions.invoke("hr-import-employees", { body: {
          batch_id: batchId, file_name: $("hrImportFile").files?.[0]?.name || "employees.xlsx",
          records: chunk, finalize: offset + chunkSize >= selected.length, total_rows: selected.length
        }});
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.message || "Import thất bại.");
        batchId = data.batch_id;
        imported += data.processed || chunk.length;
        button.textContent = `Đang đồng bộ ${Math.min(100,Math.round(imported/selected.length*100))}%...`;
      }
      showMessage($("importMessage"), `Hoàn tất đồng bộ ${imported} dòng mới hoặc thay đổi.`, "ok");
      toast("Đã cập nhật dữ liệu nhân sự thành công.");
      state.importSelected.clear();
      await Promise.allSettled([loadEmployees(),loadOrganization(),loadDashboard()]);
      await analyzeImportFile();
    } catch (error) { showMessage($("importMessage"), migrationError(error), "err"); }
    finally { setLoading(button, false); updateImportCommitState(); }
  }

  async function syncSheetFromPortal() {
    if (!isHR()) return;
    const button = $("syncSheetNowBtn");
    setLoading(button, true, "Đang đồng bộ Sheet...");
    try {
      const result = await invokeWorkspaceBridge("sync_sheet_from_app");
      toast(`Đã đồng bộ ${result.total || 0} nhân sự từ Supabase sang Google Sheet.`);
    } catch (error) { toast(migrationError(error), "err", 5200); }
    finally { setLoading(button, false); }
  }

  async function enableBrowserNotifications() {
    if (!("Notification" in window)) return toast("Trình duyệt không hỗ trợ thông báo hệ thống.", "warn");
    const permission = await Notification.requestPermission();
    toast(permission === "granted" ? "Đã bật thông báo trình duyệt." : "Bạn chưa cấp quyền thông báo.", permission === "granted" ? "ok" : "warn");
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./sw.js").catch(()=>{});
  }

  function notifyBrowser(title, body) {
    if (Notification.permission !== "granted" || document.visibilityState === "visible") return;
    navigator.serviceWorker?.ready.then(reg => reg.showNotification(title, { body, icon: "./icons/icon-192.png", badge: "./icons/icon-192.png" })).catch(()=>{});
  }

  function subscribeRealtime() {
    const recipientChannel = supabase.channel(`portal-announcements-${state.user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "announcement_recipients", filter: `recipient_id=eq.${state.user.id}` }, () => { loadAnnouncements(); loadDashboard(); notifyBrowser("Unite HR Portal", "Bạn có thông báo mới."); })
      .subscribe();
    const caseChannel = supabase.channel(`portal-cases-${state.user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "hr_cases" }, () => { loadCases(); loadDashboard(); })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "hr_case_messages" }, payload => {
        if (state.activeCase?.id === payload.new.case_id) loadCaseConversation(state.activeCase.id);
        notifyBrowser("Phản hồi mới", "Một hồ sơ HR vừa có phản hồi mới.");
      }).subscribe();
    state.subscriptions.push(recipientChannel, caseChannel);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once:true });
  else init();
})();
