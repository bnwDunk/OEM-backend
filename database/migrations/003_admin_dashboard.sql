USE oem_app;

SET @users_role_index_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND INDEX_NAME = 'users_role_index'
);

SET @add_users_role_index = IF(
  @users_role_index_exists = 0,
  'ALTER TABLE users ADD INDEX users_role_index (role)',
  'SELECT 1'
);

PREPARE add_users_role_index_stmt FROM @add_users_role_index;
EXECUTE add_users_role_index_stmt;
DEALLOCATE PREPARE add_users_role_index_stmt;

SET @users_is_active_index_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND INDEX_NAME = 'users_is_active_index'
);

SET @add_users_is_active_index = IF(
  @users_is_active_index_exists = 0,
  'ALTER TABLE users ADD INDEX users_is_active_index (is_active)',
  'SELECT 1'
);

PREPARE add_users_is_active_index_stmt FROM @add_users_is_active_index;
EXECUTE add_users_is_active_index_stmt;
DEALLOCATE PREPARE add_users_is_active_index_stmt;

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id BIGINT UNSIGNED NULL DEFAULT NULL,
  action VARCHAR(80) NOT NULL,
  entity_type ENUM('user', 'department', 'role', 'system') NOT NULL,
  entity_id BIGINT UNSIGNED NULL DEFAULT NULL,
  before_data JSON NULL DEFAULT NULL,
  after_data JSON NULL DEFAULT NULL,
  ip_address VARCHAR(45) NULL DEFAULT NULL,
  user_agent VARCHAR(255) NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY admin_audit_logs_actor_user_id_index (actor_user_id),
  KEY admin_audit_logs_entity_index (entity_type, entity_id),
  KEY admin_audit_logs_created_at_index (created_at),
  CONSTRAINT admin_audit_logs_actor_user_id_foreign
    FOREIGN KEY (actor_user_id) REFERENCES users (id)
    ON DELETE SET NULL
);

UPDATE users
SET role = 'admin',
    department_id = (SELECT id FROM departments WHERE code = 'ADMIN' LIMIT 1)
WHERE email = 'admin@oem.local';
