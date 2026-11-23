-- Run once using the migration account, before enabling the reporting API.
-- Confirm the selected schema and preserve the results of these preflight checks.
SELECT DATABASE() AS target_schema;
SHOW CREATE TABLE last_communications;
SHOW COLUMNS FROM users LIKE 'last_login_at_utc';
SHOW INDEX FROM case_activity_events;

-- Additive: no case data, login-state rows or Unity contracts are changed.
-- Existing users intentionally remain NULL until their next successful login.
ALTER TABLE users ADD COLUMN last_login_at_utc DATETIME(6) NULL;
CREATE INDEX ix_case_activity_actor ON case_activity_events (actor_uuid, id);

-- last_communication is interpreted by the API as Unix seconds. Verify the
-- existing database trigger/default that populates it before enabling reports.
SELECT id, last_communication, logged_out FROM last_communications LIMIT 5;
SHOW TRIGGERS LIKE 'last_communications';
SHOW COLUMNS FROM users LIKE 'last_login_at_utc';
SHOW INDEX FROM case_activity_events;
