SET @workflow_stage_due_days_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'workflow_stages'
    AND COLUMN_NAME = 'due_days'
);

SET @add_workflow_stage_due_days = IF(
  @workflow_stage_due_days_exists = 0,
  'ALTER TABLE workflow_stages ADD COLUMN due_days INT UNSIGNED NULL DEFAULT NULL AFTER name',
  'SELECT 1'
);

PREPARE add_workflow_stage_due_days_stmt FROM @add_workflow_stage_due_days;
EXECUTE add_workflow_stage_due_days_stmt;
DEALLOCATE PREPARE add_workflow_stage_due_days_stmt;
