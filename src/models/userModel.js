const pool = require('../config/db')

function mapUser(row) {
  if (!row) return null

  return {
    id: row.id,
    departmentId: row.department_id,
    departmentCode: row.department_code,
    departmentName: row.department_name,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    isActive: Boolean(row.is_active),
  }
}

async function findUserByEmail(email) {
  const [rows] = await pool.execute(
    `SELECT
       users.id,
       users.department_id,
       departments.code AS department_code,
       departments.name AS department_name,
       users.name,
       users.email,
       users.password_hash,
       users.role,
       users.is_active
     FROM users
     LEFT JOIN departments ON departments.id = users.department_id
     WHERE users.email = ?
     LIMIT 1`,
    [email],
  )

  return mapUser(rows[0])
}

async function findUserById(id) {
  const [rows] = await pool.execute(
    `SELECT
       users.id,
       users.department_id,
       departments.code AS department_code,
       departments.name AS department_name,
       users.name,
       users.email,
       users.password_hash,
       users.role,
       users.is_active
     FROM users
     LEFT JOIN departments ON departments.id = users.department_id
     WHERE users.id = ?
     LIMIT 1`,
    [id],
  )

  return mapUser(rows[0])
}

function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.departmentId
      ? {
          id: user.departmentId,
          code: user.departmentCode,
          name: user.departmentName,
        }
      : null,
  }
}

module.exports = {
  findUserByEmail,
  findUserById,
  toPublicUser,
}
