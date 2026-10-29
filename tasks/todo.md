# Passwordless Read-Only Case Sharing

## Task 1: Define API contract and read allowlist

**Acceptance criteria:**
- [ ] Create/replace, revoke, status, and share-auth contracts are documented.
- [ ] Every viewer API call is classified as allowed read/download or forbidden mutation.
- [ ] Existing Unity request contracts remain unchanged.

**Verification:** Contract reviewed against frontend calls, backend routes, and controllers.

**Dependencies:** None  
**Estimated scope:** Small

## Task 2: Prepare and execute additive MySQL migration

**Acceptance criteria:**
- [ ] One active share credential can be represented per case.
- [ ] Only token hashes are stored.
- [ ] Expiry, revocation, creator, and audit timestamps are represented.

**Verification:** User runs supplied preflight, forward migration, and verification SQL.

**Dependencies:** Task 1  
**Estimated scope:** Small

## Task 3: Implement backend share-token model

**Acceptance criteria:**
- [ ] Token creation uses cryptographically secure randomness.
- [ ] Replacement atomically invalidates the previous token.
- [ ] Lookup validates hash, case, expiry, and revocation.

**Verification:** Focused model tests pass against a test database.

**Dependencies:** Task 2  
**Estimated scope:** Medium

## Task 4: Implement share-link management endpoints

**Acceptance criteria:**
- [ ] Only case owners/admins can create, replace, revoke, or inspect link status.
- [ ] Create/replace returns the raw token once.
- [ ] Errors use consistent 400/401/403/404 semantics.

**Verification:** Endpoint tests cover owner, admin, unrelated user, and anonymous requests.

**Dependencies:** Task 3  
**Estimated scope:** Medium

## Task 5: Add read-only share authorization

**Acceptance criteria:**
- [ ] Bearer tokens create a non-admin, case-scoped share principal.
- [ ] Only allowlisted viewer reads/downloads accept it.
- [ ] Cross-case and all write requests are rejected.

**Verification:** Authorization matrix tests pass; existing desktop/Unity smoke requests remain valid.

**Dependencies:** Tasks 3-4  
**Estimated scope:** Medium

## Checkpoint: Backend security boundary

- [ ] Valid, expired, revoked, replaced, malformed, and cross-case tokens tested.
- [ ] All viewer mutation endpoints tested as denied.
- [ ] Existing API behavior regression-checked.

## Task 6: Replace frontend link generation

**Acceptance criteria:**
- [ ] Copy Link and QR actions request one active seven-day link.
- [ ] Replacement behavior is clear to the owner/admin.
- [ ] Tokens are placed in URL fragments, not query strings.

**Verification:** Frontend unit tests verify URL and replacement behavior.

**Dependencies:** Task 4  
**Estimated scope:** Medium

## Task 7: Add shared viewer mode

**Acceptance criteria:**
- [ ] Viewer reads the fragment token and sends it only to the configured API origin.
- [ ] View/download operations work without login.
- [ ] Mutation controls are unavailable and mutation API calls remain blocked server-side.

**Verification:** Unit tests plus manual desktop/mobile browser check.

**Dependencies:** Tasks 5-6  
**Estimated scope:** Medium

## Task 8: Implement seven-day legacy cutoff

**Acceptance criteria:**
- [ ] Cutoff is configured as an exact UTC deployment setting.
- [ ] Old links receive a migration warning during the window.
- [ ] Anonymous old links fail closed after the cutoff.

**Verification:** Automated tests exercise times before, at, and after the cutoff.

**Dependencies:** Task 7  
**Estimated scope:** Small

## Task 9: Remove exposed credentials and harden delivery

**Acceptance criteria:**
- [ ] Browser code no longer contains shared login credentials or anonymous UUID fallback.
- [ ] Exposed credentials are rotated before history cleanup.
- [ ] Secret scanning prevents recurrence.

**Verification:** Repository/history secret scan and production smoke test pass.

**Dependencies:** Task 8  
**Estimated scope:** Medium

## Checkpoint: Release readiness

- [ ] Frontend tests and production build pass.
- [ ] Backend authorization tests pass.
- [ ] Manual database verification passes.
- [ ] Desktop/Unity compatibility smoke test passes.
- [ ] Share create, view, download, replace, revoke, expire, and legacy-cutoff flows pass.

