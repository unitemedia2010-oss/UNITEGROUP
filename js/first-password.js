"use strict";
(() => {
  const { supabase, showMessage } = window.UWS;
  const form = document.getElementById("firstPasswordForm");
  const password = document.getElementById("firstPassword");
  const confirm = document.getElementById("firstPasswordConfirm");
  const message = document.getElementById("firstPasswordMessage");
  const button = document.getElementById("firstPasswordSubmit");

  async function init() {
    const { data } = await supabase.auth.getUser();
    if (!data?.user) window.location.replace("./index.html");
  }

  form?.addEventListener("submit", async event => {
    event.preventDefault();
    const next = String(password.value || "");
    if (next.length < 8) return showMessage(message, "Mật khẩu cần tối thiểu 8 ký tự.", "err");
    if (next === "12345678") return showMessage(message, "Vui lòng chọn mật khẩu khác mật khẩu tạm.", "err");
    if (next !== confirm.value) return showMessage(message, "Hai lần nhập mật khẩu chưa khớp.", "err");
    button.disabled = true;
    button.textContent = "Đang cập nhật...";
    try {
      const { data: userData, error } = await supabase.auth.updateUser({ password: next });
      if (error) throw error;
      const userId = userData?.user?.id;
      if (!userId) throw new Error("Không xác định được tài khoản.");
      const { data: completed, error: profileError } = await supabase.rpc("complete_first_password_change");
      if (profileError || completed !== true) throw profileError || new Error("Không cập nhật được trạng thái mật khẩu.");
      showMessage(message, "Đổi mật khẩu thành công. Đang mở hệ thống...", "ok");
      setTimeout(() => window.location.replace("./portal.html"), 700);
    } catch (error) {
      showMessage(message, error.message || String(error), "err");
    } finally {
      button.disabled = false;
      button.textContent = "Cập nhật mật khẩu";
    }
  });
  init();
})();
