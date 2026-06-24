const bcrypt = require('bcryptjs')
const pool = require('../config/db')

function mapUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.is_active ? 'active' : 'inactive',
    lastLogin: row.last_login_at || 'Never',
    department: row.department_name,
    departmentId: row.department_id,
  }
}

function mapDepartment(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    manager: row.manager_name || 'Not assigned',
    memberCount: row.member_count,
    status: row.is_active ? 'active' : 'inactive',
  }
}

function mapFlow(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    version: row.version,
    sourceFlowId: row.parent_template_id,
    sourceFlowName: row.source_flow_name || null,
    stageCount: row.stage_count,
    phaseCount: row.phase_count,
    status: row.status || (row.is_active ? 'active' : 'inactive'),
    updatedAt: row.updated_at,
  }
}

function makeCode(name) {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 50)
}

async function logAdminAction(req, { action, entityType, entityId, beforeData, afterData }) {
  await pool.execute(
    `INSERT INTO admin_audit_logs
       (actor_user_id, action, entity_type, entity_id, before_data, after_data, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.user.id,
      action,
      entityType,
      entityId || null,
      beforeData ? JSON.stringify(beforeData) : null,
      afterData ? JSON.stringify(afterData) : null,
      req.ip || null,
      req.headers['user-agent'] || null,
    ],
  )
}

async function listUsers(req, res, next) {
  try {
    const [rows] = await pool.execute(
      `SELECT
         users.id,
         users.name,
         users.email,
         users.role,
         users.is_active,
         users.department_id,
         NULL AS last_login_at,
         departments.name AS department_name
       FROM users
       LEFT JOIN departments ON departments.id = users.department_id
       ORDER BY users.id ASC`,
    )

    return res.json({ users: rows.map(mapUser) })
  } catch (error) {
    return next(error)
  }
}

async function createUser(req, res, next) {
  try {
    const {
      departmentId,
      email,
      name,
      password = 'password123',
      role = 'user',
      status = 'active',
    } = req.body

    if (!email || !name) {
      return res.status(400).json({ message: 'name and email are required.' })
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const [result] = await pool.execute(
      `INSERT INTO users (department_id, name, email, password_hash, role, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [departmentId || null, name, email, passwordHash, role, status === 'active' ? 1 : 0],
    )

    await logAdminAction(req, {
      action: 'create_user',
      entityType: 'user',
      entityId: result.insertId,
      afterData: { departmentId, email, name, role, status },
    })

    return res.status(201).json({ id: result.insertId })
  } catch (error) {
    return next(error)
  }
}

async function updateUser(req, res, next) {
  try {
    const { id } = req.params
    const { departmentId, name, role, status } = req.body

    const [beforeRows] = await pool.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [id])
    if (!beforeRows[0]) return res.status(404).json({ message: 'User not found.' })

    await pool.execute(
      `UPDATE users
       SET department_id = COALESCE(?, department_id),
           name = COALESCE(?, name),
           role = COALESCE(?, role),
           is_active = COALESCE(?, is_active)
       WHERE id = ?`,
      [
        departmentId ?? null,
        name ?? null,
        role ?? null,
        status ? (status === 'active' ? 1 : 0) : null,
        id,
      ],
    )

    await logAdminAction(req, {
      action: 'update_user',
      entityType: 'user',
      entityId: Number(id),
      beforeData: beforeRows[0],
      afterData: { departmentId, name, role, status },
    })

    return res.status(204).send()
  } catch (error) {
    return next(error)
  }
}

async function listDepartments(req, res, next) {
  try {
    const [rows] = await pool.execute(
      `SELECT
         departments.id,
         departments.code,
         departments.name,
         departments.is_active,
         COUNT(users.id) AS member_count,
         MAX(CASE WHEN users.role IN ('admin', 'manager') THEN users.name ELSE NULL END) AS manager_name
       FROM departments
       LEFT JOIN users ON users.department_id = departments.id
       GROUP BY departments.id
       ORDER BY departments.sort_order ASC, departments.name ASC`,
    )

    return res.json({ departments: rows.map(mapDepartment) })
  } catch (error) {
    return next(error)
  }
}

