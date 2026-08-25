// Knowledge base for the in-app help assistant. Pure data — no DOM, no imports —
// so the matcher and its tests load it anywhere. One topic per "how do I…".
//
// Fields:
//   id/title/page  slug, answer heading, owning page (see PAGE_LABELS)
//   selector       the control the topic is about, NEVER the button that opens
//                  the view containing it — that is what `reveal` is for
//   reveal         control that opens the view `selector` lives in; "Show me"
//                  clicks it, waits, then highlights. Only when target is hidden
//   keywords       words a user might type; weighted highest by the matcher
//   phrases        whole-question forms; exact containment wins outright
//   answer/steps   prose, plus optional ordered instructions
//   related        ids offered as follow-up chips

// Page ids → the label used in "Open <page>" buttons and greetings.
export const PAGE_LABELS = {
  login: "Sign In",
  case_list: "Case List",
  annotation_2d: "2D Design",
  viewer_3d: "3D Viewer",
  annotation_history: "Annotation History",
  version_history: "Version History",
  admin_users: "User Management",
  admin_machineid: "Machine IDs",
  admin_case_list: "Admin Case List",
};

// Page ids → path relative to the repo root, used to build deep links at the
// current page's depth.
export const PAGE_PATHS = {
  login: "index.html",
  case_list: "src/pages/case_list.html",
  annotation_2d: "src/pages/2DAnnotation.html",
  viewer_3d: "src/pages/ThreeDViewer.html",
  annotation_history: "src/pages/AnnotationHistory.html",
  version_history: "src/pages/VersionHistory.html",
  admin_users: "src/pages/admin/admin_users.html",
  admin_machineid: "src/pages/admin/admin_machineid.html",
  admin_case_list: "src/pages/admin/admin_case_list.html",
};

// The case-actions dropdown is closed by default, so topics about its items
// point at the item and name this as their `reveal`.
const CASE_MENU = ".cm-detail .dropdown-toggle";

// The create-case view is a pair of panes hidden until Create Case is pressed,
// so the fields inside it need the same treatment.
const CREATE_CASE = "#createCaseBtn";

// The app sidebar slides out from the footer menu button and is closed the rest
// of the time — including while the help panel itself is open.
const APP_MENU = "#footerMenuBtn";

