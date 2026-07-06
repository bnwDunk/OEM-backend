USE oem_app;

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

ALTER TABLE customers
  MODIFY COLUMN status VARCHAR(80) NOT NULL DEFAULT 'brief_spec';

UPDATE customers
SET status = CASE status
  WHEN 'completed' THEN 'success'
  WHEN 'active' THEN 'brief_spec'
  WHEN 'paused' THEN 'follow_up_formula'
  WHEN 'cancelled' THEN 'cancel'
  ELSE status
END;
