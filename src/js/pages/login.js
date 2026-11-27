// Login + OTP flow, a two-view (login -> OTP) screen from the case-list design.

import {
  computePasswordStrength,
  validateNewPassword,
  describeRequestError,
  describeResetError,
  requestResetKey as apiRequestResetKey,
  resetPassword as apiResetPassword,
} from "../shared/passwordReset.js";
import { API_BASE, MACHINE_ID } from "../shared/api.js";

// Local copy of apiLog.js's dedup contract: log success once per label. Inline
// only because this file predates the module conversion.
const _apiLoggedLogin = new Set();
function logApi(res, label) {
  if (!res.ok) {
    console.warn(`[API] ✗ ${label} status=${res.status}`);
    return;
  }
  if (_apiLoggedLogin.has(label)) return;
  _apiLoggedLogin.add(label);
  console.log(`[API] ✓ ${label} status=${res.status}`);
}


// "Remember me" persists just the username so the field is pre-filled next
// visit (the password is never stored). Cleared when the box is unchecked.
const REMEMBER_KEY = "rememberedUsername";

let currentUUID = null;

// A guest sent here from a case page stashes its URL in postLoginRedirect, else
// the case list. Same-origin only (no open redirect), and consumed one-shot.
function postLoginTarget() {
  try {
    const stored = localStorage.getItem("postLoginRedirect");
    if (stored) {
      localStorage.removeItem("postLoginRedirect");
      const url = new URL(stored, window.location.href);
      if (url.origin === window.location.origin) return url.href;
    }
  } catch (e) {
    /* ignore malformed/absent value */
  }
  // Routed by role so admins skip the redirect flash through case_list.html.
  // caseManagement.js re-checks and redirects anyway on the wrong page.
  let isAdmin = false;
  try {
    isAdmin = Number(JSON.parse(localStorage.getItem("loggedInUser") || "null")?.isAdmin) === 1;
  } catch (e) {
    /* ignore */
  }
  return isAdmin
    ? "./src/pages/admin/admin_case_list.html"
    : "./src/pages/case_list.html";
}

// --- view switching -------------------------------------------------------

function showView(view) {
  const views = {
    login: document.getElementById("login-view"),
    signup: document.getElementById("signup-view"),
    forgot: document.getElementById("forgot-view"),
    otp: document.getElementById("otp-view")
  };
  Object.entries(views).forEach(([name, el]) => {
    if (!el) return;
    el.classList.toggle("hidden", name !== view);
  });

  if (view === "otp") {
    const first = document.querySelector("#otp-inputs .otp-box");
    if (first) first.focus();
  } else if (view === "signup") {
    document.getElementById("signup-username")?.focus();
  } else if (view === "forgot") {
    document.getElementById("forgot-email")?.focus();
  }
}

function setError(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message || "";
  // Success styling (green) is opt-in: callers add .is-success after; any
  // later message through here reverts to the default error red.
  el.classList.remove("is-success");
}

function getOtpValue() {
  return Array.from(document.querySelectorAll("#otp-inputs .otp-box"))
    .map((b) => b.value)
    .join("");
}

function clearOtpBoxes() {
  document.querySelectorAll("#otp-inputs .otp-box").forEach((b) => (b.value = ""));
}

// --- step 1: authenticate + send OTP --------------------------------------

