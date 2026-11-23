# Administrator user monitoring

## Delivered scope

The Admin Users page has two tabs. User Overview shows last successful login,
last API contact, an inclusive timestamp range in Asia/Singapore, login-state
filtering and account management. User Activity provides a separate, full-width
paginated timeline of actions performed by a selected user across cases, with
its own user selector and refresh control. Registration-date filtering remains
separate. Select Last API contact or Last successful login as the timestamp type.
Timestamp and login-state controls are under More filters; communication usage
and recency remain visible. The result count shows the number matching all filters
out of the full loaded user directory, including zero results. Compact overview
cards and a minimum 300px scrolling result list preserve usable browsing space;
on short windows the main pane can scroll to accommodate expanded filters.
Opening a user fetches fresh communication details for that UUID, including the
raw logged-out flag and a derived login state. Reporting endpoints require a current administrator login and reject
bearer/share credentials and disabled administrators.

Use View user activity in the overview detail panel to open the Activity tab
with that user selected. Opening overview details does not fetch case activity.
Activity requests start only when the Activity view is used, and late results
from another selection/view are ignored. Overview filters are preserved across
tab changes. An activity failure stays in the Activity view; it does not disable
communication filtering. Both tabs support keyboard navigation. This view split
uses the existing APIs and requires only a frontend deployment, with no additional
SQL or API changes.

## Meaning of last communication

### Existing-user usage classification

Communication usage is calculated solely from the retained `last_communication`
timestamp, independent of last successful login, logged-out flags, case activity,
and account enabled/deactivated status. The default threshold is 30 elapsed days;
administrators can choose 7, 30, 60, or 90 days and filter by:

- Recently active: last communication at or after the selected cutoff.
- Inactive: last communication before the selected cutoff.
- Unknown: missing, invalid, zero/epoch, or future communication timestamp.

The directory shows the status and time since last contact. The selected-user
detail shows the same classification using its fresh communication snapshot.
Changing the threshold updates the classification without writing anything to
the database. Refresh users reloads the directory snapshot. Existing account
status is labeled Enabled/Deactivated to distinguish it from usage recency.

This works for existing users without adding historical records or a new schema.
If `users.last_login_at_utc` has not been added, the reporting model retries the
read with NULL for last login while still returning legacy communication data.
Only a missing last-login column activates that fallback; unrelated DB failures
still return an unavailable error. The login migration and activity table are
not prerequisites for last-communication classification. They are required only
for the other optional features that use them.

The existing API reads `last_communications.id` as the user UUID,
`last_communication` as Unix seconds, and `logged_out` as a login-state flag.
Login replaces this user's row. Supported API calls update its timestamp; logout
also updates it. The existing write sets the timestamp field to zero and relies
on database behavior to populate the time. Inspect the real table/default/trigger
using the migration preflight; this repository does not contain its DDL.

This is the latest contact retained for an account, not a contact history,
per-device session, case modification date, or proof of human interaction.
Not every API route updates the field. The report converts positive Unix seconds
to ISO UTC; missing or zero values display as Not recorded. Last-contact date
filtering compares SGT date/time, includes the entire selected end minute, supports one-sided
ranges, and excludes unknown dates when either bound is set. An inverted range
shows validation feedback and no results. Filtering is over the latest contact:
it cannot answer whether a user made any contact during an earlier period.

The new reporting reads do not update communication time or extend sessions.
The account Enabled label does not indicate online presence.

Login-state options are Logged out (`logged_out = 1`), Within login timeout
(`logged_out = 0` with a timestamp within the existing configured timeout), Login
timed out (`logged_out = 0` outside that timeout), and Not recorded (missing
contact/flag data). These are snapshots at report load time, not live presence.
The table's flag/state snapshot refreshes through Refresh users. The detail view
fetches a fresh snapshot on selection. Account enabled/deactivated status is
independent. The legacy row does not store a contact type or API route, so these
filters do not infer whether the latest contact was login, logout or a case call.

## Backend changes

In the adjacent `smartrpd-api` repository:

- `models/userMonitoring.model.js`: parameterized administrator verification,
  cursor-paginated contact/login rows and actor-scoped case-event queries.
