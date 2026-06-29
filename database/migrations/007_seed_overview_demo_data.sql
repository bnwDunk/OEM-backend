USE oem_app;

INSERT INTO workflow_stages (template_id, name, sort_order)
VALUES
  ((SELECT id FROM workflow_templates WHERE code = 'OEM_FLOW' ORDER BY version DESC LIMIT 1), 'รับบรีฟ & ปิดดีล', 10),
  ((SELECT id FROM workflow_templates WHERE code = 'OEM_FLOW' ORDER BY version DESC LIMIT 1), 'เตรียมการผลิต', 20),
  ((SELECT id FROM workflow_templates WHERE code = 'OEM_FLOW' ORDER BY version DESC LIMIT 1), 'รับเข้าคลัง & ตรวจสอบ', 30),
  ((SELECT id FROM workflow_templates WHERE code = 'OEM_FLOW' ORDER BY version DESC LIMIT 1), 'เดินไลน์ผลิต & แบ่งบรรจุ', 40),
  ((SELECT id FROM workflow_templates WHERE code = 'OEM_FLOW' ORDER BY version DESC LIMIT 1), 'ส่งมอบสินค้า', 50)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO workflow_phases (stage_id, label, name, global_order, sort_order)
VALUES
  ((SELECT id FROM workflow_stages WHERE sort_order = 10 AND template_id = (SELECT id FROM workflow_templates WHERE code = 'OEM_FLOW' ORDER BY version DESC LIMIT 1) LIMIT 1), '1', 'คุยบรีฟ & หาลูกค้าใหม่', 1, 10),
  ((SELECT id FROM workflow_stages WHERE sort_order = 10 AND template_id = (SELECT id FROM workflow_templates WHERE code = 'OEM_FLOW' ORDER BY version DESC LIMIT 1) LIMIT 1), '2', 'ขึ้นสูตรตัวอย่าง + อนุมัติราคาเบื้องต้น', 2, 20),
  ((SELECT id FROM workflow_stages WHERE sort_order = 10 AND template_id = (SELECT id FROM workflow_templates WHERE code = 'OEM_FLOW' ORDER BY version DESC LIMIT 1) LIMIT 1), '3', 'คำนวณต้นทุนแต่ละด้าน', 3, 30),
  ((SELECT id FROM workflow_stages WHERE sort_order = 10 AND template_id = (SELECT id FROM workflow_templates WHERE code = 'OEM_FLOW' ORDER BY version DESC LIMIT 1) LIMIT 1), '3.1', 'รวมต้นทุนทั้งหมด', 4, 40),
  ((SELECT id FROM workflow_stages WHERE sort_order = 10 AND template_id = (SELECT id FROM workflow_templates WHERE code = 'OEM_FLOW' ORDER BY version DESC LIMIT 1) LIMIT 1), '4', 'CEO อนุมัติราคาขายจริง', 5, 50),
  ((SELECT id FROM workflow_stages WHERE sort_order = 10 AND template_id = (SELECT id FROM workflow_templates WHERE code = 'OEM_FLOW' ORDER BY version DESC LIMIT 1) LIMIT 1), '5', 'ทำสัญญา', 6, 60),
  ((SELECT id FROM workflow_stages WHERE sort_order = 10 AND template_id = (SELECT id FROM workflow_templates WHERE code = 'OEM_FLOW' ORDER BY version DESC LIMIT 1) LIMIT 1), '6', 'รับมัดจำ', 7, 70),
  ((SELECT id FROM workflow_stages WHERE sort_order = 20 AND template_id = (SELECT id FROM workflow_templates WHERE code = 'OEM_FLOW' ORDER BY version DESC LIMIT 1) LIMIT 1), '1', 'เปิดใบสั่งผลิต', 8, 10),
  ((SELECT id FROM workflow_stages WHERE sort_order = 20 AND template_id = (SELECT id FROM workflow_templates WHERE code = 'OEM_FLOW' ORDER BY version DESC LIMIT 1) LIMIT 1), '2', 'ขอเลข อย. + ออกแบบฉลาก', 9, 20)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  global_order = VALUES(global_order);