async function createDepartment(req, res, next) {
  try {
    const { name } = req.body
    if (!name) return res.status(400).json({ message: 'name is required.' })

    const code = makeCode(name)
    const [result] = await pool.execute(
      `INSERT INTO departments (code, name, sort_order)
       VALUES (?, ?, (SELECT next_sort FROM (SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_sort FROM departments) AS sort_value))`,
      [code, name],
    )

    await logAdminAction(req, {
      action: 'create_department',
      entityType: 'department',
      entityId: result.insertId,
      afterData: { code, name },
    })

    return res.status(201).json({ id: result.insertId, code, name })
  } catch (error) {
    return next(error)
  }
}

async function updateDepartment(req, res, next) {
  try {
    const { id } = req.params
    const { name, status } = req.body

    const [beforeRows] = await pool.execute('SELECT * FROM departments WHERE id = ? LIMIT 1', [id])
    if (!beforeRows[0]) return res.status(404).json({ message: 'Department not found.' })

    await pool.execute(
      `UPDATE departments
       SET name = COALESCE(?, name),
           is_active = COALESCE(?, is_active)
       WHERE id = ?`,
      [name ?? null, status ? (status === 'active' ? 1 : 0) : null, id],
    )

    await logAdminAction(req, {
      action: 'update_department',
      entityType: 'department',
      entityId: Number(id),
      beforeData: beforeRows[0],
      afterData: { name, status },
    })

    return res.status(204).send()
  } catch (error) {
    return next(error)
  }
}

async function listFlows(req, res, next) {
  try {
    const [rows] = await pool.execute(
      `SELECT
         workflow_templates.id,
         workflow_templates.parent_template_id,
         workflow_templates.code,
         workflow_templates.name,
         workflow_templates.version,
         workflow_templates.status,
         workflow_templates.is_active,
         workflow_templates.updated_at,
         source_templates.name AS source_flow_name,
         COUNT(DISTINCT workflow_stages.id) AS stage_count,
         COUNT(DISTINCT workflow_phases.id) AS phase_count
       FROM workflow_templates
       LEFT JOIN workflow_templates AS source_templates
         ON source_templates.id = workflow_templates.parent_template_id
       LEFT JOIN workflow_stages ON workflow_stages.template_id = workflow_templates.id
       LEFT JOIN workflow_phases ON workflow_phases.stage_id = workflow_stages.id
       GROUP BY workflow_templates.id
       ORDER BY workflow_templates.id ASC`,
    )

    return res.json({ flows: rows.map(mapFlow) })
  } catch (error) {
    return next(error)
  }
}

