USE oem_app;

SET @department_sort_order_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'departments'
    AND COLUMN_NAME = 'sort_order'
);

SET @add_department_sort_order = IF(
  @department_sort_order_exists = 0,
  'ALTER TABLE departments ADD COLUMN sort_order INT UNSIGNED NOT NULL DEFAULT 0 AFTER is_active',
  'SELECT 1'
);

PREPARE add_department_sort_order_stmt FROM @add_department_sort_order;
EXECUTE add_department_sort_order_stmt;
DEALLOCATE PREPARE add_department_sort_order_stmt;

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
  slug VARCHAR(100) NOT NULL,
  name VARCHAR(190) NOT NULL,
  cost_syrup DECIMAL(12,2) NULL DEFAULT NULL,
  cost_package DECIMAL(12,2) NULL DEFAULT NULL,
  price DECIMAL(12,2) NULL DEFAULT NULL,
  volume DECIMAL(12,2) NULL DEFAULT NULL,
  status ENUM('active', 'completed', 'paused', 'cancelled') NOT NULL DEFAULT 'active',
  created_by BIGINT UNSIGNED NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY customers_slug_unique (slug),
  KEY customers_status_index (status),
  KEY customers_created_by_index (created_by),
  CONSTRAINT customers_created_by_foreign
    FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL
);

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
  code VARCHAR(50) NOT NULL,
  name VARCHAR(120) NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY workflow_templates_code_version_unique (code, version)
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

INSERT INTO customer_tags (name)
VALUES
  ('น้ำเชื่อมใส'),
  ('Zero Sugar'),
  ('อาหารเสริม'),
  ('แบ่งบรรจุ'),
  ('น้ำหวานแต่งกลิ่น')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO workflow_templates (code, name, version)
VALUES ('OEM_FLOW', 'OEM Flow', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);
