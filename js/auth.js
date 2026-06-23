"use strict";

(() => {
  if (window.__UWS_AUTH_V19_INITIALIZED__) return;
  window.__UWS_AUTH_V19_INITIALIZED__ = true;

  const state = {
    busy: false,
    initialized: false
  };

  function init() {
    if (state.initialized) return;
    state.initialized = true;

    const UWS = window.UWS;
    const form = document.getElementById("loginForm");
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const messageEl = document.getElementById("loginMessage");
    const submitButton = document.getElementById("loginBtn") || form?.querySelector('button[type="submit"]');

    if (!UWS?.supabase) {
      const text = "Không khởi tạo được Supabase. Hãy tải lại trang bằng Ctrl + F5.";
      if (messageEl) {
        messageEl.textContent = text;
        messageEl.className = "message err";
      }
      console.error(text);
      return;
    }

    if (!form || !emailInput || !passwordInput || !submitButton) {
      console.error("Thiếu phần tử đăng nhập trong index.html", {
        form: Boolean(form),
        email: Boolean(emailInput),
        password: Boolean(passwordInput),
        button: Boolean(submitButton)
      });
      return;
    }

    const { supabase: client, ADMIN_ROLES, showMessage } = UWS;

    function setBusy(value) {
      state.busy = value;
      submitButton.disabled = value;
      submitButton.textContent = value ? "Đang đăng nhập..." : "Đăng nhập";
      form.setAttribute("aria-busy", value ? "true" : "false");
    }

    function readCredentials() {
      // form.elements xử lý ổn định hơn với autofill/password manager trên Edge/Chrome.
      const emailField = form.elements.namedItem("email") || emailInput;
      const passwordField = form.elements.namedItem("password") || passwordInput;
      return {
        email: String(emailField?.value || "").trim().toLowerCase(),
        password: String(passwordField?.value || "")
      };
    }

    async function routeByProfile(userId) {
      const { data: profile, error } = await client
        .from("profiles")
        .select("role_type,status,must_change_password")
        .eq("id", userId)
        .single();

      if (error || !profile) {
        await client.auth.signOut();
        showMessage(messageEl, "Tài khoản đã có trong Authentication nhưng chưa có hồ sơ trong bảng profiles.", "err");
        return false;
      }

      if (profile.status !== "active") {
        await client.auth.signOut();
        showMessage(messageEl, "Tài khoản đang bị khóa. Vui lòng liên hệ Admin/HR.", "err");
        return false;
      }

      if (profile.must_change_password) {
        window.location.assign("./change-password.html");
      } else {
        window.location.assign("./portal.html");
      }
      return true;
    }

    async function handleLogin(event) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      if (state.busy) return false;

      // Cho trình duyệt một nhịp để đồng bộ giá trị autofill vào DOM.
      await new Promise(resolve => requestAnimationFrame(resolve));
      const { email, password } = readCredentials();

      if (!email || !password) {
        showMessage(messageEl, "Vui lòng nhập đầy đủ email và mật khẩu.", "err");
        (!email ? emailInput : passwordInput).focus();
        return false;
      }

      setBusy(true);
      showMessage(messageEl, "Đang xác thực tài khoản...");

      try {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) {
          showMessage(messageEl, `Đăng nhập không thành công: ${error.message}`, "err");
          return false;
        }

        if (!data?.user?.id) {
          showMessage(messageEl, "Supabase không trả về thông tin người dùng.", "err");
          return false;
        }

        showMessage(messageEl, "Đăng nhập thành công. Đang chuyển trang...", "ok");
        await routeByProfile(data.user.id);
      } catch (error) {
        console.error("UWS login error:", error);
        showMessage(messageEl, `Không kết nối được hệ thống: ${error?.message || error}`, "err");
      } finally {
        setBusy(false);
      }

      return false;
    }

    // Global fallback cho onsubmit trong HTML.
    window.UWSLogin = handleLogin;

    // Dùng onsubmit property thay vì chỉ addEventListener để tránh handler bị mất
    // khi Live Server/browser extension thay đổi DOM trong lúc phát triển.
    form.onsubmit = handleLogin;

    // Fallback cho trường hợp trình duyệt/password manager nuốt submit event.
    submitButton.addEventListener("click", event => {
      event.preventDefault();
      handleLogin(event);
    });

    // Cho phép Enter trong cả hai ô.
    [emailInput, passwordInput].forEach(input => {
      input.addEventListener("keydown", event => {
        if (event.key === "Enter") {
          event.preventDefault();
          handleLogin(event);
        }
      });
    });

    (async () => {
      try {
        const { data } = await client.auth.getUser();
        if (data?.user?.id) await routeByProfile(data.user.id);
      } catch (error) {
        console.warn("Không kiểm tra được phiên đăng nhập cũ:", error);
      }
    })();

    console.info("Unite HR Portal auth v30 ready");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