async function cloneFlowTemplate(connection, sourceFlowId, newTemplateId) {
  const [stages] = await connection.execute(
    'SELECT id, name, sort_order FROM workflow_stages WHERE template_id = ? ORDER BY sort_order ASC',
    [sourceFlowId],
  )

  for (const stage of stages) {
    const [stageResult] = await connection.execute(
      'INSERT INTO workflow_stages (template_id, name, sort_order) VALUES (?, ?, ?)',
      [newTemplateId, stage.name, stage.sort_order],
    )

    const [phases] = await connection.execute(
      'SELECT id, label, name, global_order, sort_order FROM workflow_phases WHERE stage_id = ? ORDER BY sort_order ASC',
      [stage.id],
    )

    for (const phase of phases) {
      const [phaseResult] = await connection.execute(
        `INSERT INTO workflow_phases (stage_id, label, name, global_order, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [stageResult.insertId, phase.label, phase.name, phase.global_order, phase.sort_order],
      )

      const [branches] = await connection.execute(
        'SELECT id, department_id, sort_order FROM workflow_phase_branches WHERE phase_id = ? ORDER BY sort_order ASC',
        [phase.id],
      )

      for (const branch of branches) {
        const [branchResult] = await connection.execute(
          'INSERT INTO workflow_phase_branches (phase_id, department_id, sort_order) VALUES (?, ?, ?)',
          [phaseResult.insertId, branch.department_id, branch.sort_order],
        )

        const [items] = await connection.execute(
          'SELECT label, sort_order, is_required FROM workflow_checklist_items WHERE branch_id = ? ORDER BY sort_order ASC',
          [branch.id],
        )

        for (const item of items) {
          await connection.execute(
            `INSERT INTO workflow_checklist_items (branch_id, label, sort_order, is_required)
             VALUES (?, ?, ?, ?)`,
            [branchResult.insertId, item.label, item.sort_order, item.is_required],
          )
        }
      }
    }
  }
}

async function createFlow(req, res, next) {
  const connection = await pool.getConnection()

  try {
    const { name, sourceFlowId } = req.body
    if (!name || !sourceFlowId) {
      return res.status(400).json({ message: 'name and sourceFlowId are required.' })
    }

    await connection.beginTransaction()

    const [sourceRows] = await connection.execute(
      'SELECT id FROM workflow_templates WHERE id = ? LIMIT 1',
      [sourceFlowId],
    )
    if (!sourceRows[0]) {
      await connection.rollback()
      return res.status(404).json({ message: 'Source flow not found.' })
    }

    const code = makeCode(name)
    const [result] = await connection.execute(
      `INSERT INTO workflow_templates (parent_template_id, code, name, version, status, is_active)
       VALUES (?, ?, ?, 1, 'draft', 0)`,
      [sourceFlowId, code, name],
    )

    await cloneFlowTemplate(connection, sourceFlowId, result.insertId)
    await connection.commit()

    await logAdminAction(req, {
      action: 'create_flow',
      entityType: 'system',
      entityId: result.insertId,
      afterData: { name, sourceFlowId },
    })

    return res.status(201).json({ id: result.insertId })
  } catch (error) {
    await connection.rollback()
    return next(error)
  } finally {
    connection.release()
  }
}

async function updateFlow(req, res, next) {
  try {
    const { id } = req.params
    const { name, status, version } = req.body

    const [beforeRows] = await pool.execute('SELECT * FROM workflow_templates WHERE id = ? LIMIT 1', [id])
    if (!beforeRows[0]) return res.status(404).json({ message: 'Flow not found.' })

    await pool.execute(
      `UPDATE workflow_templates
       SET name = COALESCE(?, name),
           version = COALESCE(?, version),
           status = COALESCE(?, status),
           is_active = CASE
             WHEN ? = 'active' THEN 1
             WHEN ? IN ('draft', 'inactive') THEN 0
             ELSE is_active
           END
       WHERE id = ?`,
      [name ?? null, version ?? null, status ?? null, status ?? null, status ?? null, id],
    )

    await logAdminAction(req, {
      action: 'update_flow',
      entityType: 'system',
      entityId: Number(id),
      beforeData: beforeRows[0],
      afterData: { name, status, version },
    })

    return res.status(204).send()
  } catch (error) {
    return next(error)
  }
}

async function deleteFlow(req, res, next) {
  try {
    const { id } = req.params
    const [beforeRows] = await pool.execute('SELECT * FROM workflow_templates WHERE id = ? LIMIT 1', [id])
    if (!beforeRows[0]) return res.status(404).json({ message: 'Flow not found.' })

    await pool.execute('DELETE FROM workflow_templates WHERE id = ?', [id])

    await logAdminAction(req, {
      action: 'delete_flow',
      entityType: 'system',
      entityId: Number(id),
      beforeData: beforeRows[0],
    })

    return res.status(204).send()
  } catch (error) {
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(409).json({ message: 'This flow is already used and cannot be deleted.' })
    }

    return next(error)
  }
}

module.exports = {
  createDepartment,
  createFlow,
  createUser,
  deleteFlow,
  listDepartments,
  listFlows,
  listUsers,
  updateDepartment,
  updateFlow,
  updateUser,
}