async function sendOTP() {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();

  setError("error-message", "");

  if (!username || !password) {
    setError("error-message", "Username and password cannot be empty!");
    return false;
  }

  try {
    const loginBody = [
      { machine_id: MACHINE_ID },
      { username: username, password: password }
    ];

    const response = await fetch(`${API_BASE}/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(loginBody)
    });
    logApi(response, "POST /user/login");
    const data = await response.json();

    if (response.ok && data.successful && data.uuid) {
      currentUUID = data.uuid;

      // Store base user info but do not redirect until OTP is verified.
      const userInfo = {
        uuid: currentUUID,
        username: username,
        email: data.email,
        isAdmin: data.isAdmin
      };
      localStorage.setItem("loggedInUser", JSON.stringify(userInfo));
      localStorage.setItem("lastActivityAt", String(Date.now()));

      // Honor "Remember me": keep the username for next time, or clear it.
      try {
        if (document.getElementById("remember")?.checked) {
          localStorage.setItem(REMEMBER_KEY, username);
        } else {
          localStorage.removeItem(REMEMBER_KEY);
        }
      } catch (e) {
        /* storage may be unavailable (private mode); ignore */
      }

      // --- TEMP: OTP disabled. Skip OTP generation/email; the caller redirects
      // straight to the case list. Remove this return + uncomment below to restore. ---
      return true;
      /* TEMP-OTP-DISABLED
      // Trigger OTP generation / email.
      const otpRes = await fetch(`${API_BASE}/otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ machine_id: MACHINE_ID, uuid: currentUUID }])
      });
      logApi(otpRes, "POST /otp");

      if (!otpRes.ok) {
        setError("error-message", "Login succeeded but OTP generation failed.");
        return false;
      }

      // Move to OTP view and show where the code was sent.
      const target = document.getElementById("otp-target");
      if (target) target.textContent = data.email || username || "your account";
      return true;
      */
    }

    setError("error-message", "Login failed. Please check your username and password.");
    return false;
  } catch (error) {
    console.error("Login error:", error);
    setError("error-message", "An error occurred. Please try again later.");
    return false;
  }
}

// --- step 2: verify OTP + redirect ----------------------------------------

async function verifyAndLogin() {
  const otp = getOtpValue().trim();

  setError("otp-error-message", "");

  if (otp.length < 6) {
    setError("otp-error-message", "Please enter the 6-digit code.");
    return;
  }

  if (!currentUUID) {
    const stored = localStorage.getItem("loggedInUser");
    if (stored) {
      try {
        currentUUID = JSON.parse(stored).uuid;
      } catch (e) {
        /* ignore */
      }
    }
  }

  if (!currentUUID) {
    setError("otp-error-message", "Missing UUID. Please send OTP again.");
    return;
  }

  try {
    const verifyBody = [
      { machine_id: MACHINE_ID, uuid: currentUUID },
      { uuid: currentUUID, otp: otp }
    ];

    const response = await fetch(`${API_BASE}/otp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(verifyBody)
    });
    logApi(response, "POST /otp/verify");
    const data = await response.json();

    if (response.ok && data.successful) {
      window.location.href = postLoginTarget();
    } else {
      setError("otp-error-message", "Invalid or expired OTP.");
    }
  } catch (error) {
    console.error("OTP verification error:", error);
    setError("otp-error-message", "OTP verification failed. Please try again.");
  }
}

// --- sign up --------------------------------------------------------------

async function handleSignup() {
  const username = document.getElementById("signup-username").value.trim();
  const email = document.getElementById("signup-email").value.trim();

  setError("signup-error-message", "");

  if (!username || !email) {
    setError("signup-error-message", "Please fill in all fields.");
    return false;
  }

  // POST /user/register/request, confirmed from backend source:
  //   • Auth.none — fully public, callable from the logged-out login page.
  //   • Stores NOTHING. It only emails every admin; approval happens by an admin
  //     registering the user via user/register, which emails them to set a password.
  //   • No password is sent, which is why the form doesn't collect one.
  try {
    const res = await fetch(`${API_BASE}/user/register/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        { machine_id: MACHINE_ID },
        { username, email },
      ]),
    });
    logApi(res, "POST /user/register/request");
    const data = await res.json().catch(() => null);

    if (!res.ok || data?.successful === false) {
      const raw =
        (data?.serverErrorMessage && data.serverErrorMessage !== "..." && data.serverErrorMessage) ||
        data?.sqlMessage || "";
      // Backend answers 500 kind:"no_admin_emails_in_database" when there is
      // no admin to notify — surface something actionable instead.
      const msg = /no_admin_emails/i.test(`${raw} ${data?.kind || ""}`)
        ? "No administrator is available to receive the request. Please contact support."
        : raw || `Request failed (HTTP ${res.status}).`;
      setError("signup-error-message", `Sign up request failed — ${msg}`);
      return false;
    }

    // Request sent: every admin got the notification email. Back to the login
    // view with the username pre-filled for when the account is approved.
    showView("login");
    const loginUser = document.getElementById("username");
    if (loginUser) loginUser.value = username;
    setError(
      "error-message",
      "Request sent! An administrator has been notified. Once approved, you'll receive an email with instructions to set your password."
    );
    document.getElementById("error-message")?.classList.add("is-success");
    return true;
  } catch (error) {
    console.error("Sign up request error:", error);
    setError("signup-error-message", "Sign up request failed. Please try again.");
    return false;
  }
}

