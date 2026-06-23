USE oem_app;

SET @workflow_template_parent_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'workflow_templates'
    AND COLUMN_NAME = 'parent_template_id'
);

SET @add_workflow_template_parent = IF(
  @workflow_template_parent_exists = 0,
  'ALTER TABLE workflow_templates ADD COLUMN parent_template_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER id',
  'SELECT 1'
);

PREPARE add_workflow_template_parent_stmt FROM @add_workflow_template_parent;
EXECUTE add_workflow_template_parent_stmt;
DEALLOCATE PREPARE add_workflow_template_parent_stmt;

SET @workflow_template_parent_index_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'workflow_templates'
    AND INDEX_NAME = 'workflow_templates_parent_template_id_index'
);

SET @add_workflow_template_parent_index = IF(
  @workflow_template_parent_index_exists = 0,
  'ALTER TABLE workflow_templates ADD INDEX workflow_templates_parent_template_id_index (parent_template_id)',
  'SELECT 1'
);

PREPARE add_workflow_template_parent_index_stmt FROM @add_workflow_template_parent_index;
EXECUTE add_workflow_template_parent_index_stmt;
DEALLOCATE PREPARE add_workflow_template_parent_index_stmt;

SET @workflow_template_parent_fk_exists = (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'workflow_templates'
    AND CONSTRAINT_NAME = 'workflow_templates_parent_template_id_foreign'
);

SET @add_workflow_template_parent_fk = IF(
  @workflow_template_parent_fk_exists = 0,
  'ALTER TABLE workflow_templates ADD CONSTRAINT workflow_templates_parent_template_id_foreign FOREIGN KEY (parent_template_id) REFERENCES workflow_templates (id) ON DELETE SET NULL',
  'SELECT 1'
);

PREPARE add_workflow_template_parent_fk_stmt FROM @add_workflow_template_parent_fk;
EXECUTE add_workflow_template_parent_fk_stmt;
DEALLOCATE PREPARE add_workflow_template_parent_fk_stmt;
