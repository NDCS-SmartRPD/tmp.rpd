// Admin user management over user/getall|register|modify|delete|restore. No
// /admin URL prefix — the server checks is_admin from the caller uuid and 401s,
// so the local flag only decides what UI to show.
//
// The mutation payloads are UNVERIFIED against a real admin account; every shape
// lives in the api object + normalizeUser below so a correction stays one line.

import { loadMonitoring, showUserMonitoring, formatMonitoringTime, matchesMonitoring, loginStateLabels, communicationUsage, formatUsage, updateUsageDetail, initUserViews, setActivityUsers } from "./userMonitoring.js";

import { toast, confirmModal, attachThemedCalendar } from "../shared/toast.js";
import { initAdminShell, setStatLinkState } from "./adminShell.js";
import { findIdentifierInPassword } from "../shared/passwordReset.js";
import { apiPost, ApiError, getLoggedInUser } from "../shared/api.js";

// ---------------------------------------------------------------------------
// API layer
// ---------------------------------------------------------------------------

// user/getall parameter names, confirmed from the backend controller + model.
// Model behaviour driving the values below:
//   • fromDate == 0 && toDate == 0  → no create_time clause (all dates)
//   • search === ""                 → no username LIKE filter
//   • sortBy: 0 none, 1 username, 2 email, 3 create_time, 4 is_admin
//   • limitStartIndex == 0 && limitAmount == 0 → no LIMIT, so every row returns.
//     These keys arriving under the wrong names is what caused the old
//     500 "LIMIT undefined,undefined".
const USER_LIST_FILTER = () => ({
  fromDate: 0,          // 0 = no lower bound
  toDate: 0,            // 0 = no upper bound → all users regardless of date
  search: "",           // no username filter
  sortBy: 1,            // sort by username
  sortByAscending: true,
  limitStartIndex: 0,   // 0 + 0 ⇒ model omits LIMIT ⇒ returns every user
  limitAmount: 0,
});

const api = {
  // Admin-only: full user listing (see USER_LIST_FILTER note re: pagination).
  listUsers: () => apiPost("user/getall", USER_LIST_FILTER()),
  // Admin-only: create a user. is_admin follows login's 0/1 numeric flag.
  registerUser: (u) => apiPost("user/register", u),
  // Admin-only: modify an existing user (target identified by uuid).
  modifyUser: (u) => apiPost("user/modify", u),
  // Admin-only: soft-delete / restore (restore implies delete is soft).
  deleteUser: (uuid) => apiPost("user/delete", { uuid }),
  restoreUser: (uuid) => apiPost("user/restore", { uuid }),
};

// Column names CONFIRMED live 2026-07-10 from the query user/getall runs:
// username, email, create_time, is_admin, uuid, deleted. The fallback spellings
// below are belt-and-braces only.
function normalizeUser(raw) {
  return {
    uuid: raw.uuid ?? raw.user_uuid ?? "",
    username: raw.username ?? raw.user_name ?? "",
    email: raw.email ?? "",
    isAdmin: Number(raw.is_admin ?? raw.isAdmin ?? 0) === 1,
    deleted: Number(raw.deleted ?? raw.is_deleted ?? raw.isDeleted ?? 0) === 1,
    // A signup request awaiting approval, exposed by getAll as `pending`. Absent
    // until the backend ships that column, which hides everything pending-related.
    pending: Number(raw.pending ?? 0) === 1,
    createTime: raw.create_time ?? null,
    loginState: raw.loginState,
    loggedOut: raw.loggedOut,
    lastLoginAt: raw.lastLoginAt,
    lastContactAt: raw.lastContactAt,
    monitoringAvailable: raw.monitoringAvailable,
    raw,
  };
}

// ---------------------------------------------------------------------------
// State + rendering
// ---------------------------------------------------------------------------

let allUsers = [];

// Which month the "New Users" card shows: 0 = current, -1 = last month, …
let newUsersMonthOffset = 0;

