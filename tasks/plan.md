# Implementation Plan: Passwordless Read-Only Case Sharing

## Overview

Replace the browser-shipped administrator credentials with one active, revocable, seven-day share token per case. A share token authorizes only read-only 3D model viewing and downloads for its case. Existing desktop/Unity authentication and machine-ID behavior remain unchanged. Legacy encrypted-ID viewer links remain available through an explicit seven-day migration cutoff, then anonymous legacy access is rejected.

## Confirmed Scope

- Shared viewers do not log in.
- Shared viewers may view and download one case.
- Shared viewers may not create, update, upload, annotate, save, or delete data.
- Only a case owner or administrator may create, replace, or revoke a share link.
- Each case has at most one active share link.
- Links expire seven days after issuance.
- Replacing a link immediately revokes the old link.
- Existing web and Unity API request bodies remain accepted.
- Machine-ID checks and desktop authentication are not redesigned.
- The user will execute database statements manually from supplied runbooks.

## Architecture Decisions

### Share credential

- Generate a cryptographically random 32-byte token with Node's built-in `crypto` module.
- Return the raw token only once, when creating/replacing a link.
- Store only a SHA-256 token hash in MySQL.
- Bind the row to one `case_int_id`, an expiry, revocation state, creator, and audit timestamps.
- Send the raw token in the URL fragment (`#share=...`) so it is not included in normal HTTP requests, access logs, or referrer headers.

### Cross-site browser compatibility

The production viewer is hosted on `ndcs-smartrpd.github.io`, while the API is hosted on `live.api.smartrpdai.com`. Cross-site HttpOnly cookies are not reliable where third-party cookies are blocked. For the current topology:

- The viewer reads the raw share token from the URL fragment.
- It sends the token in `Authorization: Bearer <token>` only to the allowlisted API origin.
- It may retain the token in `sessionStorage` for reloads in the same tab, then clears it when the tab/session ends.
- It never writes the token to logs, local storage, analytics, error messages, or request bodies.
- Moving the frontend to a `smartrpdai.com` custom domain later enables an HttpOnly same-site exchange-cookie improvement without changing token semantics.

### Authorization compatibility

- Existing request body element 0 (`machine_id`, `uuid`, `caseIntID`) remains structurally unchanged for desktop/Unity compatibility.
- The API first checks for a valid share bearer token.
- A valid share token creates a server-side authorization result with `principal_type: "share"`, `caseIntID`, and `can_read: true`; it never sets `is_admin`.
- Only explicitly allowlisted read endpoints accept a share principal.
- All existing user/admin authentication paths continue to use the current authentication functions.
- Write endpoints reject share principals even if a client manipulates the UI or request body.

### Migration

- Add an environment variable such as `LEGACY_SHARED_VIEWER_UNTIL` containing an exact UTC timestamp.
- During the seven-day window, old encrypted-ID links may use the existing viewer behavior, with a visible deprecation warning and telemetry.
- After the cutoff, an anonymous `?id=` link displays an expired-link message and cannot use embedded credentials.
- Authenticated users may continue opening cases normally.
- The hardcoded admin credentials and fallback viewer UUID are removed after the replacement flow is verified.

## Dependency Graph

```text
Manual additive MySQL schema
    -> share-token model
        -> share authorization middleware/helper
            -> create/revoke/status endpoints
            -> read-only viewer endpoint allowlist
                -> frontend share-link creation
                -> frontend viewer bearer-token client
                    -> legacy cutoff and credential removal
```

## Task List

### Phase 1: Contract and database foundation

1. Define the exact share API contract and viewer read-endpoint allowlist.
2. Supply additive MySQL migration, verification queries, and rollback SQL.
3. Add backend share-token model with hashed lookup, expiry, revocation, and atomic replacement.

### Checkpoint: Foundation

- Schema verification queries pass.
- Raw tokens are never persisted.
- Concurrent replacement cannot leave two active tokens for one case.

### Phase 2: Secure backend vertical slice

4. Add owner/admin create-or-replace, revoke, and status endpoints.
5. Add bearer-token parsing and share-principal authorization.
6. Enable only the required read/download endpoints for share principals.
7. Add backend tests for scope, expiry, revocation, case mismatch, and write rejection.

### Checkpoint: Backend

- A valid token reads only its case.
- Expired, revoked, replaced, malformed, and cross-case tokens fail.
- Every write endpoint fails for a share token.
- Existing desktop/Unity requests remain unchanged.

### Phase 3: Frontend vertical slice

8. Replace Copy Link/QR generation with the create-or-replace share endpoint for owners/admins.
9. Add viewer share-token bootstrap and centralized Authorization header handling.
10. Hide or disable write-only viewer controls in shared mode while retaining view/download controls.
11. Add tests for URL construction, token handling, API headers, errors, and shared-mode UI.

### Checkpoint: End-to-end

- A generated URL opens the correct case without login.
- View and download work on desktop and mobile browsers.
- Editing requests are rejected server-side.
- Replacing or revoking a link invalidates the old URL immediately.

### Phase 4: Legacy migration and cleanup

12. Add the seven-day legacy cutoff, warning, and usage logging.
13. Remove `LOGIN_CREDENTIALS`, the anonymous `VIEWER_UUID` fallback, and viewer auto-login after the cutoff path is ready.
14. Rotate exposed credentials and remove tracked secret artifacts; purge Git history only after rotation.
15. Add CI secret scanning and deployment/runbook documentation.

### Checkpoint: Completion

- No production credential is present in browser code or tracked auxiliary files.
- Legacy anonymous links stop at the configured cutoff.
- Normal web login and desktop/Unity flows still work.
- Frontend tests/build and new backend tests pass.

## Database Delivery Format

Database work will be supplied as four manual artifacts:

1. Preflight queries: server version, table engine, collation, existing constraints, and conflicting objects.
2. Forward migration: additive table/index creation only.
3. Verification queries: schema shape, uniqueness, expiry/revocation behavior, and safe sample checks.
4. Rollback: drop only the newly introduced objects, with a backup/export warning before execution.

No production credentials or real case data are required.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Share token is forwarded | Unauthorized case viewing | Seven-day expiry, one active link, immediate revocation, hashed storage |
| Cross-site cookies are blocked | Viewer cannot authenticate | Bearer token from URL fragment for current GitHub Pages topology |
| Token leaks through application logs | Share compromise | Never log headers/fragments; redact Authorization centrally |
| Existing controller assumes admin to select case ID | Cross-case access or broad privilege | Share principal supplies the server-validated case ID and never `is_admin` |
| Viewer invokes write endpoints | Anonymous mutation | Backend deny-by-default; UI hiding is convenience only |
| Legacy path remains enabled accidentally | Old vulnerability persists | Exact UTC cutoff, fail-closed parsing, deployment verification after cutoff |
| Shared API changes break Unity | Desktop outage | Additive routes/auth branch; preserve existing request and response contracts |

## Required Access and Inputs

- Writable access to `C:\Users\user\Documents\GitHub\smartrpd-api`, or a writable worktree/copy of it attached to this task.
- Confirmation of the dev API base URL and a non-production test database for integration verification, if available.
- The production deployment timestamp when scheduling the seven-day legacy cutoff; it should be configuration, not hardcoded during development.
- Manual execution of the supplied database migration and return of its verification-query output with sensitive values redacted.

## Out of Scope

- Machine-ID redesign or removal.
- Desktop/Unity authentication changes.
- Normal user login/session redesign.
- Anonymous edits, annotations, uploads, saves, or case-management operations.
- A multi-link management interface.