// --- forgot password ------------------------------------------------------
// Two stages in one view (forgotStage tracks which is live), both authenticated
// by machine id alone:
//   1. POST /user/reqpwreset  { email } -> emails a key; 404 unknown email.
//   2. POST /user/resetpw     { email, passwordKey, newPassword }
//        -> 403 timed_out/invalid_key, 404 key/email not found.

let forgotStage = "request"; // "request" | "reset"
let forgotEmail = "";

// Swap the forgot-view between its request and reset stages (title, subtitle,
// which field group is visible, and the submit button's label).
function setForgotStage(stage) {
  forgotStage = stage;
  const isReset = stage === "reset";

  document.getElementById("forgot-stage-request")?.toggleAttribute("hidden", isReset);
  document.getElementById("forgot-stage-reset")?.toggleAttribute("hidden", !isReset);

  const title = document.getElementById("forgot-title");
  const subtitle = document.getElementById("forgot-subtitle");
  const submit = document.getElementById("forgot-reset-btn");
  if (title) title.textContent = isReset ? "Set New Password" : "Reset Password";
  if (subtitle) {
    subtitle.textContent = isReset
      ? `Enter the key sent to ${forgotEmail || "your email"} and choose a new password`
      : "Enter in your registered email to begin the process";
  }
  if (submit) submit.textContent = isReset ? "Reset password" : "Send reset key";

  if (isReset) {
    document.getElementById("forgot-key")?.focus();
  } else {
    document.getElementById("forgot-email")?.focus();
  }
}