export const HELP_TOPICS = [
  // ---------------------------------------------------------------- account
  {
    id: "sign-in",
    title: "Sign in",
    page: "login",
    keywords: ["sign", "in", "login", "log", "password", "username", "account", "access"],
    phrases: ["how do i log in", "how do i sign in", "cant log in"],
    answer:
      "Sign in from the start page with the username and password your administrator issued. Your session is remembered on this browser until you log out.",
    steps: [
      "Open the SmartRPD start page.",
      "Enter your username and password.",
      "Select Sign In — you land on the Case List.",
    ],
    related: ["request-account", "forgot-password", "log-out"],
  },
  {
    id: "request-account",
    title: "Request an account",
    page: "login",
    keywords: ["sign", "up", "register", "account", "new", "user", "request", "join", "invite"],
    phrases: ["how do i sign up", "how do i get an account", "create an account"],
    answer:
      "Sign Up on the start page sends a request to the administrators — it does not create the account itself. An admin registers you, and you then get an email to set your password.",
    steps: [
      "Select Sign Up on the start page.",
      "Fill in your details and submit — every administrator is emailed your request.",
      "Wait for the admin to register you; the system emails you a link to set your password.",
    ],
    related: ["sign-in", "approve-signup", "forgot-password"],
  },
  {
    id: "forgot-password",
    title: "Forgotten or lost password",
    page: null,
    keywords: ["forgot", "forgotten", "lost", "reset", "password", "locked", "out", "recover"],
    phrases: ["i forgot my password", "how do i reset my password", "password reset"],
    answer:
      "Use Reset Password on the sign-in page. It emails a key to your registered address, and you enter that key together with your new password.",
    steps: [
      "Select Forgot password on the sign-in page.",
      "Enter your registered email — a reset key is emailed to you.",
      "Enter the key and choose a new password of at least 8 characters.",
    ],
    related: ["sign-in", "change-password", "request-account"],
  },
  {
    id: "log-out",
    title: "Log out",
    page: null,
    selector: "#sidebarLogoutBtn",
    reveal: APP_MENU,
    keywords: ["log", "out", "logout", "sign", "exit", "quit", "leave", "session"],
    phrases: ["how do i log out", "how do i sign out"],
    answer:
      "Log out from the menu in the footer bar. You are asked to confirm, then returned to the sign-in page.",
    steps: ["Select the menu button in the footer bar.", "Choose Logout and confirm."],
    related: ["sign-in", "change-password"],
  },
  {
    id: "change-password",
    title: "Change your password",
    page: null,
    selector: "#sidebarChangePasswordBtn",
    reveal: APP_MENU,
    keywords: ["change", "password", "update", "new", "credentials", "security"],
    phrases: ["how do i change my password", "change account password"],
    answer:
      "Change Account Password in the footer menu emails a confirmation key to your registered address; enter that key with your new password to complete the change. There is no current-password field — control of your inbox is what authorises it.",
    steps: [
      "Open the menu in the footer bar and choose Change Account Password.",
      "Select Email me a key — a key is sent to your registered address.",
      "Enter the key, choose a new password of at least 8 characters, and confirm it.",
    ],
    related: ["forgot-password", "sign-in", "log-out"],
  },

  // -------------------------------------------------------------- case list
  {
    id: "create-case",
    title: "Create a new case",
    page: "case_list",
    selector: "#createCaseBtn",
    keywords: ["create", "new", "case", "add", "start", "patient", "job", "make", "open"],
    phrases: ["how do i create a case", "how do i add a new case", "start a new case"],
    answer:
      "Create Case opens a form where you name the case, upload the upper and lower jaw scans, and add any reference images.",
    steps: [
      "Select Create Case in the case-list header (the + button on a phone).",
      "Enter the case name and any case details.",
      "Upload the upper and lower jaw STL scans.",
      "Add reference images if you have them, then save.",
    ],
    related: ["upload-jaw-scans", "reference-images", "invite-during-create", "start-case", "case-status"],
  },
  {
    id: "invite-during-create",
    title: "Invite teammates while creating a case",
    page: "case_list",
    selector: "#ccInviteInput",
    reveal: CREATE_CASE,
    keywords: ["invite", "teammate", "user", "username", "create", "add", "share", "colleague"],
    phrases: [
      "how do i invite someone when creating a case",
      "can i invite a teammate while creating a case",
      "invite users in create case",
    ],
    answer:
      "The Create Case form has its own Invite Users field — type a username and select Add (or press Enter) to queue it, and they're invited as part of creating the case. This is separate from Edit User Access, which shares a case that already exists.",
    steps: [
      "Open Create Case.",
      "Type a username in Invite Users and press Enter or select Add.",
      "Repeat for each person, then save the case — they're invited together with it.",
    ],
    related: ["create-case", "user-access"],
  },
  {
    id: "upload-jaw-scans",
    title: "Upload jaw scans (STL)",
    page: "case_list",
    selector: "#uploadedJawModels",
    reveal: CREATE_CASE,
    keywords: ["upload", "jaw", "scan", "stl", "model", "mesh", "import", "upper", "lower", "file"],
    phrases: ["how do i upload a scan", "how do i add an stl", "upload jaw model"],
    answer:
      "Jaw scans are STL files attached to a case — one for the upper jaw and one for the lower. Drag a file onto the jaw tile in the create-case form, or select the tile to browse.",
    steps: [
      "Open Create Case, or select an existing case and use its jaw tiles.",
      "Drag the .stl file onto the upper or lower jaw tile (or select it to browse).",
      "Wait for the upload to finish before starting the design.",
    ],
    related: ["create-case", "reference-images", "navigate-3d"],
  },
  {
    id: "reference-images",
    title: "Add reference images",
    page: "case_list",
    selector: "#addRefImageBtn",
    reveal: CREATE_CASE,
    keywords: ["reference", "image", "photo", "picture", "attach", "upload", "xray", "add"],
    phrases: ["how do i add a photo", "how do i attach an image", "add reference images"],
    answer:
      "Reference images are photos attached to the case — drag them onto the reference tile or select it to browse. They appear in the case detail panel, where the arrows page through them.",
    steps: [
      "Open the case, then find the reference image tile.",
      "Drag images onto it, or select Browse Files.",
      "Use the ‹ › arrows above the preview to page through them.",
    ],
    related: ["create-case", "upload-jaw-scans", "noticeboard"],
  },
  {
    id: "find-case",
    title: "Search for a case",
    page: "case_list",
    selector: "#searchCaseInput",
    keywords: ["search", "find", "look", "locate", "filter", "case", "name", "date", "status"],
    phrases: ["how do i find a case", "how do i search for a case", "where is my case"],
    answer:
      "The search box in the header searches by name, date or status — pick which with the selector to its left. The count beside it shows how many cases matched.",
    steps: [
      "Choose Name, Date or Status in the picker beside the search box.",
      "Type or select what you are looking for.",
      "Clear the box to show every case again.",
    ],
    related: ["filter-by-stage", "sort-cases", "refresh-list"],
  },
  {
    id: "filter-by-stage",
    title: "Filter cases by stage",
    page: "case_list",
    selector: ".cm-stat-filters",
    keywords: ["filter", "stage", "group", "cards", "counts", "preparation", "delivery", "completed", "all"],
    phrases: ["how do i filter cases", "filter by stage", "what are the count cards"],
    answer:
      "The cards above the table group cases by stage — All Cases, Draft → 3D approved, In production → delivered, and Completed — each with a live count. Select a card to filter to it; select it again to clear.",
    steps: [
      "Select a stage card above the case table.",
      "The table narrows to that stage and the card stays highlighted.",
      "Select the active card, or All Cases, to clear the filter.",
    ],
    related: ["find-case", "case-status", "sort-cases"],
  },
  {
    id: "sort-cases",
    title: "Sort the case list",
    page: "case_list",
    selector: ".cm-table thead",
    keywords: ["sort", "order", "arrange", "column", "recent", "name", "due", "created", "owner"],
    phrases: ["how do i sort the list", "sort by due date", "order cases by name"],
    answer:
      "Select a column header to sort by it, and select it again to reverse the direction. On a phone the headers are hidden — use the Sort by picker above the list instead.",
    steps: [
      "Select the column header you want to sort by.",
      "Select it again to flip between ascending and descending.",
      "On a phone, use the Sort by dropdown above the list.",
    ],
    related: ["find-case", "filter-by-stage", "due-date"],
  },
  {
    id: "case-status",
    title: "Change a case status",
    page: "case_list",
    selector: ".cm-td-status .cm-pill",
    keywords: ["status", "change", "stage", "progress", "pending", "approved", "production", "delivered", "completed", "update"],
    phrases: ["how do i change the status", "how do i update case status", "what do the statuses mean"],
    answer:
      "Select the status pill on the case's row and pick a new one — no need to open the case first. The pencil beside STATUS in the detail panel does the same thing. The statuses run Draft → 2D design pending/drafted/approved → 3D design pending/drafted/approved → In production → Out for delivery → Delivered → Completed.",
    steps: [
      "Find the case's row in the list.",
      "Select its status pill in the Status column.",
      "Pick the new status — it saves immediately, and the stage filters recount.",
    ],
    related: ["filter-by-stage", "due-date", "case-instructions"],
  },
  {
    id: "due-date",
    title: "Set or read the due date",
    page: "case_list",
    keywords: ["due", "date", "deadline", "required", "when", "schedule", "na"],
    phrases: ["what is the due date", "how do i set a due date", "why does due say na"],
    answer:
      "The Due column comes from the case's Date Required. Set it in the Case Note of the 2D design; a case that has never had one shows N/A.",
    steps: [
      "Open the case in the 2D design.",
      "Open the Case Note tab and set Date Required.",
      "Save — the Due column on the case list picks it up.",
    ],
    related: ["case-note", "sort-cases", "case-status"],
  },
  {
    id: "case-instructions",
    title: "Add case instructions",
    page: "case_list",
    selector: "#caseInstructions",
    keywords: ["instructions", "notes", "comment", "brief", "request", "detail", "write", "add"],
    phrases: ["where do i write instructions", "how do i add case instructions"],
    answer:
      "The CASE INSTRUCTIONS box in the case detail panel takes free-text notes for the technician. It saves on its own — the status text beside it confirms when.",
    steps: [
      "Select the case in the list.",
      "Type into CASE INSTRUCTIONS in the detail panel.",
      "Wait for the saved confirmation beside the box.",
    ],
    related: ["case-note", "case-chat", "noticeboard"],
  },
  {
    id: "start-case",
    title: "Open a case for design",
    page: "case_list",
    selector: ".start-case-button",
    keywords: ["start", "open", "design", "work", "annotate", "2d", "case"],
    phrases: ["how do i start a case", "how do i open a case for design", "how do i begin designing"],
    answer:
      "Select the case, then Start Case in the detail panel — that opens the 2D design for it.",
    steps: [
      "Select the case in the list.",
      "Select Start Case at the bottom of the detail panel.",
    ],
    related: ["select-teeth", "design-mode", "share-3d-link"],
  },
  {
    id: "rename-case",
    title: "Rename a case",
    page: "case_list",
    selector: "#renameBtn",
    reveal: CASE_MENU,
    keywords: ["rename", "name", "title", "change", "edit", "case"],
    phrases: ["how do i rename a case", "change the case name"],
    answer:
      "Renaming lives in the case-actions menu — the ☰ button beside the case name in the detail panel.",
    steps: [
      "Select the case in the list.",
      "Open the ☰ menu beside the case name in the detail panel.",
      "Choose Rename, type the new name and confirm.",
    ],
    related: ["duplicate-case", "delete-case", "case-menu"],
  },
  {
    id: "case-menu",
    title: "The case actions menu",
    page: "case_list",
    selector: CASE_MENU,
    keywords: ["menu", "actions", "options", "dropdown", "more", "kebab", "hamburger"],
    phrases: ["where are the case options", "what is the menu next to the case name"],
    answer:
      "The ☰ button beside the case name opens the case-actions menu: View Dashboard, Rename, Edit User Access, View Version History, Download Reference Images, Duplicate and Delete.",
    steps: [
      "Select a case so the detail panel appears.",
      "Select the ☰ button beside the case name.",
    ],
    related: ["rename-case", "duplicate-case", "delete-case", "download-references", "user-access", "dashboard"],
  },
  {
    id: "duplicate-case",
    title: "Duplicate a case",
    page: "case_list",
    selector: "#duplicateBtn",
    reveal: CASE_MENU,
    keywords: ["duplicate", "copy", "clone", "reuse", "template", "case"],
    phrases: ["how do i duplicate a case", "how do i copy a case"],
    answer:
      "Duplicate in the case-actions menu makes a copy of the case that you can work on without touching the original.",
    steps: [
      "Select the case in the list.",
      "Open the ☰ menu beside the case name.",
      "Choose Duplicate.",
    ],
    related: ["case-menu", "rename-case", "create-case"],
  },
  {
    id: "delete-case",
    title: "Delete a case",
    page: "case_list",
    selector: "#deleteBtn",
    reveal: CASE_MENU,
    keywords: ["delete", "remove", "erase", "bin", "trash", "case", "get", "rid"],
    phrases: ["how do i delete a case", "how do i remove a case"],
    answer:
      "Delete sits at the bottom of the case-actions menu and asks you to confirm first. Only delete a case you are sure about — it is not meant to be undone from the web app.",
    steps: [
      "Select the case in the list.",
      "Open the ☰ menu beside the case name.",
      "Choose Delete and confirm.",
    ],
    related: ["case-menu", "duplicate-case", "version-history", "recover-deleted-case"],
  },
  {
    id: "recover-deleted-case",
    title: "Recover a deleted case",
    page: "admin_case_list",
    selector: "#retrieveCaseBtn",
    keywords: ["recover", "restore", "deleted", "delete", "undelete", "retrieve", "admin", "bring", "back"],
    phrases: [
      "how do i recover a deleted case",
      "can i recover a deleted case",
      "how do i restore a deleted case",
      "undo a case deletion",
    ],
    answer:
      "Deleting a case is a soft delete — the case is hidden, not destroyed. An administrator can bring it back from the Admin Case List: deleted cases show struck through there, with a Retrieve the Case button to restore them. It isn't self-service for a regular user, so ask an administrator.",
    steps: [
      "Ask an administrator to open the Admin Case List.",
      "They select the struck-through (deleted) case.",
      "They select Retrieve the Case to restore it.",
    ],
    related: ["delete-case", "admin-users"],
  },
  {
    id: "download-references",
    title: "Download the reference images",
    page: "case_list",
    selector: "#downloadReferencesBtn",
    reveal: CASE_MENU,
    keywords: ["download", "export", "save", "reference", "image", "photo", "picture", "attachment", "file", "get"],
    phrases: ["how do i download the reference images", "get the photos back", "export reference images"],
    answer:
      "Download Reference Images in the case-actions menu saves every reference image added to the case — one file if there is a single image, a zip if there are several. The download icon on the case row includes them too, in a reference_images folder alongside the STLs and the report.",
    steps: [
      "Select the case in the list.",
      "Open the ☰ menu beside the case name.",
      "Choose Download Reference Images.",
    ],
    related: ["case-menu", "share-3d-link", "save-2d"],
  },
  {
    id: "user-access",
    title: "Share a case with a colleague",
    page: "case_list",
    selector: "#editUserAccessBtn",
    reveal: CASE_MENU,
    keywords: ["share", "access", "user", "colleague", "permission", "invite", "assign", "collaborate", "owner"],
    phrases: ["how do i share a case", "how do i give someone access", "add a user to a case"],
    answer:
      "Edit User Access in the case-actions menu controls who else can open the case. Everyone with access is listed under SHARED WITH in the detail panel.",
    steps: [
      "Select the case in the list.",
      "Open the ☰ menu beside the case name.",
      "Choose Edit User Access and add or remove people.",
    ],
    related: ["case-menu", "share-3d-link", "admin-users", "invite-during-create"],
  },
  {
    id: "share-3d-link",
    title: "Share the 3D viewer link",
    page: "case_list",
    selector: "#view3dLinkRow",
    keywords: ["3d", "link", "share", "url", "copy", "send", "viewer", "export", "client"],
    phrases: ["how do i share the 3d view", "how do i copy the 3d link", "send the 3d viewer"],
    answer:
      "The 3D link row in the case detail panel gives you a viewer URL for the case — copy it with the copy button, or open it with the export button.",
    steps: [
      "Select the case in the list.",
      "Find the 3D link row at the bottom of the detail panel.",
      "Use the copy button for the link, or the export button to open it.",
    ],
    related: ["qr-code", "navigate-3d", "user-access", "share-link-privacy"],
  },
  {
    id: "share-link-privacy",
    title: "Is the shared 3D link safe to send?",
    page: null,
    keywords: ["safe", "privacy", "private", "secure", "expose", "patient", "encrypted", "confidential"],
    phrases: [
      "is the shared link safe",
      "does the 3d link expose patient information",
      "is the 3d viewer link private",
      "is it safe to share the 3d link",
    ],
    answer:
      "Yes — the case ID in a 3D Viewer link is encrypted, not a plain sequential number, and the page needs no sign-in identity beyond that link. Still, treat it like any link to patient-related data: only send it to people who should see the case.",
    steps: [],
    related: ["share-3d-link", "open-3d-viewer"],
  },
  {
    id: "qr-code",
    title: "Generate a QR code for a case",
    page: "case_list",
    selector: "#generateQrBtn",
    keywords: ["qr", "code", "scan", "phone", "mobile", "tablet", "share"],
    phrases: ["how do i generate a qr code", "open the case on my phone"],
    answer:
      "The QR button beside the 3D link turns that link into a QR code, so a phone or tablet can open the 3D viewer by scanning it.",
    steps: [
      "Select the case in the list.",
      "In the 3D link row, select the QR button.",
      "Scan the code with the device you want to view on.",
    ],
    related: ["share-3d-link", "navigate-3d"],
  },
  {
    id: "notifications",
    title: "Check notifications",
    page: "case_list",
    selector: "#notificationBtn",
    keywords: ["notification", "alert", "bell", "unread", "message", "update", "badge"],
    phrases: ["where are my notifications", "what is the bell icon"],
    answer:
      "The bell in the header lists your notifications, with a badge for unread ones. Mark all as read clears the badge.",
    steps: ["Select the bell in the header.", "Read the list, or select Mark all as read."],
    related: ["case-chat", "case-status"],
  },
  {
    id: "dashboard",
    title: "View the case dashboard",
    page: "case_list",
    selector: "#viewDashboardBtn",
    reveal: CASE_MENU,
    keywords: ["dashboard", "chart", "overview", "stats", "summary", "progress", "report"],
    phrases: ["how do i see the dashboard", "where are the case stats"],
    answer: "View Dashboard in the case-actions menu opens the summary view for the selected case.",
    steps: [
      "Select the case in the list.",
      "Open the ☰ menu beside the case name.",
      "Choose View Dashboard.",
    ],
    related: ["case-menu", "case-status", "version-history"],
  },
  {
    id: "refresh-list",
    title: "Refresh the case list",
    page: "case_list",
    selector: "#refreshListBtn",
    keywords: ["refresh", "reload", "update", "sync", "stale", "missing", "list"],
    phrases: ["how do i refresh the list", "my new case is not showing"],
    answer:
      "The refresh button beside the search box re-fetches the list from the server — use it when a case you expect is missing or out of date.",
    steps: ["Select the refresh button in the header."],
    related: ["find-case", "list-slow"],
  },

  // ------------------------------------------------------------- 2D design
  {
    id: "select-teeth",
    title: "Mark which teeth are present",
    page: "annotation_2d",
    selector: "#selectTeethPanel",
    keywords: ["teeth", "tooth", "select", "present", "missing", "abutment", "compromised", "chart", "mark"],
    phrases: ["how do i select teeth", "how do i mark a missing tooth", "how do i set a tooth as abutment"],
    answer:
      "The 2D design starts in tooth-selection mode. Pick Presence, Abutment or Compromised in the Select Teeth panel, then select teeth on the arch to apply it.",
    steps: [
      "Choose a marker in the Select Teeth panel (presence, abutment or compromised).",
      "Select the teeth on the upper or lower arch to apply it.",
      "Use Clear upper teeth / Clear lower teeth to start that arch over.",
    ],
    related: ["design-mode", "tooth-conditions", "clear-arch"],
  },
  {
    id: "design-mode",
    title: "Switch to design mode (the lock)",
    page: "annotation_2d",
    selector: "#jawLockToggleBtn",
    keywords: ["lock", "design", "mode", "switch", "components", "unlock", "padlock", "next"],
    phrases: ["what does the lock do", "how do i place components", "how do i get to design mode"],
    answer:
      "The padlock between the arches switches between tooth selection and design mode. Lock it once the teeth are right — the Components panel with its tabs then appears on the right.",
    steps: [
      "Finish marking teeth on both arches.",
      "Select the padlock button between the arches.",
      "The Components panel opens — place clasps, bars, plates and the major connector.",
    ],
    related: ["select-teeth", "component-tabs", "clasps"],
  },
  {
    id: "component-tabs",
    title: "The Components tabs",
    page: "annotation_2d",
    selector: "#componentTabs",
    keywords: ["component", "tab", "mesh", "assembly", "rests", "clasps", "bars", "plate", "major", "connector", "catalog", "palette"],
    phrases: ["what are the component tabs", "where do i find clasps", "what is in the components panel"],
    answer:
      "In design mode the Components panel groups everything into tabs: MESH, RESTS, CLASPS, BARS, MAJOR CONNECTOR, PLATE, ASSEMBLY and CASE NOTE. Pick a tab, pick an item, then select the tooth to place it on.",
    steps: [
      "Select a tab in the Components panel.",
      "Select the component you want from the list below it.",
      "Select the tooth on the arch to place it.",
    ],
    related: ["clasps", "bars", "major-connector", "remove-component"],
  },
  {
    id: "clasps",
    title: "Place a clasp",
    page: "annotation_2d",
    selector: "#componentTabs",
    keywords: ["clasp", "retainer", "reciprocal", "reciprocating", "buccal", "lingual", "place", "arm"],
    phrases: ["how do i add a clasp", "how do i place a retainer"],
    answer:
      "Open the CLASPS tab, choose the clasp type, then select the tooth. The reciprocating element on the opposite surface is handled for you where the design calls for it.",
    steps: [
      "Lock the arches to enter design mode.",
      "Open the CLASPS tab in the Components panel.",
      "Choose the clasp, then select the tooth to place it on.",
    ],
    related: ["component-tabs", "bars", "remove-component"],
  },
  {
    id: "bars",
    title: "Place a bar",
    page: "annotation_2d",
    selector: "#componentTabs",
    keywords: ["bar", "connector", "lingual", "palatal", "place", "minor"],
    phrases: ["how do i add a bar", "how do i place a bar"],
    answer:
      "Open the BARS tab, choose the bar, then select the tooth. Placing a bar also adds its matching reciprocating clasp automatically.",
    steps: [
      "Open the BARS tab in the Components panel.",
      "Choose the bar type.",
      "Select the tooth to place it on.",
    ],
    related: ["component-tabs", "clasps", "major-connector"],
  },
  {
    id: "major-connector",
    title: "Choose the major connector",
    page: "annotation_2d",
    selector: "#componentTabs",
    keywords: ["major", "connector", "plate", "strap", "palatal", "lingual", "bar", "horseshoe"],
    phrases: ["how do i add a major connector", "how do i change the major connector"],
    answer:
      "The MAJOR CONNECTOR tab holds the connector options for the arch. Choosing one updates the plating on the teeth it runs across.",
    steps: [
      "Open the MAJOR CONNECTOR tab in the Components panel.",
      "Choose the connector for that arch.",
      "Check the arch drawing to confirm it covers the teeth you expect.",
    ],
    related: ["component-tabs", "bars", "plates"],
  },
  {
    id: "plates",
    title: "Place plating",
    page: "annotation_2d",
    selector: "#componentTabs",
    keywords: ["plate", "plating", "proximal", "coverage", "place"],
    phrases: ["how do i add a plate", "how do i plate a tooth"],
    answer:
      "The PLATE tab places plating on individual teeth. Plate-style major connectors also plate the teeth they cross — those follow the connector rather than being placed one by one.",
    steps: [
      "Open the PLATE tab in the Components panel.",
      "Choose the plating element.",
      "Select the tooth to place it on.",
    ],
    related: ["component-tabs", "major-connector", "remove-component"],
  },
  {
    id: "remove-component",
    title: "Remove a placed component",
    page: "annotation_2d",
    keywords: ["remove", "delete", "undo", "clear", "component", "mistake", "wrong", "erase"],
    phrases: ["how do i remove a component", "i placed the wrong component", "how do i undo"],
    answer:
      "Select a tooth that already carries components to open the Remove component dialog and pick what to take off. The undo button beside the padlock steps back through recent changes, and Clear Top / Clear Bottom strips every component from one jaw.",
    steps: [
      "Select the tooth that carries the component.",
      "Choose the component to remove in the dialog.",
      "Or use undo beside the padlock, or Clear Top / Clear Bottom for a whole jaw.",
    ],
    related: ["component-tabs", "clear-arch", "save-2d"],
  },
  {
    id: "clear-arch",
    title: "Clear an arch and start over",
    page: "annotation_2d",
    selector: "#clearTopBtn",
    keywords: ["clear", "reset", "start", "over", "empty", "wipe", "arch", "upper", "lower", "scratch"],
    phrases: ["how do i clear the arch", "how do i start over", "reset the design"],
    answer:
      "Clear upper teeth / Clear lower teeth reset tooth selection for one arch. In design mode the same buttons become Clear Top / Clear Bottom and strip the placed components instead, leaving the teeth alone.",
    steps: [
      "Select Clear upper teeth or Clear lower teeth below the arches.",
      "In design mode, use Clear Top or Clear Bottom to remove components only.",
    ],
    related: ["select-teeth", "remove-component", "template-jaw"],
  },
  {
    id: "template-jaw",
    title: "Propose a design, or draw from scratch",
    page: "annotation_2d",
    selector: "#loadProposalBtn",
    keywords: [
      "kennedy",
      "class",
      "classification",
      "connector",
      "proposal",
      "propose",
      "template",
      "load",
      "scratch",
      "draw",
      "blank",
    ],
    phrases: ["what kennedy class is this case", "how do i draw from scratch"],
    answer:
      "Load Proposed Design sends the current tooth presence, jaw type, and material to the design DLL. If the DLL is unavailable, the page falls back to the local Kennedy proposal preview before anything is placed. Draw from Scratch clears the arches so you build the case up yourself.",
    steps: [
      "Select Load Proposed Design to generate the proposed design. If the fallback preview opens, press Place Design to accept it.",
      "Undo reverses it if you change your mind.",
      "Or pick Draw from Scratch to start empty.",
    ],
    related: ["select-teeth", "clear-arch"],
  },
  {
    id: "tooth-conditions",
    title: "Record tooth conditions",
    page: "annotation_2d",
    selector: "#openClinicalInfoBtn",
    keywords: ["condition", "crown", "implant", "extraction", "inlay", "onlay", "root", "canal", "stump", "cracked", "mobility", "tilted", "restoration", "abutment"],
    phrases: ["how do i mark a crown", "how do i record an implant", "where do i set tooth conditions"],
    answer:
      "Clinical Info records per-tooth conditions — crown, implant, extraction, inlay, onlay, root canal therapy, root stump, cracked, mobility, tilted tooth and restoration — on an upper and lower row.",
    steps: [
      "Select the Clinical Information button in the header of the 2D design.",
      "Select a tooth in the upper or lower row.",
      "Apply the condition, then Save.",
    ],
    related: ["clinical-info", "select-teeth", "case-note"],
  },
  {
    id: "clinical-info",
    title: "Clinical Info",
    page: "annotation_2d",
    selector: "#openClinicalInfoBtn",
    keywords: ["clinical", "info", "information", "chart", "legend", "medical", "history"],
    phrases: ["what is clinical info", "where is the clinical information"],
    answer:
      "Clinical Info is the per-tooth clinical chart for the case, with a legend for the markers. It has its own Save, and Clear empties it.",
    steps: [
      "Select the Clinical Information button in the header.",
      "Mark the teeth, using the LEGEND as a reference.",
      "Select Save.",
    ],
    related: ["tooth-conditions", "case-note", "noticeboard"],
  },
  {
    id: "case-note",
    title: "Case Note and Date Required",
    page: "annotation_2d",
    selector: "#footerCaseNoteBtn",
    keywords: ["case", "note", "comment", "date", "required", "due", "text", "write", "instruction"],
    phrases: ["where is the case note", "how do i set date required"],
    answer:
      "The Case Note holds the written brief for the case, including Date Required — which is what the case list shows as Due. It is both a tab in the Components panel and the note button in the header.",
    steps: [
      "Select the Case Note button, or the CASE NOTE tab in the Components panel.",
      "Fill in the note and Date Required.",
      "Save the design to keep it.",
    ],
    related: ["due-date", "case-instructions", "clinical-info"],
  },
  {
    id: "noticeboard",
    title: "Noticeboard",
    page: "annotation_2d",
    selector: "#openNoticeboardBtn",
    keywords: ["noticeboard", "board", "instruction", "slide", "capture", "screenshot", "report", "view"],
    phrases: ["what is the noticeboard", "how do i add an instruction card"],
    answer:
      "The Noticeboard collects instruction cards and captured views for the case, and can generate a report from them. It opens from the clipboard button in the footer.",
    steps: [
      "Select the clipboard button in the footer bar.",
      "Add instruction cards or captured views.",
      "Use Generate Report to produce the summary.",
    ],
    related: ["case-note", "clinical-info", "reference-images"],
  },
  {
    id: "save-2d",
    title: "Save the 2D design",
    page: "annotation_2d",
    selector: "#sidebarSaveBtn",
    reveal: APP_MENU,
    keywords: ["save", "keep", "store", "commit", "persist", "design", "work"],
    phrases: ["how do i save", "how do i save my design", "does it save automatically"],
    answer:
      "Save is in the footer menu of the 2D design — it writes both jaws back to the server. Leaving without saving prompts you to Save & Return or return anyway.",
    steps: [
      "Select the menu button in the footer bar.",
      "Choose Save and wait for the confirmation message.",
    ],
    related: ["return-to-list", "version-history"],
  },
  {
    id: "return-to-list",
    title: "Go back to the case list",
    page: "annotation_2d",
    selector: "#sidebarReturnBtn",
    reveal: APP_MENU,
    keywords: ["return", "back", "exit", "leave", "close", "list", "quit"],
    phrases: ["how do i go back", "how do i return to the case list"],
    answer:
      "Return is in the footer menu. If there are unsaved changes you are offered Save & Return or Return without saving.",
    steps: ["Select the menu button in the footer bar.", "Choose Return."],
    related: ["save-2d", "start-case"],
  },
  {
    id: "version-history",
    title: "View version history",
    page: null,
    keywords: ["version", "history", "previous", "revision", "restore", "earlier", "past", "old"],
    phrases: ["how do i see previous versions", "where is version history", "can i restore an old version"],
    answer:
      "Version History lists the saved versions of a case. Reach it from the case-actions menu on the case list, or from the footer menu while a design is open.",
    steps: [
      "On the case list: open the ☰ menu beside the case name and choose View Version History.",
      "In a design: open the footer menu and choose Version History.",
    ],
    related: ["save-2d", "case-menu", "annotation-history"],
  },
  {
    id: "annotation-history",
    title: "Annotation history",
    page: "annotation_history",
    keywords: ["annotation", "history", "changes", "audit", "who", "edited", "log"],
    phrases: ["what is annotation history", "who changed the design"],
    answer: "Annotation History shows the record of annotation changes made to a case over time.",
    steps: [],
    related: ["version-history", "save-2d"],
  },

  // ------------------------------------------------------------- 3D viewer
  {
    id: "navigate-3d",
    title: "Move around the 3D model",
    page: "viewer_3d",
    selector: "#container3D",
    keywords: ["rotate", "zoom", "pan", "orbit", "move", "spin", "view", "3d", "camera", "navigate"],
    phrases: ["how do i rotate the model", "how do i zoom in", "how do i move the 3d view"],
    answer:
      "Drag to rotate the jaw, scroll to zoom, and drag with the right mouse button (or two fingers) to pan. On a touch screen, one finger rotates and a pinch zooms. The jaw preview in the 2D design works the same way — except while a survey is armed, when dragging aims the arrow and right-drag rotates.",
    steps: [
      "Drag on the model to rotate it.",
      "Scroll or pinch to zoom.",
      "Right-drag or two-finger drag to pan.",
    ],
    related: ["annotate-3d", "jaw-preview"],
  },
  {
    id: "open-3d-viewer",
    title: "Open the 3D Viewer",
    page: null,
    keywords: ["open", "3d", "viewer", "link", "qr", "launch", "standalone", "page", "show"],
    phrases: ["how do i open the 3d viewer", "where is the 3d viewer"],
    answer:
      "The 3D Viewer is its own page, opened from a case's 3D link or QR code on the case list. It needs no sign-in, so it is what you send to someone who only needs to look at the model.",
    steps: [
      "Select the case in the case list.",
      "Use the 3D link row in the detail panel — copy the link, open it, or show the QR code.",
    ],
    related: ["share-3d-link", "qr-code", "viewer-vs-preview"],
  },
  {
    id: "undercut-heatmap",
    title: "Read the undercut heatmap (jaw preview)",
    page: "annotation_2d",
    selector: ".jaw-preview-undercut-icon",
    keywords: ["undercut", "heatmap", "colour", "color", "legend", "map", "depth", "shading", "mm", "scale"],
    phrases: ["what do the colours mean", "what is the undercut heatmap", "how do i read the legend"],
    answer:
      "In the 3D jaw preview the icon at the top-left of the panel turns the undercut heatmap on and off, and the Undercut (mm) legend drops down beneath it while it's on. The shading is measured against that jaw's survey angle, so it changes whenever you re-survey.",
    steps: [
      "Open the case in the 2D design and look at the 3D jaw preview panel.",
      "Select the undercut icon at the top-left of the panel to turn the heatmap on.",
      "Read the depths against the Undercut (mm) legend below the icon.",
    ],
    related: ["survey-angle", "jaw-preview"],
  },
  {
    id: "survey-angle",
    title: "Set the survey angle",
    // The survey tool is part of the jaw preview inside the 2D design — NOT the
    // standalone 3D viewer, which has no surveying at all.
    page: "annotation_2d",
    selector: ".jaw-preview-survey-btn",
    keywords: ["survey", "angle", "insertion", "path", "tilt", "direction", "surveying", "arrow", "aim", "target"],
    phrases: [
      "how do i change the survey angle",
      "what is the path of insertion",
      "how do i survey the model",
      "how do i set the survey angle",
    ],
    answer:
      "Each jaw row in the 3D jaw preview has its own SET SURVEY ANGLE button. It arms that jaw, maximises the panel and shows a placement arrow you aim to choose the path of insertion; the undercut heatmap is then recalculated against it and stored on the case.",
    steps: [
      "Open the case in the 2D design and find the 3D jaw preview panel.",
      "Select SET SURVEY ANGLE on the upper or lower jaw row.",
      "Drag to swing the placement arrow, and right-drag to rotate the jaw itself.",
      "Press SET (the same button) to survey at that angle.",
      "Press CANCEL or Esc to back out and keep the previous angle.",
    ],
    related: ["undercut-heatmap", "jaw-preview", "viewer-vs-preview"],
  },
  {
    id: "jaw-preview",
    title: "The 3D jaw preview panel",
    page: "annotation_2d",
    selector: ".jaw-preview-shell",
    keywords: ["preview", "panel", "jaw", "3d", "model", "row", "upper", "lower", "mesh", "processing"],
    phrases: ["what is the jaw preview", "what is the 3d panel in the 2d design"],
    answer:
      "The panel beside the arches shows the case's jaws in 3D while you design. Each jaw has a row with an ALLOW PROCESSING toggle, an undercut heatmap, its own survey control, and — for a jaw with no scan yet — an upload button.",
    steps: [
      "Open the case in the 2D design; the preview sits in the left panel.",
      "Use the upper and lower rows to control each jaw independently.",
      "Maximise the panel when you need a closer look.",
    ],
    related: ["survey-angle", "undercut-heatmap", "preview-maximize", "preview-jaw-upload", "viewer-vs-preview"],
  },
  {
    id: "viewer-vs-preview",
    title: "3D jaw preview vs the 3D Viewer",
    page: null,
    keywords: ["difference", "viewer", "preview", "3d", "which", "same", "two", "versus", "vs"],
    phrases: [
      "what is the difference between the 3d viewer and the jaw preview",
      "are the 3d viewer and the preview the same",
    ],
    answer:
      "They are two different things. The 3D jaw preview is built into the 2D design and is where you work — surveying, the undercut heatmap, jaw upload and capture. The 3D Viewer is a separate page opened from a case's 3D link or QR code, meant for looking at and marking up the finished model; it has no surveying.",
    steps: [
      "Designing the case — use the 3D jaw preview inside the 2D design.",
      "Showing the case to someone — send the 3D link or QR code, which opens the 3D Viewer.",
    ],
    related: ["jaw-preview", "open-3d-viewer", "survey-angle", "share-3d-link"],
  },
  {
    id: "preview-maximize",
    title: "Maximise the jaw preview",
    page: "annotation_2d",
    selector: "#preview3dMaximizeBtn",
    keywords: ["maximize", "maximise", "expand", "bigger", "enlarge", "fullscreen", "restore", "panel"],
    phrases: ["how do i make the 3d panel bigger", "how do i maximize the preview"],
    answer:
      "The maximise button in the corner of the preview expands it to fill the workspace; the same button restores it. Arming a survey maximises the panel for you.",
    steps: ["Select the maximise button in the corner of the 3D preview.", "Select it again to restore the layout."],
    related: ["jaw-preview", "survey-angle", "preview-capture"],
  },
  {
    id: "preview-capture",
    title: "Capture the 3D view",
    page: "annotation_2d",
    selector: "#preview3dCaptureBtn",
    keywords: ["capture", "screenshot", "camera", "photo", "thumbnail", "snap", "picture"],
    phrases: ["how do i take a screenshot of the 3d model", "what does the camera button do"],
    answer:
      "The camera button renders the current 3D view and saves it as the case's thumbnail. To put a view on the Noticeboard instead, use the Noticeboard's own Add Viewcapture button.",
    steps: [
      "Position the jaws the way you want them shown.",
      "Select the camera button on the 3D preview.",
    ],
    related: ["jaw-preview", "noticeboard", "preview-maximize"],
  },
  {
    id: "preview-jaw-upload",
    title: "Upload a jaw from the preview",
    page: "annotation_2d",
    selector: ".jaw-preview-upload-btn",
    keywords: ["upload", "jaw", "stl", "3d", "file", "empty", "missing", "add", "scan", "row"],
    phrases: ["how do i upload a jaw in the 2d design", "the jaw is missing from the preview"],
    answer:
      "A jaw row with no scan yet shows an upload button — it stores the file as that jaw for the case. Once a jaw is loaded the row shows the survey and hide controls instead.",
    steps: [
      "Find the empty jaw's row in the 3D preview.",
      "Select the upload button on that row and pick the file.",
      "Wait for UPLOADING… to finish; the jaw then appears in the preview.",
    ],
    related: ["upload-jaw-scans", "jaw-preview", "mesh-quality", "extra-reference-stl"],
  },
  {
    id: "extra-reference-stl",
    title: "Upload extra reference 3D files",
    page: "annotation_2d",
    selector: "#previewTabExtras",
    keywords: ["extra", "reference", "3d", "file", "stl", "slot", "upload", "other", "additional", "tab"],
    phrases: [
      "how do i upload extra 3d files",
      "how do i add more stl files",
      "what is the extra 3d tab",
      "how many extra 3d files can i add",
    ],
    answer:
      "The Extra 3D tab above the preview panel adds STL files beyond the main upper and lower jaw — up to four slots per case. Opening the tab puts those files on the 3D stage, and each row's icon shows or hides its file.",
    steps: [
      "Open the Extra 3D tab above the preview panel.",
      "Choose a file for an open slot (up to 4 per case).",
      "Delete a slot's file first if all four are already in use.",
    ],
    related: ["upload-jaw-scans", "jaw-preview"],
  },
  {
    id: "mesh-quality",
    title: "Switch jaw quality (HD / SD)",
    page: "annotation_2d",
    selector: ".jaw-preview-quality-toggle",
    keywords: ["quality", "hd", "sd", "high", "low", "detail", "resolution", "slow", "performance", "mesh"],
    phrases: ["what is hd and sd", "how do i change the mesh quality", "the 3d preview is slow"],
    answer:
      "The HD/SD badge in the corner of the preview shows the quality the jaws are currently rendered at; selecting it re-renders at the other one. Drop to SD when the preview feels slow, and go back to HD for detail.",
    steps: ["Select the HD/SD badge in the corner of the 3D preview to flip between them."],
    related: ["jaw-preview", "preview-jaw-upload", "list-slow"],
  },
  {
    id: "annotate-3d",
    title: "Draw on the 3D view",
    page: "viewer_3d",
    selector: "#footerPenBtn",
    keywords: ["pen", "draw", "eraser", "annotate", "mark", "sketch", "undo", "redo", "line"],
    phrases: ["how do i draw on the model", "how do i annotate in 3d", "how do i erase my drawing"],
    answer:
      "The pen and eraser in the footer let you draw over the 3D view, with undo and redo beside them.",
    steps: [
      "Select the pen in the footer bar and draw on the model.",
      "Switch to the eraser to rub marks out.",
      "Use undo and redo to step back and forward.",
    ],
    related: ["navigate-3d", "clinical-notes-3d", "case-chat"],
  },
  {
    id: "clinical-notes-3d",
    title: "Clinical design notes in 3D",
    page: "viewer_3d",
    selector: "#footerNotesBtn",
    keywords: ["notes", "clinical", "design", "write", "comment", "3d"],
    phrases: ["where do i write notes in the 3d viewer"],
    answer: "The notes button in the footer opens the Clinical Design Notes box for the case.",
    steps: ["Select the notes button in the footer bar.", "Type your notes — they save with the case."],
    related: ["case-note", "case-chat", "annotate-3d"],
  },
  {
    id: "case-chat",
    title: "Case chat",
    page: null,
    selector: "#footerChatBtn",
    keywords: ["chat", "message", "talk", "discuss", "comment", "reply", "team", "colleague", "send"],
    phrases: ["how do i message someone about a case", "what is case chat", "how do i send a picture"],
    answer:
      "Case chat is the per-case conversation, opened by the chat button in the footer. You can send text and images — paste, drag or use the + button — and new messages arrive while the panel is open.",
    steps: [
      "Select the chat button in the footer bar.",
      "Type a comment, and attach an image with +, paste or drag-and-drop.",
      "Select Send.",
    ],
    related: ["notifications", "case-instructions", "clinical-notes-3d"],
  },

  // ------------------------------------------------------------------ admin
  {
    id: "admin-users",
    title: "Manage users",
    page: "admin_users",
    keywords: ["admin", "user", "management", "manage", "account", "add", "register", "permission", "role"],
    phrases: ["how do i add a user", "where is user management", "how do i register someone"],
    answer:
      "User Management is the administrator page for registering and maintaining accounts. It is only visible to administrators — the menu entry and header shortcut stay hidden otherwise.",
    steps: [
      "Open the footer menu and choose User Management (administrators only).",
      "Add, edit or remove accounts from there.",
    ],
    related: ["approve-signup", "admin-machine-ids", "user-access"],
  },
  {
    id: "approve-signup",
    title: "Approve a sign-up request",
    page: "admin_users",
    keywords: ["approve", "request", "signup", "sign", "pending", "new", "user", "invite", "accept"],
    phrases: ["how do i approve a new user", "someone requested an account"],
    answer:
      "Sign-up requests arrive by email to administrators — nothing is queued in the app, so there is no pending list to work through. To approve one, register that person in User Management; the system then emails them to set their password.",
    steps: [
      "Open the request email.",
      "In User Management, register the person with those details.",
      "They receive an email with a link to set their password.",
    ],
    related: ["admin-users", "request-account", "forgot-password"],
  },
  {
    id: "admin-machine-ids",
    title: "Manage machine IDs",
    page: "admin_machineid",
    keywords: ["machine", "id", "licence", "license", "device", "desktop", "register", "admin"],
    phrases: ["what is machine id management", "how do i add a machine id"],
    answer:
      "Machine ID Management is the administrator page for the machine identifiers that desktop installations register against.",
    steps: ["Open the footer menu and choose Machine ID Management (administrators only)."],
    related: ["admin-users"],
  },

  // -------------------------------------------------------- troubleshooting
  {
    id: "app-frozen",
    title: "The app won't load or feels frozen",
    page: null,
    keywords: ["frozen", "stuck", "hang", "unresponsive", "crash", "freeze", "not", "responding"],
    phrases: [
      "the page wont load",
      "the app is frozen",
      "nothing is happening",
      "the screen is stuck",
      "why is the app not responding",
    ],
    answer:
      "Start with a refresh — most stalls clear on a reload. If it stays stuck, check your connection, then sign out and back in. A case-list-specific slowdown has its own fix — see 'the case list is slow or empty'.",
    steps: [
      "Refresh the page.",
      "Check your internet connection.",
      "Sign out and back in if it's still stuck.",
    ],
    related: ["list-slow", "changes-not-saving", "report-a-problem"],
  },
  {
    id: "report-a-problem",
    title: "Report a bug or ask for help",
    page: null,
    selector: "#sidebarFeedbackBtn",
    reveal: APP_MENU,
    keywords: ["bug", "issue", "problem", "contact", "support", "feedback", "report", "broken", "escalate"],
    phrases: [
      "who do i contact for a bug",
      "how do i report a problem",
      "how do i give feedback",
      "how do i report an issue",
      "who do i ask for help",
    ],
    answer:
      "Feedback in the footer menu is the working channel right now — it opens a short form the team monitors.",
    steps: ["Open the menu in the footer bar.", "Select Feedback.", "Fill in the form — it opens in a new tab."],
    related: ["case-chat", "app-frozen"],
  },
  {
    id: "list-slow",
    title: "The case list is slow or empty",
    page: null,
    keywords: ["slow", "empty", "blank", "loading", "stuck", "spinner", "nothing", "missing", "wait", "hang"],
    phrases: ["the case list is empty", "why is it so slow", "nothing is loading"],
    answer:
      "Case details load as you scroll, so a long list fills in gradually. If it stalls, refresh the list first — the server slows down bursts of requests, and details resume shortly after.",
    steps: [
      "Select the refresh button in the header.",
      "Give it a few seconds and scroll again.",
      "If it is still empty, sign out and back in.",
    ],
    related: ["refresh-list", "images-missing", "changes-not-saving", "app-frozen"],
  },
  {
    id: "images-missing",
    title: "Images or thumbnails are not showing",
    page: null,
    keywords: ["image", "thumbnail", "preview", "broken", "missing", "blank", "photo", "not", "showing"],
    phrases: ["images are not loading", "thumbnails are blank", "no preview"],
    answer:
      "Thumbnails and chat images can be large and load after the rest of the page. If one never appears, refresh the list; if it is still blank, re-upload the image on the case.",
    steps: [
      "Wait a few seconds — images load after the case data.",
      "Refresh the case list.",
      "Re-upload the image if it stays blank.",
    ],
    related: ["reference-images", "list-slow", "refresh-list"],
  },
  {
    id: "changes-not-saving",
    title: "My changes did not save",
    page: null,
    keywords: ["save", "saving", "lost", "missing", "changes", "gone", "revert", "failed", "error"],
    phrases: ["my changes disappeared", "it did not save", "i lost my work"],
    answer:
      "The 2D design only persists when you Save from the footer menu — closing the tab loses unsaved work. Check the connection indicator in the footer, save again, and use Version History to see what was stored.",
    steps: [
      "Check the connection indicator in the footer bar.",
      "Open the footer menu and select Save; wait for the confirmation.",
      "Open Version History to confirm the version was written.",
    ],
    related: ["save-2d", "version-history", "list-slow"],
  },

  // ------------------------------------------------------------------- about
  {
    id: "about-ndcs",
    title: "About NDCS",
    page: null,
    keywords: ["ndcs", "national", "dental", "centre", "center", "singapore", "hospital", "singhealth"],
    phrases: [
      "what is ndcs",
      "what does ndcs stand for",
      "who is ndcs",
      "national dental centre singapore",
    ],
    answer:
      "NDCS stands for National Dental Centre Singapore — the country's flagship specialist dental centre, part of the SingHealth group, based at the Singapore General Hospital campus. Alongside patient care across specialties like restorative dentistry and oral surgery, it trains dental professionals and runs research through the National Dental Research Institute Singapore, which is where SmartRPD was developed.",
    steps: [],
    related: ["smartrpd-origins", "rpd-meaning"],
  },
  {
    id: "smartrpd-origins",
    title: "Where SmartRPD came from",
    page: null,
    keywords: [
      "smartrpd", "smart", "origin", "origins", "history", "developed", "invented",
      "created", "made", "astar", "temasek", "workflow",
    ],
    phrases: [
      "what is smartrpd",
      "where did smartrpd come from",
      "who made smartrpd",
      "who created smartrpd",
      "history of smartrpd",
      "how was smartrpd developed",
    ],
    answer:
      "SmartRPD is a digital denture workflow developed by NDCS, working with A*STAR's Institute of High Performance Computing since 2020, to design and 3D-print removable partial dentures. It replaces a manual process that left 20-30% of dentures needing rework with intra-oral scanning and automated design, cutting that error rate to around 3% and reducing the clinic visits a patient needs. Funding came from Temasek, Temasek Foundation, and the Ministry of Health's National Medical Research Council.",
    steps: [],
    related: ["about-ndcs", "rpd-meaning"],
  },
  {
    id: "rpd-meaning",
    title: "What RPD stands for",
    page: null,
    keywords: ["rpd", "stand", "meaning", "abbreviation", "acronym", "denture", "partial", "framework", "removable"],
    phrases: [
      "what does rpd stand for",
      "what is rpd",
      "what does rpd mean",
      "rpd full form",
      "rpd meaning",
      "what is a removable partial denture",
    ],
    answer:
      "RPD stands for removable partial denture — a dental appliance that replaces some missing teeth and that the patient can take in and out themselves, unlike a fixed bridge or implant. It's the type of device SmartRPD is built to design and manufacture.",
    steps: [],
    related: ["smartrpd-origins", "about-ndcs"],
  },
];

// id → topic, for `related` resolution.
export const TOPIC_BY_ID = new Map(HELP_TOPICS.map((t) => [t.id, t]));
