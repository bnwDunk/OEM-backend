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

    if (await addColumnIfMissing(connection, 'customer_tags', 'color', 'color VARCHAR(30) NULL DEFAULT NULL AFTER name')) {
      changes.push('customer_tags.color')
    }

    if (await addColumnIfMissing(connection, 'customer_tags', 'is_active', 'is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER color')) {
      changes.push('customer_tags.is_active')
    }

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
