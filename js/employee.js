"use strict";

/* UWS_PAGE_SCOPE */
(() => {

const {
  supabase,
  SHIFT_LABELS,
  STATUS_LABELS,
  REASON_LABELS,
  formatDate,
  toISODate,
  addDays,
  getMonday,
  getCurrentUserAndProfile,
  showMessage
} = window.UWS;

let currentUser = null;
let currentProfile = null;

let selectedMonth = new Date();
selectedMonth.setDate(1);
selectedMonth.setHours(0, 0, 0, 0);

let monthSchedules = [];
let monthLeaves = [];
let monthUnavailable = [];
let monthCounts = [];

let activeRegisterDate = null;
let remoteNotifications = [];
let weekDraft = {};
let activeDraftWeekStart = getDefaultDraftWeekStart(new Date());

const DEFAULT_MAX_STAFF = 8;
const TIME_META_REGEX = /\[\[UWS_TIME:(\d{2}:\d{2})-(\d{2}:\d{2})\]\]\s*/;
const OFF_SUBMITTED_MARKER = "[[UWS_OFF_SUBMITTED]]";

const welcomeName = document.getElementById("welcomeName");
const profileLine = document.getElementById("profileLine");
const profileModal = document.getElementById("profileModal");
const profileFullNameInput = document.getElementById("profileFullNameInput");
const profilePhoneInput = document.getElementById("profilePhoneInput");
const profileMessage = document.getElementById("profileMessage");

const approvedDaysEl = document.getElementById("approvedDays");
const pendingDaysEl = document.getElementById("pendingDays");
const leaveDaysEl = document.getElementById("leaveDays");
const targetDaysEl = document.getElementById("targetDays");
const progressText = document.getElementById("progressText");
const progressFill = document.getElementById("progressFill");

const monthTitle = document.getElementById("monthTitle");
const monthCalendar = document.getElementById("monthCalendar");
const calendarMessage = document.getElementById("calendarMessage");

const registerModal = document.getElementById("registerModal");
const registerModalTitle = document.getElementById("registerModalTitle");
const registerModalMeta = document.getElementById("registerModalMeta");
const registerNote = document.getElementById("registerNote");
const registerMessage = document.getElementById("registerMessage");
const registerBusyToggle = document.getElementById("registerBusyToggle");
const registerBusyFields = document.getElementById("registerBusyFields");
const registerBusyShift = document.getElementById("registerBusyShift");
const registerBusyReason = document.getElementById("registerBusyReason");
const registerBusyNote = document.getElementById("registerBusyNote");
const registerBusyState = document.getElementById("registerBusyState");
const registerBusyMessage = document.getElementById("registerBusyMessage");
const saveRegisterBusyBtn = document.getElementById("saveRegisterBusyBtn");
const deleteRegisterBusyBtn = document.getElementById("deleteRegisterBusyBtn");
const deleteDraftDayBtn = document.getElementById("deleteDraftDayBtn");
const draftReviewCount = document.getElementById("draftReviewCount");
const draftReviewList = document.getElementById("draftReviewList");
const draftReviewMessage = document.getElementById("draftReviewMessage");

const leaveModal = document.getElementById("leaveModal");
const leaveModalTitle = document.getElementById("leaveModalTitle");
const leaveScheduleSelect = document.getElementById("leaveScheduleSelect");
const leaveType = document.getElementById("leaveType");
const leavePeriod = document.getElementById("leavePeriod");
const leaveCustomTimeFields = document.getElementById("leaveCustomTimeFields");
const leaveStartTime = document.getElementById("leaveStartTime");
const leaveEndTime = document.getElementById("leaveEndTime");
const leavePeriodHint = document.getElementById("leavePeriodHint");
const leaveNote = document.getElementById("leaveNote");
const leaveMessage = document.getElementById("leaveMessage");

const notificationModal = document.getElementById("notificationModal");
const notificationList = document.getElementById("notificationList");
const notificationBadge = document.getElementById("notificationBadge");

const changePasswordModal = document.getElementById("changePasswordModal");
const currentPasswordInput = document.getElementById("currentPasswordInput");
const newPasswordInput = document.getElementById("newPasswordInput");
const confirmNewPasswordInput = document.getElementById("confirmNewPasswordInput");
const changePasswordMessage = document.getElementById("changePasswordMessage");

const myScheduleTable = document.getElementById("myScheduleTable");

function employeeCodeGroup(code) {
  const value = String(code || "").trim().toUpperCase();
  if (!value) return "Chưa có mã";
  if (/^TVU/.test(value)) return "Thử việc (TVU)";
  if (/^U/.test(value)) return "Chính thức (U)";
  return "Mã khác";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message, type = "ok", duration = 3000) {
  const host = document.getElementById("toastHost");
  if (!host) return;

  const item = document.createElement("div");
  item.className = `toast-item ${type}`;
  item.textContent = message;
  host.appendChild(item);

  setTimeout(() => {
    item.style.opacity = "0";
    item.style.transform = "translateY(-8px)";
    item.style.transition = "all .18s ease";
    setTimeout(() => item.remove(), 220);
  }, duration);
}

function notificationStorageKey() {
  return `uws_notifications_${currentUser?.id || "guest"}`;
}

function readNotifications() {
  try {
    return JSON.parse(localStorage.getItem(notificationStorageKey()) || "[]");
  } catch {
    return [];
  }
}

function writeNotifications(list) {
  localStorage.setItem(notificationStorageKey(), JSON.stringify(list));
}

function addNotification(payload) {
  const items = readNotifications();
  if (payload.refKey && items.some(item => item.refKey === payload.refKey)) return;

  items.unshift({
    id: payload.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    refKey: payload.refKey || null,
    title: payload.title || "Thông báo",
    message: payload.message || "",
    type: payload.type || "ok",
    createdAt: payload.createdAt || new Date().toISOString(),
    isRead: false
  });

  writeNotifications(items.slice(0, 80));
  renderNotifications();
  updateNotificationBadge();
}

async function markNotificationsAsRead() {
  const items = readNotifications().map(item => ({ ...item, isRead: true }));
  writeNotifications(items);

  const unreadRemoteIds = remoteNotifications
    .filter(item => !item.read_at)
    .map(item => item.id);

  if (unreadRemoteIds.length) {
    const readAt = new Date().toISOString();
    await supabase
      .from("notifications")
      .update({ read_at: readAt })
      .in("id", unreadRemoteIds);

    remoteNotifications = remoteNotifications.map(item => (
      unreadRemoteIds.includes(item.id) ? { ...item, read_at: readAt } : item
    ));
  }

  renderNotifications();
  updateNotificationBadge();
}

function clearNotifications() {
  writeNotifications([]);
  renderNotifications();
  updateNotificationBadge();
}

function getCombinedNotifications() {
  const localItems = readNotifications().map(item => ({
    id: `local:${item.id}`,
    title: item.title,
    message: item.message,
    type: item.type || "ok",
    createdAt: item.createdAt,
    isRead: !!item.isRead
  }));

  const remoteItems = remoteNotifications.map(item => ({
    id: `remote:${item.id}`,
    title: item.title,
    message: item.message,
    type: item.type || "info",
    createdAt: item.created_at,
    isRead: !!item.read_at
  }));

  return [...remoteItems, ...localItems]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 100);
}

function updateNotificationBadge() {
  const localUnread = readNotifications().filter(item => !item.isRead).length;
  const remoteUnread = remoteNotifications.filter(item => !item.read_at).length;
  const unread = localUnread + remoteUnread;
  if (!notificationBadge) return;
  notificationBadge.textContent = unread;
  notificationBadge.classList.toggle("hidden", unread === 0);
}

async function loadRemoteNotifications() {
  if (!currentUser?.id) return;

  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("recipient_id", currentUser.id)
    .order("created_at", { ascending: false })
    .limit(80);

  if (error) {
    remoteNotifications = [];
    return;
  }

  remoteNotifications = data || [];
}

function formatDateTime(isoString) {
  if (!isoString) return "";
  return new Date(isoString).toLocaleString("vi-VN");
}

function renderNotifications() {
  if (!notificationList) return;
  const items = getCombinedNotifications();

  if (!items.length) {
    notificationList.innerHTML = `<div class="empty-row">Chưa có thông báo nào.</div>`;
    return;
  }

  notificationList.innerHTML = items.map(item => `
    <article class="notification-item ${item.isRead ? "" : "unread"}">
      <div class="notification-dot ${item.type}"></div>
      <div class="notification-content">
        <div class="notification-topline">
          <h3>${escapeHtml(item.title)}</h3>
          <time>${formatDateTime(item.createdAt)}</time>
        </div>
        <p>${escapeHtml(item.message || "")}</p>
      </div>
    </article>
  `).join("");
}

async function openNotificationModal() {
  await loadRemoteNotifications();
  renderNotifications();
  notificationModal?.classList.remove("hidden");
  await markNotificationsAsRead();
}

function getMonthStart() {
  return new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1);
}

function getMonthEnd() {
  return new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 0);
}