// Reset the forgot-view back to a clean stage-1 request state. Called whenever
// the view is opened or dismissed so a later visit never inherits stale input.
function resetForgotView() {
  forgotEmail = "";
  ["forgot-email", "forgot-key", "forgot-new-password", "forgot-confirm-password"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  updatePasswordStrength(); // hides the meter now that the field is empty
  setError("forgot-error-message", "");
  setForgotStage("request");
}

// --- password strength ----------------------------------------------------
// Scoring, validation and both endpoint calls live in shared/passwordReset.js,
// which the in-app "Change Account Password" flow uses too.

// Hidden while the field is empty; otherwise sets data-score (which drives the
// bar/label colour in CSS) and the "<label> password" text.
function updatePasswordStrength() {
  const input = document.getElementById("forgot-new-password");
  const meter = document.getElementById("forgot-strength");
  const label = document.getElementById("forgot-strength-label");
  if (!input || !meter) return;

  const pw = input.value;
  if (!pw) {
    meter.hidden = true;
    meter.removeAttribute("data-score");
    if (label) label.textContent = "";
    return;
  }

  const { score, label: text } = computePasswordStrength(pw);
  meter.hidden = false;
  meter.setAttribute("data-score", String(score));
  if (label) label.textContent = `${text} password`;
}

// Stage 1: request a reset key be emailed to the address.
async function requestResetKey(email) {
  const { ok, status } = await apiRequestResetKey(email);

  if (ok) {
    forgotEmail = email;
    setForgotStage("reset");
    setError("forgot-error-message", `A password reset key has been sent to your email`);
    document.getElementById("forgot-error-message")?.classList.add("is-success");
    return true;
  }

  setError("forgot-error-message", describeRequestError(status));
  return false;
}

// Stage 2: submit the emailed key + new password.
async function submitNewPassword() {
  const passwordKey = document.getElementById("forgot-key").value.trim();
  const newPassword = document.getElementById("forgot-new-password").value;
  const confirmPassword = document.getElementById("forgot-confirm-password").value;

  if (!passwordKey) {
    setError("forgot-error-message", "Please enter the key from your email.");
    return false;
  }
  // Signed-out reset: the username isn't known here, so we guard against the
  // one identifier we do have — the email the key was sent to (2.3.2(h)).
  const invalid = validateNewPassword(newPassword, confirmPassword, [forgotEmail]);
  if (invalid) {
    setError("forgot-error-message", invalid);
    return false;
  }

  const { ok, status, data } = await apiResetPassword({
    email: forgotEmail,
    passwordKey,
    newPassword,
  });

  if (ok) {
    // Return to the login view with the email pre-filled and a success note.
    showView("login");
    const loginUser = document.getElementById("username");
    if (loginUser && !loginUser.value) loginUser.value = forgotEmail;
    setError("error-message", "Your password has been reset. You can now sign in with your new password.");
    document.getElementById("error-message")?.classList.add("is-success");
    resetForgotView();
    return true;
  }

  setError("forgot-error-message", describeResetError(status, data?.kind || ""));
  return false;
}

async function handleForgotPassword() {
  setError("forgot-error-message", "");

  if (forgotStage === "reset") {
    return submitNewPassword();
  }

  const email = document.getElementById("forgot-email").value.trim();
  if (!email) {
    setError("forgot-error-message", "Please enter your registered email.");
    return false;
  }
  return requestResetKey(email);
}

// --- OTP box behavior (auto-advance / backspace / paste) ------------------

function wireOtpBoxes() {
  const boxes = Array.from(document.querySelectorAll("#otp-inputs .otp-box"));

  boxes.forEach((box, index) => {
    box.addEventListener("input", (e) => {
      // keep only the last typed digit
      const v = e.target.value.replace(/\D/g, "");
      e.target.value = v.slice(-1);
      if (e.target.value && index < boxes.length - 1) {
        boxes[index + 1].focus();
      }
    });

    box.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !box.value && index > 0) {
        boxes[index - 1].focus();
      }
    });

    box.addEventListener("paste", (e) => {
      e.preventDefault();
      const digits = (e.clipboardData.getData("text") || "")
        .replace(/\D/g, "")
        .slice(0, boxes.length);
      digits.split("").forEach((d, i) => {
        if (boxes[i]) boxes[i].value = d;
      });
      const next = Math.min(digits.length, boxes.length - 1);
      boxes[next].focus();
    });
  });
}