INSERT INTO customers (slug, name, cost_syrup, cost_package, price, volume, status)
VALUES
  ('siam-foods', 'บริษัท สยามฟู้ดส์ จำกัด', 21.00, 4.00, 44.86, 2600, 'brief_spec'),
  ('green-plus', 'Green Plus Lab', 18.50, 6.20, 58.00, 8000, 'brief_spec')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  cost_syrup = VALUES(cost_syrup),
  cost_package = VALUES(cost_package),
  price = VALUES(price),
  volume = VALUES(volume),
  status = VALUES(status);

INSERT INTO customer_workflows (customer_id, template_id, current_phase_id, status)
VALUES
  (
    (SELECT id FROM customers WHERE slug = 'siam-foods'),
    (SELECT id FROM workflow_templates WHERE code = 'OEM_FLOW' ORDER BY version DESC LIMIT 1),
    (SELECT id FROM workflow_phases WHERE global_order = 3 LIMIT 1),
    'active'
  ),
  (
    (SELECT id FROM customers WHERE slug = 'green-plus'),
    (SELECT id FROM workflow_templates WHERE code = 'OEM_FLOW' ORDER BY version DESC LIMIT 1),
    (SELECT id FROM workflow_phases WHERE global_order = 9 LIMIT 1),
    'active'
  )
ON DUPLICATE KEY UPDATE
  current_phase_id = VALUES(current_phase_id),
  status = VALUES(status);

INSERT INTO workflow_notifications (customer_id, phase_id, department_id, message, created_at)
SELECT customers.id, workflow_phases.id, departments.id, 'ฝ่าย R&D ทำงานเสร็จแล้ว - ส่งตัวอย่าง + ราคาเบื้องต้นให้ลูกค้า', DATE_SUB(NOW(), INTERVAL 2 HOUR)
FROM customers
JOIN workflow_phases ON workflow_phases.global_order = 2
LEFT JOIN departments ON departments.code = 'RD'
WHERE customers.slug = 'siam-foods'
  AND NOT EXISTS (
    SELECT 1 FROM workflow_notifications
    WHERE customer_id = customers.id
      AND message = 'ฝ่าย R&D ทำงานเสร็จแล้ว - ส่งตัวอย่าง + ราคาเบื้องต้นให้ลูกค้า'
  );

INSERT INTO workflow_notifications (customer_id, phase_id, department_id, message, created_at)
SELECT customers.id, workflow_phases.id, departments.id, 'Sales เปิดใบสั่งผลิตแล้ว - ส่งต่อ R&D + Marketing', DATE_SUB(NOW(), INTERVAL 30 MINUTE)
FROM customers
JOIN workflow_phases ON workflow_phases.global_order = 8
LEFT JOIN departments ON departments.code = 'SALES'
WHERE customers.slug = 'green-plus'
  AND NOT EXISTS (
    SELECT 1 FROM workflow_notifications
    WHERE customer_id = customers.id
      AND message = 'Sales เปิดใบสั่งผลิตแล้ว - ส่งต่อ R&D + Marketing'
  );

INSERT INTO workflow_issues (
  customer_id,
  phase_id,
  opened_by_name,
  opened_by_department_id,
  target_department_id,
  message,
  status,
  created_at
)
SELECT
  customers.id,
  workflow_phases.id,
  'ปอย',
  opened_departments.id,
  target_departments.id,
  'ขอราคา packaging แบบขวด PET เพิ่มอีก 1 option',
  'open',
  DATE_SUB(NOW(), INTERVAL 1 HOUR)
FROM customers
JOIN workflow_phases ON workflow_phases.global_order = 3
JOIN departments AS opened_departments ON opened_departments.code = 'SALES'
JOIN departments AS target_departments ON target_departments.code = 'PURCHASE'
WHERE customers.slug = 'siam-foods'
  AND NOT EXISTS (
    SELECT 1 FROM workflow_issues
    WHERE customer_id = customers.id
      AND message = 'ขอราคา packaging แบบขวด PET เพิ่มอีก 1 option'
  );
