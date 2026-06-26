const pool = require('../config/db')

function mapUser(row) {
  if (!row) return null

  const departmentIds = row.department_ids ? String(row.department_ids).split(',') : []
  const departmentCodes = row.department_codes ? String(row.department_codes).split('\n') : []
  const departmentNames = row.department_names ? String(row.department_names).split('\n') : []
  const assignedDepartments = departmentIds
    .map((id, index) => ({
      id: Number(id),
      code: departmentCodes[index],
      name: departmentNames[index],
    }))
    .filter((department) => department.id && department.name)
  const primaryDepartment = assignedDepartments[0] || (
    row.department_id
      ? {
          id: row.department_id,
          code: row.department_code,
          name: row.department_name,
        }
      : null
  )

  return {
    id: row.id,
    departmentId: primaryDepartment?.id || null,
    departmentCode: primaryDepartment?.code || null,
    departmentName: primaryDepartment?.name || null,
    departmentIds: assignedDepartments.map((department) => department.id),
    departments: assignedDepartments,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    role: String(row.role || 'user').trim().toLowerCase(),
    isActive: Boolean(row.is_active),
  }
}

async function findUserByIdentifier(identifier) {
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
       users.is_active,
       user_department_groups.department_ids,
       user_department_groups.department_codes,
       user_department_groups.department_names
     FROM users
     LEFT JOIN departments ON departments.id = users.department_id
     LEFT JOIN (
       SELECT
         user_departments.user_id,
         GROUP_CONCAT(departments.id ORDER BY departments.name ASC SEPARATOR ',') AS department_ids,
         GROUP_CONCAT(departments.code ORDER BY departments.name ASC SEPARATOR '\n') AS department_codes,
         GROUP_CONCAT(departments.name ORDER BY departments.name ASC SEPARATOR '\n') AS department_names
       FROM user_departments
       INNER JOIN departments ON departments.id = user_departments.department_id
       GROUP BY user_departments.user_id
     ) AS user_department_groups ON user_department_groups.user_id = users.id
     WHERE LOWER(users.email) = LOWER(?)
        OR LOWER(users.name) = LOWER(?)
        OR LOWER(SUBSTRING_INDEX(users.email, '@', 1)) = LOWER(?)
     LIMIT 1`,
    [identifier, identifier, identifier],
  )

  return mapUser(rows[0])
}

async function findUserByEmail(email) {
  return findUserByIdentifier(email)
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
       users.is_active,
       user_department_groups.department_ids,
       user_department_groups.department_codes,
       user_department_groups.department_names
     FROM users
     LEFT JOIN departments ON departments.id = users.department_id
     LEFT JOIN (
       SELECT
         user_departments.user_id,
         GROUP_CONCAT(departments.id ORDER BY departments.name ASC SEPARATOR ',') AS department_ids,
         GROUP_CONCAT(departments.code ORDER BY departments.name ASC SEPARATOR '\n') AS department_codes,
         GROUP_CONCAT(departments.name ORDER BY departments.name ASC SEPARATOR '\n') AS department_names
       FROM user_departments
       INNER JOIN departments ON departments.id = user_departments.department_id
       GROUP BY user_departments.user_id
     ) AS user_department_groups ON user_department_groups.user_id = users.id
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
    role: String(user.role || 'user').trim().toLowerCase(),
    departments: user.departments || [],
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
  findUserByIdentifier,
  findUserById,
  toPublicUser,
}
