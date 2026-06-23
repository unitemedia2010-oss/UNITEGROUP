(function () {
  "use strict";

  const SUPABASE_URL = "https://yoxpuohxstudwmtglito.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_7gKBRfFhlY-wvDuHQ3fGYA_S0XL1uOR";

  if (!window.supabase?.createClient) {
    throw new Error("Không tải được Supabase SDK. Kiểm tra kết nối mạng hoặc CDN.");
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: "uws_auth_session"
    }
  });

  const ADMIN_ROLES = ["LEADER", "BRANCH_MANAGER", "AREA_MANAGER", "HR", "ADMIN", "SUPER_ADMIN"];
  const HR_ROLES = ["HR", "ADMIN", "SUPER_ADMIN"];
  const ROLE_LABELS = {
    SALE: "Sale", EMPLOYEE: "Nhân viên", TTS: "Thực tập sinh", NVPT: "Nhân viên phát triển",
    LEADER: "Leader", BRANCH_MANAGER: "Quản lý chi nhánh", AREA_MANAGER: "Quản lý khu vực",
    HR: "HR", ADMIN: "Admin", SUPER_ADMIN: "Super Admin"
  };
  const SHIFT_LABELS = { morning: "Sáng", afternoon: "Chiều", full_day: "Cả ngày" };
  const STATUS_LABELS = {
    pending: "Chờ duyệt",
    approved: "Đã duyệt",
    rejected: "Từ chối",
    cancelled: "Đã hủy"
  };
  const REASON_LABELS = {
    sick: "Ốm",
    personal: "Việc cá nhân",
    school: "Lịch học",
    family: "Việc gia đình",
    exam: "Thi / kiểm tra",
    other: "Khác"
  };

  function formatDate(dateString) {
    if (!dateString) return "";
    return new Date(`${String(dateString).slice(0, 10)}T00:00:00`).toLocaleDateString("vi-VN");
  }

  function toISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function getMonday(inputDate = new Date()) {
    const d = new Date(inputDate);
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  async function getCurrentUserAndProfile() {
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData?.user) {
      return { user: null, profile: null, error: userError };
    }

    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("*")
      .eq("id", userData.user.id)
      .single();

    if (profileError || !profile) {
      return { user: userData.user, profile: null, error: profileError };
    }

    if (profile.status !== "active") {
      await client.auth.signOut();
      return {
        user: null,
        profile: null,
        error: { message: "Tài khoản đã bị khóa. Vui lòng liên hệ Admin/HR." }
      };
    }

    return { user: userData.user, profile, error: null };
  }

  function showMessage(el, text, type = "") {
    if (!el) return;
    el.textContent = text || "";
    el.className = `message ${type}`.trim();
  }

  window.UWS = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    supabase: client,
    ADMIN_ROLES,
    HR_ROLES,
    ROLE_LABELS,
    SHIFT_LABELS,
    STATUS_LABELS,
    REASON_LABELS,
    formatDate,
    toISODate,
    getMonday,
    addDays,
    getCurrentUserAndProfile,
    showMessage
  };
})();