function getGridDates() {
  const start = getMonthStart();
  const end = getMonthEnd();

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

function getMonthLabel() {
  return `Tháng ${selectedMonth.getMonth() + 1}/${selectedMonth.getFullYear()}`;
}

function normalizeDate(dateString) {
  return dateString ? String(dateString).slice(0, 10) : "";
}

function sameMonth(date) {
  return date.getMonth() === selectedMonth.getMonth() &&
         date.getFullYear() === selectedMonth.getFullYear();
}

function isToday(date) {
  const now = new Date();
  return date.getDate() === now.getDate() &&
         date.getMonth() === now.getMonth() &&
         date.getFullYear() === now.getFullYear();
}

const DRAFT_SHIFT_LABELS = {
  full_day: "Cả ngày",
  morning: "Buổi sáng",
  afternoon: "Buổi chiều",
  off: "OFF"
};

function getDefaultDraftWeekStart(reference = new Date()) {
  const date = new Date(reference);
  const monday = getMonday(date);
  return date.getDay() === 6 || date.getDay() === 0 ? addDays(monday, 7) : monday;
}

function parseLocalDate(dateIso) {
  return new Date(`${String(dateIso).slice(0, 10)}T00:00:00`);
}

function isSundayDate(value) {
  const date = value instanceof Date ? value : parseLocalDate(value);
  return date.getDay() === 0;
}

function weekStartIsoForDate(dateIso) {
  return toISODate(getMonday(parseLocalDate(dateIso)));
}

function activeWeekStartIso() {
  return toISODate(activeDraftWeekStart);
}

function activeWeekEndIso() {
  return toISODate(addDays(activeDraftWeekStart, 5));
}

function draftStorageKeyForWeek(weekStartIso = activeWeekStartIso()) {
  return `uws_week_schedule_draft_${currentUser?.id || "guest"}_${weekStartIso}`;
}

function readDraftForWeek(weekStartIso = activeWeekStartIso()) {
  try {
    const value = JSON.parse(localStorage.getItem(draftStorageKeyForWeek(weekStartIso)) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function persistWeekDraft() {
  localStorage.setItem(draftStorageKeyForWeek(), JSON.stringify(weekDraft));
}

function setActiveDraftWeek(dateIso, shouldRender = true) {
  const nextStart = getMonday(parseLocalDate(dateIso));
  const changed = toISODate(nextStart) !== activeWeekStartIso();
  activeDraftWeekStart = nextStart;
  weekDraft = readDraftForWeek();
  if (shouldRender && changed) {
    renderDraftReview();
    renderCalendar();
  }
}

function getDraftForDate(dateIso) {
  const weekStartIso = weekStartIsoForDate(dateIso);
  if (weekStartIso === activeWeekStartIso()) return weekDraft[dateIso] || null;
  return readDraftForWeek(weekStartIso)[dateIso] || null;
}

function formatActiveWeekRange() {
  return `Tuần ${formatDate(activeWeekStartIso())} – ${formatDate(activeWeekEndIso())}`;
}

function isDateInActiveDraftWeek(dateIso) {
  return weekStartIsoForDate(dateIso) === activeWeekStartIso() && !isSundayDate(dateIso);
}

function getSelectedRegisterShift() {
  const selected = document.querySelector('input[name="registerShift"]:checked');
  return selected?.value || "";
}

function clearRegisterChoice() {
  document.querySelectorAll('input[name="registerShift"]').forEach(input => {
    input.checked = false;
  });
}

function parseScheduleNote(note) {
  const raw = String(note || "");
  const match = raw.match(TIME_META_REGEX);
  if (!match) {
    return { start: "", end: "", cleanNote: raw.replace(OFF_SUBMITTED_MARKER, "").trim(), timeText: "" };
  }
  const cleanNote = raw.replace(TIME_META_REGEX, "").replace(OFF_SUBMITTED_MARKER, "").trim();
  return {
    start: match[1],
    end: match[2],
    cleanNote,
    timeText: `${match[1]} - ${match[2]}`
  };
}

function buildScheduleNote(userNote) {
  return userNote || null;
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

function timeToMinutes(value) {
  const [hour, minute] = normalizeTime(value).split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return NaN;
  return hour * 60 + minute;
}

function minutesToTime(total) {
  const safe = Math.max(0, Math.min(23 * 60 + 59, Math.round(total / 15) * 15));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function getShiftBounds(shift, scheduleNote = "") {
  const meta = parseScheduleNote(scheduleNote);
  if (meta.start && meta.end) return { start: meta.start, end: meta.end };
  if (shift === "morning") return { start: "09:00", end: "12:00" };
  if (shift === "afternoon") return { start: "13:00", end: "17:30" };
  return { start: "09:00", end: "17:30" };
}

function getLeavePeriodTimes(period, shift, scheduleNote = "") {
  const bounds = getShiftBounds(shift, scheduleNote);
  const meta = parseScheduleNote(scheduleNote);
  const startMin = timeToMinutes(bounds.start);
  const endMin = timeToMinutes(bounds.end);
  const middle = minutesToTime((startMin + endMin) / 2);

  if (!meta.start && shift === "full_day" && period === "first_half") return { start: "09:00", end: "12:00" };
  if (!meta.start && shift === "full_day" && period === "last_half") return { start: "13:00", end: "17:30" };
  if (period === "first_half") return { start: bounds.start, end: middle };
  if (period === "last_half") return { start: middle, end: bounds.end };
  if (period === "custom") return { start: normalizeTime(leaveStartTime?.value), end: normalizeTime(leaveEndTime?.value) };
  return { start: null, end: null };
}

function formatLeavePeriod(row) {
  const period = row.leave_period || "full_shift";
  const start = normalizeTime(row.leave_start_time);
  const end = normalizeTime(row.leave_end_time);
  if (start && end) return `${LEAVE_PERIOD_LABELS[period] || "Theo giờ"} • ${start} - ${end}`;
  return `${LEAVE_PERIOD_LABELS[period] || "Toàn bộ ca"} • ${SHIFT_LABELS[row.shift] || row.shift}`;
}

function updateLeavePeriodUI(resetTimes = false) {
  if (!leavePeriod || !leaveScheduleSelect) return;
  const option = leaveScheduleSelect.options[leaveScheduleSelect.selectedIndex];
  const shift = option?.dataset.shift || "full_day";
  const scheduleNote = option?.dataset.note || "";
  const period = leavePeriod.value || "full_shift";
  const bounds = getShiftBounds(shift, scheduleNote);
  const times = getLeavePeriodTimes(period, shift, scheduleNote);
  const showCustom = period === "custom";

  leaveCustomTimeFields?.classList.toggle("hidden", !showCustom);
  if (resetTimes || !leaveStartTime?.value || !leaveEndTime?.value || !showCustom) {
    if (leaveStartTime) leaveStartTime.value = times.start || bounds.start;
    if (leaveEndTime) leaveEndTime.value = times.end || bounds.end;
  }

  if (leavePeriodHint) {
    leavePeriodHint.textContent = period === "full_shift"
      ? `Nghỉ toàn bộ ca ${SHIFT_LABELS[shift] || shift} (${bounds.start} - ${bounds.end}).`
      : period === "custom"
        ? `Chọn thời gian nằm trong ca đã duyệt: ${bounds.start} - ${bounds.end}.`
        : `${LEAVE_PERIOD_LABELS[period]}: ${times.start} - ${times.end}.`;
  }
}

function getCountForDate(dateIso) {
  const rows = monthCounts.filter(row => normalizeDate(row.work_date) === dateIso);
  const approved = rows.reduce((sum, row) => sum + Number(row.approved_count || 0), 0);
  const pending = rows.reduce((sum, row) => sum + Number(row.pending_count || 0), 0);
  const total = rows.reduce((sum, row) => sum + Number(row.total_count || 0), 0);
  return { approved, pending, total };
}

function getSchedulesForDate(dateIso) {
  return monthSchedules.filter(row => normalizeDate(row.work_date) === dateIso);
}

function getLeavesForDate(dateIso) {
  return monthLeaves.filter(row => normalizeDate(row.leave_date) === dateIso);
}

function getUnavailableForDate(dateIso) {
  return monthUnavailable.filter(row => normalizeDate(row.unavailable_date) === dateIso && row.status === "active");
}

function getSubmittedOffForDate(dateIso) {
  return getUnavailableForDate(dateIso).filter(row => String(row.note || "").includes(OFF_SUBMITTED_MARKER));
}

function getRegularUnavailableForDate(dateIso) {
  return getUnavailableForDate(dateIso).filter(row => !String(row.note || "").includes(OFF_SUBMITTED_MARKER));
}

function getBusyConflictMessage(workShift, busyShift) {
  if (!workShift || workShift === "off" || !busyShift) return "";
  if (busyShift === "full_day") {
    return "Bạn đã báo bận cả ngày nên chỉ có thể chọn OFF hoặc xóa/cập nhật lịch bận.";
  }
  if (workShift === "full_day") {
    return `Bạn đang báo bận ${busyShift === "morning" ? "buổi sáng" : "buổi chiều"}, nên không thể đăng ký làm cả ngày.`;
  }
  if (workShift === busyShift) {
    return `Ca làm ${SHIFT_LABELS[workShift] || workShift} trùng với ca đã báo bận.`;
  }
  return "";
}

function updateRegisterBusyFieldState() {
  if (!registerBusyToggle || !registerBusyFields) return;
  const enabled = registerBusyToggle.checked;
  registerBusyFields.classList.toggle("is-disabled", !enabled);
  registerBusyFields.querySelectorAll("select,input").forEach(input => {
    input.disabled = !enabled;
  });
  if (saveRegisterBusyBtn) saveRegisterBusyBtn.disabled = !enabled;
}

function populateRegisterBusyEditor(dateIso) {
  const existing = getRegularUnavailableForDate(dateIso)[0] || null;
  if (!registerBusyToggle || !registerBusyFields) return;

  registerBusyToggle.checked = !!existing;
  if (registerBusyShift) registerBusyShift.value = existing?.shift || "morning";
  if (registerBusyReason) registerBusyReason.value = existing?.reason_type || "school";
  if (registerBusyNote) registerBusyNote.value = existing?.note || "";
  if (saveRegisterBusyBtn) saveRegisterBusyBtn.textContent = existing ? "Cập nhật lịch bận" : "Lưu lịch bận";
  deleteRegisterBusyBtn?.classList.toggle("hidden", !existing);

  if (registerBusyState) {
    registerBusyState.textContent = existing
      ? `Đã lưu: ${SHIFT_LABELS[existing.shift] || existing.shift}`
      : "Chưa cập nhật";
    registerBusyState.classList.toggle("is-active", !!existing);
  }

  showMessage(registerBusyMessage, "");
  updateRegisterBusyFieldState();
}

async function saveBusyFromRegisterModal() {
  const dateIso = activeRegisterDate;
  if (!dateIso) return;
  if (isSundayDate(dateIso)) {
    showMessage(registerBusyMessage, "Chủ Nhật là ngày nghỉ hàng tuần, không cần cập nhật lịch bận.", "warn");
    return;
  }
  if (!registerBusyToggle?.checked) {
    showMessage(registerBusyMessage, "Hãy bật Lịch học / lịch bận trước khi lưu.", "err");
    return;
  }

  const shift = registerBusyShift?.value || "morning";
  const reason = registerBusyReason?.value || "school";
  const note = registerBusyNote?.value.trim() || null;
  const selectedWorkShift = getSelectedRegisterShift() || getDraftForDate(dateIso)?.shift || "";
  const conflict = getBusyConflictMessage(selectedWorkShift, shift);
  if (conflict) {
    showMessage(registerBusyMessage, conflict, "err");
    return;
  }

  const existing = getRegularUnavailableForDate(dateIso)[0] || null;
  const payload = {
    employee_id: currentUser.id,
    unavailable_date: dateIso,
    shift,
    reason_type: reason,
    note,
    status: "active"
  };

  showMessage(registerBusyMessage, existing ? "Đang cập nhật lịch bận..." : "Đang lưu lịch bận...");
  if (saveRegisterBusyBtn) saveRegisterBusyBtn.disabled = true;

  const result = existing
    ? await supabase.from("unavailability").update(payload).eq("id", existing.id)
    : await supabase.from("unavailability").insert(payload);

  if (result.error) {
    showMessage(registerBusyMessage, `Không lưu được lịch bận: ${result.error.message}`, "err");
    updateRegisterBusyFieldState();
    return;
  }

  addNotification({
    title: existing ? "Đã cập nhật lịch bận" : "Đã thêm lịch bận",
    message: `${formatDate(dateIso)} • ${SHIFT_LABELS[shift] || shift} • ${REASON_LABELS[reason] || reason}`,
    type: "ok"
  });

  await loadMonthData();
  populateRegisterBusyEditor(dateIso);
  showMessage(registerBusyMessage, existing ? "Đã cập nhật lịch bận." : "Đã lưu lịch bận.", "ok");
  showToast(existing ? "Đã cập nhật lịch bận." : "Đã thêm lịch bận.", "ok");
}

async function deleteBusyFromRegisterModal() {
  const dateIso = activeRegisterDate;
  if (!dateIso) return;
  const existing = getRegularUnavailableForDate(dateIso)[0] || null;
  if (!existing) {
    showMessage(registerBusyMessage, "Ngày này chưa có lịch bận để xóa.", "warn");
    return;
  }
  if (!window.confirm(`Xóa lịch bận ngày ${formatDate(dateIso)}?`)) return;

  showMessage(registerBusyMessage, "Đang xóa lịch bận...");
  if (deleteRegisterBusyBtn) deleteRegisterBusyBtn.disabled = true;

  const { error } = await supabase
    .from("unavailability")
    .update({ status: "cancelled" })
    .eq("id", existing.id);

  if (error) {
    showMessage(registerBusyMessage, `Không xóa được lịch bận: ${error.message}`, "err");
    if (deleteRegisterBusyBtn) deleteRegisterBusyBtn.disabled = false;
    return;
  }

  addNotification({
    title: "Đã xóa lịch bận",
    message: `Lịch bận ngày ${formatDate(dateIso)} đã được gỡ khỏi lịch.`,
    type: "ok"
  });

  await loadMonthData();
  populateRegisterBusyEditor(dateIso);
  showMessage(registerBusyMessage, "Đã xóa lịch bận.", "ok");
  showToast("Đã xóa lịch bận.", "ok");
}

function shiftText(rows) {
  if (!rows.length) return "";
  const shifts = [...new Set(rows.map(row => row.shift))];
  if (shifts.includes("full_day")) return "Cả ngày";
  return shifts.map(shift => SHIFT_LABELS[shift] || shift).join(", ");
}

function getPersonalStatus(dateIso) {
  const schedules = getSchedulesForDate(dateIso);
  const leaves = getLeavesForDate(dateIso);

  const leaveApproved = leaves.filter(row => row.status === "approved");
  const leavePending = leaves.filter(row => row.status === "pending");

  if (leaveApproved.length) {
    return { code: "leave", label: "Nghỉ đã duyệt", className: "personal-leave", detail: shiftText(leaveApproved) };
  }

  if (leavePending.length) {
    return { code: "leave-pending", label: "Chờ duyệt nghỉ", className: "personal-leave", detail: shiftText(leavePending) };
  }

  const approved = schedules.filter(row => row.status === "approved");
  const pending = schedules.filter(row => row.status === "pending");
  const rejected = schedules.filter(row => row.status === "rejected");
  const cancelled = schedules.filter(row => row.status === "cancelled");

  if (approved.length) {
    return { code: "approved", label: "Đã duyệt", className: "personal-approved", detail: shiftText(approved) };
  }

  if (pending.length) {
    return { code: "pending", label: "Chờ duyệt", className: "personal-pending", detail: shiftText(pending) };
  }

  const submittedOff = getSubmittedOffForDate(dateIso);
  if (submittedOff.length) {
    return { code: "off-submitted", label: "OFF", className: "personal-off", detail: "Đã chốt lịch" };
  }

  const draft = getDraftForDate(dateIso);
  if (draft) {
    return {
      code: draft.shift === "off" ? "draft-off" : "draft",
      label: "Bản nháp",
      className: draft.shift === "off" ? "personal-draft-off" : "personal-draft",
      detail: DRAFT_SHIFT_LABELS[draft.shift] || draft.shift
    };
  }

  if (rejected.length) {
    return { code: "rejected", label: "Từ chối", className: "personal-rejected", detail: "Có thể đăng ký lại" };
  }

  if (cancelled.length) {
    return { code: "cancelled", label: "Đã hủy", className: "personal-none", detail: "Có thể đăng ký lại" };
  }

  return { code: "none", label: "", className: "personal-empty", detail: "" };
}

function getCellStatusClass(dateIso) {
  const personalStatus = getPersonalStatus(dateIso);
  const unavailableRows = getUnavailableForDate(dateIso);

  if (personalStatus.code === "approved") return "status-approved";
  if (personalStatus.code === "pending") return "status-pending";
  if (personalStatus.code === "leave") return "status-leave";
  if (personalStatus.code === "leave-pending") return "status-leave-pending";
  if (personalStatus.code === "off-submitted") return "status-off";
  if (personalStatus.code === "draft-off") return "status-draft-off";
  if (personalStatus.code === "draft") return "status-draft";
  if (getRegularUnavailableForDate(dateIso).length) return "status-busy";
  return "status-none";
}

function renderMonthStats() {
  const approvedDates = new Set(monthSchedules.filter(row => row.status === "approved").map(row => normalizeDate(row.work_date)));
  const pendingDates = new Set(monthSchedules.filter(row => row.status === "pending").map(row => normalizeDate(row.work_date)));
  const leaveDates = new Set(monthLeaves.filter(row => row.status !== "rejected").map(row => normalizeDate(row.leave_date)));

  const target = Number(currentProfile?.min_days_per_month || 0);
  const approvedCount = approvedDates.size;
  const percent = target > 0 ? Math.min(100, Math.round((approvedCount / target) * 100)) : 0;

  approvedDaysEl.textContent = approvedCount;
  pendingDaysEl.textContent = pendingDates.size;
  leaveDaysEl.textContent = leaveDates.size;
  targetDaysEl.textContent = target;

  progressText.textContent = `${approvedCount} / ${target} ngày`;
  progressFill.style.width = `${percent}%`;
}

function renderCalendar() {
  monthTitle.textContent = getMonthLabel();
  const dates = getGridDates();
  monthCalendar.innerHTML = "";

  dates.forEach(date => {
    const iso = toISODate(date);
    const counts = getCountForDate(iso);
    const personalStatus = getPersonalStatus(iso);
    const unavailableRows = getRegularUnavailableForDate(iso);
    const weeklyOff = isSundayDate(date);

    const isOtherMonth = !sameMonth(date);
    const todayClass = isToday(date) ? "is-today" : "";
    const otherMonthClass = isOtherMonth ? "is-other-month" : "";
    const weeklyOffClass = weeklyOff ? "is-weekly-off" : "";
    const activeWeekClass = isDateInActiveDraftWeek(iso) ? "is-active-draft-week" : "";
    const statusClass = weeklyOff ? "status-weekly-off" : getCellStatusClass(iso);

    const unavailableHtml = !weeklyOff && unavailableRows.length
      ? `<div class="mini-chip busy-chip">Bạn bận: ${shiftText(unavailableRows)}</div>`
      : "";

    let actionHtml = "";
    if (!isOtherMonth) {
      if (weeklyOff) {
        actionHtml = `<button class="day-action disabled" type="button" disabled>Nghỉ hàng tuần</button>`;
      } else if (personalStatus.code === "approved") {
        actionHtml = `<button class="day-action leave" data-action="leave" data-date="${iso}" type="button">Xin nghỉ</button>`;
      } else if (personalStatus.code === "pending") {
        actionHtml = `<button class="day-action disabled" type="button" disabled>Đang chờ duyệt</button>`;
      } else if (personalStatus.code === "leave" || personalStatus.code === "leave-pending") {
        actionHtml = `<button class="day-action disabled" type="button" disabled>Đã gửi nghỉ</button>`;
      } else if (personalStatus.code === "off-submitted") {
        actionHtml = `<button class="day-action disabled" type="button" disabled>Đã chốt OFF</button>`;
      } else {
        const label = personalStatus.code === "draft" || personalStatus.code === "draft-off" ? "Sửa lựa chọn" : "Chọn lịch";
        actionHtml = `<button class="day-action register" data-action="register" data-date="${iso}" type="button">${label}</button>`;
      }
    }

    const personalStatusHtml = weeklyOff
      ? `<div class="personal-status personal-weekly-off"><span>Chủ Nhật</span><small>Nghỉ hàng tuần</small></div>`
      : personalStatus.code === "none"
        ? `<div class="personal-status empty"></div>`
        : `<div class="personal-status ${personalStatus.className}">
            <span>${personalStatus.label}</span>
            ${personalStatus.detail ? `<small>${personalStatus.detail}</small>` : ""}
          </div>`;

    const card = document.createElement("div");
    card.className = `calendar-cell ${statusClass} ${todayClass} ${otherMonthClass} ${weeklyOffClass} ${activeWeekClass}`;
    card.dataset.date = iso;
    card.innerHTML = `
      <div class="cell-top">
        <div>
          <div class="date-number">${date.getDate()}</div>
          <div class="date-small">${formatDate(iso)}</div>
        </div>
        ${weeklyOff
          ? `<div class="people-count weekly-off-count" title="Chủ Nhật nghỉ hàng tuần">CN OFF</div>`
          : `<div class="people-count" title="Số người đã duyệt">${counts.approved}/${DEFAULT_MAX_STAFF}</div>`}
      </div>

      ${personalStatusHtml}
      ${unavailableHtml}
      <div class="cell-actions">${actionHtml}</div>
    `;

    monthCalendar.appendChild(card);
  });
}

function ensureEmployeeDayDetailModal() {
  let modal = document.getElementById("employeeDayDetailModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "employeeDayDetailModal";
  modal.className = "liquid-day-modal hidden";
  modal.innerHTML = `
    <div class="liquid-day-backdrop" data-close-day-detail></div>
    <div class="liquid-day-card">
      <div class="liquid-day-head">
        <div>
          <p class="eyebrow">Chi tiết ngày</p>
          <h2 id="employeeDayDetailTitle">Ngày</h2>
          <p id="employeeDayDetailSub" class="muted"></p>
        </div>
        <button class="liquid-close" type="button" data-close-day-detail>×</button>
      </div>
      <div id="employeeDayDetailBody"></div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelectorAll("[data-close-day-detail]").forEach(el => {
    el.addEventListener("click", closeEmployeeDayDetailModal);
  });
  modal.addEventListener("change", event => {
    if (event.target.matches("#dayBusyToggle")) updateDayBusyFieldState(modal);
  });
  modal.addEventListener("click", async event => {
    const actionButton = event.target.closest("button[data-action]");
    if (!actionButton) return;
    const action = actionButton.dataset.action;
    const date = actionButton.dataset.date;

    if (action === "register") {
      closeEmployeeDayDetailModal();
      openRegisterModal(date);
    }
    if (action === "leave") {
      closeEmployeeDayDetailModal();
      openLeaveModal(date);
    }
    if (action === "save-busy") await saveBusyFromDayModal(date);
    if (action === "cancel-busy") await cancelBusyFromDayModal(date);
  });
  return modal;
}

function closeEmployeeDayDetailModal() {
  document.getElementById("employeeDayDetailModal")?.classList.add("hidden");
}

function updateDayBusyFieldState(modal = document.getElementById("employeeDayDetailModal")) {
  const toggle = modal?.querySelector("#dayBusyToggle");
  const fields = modal?.querySelector("#dayBusyFields");
  if (!toggle || !fields) return;
  fields.classList.toggle("is-disabled", !toggle.checked);
  fields.querySelectorAll("select,input").forEach(input => {
    input.disabled = !toggle.checked;
  });
}

async function saveBusyFromDayModal(dateIso) {
  if (isSundayDate(dateIso)) {
    showToast("Chủ Nhật là ngày nghỉ hàng tuần, không cần cập nhật lịch bận.", "warn");
    return;
  }

  const modal = ensureEmployeeDayDetailModal();
  const toggle = modal.querySelector("#dayBusyToggle");
  const message = modal.querySelector("#dayBusyMessage");
  const existing = getRegularUnavailableForDate(dateIso)[0];

  if (!toggle?.checked) {
    if (existing) await cancelBusyFromDayModal(dateIso);
    else showMessage(message, "Hãy bật Lịch học / lịch bận trước khi lưu.", "err");
    return;
  }

  const shift = modal.querySelector("#dayBusyShift")?.value || "morning";
  const reason = modal.querySelector("#dayBusyReason")?.value || "school";
  const note = modal.querySelector("#dayBusyNote")?.value.trim() || null;
  showMessage(message, "Đang lưu lịch bận...");

  const payload = {
    employee_id: currentUser.id,
    unavailable_date: dateIso,
    shift,
    reason_type: reason,
    note,
    status: "active"
  };

  const result = existing
    ? await supabase.from("unavailability").update(payload).eq("id", existing.id)
    : await supabase.from("unavailability").insert(payload);

  if (result.error) {
    showMessage(message, `Lỗi lưu lịch bận: ${result.error.message}`, "err");
    showToast(`Lỗi lưu lịch bận: ${result.error.message}`, "err");
    return;
  }

  addNotification({
    title: "Đã cập nhật lịch học / lịch bận",
    message: `${formatDate(dateIso)} • ${SHIFT_LABELS[shift] || shift} • ${REASON_LABELS[reason] || reason}`,
    type: "ok"
  });
  showToast("Đã cập nhật lịch học / lịch bận.", "ok");
  await loadMonthData();
  openEmployeeDayDetailModal(dateIso);
}

async function cancelBusyFromDayModal(dateIso) {
  const modal = ensureEmployeeDayDetailModal();
  const message = modal.querySelector("#dayBusyMessage");
  const existing = getRegularUnavailableForDate(dateIso)[0];
  if (!existing) {
    showMessage(message, "Ngày này chưa có lịch bận để xóa.", "warn");
    return;
  }
  if (!window.confirm(`Xóa lịch bận ngày ${formatDate(dateIso)}?`)) return;

  showMessage(message, "Đang xóa lịch bận...");
  const { error } = await supabase
    .from("unavailability")
    .update({ status: "cancelled" })
    .eq("id", existing.id);

  if (error) {
    showMessage(message, `Không thể xóa lịch bận: ${error.message}`, "err");
    return;
  }

  showToast("Đã xóa lịch học / lịch bận của ngày này.", "ok");
  await loadMonthData();
  openEmployeeDayDetailModal(dateIso);
}

function openEmployeeDayDetailModal(dateIso) {
  const modal = ensureEmployeeDayDetailModal();
  const weeklyOff = isSundayDate(dateIso);
  if (!weeklyOff) setActiveDraftWeek(dateIso);

  const counts = getCountForDate(dateIso);
  const personalStatus = getPersonalStatus(dateIso);
  const schedules = getSchedulesForDate(dateIso);
  const leaves = getLeavesForDate(dateIso);
  const unavailableRows = getRegularUnavailableForDate(dateIso);
  const submittedOff = getSubmittedOffForDate(dateIso);
  const draft = getDraftForDate(dateIso);
  const busyRow = unavailableRows[0] || null;

  const title = modal.querySelector("#employeeDayDetailTitle");
  const sub = modal.querySelector("#employeeDayDetailSub");
  const body = modal.querySelector("#employeeDayDetailBody");

  title.textContent = formatDate(dateIso);
  sub.textContent = weeklyOff
    ? "Chủ Nhật là ngày nghỉ hàng tuần và không cần đăng ký lịch."
    : personalStatus.code === "approved"
      ? "Lịch đã được duyệt. Bạn có thể xin nghỉ toàn ca hoặc theo giờ."
      : `Ngày này thuộc ${formatActiveWeekRange()}. Lịch chỉ được gửi khi bạn nộp lịch tuần.`;

  const scheduleHtml = schedules.length
    ? schedules.map(row => {
        const meta = parseScheduleNote(row.note);
        return `
          <div class="liquid-event">
            <strong>${STATUS_LABELS[row.status] || row.status}</strong>
            <small>${SHIFT_LABELS[row.shift] || row.shift}${meta.timeText ? ` • ${meta.timeText}` : ""}</small>
            ${meta.cleanNote ? `<p class="liquid-muted">${escapeHtml(meta.cleanNote)}</p>` : ""}
          </div>
        `;
      }).join("")
    : "";

  const draftHtml = draft
    ? `<div class="liquid-event draft-event"><strong>Bản nháp tuần</strong><small>${DRAFT_SHIFT_LABELS[draft.shift] || draft.shift}</small>${draft.note ? `<p class="liquid-muted">${escapeHtml(draft.note)}</p>` : ""}</div>`
    : "";

  const offHtml = submittedOff.length
    ? `<div class="liquid-event off-event"><strong>OFF đã chốt</strong><small>Ngày này đã được nộp là OFF.</small></div>`
    : "";

  const leaveHtml = leaves.length
    ? leaves.map(row => `
        <div class="liquid-event">
          <strong>Xin nghỉ: ${STATUS_LABELS[row.status] || row.status}</strong>
          <small>${escapeHtml(formatLeavePeriod(row))}</small>
          ${row.reason_note ? `<p class="liquid-muted">${escapeHtml(row.reason_note)}</p>` : ""}
        </div>
      `).join("")
    : "";

  const busyHtml = unavailableRows.length
    ? unavailableRows.map(row => `
        <div class="liquid-event busy-event">
          <strong>Lịch học / lịch bận</strong>
          <small>${SHIFT_LABELS[row.shift] || row.shift} • ${REASON_LABELS[row.reason_type] || row.reason_type}</small>
          ${row.note ? `<p class="liquid-muted">${escapeHtml(row.note)}</p>` : ""}
        </div>
      `).join("")
    : "";

  const emptyHtml = !weeklyOff && !scheduleHtml && !draftHtml && !offHtml && !leaveHtml && !busyHtml
    ? `<div class="liquid-event"><strong>Ngày trống</strong><small>Chưa có lựa chọn.</small></div>`
    : "";

  const weeklyOffHtml = weeklyOff
    ? `<div class="liquid-event weekly-off-event"><strong>Chủ Nhật nghỉ hàng tuần</strong><small>Không cần đăng ký ca, OFF hoặc lịch bận.</small></div>`
    : "";

  const busyEditorHtml = weeklyOff
    ? ""
    : submittedOff.length
      ? `<section class="busy-inline-editor"><div class="busy-toggle-row"><div><strong>Lịch học / lịch bận</strong><small>Ngày này đã chốt OFF nên không cần cập nhật lịch bận.</small></div></div></section>`
      : `
    <section class="busy-inline-editor">
      <div class="busy-toggle-row">
        <div>
          <strong>Lịch học / lịch bận</strong>
          <small>Bật để báo không khả dụng ngay trong ngày này.</small>
        </div>
        <label class="switch-control" aria-label="Bật lịch học hoặc lịch bận">
          <input id="dayBusyToggle" type="checkbox" ${busyRow ? "checked" : ""} />
          <span></span>
        </label>
      </div>
      <div id="dayBusyFields" class="busy-inline-fields ${busyRow ? "" : "is-disabled"}">
        <label>Ca bận
          <select id="dayBusyShift">
            <option value="morning" ${busyRow?.shift === "morning" ? "selected" : ""}>Sáng</option>
            <option value="afternoon" ${busyRow?.shift === "afternoon" ? "selected" : ""}>Chiều</option>
            <option value="full_day" ${busyRow?.shift === "full_day" ? "selected" : ""}>Cả ngày</option>
          </select>
        </label>
        <label>Lý do
          <select id="dayBusyReason">
            <option value="school" ${busyRow?.reason_type === "school" ? "selected" : ""}>Lịch học</option>
            <option value="exam" ${busyRow?.reason_type === "exam" ? "selected" : ""}>Thi / kiểm tra</option>
            <option value="personal" ${busyRow?.reason_type === "personal" ? "selected" : ""}>Việc cá nhân</option>
            <option value="family" ${busyRow?.reason_type === "family" ? "selected" : ""}>Việc gia đình</option>
            <option value="other" ${busyRow?.reason_type === "other" ? "selected" : ""}>Khác</option>
          </select>
        </label>
        <label class="busy-note-field">Ghi chú
          <input id="dayBusyNote" type="text" value="${escapeHtml(busyRow?.note || "")}" placeholder="Ví dụ: Học cố định buổi sáng" />
        </label>
        <div class="busy-inline-actions">
          <button class="btn secondary" data-action="save-busy" data-date="${dateIso}" type="button">${busyRow ? "Cập nhật lịch bận" : "Lưu lịch bận"}</button>
          ${busyRow ? `<button class="btn danger-soft" data-action="cancel-busy" data-date="${dateIso}" type="button">Xóa lịch bận</button>` : ""}
        </div>
        <p id="dayBusyMessage" class="message" aria-live="polite"></p>
      </div>
    </section>
  `;

  let actionHtml = "";
  if (weeklyOff) {
    actionHtml = `<button class="btn ghost" type="button" disabled>Chủ Nhật nghỉ hàng tuần</button>`;
  } else if (personalStatus.code === "approved") {
    actionHtml = `<button class="btn danger" data-action="leave" data-date="${dateIso}" type="button">Xin nghỉ / xin ra sớm</button>`;
  } else if (personalStatus.code === "pending") {
    actionHtml = `<button class="btn ghost" type="button" disabled>Đang chờ duyệt</button>`;
  } else if (personalStatus.code === "leave" || personalStatus.code === "leave-pending") {
    actionHtml = `<button class="btn ghost" type="button" disabled>Đã gửi yêu cầu nghỉ</button>`;
  } else if (personalStatus.code === "off-submitted") {
    actionHtml = `<button class="btn ghost" type="button" disabled>Đã chốt OFF</button>`;
  } else {
    actionHtml = `<button class="btn primary" data-action="register" data-date="${dateIso}" type="button">${draft ? "Sửa lựa chọn" : "Chọn lịch ngày này"}</button>`;
  }

  body.innerHTML = `
    <div class="liquid-stat-grid">
      <div class="liquid-stat"><span>Đã duyệt</span><b>${counts.approved}</b></div>
      <div class="liquid-stat"><span>Chờ duyệt</span><b>${counts.pending}</b></div>
      <div class="liquid-stat"><span>Trạng thái</span><b>${weeklyOff ? "Nghỉ CN" : (personalStatus.label || "Trống")}</b></div>
    </div>
    <div class="liquid-event-list">
      ${weeklyOffHtml}${draftHtml}${scheduleHtml}${offHtml}${leaveHtml}${busyHtml}${emptyHtml}
    </div>
    ${busyEditorHtml}
    <div class="liquid-day-actions">${actionHtml}</div>
  `;

  updateDayBusyFieldState(modal);
  modal.classList.remove("hidden");
}

function renderMyScheduleTable() {
  const scheduleRows = monthSchedules.map(row => ({ ...row, row_type: "schedule", date_value: row.work_date }));
  const offRows = monthUnavailable
    .filter(row => row.status === "active" && String(row.note || "").includes(OFF_SUBMITTED_MARKER))
    .map(row => ({ ...row, row_type: "off", date_value: row.unavailable_date }));

  const rows = [...scheduleRows, ...offRows].sort((a, b) => {
    const dateCompare = String(a.date_value).localeCompare(String(b.date_value));
    if (dateCompare !== 0) return dateCompare;
    return String(a.shift).localeCompare(String(b.shift));
  });

  if (!rows.length) {
    myScheduleTable.innerHTML = `<tr><td colspan="4" class="empty-row">Chưa có lịch đã nộp trong tháng này.</td></tr>`;
    return;
  }

  myScheduleTable.innerHTML = rows.map(row => {
    if (row.row_type === "off") {
      const note = String(row.note || "").replace(OFF_SUBMITTED_MARKER, "").trim();
      return `
        <tr>
          <td>${formatDate(row.date_value)}</td>
          <td>OFF</td>
          <td><span class="badge off">Đã chốt</span></td>
          <td>${escapeHtml(note || "")}</td>
        </tr>
      `;
    }

    const noteMeta = parseScheduleNote(row.note);
    const shiftLabel = `${SHIFT_LABELS[row.shift] || row.shift}${noteMeta.timeText ? ` • ${noteMeta.timeText}` : ""}`;
    return `
      <tr>
        <td>${formatDate(row.work_date)}</td>
        <td>${shiftLabel}</td>
        <td><span class="badge ${row.status}">${STATUS_LABELS[row.status] || row.status}</span></td>
        <td>${escapeHtml(noteMeta.cleanNote || "")}</td>
      </tr>
    `;
  }).join("");
}

function clearRegisterModal() {
  registerNote.value = "";
  showMessage(registerMessage, "");
  showMessage(registerBusyMessage, "");
  clearRegisterChoice();
  deleteDraftDayBtn?.classList.add("hidden");
}

function openRegisterModal(dateIso) {
  if (isSundayDate(dateIso)) {
    showToast("Chủ Nhật là ngày nghỉ hàng tuần và không cần đăng ký.", "warn");
    return;
  }

  setActiveDraftWeek(dateIso);
  activeRegisterDate = dateIso;
  clearRegisterModal();

  const existingSchedule = getSchedulesForDate(dateIso).find(row => ["pending", "approved"].includes(row.status));
  const submittedOff = getSubmittedOffForDate(dateIso);

  if (existingSchedule || submittedOff.length) {
    showToast("Ngày này đã được nộp và không thể sửa trực tiếp.", "warn");
    return;
  }

  const draft = getDraftForDate(dateIso);
  registerModalTitle.textContent = `${draft ? "Sửa" : "Chọn"} lịch ngày ${formatDate(dateIso)}`;
  registerModalMeta.textContent = `${formatActiveWeekRange()} • ${currentProfile?.employee_code || "Chưa có mã"} • ${employeeCodeGroup(currentProfile?.employee_code)}. Lựa chọn chỉ nằm trong bản nháp tuần cho đến khi bạn bấm Nộp lịch tuần.`;

  if (draft) {
    const input = document.querySelector(`input[name="registerShift"][value="${draft.shift}"]`);
    if (input) input.checked = true;
    registerNote.value = draft.note || "";
    deleteDraftDayBtn?.classList.remove("hidden");
  }

  populateRegisterBusyEditor(dateIso);
  registerModal.classList.remove("hidden");
}

function openLeaveModal(dateIso) {
  showMessage(leaveMessage, "");
  leaveNote.value = "";
  if (leavePeriod) leavePeriod.value = "full_shift";
  if (leaveStartTime) leaveStartTime.value = "";
  if (leaveEndTime) leaveEndTime.value = "";

  const approvedRows = getSchedulesForDate(dateIso).filter(row => row.status === "approved");

  if (!approvedRows.length) {
    showToast("Ngày này chưa có lịch được duyệt nên chưa thể xin nghỉ.", "warn");
    return;
  }

  leaveModalTitle.textContent = `Xin nghỉ ngày ${formatDate(dateIso)}`;
  leaveScheduleSelect.innerHTML = approvedRows.map(row => {
    const meta = parseScheduleNote(row.note);
    return `
      <option value="${row.id}" data-date="${row.work_date}" data-shift="${row.shift}" data-note="${escapeHtml(row.note || "")}">
        ${formatDate(row.work_date)} - ${SHIFT_LABELS[row.shift] || row.shift}${meta.timeText ? ` • ${meta.timeText}` : ""}
      </option>
    `;
  }).join("");

  updateLeavePeriodUI(true);
  leaveModal.classList.remove("hidden");
}

function renderProfileHeader() {
  const displayName = String(currentProfile?.full_name || "").trim()
    || currentProfile?.employee_code
    || currentProfile?.email
    || "bạn";

  if (welcomeName) welcomeName.textContent = `Xin chào, ${displayName}`;
  if (profileLine) {
    profileLine.textContent = `${currentProfile?.employee_code || "Chưa có mã"} • ${employeeCodeGroup(currentProfile?.employee_code)} • ${currentProfile?.role_type || ""} • ${currentProfile?.area || "Chưa có khu vực"} • ${currentProfile?.team || "Chưa có team"}`;
  }
  if (targetDaysEl) targetDaysEl.textContent = currentProfile?.min_days_per_month || 0;
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

function openProfileModal() {
  if (profileFullNameInput) profileFullNameInput.value = currentProfile?.full_name || "";
  if (profilePhoneInput) profilePhoneInput.value = currentProfile?.phone || "";
  showMessage(profileMessage, "");
  profileModal?.classList.remove("hidden");
  setTimeout(() => profileFullNameInput?.focus(), 50);
}

async function submitProfileUpdate() {
  const fullName = profileFullNameInput?.value.trim() || "";
  const phone = profilePhoneInput?.value.trim() || "";

  if (!fullName || fullName.length < 2) {
    showMessage(profileMessage, "Vui lòng nhập họ tên hợp lệ.", "err");
    return;
  }

  showMessage(profileMessage, "Đang lưu hồ sơ...");

  const { data, error } = await supabase.rpc("update_my_profile", {
    p_full_name: fullName,
    p_phone: phone || null
  });

  if (error) {
    showMessage(profileMessage, `Không lưu được hồ sơ. Hãy chạy database/upgrade-v6.sql trước. Chi tiết: ${error.message}`, "err");
    return;
  }

  currentProfile = {
    ...currentProfile,
    full_name: data?.full_name || fullName,
    phone: data?.phone || phone
  };

  renderProfileHeader();
  addNotification({
    title: "Đã cập nhật hồ sơ",
    message: "Tên hiển thị của bạn đã được cập nhật.",
    type: "ok"
  });
  showMessage(profileMessage, "Đã lưu hồ sơ.", "ok");
  showToast("Đã cập nhật tên hiển thị.", "ok");

  setTimeout(() => {
    closeModals();
  }, 700);
}

function closeModals() {
  registerModal.classList.add("hidden");
  leaveModal.classList.add("hidden");
  notificationModal?.classList.add("hidden");
  profileModal?.classList.add("hidden");
  changePasswordModal?.classList.add("hidden");
  closeEmployeeDayDetailModal();
  activeRegisterDate = null;
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

  addNotification({
    title: "Đã đổi mật khẩu",
    message: "Mật khẩu tài khoản của bạn vừa được cập nhật thành công.",
    type: "ok"
  });

  showMessage(changePasswordMessage, "Đổi mật khẩu thành công.", "ok");
  showToast("Đổi mật khẩu thành công.", "ok");

  setTimeout(() => {
    closeModals();
    clearPasswordForm();
  }, 700);
}


function renderDraftReview() {
  if (!draftReviewList || !draftReviewCount) return;
  const title = document.getElementById("draftWeekTitle");
  if (title) title.textContent = formatActiveWeekRange();

  const entries = Object.entries(weekDraft)
    .filter(([dateIso]) => isDateInActiveDraftWeek(dateIso))
    .sort(([a], [b]) => a.localeCompare(b));

  draftReviewCount.textContent = `${entries.length} ngày đã chọn`;
  const submitButton = document.getElementById("submitWeekScheduleBtn");
  const clearButton = document.getElementById("clearDraftBtn");
  if (submitButton) submitButton.disabled = entries.length === 0;
  if (clearButton) clearButton.disabled = entries.length === 0;

  if (!entries.length) {
    draftReviewList.innerHTML = `<div class="empty-row">Chưa chọn lịch cho tuần này. Hãy bấm một ngày từ Thứ Hai đến Thứ Bảy trên lịch.</div>`;
    return;
  }

  draftReviewList.innerHTML = entries.map(([dateIso, item]) => {
    const weekday = parseLocalDate(dateIso).toLocaleDateString("vi-VN", { weekday: "short" });
    return `
      <article class="draft-review-item ${item.shift === "off" ? "is-off" : ""}">
        <div class="draft-date-box">
          <b>${parseLocalDate(dateIso).getDate()}</b>
          <span>${weekday} • ${formatDate(dateIso)}</span>
        </div>
        <div class="draft-item-copy">
          <strong>${DRAFT_SHIFT_LABELS[item.shift] || item.shift}</strong>
          <small>${escapeHtml(item.note || "Không có ghi chú")}</small>
        </div>
        <div class="draft-item-actions">
          <button class="btn ghost compact-btn" type="button" data-edit-draft="${dateIso}">Sửa</button>
          <button class="btn danger-soft compact-btn" type="button" data-delete-draft="${dateIso}">Xóa</button>
        </div>
      </article>
    `;
  }).join("");
}

async function changeDraftWeek(dayOffset) {
  activeDraftWeekStart = addDays(activeDraftWeekStart, dayOffset);
  weekDraft = readDraftForWeek();
  const focusDate = addDays(activeDraftWeekStart, 2);
  const needsMonthReload = focusDate.getMonth() !== selectedMonth.getMonth()
    || focusDate.getFullYear() !== selectedMonth.getFullYear();

  if (needsMonthReload) {
    selectedMonth = new Date(focusDate.getFullYear(), focusDate.getMonth(), 1);
    await loadMonthData();
  } else {
    renderDraftReview();
    renderCalendar();
  }
  showMessage(draftReviewMessage, "");
}

function saveDraftDay() {
  if (!activeRegisterDate) return;
  if (isSundayDate(activeRegisterDate)) {
    showMessage(registerMessage, "Chủ Nhật là ngày nghỉ hàng tuần, không cần đăng ký.", "err");
    return;
  }

  setActiveDraftWeek(activeRegisterDate, false);
  const shift = getSelectedRegisterShift();

  if (!shift) {
    showMessage(registerMessage, "Vui lòng chọn Cả ngày, Buổi sáng, Buổi chiều hoặc OFF.", "err");
    return;
  }

  const activeBusy = getRegularUnavailableForDate(activeRegisterDate)[0] || null;
  const conflict = activeBusy ? getBusyConflictMessage(shift, activeBusy.shift) : "";
  if (conflict) {
    showMessage(registerMessage, `${conflict} Hãy cập nhật hoặc xóa lịch bận trước.`, "err");
    return;
  }

  weekDraft[activeRegisterDate] = {
    shift,
    note: registerNote.value.trim(),
    updatedAt: new Date().toISOString()
  };
  persistWeekDraft();
  renderDraftReview();
  renderCalendar();

  showToast(`Đã lưu vào bản nháp ${formatActiveWeekRange()}.`, "ok");
  closeModals();
}

function deleteDraftDay(dateIso = activeRegisterDate) {
  if (!dateIso) return;
  setActiveDraftWeek(dateIso, false);
  if (!weekDraft[dateIso]) return;
  delete weekDraft[dateIso];
  persistWeekDraft();
  renderDraftReview();
  renderCalendar();
  showToast(`Đã xóa lựa chọn ngày ${formatDate(dateIso)}.`, "ok", 1800);
  closeModals();
}

function clearWeekDraft() {
  const entries = Object.entries(weekDraft).filter(([dateIso]) => isDateInActiveDraftWeek(dateIso));
  if (!entries.length) {
    showToast("Bản nháp tuần đang trống.", "warn");
    return;
  }
  if (!window.confirm(`Xóa toàn bộ ${entries.length} ngày đã chọn trong ${formatActiveWeekRange()}?`)) return;
  weekDraft = {};
  persistWeekDraft();
  renderDraftReview();
  renderCalendar();
  showMessage(draftReviewMessage, "Đã xóa toàn bộ bản nháp tuần.", "ok");
}

async function submitWeekDraft() {
  const entries = Object.entries(weekDraft)
    .filter(([dateIso]) => isDateInActiveDraftWeek(dateIso))
    .sort(([a], [b]) => a.localeCompare(b));

  if (!entries.length) {
    showMessage(draftReviewMessage, "Bạn chưa chọn lịch cho tuần này.", "err");
    showToast("Bản nháp tuần đang trống.", "warn");
    return;
  }

  const conflicts = entries.filter(([dateIso]) => {
    const hasSchedule = getSchedulesForDate(dateIso).some(row => ["pending", "approved"].includes(row.status));
    return hasSchedule || getSubmittedOffForDate(dateIso).length;
  });

  if (conflicts.length) {
    showMessage(draftReviewMessage, `Có ${conflicts.length} ngày trong tuần đã được nộp trước đó. Hãy tải lại và kiểm tra bản nháp.`, "err");
    return;
  }

  if (!window.confirm(`Nộp ${entries.length} ngày của ${formatActiveWeekRange()} lên admin? Sau khi nộp, lịch làm không thể sửa trực tiếp.`)) return;

  const workRows = entries
    .filter(([, item]) => item.shift !== "off")
    .map(([dateIso, item]) => ({
      employee_id: currentUser.id,
      work_date: dateIso,
      shift: item.shift,
      status: "pending",
      note: buildScheduleNote(item.note)
    }));

  const offRows = entries
    .filter(([, item]) => item.shift === "off")
    .map(([dateIso, item]) => ({
      employee_id: currentUser.id,
      unavailable_date: dateIso,
      shift: "full_day",
      reason_type: "personal",
      note: `${OFF_SUBMITTED_MARKER}${item.note ? ` ${item.note}` : ""}`,
      status: "active"
    }));

  showMessage(draftReviewMessage, "Đang nộp lịch tuần...");
  const insertedScheduleIds = [];

  if (workRows.length) {
    const scheduleRes = await supabase.from("schedule_requests").insert(workRows).select("id");
    if (scheduleRes.error) {
      showMessage(draftReviewMessage, `Không nộp được lịch làm: ${scheduleRes.error.message}`, "err");
      showToast("Nộp lịch tuần không thành công.", "err");
      return;
    }
    (scheduleRes.data || []).forEach(row => row?.id && insertedScheduleIds.push(row.id));
  }

  if (offRows.length) {
    const offRes = await supabase.from("unavailability").insert(offRows);
    if (offRes.error) {
      if (insertedScheduleIds.length) {
        await supabase.from("schedule_requests").delete().in("id", insertedScheduleIds);
      }
      showMessage(draftReviewMessage, `Không nộp được ngày OFF: ${offRes.error.message}. Các lịch vừa tạo đã được hoàn tác.`, "err");
      showToast("Nộp lịch tuần không thành công.", "err");
      return;
    }
  }

  const workCount = workRows.length;
  const offCount = offRows.length;
  weekDraft = {};
  persistWeekDraft();

  addNotification({
    title: "Đã nộp lịch tuần",
    message: `${formatActiveWeekRange()}: ${workCount} ngày làm và ${offCount} ngày OFF đã được gửi lên admin.`,
    type: "ok"
  });

  showMessage(draftReviewMessage, "Đã nộp lịch tuần thành công. Các ngày làm đang chờ admin duyệt.", "ok");
  showToast("Đã nộp lịch tuần thành công.", "ok");
  await loadMonthData();
}

async function submitLeave() {
  const selectedOption = leaveScheduleSelect.options[leaveScheduleSelect.selectedIndex];

  if (!selectedOption) {
    showMessage(leaveMessage, "Vui lòng chọn lịch đã duyệt.", "err");
    showToast("Vui lòng chọn lịch đã duyệt.", "warn");
    return;
  }

  const scheduleId = selectedOption.value;
  const leaveDate = selectedOption.dataset.date;
  const shift = selectedOption.dataset.shift;
  const scheduleNote = selectedOption.dataset.note || "";
  const period = leavePeriod?.value || "full_shift";
  const bounds = getShiftBounds(shift, scheduleNote);
  const periodTimes = getLeavePeriodTimes(period, shift, scheduleNote);
  const start = periodTimes.start;
  const end = periodTimes.end;

  if (period !== "full_shift") {
    const startMinutes = timeToMinutes(start);
    const endMinutes = timeToMinutes(end);
    const shiftStart = timeToMinutes(bounds.start);
    const shiftEnd = timeToMinutes(bounds.end);

    if (!start || !end || !Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) {
      showMessage(leaveMessage, "Vui lòng chọn đầy đủ giờ bắt đầu và giờ kết thúc nghỉ.", "err");
      return;
    }
    if (startMinutes >= endMinutes) {
      showMessage(leaveMessage, "Giờ kết thúc phải sau giờ bắt đầu.", "err");
      return;
    }
    if (startMinutes < shiftStart || endMinutes > shiftEnd) {
      showMessage(leaveMessage, `Thời gian nghỉ phải nằm trong ca đã duyệt (${bounds.start} - ${bounds.end}).`, "err");
      return;
    }
  }

  const actualStart = start || bounds.start;
  const now = new Date();
  const leaveDateTime = new Date(`${leaveDate}T${actualStart}:00`);
  const hoursDiff = (leaveDateTime - now) / 36e5;
  const isLate = hoursDiff < 24;

  showMessage(leaveMessage, "Đang gửi yêu cầu xin nghỉ...");

  const { error } = await supabase.from("leave_requests").insert({
    employee_id: currentUser.id,
    schedule_request_id: scheduleId,
    leave_date: leaveDate,
    shift,
    leave_type: leaveType.value,
    leave_period: period,
    leave_start_time: start || null,
    leave_end_time: end || null,
    reason_note: leaveNote.value.trim() || null,
    status: "pending",
    is_late_notice: isLate
  });

  if (error) {
    const migrationHint = /leave_period|leave_start_time|leave_end_time|column/i.test(error.message || "")
      ? " Hãy chạy file supabase/migrations/002_weekly_flexible_leave.sql trong SQL Editor."
      : "";
    showMessage(leaveMessage, `Lỗi xin nghỉ: ${error.message}.${migrationHint}`, "err");
    showToast(`Lỗi xin nghỉ: ${error.message}`, "err");
    return;
  }

  const periodText = start && end
    ? `${LEAVE_PERIOD_LABELS[period] || "Theo giờ"} • ${start} - ${end}`
    : `${LEAVE_PERIOD_LABELS[period] || "Toàn bộ ca"} • ${SHIFT_LABELS[shift] || shift}`;

  addNotification({
    title: "Đã gửi yêu cầu xin nghỉ",
    message: `${formatDate(leaveDate)} • ${periodText}. Yêu cầu đang chờ duyệt.`,
    type: "warn"
  });

  showMessage(leaveMessage, "Đã gửi yêu cầu xin nghỉ. Vui lòng chờ admin duyệt.", "ok");
  showToast("Đã gửi yêu cầu xin nghỉ. Vui lòng chờ admin duyệt.", "ok");

  setTimeout(async () => {
    closeModals();
    await loadMonthData();
  }, 500);
}

function syncStatusNotifications() {
  monthSchedules.forEach(row => {
    if (!row.reviewed_at || !["approved", "rejected", "cancelled"].includes(row.status)) return;
    const meta = parseScheduleNote(row.note);
    const titleMap = {
      approved: "Lịch làm đã được duyệt",
      rejected: "Lịch làm bị từ chối",
      cancelled: "Lịch làm đã hủy"
    };
    addNotification({
      refKey: `schedule:${row.id}:${row.status}`,
      title: titleMap[row.status] || "Cập nhật lịch làm",
      message: `${formatDate(row.work_date)} • ${SHIFT_LABELS[row.shift] || row.shift}${meta.timeText ? ` • ${meta.timeText}` : ""}`,
      type: row.status === "approved" ? "ok" : "warn",
      createdAt: row.reviewed_at
    });
  });

  monthLeaves.forEach(row => {
    if (!row.reviewed_at || !["approved", "rejected"].includes(row.status)) return;
    const titleMap = {
      approved: "Yêu cầu nghỉ đã được duyệt",
      rejected: "Yêu cầu nghỉ bị từ chối"
    };
    addNotification({
      refKey: `leave:${row.id}:${row.status}`,
      title: titleMap[row.status] || "Cập nhật xin nghỉ",
      message: `${formatDate(row.leave_date)} • ${formatLeavePeriod(row)}`,
      type: row.status === "approved" ? "ok" : "warn",
      createdAt: row.reviewed_at
    });
  });
}

async function loadMonthData() {
  showMessage(calendarMessage, "Đang tải lịch tháng...");

  const monthStart = getMonthStart();
  const monthEnd = getMonthEnd();
  const startIso = toISODate(monthStart);
  const endIso = toISODate(monthEnd);

  const [countsRes, schedulesRes, leavesRes, unavailableRes] = await Promise.all([
    supabase.rpc("get_schedule_counts", { p_start: startIso, p_end: endIso }),
    supabase.from("schedule_requests").select("*").eq("employee_id", currentUser.id).gte("work_date", startIso).lte("work_date", endIso),
    supabase.from("leave_requests").select("*").eq("employee_id", currentUser.id).gte("leave_date", startIso).lte("leave_date", endIso),
    supabase.from("unavailability").select("*").eq("employee_id", currentUser.id).gte("unavailable_date", startIso).lte("unavailable_date", endIso)
  ]);

  if (countsRes.error) {
    showMessage(calendarMessage, `Lỗi tải tổng quan lịch: ${countsRes.error.message}`, "err");
    showToast(`Lỗi tải tổng quan lịch: ${countsRes.error.message}`, "err");
    return;
  }

  if (schedulesRes.error) {
    showMessage(calendarMessage, `Lỗi tải lịch cá nhân: ${schedulesRes.error.message}`, "err");
    showToast(`Lỗi tải lịch cá nhân: ${schedulesRes.error.message}`, "err");
    return;
  }

  if (leavesRes.error) {
    showMessage(calendarMessage, `Lỗi tải xin nghỉ: ${leavesRes.error.message}`, "err");
    showToast(`Lỗi tải xin nghỉ: ${leavesRes.error.message}`, "err");
    return;
  }

  if (unavailableRes.error) {
    showMessage(calendarMessage, `Lỗi tải lịch bận: ${unavailableRes.error.message}`, "err");
    showToast(`Lỗi tải lịch bận: ${unavailableRes.error.message}`, "err");
    return;
  }

  monthCounts = countsRes.data || [];
  monthSchedules = schedulesRes.data || [];
  monthLeaves = leavesRes.data || [];
  monthUnavailable = unavailableRes.data || [];
  weekDraft = readDraftForWeek();

  await loadRemoteNotifications();
  syncStatusNotifications();
  renderMonthStats();
  renderCalendar();
  renderDraftReview();
  renderMyScheduleTable();
  renderNotifications();
  updateNotificationBadge();

  showMessage(calendarMessage, "");
}

async function requireLogin() {
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

  renderProfileHeader();
  targetDaysEl.textContent = currentProfile.min_days_per_month || 0;

  return true;
}

async function logout() {
  await supabase.auth.signOut();
  window.location.href = "./index.html";
}

function bindEvents() {
  document.getElementById("logoutBtn")?.addEventListener("click", logout);
  document.getElementById("accountMenuBtn")?.addEventListener("click", toggleAccountMenu);
  document.getElementById("accountMenu")?.addEventListener("click", event => event.stopPropagation());
  document.getElementById("editProfileBtn")?.addEventListener("click", () => { closeAccountMenu(); openProfileModal(); });
  document.getElementById("submitProfileBtn")?.addEventListener("click", submitProfileUpdate);
  document.getElementById("changePasswordBtn")?.addEventListener("click", () => { closeAccountMenu(); openChangePasswordModal(); });
  document.getElementById("submitChangePasswordBtn")?.addEventListener("click", submitChangePassword);
  document.getElementById("notificationBtn")?.addEventListener("click", () => openNotificationModal());
  document.getElementById("clearNotificationsBtn")?.addEventListener("click", clearNotifications);

  document.getElementById("prevMonthBtn")?.addEventListener("click", async () => {
    selectedMonth.setMonth(selectedMonth.getMonth() - 1);
    activeDraftWeekStart = getMonday(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1));
    weekDraft = readDraftForWeek();
    showToast("Đã chuyển sang tháng trước.", "ok", 1600);
    await loadMonthData();
  });

  document.getElementById("nextMonthBtn")?.addEventListener("click", async () => {
    selectedMonth.setMonth(selectedMonth.getMonth() + 1);
    activeDraftWeekStart = getMonday(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1));
    weekDraft = readDraftForWeek();
    showToast("Đã chuyển sang tháng sau.", "ok", 1600);
    await loadMonthData();
  });

  document.getElementById("todayBtn")?.addEventListener("click", async () => {
    selectedMonth = new Date();
    selectedMonth.setDate(1);
    selectedMonth.setHours(0, 0, 0, 0);
    activeDraftWeekStart = getDefaultDraftWeekStart(new Date());
    weekDraft = readDraftForWeek();
    showToast("Đã quay về tháng hiện tại và tuần cần đăng ký.", "ok", 1600);
    await loadMonthData();
  });

  document.getElementById("monthCalendar")?.addEventListener("click", event => {
    const actionButton = event.target.closest("button[data-action]");
    if (actionButton) {
      const action = actionButton.dataset.action;
      const date = actionButton.dataset.date;

      if (action === "register") openRegisterModal(date);
      if (action === "leave") openLeaveModal(date);
      return;
    }

    const cell = event.target.closest(".calendar-cell");
    if (!cell || cell.classList.contains("is-other-month")) return;
    openEmployeeDayDetailModal(cell.dataset.date);
  });

  document.addEventListener("click", event => {
    if (!event.target.closest(".calendar-cell") && !event.target.closest(".topbar-actions") && !event.target.closest(".uws-modal-card")) {
      document.querySelectorAll(".calendar-cell.is-open").forEach(item => item.classList.remove("is-open"));
    }

    if (!event.target.closest(".account-menu-wrap")) {
      closeAccountMenu();
    }
  });

  document.getElementById("saveDraftDayBtn")?.addEventListener("click", saveDraftDay);
  document.getElementById("deleteDraftDayBtn")?.addEventListener("click", () => deleteDraftDay());
  registerBusyToggle?.addEventListener("change", updateRegisterBusyFieldState);
  saveRegisterBusyBtn?.addEventListener("click", saveBusyFromRegisterModal);
  deleteRegisterBusyBtn?.addEventListener("click", deleteBusyFromRegisterModal);
  document.getElementById("submitWeekScheduleBtn")?.addEventListener("click", submitWeekDraft);
  document.getElementById("clearDraftBtn")?.addEventListener("click", clearWeekDraft);
  draftReviewList?.addEventListener("click", event => {
    const editBtn = event.target.closest("[data-edit-draft]");
    const deleteBtn = event.target.closest("[data-delete-draft]");
    if (editBtn) openRegisterModal(editBtn.dataset.editDraft);
    if (deleteBtn) deleteDraftDay(deleteBtn.dataset.deleteDraft);
  });
  document.getElementById("submitLeaveBtn")?.addEventListener("click", submitLeave);
  leavePeriod?.addEventListener("change", () => updateLeavePeriodUI(true));
  leaveScheduleSelect?.addEventListener("change", () => updateLeavePeriodUI(true));
  document.getElementById("prevDraftWeekBtn")?.addEventListener("click", () => changeDraftWeek(-7));
  document.getElementById("currentDraftWeekBtn")?.addEventListener("click", async () => {
    activeDraftWeekStart = getDefaultDraftWeekStart(new Date());
    weekDraft = readDraftForWeek();
    const focusDate = addDays(activeDraftWeekStart, 2);
    const needsReload = focusDate.getMonth() !== selectedMonth.getMonth() || focusDate.getFullYear() !== selectedMonth.getFullYear();
    if (needsReload) {
      selectedMonth = new Date(focusDate.getFullYear(), focusDate.getMonth(), 1);
      await loadMonthData();
    } else {
      renderDraftReview();
      renderCalendar();
    }
  });
  document.getElementById("nextDraftWeekBtn")?.addEventListener("click", () => changeDraftWeek(7));
  document.getElementById("refreshMineBtn")?.addEventListener("click", async () => {
    await loadMonthData();
    showToast("Đã làm mới lịch của tôi.", "ok", 1600);
  });

  document.querySelectorAll("[data-close-modal]").forEach(el => {
    el.addEventListener("click", closeModals);
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeModals();
      closeAccountMenu();
    }
  });

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tabId = btn.dataset.tab;

      document.querySelectorAll(".tab-btn").forEach(item => item.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(item => item.classList.remove("active"));

      btn.classList.add("active");
      document.getElementById(tabId)?.classList.add("active");
    });
  });

}

(async function init() {
  const ok = await requireLogin();
  if (!ok) return;

  bindEvents();
  renderNotifications();
  updateNotificationBadge();
  activeDraftWeekStart = getDefaultDraftWeekStart(new Date());
  weekDraft = readDraftForWeek();
  await loadMonthData();
  showToast("Đã tải lịch và tuần đăng ký hiện tại.", "ok", 1600);
})();
})();
