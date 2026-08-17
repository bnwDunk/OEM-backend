CREATE TABLE IF NOT EXISTS stage_due_email_reminders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_workflow_id BIGINT UNSIGNED NOT NULL,
  stage_id BIGINT UNSIGNED NOT NULL,
  phase_id BIGINT UNSIGNED NULL DEFAULT NULL,
  due_date DATE NOT NULL,
  sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY stage_due_email_reminders_unique (customer_workflow_id, stage_id, due_date),
  KEY stage_due_email_reminders_stage_id_index (stage_id),
  KEY stage_due_email_reminders_phase_id_index (phase_id),
  CONSTRAINT stage_due_email_reminders_workflow_id_foreign
    FOREIGN KEY (customer_workflow_id) REFERENCES customer_workflows (id)
    ON DELETE CASCADE,
  CONSTRAINT stage_due_email_reminders_stage_id_foreign
    FOREIGN KEY (stage_id) REFERENCES workflow_stages (id)
    ON DELETE CASCADE,
  CONSTRAINT stage_due_email_reminders_phase_id_foreign
    FOREIGN KEY (phase_id) REFERENCES workflow_phases (id)
    ON DELETE SET NULL
);
