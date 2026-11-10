-- Select the SmartRPD database in MySQL Workbench before running.
-- Additive schema for the proposed Case Activity feature.
SELECT DATABASE() AS target_schema;
SHOW COLUMNS FROM cases LIKE 'id';

CREATE TABLE case_activity_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  case_int_id BIGINT UNSIGNED NOT NULL,
  actor_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_uuid VARCHAR(255) NULL,
  action_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_source VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  outcome VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  details JSON NULL,
  occurred_at_utc DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_case_activity_operation (case_int_id, operation_id, action_code),
  KEY ix_case_activity_timeline (case_int_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SHOW CREATE TABLE case_activity_events;