// When true, the list is filtered to admins only (the "View" link on the
// Admins stat card).
let adminsOnlyView = false;

// Normalize a timestamp (unix seconds/ms or a date string) to ms, or null.
function tsToMs(ts) {
  if (ts == null || ts === "" || ts === 0 || ts === "0") return null;
  const n = Number(ts);
  if (Number.isFinite(n)) {
    if (n <= 0) return null;
    return String(n).length >= 13 ? n : n * 1000;
  }
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

// [start, end) ms bounds for the month at `offset` relative to the current one.
function monthRange(offset) {
  const n = new Date();
  return {
    start: new Date(n.getFullYear(), n.getMonth() + offset, 1).getTime(),
    end: new Date(n.getFullYear(), n.getMonth() + offset + 1, 1).getTime(),
  };
}

// Overview cards, mirroring the admin case list's stats bar.
function renderUserStats() {
  const now = new Date();
  const { start, end } = monthRange(newUsersMonthOffset);

  let admins = 0, active = 0, deleted = 0, newMonth = 0;
  for (const u of allUsers) {
    if (u.isAdmin) admins++;
    if (u.deleted) deleted++; else active++;
    const ms = tsToMs(u.createTime);
    if (ms != null && ms >= start && ms < end) newMonth++;
  }

  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(v);
  };
  set("userStatTotal", allUsers.length);
  set("userStatAdmins", admins);
  set("userStatActive", active);
  set("userStatDeactivated", deleted);
  set("userStatNew", newMonth);

  const md = new Date(now.getFullYear(), now.getMonth() + newUsersMonthOffset, 1);
  const name = md.toLocaleString(undefined, { month: "long" });
  const label = md.getFullYear() === now.getFullYear() ? name : `${name} ${md.getFullYear()}`;
  set("userStatNewLabel", `New Users (${label})`);

  // Signup-request notification: light the header bell when requests are
  // waiting (clicking it filters the list to them — wired at init).
  const pendingCount = allUsers.filter((u) => u.pending).length;
  const bell = document.getElementById("adminNotifBtn");
  const dot = bell?.querySelector(".au-bell-dot");
  if (dot) dot.style.display = pendingCount ? "" : "none";
  if (bell) {
    bell.title = pendingCount
      ? `${pendingCount} signup request${pendingCount === 1 ? "" : "s"} awaiting approval`
      : "Notifications";
  }

  document
    .querySelectorAll('[data-user-month-delta="1"]')
    .forEach((b) => (b.disabled = newUsersMonthOffset >= 0));
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);

// uuid of the user shown in the detail pane (null = none selected).
let selectedUserUuid = null;

