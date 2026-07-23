const dotenv = require('dotenv')
const mysql = require('mysql2/promise')

dotenv.config()

async function columnExists(connection, tableName, columnName) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName],
  )

  return Number(rows[0].count) > 0
}

async function addColumnIfMissing(connection, tableName, columnName, definition) {
  if (await columnExists(connection, tableName, columnName)) return false

  await connection.query(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`)
  return true
}

async function indexExists(connection, tableName, indexName) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS count
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?`,
    [tableName, indexName],
  )

  return Number(rows[0].count) > 0
}

function makeCustomerCodePrefix(value) {
  const date = value ? new Date(value) : new Date()
  const validDate = Number.isNaN(date.getTime()) ? new Date() : date
  const year = String(validDate.getFullYear()).slice(-2)
  const month = String(validDate.getMonth() + 1).padStart(2, '0')

  return `OEM${year}${month}`
}

async function backfillCustomerCodes(connection) {
  const [existingRows] = await connection.execute(
    `SELECT customer_code
     FROM customers
     WHERE customer_code REGEXP '^OEM[0-9]{8}$'`,
  )
  const nextNumbers = new Map()

  for (const row of existingRows) {
    const code = String(row.customer_code || '')
    const prefix = code.slice(0, 7)
    const suffix = Number(code.slice(7))
    if (!Number.isFinite(suffix)) continue
    nextNumbers.set(prefix, Math.max(nextNumbers.get(prefix) || 0, suffix))
  }

  const [missingRows] = await connection.execute(
    `SELECT id, created_at
     FROM customers
     WHERE customer_code IS NULL
        OR customer_code = ''
     ORDER BY created_at ASC, id ASC`,
  )

  for (const row of missingRows) {
    const prefix = makeCustomerCodePrefix(row.created_at)
    const nextNumber = (nextNumbers.get(prefix) || 0) + 1
    nextNumbers.set(prefix, nextNumber)
    await connection.execute(
      'UPDATE customers SET customer_code = ? WHERE id = ?',
      [`${prefix}${String(nextNumber).padStart(4, '0')}`, row.id],
    )
  }

  return missingRows.length
}

