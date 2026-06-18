CREATE DATABASE IF NOT EXISTS oem_app
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE oem_app;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'user',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY users_email_unique (email)
);

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  revoked_at TIMESTAMP NULL DEFAULT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY oauth_refresh_tokens_token_hash_unique (token_hash),
  KEY oauth_refresh_tokens_user_id_index (user_id),
  CONSTRAINT oauth_refresh_tokens_user_id_foreign
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE
);

-- Demo user:
-- email: admin@oem.local
-- password: password123
INSERT INTO users (name, email, password_hash, role)
VALUES (
  'OEM Admin',
  'admin@oem.local',
  '$2b$10$dEQ6nqoz2rTQhwYKTEFPO.u5HxxXe2cAqc4/fE508eSPCIXd9PxyC',
  'admin'
)
ON DUPLICATE KEY UPDATE email = email;
