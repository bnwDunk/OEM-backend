USE oem_app;

INSERT INTO users (department_id, name, email, password_hash, role)
VALUES (
  (SELECT id FROM departments WHERE code = 'SALES' LIMIT 1),
  'OEM User',
  'user@oem.local',
  '$2b$10$dEQ6nqoz2rTQhwYKTEFPO.u5HxxXe2cAqc4/fE508eSPCIXd9PxyC',
  'user'
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  role = VALUES(role);