async function ensureProductionSchema() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'oem_app',
  })

  try {
    const changes = []
    const customerStatuses = [
      ['brief_spec', 'รับโจทย์/สรุปสเปค', 10],
      ['sampling', 'ส่งตัวอย่าง (Sampling)', 20],
      ['sample_revision', 'ส่งตัวอย่าง (แก้ไข)', 30],
      ['follow_up_formula', 'ติดตามผล/ปรับสูตร', 40],
      ['quote_negotiation', 'เสนอราคา & เจรจา', 50],
      ['success', 'สำเร็จ (Success)', 60],
      ['cancel', 'ยกเลิก (Cancel)', 70],
    ]
    await connection.query(
      `CREATE TABLE IF NOT EXISTS user_departments (
        user_id BIGINT UNSIGNED NOT NULL,
        department_id BIGINT UNSIGNED NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, department_id),
        KEY user_departments_department_id_index (department_id),
        CONSTRAINT user_departments_user_id_foreign
          FOREIGN KEY (user_id) REFERENCES users (id)
          ON DELETE CASCADE,
        CONSTRAINT user_departments_department_id_foreign
          FOREIGN KEY (department_id) REFERENCES departments (id)
          ON DELETE CASCADE
      )`,
    )

    await connection.execute(
      `INSERT IGNORE INTO user_departments (user_id, department_id)
       SELECT id, department_id
       FROM users
       WHERE department_id IS NOT NULL`,
    )

    await connection.execute(
      `UPDATE users
       SET role = 'admin',
           department_id = COALESCE(department_id, (SELECT id FROM departments WHERE code = 'ADMIN' LIMIT 1)),
           is_active = 1
       WHERE email = 'admin@oem.local'`,
    )

    await connection.execute(
      `INSERT IGNORE INTO user_departments (user_id, department_id)
       SELECT users.id, users.department_id
       FROM users
       WHERE users.email = 'admin@oem.local'
         AND users.department_id IS NOT NULL`,
    )

    if (await addColumnIfMissing(connection, 'customer_tags', 'color', 'color VARCHAR(30) NULL DEFAULT NULL AFTER name')) {
      changes.push('customer_tags.color')
    }

    if (await addColumnIfMissing(connection, 'customer_tags', 'is_active', 'is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER color')) {
      changes.push('customer_tags.is_active')
    }

    if (await addColumnIfMissing(connection, 'customers', 'due_date', 'due_date DATE NULL DEFAULT NULL AFTER volume')) {
      changes.push('customers.due_date')
    }

    if (await addColumnIfMissing(connection, 'customers', 'customer_code', 'customer_code VARCHAR(20) NULL DEFAULT NULL AFTER id')) {
      changes.push('customers.customer_code')
    }

    const backfilledCustomerCodes = await backfillCustomerCodes(connection)
    if (backfilledCustomerCodes) {
      changes.push(`customers.customer_code backfilled (${backfilledCustomerCodes})`)
    }

    if (!(await indexExists(connection, 'customers', 'customers_customer_code_unique'))) {
      await connection.query('ALTER TABLE customers ADD UNIQUE KEY customers_customer_code_unique (customer_code)')
      changes.push('customers.customer_code unique index')
    }

    await connection.query(
      `CREATE TABLE IF NOT EXISTS customer_code_settings (
        id TINYINT UNSIGNED NOT NULL,
        fixed_prefix VARCHAR(20) NOT NULL DEFAULT 'OEM',
        date_pattern VARCHAR(20) NOT NULL DEFAULT 'YYMM',
        suffix_length TINYINT UNSIGNED NOT NULL DEFAULT 4,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      )`,
    )

    await connection.execute(
      `INSERT INTO customer_code_settings (id, fixed_prefix, date_pattern, suffix_length)
       VALUES (1, 'OEM', 'YYMM', 4)
       ON DUPLICATE KEY UPDATE id = id`,
    )

    if (await addColumnIfMissing(connection, 'customers', 'salesperson', 'salesperson VARCHAR(190) NULL DEFAULT NULL AFTER due_date')) {
      changes.push('customers.salesperson')
    }

    await connection.query(
      `CREATE TABLE IF NOT EXISTS customer_statuses (
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
      )`,
    )

    for (const [value, label, sortOrder] of customerStatuses) {
      await connection.execute(
        `INSERT INTO customer_statuses (value, label, sort_order)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           label = VALUES(label),
           sort_order = VALUES(sort_order),
           is_active = 1`,
        [value, label, sortOrder],
      )
    }

    await connection.query('ALTER TABLE customers MODIFY COLUMN status VARCHAR(80) NOT NULL DEFAULT \'brief_spec\'')

    await connection.execute(
      `UPDATE customers
       SET status = CASE status
         WHEN 'completed' THEN 'success'
         WHEN 'active' THEN 'brief_spec'
         WHEN 'paused' THEN 'follow_up_formula'
         WHEN 'cancelled' THEN 'cancel'
         ELSE status
       END`,
    )

    changes.push('customers.statuses')

    if (await addColumnIfMissing(connection, 'workflow_templates', 'parent_template_id', 'parent_template_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER id')) {
      changes.push('workflow_templates.parent_template_id')
    }

    if (await addColumnIfMissing(connection, 'workflow_templates', 'status', "status ENUM('active', 'draft', 'inactive') NOT NULL DEFAULT 'active' AFTER version")) {
      changes.push('workflow_templates.status')
    }

    await connection.execute(
      `UPDATE workflow_templates
       SET status = CASE WHEN is_active = 1 THEN 'active' ELSE 'inactive' END
       WHERE status IS NULL`,
    )

    console.log(changes.length ? `Applied schema updates: ${changes.join(', ')}` : 'Production schema is up to date.')
  } finally {
    await connection.end()
  }
}

ensureProductionSchema().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
