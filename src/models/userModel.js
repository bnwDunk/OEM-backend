const pool = require('../config/db')

function mapUser(row) {
  if (!row) return null

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    isActive: Boolean(row.is_active),
  }
}

async function findUserByEmail(email) {
  const [rows] = await pool.execute(
    `SELECT id, name, email, password_hash, role, is_active
     FROM users
     WHERE email = ?
     LIMIT 1`,
    [email],
  )

  return mapUser(rows[0])
}

async function findUserById(id) {
  const [rows] = await pool.execute(
    `SELECT id, name, email, password_hash, role, is_active
     FROM users
     WHERE id = ?
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
  }
}

module.exports = {
  findUserByEmail,
  findUserById,
  toPublicUser,
}