// Format a registration timestamp as a short date, or "—".
function formatRegDate(ts) {
  const ms = tsToMs(ts);
  if (ms == null) return "—";
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

function visibleUsers() {
  const q = document.getElementById("userSearchInput").value.trim().toLowerCase();
  const status = document.getElementById("userStatusFilter").value;
  const dateVal = document.getElementById("userDateFilter")?.value || "";

  return allUsers.filter((u) => {
    // "View" link on the Admins card: show only admins.
    if (adminsOnlyView && !u.isAdmin) return false;

    // Default is Enabled; "deactivated" shows only deactivated (excluding
    // pending signups); "pending" shows only signup requests; "all" = everything.
    if (status === "active" && u.deleted) return false;
    if (status === "deactivated" && (!u.deleted || u.pending)) return false;
    if (status === "pending" && !u.pending) return false;

    if (q && !u.username.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) {
      return false;
    }

    // Filter by registration date (compare calendar day).
    if (dateVal) {
      const ms = tsToMs(u.createTime);
      if (ms == null) return false;
      const d = new Date(ms);
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (ymd !== dateVal) return false;
    }
    const usage = communicationUsage(u.lastContactAt, document.getElementById("usageThreshold").value);
    const usageFilter = document.getElementById("usageFilter").value;
    if (usageFilter !== "all" && usage.status !== usageFilter) return false;
    return matchesMonitoring(u, document.getElementById("contactTimestampType").value, document.getElementById("contactFrom").value, document.getElementById("contactTo").value, document.getElementById("contactLoginState").value);
  });
}

function renderUsers() {
  const tbody = document.getElementById("userTableBody");
  const users = visibleUsers();
  document.getElementById("userResultCount").textContent = `Showing ${users.length} of ${allUsers.length} users`;

  renderUserStats();

  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="au-empty">No users to show.</td></tr>`;
    return;
  }

  // Pending signup requests first (they need action), then active users,
  // then alphabetically.
  users.sort(
    (a, b) =>
      (b.pending - a.pending) ||
      (a.deleted - b.deleted) ||
      a.username.localeCompare(b.username)
  );

  const statusBadge = (u) => {
    if (u.pending) return `<span class="au-badge au-badge-pending">Pending approval</span>`;
    return `<span class="au-badge ${u.deleted ? "au-badge-deleted" : "au-badge-active"}">${u.deleted ? "Deactivated" : "Enabled"}</span>`;
  };

  tbody.innerHTML = users
    .map(
      (u) => `
      <tr class="au-row ${u.deleted && !u.pending ? "au-row-deleted" : ""}${u.uuid === selectedUserUuid ? " is-active" : ""}" data-uuid="${esc(u.uuid)}" role="button" tabindex="0">
        <td>${esc(u.username) || "—"}</td>
        <td>${esc(u.email) || "—"}</td>
        <td><span class="au-badge ${u.isAdmin ? "au-badge-admin" : "au-badge-user"}">${u.isAdmin ? "Admin" : "User"}</span></td>
        <td>${statusBadge(u)}</td>
        <td>${esc(formatRegDate(u.createTime))}</td>
        <td data-label="Last successful login">${esc(u.monitoringAvailable ? formatMonitoringTime(u.lastLoginAt) : "Unavailable")}</td>
        <td data-label="Last API contact">${esc(u.monitoringAvailable ? formatMonitoringTime(u.lastContactAt) : "Unavailable")}</td>
        <td data-label="Login state">${esc(u.monitoringAvailable ? loginStateLabels[u.loginState] || loginStateLabels.unknown : "Unavailable")}</td>
        <td data-label="Communication usage">${esc(u.monitoringAvailable ? formatUsage(u.lastContactAt, document.getElementById("usageThreshold").value) : "Unavailable")}</td>
        <td class="cm-td-actions">
          <div class="au-actions">
            <button type="button" class="cm-icon-btn" data-action="edit" title="Edit" aria-label="Edit ${esc(u.username)}">
              <i class="fa fa-pen" aria-hidden="true"></i>
            </button>
            ${
              u.pending
                ? `<button type="button" class="cm-icon-btn au-approve-btn" data-action="approve" title="Approve request" aria-label="Approve ${esc(u.username)}">
                     <i class="fa fa-check" aria-hidden="true"></i>
                   </button>`
                : u.deleted
                ? `<button type="button" class="cm-icon-btn" data-action="reactivate" title="Reactivate" aria-label="Reactivate ${esc(u.username)}">
                     <i class="fa fa-rotate-left" aria-hidden="true"></i>
                   </button>`
                : `<button type="button" class="cm-icon-btn" data-action="deactivate" title="Deactivate" aria-label="Deactivate ${esc(u.username)}">
                     <i class="fa fa-user-slash" aria-hidden="true"></i>
                   </button>`
            }
          </div>
        </td>
      </tr>`
    )
    .join("");
}

// ---------------------------------------------------------------------------
// User detail pane
// ---------------------------------------------------------------------------

function openUserDetail(user) {
  if (!user) return;
  selectedUserUuid = user.uuid;
  showUserMonitoring(user);

  document.getElementById("userDetailEmpty")?.classList.add("hidden");
  document.getElementById("userDetailContent")?.classList.remove("hidden");

  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  set("userDetailAvatar", (user.username || "?").charAt(0));
  set("userDetailName", user.username || "—");
  set("userDetailEmail", user.email || "—");
  set("userDetailRole", user.isAdmin ? "Administrator" : "User");
  set("userDetailStatus", user.pending ? "Pending approval" : user.deleted ? "Deactivated" : "Enabled");
  set("userDetailDate", formatRegDate(user.createTime));
  set("userDetailUuid", user.uuid || "—");

  const toggleBtn = document.getElementById("userDetailToggleBtn");
  if (toggleBtn) {
    toggleBtn.textContent = user.pending ? "Approve" : user.deleted ? "Reactivate" : "Deactivate";
  }

  // Highlight the selected row + slide the pane in on mobile.
  document.querySelectorAll("#userTableBody tr").forEach((tr) =>
    tr.classList.toggle("is-active", tr.dataset.uuid === user.uuid)
  );
  document.querySelector(".cm-page")?.classList.add("show-details");
}

function closeUserDetail() {
  document.querySelector(".cm-page")?.classList.remove("show-details");
}

// ---------------------------------------------------------------------------
// Data loading + admin gate
// ---------------------------------------------------------------------------

function showGate(message) {
  document.getElementById("userViewTabs").hidden = true;
  document.getElementById("userOverviewPanel").hidden = true;
  document.getElementById("userActivityPanel").hidden = true;
  document.getElementById("contactFilterPanel").classList.add("hidden");
  document.getElementById("userResultCount").classList.add("hidden");
  document.getElementById("adminToolbar").classList.add("hidden");
  document.getElementById("userListWrap").classList.add("hidden");
  const statsBar = document.getElementById("userStatsBar");
  if (statsBar) statsBar.style.display = "none";
  document.getElementById("userDetail")?.classList.add("hidden");
  const gate = document.getElementById("adminGate");
  gate.classList.remove("hidden");
  if (message) document.getElementById("adminGateMessage").textContent = message;
}

async function loadUsers() {
  const tbody = document.getElementById("userTableBody");
  document.getElementById("userResultCount").textContent = "Loading users…";
  tbody.innerHTML = `<tr><td colspan="10" class="au-empty">Loading users…</td></tr>`;

  try {
    const data = await api.listUsers();
    const rows = Array.isArray(data) ? data : data?.users;
    if (!Array.isArray(rows)) {
      console.warn("[admin] unexpected user/getall payload:", data);
      throw new ApiError("Unexpected response from user/getall.", 200);
    }
    // First real admin run: surface the row shape once so normalizeUser can be
    // corrected quickly if the field names differ.
    if (rows[0]) console.log("[admin] user row keys:", Object.keys(rows[0]));
    setActivityUsers(rows.filter(r => r && typeof r === "object").map(normalizeUser));

    let monitoring = new Map();
    let monitoringAvailable = false;
    const contactStatus = document.getElementById("contactFilterStatus");
    try {
      monitoring = await loadMonitoring();
      monitoringAvailable = true;
      contactStatus.textContent = "Usage is based only on last API contact and the selected threshold. Missing or invalid timestamps are Unknown; this is not online presence.";
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        showGate("Administrator access is required. Sign in again.");
        return;
      }
      contactStatus.textContent = "Communication data unavailable. Check the monitoring API deployment or server logs.";
    }
    for (const id of ["contactFrom", "contactTo", "contactTimestampType", "contactLoginState", "usageFilter", "usageThreshold"]) document.getElementById(id).disabled = !monitoringAvailable;
    if (!monitoringAvailable) {
      document.getElementById("contactFrom").value = "";
      document.getElementById("contactTo").value = "";
      document.getElementById("contactLoginState").value = "all";
      document.getElementById("usageFilter").value = "all";
    }
    for (const row of rows) {
      if (row && typeof row === "object") Object.assign(row, monitoring.get(row.uuid), { monitoringAvailable });
    }
    allUsers = rows.filter((r) => r && typeof r === "object").map(normalizeUser);
    renderUsers();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      // Server disagrees with the local isAdmin flag — server wins.
      showGate("The server rejected this account (admin auth failed).");
      return;
    }
    // Safety net for the old pagination SQL error. The confirmed limit params
    // (0/0 → no LIMIT) should stop it tripping, but the message stays clear.
    const errBlob = err instanceof ApiError
      ? `${err.message} ${err.data?.code || ""} ${err.data?.sql || ""}`
      : "";
    const isPaginationBug =
      err instanceof ApiError && err.status >= 500 &&
      /ER_SP_UNDECLARED_VAR|undeclared|LIMIT undefined/i.test(errBlob);
    const msg = isPaginationBug
      ? "The user list endpoint (user/getall) rejected the pagination parameters. Backend fix required."
      : `Failed to load users — ${esc(err.message)}`;
    console.error("Failed to load users:", err);
    document.getElementById("userResultCount").textContent = "User results unavailable";
    tbody.innerHTML = `<tr><td colspan="10" class="au-empty">${isPaginationBug ? esc(msg) : msg}</td></tr>`;
    toast.error(isPaginationBug ? "Backend can't list users (see table)." : "Failed to load users.");
  }
}

// ---------------------------------------------------------------------------
// Register / edit modal
// ---------------------------------------------------------------------------

let editingUser = null; // null = register mode

function openUserModal(user = null) {
  editingUser = user;
  const modal = document.getElementById("userModal");

  document.getElementById("userModalTitle").textContent = user ? "Edit User" : "Register User";
  document.getElementById("umUsername").value = user?.username ?? "";
  document.getElementById("umEmail").value = user?.email ?? "";
  document.getElementById("umPassword").value = "";
  document.getElementById("umIsAdmin").checked = !!user?.isAdmin;
  document.getElementById("umPassword").required = !user;
  document.getElementById("umPasswordReq").classList.toggle("hidden", !!user);
  document.getElementById("umPasswordHint").classList.toggle("hidden", !user);
  document.getElementById("userFormError").textContent = "";

  modal.classList.add("show");
  document.getElementById("umUsername").focus();
}

function closeUserModal() {
  document.getElementById("userModal").classList.remove("show");
  editingUser = null;
}

async function submitUserForm() {
  const username = document.getElementById("umUsername").value.trim();
  const email = document.getElementById("umEmail").value.trim();
  const password = document.getElementById("umPassword").value;
  const isAdmin = document.getElementById("umIsAdmin").checked ? 1 : 0;
  const errEl = document.getElementById("userFormError");

  errEl.textContent = "";
  if (!username || !email || (!editingUser && !password)) {
    errEl.textContent = "Please fill in all required fields.";
    return;
  }

  // A password must not contain the account's own username or email (2.3.2(h)).
  // Only checked when a password is being set (blank on edit = keep existing).
  if (password && findIdentifierInPassword(password, [username, email])) {
    errEl.textContent = "The password can't contain the username or email address. Please choose another password.";
    return;
  }

  const btn = document.getElementById("saveUserBtn");
  btn.disabled = true;
  try {
    if (editingUser) {
      const payload = { uuid: editingUser.uuid, username, email, is_admin: isAdmin };
      if (password) payload.password = password;
      await api.modifyUser(payload);
      toast.success(`User "${username}" updated.`);
    } else {
      await api.registerUser({ username, email, password, is_admin: isAdmin });
      toast.success(`User "${username}" registered.`);
    }
    closeUserModal();
    await loadUsers();
  } catch (err) {
    console.error("Save user failed:", err);
    errEl.textContent = err.message || "Request failed.";
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Row actions
// ---------------------------------------------------------------------------

async function handleRowAction(action, user) {
  if (action === "edit") {
    openUserModal(user);
    return;
  }

  // Approve a signup request: the pending row is a soft-deleted user, so
  // user/restore activates the account.
  if (action === "approve") {
    const ok = await confirmModal({
      title: `Approve "${user.username}"?`,
      message: `The account for ${user.email || "this user"} will be activated and they will be able to sign in.`,
      confirmText: "Approve",
      cancelText: "Cancel",
      variant: "info",
    });
    if (!ok) return;
    try {
      await api.restoreUser(user.uuid);
      toast.success(`Signup request for "${user.username}" approved.`);
      await loadUsers();
      refreshDetailIfSelected(user.uuid);
    } catch (err) {
      console.error("Approve signup request failed:", err);
      toast.error(`Approve failed — ${err.message}`);
    }
    return;
  }

  if (action === "deactivate") {
    const me = getLoggedInUser();
    if (user.uuid && user.uuid === me?.uuid) {
      toast.error("You cannot deactivate the account you are logged in with.");
      return;
    }
    const ok = await confirmModal({
      title: `Deactivate "${user.username}"?`,
      message: "The user will no longer be able to sign in. They can be reactivated later.",
      confirmText: "Deactivate",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await api.deleteUser(user.uuid);
      toast.success(`User "${user.username}" deactivated.`);
      await loadUsers();
      refreshDetailIfSelected(user.uuid);
    } catch (err) {
      console.error("Deactivate user failed:", err);
      toast.error(`Deactivate failed — ${err.message}`);
    }
    return;
  }

  if (action === "reactivate") {
    try {
      await api.restoreUser(user.uuid);
      toast.success(`User "${user.username}" reactivated.`);
      await loadUsers();
      refreshDetailIfSelected(user.uuid);
    } catch (err) {
      console.error("Reactivate user failed:", err);
      toast.error(`Reactivate failed — ${err.message}`);
    }
  }
}

// After a mutation + reload, re-populate the detail pane from the fresh data
// if that user is still the selected one.
function refreshDetailIfSelected(uuid) {
  if (selectedUserUuid !== uuid) return;
  const fresh = allUsers.find((u) => u.uuid === uuid);
  if (fresh) openUserDetail(fresh);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  const me = initAdminShell({ onDenied: showGate });
  if (!me) return;
  initUserViews();

  // Bell dot starts hidden — renderUserStats lights it when pending signup
  // requests are in the loaded data.
  const bellDot = document.querySelector("#adminNotifBtn .au-bell-dot");
  if (bellDot) bellDot.style.display = "none";

  // Bell → jump the list to the pending signup requests.
  document.getElementById("adminNotifBtn")?.addEventListener("click", () => {
    const sel = document.getElementById("userStatusFilter");
    if (sel) {
      sel.value = "pending";
      renderUsers();
    }
  });

  document.getElementById("refreshUsersBtn").addEventListener("click", loadUsers);
  document.getElementById("registerUserBtn").addEventListener("click", () => openUserModal());
  document.getElementById("userSearchInput").addEventListener("input", renderUsers);
  document.getElementById("userStatusFilter").addEventListener("change", renderUsers);

  // The shared themed calendar (toast.js) writes the value back and fires
  // `change`, so the existing renderUsers listener keeps working.
  const userDateInput = document.getElementById("userDateFilter");
  if (userDateInput) attachThemedCalendar(userDateInput, { allowClear: true });
  userDateInput?.addEventListener("change", renderUsers);
  document.getElementById("clearUserDateBtn")?.addEventListener("click", () => {
    const d = document.getElementById("userDateFilter");
    if (d) d.value = "";
    renderUsers();
  });

  // "View" link under the Deactivated card: jump the status filter to
  // deactivated (and toggle back to active).
  const viewDeactivatedLink = document.getElementById("viewDeactivatedLink");
  viewDeactivatedLink?.addEventListener("click", (e) => {
    e.preventDefault();
    const sel = document.getElementById("userStatusFilter");
    const showingDeactivated = sel.value === "deactivated";
    sel.value = showingDeactivated ? "active" : "deactivated";
    setStatLinkState(
      viewDeactivatedLink,
      showingDeactivated ? "View" : "Back to active",
      !showingDeactivated
    );
    renderUsers();
  });

  // "View" link on the Admins card: toggle showing admins only.
  const viewAdminsLink = document.getElementById("viewAdminsLink");
  viewAdminsLink?.addEventListener("click", (e) => {
    e.preventDefault();
    adminsOnlyView = !adminsOnlyView;
    setStatLinkState(viewAdminsLink, adminsOnlyView ? "Back to all" : "View", adminsOnlyView);
    renderUsers();
  });

  // Detail pane: back button (mobile) + edit / deactivate-reactivate actions.
  document.getElementById("userBackToListBtn")?.addEventListener("click", closeUserDetail);
  document.getElementById("userDetailEditBtn")?.addEventListener("click", () => {
    const u = allUsers.find((x) => x.uuid === selectedUserUuid);
    if (u) openUserModal(u);
  });
  document.getElementById("userDetailToggleBtn")?.addEventListener("click", () => {
    const u = allUsers.find((x) => x.uuid === selectedUserUuid);
    if (u) handleRowAction(u.pending ? "approve" : u.deleted ? "reactivate" : "deactivate", u);
  });

  // "New Users" month stepper (never into the future).
  document.querySelectorAll("[data-user-month-delta]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = newUsersMonthOffset + Number(btn.dataset.userMonthDelta);
      if (next > 0) return;
      newUsersMonthOffset = next;
      renderUserStats();
    });
  });

  document.getElementById("closeUserModal").addEventListener("click", closeUserModal);
  document.getElementById("cancelUserModal").addEventListener("click", closeUserModal);
  document.getElementById("userForm").addEventListener("submit", (e) => {
    e.preventDefault();
    submitUserForm();
  });
  document.getElementById("userModal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeUserModal();
  });

  // Event-delegated row actions + row selection (opens the detail pane).
  document.getElementById("userTableBody").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (btn) {
      const uuid = btn.closest("tr")?.dataset.uuid;
      const user = allUsers.find((u) => u.uuid === uuid);
      if (user) handleRowAction(btn.dataset.action, user);
      return;
    }
    // Click anywhere else on the row → open the detail pane.
    const row = e.target.closest("tr[data-uuid]");
    if (!row) return;
    const user = allUsers.find((u) => u.uuid === row.dataset.uuid);
    if (user) openUserDetail(user);
  });
  // Keyboard: Enter/Space on a focused row opens the detail pane.
  document.getElementById("userTableBody").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const row = e.target.closest("tr[data-uuid]");
    if (!row) return;
    e.preventDefault();
    const user = allUsers.find((u) => u.uuid === row.dataset.uuid);
    if (user) openUserDetail(user);
  });

  for (const id of ["contactFrom", "contactTo"]) {
    document.getElementById(id).addEventListener("change", () => {
      const from = document.getElementById("contactFrom");
      const to = document.getElementById("contactTo");
      to.setCustomValidity(from.value && to.value && from.value > to.value ? "End date must be on or after start date." : "");
      to.reportValidity();
      renderUsers();
    });
  }
  for (const id of ["contactTimestampType", "contactLoginState"]) {
    document.getElementById(id).addEventListener("change", renderUsers);
  }
  document.getElementById("usageFilter").addEventListener("change", renderUsers);
  document.getElementById("usageThreshold").addEventListener("change", () => { renderUsers(); updateUsageDetail(); });
  document.getElementById("clearContactRange").addEventListener("click", () => {
    document.getElementById("usageFilter").value = "all";
    document.getElementById("usageThreshold").value = "30";
    updateUsageDetail();
    document.getElementById("contactTimestampType").value = "lastContactAt";
    document.getElementById("contactFrom").value = "";
    document.getElementById("contactTo").value = "";
    document.getElementById("contactLoginState").value = "all";
    document.getElementById("contactTo").setCustomValidity("");
    renderUsers();
  });
  loadUsers();
});
