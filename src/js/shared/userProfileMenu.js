// Case list header profile menu: #profileBtn toggles #profileMenu (View
// Profile, Dashboard, Logout). Logout carries .logout, so caseManagement.js's
// logout handler wires it; the other two open their pages next to case_list.html.

export function setupUserProfileMenu() {
  const btn = document.getElementById("profileBtn");
  const menu = document.getElementById("profileMenu");
  if (!btn || !menu) return;

  const setOpen = (open) => {
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  };

  btn.addEventListener("click", () => setOpen(menu.hidden));
  // contains(), not identity: a click on the button usually lands on its <img>.
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) {
      setOpen(false);
      btn.focus();
    }
  });
  // Picking an item closes the menu, so it isn't left open behind the logout confirm.
  menu.addEventListener("click", (e) => {
    if (e.target.closest(".au-user-dropdown-item")) setOpen(false);
  });

  for (const [id, page] of [["profileViewBtn", "profile.html"], ["profileDashboardBtn", "my_dashboard.html"]]) {
    document.getElementById(id)?.addEventListener("click", () => {
      window.location.href = `./${page}`;
    });
  }
}
