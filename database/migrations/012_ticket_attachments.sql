ALTER TABLE customer_files
  ADD COLUMN issue_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER customer_id,
  ADD KEY customer_files_issue_id_created_index (issue_id, created_at),
  ADD CONSTRAINT customer_files_issue_id_foreign
    FOREIGN KEY (issue_id) REFERENCES workflow_issues (id)
    ON DELETE CASCADE;