- `routes/userMonitoring.routes.js`: new POST endpoints below.
- `server.js`: registers the additional routes.
- `models/user.model.js`: records UTC login time after existing successful login
  checks, with the original response and request contracts preserved.
- `tests/user-monitoring.test.js`: reporting, authorization and compatibility tests.

`POST /api/smartrpd/user/monitoring/getall`

```json
[{"machine_id":"existing-machine","uuid":"calling-admin"},{"after":""}]
```

Returns `{ users: [{ uuid, lastLoginAt, lastContactAt, loggedOut, loginState }], nextCursor }` in pages
of 100. The admin page loads these pages to enrich the existing user directory,
preserving its existing statistics and account-management routes.

`POST /api/smartrpd/user/monitoring/get`

```json
[{"machine_id":"existing-machine","uuid":"calling-admin"},{"targetUserUuid":"selected-user"}]
```

Returns `{ user }` with the same reporting fields, or `{ user: null }` if the
account no longer exists. It uses the same administrator checks as the directory
endpoint and a parameterized target UUID. It does not update the selected user's
last communication. No additional migration is needed for these fields.

`POST /api/smartrpd/user/activity/get`

```json
[{"machine_id":"existing-machine","uuid":"calling-admin"},{"targetUserUuid":"selected-user","before":null}]
```

Returns `{ events, nextCursor }`, newest event ID first, 50 per page. Cursors
are bound to the selected actor. BIGINT event and case IDs remain strings.
No clinical/message/model payload is returned; event details are allowlisted.
Browser reports retain their source/outcome labels. Anonymous share events are
excluded from user attribution. Missing case rows do not erase historical events.

## Compatibility and limits

- No duplicate activity table, case migration, or session redesign.
- Existing web/Unity login and logout requests and responses are unchanged.
- Existing successful login still succeeds if the reporting timestamp update
  fails, including when the new column is not yet present. One process-level
  warning identifies the unavailable tracking. Such logins cannot be backfilled.
- Older users start with a NULL last login until they log in successfully after
  rollout. Display Not recorded, not Never logged in.
- Older cases remain usable. Their timeline contains only events captured since
  activity tracking began and only for instrumented operations.
- If reporting is not deployed, account management still loads, monitoring shows
  Unavailable and last-contact inputs are disabled. An authorization rejection
  hides the administrator panel instead of presenting stale monitoring data.
- Authorization uses the existing UUID/machine/login-state system; this feature
  does not introduce stronger session credentials or device-specific attribution.

## Rollout and verification

1. Back up the target schema and select the correct database. Inspect the preflight
   in `user-monitoring.sql`, especially the legacy timestamp trigger/default.
2. Run its additive ALTER and CREATE INDEX once using the migration account. Do
   not repeat DDL if the column/index already exists. Existing case-activity table
   deployment is a prerequisite. Ensure the API account can update the new users
   column and SELECT the reporting tables.
3. Deploy/restart the changed API, then deploy the web changes. No production SQL
   or deployment was executed by this implementation task.
4. On a test schema, log in through both web and Unity, confirm the original
   response shapes, inspect the UTC timestamp, and confirm failed login leaves
   it unchanged. Open/save an older case from each client. Verify communication
   still updates under the existing timeout rules.
5. Check administrator and non-administrator API calls, a share credential, a
   deactivated administrator, an older user with no events, and timeline paging.
   Use EXPLAIN on the actor query to verify the new index is used.

Local verification commands:

```powershell
npm test -- --runInBand
npm run build
node __tests__/userMonitoring.browser.cjs
node --test C:/Users/Admin/Documents/GitHub/smartrpd-api/tests/*.test.js
```

The browser test uses local source files and mocked API responses in an isolated
headless Chrome profile; it sends no requests to production. It covers SGT range
filtering to the inclusive end minute, timestamp-type and login-state filters,
the selected-user fetch and timeline, mobile rendering, and API-unavailable
fallback. Production database trigger semantics and real Unity runtime behavior
must still be verified in the deployment environment.

Rollback: redeploy the previous API/web versions and leave the additive nullable
column/index in place. Reporting has no changes to undo in cases or sessions.
