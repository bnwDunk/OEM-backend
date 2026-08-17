SET @workflow_stages_template_index_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'workflow_stages'
    AND INDEX_NAME = 'workflow_stages_template_id_index'
);
SET @add_workflow_stages_template_index = IF(
  @workflow_stages_template_index_exists = 0,
  'ALTER TABLE workflow_stages ADD INDEX workflow_stages_template_id_index (template_id)',
  'SELECT 1'
);
PREPARE add_workflow_stages_template_index_stmt FROM @add_workflow_stages_template_index;
EXECUTE add_workflow_stages_template_index_stmt;
DEALLOCATE PREPARE add_workflow_stages_template_index_stmt;

SET @workflow_stages_sort_index_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'workflow_stages'
    AND INDEX_NAME = 'workflow_stages_template_sort_unique'
);
SET @drop_workflow_stages_sort_index = IF(
  @workflow_stages_sort_index_exists > 0,
  'ALTER TABLE workflow_stages DROP INDEX workflow_stages_template_sort_unique',
  'SELECT 1'
);
PREPARE drop_workflow_stages_sort_index_stmt FROM @drop_workflow_stages_sort_index;
EXECUTE drop_workflow_stages_sort_index_stmt;
DEALLOCATE PREPARE drop_workflow_stages_sort_index_stmt;

SET @workflow_stage_due_days_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'workflow_stages'
    AND COLUMN_NAME = 'due_days'
);
SET @drop_workflow_stage_due_days = IF(
  @workflow_stage_due_days_exists > 0,
  'ALTER TABLE workflow_stages DROP COLUMN due_days',
  'SELECT 1'
);
PREPARE drop_workflow_stage_due_days_stmt FROM @drop_workflow_stage_due_days;
EXECUTE drop_workflow_stage_due_days_stmt;
DEALLOCATE PREPARE drop_workflow_stage_due_days_stmt;

SET @workflow_stage_sort_order_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'workflow_stages'
    AND COLUMN_NAME = 'sort_order'
);
SET @drop_workflow_stage_sort_order = IF(
  @workflow_stage_sort_order_exists > 0,
  'ALTER TABLE workflow_stages DROP COLUMN sort_order',
  'SELECT 1'
);
PREPARE drop_workflow_stage_sort_order_stmt FROM @drop_workflow_stage_sort_order;
EXECUTE drop_workflow_stage_sort_order_stmt;
DEALLOCATE PREPARE drop_workflow_stage_sort_order_stmt;
