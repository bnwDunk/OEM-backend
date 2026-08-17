CREATE TABLE IF NOT EXISTS customer_stage_due_dates (
  customer_workflow_id BIGINT UNSIGNED NOT NULL,
  stage_id BIGINT UNSIGNED NOT NULL,
  due_date DATE NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (customer_workflow_id, stage_id),
  KEY customer_stage_due_dates_stage_id_index (stage_id),
  KEY customer_stage_due_dates_due_date_index (due_date),
  CONSTRAINT customer_stage_due_dates_workflow_id_foreign
    FOREIGN KEY (customer_workflow_id) REFERENCES customer_workflows (id)
    ON DELETE CASCADE,
  CONSTRAINT customer_stage_due_dates_stage_id_foreign
    FOREIGN KEY (stage_id) REFERENCES workflow_stages (id)
    ON DELETE CASCADE
);

INSERT IGNORE INTO customer_stage_due_dates (customer_workflow_id, stage_id, due_date)
SELECT customer_workflows.id, workflow_phases.stage_id, customers.due_date
FROM customer_workflows
INNER JOIN customers ON customers.id = customer_workflows.customer_id
INNER JOIN workflow_phases ON workflow_phases.id = customer_workflows.current_phase_id
WHERE customer_workflows.status = 'active'
  AND customers.due_date IS NOT NULL;
