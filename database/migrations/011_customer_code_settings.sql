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
