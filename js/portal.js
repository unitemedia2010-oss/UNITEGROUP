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
    employeePrivateById: new Map(),
    orgUnits: [],
    importResult: null,
    employeePage: 1,
    employeePageSize: 50,
    employeeSmartFilter: {},
    activeEmployee: null,
    activeEmployeePrivate: null,
    orgEmployees: [],
    importDiff: [],
    importSelected: new Set(),
    scheduleFrameLoaded: false,
    activeCase: null,
    hrAssignees: [],
    subscriptions: [],
    bulkAccounts: [],
    bulkSelected: new Set(),
    bulkAccountBusy: false,
    employeeSelected: new Set(),
    lastEmployeePageRows: [],
    employeeFilterOpen: false,
    employeeVisibleColumns: new Set(),
    employeeColumnDraft: new Set(),
    employeeColumnPreset: "operations",
    organizationExpanded: true
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
  function normalize(value) { return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("vi"); }
  function titleCaseVi(value) {
    const raw = String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("vi");
    return raw.replace(/(^|[\s(/-])([\p{L}])/gu, (_, prefix, letter) => `${prefix}${letter.toLocaleUpperCase("vi")}`);
  }
  const DISPLAY_MAPS = {
    department: new Map([["kinh doanh","Kinh Doanh"],["kế toán","Kế Toán"],["ke toan","Kế Toán"],["hr","HR"],["admin","Admin"],["blđ","BLĐ"],["bld","BLĐ"],["trợ lý","Trợ Lý"],["tro ly","Trợ Lý"],["bảo vệ","Bảo Vệ"],["bao ve","Bảo Vệ"],["central real","Central Real"],["marketing","Marketing"]]),
    area: new Map([["tinh hoa","Tinh Hoa"],["kỳ tài","Kỳ Tài"],["ky tai","Kỳ Tài"],["tiên phong","Tiên Phong"],["tien phong","Tiên Phong"],["khai phá","Khai Phá"],["khai pha","Khai Phá"],["bức phá","Bức Phá"],["buc pha","Bức Phá"]]),
    employmentType: new Map([["full time","Full Time"],["fulltime","Full Time"],["part time","Part Time"],["parttime","Part Time"],["ctv","CTV"]]),
    bank: new Map([["acb","ACB"],["sacombank","Sacombank"],["mb","MB Bank"],["mb bank","MB Bank"],["mb bak","MB Bank"],["vietcombank","Vietcombank"],["techcombank","Techcombank"],["techcom","Techcombank"],["tpbank","TPBank"],["tp bank","TPBank"],["vietinbank","VietinBank"],["viettinbank","VietinBank"],["bidv","BIDV"],["bidv bank","BIDV"],["vpbank","VPBank"],["vp bank","VPBank"],["vib","VIB"],["timo bank","Timo"],["timo","Timo"],["vikki bank","Vikki Bank"]])
  };
  function canonicalValue(value, map, fallback = titleCaseVi) {
    const raw = String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
    if (!raw) return "";
    return map.get(normalize(raw)) || fallback(raw);
  }
  function canonicalEmployee(row) {
    const privateData = state.employeePrivateById.get(row.id) || row._private || {};
    return {
      ...row,
      employee_code: String(row.employee_code || "").trim().toUpperCase() || null,
      full_name: titleCaseVi(row.full_name) || row.full_name,
      nickname: titleCaseVi(row.nickname) || null,
      department: canonicalValue(row.department, DISPLAY_MAPS.department) || null,
      area: canonicalValue(row.area, DISPLAY_MAPS.area) || null,
      branch: String(row.branch || "").trim().toLocaleUpperCase("vi") || null,
      team: String(row.team || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleUpperCase("vi") || null,
      employment_type: canonicalValue(row.employment_type, DISPLAY_MAPS.employmentType) || null,
      work_email: normalize(row.work_email) || null,
      personal_email: normalize(row.personal_email) || null,
      _private: {
        ...privateData,
        bank_name: canonicalValue(privateData.bank_name, DISPLAY_MAPS.bank) || null
      }
    };
  }
  function sameText(a, b) { return normalize(a) === normalize(b); }
  function uniqueCI(values) {
    const result = new Map();
    values.filter(Boolean).forEach(value => {
      const normalized = normalize(value);
      if (!result.has(normalized)) result.set(normalized, value);
    });
    return [...result.values()].sort((a,b) => String(a).localeCompare(String(b), "vi", { sensitivity: "base" }));
  }
  function employeeCodeGroup(code) {
    const value = String(code || "").trim().toUpperCase();
    if (!value) return "no_code";
    if (/^TVU/.test(value)) return "probation";
    if (/^U/.test(value)) return "official";
    return "other";
  }
  const EMPLOYEE_CODE_GROUP_LABELS = { official: "Chính thức (U)", probation: "Thử việc (TVU)", no_code: "Chưa có mã", other: "Mã khác" };
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
  function unique(values) { return uniqueCI(values); }

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

  function openPortalPasswordModal() {
    ["portalCurrentPassword","portalNewPassword","portalConfirmPassword"].forEach(id => { if ($(id)) $(id).value = ""; });
    showMessage($("portalPasswordMessage"), "");
    openModal("portalChangePasswordModal");
    setTimeout(() => $("portalCurrentPassword")?.focus(), 60);
  }

  function closePortalPasswordModal() {
    closeModal("portalChangePasswordModal");
    showMessage($("portalPasswordMessage"), "");
  }

  async function changePortalPassword() {
    const current = String($("portalCurrentPassword")?.value || "");
    const next = String($("portalNewPassword")?.value || "");
    const confirm = String($("portalConfirmPassword")?.value || "");
    const button = $("portalSubmitPasswordBtn");
    if (!current) return showMessage($("portalPasswordMessage"), "Vui lòng nhập mật khẩu hiện tại.", "err");
    if (next.length < 8) return showMessage($("portalPasswordMessage"), "Mật khẩu mới cần tối thiểu 8 ký tự.", "err");
    if (next === "12345678") return showMessage($("portalPasswordMessage"), "Không tiếp tục dùng mật khẩu mặc định 12345678.", "err");
    if (next !== confirm) return showMessage($("portalPasswordMessage"), "Hai lần nhập mật khẩu mới chưa khớp.", "err");
    setLoading(button, true, "Đang cập nhật...");
    try {
      const email = state.user?.email || state.profile?.email;
      if (!email) throw new Error("Không xác định được email đăng nhập.");
      const verify = await supabase.auth.signInWithPassword({ email, password: current });
      if (verify.error) throw new Error("Mật khẩu hiện tại không đúng.");
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw error;
      showMessage($("portalPasswordMessage"), "Đổi mật khẩu thành công.", "ok");
      toast("Đã cập nhật mật khẩu.");
      setTimeout(closePortalPasswordModal, 700);
    } catch (error) {
      showMessage($("portalPasswordMessage"), error.message || String(error), "err");
    } finally {
      setLoading(button, false);
    }
  }

  function migrationError(error) {
    const message = error?.message || String(error || "");
    return /does not exist|schema cache|relation .* not found|column .* not found/i.test(message)
      ? "Database chưa được cập nhật đủ migration V32. Hãy chạy các migration còn thiếu trên Supabase."
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

    loadEmployeeColumnPreferences();
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
    if ($("employeeColumnView")) $("employeeColumnView").value = state.employeeColumnPreset || (window.innerWidth <= 820 ? "operations" : (isHR() ? "full" : "operations"));
    if ($("employeePageSize")) $("employeePageSize").value = "50";

    document.querySelectorAll(".hr-only,.hr-only-control,.hr-only-page").forEach(el => el.classList.toggle("hidden", !isHR()));
    const roleRank = { SALE:10, EMPLOYEE:10, TTS:10, NVPT:10, LEADER:20, BRANCH_MANAGER:30, AREA_MANAGER:40, HR:50, ADMIN:60, SUPER_ADMIN:70 };
    const callerRank = roleRank[profile.role_type] || 0;
    document.querySelectorAll("#newEmployeeRole option").forEach(option => {
      const targetRank = roleRank[option.value] || 999;
      option.disabled = profile.role_type === "SUPER_ADMIN" ? targetRank > callerRank : targetRank >= callerRank;
    });
    document.querySelectorAll(".manager-nav,.manager-card,.manager-page,.manager-filter").forEach(el => el.classList.toggle("hidden", !isManager()));
    if (!isHR() && state.page === "import") goToPage("dashboard");
    if (!isManager() && ["employees", "organization"].includes(state.page)) goToPage("dashboard");
  }

  function bindEvents() {
    document.querySelectorAll(".portal-nav-item[data-page]").forEach(btn => btn.addEventListener("click", () => goToPage(btn.dataset.page)));
    document.querySelectorAll("[data-goto]").forEach(btn => btn.addEventListener("click", () => goToPage(btn.dataset.goto)));
    $("portalMenuBtn")?.addEventListener("click", () => {
      const sidebar = $("portalSidebar");
      const isOpen = sidebar?.classList.toggle("open");
      $("portalMenuBtn")?.classList.toggle("is-active", !!isOpen);
      $("portalMenuBtn")?.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });
    $("portalLogoutBtn")?.addEventListener("click", async () => { await supabase.auth.signOut(); window.location.replace("./index.html"); });
    $("portalChangePasswordBtn")?.addEventListener("click", openPortalPasswordModal);
    $("portalSubmitPasswordBtn")?.addEventListener("click", changePortalPassword);
    document.querySelectorAll("[data-close-portal-password]").forEach(el => el.addEventListener("click", closePortalPasswordModal));
    $("portalInboxBtn")?.addEventListener("click", () => goToPage("announcements"));
    $("openScheduleBtn")?.addEventListener("click", () => goToPage("schedule"));
    $("reloadScheduleFrameBtn")?.addEventListener("click", () => loadScheduleFrame(true));
    $("organizationExpandAllBtn")?.addEventListener("click", () => { state.organizationExpanded = true; if (state.orgEmployees.length) renderOrganization(state.orgEmployees); });
    $("enableBrowserNotificationsBtn")?.addEventListener("click", enableBrowserNotifications);
    $("dashboardAddEmployeeBtn")?.addEventListener("click", () => {
      populateAddEmployeeDatalists();
      openModal("addEmployeeModal");
    });

    $("createAnnouncementBtn")?.addEventListener("click", async () => {
      openModal("announcementModal");
      await prepareAnnouncementTargetOptions();
    });
    document.querySelectorAll("[data-close-announcement]").forEach(el => el.addEventListener("click", () => closeModal("announcementModal")));
    $("announcementTargetType")?.addEventListener("change", updateAnnouncementTargetUI);
    $("publishAnnouncementBtn")?.addEventListener("click", publishAnnouncement);
    ["announcementSearch","announcementPriorityFilter","announcementReadFilter"].forEach(id => $(id)?.addEventListener("input", renderAnnouncements));

    $("createCaseBtn")?.addEventListener("click", () => openModal("caseCreateModal"));
    [["caseFiles","caseFilesLabel"],["caseReplyFiles","caseReplyFilesLabel"]].forEach(([inputId,labelId]) => {
      $(inputId)?.addEventListener("change", event => {
        const files = [...(event.target.files || [])];
        const label = $(labelId);
        if (!label) return;
        label.textContent = !files.length ? "Chọn tệp đính kèm" : files.length === 1 ? files[0].name : `${files.length} tệp đã chọn`;
      });
    });
    document.querySelectorAll("[data-close-case-create]").forEach(el => el.addEventListener("click", () => closeModal("caseCreateModal")));
    document.querySelectorAll("[data-close-case-detail]").forEach(el => el.addEventListener("click", () => closeModal("caseDetailModal")));
    $("submitCaseBtn")?.addEventListener("click", createCase);
    $("sendCaseReplyBtn")?.addEventListener("click", sendCaseReply);
    $("caseStatusUpdate")?.addEventListener("change", updateCaseStatus);
    $("saveCaseAssignmentBtn")?.addEventListener("click", saveCaseAssignment);
    ["caseSearch","caseStatusFilter","casePriorityFilter","caseAreaFilter"].forEach(id => $(id)?.addEventListener("input", renderCases));

    ["employeeSearch","employeeCodeGroupFilter","employeeTitleFilter","employeeLevelFilter","employeeTypeFilter","employeeBankFilter","employeeBankDataFilter","employeeQualityFilter","employeeSortSelect","employeeGroupSelect"].forEach(id => $(id)?.addEventListener("input", () => { state.employeePage = 1; renderEmployees(); }));
    $("employeeStatusFilter")?.addEventListener("change", () => { rebuildEmployeeHierarchyFilters("status"); state.employeePage = 1; renderEmployees(); });
    $("employeeDepartmentFilter")?.addEventListener("change", () => { rebuildEmployeeHierarchyFilters("department"); state.employeePage = 1; renderEmployees(); });
    $("employeeAreaFilter")?.addEventListener("change", () => { rebuildEmployeeHierarchyFilters("area"); state.employeePage = 1; renderEmployees(); });
    $("employeeBranchFilter")?.addEventListener("change", () => { rebuildEmployeeHierarchyFilters("branch"); state.employeePage = 1; renderEmployees(); });
    $("employeeTeamFilter")?.addEventListener("change", () => { state.employeePage = 1; renderEmployees(); });
    $("exportFilteredEmployeesBtn")?.addEventListener("click", exportFilteredEmployees);
    $("employeeColumnView")?.addEventListener("change", event => {
      const preset = event.target.value || "operations";
      if (preset !== "custom") applyEmployeeColumnPreset(preset, { save: true, render: true });
      else { state.employeeColumnPreset = "custom"; saveEmployeeColumnPreferences(); renderEmployees(); }
    });
    $("openEmployeeColumnModalBtn")?.addEventListener("click", openEmployeeColumnModal);
    document.querySelectorAll("[data-close-employee-columns]").forEach(el => el.addEventListener("click", closeEmployeeColumnModal));
    $("employeeColumnPresetSelect")?.addEventListener("change", event => applyEmployeeColumnPresetToDraft(event.target.value));
    $("employeeColumnSelectAllBtn")?.addEventListener("click", selectAllEmployeeColumns);
    $("employeeColumnResetBtn")?.addEventListener("click", () => applyEmployeeColumnPresetToDraft($("employeeColumnPresetSelect")?.value || "operations"));
    $("applyEmployeeColumnsBtn")?.addEventListener("click", applyEmployeeColumnSelection);
    $("employeePageSize")?.addEventListener("change", event => {
      state.employeePageSize = event.target.value === "all" ? Number.MAX_SAFE_INTEGER : Number(event.target.value || 50);
      state.employeePage = 1;
      renderEmployees();
    });
    $("employeeGridFullscreenBtn")?.addEventListener("click", toggleEmployeeGridFullscreen);
    document.addEventListener("fullscreenchange", updateEmployeeFullscreenButton);
    $("employeeFilterToggleBtn")?.addEventListener("click", toggleEmployeeFilterPanel);
    $("selectAllFilteredEmployeesBtn")?.addEventListener("click", selectAllFilteredEmployees);
    $("clearEmployeeSelectionBtn")?.addEventListener("click", clearEmployeeSelection);
    $("openBulkEmployeeEditBtn")?.addEventListener("click", openBulkEmployeeEditModal);
    $("saveBulkEmployeeEditBtn")?.addEventListener("click", saveBulkEmployeeEdit);
    document.querySelectorAll("[data-close-bulk-employee]").forEach(el => el.addEventListener("click", closeBulkEmployeeEditModal));
    document.querySelectorAll("[data-bulk-field-toggle]").forEach(toggle => toggle.addEventListener("change", () => {
      updateBulkEmployeeFieldState(toggle.dataset.bulkFieldToggle);
      updateBulkEmployeePreview();
    }));
    ["bulkEmployeeDepartment","bulkEmployeeArea","bulkEmployeeBranch","bulkEmployeeTeam","bulkEmployeeTitle","bulkEmployeeLevel","bulkEmployeeType","bulkEmployeeStatus"].forEach(id => $(id)?.addEventListener("input", updateBulkEmployeePreview));
    $("applyEmployeeSmartFilterBtn")?.addEventListener("click", applyEmployeeSmartFilter);
    $("employeeSmartFilter")?.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); applyEmployeeSmartFilter(); } });
    $("clearEmployeeFiltersBtn")?.addEventListener("click", clearEmployeeFilters);
    document.querySelectorAll("[data-close-employee-detail]").forEach(el => el.addEventListener("click", () => closeModal("employeeDetailModal")));
    $("linkProfilesBtn")?.addEventListener("click", linkProfilesToEmployees);
    $("openMyEmployeeDetailBtn")?.addEventListener("click", () => {
      const id = state.profile?.employee_record_id;
      if (id) openEmployeeDetail(id);
    });
    $("addEmployeeBtn")?.addEventListener("click", () => {
      populateAddEmployeeDatalists();
      openModal("addEmployeeModal");
    });
    document.querySelectorAll("[data-close-add-employee]").forEach(el => el.addEventListener("click", () => closeModal("addEmployeeModal")));
    [["newEmployeeDepartment","department"],["newEmployeeArea","area"],["newEmployeeBranch","branch"]].forEach(([id, level]) => {
      $(id)?.addEventListener("change", () => populateAddEmployeeDatalists(level));
    });
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

    $("hrImportFile")?.addEventListener("change", event => handleImportFileSelected(event.target.files?.[0] || null));
    const importDropZone = document.querySelector('label.file-drop[for="hrImportFile"]');
    if (importDropZone) {
      ["dragenter","dragover"].forEach(type => importDropZone.addEventListener(type, event => {
        event.preventDefault();
        importDropZone.classList.add("is-dragging");
      }));
      ["dragleave","drop"].forEach(type => importDropZone.addEventListener(type, event => {
        event.preventDefault();
        importDropZone.classList.remove("is-dragging");
      }));
      importDropZone.addEventListener("drop", event => {
        const file = event.dataTransfer?.files?.[0];
        if (!file) return;
        const input = $("hrImportFile");
        try {
          const transfer = new DataTransfer();
          transfer.items.add(file);
          input.files = transfer.files;
        } catch {}
        handleImportFileSelected(file);
      });
    }
    $("analyzeImportBtn")?.addEventListener("click", analyzeImportFile);
    $("commitImportBtn")?.addEventListener("click", commitImport);
    $("syncSheetNowBtn")?.addEventListener("click", syncSheetFromPortal);
    $("importDiffFilter")?.addEventListener("change", renderImportDiff);
    $("importPreserveExistingData")?.addEventListener("change", () => {
      if (!state.importResult?.rows?.length) return;
      state.importDiff = buildImportDiff(state.importResult.rows, state.employees);
      state.importSelected = new Set(state.importDiff.filter(item => !item.blocked && ["new","changed","review"].includes(item.status)).map(item => item.index));
      renderImportSummary();
      renderImportDiff();
    });
    $("selectChangedImportBtn")?.addEventListener("click", selectChangedImportRows);
    $("toggleImportSelection")?.addEventListener("change", toggleAllVisibleImportRows);

    document.addEventListener("change", event => {
      const employeeCheckbox = event.target.closest("[data-employee-select]");
      if (employeeCheckbox) {
        setEmployeeSelected(employeeCheckbox.dataset.employeeSelect, employeeCheckbox.checked);
        return;
      }
      if (event.target.id === "employeeSelectPage") {
        state.lastEmployeePageRows.forEach(row => setEmployeeSelected(row.id, event.target.checked, false));
        renderEmployees();
      }
    });

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
      if (window.innerWidth <= 820 && event.target.closest(".portal-nav-item")) {
        $("portalSidebar")?.classList.remove("open");
        $("portalMenuBtn")?.classList.remove("is-active");
        $("portalMenuBtn")?.setAttribute("aria-expanded", "false");
      }
    });
  }

  function handleImportFileSelected(file) {
    const name = $("hrImportFileName");
    const analyze = $("analyzeImportBtn");
    const commit = $("commitImportBtn");
    const dropZone = document.querySelector('label.file-drop[for="hrImportFile"]');
    if (name) name.textContent = file ? `${file.name} • ${(file.size / 1024 / 1024).toFixed(1)} MB` : "Chưa chọn file.";
    if (analyze) analyze.disabled = !file;
    if (commit) commit.disabled = true;
    state.importResult = null;
    dropZone?.classList.toggle("has-file", !!file);
    const copy = dropZone?.querySelector(".file-drop-copy b");
    if (copy) copy.textContent = file ? file.name : "Thả file Excel/CSV vào đây";
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
      isManager() ? supabase.from("employees").select("id,employee_code,full_name,employment_status,department,area,branch,team,work_email,personal_email,phone,data_quality") : Promise.resolve({ data: [], error: null }),
      isManager() ? supabase.from("schedule_requests").select("employee_id,status,work_date").gte("work_date", weekStart).lte("work_date", weekEnd).neq("status", "cancelled") : Promise.resolve({ data: [], error: null }),
      isManager() ? supabase.from("schedule_requests").select("employee_id,status").eq("work_date", today).eq("status", "approved") : Promise.resolve({ data: [], error: null }),
      isManager() ? supabase.from("leave_requests").select("employee_id,status").eq("leave_date", today).eq("status", "approved") : Promise.resolve({ data: [], error: null }),
      isManager() ? supabase.from("unavailability").select("employee_id,status").eq("unavailable_date", today).eq("status", "active") : Promise.resolve({ data: [], error: null })
    ]);

    const employees = employeesResponse.data || [];
    const activeRows = employees.filter(row => row.employment_status === "active");
    const active = activeRows.length;
    const reserved = employees.filter(row => row.employment_status === "reserved").length;
    const resigned = employees.filter(row => row.employment_status === "resigned").length;
    const total = employees.length;
    const activeGroups = activeRows.reduce((counts, row) => {
      const group = employeeCodeGroup(row.employee_code);
      counts[group] = (counts[group] || 0) + 1;
      return counts;
    }, { official: 0, probation: 0, no_code: 0, other: 0 });
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
    if ($("metricEmployeeGroups")) {
      $("metricEmployeeGroups").textContent = `U: ${activeGroups.official} • TVU: ${activeGroups.probation} • Chưa mã: ${activeGroups.no_code}${activeGroups.other ? ` • Khác: ${activeGroups.other}` : ""}`;
    }
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

    renderDashboardOperations(employees, activeRows);
    updateBadges(announcements, cases);
    renderDashboardFeeds();
  }

  function renderDashboardOperations(allEmployees, activeEmployees) {
    const departmentHost = $("dashboardDepartmentBars");
    const attentionHost = $("dashboardAttentionList");
    const departmentCounts = new Map();
    activeEmployees.forEach(row => {
      const label = canonicalValue(row.department, DISPLAY_MAPS.department) || "Chưa có phòng ban";
      departmentCounts.set(label, (departmentCounts.get(label) || 0) + 1);
    });
    const topDepartments = [...departmentCounts.entries()].sort((a,b) => b[1] - a[1]).slice(0, 6);
    const maxDepartment = Math.max(1, ...topDepartments.map(([,count]) => count));
    if (departmentHost) {
      departmentHost.innerHTML = topDepartments.length ? topDepartments.map(([label,count], index) => `
        <button class="dashboard-rank-item" type="button" data-goto="employees">
          <span class="dashboard-rank-index">${String(index + 1).padStart(2, "0")}</span>
          <span class="dashboard-rank-copy"><b>${escapeHtml(label)}</b><i><em style="width:${Math.max(8, count / maxDepartment * 100)}%"></em></i></span>
          <strong>${count}</strong>
        </button>`).join("") : '<div class="empty-row">Chưa có dữ liệu phòng ban.</div>';
    }

    const missingCode = activeEmployees.filter(row => !String(row.employee_code || "").trim()).length;
    const missingContact = activeEmployees.filter(row => !String(row.work_email || row.personal_email || row.phone || "").trim()).length;
    const missingOrg = activeEmployees.filter(row => !row.department || (sameText(row.department, "Kinh Doanh") && (!row.area || !row.team))).length;
    const review = allEmployees.filter(row => ["needs_review","invalid"].includes(row.data_quality)).length;
    const attention = [
      { label: "Hồ sơ cần rà soát", value: review, tone: "warning", hint: "Dữ liệu có cảnh báo hoặc không hợp lệ" },
      { label: "Nhân sự chưa có mã", value: missingCode, tone: "danger", hint: "Đang làm nhưng thiếu mã nhân sự" },
      { label: "Thiếu thông tin liên hệ", value: missingContact, tone: "info", hint: "Thiếu email và số điện thoại" },
      { label: "Thiếu tuyến tổ chức", value: missingOrg, tone: "neutral", hint: "Thiếu phòng ban, khu vực hoặc Team" }
    ];
    if (attentionHost) {
      attentionHost.innerHTML = attention.map(item => `
        <button class="dashboard-attention-item ${item.tone}" type="button" data-goto="employees">
          <span class="attention-indicator"></span><span><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.hint)}</small></span><strong>${item.value}</strong>
        </button>`).join("");
    }
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
      if ($("caseFilesLabel")) $("caseFilesLabel").textContent = "Chọn tệp đính kèm";
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
      if ($("caseReplyFilesLabel")) $("caseReplyFilesLabel").textContent = "Chọn tệp đính kèm";
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
        employee = canonicalEmployee(data);
        if (!state.employees.some(row => row.id === data.id)) state.employees.push(employee);
      }
      const fields = [["Mã nhân sự",employee.employee_code],["Họ tên",employee.full_name],["Nick Name",employee.nickname],["Phòng ban",employee.department],["Khu vực",employee.area],["Chi nhánh",employee.branch],["Team",employee.team],["Chức danh",employee.title],["Cấp bậc",employee.employment_level],["Email",employee.work_email || employee.personal_email],["Điện thoại",employee.phone],["Trạng thái",EMPLOYEE_STATUS_LABELS[employee.employment_status]]];
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
        .limit(3000);
      if (response.error && /department_rank|hierarchy_rank|source_row_order/i.test(response.error.message || "")) {
        response = await supabase.from("employees").select("*").order("full_name", { ascending: true }).limit(3000);
      }
      if (response.error) throw response.error;

      state.employeePrivateById = new Map();
      if (isHR()) {
        const privateResponse = await supabase
          .from("employee_private")
          .select("*");
        if (privateResponse.error) throw privateResponse.error;
        (privateResponse.data || []).forEach(row => state.employeePrivateById.set(row.employee_id, row));
      }

      state.employees = (response.data || []).map(canonicalEmployee);
      populateEmployeeFilters();
      renderEmployees();
    } catch (error) {
      $("employeeTable").innerHTML = `<tr><td colspan="12" class="empty-row">${escapeHtml(migrationError(error))}</td></tr>`;
    }
  }

  function populateSelect(select, values, allLabel = "Tất cả") {
    if (!select) return;
    const current = select.value;
    const options = uniqueCI(values);
    select.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>` + options.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
    const matching = options.find(value => sameText(value, current));
    if (matching) select.value = matching;
  }

  function hierarchyFilteredRows({ ignore = "" } = {}) {
    const status = $("employeeStatusFilter")?.value || "";
    const department = $("employeeDepartmentFilter")?.value || "";
    const area = $("employeeAreaFilter")?.value || "";
    const branch = $("employeeBranchFilter")?.value || "";
    const team = $("employeeTeamFilter")?.value || "";
    return state.employees.filter(row => {
      if (status && row.employment_status !== status) return false;
      if (ignore !== "department" && department && !sameText(row.department, department)) return false;
      if (ignore !== "area" && area && !sameText(row.area, area)) return false;
      if (ignore !== "branch" && branch && !sameText(row.branch, branch)) return false;
      if (ignore !== "team" && team && !sameText(row.team, team)) return false;
      return true;
    });
  }

  function rebuildEmployeeHierarchyFilters(changedLevel = "") {
    if (changedLevel === "department") {
      if ($("employeeAreaFilter")) $("employeeAreaFilter").value = "";
      if ($("employeeBranchFilter")) $("employeeBranchFilter").value = "";
      if ($("employeeTeamFilter")) $("employeeTeamFilter").value = "";
    } else if (changedLevel === "area") {
      if ($("employeeBranchFilter")) $("employeeBranchFilter").value = "";
      if ($("employeeTeamFilter")) $("employeeTeamFilter").value = "";
    } else if (changedLevel === "branch") {
      if ($("employeeTeamFilter")) $("employeeTeamFilter").value = "";
    }

    const status = $("employeeStatusFilter")?.value || "";
    const department = $("employeeDepartmentFilter")?.value || "";
    const statusRows = state.employees.filter(row => !status || row.employment_status === status);
    const areaRows = statusRows.filter(row => !department || sameText(row.department, department));
    populateSelect($("employeeAreaFilter"), areaRows.map(row => row.area), "Tất cả khu vực");

    const area = $("employeeAreaFilter")?.value || "";
    const branchRows = areaRows.filter(row => !area || sameText(row.area, area));
    populateSelect($("employeeBranchFilter"), branchRows.map(row => row.branch), "Tất cả chi nhánh");

    const branch = $("employeeBranchFilter")?.value || "";
    const teamRows = branchRows.filter(row => !branch || sameText(row.branch, branch));
    populateSelect($("employeeTeamFilter"), teamRows.map(row => row.team), "Tất cả team");

    const currentRows = hierarchyFilteredRows();
    populateSelect($("employeeTitleFilter"), currentRows.map(row => row.title), "Tất cả chức danh");
    populateSelect($("employeeLevelFilter"), currentRows.map(row => row.employment_level), "Tất cả cấp bậc");
    populateSelect($("employeeTypeFilter"), currentRows.map(row => row.employment_type), "Tất cả loại công việc");
    if (isHR()) populateSelect($("employeeBankFilter"), currentRows.map(row => row._private?.bank_name), "Tất cả ngân hàng");
  }

  function populateEmployeeFilters() {
    populateSelect($("employeeDepartmentFilter"), state.employees.map(row => row.department), "Tất cả phòng ban");
    rebuildEmployeeHierarchyFilters();
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
      department: findDimensionMention(query, unique(state.employees.map(row => row.department))),
      area: findDimensionMention(query, unique(state.employees.map(row => row.area))),
      branch: findDimensionMention(query, unique(state.employees.map(row => row.branch))),
      team: findDimensionMention(query, unique(state.employees.map(row => row.team))),
      title: findDimensionMention(query, unique(state.employees.map(row => row.title))),
      level: findDimensionMention(query, unique(state.employees.map(row => row.employment_level))),
      type: findDimensionMention(query, unique(state.employees.map(row => row.employment_type)))
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
    ["employeeDepartmentFilter","employeeAreaFilter","employeeBranchFilter","employeeTeamFilter","employeeCodeGroupFilter","employeeTitleFilter","employeeLevelFilter","employeeTypeFilter","employeeBankFilter","employeeBankDataFilter","employeeQualityFilter"].forEach(id => { if ($(id)) $(id).value = ""; });
    if ($("employeeStatusFilter")) $("employeeStatusFilter").value = "active";
    if ($("employeeSortSelect")) $("employeeSortSelect").value = "organization";
    if ($("employeeGroupSelect")) $("employeeGroupSelect").value = "department";
    state.employeeSmartFilter = {};
    state.employeePage = 1;
    populateEmployeeFilters();
    renderSmartFilterChips();
    renderEmployees();
  }

  function smartFilterMatches(row) {
    const f = state.employeeSmartFilter || {};
    if (f.status && row.employment_status !== f.status) return false;
    if (f.quality && row.data_quality !== f.quality) return false;
    if (f.department && !sameText(row.department, f.department)) return false;
    if (f.area && !sameText(row.area, f.area)) return false;
    if (f.branch && !sameText(row.branch, f.branch)) return false;
    if (f.team && !sameText(row.team, f.team)) return false;
    if (f.title && !sameText(row.title, f.title)) return false;
    if (f.level && !sameText(row.employment_level, f.level)) return false;
    if (f.type && !sameText(row.employment_type, f.type)) return false;
    if (f.hierarchyLabel && row.hierarchy_label !== f.hierarchyLabel) return false;
    if (Number.isFinite(f.maxHierarchyRank) && Number(row.hierarchy_rank || 999) > f.maxHierarchyRank) return false;
    if (Number.isFinite(f.minHierarchyRank) && Number(row.hierarchy_rank || 999) < f.minHierarchyRank) return false;
    if (f.missingCode && String(row.employee_code || "").trim()) return false;
    if (f.missingEmail && (String(row.work_email || "").trim() || String(row.personal_email || "").trim())) return false;
    return true;
  }

  function filteredEmployees() {
    const search = normalize($("employeeSearch")?.value);
    const status = $("employeeStatusFilter")?.value || "";
    const department = $("employeeDepartmentFilter")?.value || "";
    const area = $("employeeAreaFilter")?.value || "";
    const branch = $("employeeBranchFilter")?.value || "";
    const team = $("employeeTeamFilter")?.value || "";
    const codeGroup = $("employeeCodeGroupFilter")?.value || "";
    const title = $("employeeTitleFilter")?.value || "";
    const level = $("employeeLevelFilter")?.value || "";
    const type = $("employeeTypeFilter")?.value || "";
    const bank = $("employeeBankFilter")?.value || "";
    const bankData = $("employeeBankDataFilter")?.value || "";
    const quality = $("employeeQualityFilter")?.value || "";

    return state.employees.filter(row => {
      const privateData = row._private || {};
      if (search && !normalize(`${row.employee_code} ${row.full_name} ${row.nickname} ${row.work_email} ${row.personal_email} ${row.phone} ${row.department} ${row.area} ${row.branch} ${row.team} ${row.title} ${row.employment_level} ${privateData.bank_name} ${privateData.bank_account}`).includes(search)) return false;
      if (status && row.employment_status !== status) return false;
      if (department && !sameText(row.department, department)) return false;
      if (area && !sameText(row.area, area)) return false;
      if (branch && !sameText(row.branch, branch)) return false;
      if (team && !sameText(row.team, team)) return false;
      if (codeGroup && employeeCodeGroup(row.employee_code) !== codeGroup) return false;
      if (title && !sameText(row.title, title)) return false;
      if (level && !sameText(row.employment_level, level)) return false;
      if (type && !sameText(row.employment_type, type)) return false;
      if (isHR() && bank && !sameText(privateData.bank_name, bank)) return false;
      if (isHR() && bankData === "complete" && (!privateData.bank_name || !privateData.bank_account)) return false;
      if (isHR() && bankData === "missing_account" && (!privateData.bank_name || privateData.bank_account)) return false;
      if (isHR() && bankData === "missing_bank" && (privateData.bank_name || !privateData.bank_account)) return false;
      if (isHR() && bankData === "missing_all" && (privateData.bank_name || privateData.bank_account)) return false;
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

  const EMPLOYEE_COLUMN_GROUPS = {
    select: "",
    identity: "Thông tin cá nhân",
    work: "Thông tin công việc",
    contact: "Thông tin liên hệ",
    payroll: "Lương & ngân hàng",
    probation: "Thử việc / hợp đồng",
    status: "Trạng thái"
  };

  const EMPLOYEE_COLUMNS = {
    operations: [
      ["employee_code","Mã","identity"],["full_name","Họ tên","identity"],["nickname","Nick Name","identity"],
      ["department","Phòng ban","work"],["area","Khu vực","work"],["branch","Chi nhánh","work"],["team","Team","work"],
      ["title","Chức danh","work"],["employment_level","Cấp bậc","work"],["employment_type","Loại","work"],
      ["employment_status","Trạng thái","status"],["action","","status"]
    ],
    accounting: [
      ["employee_code","Mã","identity"],["full_name","Họ tên","identity"],["nickname","Nick Name","identity"],
      ["department","Phòng ban","work"],["area","Khu vực","work"],["branch","Chi nhánh","work"],["team","Team","work"],
      ["phone","Số điện thoại","contact"],["bank_name","Ngân hàng","payroll"],["bank_account","Số tài khoản","payroll"],
      ["current_salary","Lương hiện tại","payroll"],["employment_status","Trạng thái","status"],["action","","status"]
    ],
    full: [
      ["employee_code","Mã số NV","identity"],["full_name","Họ và tên","identity"],["nickname","Nick Name","identity"],["gender","Giới tính","identity"],["birth_date","Ngày sinh","identity"],
      ["department","Phòng ban","work"],["start_date","Ngày bắt đầu","work"],["area","Khu vực / Cụm","work"],["branch","Chi nhánh","work"],["team","Team","work"],
      ["title","Chức danh","work"],["employment_level","Cấp bậc","work"],["employment_type","Loại công việc","work"],
      ["work_email","Email công việc","contact"],["personal_email","Email cá nhân","contact"],["phone","Số điện thoại","contact"],
      ["ethnicity","Dân tộc","identity"],["religion","Tôn giáo","identity"],["nationality","Quốc tịch","identity"],["citizen_id","Số CCCD","identity"],["social_insurance_no","Số BHXH","identity"],["tax_code","Mã số thuế","identity"],
      ["address_line","Địa chỉ","contact"],["district","Quận/Huyện","contact"],["province","Tỉnh/TP","contact"],
      ["starting_salary","Lương khởi điểm","payroll"],["current_salary","Lương hiện tại","payroll"],["bank_account","Số tài khoản","payroll"],["bank_name","Ngân hàng","payroll"],
      ["probation_start","Ngày thử việc","probation"],["probation_end","Kết thúc thử việc","probation"],["probation_status","Trạng thái thử việc","probation"],["related_documents","Hồ sơ liên quan","probation"],
      ["official_date","Ngày chính thức","probation"],["official_contract_type","Loại hợp đồng","probation"],["contract_expiry","Hết hạn hợp đồng","probation"],["contract_file_url","File hợp đồng","probation"],
      ["end_date","Ngày nghỉ việc","status"],["handover_status","Bàn giao","status"],["handover_date","Ngày bàn giao","status"],["employment_status","Trạng thái","status"],["data_quality","Chất lượng dữ liệu","status"],["action","","status"]
    ]
  };

  const PRIVATE_EMPLOYEE_FIELDS = new Set([
    "birth_date","ethnicity","religion","nationality","citizen_id","social_insurance_no","tax_code","address_line","district","province",
    "starting_salary","current_salary","bank_account","bank_name","probation_start","probation_end","probation_status","related_documents",
    "official_contract_type","contract_expiry","contract_file_url","handover_status","handover_date"
  ]);
  const DATE_EMPLOYEE_FIELDS = new Set(["birth_date","start_date","official_date","end_date","probation_start","probation_end","contract_expiry","handover_date"]);
  const MONEY_EMPLOYEE_FIELDS = new Set(["starting_salary","current_salary"]);
  const EMPLOYEE_COLUMN_WIDTHS = {
    select: 48,
    employee_code: 112,
    full_name: 220,
    nickname: 110,
    gender: 90,
    birth_date: 120,
    department: 120,
    start_date: 120,
    area: 130,
    branch: 130,
    team: 120,
    title: 160,
    employment_level: 145,
    employment_type: 120,
    work_email: 190,
    personal_email: 190,
    phone: 130,
    ethnicity: 120,
    religion: 120,
    nationality: 120,
    citizen_id: 150,
    social_insurance_no: 150,
    tax_code: 150,
    address_line: 220,
    district: 150,
    province: 150,
    starting_salary: 145,
    current_salary: 145,
    bank_account: 160,
    bank_name: 170,
    probation_start: 125,
    probation_end: 125,
    probation_status: 140,
    related_documents: 190,
    official_date: 125,
    official_contract_type: 170,
    contract_expiry: 125,
    contract_file_url: 170,
    end_date: 125,
    handover_status: 140,
    handover_date: 125,
    employment_status: 120,
    data_quality: 120,
    action: 110
  };

  function employeeColumnStorageKey() {
    return `uws_employee_columns_v35_${state.user?.id || "guest"}`;
  }

  function accessibleEmployeeColumns() {
    const seen = new Set();
    return EMPLOYEE_COLUMNS.full.concat(EMPLOYEE_COLUMNS.operations, EMPLOYEE_COLUMNS.accounting)
      .filter(([field]) => field !== "select" && field !== "action")
      .filter(([field]) => {
        if (seen.has(field)) return false;
        seen.add(field);
        return isHR() || !PRIVATE_EMPLOYEE_FIELDS.has(field);
      });
  }

  function presetEmployeeFields(preset) {
    const source = EMPLOYEE_COLUMNS[preset] || EMPLOYEE_COLUMNS.operations;
    return source.map(([field]) => field).filter(field => field !== "select" && field !== "action" && (isHR() || !PRIVATE_EMPLOYEE_FIELDS.has(field)));
  }

  function normalizeEmployeeColumnFields(fields) {
    const allowed = new Set(accessibleEmployeeColumns().map(([field]) => field));
    const normalized = [...new Set((fields || []).filter(field => allowed.has(field)))];
    for (const required of ["employee_code", "full_name"]) {
      if (allowed.has(required) && !normalized.includes(required)) normalized.unshift(required);
    }
    return normalized;
  }

  function loadEmployeeColumnPreferences() {
    const fallback = window.innerWidth <= 820 ? "operations" : (isHR() ? "full" : "operations");
    state.employeeColumnPreset = fallback;
    state.employeeVisibleColumns = new Set(normalizeEmployeeColumnFields(presetEmployeeFields(fallback)));
    try {
      const saved = JSON.parse(localStorage.getItem(employeeColumnStorageKey()) || "null");
      if (saved && Array.isArray(saved.fields)) {
        const fields = normalizeEmployeeColumnFields(saved.fields);
        if (fields.length >= 2) {
          state.employeeVisibleColumns = new Set(fields);
          state.employeeColumnPreset = saved.preset || "custom";
        }
      }
    } catch (error) {
      console.warn("Không đọc được cấu hình cột đã lưu:", error);
    }
  }

  function saveEmployeeColumnPreferences() {
    try {
      localStorage.setItem(employeeColumnStorageKey(), JSON.stringify({
        preset: state.employeeColumnPreset || "custom",
        fields: [...state.employeeVisibleColumns],
        updated_at: new Date().toISOString()
      }));
    } catch (error) {
      console.warn("Không lưu được cấu hình cột:", error);
    }
  }

  function applyEmployeeColumnPreset(preset, options = {}) {
    const fields = normalizeEmployeeColumnFields(presetEmployeeFields(preset));
    state.employeeVisibleColumns = new Set(fields);
    state.employeeColumnPreset = preset;
    if ($("employeeColumnView")) $("employeeColumnView").value = preset;
    if (options.save !== false) saveEmployeeColumnPreferences();
    if (options.render !== false) { state.employeePage = 1; renderEmployees(); }
  }

  function applyEmployeeColumnPresetToDraft(preset) {
    state.employeeColumnDraft = new Set(normalizeEmployeeColumnFields(presetEmployeeFields(preset)));
    renderEmployeeColumnChooser();
  }

  function renderEmployeeColumnChooser() {
    const host = $("employeeColumnGroups");
    if (!host) return;
    const groups = new Map();
    accessibleEmployeeColumns().forEach(([field,label,group]) => {
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push({ field, label });
    });
    host.innerHTML = [...groups.entries()].map(([group, columns]) => `
      <section class="employee-column-group">
        <div class="employee-column-group-head"><div><b>${escapeHtml(EMPLOYEE_COLUMN_GROUPS[group] || "Khác")}</b><small>${columns.length} trường</small></div><button class="column-group-toggle" type="button" data-column-group-toggle="${escapeHtml(group)}">Chọn nhóm</button></div>
        <div class="employee-column-option-grid">${columns.map(({field,label}) => {
          const required = ["employee_code","full_name"].includes(field);
          return `<label class="employee-column-option ${required ? "is-required" : ""}"><input type="checkbox" data-employee-column-field="${escapeHtml(field)}" ${state.employeeColumnDraft.has(field) ? "checked" : ""} ${required ? "disabled" : ""}/><span><b>${escapeHtml(label)}</b><small>${required ? "Luôn hiển thị" : escapeHtml(field)}</small></span></label>`;
        }).join("")}</div>
      </section>`).join("");
    host.querySelectorAll("[data-employee-column-field]").forEach(input => input.addEventListener("change", event => {
      const field = event.target.dataset.employeeColumnField;
      if (event.target.checked) state.employeeColumnDraft.add(field); else state.employeeColumnDraft.delete(field);
      updateEmployeeColumnSelectionSummary();
    }));
    host.querySelectorAll("[data-column-group-toggle]").forEach(button => button.addEventListener("click", () => {
      const group = button.dataset.columnGroupToggle;
      const groupFields = accessibleEmployeeColumns().filter(([, , itemGroup]) => itemGroup === group).map(([field]) => field);
      const shouldSelect = groupFields.some(field => !state.employeeColumnDraft.has(field));
      groupFields.forEach(field => { if (shouldSelect) state.employeeColumnDraft.add(field); else if (!["employee_code","full_name"].includes(field)) state.employeeColumnDraft.delete(field); });
      renderEmployeeColumnChooser();
    }));
    updateEmployeeColumnSelectionSummary();
  }

  function updateEmployeeColumnSelectionSummary() {
    const count = normalizeEmployeeColumnFields([...state.employeeColumnDraft]).length;
    if ($("employeeColumnSelectionSummary")) $("employeeColumnSelectionSummary").textContent = `${count} cột được chọn`;
  }

  function updateEmployeeVisibleColumnCount() {
    const count = employeeColumnsForView().filter(([field]) => !["select","action"].includes(field)).length;
    if ($("employeeVisibleColumnCount")) $("employeeVisibleColumnCount").textContent = count;
  }

  function openEmployeeColumnModal() {
    state.employeeColumnDraft = new Set(normalizeEmployeeColumnFields([...state.employeeVisibleColumns]));
    if ($("employeeColumnPresetSelect")) $("employeeColumnPresetSelect").value = ["operations","full","accounting"].includes(state.employeeColumnPreset) ? state.employeeColumnPreset : "operations";
    renderEmployeeColumnChooser();
    showMessage($("employeeColumnMessage"), "");
    openModal("employeeColumnModal");
  }

  function closeEmployeeColumnModal() {
    closeModal("employeeColumnModal");
    showMessage($("employeeColumnMessage"), "");
  }

  function selectAllEmployeeColumns() {
    state.employeeColumnDraft = new Set(accessibleEmployeeColumns().map(([field]) => field));
    renderEmployeeColumnChooser();
  }

  function applyEmployeeColumnSelection() {
    const fields = normalizeEmployeeColumnFields([...state.employeeColumnDraft]);
    if (fields.length < 2) return showMessage($("employeeColumnMessage"), "Cần giữ ít nhất Mã nhân sự và Họ tên.", "err");
    state.employeeVisibleColumns = new Set(fields);
    state.employeeColumnPreset = "custom";
    if ($("employeeColumnView")) $("employeeColumnView").value = "custom";
    saveEmployeeColumnPreferences();
    closeEmployeeColumnModal();
    state.employeePage = 1;
    renderEmployees();
    toast(`Đã lưu ${fields.length} cột hiển thị cho tài khoản này.`);
  }

  function employeeColumnsForView() {
    const byField = new Map(accessibleEmployeeColumns().map(column => [column[0], column]));
    const fields = normalizeEmployeeColumnFields([...state.employeeVisibleColumns]);
    let columns = fields.map(field => byField.get(field)).filter(Boolean);
    if (!columns.some(([field]) => field === "action")) columns.push(["action", "", "status"]);
    if (canEditEmployeeRecords()) columns.unshift(["select", "", "select"]);
    return columns;
  }

  function employeeColumnWidth(field) {
    return EMPLOYEE_COLUMN_WIDTHS[field] || 120;
  }

  function employeeColumnRawValue(row, field) {
    if (field === "select") return "";
    if (PRIVATE_EMPLOYEE_FIELDS.has(field)) return row._private?.[field] ?? null;
    return row[field] ?? null;
  }

  function formatEmployeeCell(row, field) {
    const raw = employeeColumnRawValue(row, field);
    if (field === "select") return `<label class="employee-row-check" aria-label="Chọn ${escapeHtml(row.full_name || row.employee_code || "nhân sự")}"><input type="checkbox" data-employee-select="${row.id}" ${state.employeeSelected.has(row.id) ? "checked" : ""}/><span></span></label>`;
    if (field === "action") return `<button class="btn ghost compact-btn" data-employee-id="${row.id}">Xem</button>`;
    if (field === "employment_status") {
      const badge = row.employment_status === "active" ? "approved" : row.employment_status === "resigned" ? "rejected" : "pending";
      return `<span class="badge ${badge}">${escapeHtml(EMPLOYEE_STATUS_LABELS[row.employment_status] || row.employment_status || "Chưa rõ")}</span>`;
    }
    if (field === "data_quality") {
      const label = raw === "ok" ? "Đầy đủ" : raw === "needs_review" ? "Cần rà soát" : raw === "invalid" ? "Không hợp lệ" : "Chưa kiểm tra";
      const badge = raw === "ok" ? "approved" : raw === "invalid" ? "rejected" : "pending";
      return `<span class="badge ${badge}">${escapeHtml(label)}</span>`;
    }
    if (field === "employee_code") {
      const value = raw || "—";
      return `<b>${escapeHtml(value)}</b><small class="employee-code-group">${escapeHtml(EMPLOYEE_CODE_GROUP_LABELS[employeeCodeGroup(raw)] || "")}</small>`;
    }
    if (DATE_EMPLOYEE_FIELDS.has(field)) return escapeHtml(raw ? formatDate(raw) : "—");
    if (MONEY_EMPLOYEE_FIELDS.has(field)) return escapeHtml(raw === null || raw === undefined || raw === "" ? "—" : Number(raw).toLocaleString("vi-VN"));
    if (field === "contract_file_url" && raw) return `<a class="employee-file-link" href="${escapeHtml(raw)}" target="_blank" rel="noopener">Mở file</a>`;
    return escapeHtml(raw || "—");
  }

  function renderEmployeeTableHead(columns) {
    const head = $("employeeTableHead");
    if (!head) return;
    const table = $("employeeDataTable");
    if (table) {
      let colgroup = table.querySelector("colgroup");
      if (!colgroup) {
        colgroup = document.createElement("colgroup");
        table.insertBefore(colgroup, head);
      }
      let gridWidth = 0;
      colgroup.innerHTML = columns.map(([field]) => {
        const width = employeeColumnWidth(field);
        gridWidth += width;
        return `<col data-field="${escapeHtml(field)}" style="width:${width}px">`;
      }).join("");
      table.style.setProperty("--employee-grid-width", `${gridWidth}px`);
    }
    const groups = [];
    columns.forEach(([, , group]) => {
      const label = EMPLOYEE_COLUMN_GROUPS[group] || "";
      const previous = groups.at(-1);
      if (previous && previous.label === label) previous.count++;
      else groups.push({ label, count: 1 });
    });
    head.innerHTML = `<tr class="employee-super-head">${groups.map(group => `<th colspan="${group.count}">${escapeHtml(group.label)}</th>`).join("")}</tr><tr>${columns.map(([field,label]) => field === "select" ? `<th data-field="select"><label class="employee-row-check header-check" aria-label="Chọn trang hiện tại"><input id="employeeSelectPage" type="checkbox"/><span></span></label></th>` : `<th data-field="${field}" title="${escapeHtml(label)}">${escapeHtml(label)}</th>`).join("")}</tr>`;
  }

  async function toggleEmployeeGridFullscreen() {
    const panel = $("employeeGridPanel");
    if (!panel) return;
    try {
      if (document.fullscreenElement === panel) await document.exitFullscreen();
      else if (panel.requestFullscreen) await panel.requestFullscreen();
      else panel.classList.toggle("grid-faux-fullscreen");
    } catch {
      panel.classList.toggle("grid-faux-fullscreen");
    }
    updateEmployeeFullscreenButton();
  }

  function updateEmployeeFullscreenButton() {
    const panel = $("employeeGridPanel");
    const button = $("employeeGridFullscreenBtn");
    if (!panel || !button) return;
    const active = document.fullscreenElement === panel || panel.classList.contains("grid-faux-fullscreen");
    button.textContent = active ? "Thu nhỏ" : "Toàn màn hình";
  }

  function employeeGroupLabel(row, mode) {
    if (mode === "department") return row.department || "Chưa có phòng ban";
    if (mode === "area") return row.area || "Chưa có khu vực";
    if (mode === "branch") return row.branch || "Chưa có chi nhánh";
    if (mode === "team") return row.team || "Chưa có team";
    if (mode === "hierarchy_label") return row.hierarchy_label || "Nhân viên / CTV";
    return "";
  }

  function renderEmployees() {
    const rows = sortEmployees(filteredEmployees());
    const pageSize = state.employeePageSize || 50;
    const pages = pageSize >= Number.MAX_SAFE_INTEGER ? 1 : Math.max(1, Math.ceil(rows.length / pageSize));
    state.employeePage = Math.min(state.employeePage, pages);
    const start = pageSize >= Number.MAX_SAFE_INTEGER ? 0 : (state.employeePage - 1) * pageSize;
    const pageRows = pageSize >= Number.MAX_SAFE_INTEGER ? rows : rows.slice(start, start + pageSize);
    state.lastEmployeePageRows = pageRows;
    const groupMode = $("employeeGroupSelect")?.value || "department";
    const columns = employeeColumnsForView();
    const columnMode = state.employeeColumnPreset || "custom";
    if ($("employeeDataTable")) $("employeeDataTable").dataset.view = columnMode;
    if ($("employeeGridPanel")) $("employeeGridPanel").dataset.view = columnMode;
    renderEmployeeTableHead(columns);
    let lastGroup = null;
    const html = [];
    const groupCounts = new Map();
    rows.forEach(row => {
      const label = employeeGroupLabel(row, groupMode);
      groupCounts.set(label, (groupCounts.get(label) || 0) + 1);
    });
    pageRows.forEach(row => {
      const group = employeeGroupLabel(row, groupMode);
      if (groupMode !== "none" && group !== lastGroup) {
        html.push(`<tr class="employee-group-row"><td colspan="${columns.length}"><span>${escapeHtml(group)}</span><b>${groupCounts.get(group) || 0} nhân sự</b></td></tr>`);
        lastGroup = group;
      }
      html.push(`<tr class="${state.employeeSelected.has(row.id) ? "is-selected" : ""}" data-employee-row="${row.id}">${columns.map(([field,label]) => {
        const raw = employeeColumnRawValue(row, field);
        const title = ["select","action","employment_status","data_quality"].includes(field) ? "" : ` title="${escapeHtml(raw || "")}"`;
        return `<td data-field="${field}" data-label="${escapeHtml(label || "")}"${title}>${formatEmployeeCell(row, field)}</td>`;
      }).join("")}</tr>`);
    });
    $("employeeTable").innerHTML = html.length ? html.join("") : `<tr><td colspan="${columns.length}" class="empty-row">Không có nhân sự phù hợp.</td></tr>`;
    if ($("employeeResultCount")) $("employeeResultCount").textContent = `${rows.length.toLocaleString("vi-VN")} nhân sự`;
    const viewLabel = $("employeeColumnView")?.selectedOptions?.[0]?.textContent || "Cột tùy chọn";
    if ($("employeeGridHint")) $("employeeGridHint").textContent = `${viewLabel} • ${columns.filter(([field]) => !["select","action"].includes(field)).length} cột • bộ lọc liên hoàn Phòng ban → Khu vực → Chi nhánh → Team.`;
    updateEmployeeVisibleColumnCount();
    renderPagination(pages);
    updateEmployeeSelectionUI();
  }

  function renderPagination(pages) {
    const host = $("employeePagination"); if (!host) return;
    if (pages <= 1) { host.innerHTML = ""; return; }
    const buttons = [];
    for (let page = Math.max(1,state.employeePage-2); page <= Math.min(pages,state.employeePage+2); page++) buttons.push(`<button class="${page===state.employeePage?'active':''}" data-employee-page="${page}">${page}</button>`);
    host.innerHTML = buttons.join("");
    host.querySelectorAll("[data-employee-page]").forEach(btn => btn.addEventListener("click", () => { state.employeePage = Number(btn.dataset.employeePage); renderEmployees(); }));
  }

  function toggleEmployeeFilterPanel() {
    const panel = document.querySelector(".employee-filterbar");
    if (!panel) return;
    state.employeeFilterOpen = !panel.classList.contains("is-open");
    panel.classList.toggle("is-open", state.employeeFilterOpen);
    const button = $("employeeFilterToggleBtn");
    if (button) button.textContent = state.employeeFilterOpen ? "Ẩn bộ lọc" : "Bộ lọc";
  }

  function setEmployeeSelected(id, selected, rerender = true) {
    if (!id) return;
    if (selected) state.employeeSelected.add(id); else state.employeeSelected.delete(id);
    if (rerender) renderEmployees();
  }

  function selectAllFilteredEmployees() {
    const rows = filteredEmployees();
    rows.forEach(row => state.employeeSelected.add(row.id));
    renderEmployees();
    toast(`Đã chọn ${rows.length} nhân sự trong kết quả lọc.`);
  }

  function clearEmployeeSelection() {
    state.employeeSelected.clear();
    renderEmployees();
  }

  function updateEmployeeSelectionUI() {
    const count = state.employeeSelected.size;
    const bar = $("bulkEmployeeActionBar");
    const countEl = $("employeeSelectedCount");
    if (countEl) countEl.textContent = `Đã chọn ${count.toLocaleString("vi-VN")} nhân sự`;
    bar?.classList.toggle("hidden", !count || !canEditEmployeeRecords());
    const pageIds = state.lastEmployeePageRows.map(row => row.id);
    const selectedOnPage = pageIds.filter(id => state.employeeSelected.has(id)).length;
    const selectPage = $("employeeSelectPage");
    if (selectPage) {
      selectPage.checked = !!pageIds.length && selectedOnPage === pageIds.length;
      selectPage.indeterminate = selectedOnPage > 0 && selectedOnPage < pageIds.length;
    }
  }

  const BULK_EMPLOYEE_FIELDS = {
    department: { id: "bulkEmployeeDepartment", label: "Phòng ban" },
    area: { id: "bulkEmployeeArea", label: "Khu vực" },
    branch: { id: "bulkEmployeeBranch", label: "Chi nhánh" },
    team: { id: "bulkEmployeeTeam", label: "Team / nhóm" },
    title: { id: "bulkEmployeeTitle", label: "Chức danh" },
    employment_level: { id: "bulkEmployeeLevel", label: "Cấp bậc" },
    employment_type: { id: "bulkEmployeeType", label: "Loại công việc" },
    employment_status: { id: "bulkEmployeeStatus", label: "Trạng thái" }
  };

  function populateBulkEmployeeOptions() {
    const lists = {
      bulkDepartmentOptions: state.employees.map(row => row.department),
      bulkAreaOptions: state.employees.map(row => row.area),
      bulkBranchOptions: state.employees.map(row => row.branch),
      bulkTeamOptions: state.employees.map(row => row.team),
      bulkTitleOptions: state.employees.map(row => row.title),
      bulkLevelOptions: state.employees.map(row => row.employment_level)
    };
    Object.entries(lists).forEach(([id, values]) => {
      const host = $(id);
      if (host) host.innerHTML = uniqueCI(values).map(value => `<option value="${escapeHtml(value)}"></option>`).join("");
    });
  }

  function resetBulkEmployeeEditForm() {
    document.querySelectorAll("[data-bulk-field-toggle]").forEach(toggle => {
      toggle.checked = false;
      updateBulkEmployeeFieldState(toggle.dataset.bulkFieldToggle);
    });
    Object.values(BULK_EMPLOYEE_FIELDS).forEach(({ id }) => { if ($(id)) $(id).value = ""; });
    showMessage($("bulkEmployeeEditMessage"), "");
    updateBulkEmployeePreview();
  }

  function updateBulkEmployeeFieldState(field) {
    const toggle = document.querySelector(`[data-bulk-field-toggle="${field}"]`);
    const config = BULK_EMPLOYEE_FIELDS[field];
    if (!toggle || !config) return;
    const input = $(config.id);
    if (input) input.disabled = !toggle.checked;
    toggle.closest(".bulk-edit-field")?.classList.toggle("is-enabled", toggle.checked);
  }

  function openBulkEmployeeEditModal() {
    if (!canEditEmployeeRecords() || !state.employeeSelected.size) return;
    populateBulkEmployeeOptions();
    resetBulkEmployeeEditForm();
    const selected = state.employees.filter(row => state.employeeSelected.has(row.id));
    const summary = $("bulkEmployeeEditSummary");
    if (summary) summary.textContent = `${selected.length} nhân sự đã chọn • ${uniqueCI(selected.map(row => row.department)).slice(0,3).join(" • ") || "Nhiều phòng ban"}`;
    openModal("bulkEmployeeEditModal");
  }

  function closeBulkEmployeeEditModal() {
    closeModal("bulkEmployeeEditModal");
    showMessage($("bulkEmployeeEditMessage"), "");
  }

  function collectBulkEmployeePatch() {
    const patch = {};
    Object.entries(BULK_EMPLOYEE_FIELDS).forEach(([field, config]) => {
      const toggle = document.querySelector(`[data-bulk-field-toggle="${field}"]`);
      if (!toggle?.checked) return;
      const raw = String($(config.id)?.value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
      if (!raw) throw new Error(`${config.label} chưa có giá trị mới.`);
      if (field === "department") patch[field] = canonicalValue(raw, DISPLAY_MAPS.department);
      else if (field === "area") patch[field] = canonicalValue(raw, DISPLAY_MAPS.area);
      else if (field === "branch" || field === "team") patch[field] = raw.toLocaleUpperCase("vi");
      else if (field === "employment_type") patch[field] = canonicalValue(raw, DISPLAY_MAPS.employmentType);
      else if (field === "title" || field === "employment_level") patch[field] = titleCaseVi(raw);
      else patch[field] = raw;
    });
    return patch;
  }

  function updateBulkEmployeePreview() {
    const host = $("bulkEmployeePreview");
    if (!host) return;
    try {
      const patch = collectBulkEmployeePatch();
      const entries = Object.entries(patch);
      host.innerHTML = entries.length ? entries.map(([field,value]) => `<span><b>${escapeHtml(BULK_EMPLOYEE_FIELDS[field]?.label || field)}:</b> ${escapeHtml(EMPLOYEE_STATUS_LABELS[value] || value)}</span>`).join("") : "Chọn ít nhất một trường cần cập nhật.";
    } catch (error) {
      host.textContent = error.message;
    }
  }

  async function saveBulkEmployeeEdit() {
    if (!canEditEmployeeRecords()) return;
    const ids = [...state.employeeSelected];
    if (!ids.length) return showMessage($("bulkEmployeeEditMessage"), "Chưa chọn nhân sự.", "err");
    let patch;
    try { patch = collectBulkEmployeePatch(); } catch (error) { return showMessage($("bulkEmployeeEditMessage"), error.message, "err"); }
    if (!Object.keys(patch).length) return showMessage($("bulkEmployeeEditMessage"), "Hãy bật ít nhất một trường cần cập nhật.", "err");
    const confirmed = window.confirm(`Cập nhật ${ids.length} nhân sự với ${Object.keys(patch).length} trường đã chọn?`);
    if (!confirmed) return;
    const button = $("saveBulkEmployeeEditBtn");
    setLoading(button, true, "Đang cập nhật...");
    showMessage($("bulkEmployeeEditMessage"), `Đang cập nhật ${ids.length} hồ sơ...`);
    try {
      const updatedRows = [];
      for (let start = 0; start < ids.length; start += 150) {
        const chunk = ids.slice(start, start + 150);
        const { data, error } = await supabase.from("employees").update({ ...patch, updated_at: new Date().toISOString() }).in("id", chunk).select("*");
        if (error) throw error;
        updatedRows.push(...(data || []));
      }
      const updatedById = new Map(updatedRows.map(row => [row.id, canonicalEmployee(row)]));
      state.employees = state.employees.map(row => updatedById.get(row.id) || row);
      supabase.from("activity_logs").insert({ actor_id: state.user.id, action_type: "bulk_update", entity_type: "employees", payload: { count: ids.length, fields: Object.keys(patch), values: patch } }).then(() => {}).catch(() => {});
      closeBulkEmployeeEditModal();
      state.employeeSelected.clear();
      populateEmployeeFilters();
      renderEmployees();
      renderDashboardOperations(state.employees, state.employees.filter(row => row.employment_status === "active"));
      toast(`Đã cập nhật ${updatedRows.length || ids.length} nhân sự.`);
    } catch (error) {
      showMessage($("bulkEmployeeEditMessage"), migrationError(error), "err");
    } finally {
      setLoading(button, false);
    }
  }

  function safeFilePart(value) {
    return String(value || "tat-ca").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d")
      .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "tat-ca";
  }

  function fitExportSheet(ws, rows, maxWidth = 34) {
    const widths = [];
    rows.forEach(row => row.forEach((value, index) => {
      widths[index] = Math.max(widths[index] || 8, Math.min(maxWidth, String(value ?? "").length + 2));
    }));
    ws["!cols"] = widths.map(wch => ({ wch }));
    if (rows.length && rows[0].length) {
      ws["!autofilter"] = { ref: `A1:${window.XLSX.utils.encode_col(rows[0].length - 1)}${rows.length}` };
      ws["!freeze"] = { xSplit: 0, ySplit: 1 };
    }
  }

  function employeeExportValue(row, field) {
    const value = employeeColumnRawValue(row, field);
    if (field === "employment_status") return EMPLOYEE_STATUS_LABELS[row.employment_status] || row.employment_status || "";
    if (field === "data_quality") return value === "ok" ? "Đầy đủ" : value === "needs_review" ? "Cần rà soát" : value === "invalid" ? "Không hợp lệ" : "Chưa kiểm tra";
    if (field === "employee_code") return row.employee_code || "";
    return value ?? "";
  }

  async function exportFilteredEmployees() {
    if (!isHR()) return;
    if (!window.XLSX) return toast("Thư viện Excel chưa tải được.", "err");
    const button = $("exportFilteredEmployeesBtn");
    setLoading(button, true, "Đang tạo file...");
    try {
      const rows = sortEmployees(filteredEmployees());
      if (!rows.length) throw new Error("Không có nhân sự phù hợp để xuất.");

      const exportColumns = employeeColumnsForView().filter(([field]) => !["select","action"].includes(field));
      const employeeRows = [["STT", ...exportColumns.map(([,label]) => label)]];
      const accountingRows = [["STT","Mã nhân sự","Họ tên","Nick Name","Phòng ban","Khu vực","Chi nhánh","Team","Số điện thoại","Ngân hàng","Số tài khoản","Lương hiện tại","Trạng thái"]];
      rows.forEach((row, index) => {
        const privateData = row._private || {};
        employeeRows.push([index + 1, ...exportColumns.map(([field]) => employeeExportValue(row, field))]);
        accountingRows.push([
          index + 1, row.employee_code || "", row.full_name || "", row.nickname || "", row.department || "",
          row.area || "", row.branch || "", row.team || "", row.phone || "", privateData.bank_name || "",
          privateData.bank_account || "", privateData.current_salary ?? "", EMPLOYEE_STATUS_LABELS[row.employment_status] || row.employment_status || ""
        ]);
      });

      const filterRows = [
        ["BỘ LỌC ĐÃ ÁP DỤNG", "GIÁ TRỊ"],
        ["Trạng thái", $("employeeStatusFilter")?.selectedOptions?.[0]?.textContent || "Tất cả"],
        ["Nhóm mã", $("employeeCodeGroupFilter")?.selectedOptions?.[0]?.textContent || "Tất cả"],
        ["Phòng ban", $("employeeDepartmentFilter")?.value || "Tất cả"],
        ["Khu vực", $("employeeAreaFilter")?.value || "Tất cả"],
        ["Chi nhánh", $("employeeBranchFilter")?.value || "Tất cả"],
        ["Team", $("employeeTeamFilter")?.value || "Tất cả"],
        ["Ngân hàng", $("employeeBankFilter")?.value || "Tất cả"],
        ["Kết quả", `${rows.length} nhân sự`],
        ["Ngày xuất", new Date().toLocaleString("vi-VN")]
      ];

      const workbook = window.XLSX.utils.book_new();
      const employeeSheet = window.XLSX.utils.aoa_to_sheet(employeeRows);
      const accountingSheet = window.XLSX.utils.aoa_to_sheet(accountingRows);
      const filterSheet = window.XLSX.utils.aoa_to_sheet(filterRows);
      fitExportSheet(employeeSheet, employeeRows, 38);
      fitExportSheet(accountingSheet, accountingRows, 38);
      fitExportSheet(filterSheet, filterRows, 42);
      window.XLSX.utils.book_append_sheet(workbook, employeeSheet, "Danh sach da loc");
      window.XLSX.utils.book_append_sheet(workbook, accountingSheet, "Ke toan - ngan hang");
      window.XLSX.utils.book_append_sheet(workbook, filterSheet, "Bo loc");

      const filters = [
        $("employeeDepartmentFilter")?.value,
        $("employeeAreaFilter")?.value,
        $("employeeBranchFilter")?.value,
        $("employeeTeamFilter")?.value
      ].filter(Boolean).map(safeFilePart);
      const filename = `danh-sach-nhan-su-da-loc-${filters.join("-") || "tat-ca"}-${new Date().toISOString().slice(0,10)}.xlsx`;
      window.XLSX.writeFile(workbook, filename, { compression: true });
      toast(`Đã xuất ${rows.length} nhân sự với ${exportColumns.length} cột đang chọn.`);
    } catch (error) {
      toast(error.message || String(error), "err", 5200);
    } finally {
      setLoading(button, false);
    }
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
      employeePatch.employee_code = String(employeePatch.employee_code || employee.employee_code || "").trim().toUpperCase();
      employeePatch.full_name = titleCaseVi(employeePatch.full_name || employee.full_name);
      if ("nickname" in employeePatch) employeePatch.nickname = titleCaseVi(employeePatch.nickname) || null;
      if ("department" in employeePatch) employeePatch.department = canonicalValue(employeePatch.department, DISPLAY_MAPS.department) || null;
      if ("area" in employeePatch) employeePatch.area = canonicalValue(employeePatch.area, DISPLAY_MAPS.area) || null;
      if ("branch" in employeePatch) employeePatch.branch = String(employeePatch.branch || "").trim().toLocaleUpperCase("vi") || null;
      if ("team" in employeePatch) employeePatch.team = String(employeePatch.team || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleUpperCase("vi") || null;
      if ("employment_type" in employeePatch) employeePatch.employment_type = canonicalValue(employeePatch.employment_type, DISPLAY_MAPS.employmentType) || null;
      if ("work_email" in employeePatch) employeePatch.work_email = normalize(employeePatch.work_email) || null;
      if ("personal_email" in employeePatch) employeePatch.personal_email = normalize(employeePatch.personal_email) || null;
      if ("bank_name" in privatePatch) privatePatch.bank_name = canonicalValue(privatePatch.bank_name, DISPLAY_MAPS.bank) || null;
      const { data: updated, error } = await supabase.from("employees").update(employeePatch).eq("id", employee.id).select("*").single();
      if (error) throw error;
      if (isHR()) {
        const { error: privateError } = await supabase.from("employee_private").upsert(privatePatch, { onConflict: "employee_id" });
        if (privateError) throw privateError;
        state.activeEmployeePrivate = { ...(state.activeEmployeePrivate || {}), ...privatePatch };
        state.employeePrivateById.set(employee.id, state.activeEmployeePrivate);
      }
      const normalizedUpdated = canonicalEmployee(updated);
      const index = state.employees.findIndex(row => row.id === employee.id);
      if (index >= 0) state.employees[index] = normalizedUpdated;
      state.activeEmployee = normalizedUpdated;
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

  function setDatalistOptions(id, values) {
    const host = $(id);
    if (!host) return;
    host.innerHTML = uniqueCI(values).map(value => `<option value="${escapeHtml(value)}"></option>`).join("");
  }

  function populateAddEmployeeDatalists(changedLevel = "") {
    if (changedLevel === "department") {
      if ($("newEmployeeArea")) $("newEmployeeArea").value = "";
      if ($("newEmployeeBranch")) $("newEmployeeBranch").value = "";
      if ($("newEmployeeTeam")) $("newEmployeeTeam").value = "";
    } else if (changedLevel === "area") {
      if ($("newEmployeeBranch")) $("newEmployeeBranch").value = "";
      if ($("newEmployeeTeam")) $("newEmployeeTeam").value = "";
    } else if (changedLevel === "branch") {
      if ($("newEmployeeTeam")) $("newEmployeeTeam").value = "";
    }

    setDatalistOptions("newEmployeeDepartmentOptions", state.employees.map(row => row.department));
    const department = $("newEmployeeDepartment")?.value || "";
    const areaRows = state.employees.filter(row => !department || sameText(row.department, department));
    setDatalistOptions("newEmployeeAreaOptions", areaRows.map(row => row.area));
    const area = $("newEmployeeArea")?.value || "";
    const branchRows = areaRows.filter(row => !area || sameText(row.area, area));
    setDatalistOptions("newEmployeeBranchOptions", branchRows.map(row => row.branch));
    const branch = $("newEmployeeBranch")?.value || "";
    const teamRows = branchRows.filter(row => !branch || sameText(row.branch, branch));
    setDatalistOptions("newEmployeeTeamOptions", teamRows.map(row => row.team));
    setDatalistOptions("newEmployeeTitleOptions", state.employees.map(row => row.title));
    setDatalistOptions("newEmployeeLevelOptions", state.employees.map(row => row.employment_level));
  }

  async function createEmployee() {
    if (!canCreateEmployees()) return;
    const body = {
      employee_code: String($("newEmployeeCode")?.value || "").trim().toUpperCase(),
      full_name: titleCaseVi($("newEmployeeName")?.value),
      nickname: titleCaseVi($("newEmployeeNickname")?.value) || null,
      work_email: normalize($("newEmployeeWorkEmail")?.value) || null,
      personal_email: normalize($("newEmployeePersonalEmail")?.value) || null,
      phone: String($("newEmployeePhone")?.value || "").replace(/[^0-9+]/g, "") || null,
      department: canonicalValue($("newEmployeeDepartment")?.value, DISPLAY_MAPS.department) || null,
      area: canonicalValue($("newEmployeeArea")?.value, DISPLAY_MAPS.area) || null,
      branch: String($("newEmployeeBranch")?.value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleUpperCase("vi") || null,
      team: String($("newEmployeeTeam")?.value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleUpperCase("vi") || null,
      title: titleCaseVi($("newEmployeeTitle")?.value) || null,
      employment_level: String($("newEmployeeLevel")?.value || "").normalize("NFKC").replace(/\s+/g, " ").trim() || null,
      employment_type: canonicalValue($("newEmployeeType")?.value, DISPLAY_MAPS.employmentType) || null,
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
        supabase.from("employees").select("id,employee_code,full_name,nickname,department,title,area,branch,team,area_id,branch_id,team_id,employment_status,hierarchy_label,employment_level,employment_type")
      ]);
      if (error) throw error;
      if (employeeError) throw employeeError;
      state.orgUnits = units || [];
      state.orgEmployees = employees || [];
      renderOrganization(state.orgEmployees);
    } catch (error) { $("organizationTree").innerHTML = `<div class="empty-row">${escapeHtml(migrationError(error))}</div>`; }
  }

  function organizationDepartmentKey(value) {
    const key = normalize(value || "Chưa phân loại");
    if (["blđ","bld","ban lãnh đạo","ban lanh dao"].includes(key)) return "BAN LÃNH ĐẠO";
    if (["kinh doanh","sale","sales"].includes(key)) return "KINH DOANH";
    if (["vận hành","van hanh","operations","operation"].includes(key)) return "VẬN HÀNH";
    return canonicalValue(value, DISPLAY_MAPS.department, raw => String(raw || "Chưa phân loại").trim().toLocaleUpperCase("vi")) || "CHƯA PHÂN LOẠI";
  }

  function departmentCardIcon(name) {
    const key = normalize(name);
    if (key.includes("lãnh đạo") || key === "blđ") return '<svg viewBox="0 0 24 24"><path d="M12 3 4 8v8l8 5 8-5V8l-8-5Z"></path><path d="M8 11h8M9 15h6"></path></svg>';
    if (key.includes("kinh doanh")) return '<svg viewBox="0 0 24 24"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"></path></svg>';
    if (key.includes("vận hành")) return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.55V20h-3v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7.1 15a1.7 1.7 0 0 0-1.55-1H5.5v-3h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.12-2.12.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1-1.55V4.5h3v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.55 1h.09v3h-.09a1.7 1.7 0 0 0-1.55 1Z"></path></svg>';
    return '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"></rect><path d="M8 5V3h8v2M8 10h8M8 14h5"></path></svg>';
  }

  function virtualDepartmentId(name) {
    return `department:${encodeURIComponent(name)}`;
  }

  function renderOrganization(employees) {
    const host = $("organizationTree");
    const activeEmployees = employees.filter(row => row.employment_status === "active");
    if ($("organizationActiveCount")) $("organizationActiveCount").textContent = `${activeEmployees.length.toLocaleString("vi-VN")} nhân sự đang làm`;

    const departmentMap = new Map();
    activeEmployees.forEach(row => {
      const name = organizationDepartmentKey(row.department);
      if (!departmentMap.has(name)) departmentMap.set(name, []);
      departmentMap.get(name).push(row);
    });
    const priority = ["BAN LÃNH ĐẠO","BLĐ","VẬN HÀNH","ADMIN","HR","KẾ TOÁN","MARKETING","TRỢ LÝ","BẢO VỆ","CENTRAL REAL","KINH DOANH"];
    const departments = [...departmentMap.entries()].sort((a,b) => {
      const ai = priority.indexOf(a[0]), bi = priority.indexOf(b[0]);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      return a[0].localeCompare(b[0], "vi");
    });

    const countBy = key => activeEmployees.filter(row => row[key]).reduce((map,row) => map.set(row[key],(map.get(row[key])||0)+1),new Map());
    const areaCount=countBy("area_id"), branchCount=countBy("branch_id"), teamCount=countBy("team_id");
    const areas = state.orgUnits.filter(u => u.unit_type === "area" && (areaCount.get(u.id) || 0) > 0);
    const branches = state.orgUnits.filter(u => u.unit_type === "branch" && (branchCount.get(u.id) || 0) > 0);
    const teams = state.orgUnits.filter(u => u.unit_type === "team" && (teamCount.get(u.id) || 0) > 0);

    const departmentCards = departments.map(([name,members], index) => {
      const business = name === "KINH DOANH";
      const supporting = members.filter(row => /trưởng|phó|giám đốc|quản lý|leader/i.test(`${row.title || ""} ${row.hierarchy_label || ""}`)).length;
      const toneClass = business ? "is-business" : `org-tone-${(index % 6) + 1}`;
      return `<button class="organization-department-card ${toneClass}" data-org-unit-id="${escapeHtml(virtualDepartmentId(name))}" type="button">
        <span class="organization-department-icon">${departmentCardIcon(name)}</span>
        <span class="organization-department-copy"><b>${escapeHtml(name)}</b><small>${business ? "Khối kinh doanh theo cụm / chi nhánh / team" : "Phòng ban nội bộ / vận hành"}</small></span>
        <strong>${members.length.toLocaleString("vi-VN")}</strong>
        <em>${supporting ? `${supporting} quản lý` : "Xem nhân sự"}</em>
      </button>`;
    }).join("");

    const businessTree = areas.length ? areas.map(area => {
      const color = clusterColor(area.name);
      const areaBranches = branches.filter(branch => branch.parent_id === area.id);
      const directTeams = teams.filter(team => team.parent_id === area.id);
      return `<section class="org-area interactive" style="--cluster-color:${color}">
        <button class="org-area-head" data-org-unit-id="${area.id}" type="button" title="Xem toàn bộ nhân sự khu vực ${escapeHtml(area.name)}">
          <span><i class="cluster-dot"></i><b>${escapeHtml(area.name)}</b><small>Khu vực / Cụm</small></span>
          <strong>${areaCount.get(area.id)||0}<small>nhân sự đang làm</small></strong>
        </button>
        <div class="org-branches">
          ${areaBranches.map(branch => {
            const branchTeams = teams.filter(team => team.parent_id === branch.id);
            return `<article class="org-branch interactive" style="--cluster-color:${color}">
              <button class="org-branch-head" data-org-unit-id="${branch.id}" type="button"><span><b>${escapeHtml(branch.name)}</b><small>Chi nhánh</small></span><span class="portal-chip">${branchCount.get(branch.id)||0} người</span></button>
              <div class="org-team-list">${branchTeams.map(team=>`<button class="org-team interactive" data-org-unit-id="${team.id}" type="button"><span>${escapeHtml(team.name)}</span><b>${teamCount.get(team.id)||0}</b></button>`).join("") || '<div class="empty-row compact-empty">Chưa có Team.</div>'}</div>
            </article>`;
          }).join("") || '<div class="empty-row">Chưa có chi nhánh.</div>'}
          ${directTeams.length ? `<article class="org-branch interactive" style="--cluster-color:${color}"><div class="org-branch-head static"><span><b>Team trực thuộc</b><small>Khu vực</small></span></div><div class="org-team-list">${directTeams.map(team=>`<button class="org-team interactive" data-org-unit-id="${team.id}" type="button"><span>${escapeHtml(team.name)}</span><b>${teamCount.get(team.id)||0}</b></button>`).join("")}</div></article>` : ""}
        </div>
      </section>`;
    }).join("") : '<div class="empty-row">Chưa có dữ liệu Khu vực → Chi nhánh → Team.</div>';

    host.innerHTML = `
      <section class="organization-company-card">
        <div class="organization-company-head"><div><p class="eyebrow">Tầng công ty</p><h3>Ban lãnh đạo &amp; các phòng ban</h3><p>Chỉ hiển thị phòng ban có nhân sự đang làm.</p></div><span>${activeEmployees.length.toLocaleString("vi-VN")} nhân sự</span></div>
        <div class="organization-department-grid">${departmentCards || '<div class="empty-row">Chưa có dữ liệu phòng ban.</div>'}</div>
      </section>
      <section class="organization-business-tree ${state.organizationExpanded ? "" : "is-collapsed"}">
        <div class="organization-layer-head"><div><p class="eyebrow">Khối kinh doanh</p><h3>Khu vực → Chi nhánh → Team</h3><p>Chỉ hiện đơn vị có nhân sự đang làm và đúng quan hệ cấp cha – cấp con.</p></div><button class="btn ghost compact-btn" id="toggleBusinessTreeBtn" type="button">${state.organizationExpanded ? "Thu gọn" : "Mở rộng"}</button></div>
        <div class="organization-business-tree-body">${businessTree}</div>
      </section>`;
    $("toggleBusinessTreeBtn")?.addEventListener("click", () => { state.organizationExpanded = !state.organizationExpanded; renderOrganization(state.orgEmployees); });
  }

  function openOrgDetail(unitId) {
    let unit = state.orgUnits.find(item => item.id === unitId);
    let members = [];
    let unitType = "";
    let unitName = "";
    if (String(unitId).startsWith("department:")) {
      unitName = decodeURIComponent(String(unitId).slice("department:".length));
      unitType = "department";
      members = state.orgEmployees.filter(row => organizationDepartmentKey(row.department) === unitName);
      unit = { id: unitId, name: unitName, unit_type: unitType };
    } else {
      if (!unit) return;
      unitName = unit.name;
      unitType = unit.unit_type;
      members = state.orgEmployees.filter(row => {
        if (unit.unit_type === "area") return row.area_id === unit.id;
        if (unit.unit_type === "branch") return row.branch_id === unit.id;
        if (unit.unit_type === "team") return row.team_id === unit.id;
        return false;
      });
    }
    members = members.sort((a,b) => Number(a.employment_status !== "active") - Number(b.employment_status !== "active") || String(a.full_name).localeCompare(String(b.full_name), "vi"));
    const active = members.filter(row => row.employment_status === "active").length;
    const leaders = members.filter(row => /leader|quản lý|quan ly|trưởng|phó|giám đốc/i.test(`${row.title || ""} ${row.hierarchy_label || ""}`)).length;
    $("orgDetailType").textContent = unitType === "department" ? "Phòng ban / Khối" : unitType === "area" ? "Khu vực / Cụm" : unitType === "branch" ? "Chi nhánh" : "Team";
    $("orgDetailTitle").textContent = unitName;
    $("orgDetailSummary").innerHTML = `<div><span>Tổng thành viên</span><b>${members.length}</b></div><div><span>Đang làm</span><b>${active}</b></div><div><span>Quản lý / Leader</span><b>${leaders}</b></div>`;
    $("orgMemberTable").innerHTML = members.length ? members.map(row => `<tr><td><b>${escapeHtml(row.employee_code || "—")}</b></td><td>${escapeHtml(row.full_name)}</td><td>${escapeHtml(row.title || row.hierarchy_label || "—")}</td><td>${escapeHtml(row.branch || row.department || "—")}</td><td>${escapeHtml(row.team || row.area || "—")}</td><td><span class="badge ${row.employment_status === "active" ? "approved" : "rejected"}">${escapeHtml(EMPLOYEE_STATUS_LABELS[row.employment_status] || row.employment_status)}</span></td><td><button class="btn ghost compact-btn" data-employee-id="${row.id}">Xem</button></td></tr>`).join("") : '<tr><td colspan="7" class="empty-row">Chưa có thành viên.</td></tr>';
    openModal("orgDetailModal");
  }

  const IMPORT_COMPARE_FIELDS = [
    "employee_code","full_name","nickname","work_email","personal_email","phone","department","area","branch","team","title",
    "employment_level","employment_type","gender","start_date","official_date","end_date","employment_status","photo_url"
  ];
  const IMPORT_PRIVATE_COMPARE_FIELDS = [
    "birth_date","ethnicity","religion","nationality","citizen_id","social_insurance_no","tax_code","address_line",
    "district","province","starting_salary","current_salary","bank_account","bank_name","probation_start","probation_end",
    "probation_status","related_documents","official_contract_type","contract_expiry","contract_file_url","handover_status","handover_date"
  ];
  function isBlockingImportWarning(warning) {
    return /^(Mã nhân sự|Email công việc|Email cá nhân|Số điện thoại) bị trùng trong file$/i.test(String(warning || "").trim());
  }

  function rowHasBlockingImportWarning(row) {
    return (row?.warnings || []).some(isBlockingImportWarning);
  }

  const IMPORT_FIELD_LABELS = {
    employee_code:"Mã nhân sự",full_name:"Họ tên",nickname:"Nick Name",work_email:"Email công việc",personal_email:"Email cá nhân",
    phone:"Số điện thoại",department:"Phòng ban",area:"Khu vực",branch:"Chi nhánh",team:"Team",title:"Chức danh",
    employment_level:"Cấp bậc",employment_type:"Loại công việc",gender:"Giới tính",start_date:"Ngày bắt đầu",
    official_date:"Ngày chính thức",end_date:"Ngày nghỉ",employment_status:"Trạng thái",photo_url:"Ảnh nhân sự",
    birth_date:"Ngày sinh",ethnicity:"Dân tộc",religion:"Tôn giáo",nationality:"Quốc tịch",citizen_id:"CCCD",
    social_insurance_no:"BHXH",tax_code:"Mã số thuế",address_line:"Địa chỉ",district:"Quận/Huyện",province:"Tỉnh/TP",
    starting_salary:"Lương khởi điểm",current_salary:"Lương hiện tại",bank_account:"Số tài khoản",bank_name:"Ngân hàng",
    probation_start:"Ngày thử việc",probation_end:"Kết thúc thử việc",probation_status:"Trạng thái thử việc",
    related_documents:"Hồ sơ liên quan",official_contract_type:"Loại hợp đồng",contract_expiry:"Hết hạn hợp đồng",
    contract_file_url:"File hợp đồng",handover_status:"Tình trạng bàn giao",handover_date:"Ngày bàn giao"
  };

  function comparable(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "number") return String(value);
    return normalize(value);
  }

  function uniqueIndex(rows, valuesForRow) {
    const groups = new Map();
    rows.forEach(row => {
      valuesForRow(row).filter(Boolean).forEach(value => {
        const normalized = comparable(value);
        if (!normalized) return;
        if (!groups.has(normalized)) groups.set(normalized, []);
        groups.get(normalized).push(row);
      });
    });
    const result = new Map();
    groups.forEach((items, value) => { if (items.length === 1) result.set(value, items[0]); });
    return result;
  }

  function buildImportDiff(rows, existingRows) {
    const byCode = uniqueIndex(existingRows, row => [row.employee_code]);
    const byEmail = uniqueIndex(existingRows, row => [row.work_email,row.personal_email]);
    const byPhone = uniqueIndex(existingRows, row => [row.phone]);
    const byNameBirth = uniqueIndex(existingRows, row => {
      const birth = row._private?.birth_date;
      return birth && row.full_name ? [`${comparable(row.full_name)}|${birth}`] : [];
    });
    const bySourceRow = uniqueIndex(existingRows, row => row.source_row && row.full_name ? [`${row.source_row}|${comparable(row.full_name)}`] : []);
    const preserveExisting = $("importPreserveExistingData")?.checked !== false;

    return rows.map((row,index) => {
      const existing = (row.employee_code && byCode.get(comparable(row.employee_code))) ||
        (row.work_email && byEmail.get(comparable(row.work_email))) ||
        (row.personal_email && byEmail.get(comparable(row.personal_email))) ||
        (row.phone && byPhone.get(comparable(row.phone))) ||
        (row.private_data?.birth_date && byNameBirth.get(`${comparable(row.full_name)}|${row.private_data.birth_date}`)) ||
        bySourceRow.get(`${row.row_number}|${comparable(row.full_name)}`) || null;

      const changedFields = [];
      if (existing) {
        IMPORT_COMPARE_FIELDS.forEach(field => {
          const incoming = row[field];
          if (preserveExisting && (incoming === null || incoming === undefined || incoming === "")) return;
          if (comparable(incoming) !== comparable(existing[field])) changedFields.push(IMPORT_FIELD_LABELS[field] || field);
        });
        IMPORT_PRIVATE_COMPARE_FIELDS.forEach(field => {
          const incoming = row.private_data?.[field];
          if (preserveExisting && (incoming === null || incoming === undefined || incoming === "")) return;
          if (comparable(incoming) !== comparable(existing._private?.[field])) changedFields.push(IMPORT_FIELD_LABELS[field] || field);
        });
      }

      const blocked = rowHasBlockingImportWarning(row);
      const status = row.warnings.length ? "review" : !existing ? "new" : changedFields.length ? "changed" : "unchanged";
      return { index, row, existing, status, changedFields, blocked };
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
      }

      if (!state.employeePrivateById.size) {
        const privateResponse = await supabase.from("employee_private").select("*");
        if (privateResponse.error) throw privateResponse.error;
        state.employeePrivateById = new Map((privateResponse.data || []).map(row => [row.employee_id, row]));
      }
      existing = existing.map(row => canonicalEmployee({ ...row, _private: state.employeePrivateById.get(row.id) || row._private || {} }));
      state.employees = existing;

      state.importDiff = buildImportDiff(state.importResult.rows, existing);
      state.importSelected = new Set(state.importDiff.filter(item => !item.blocked && ["new","changed","review"].includes(item.status)).map(item => item.index));
      renderImportSummary();
      renderImportDiff();
      updateImportCommitState();
      const summary = state.importResult.summary;
      showMessage($("importMessage"), `Đã nhận diện tiêu đề ở dòng ${summary.header_row}, dữ liệu bắt đầu từ dòng ${summary.data_start_row}.`, "ok");
      toast(`Đã so sánh ${summary.total} dòng với dữ liệu Supabase.`);
    } catch (error) { showMessage($("importMessage"), error.message, "err"); }
    finally { setLoading(button, false); }
  }

  function renderImportSummary() {
    const summary = state.importResult?.summary; if (!summary) return;
    const newCount = state.importDiff.filter(item => item.status === "new").length;
    const changedCount = state.importDiff.filter(item => item.status === "changed").length;
    const unchangedCount = state.importDiff.filter(item => item.status === "unchanged").length;
    const reviewCount = state.importDiff.filter(item => item.status === "review").length;
    const blockedCount = state.importDiff.filter(item => item.blocked).length;
    const cards = [
      ["Tổng dòng",summary.total],["Nhân sự mới",newCount],["Có thay đổi",changedCount],["Không thay đổi",unchangedCount],
      ["Cần rà soát",reviewCount],["Bị khóa do trùng",blockedCount],["Đang làm",summary.active],["Đã nghỉ",summary.resigned],
      ["Định danh mạnh",summary.strong_identity_rows || 0],["Định danh yếu",summary.weak_identity_rows || 0],
      ["Xung đột tuyến",summary.hierarchy_conflict_rows || 0],["Khu vực / Chi nhánh",`${summary.areas} / ${summary.branches}`]
    ];
    $("importSummary").innerHTML = cards.map(([label,value]) => `<div class="import-summary-card"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`).join("");
    const coverage = $("importCoverage");
    if (coverage) {
      const safeRows = state.importDiff.filter(item => !item.blocked && item.status !== "unchanged").length;
      const matchedRows = state.importDiff.filter(item => item.existing).length;
      const missingRows = state.importDiff.filter(item => !item.existing && !item.blocked).length;
      coverage.classList.remove("hidden");
      coverage.innerHTML = `<b>Đối chiếu đủ ${summary.total} dòng file</b><span>${matchedRows} đã khớp Supabase • ${missingRows} cần tạo mới • ${safeRows} có thể đồng bộ • ${blockedCount} dòng bị khóa để tránh lộn hồ sơ.</span>`;
    }
  }

  function visibleImportDiff() {
    const mode = $("importDiffFilter")?.value || "all";
    return state.importDiff.filter(item => mode === "all" || item.status === mode);
  }

  function renderImportDiff() {
    const rows = visibleImportDiff();
    const labels = { new: "Nhân sự mới", changed: "Có thay đổi", unchanged: "Không thay đổi", review: "Cần rà soát" };
    $("importDiffTable").innerHTML = rows.length ? rows.slice(0,500).map(item => `<tr class="import-diff-row ${item.status} ${item.blocked ? "blocked" : ""}">
      <td><input type="checkbox" data-import-index="${item.index}" ${state.importSelected.has(item.index) && !item.blocked ? "checked" : ""} ${(item.status === "unchanged" || item.blocked) ? "disabled" : ""} /></td>
      <td>${item.row.row_number}</td><td>${escapeHtml(item.row.employee_code || "—")}</td><td>${escapeHtml(item.row.full_name)}</td>
      <td><span class="diff-status ${item.status}">${item.blocked ? "Bị khóa" : labels[item.status]}</span></td>
      <td>${escapeHtml(item.changedFields.length ? item.changedFields.join(", ") : item.status === "new" ? "Tạo mới" : "—")}</td>
      <td>${escapeHtml(item.row.warnings.join("; ") || "—")}</td></tr>`).join("") : '<tr><td colspan="7" class="empty-row">Không có dòng phù hợp.</td></tr>';
    updateImportCommitState();
  }

  function updateImportCommitState() {
    const button = $("commitImportBtn");
    if (!button) return;
    const count = [...state.importSelected].filter(index => {
      const item = state.importDiff[index];
      return item && !item.blocked && ["new","changed","review"].includes(item.status);
    }).length;
    button.disabled = count === 0;
    button.textContent = count ? `Đồng bộ an toàn ${count} dòng` : "Không có dòng cần đồng bộ";
  }

  function selectChangedImportRows() {
    state.importSelected = new Set(state.importDiff.filter(item => !item.blocked && ["new","changed","review"].includes(item.status)).map(item => item.index));
    renderImportDiff();
  }

  function toggleAllVisibleImportRows(event) {
    visibleImportDiff().forEach(item => {
      if (item.status === "unchanged" || item.blocked) return;
      if (event.target.checked) state.importSelected.add(item.index); else state.importSelected.delete(item.index);
    });
    renderImportDiff();
  }

  async function commitImport() {
    if (!isHR() || !state.importResult?.rows?.length) return;
    const selected = [...state.importSelected].sort((a,b)=>a-b).map(index => state.importDiff[index]).filter(item => item && !item.blocked).map(item => ({ ...item.row, existing_employee_id: item.existing?.id || null }));
    if (!selected.length) return;
    const button = $("commitImportBtn"); setLoading(button, true, "Đang đồng bộ 0%...");
    const preserveExisting = $("importPreserveExistingData")?.checked !== false;
    showMessage($("importMessage"), `Chỉ đồng bộ ${selected.length} dòng đã chọn. ${preserveExisting ? "Ô trống sẽ không ghi đè dữ liệu cũ." : "Ô trống có thể xóa dữ liệu cũ."}`);
    try {
      const chunkSize = 50;
      let batchId = null;
      let imported = 0;
      let processedCount = 0;
      const failures = [];
      for (let offset=0; offset<selected.length; offset+=chunkSize) {
        const chunk = selected.slice(offset, offset+chunkSize);
        const { data, error } = await supabase.functions.invoke("hr-import-employees", { body: {
          batch_id: batchId,
          file_name: $("hrImportFile").files?.[0]?.name || "employees.xlsx",
          source_sheet: state.importResult.sheetName || "Danh sách nhân viên",
          preserve_existing: preserveExisting,
          records: chunk,
          finalize: offset + chunkSize >= selected.length,
          total_rows: selected.length
        }});
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.message || "Import thất bại.");
        batchId = data.batch_id;
        imported += data.imported || 0;
        processedCount += data.processed || chunk.length;
        (data.failures || []).forEach(item => failures.push(item));
        button.textContent = `Đang đồng bộ ${Math.min(100,Math.round(processedCount/selected.length*100))}%...`;
      }
      if (failures.length) {
        const preview = failures.slice(0, 5).map(item => `Dòng ${item.row_number}: ${item.message}`).join(" • ");
        showMessage($("importMessage"), `Đã đồng bộ ${imported}/${selected.length} dòng. Còn ${failures.length} dòng lỗi: ${preview}`, "warn");
        toast(`Đã cập nhật ${imported} dòng, còn ${failures.length} dòng cần xử lý.`, "warn", 6000);
      } else {
        showMessage($("importMessage"), `Đã đối chiếu và đồng bộ đủ ${imported}/${selected.length} dòng an toàn.`, "ok");
        toast("Đã cập nhật dữ liệu nhân sự thành công.");
      }
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
