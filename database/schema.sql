CREATE DATABASE IF NOT EXISTS oem_app
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE oem_app;

CREATE TABLE IF NOT EXISTS departments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(255) NULL DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY departments_code_unique (code),
  UNIQUE KEY departments_name_unique (name)
);

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  department_id BIGINT UNSIGNED NULL DEFAULT NULL,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'user',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY users_email_unique (email),
  KEY users_department_id_index (department_id),
  KEY users_role_index (role),
  KEY users_is_active_index (is_active),
  CONSTRAINT users_department_id_foreign
    FOREIGN KEY (department_id) REFERENCES departments (id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  revoked_at DATETIME NULL DEFAULT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY oauth_refresh_tokens_token_hash_unique (token_hash),
  KEY oauth_refresh_tokens_user_id_index (user_id),
  CONSTRAINT oauth_refresh_tokens_user_id_foreign
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_departments (
  user_id BIGINT UNSIGNED NOT NULL,
  department_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, department_id),
  KEY user_departments_department_id_index (department_id),
  CONSTRAINT user_departments_user_id_foreign
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE,
  CONSTRAINT user_departments_department_id_foreign
    FOREIGN KEY (department_id) REFERENCES departments (id)
    ON DELETE CASCADE
);

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

CREATE TABLE IF NOT EXISTS customer_tags (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  color VARCHAR(30) NULL DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY customer_tags_name_unique (name)
);

CREATE TABLE IF NOT EXISTS customers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_code VARCHAR(20) NULL DEFAULT NULL,
  slug VARCHAR(100) NOT NULL,
  name VARCHAR(190) NOT NULL,
  cost_syrup DECIMAL(12,2) NULL DEFAULT NULL,
  cost_package DECIMAL(12,2) NULL DEFAULT NULL,
  price DECIMAL(12,2) NULL DEFAULT NULL,
  volume DECIMAL(12,2) NULL DEFAULT NULL,
  due_date DATE NULL DEFAULT NULL,
  salesperson VARCHAR(190) NULL DEFAULT NULL,
  status VARCHAR(80) NOT NULL DEFAULT 'brief_spec',
  created_by BIGINT UNSIGNED NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY customers_customer_code_unique (customer_code),
  UNIQUE KEY customers_slug_unique (slug),
  KEY customers_status_index (status),
  KEY customers_created_by_index (created_by),
  CONSTRAINT customers_created_by_foreign
    FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS customer_statuses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  value VARCHAR(80) NOT NULL,
  label VARCHAR(190) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY customer_statuses_value_unique (value),
  KEY customer_statuses_active_sort_index (is_active, sort_order)
);

INSERT INTO customer_statuses (value, label, sort_order)
VALUES
  ('brief_spec', 'รับโจทย์/สรุปสเปค', 10),
  ('sampling', 'ส่งตัวอย่าง (Sampling)', 20),
  ('sample_revision', 'ส่งตัวอย่าง (แก้ไข)', 30),
  ('follow_up_formula', 'ติดตามผล/ปรับสูตร', 40),
  ('quote_negotiation', 'เสนอราคา & เจรจา', 50),
  ('success', 'สำเร็จ (Success)', 60),
  ('cancel', 'ยกเลิก (Cancel)', 70)
ON DUPLICATE KEY UPDATE
  label = VALUES(label),
  sort_order = VALUES(sort_order),
  is_active = 1;

