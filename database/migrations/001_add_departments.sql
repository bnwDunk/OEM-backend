USE oem_app;

CREATE TABLE IF NOT EXISTS departments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(255) NULL DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY departments_code_unique (code),
  UNIQUE KEY departments_name_unique (name)
);

INSERT INTO departments (code, name, description)
VALUES
  ('ADMIN', 'Administration', 'System administration and user management'),
  ('OEM', 'OEM Operations', 'OEM workflow operations'),
  ('QA', 'Quality Assurance', 'Quality review and approval')
ON DUPLICATE KEY UPDATE name = VALUES(name);

SET @column_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'department_id'
);

SET @add_department_column = IF(
  @column_exists = 0,
  'ALTER TABLE users ADD COLUMN department_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER id',
  'SELECT 1'
);

PREPARE add_department_column_stmt FROM @add_department_column;
EXECUTE add_department_column_stmt;
DEALLOCATE PREPARE add_department_column_stmt;

SET @index_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND INDEX_NAME = 'users_department_id_index'
);

SET @add_department_index = IF(
  @index_exists = 0,
  'ALTER TABLE users ADD INDEX users_department_id_index (department_id)',
  'SELECT 1'
);

PREPARE add_department_index_stmt FROM @add_department_index;
EXECUTE add_department_index_stmt;
DEALLOCATE PREPARE add_department_index_stmt;

SET @constraint_exists = (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND CONSTRAINT_NAME = 'users_department_id_foreign'
);

SET @add_department_fk = IF(
  @constraint_exists = 0,
  'ALTER TABLE users ADD CONSTRAINT users_department_id_foreign FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE SET NULL',
  'SELECT 1'
);

PREPARE add_department_fk_stmt FROM @add_department_fk;
EXECUTE add_department_fk_stmt;
DEALLOCATE PREPARE add_department_fk_stmt;

UPDATE users
SET department_id = (SELECT id FROM departments WHERE code = 'ADMIN' LIMIT 1)
WHERE email = 'admin@oem.local'
  AND department_id IS NULL;