// --- wiring ---------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  wireOtpBoxes();

  // Restore a remembered username and pre-check the box so the state round-trips.
  try {
    const remembered = localStorage.getItem(REMEMBER_KEY);
    if (remembered) {
      const usernameInput = document.getElementById("username");
      const rememberBox = document.getElementById("remember");
      if (usernameInput) usernameInput.value = remembered;
      if (rememberBox) rememberBox.checked = true;
      // Move focus to the password since the username is already filled.
      document.getElementById("password")?.focus();
    }
  } catch (e) {
    /* storage may be unavailable; ignore */
  }

  // Show/hide password toggle.
  const toggleBtn = document.getElementById("toggle-password");
  const passwordInput = document.getElementById("password");
  if (toggleBtn && passwordInput) {
    toggleBtn.addEventListener("click", () => {
      const show = passwordInput.type === "password";
      passwordInput.type = show ? "text" : "password";
      toggleBtn.setAttribute("aria-pressed", String(show));
      toggleBtn.setAttribute("aria-label", show ? "Hide password" : "Show password");
      // Keep the caret in the field so typing can continue uninterrupted.
      passwordInput.focus();
    });
  }

  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("signin-btn");
      if (btn) btn.disabled = true;
      const ok = await sendOTP();
      if (btn) btn.disabled = false;
      // TEMP: OTP disabled — go straight to the post-login target on success.
      if (ok) window.location.href = postLoginTarget();
      // if (ok) showView("otp");
    });
  }

  // Toggle between the login and sign-up views.
  const goToSignup = document.getElementById("go-to-signup");
  if (goToSignup) {
    goToSignup.addEventListener("click", () => {
      setError("signup-error-message", "");
      showView("signup");
    });
  }

  const goToLogin = document.getElementById("go-to-login");
  if (goToLogin) {
    goToLogin.addEventListener("click", () => showView("login"));
  }

  const signupBack = document.getElementById("signup-back-to-login");
  if (signupBack) {
    signupBack.addEventListener("click", () => showView("login"));
  }

  // Forgot-password view: open from the login form, cancel/submit back to login.
  // Always open on stage 1 with clean fields so a prior attempt never lingers.
  const goToForgot = document.getElementById("go-to-forgot");
  if (goToForgot) {
    goToForgot.addEventListener("click", () => {
      resetForgotView();
      showView("forgot");
    });
  }

  const forgotCancel = document.getElementById("forgot-cancel");
  if (forgotCancel) {
    forgotCancel.addEventListener("click", () => {
      resetForgotView();
      showView("login");
    });
  }

  const forgotForm = document.getElementById("forgot-form");
  if (forgotForm) {
    forgotForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("forgot-reset-btn");
      if (btn) btn.disabled = true;
      await handleForgotPassword();
      if (btn) btn.disabled = false;
    });
  }

  // "Resend" on stage 2: re-request a key for the same email. forgotEmail is
  // already known, so this hits /user/reqpwreset again without leaving stage 2.
  const forgotResend = document.getElementById("forgot-resend");
  if (forgotResend) {
    forgotResend.addEventListener("click", async () => {
      if (!forgotEmail) return;
      setError("forgot-error-message", "");
      forgotResend.disabled = true;
      await requestResetKey(forgotEmail);
      forgotResend.disabled = false;
    });
  }

  // Live strength meter as the user types a new password.
  const forgotNewPasswordInput = document.getElementById("forgot-new-password");
  if (forgotNewPasswordInput) {
    forgotNewPasswordInput.addEventListener("input", updatePasswordStrength);
  }

  // Show/hide toggle for the new-password field on the reset stage.
  const forgotToggle = document.getElementById("forgot-toggle-password");
  const forgotNewPassword = document.getElementById("forgot-new-password");
  if (forgotToggle && forgotNewPassword) {
    forgotToggle.addEventListener("click", () => {
      const show = forgotNewPassword.type === "password";
      forgotNewPassword.type = show ? "text" : "password";
      forgotToggle.setAttribute("aria-pressed", String(show));
      forgotToggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
      forgotNewPassword.focus();
    });
  }

  // Show/hide password toggle on the sign-up form.
  const signupToggle = document.getElementById("signup-toggle-password");
  const signupPassword = document.getElementById("signup-password");
  if (signupToggle && signupPassword) {
    signupToggle.addEventListener("click", () => {
      const show = signupPassword.type === "password";
      signupPassword.type = show ? "text" : "password";
      signupToggle.setAttribute("aria-pressed", String(show));
      signupToggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
      signupPassword.focus();
    });
  }

  const signupForm = document.getElementById("signup-form");
  if (signupForm) {
    signupForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("signup-btn");
      if (btn) btn.disabled = true;
      await handleSignup();
      if (btn) btn.disabled = false;
    });
  }

  const otpForm = document.getElementById("otp-form");
  if (otpForm) {
    otpForm.addEventListener("submit", (e) => {
      e.preventDefault();
      verifyAndLogin();
    });
  }

  const backBtn = document.getElementById("back-to-login");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      clearOtpBoxes();
      setError("otp-error-message", "");
      showView("login");
    });
  }

  const resendBtn = document.getElementById("resend-otp");
  if (resendBtn) {
    resendBtn.addEventListener("click", async () => {
      clearOtpBoxes();
      setError("otp-error-message", "");
      resendBtn.disabled = true;
      const ok = await sendOTP();
      resendBtn.disabled = false;
      if (ok) {
        setError("otp-error-message", "A new code has been sent.");
        const first = document.querySelector("#otp-inputs .otp-box");
        if (first) first.focus();
      } else {
        // sendOTP surfaced its error on the login view; mirror it on OTP view.
        setError("otp-error-message", document.getElementById("error-message").textContent);
      }
    });
  }
});
