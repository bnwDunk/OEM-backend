USE oem_app;

SET @workflow_template_status_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'workflow_templates'
    AND COLUMN_NAME = 'status'
);

SET @add_workflow_template_status = IF(
  @workflow_template_status_exists = 0,
  'ALTER TABLE workflow_templates ADD COLUMN status ENUM(''active'', ''draft'', ''inactive'') NOT NULL DEFAULT ''active'' AFTER version',
  'SELECT 1'
);

PREPARE add_workflow_template_status_stmt FROM @add_workflow_template_status;
EXECUTE add_workflow_template_status_stmt;
DEALLOCATE PREPARE add_workflow_template_status_stmt;

UPDATE workflow_templates
SET status = CASE WHEN is_active = 1 THEN 'active' ELSE 'inactive' END;