CREATE TABLE IF NOT EXISTS customer_code_settings (
  id TINYINT UNSIGNED NOT NULL,
  fixed_prefix VARCHAR(20) NOT NULL DEFAULT 'OEM',
  date_pattern VARCHAR(20) NOT NULL DEFAULT 'YYMM',
  suffix_length TINYINT UNSIGNED NOT NULL DEFAULT 4,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

INSERT INTO customer_code_settings (id, fixed_prefix, date_pattern, suffix_length)
VALUES (1, 'OEM', 'YYMM', 4)
ON DUPLICATE KEY UPDATE id = id;

CREATE TABLE IF NOT EXISTS customer_tag_assignments (
  customer_id BIGINT UNSIGNED NOT NULL,
  tag_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (customer_id, tag_id),
  CONSTRAINT customer_tag_assignments_customer_id_foreign
    FOREIGN KEY (customer_id) REFERENCES customers (id)
    ON DELETE CASCADE,
  CONSTRAINT customer_tag_assignments_tag_id_foreign
    FOREIGN KEY (tag_id) REFERENCES customer_tags (id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workflow_templates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  parent_template_id BIGINT UNSIGNED NULL DEFAULT NULL,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(120) NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  status ENUM('active', 'draft', 'inactive') NOT NULL DEFAULT 'active',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY workflow_templates_code_version_unique (code, version),
  KEY workflow_templates_parent_template_id_index (parent_template_id),
  CONSTRAINT workflow_templates_parent_template_id_foreign
    FOREIGN KEY (parent_template_id) REFERENCES workflow_templates (id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS workflow_stages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  template_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(190) NOT NULL,
  sort_order INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY workflow_stages_template_sort_unique (template_id, sort_order),
  CONSTRAINT workflow_stages_template_id_foreign
    FOREIGN KEY (template_id) REFERENCES workflow_templates (id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workflow_phases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  stage_id BIGINT UNSIGNED NOT NULL,
  label VARCHAR(20) NOT NULL,
  name VARCHAR(190) NOT NULL,
  global_order INT UNSIGNED NOT NULL,
  sort_order INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY workflow_phases_stage_sort_unique (stage_id, sort_order),
  UNIQUE KEY workflow_phases_stage_label_unique (stage_id, label),
  KEY workflow_phases_global_order_index (global_order),
  CONSTRAINT workflow_phases_stage_id_foreign
    FOREIGN KEY (stage_id) REFERENCES workflow_stages (id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workflow_phase_branches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  phase_id BIGINT UNSIGNED NOT NULL,
  department_id BIGINT UNSIGNED NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY workflow_phase_branches_phase_dept_unique (phase_id, department_id),
  KEY workflow_phase_branches_department_id_index (department_id),
  CONSTRAINT workflow_phase_branches_phase_id_foreign
    FOREIGN KEY (phase_id) REFERENCES workflow_phases (id)
    ON DELETE CASCADE,
  CONSTRAINT workflow_phase_branches_department_id_foreign
    FOREIGN KEY (department_id) REFERENCES departments (id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS workflow_checklist_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  branch_id BIGINT UNSIGNED NOT NULL,
  label VARCHAR(255) NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  is_required TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY workflow_checklist_items_branch_sort_unique (branch_id, sort_order),
  CONSTRAINT workflow_checklist_items_branch_id_foreign
    FOREIGN KEY (branch_id) REFERENCES workflow_phase_branches (id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_workflows (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  template_id BIGINT UNSIGNED NOT NULL,
  current_phase_id BIGINT UNSIGNED NULL DEFAULT NULL,
  status ENUM('active', 'completed', 'paused', 'cancelled') NOT NULL DEFAULT 'active',
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY customer_workflows_customer_template_unique (customer_id, template_id),
  KEY customer_workflows_current_phase_id_index (current_phase_id),
  CONSTRAINT customer_workflows_customer_id_foreign
    FOREIGN KEY (customer_id) REFERENCES customers (id)
    ON DELETE CASCADE,
  CONSTRAINT customer_workflows_template_id_foreign
    FOREIGN KEY (template_id) REFERENCES workflow_templates (id)
    ON DELETE RESTRICT,
  CONSTRAINT customer_workflows_current_phase_id_foreign
    FOREIGN KEY (current_phase_id) REFERENCES workflow_phases (id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS customer_phase_states (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_workflow_id BIGINT UNSIGNED NOT NULL,
  phase_id BIGINT UNSIGNED NOT NULL,
  status ENUM('locked', 'active', 'done', 'reset') NOT NULL DEFAULT 'locked',
  reset_mode ENUM('all', 'single') NULL DEFAULT NULL,
  reset_by_department_id BIGINT UNSIGNED NULL DEFAULT NULL,
  reset_by_user_id BIGINT UNSIGNED NULL DEFAULT NULL,
  reset_at DATETIME NULL DEFAULT NULL,
  completed_at DATETIME NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY customer_phase_states_workflow_phase_unique (customer_workflow_id, phase_id),
  KEY customer_phase_states_phase_id_index (phase_id),
  KEY customer_phase_states_status_index (status),
  CONSTRAINT customer_phase_states_customer_workflow_id_foreign
    FOREIGN KEY (customer_workflow_id) REFERENCES customer_workflows (id)
    ON DELETE CASCADE,
  CONSTRAINT customer_phase_states_phase_id_foreign
    FOREIGN KEY (phase_id) REFERENCES workflow_phases (id)
    ON DELETE CASCADE,
  CONSTRAINT customer_phase_states_reset_by_department_id_foreign
    FOREIGN KEY (reset_by_department_id) REFERENCES departments (id)
    ON DELETE SET NULL,
  CONSTRAINT customer_phase_states_reset_by_user_id_foreign
    FOREIGN KEY (reset_by_user_id) REFERENCES users (id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS customer_branch_states (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_phase_state_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NOT NULL,
  status ENUM('waiting', 'active', 'done') NOT NULL DEFAULT 'waiting',
  saved_at DATETIME NULL DEFAULT NULL,
  completed_by_user_id BIGINT UNSIGNED NULL DEFAULT NULL,
  completed_at DATETIME NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY customer_branch_states_phase_branch_unique (customer_phase_state_id, branch_id),
  KEY customer_branch_states_branch_id_index (branch_id),
  KEY customer_branch_states_status_index (status),
  CONSTRAINT customer_branch_states_customer_phase_state_id_foreign
    FOREIGN KEY (customer_phase_state_id) REFERENCES customer_phase_states (id)
    ON DELETE CASCADE,
  CONSTRAINT customer_branch_states_branch_id_foreign
    FOREIGN KEY (branch_id) REFERENCES workflow_phase_branches (id)
    ON DELETE CASCADE,
  CONSTRAINT customer_branch_states_completed_by_user_id_foreign
    FOREIGN KEY (completed_by_user_id) REFERENCES users (id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS customer_checklist_states (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_branch_state_id BIGINT UNSIGNED NOT NULL,
  checklist_item_id BIGINT UNSIGNED NOT NULL,
  live_checked TINYINT(1) NOT NULL DEFAULT 0,
  saved_checked TINYINT(1) NOT NULL DEFAULT 0,
  checked_by_user_id BIGINT UNSIGNED NULL DEFAULT NULL,
  checked_at DATETIME NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY customer_checklist_states_branch_item_unique (customer_branch_state_id, checklist_item_id),
  CONSTRAINT customer_checklist_states_customer_branch_state_id_foreign
    FOREIGN KEY (customer_branch_state_id) REFERENCES customer_branch_states (id)
    ON DELETE CASCADE,
  CONSTRAINT customer_checklist_states_checklist_item_id_foreign
    FOREIGN KEY (checklist_item_id) REFERENCES workflow_checklist_items (id)
    ON DELETE CASCADE,
  CONSTRAINT customer_checklist_states_checked_by_user_id_foreign
    FOREIGN KEY (checked_by_user_id) REFERENCES users (id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS workflow_issues (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  phase_id BIGINT UNSIGNED NULL DEFAULT NULL,
  opened_by_user_id BIGINT UNSIGNED NULL DEFAULT NULL,
  opened_by_name VARCHAR(120) NOT NULL,
  opened_by_department_id BIGINT UNSIGNED NOT NULL,
  target_department_id BIGINT UNSIGNED NOT NULL,
  message TEXT NOT NULL,
  status ENUM('open', 'closed') NOT NULL DEFAULT 'open',
  closed_by_user_id BIGINT UNSIGNED NULL DEFAULT NULL,
  closed_by_department_id BIGINT UNSIGNED NULL DEFAULT NULL,
  closed_at DATETIME NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY workflow_issues_customer_id_index (customer_id),
  KEY workflow_issues_status_index (status),
  KEY workflow_issues_target_department_id_index (target_department_id),
  CONSTRAINT workflow_issues_customer_id_foreign
    FOREIGN KEY (customer_id) REFERENCES customers (id)
    ON DELETE CASCADE,
  CONSTRAINT workflow_issues_phase_id_foreign
    FOREIGN KEY (phase_id) REFERENCES workflow_phases (id)
    ON DELETE SET NULL,
  CONSTRAINT workflow_issues_opened_by_user_id_foreign
    FOREIGN KEY (opened_by_user_id) REFERENCES users (id)
    ON DELETE SET NULL,
  CONSTRAINT workflow_issues_opened_by_department_id_foreign
    FOREIGN KEY (opened_by_department_id) REFERENCES departments (id)
    ON DELETE RESTRICT,
  CONSTRAINT workflow_issues_target_department_id_foreign
    FOREIGN KEY (target_department_id) REFERENCES departments (id)
    ON DELETE RESTRICT,
  CONSTRAINT workflow_issues_closed_by_user_id_foreign
    FOREIGN KEY (closed_by_user_id) REFERENCES users (id)
    ON DELETE SET NULL,
  CONSTRAINT workflow_issues_closed_by_department_id_foreign
    FOREIGN KEY (closed_by_department_id) REFERENCES departments (id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS workflow_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  phase_id BIGINT UNSIGNED NULL DEFAULT NULL,
  department_id BIGINT UNSIGNED NULL DEFAULT NULL,
  actor_user_id BIGINT UNSIGNED NULL DEFAULT NULL,
  message TEXT NOT NULL,
  read_at DATETIME NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY workflow_notifications_customer_id_index (customer_id),
  KEY workflow_notifications_department_id_index (department_id),
  KEY workflow_notifications_created_at_index (created_at),
  CONSTRAINT workflow_notifications_customer_id_foreign
    FOREIGN KEY (customer_id) REFERENCES customers (id)
    ON DELETE CASCADE,
  CONSTRAINT workflow_notifications_phase_id_foreign
    FOREIGN KEY (phase_id) REFERENCES workflow_phases (id)
    ON DELETE SET NULL,
  CONSTRAINT workflow_notifications_department_id_foreign
    FOREIGN KEY (department_id) REFERENCES departments (id)
    ON DELETE SET NULL,
  CONSTRAINT workflow_notifications_actor_user_id_foreign
    FOREIGN KEY (actor_user_id) REFERENCES users (id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS workflow_activity_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  phase_id BIGINT UNSIGNED NULL DEFAULT NULL,
  actor_user_id BIGINT UNSIGNED NULL DEFAULT NULL,
  actor_department_id BIGINT UNSIGNED NULL DEFAULT NULL,
  action VARCHAR(80) NOT NULL,
  message TEXT NOT NULL,
  metadata JSON NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY workflow_activity_logs_customer_id_index (customer_id),
  KEY workflow_activity_logs_created_at_index (created_at),
  CONSTRAINT workflow_activity_logs_customer_id_foreign
    FOREIGN KEY (customer_id) REFERENCES customers (id)
    ON DELETE CASCADE,
  CONSTRAINT workflow_activity_logs_phase_id_foreign
    FOREIGN KEY (phase_id) REFERENCES workflow_phases (id)
    ON DELETE SET NULL,
  CONSTRAINT workflow_activity_logs_actor_user_id_foreign
    FOREIGN KEY (actor_user_id) REFERENCES users (id)
    ON DELETE SET NULL,
  CONSTRAINT workflow_activity_logs_actor_department_id_foreign
    FOREIGN KEY (actor_department_id) REFERENCES departments (id)
    ON DELETE SET NULL
);

INSERT INTO departments (code, name, sort_order)
VALUES
  ('SALES', 'Sales', 10),
  ('MARKETING', 'Marketing', 20),
  ('RD', 'R&D', 30),
  ('CEO', 'CEO', 40),
  ('PURCHASE', 'Purchase', 50),
  ('PRODUCTION_PLAN', 'Production plan', 60),
  ('ACCOUNTING', 'Accounting', 70),
  ('QA', 'QA', 80),
  ('QC', 'QC', 90),
  ('WAREHOUSE', 'Warehouse', 100),
  ('ADMIN', 'Admin', 110),
  ('PRODUCTION', 'Production', 120)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  sort_order = VALUES(sort_order);

INSERT INTO workflow_templates (code, name, version)
VALUES ('OEM_FLOW', 'OEM Flow', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- Demo user:
-- email: admin@oem.local
-- password: password123
INSERT INTO users (department_id, name, email, password_hash, role)
VALUES (
  (SELECT id FROM departments WHERE code = 'ADMIN' LIMIT 1),
  'OEM Admin',
  'admin@oem.local',
  '$2b$10$dEQ6nqoz2rTQhwYKTEFPO.u5HxxXe2cAqc4/fE508eSPCIXd9PxyC',
  'admin'
)
ON DUPLICATE KEY UPDATE
  role = 'admin',
  department_id = COALESCE(department_id, (SELECT id FROM departments WHERE code = 'ADMIN' LIMIT 1)),
  is_active = 1;

INSERT IGNORE INTO user_departments (user_id, department_id)
VALUES (
  (SELECT id FROM users WHERE email = 'admin@oem.local' LIMIT 1),
  (SELECT id FROM departments WHERE code = 'ADMIN' LIMIT 1)
);

-- Demo standard user:
-- email: user@oem.local
-- password: password123
INSERT INTO users (department_id, name, email, password_hash, role)
VALUES (
  (SELECT id FROM departments WHERE code = 'SALES' LIMIT 1),
  'OEM User',
  'user@oem.local',
  '$2b$10$dEQ6nqoz2rTQhwYKTEFPO.u5HxxXe2cAqc4/fE508eSPCIXd9PxyC',
  'user'
)
ON DUPLICATE KEY UPDATE email = email;

INSERT IGNORE INTO user_departments (user_id, department_id)
VALUES (
  (SELECT id FROM users WHERE email = 'user@oem.local' LIMIT 1),
  (SELECT id FROM departments WHERE code = 'SALES' LIMIT 1)
);
