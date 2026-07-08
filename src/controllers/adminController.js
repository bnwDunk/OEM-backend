const bcrypt = require('bcryptjs')
const pool = require('../config/db')
const { sendPhaseAdvancedEmail } = require('../services/mailService')

function mapUser(row) {
  const departmentIds = row.department_ids ? String(row.department_ids).split(',') : []
  const departmentNames = row.department_names ? String(row.department_names).split('\n') : []
  const departments = departmentIds
    .map((id, index) => ({
      id: Number(id),
      name: departmentNames[index],
    }))
    .filter((department) => department.id && department.name)

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: String(row.role || 'user').trim().toLowerCase(),
    status: row.is_active ? 'active' : 'inactive',
    lastLogin: row.last_login_at || 'Never',
    department: departments[0]?.name || row.department_name,
    departmentId: departments[0]?.id || row.department_id,
    departments,
    departmentIds: departments.map((department) => department.id),
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

function mapCustomer(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    dueDate: row.due_date,
    salesperson: row.salesperson,
    status: row.status,
    flowId: row.template_id,
    flowName: row.flow_name,
    currentPhaseId: row.current_phase_id,
    currentPhaseName: row.current_phase_name,
    costSyrup: row.cost_syrup,
    costPackage: row.cost_package,
    price: row.price,
    volume: row.volume,
    updatedAt: row.updated_at,
  }
}

function mapCustomerStatus(row) {
  return {
    id: row.id,
    value: row.value,
    label: row.label,
    sortOrder: Number(row.sort_order || 0),
    status: row.is_active ? 'active' : 'inactive',
    customerCount: Number(row.customer_count || 0),
    updatedAt: row.updated_at,
  }
}

function mapTag(row) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    status: row.is_active ? 'active' : 'inactive',
    customerCount: Number(row.customer_count || 0),
    updatedAt: row.updated_at,
  }
}

function normalizeColor(color) {
  const value = String(color || '').trim()
  return /^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#0f766e'
}

function normalizeNullableText(value) {
  const text = String(value || '').trim()
  return text || null
}

function normalizeDueDate(value) {
  const text = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

function normalizeNullableDecimal(value) {
  const text = String(value ?? '').replace(/,/g, '').trim()
  if (!text) return null

  const numberValue = Number(text)
  return Number.isFinite(numberValue) ? text : null
}

function parseTagNames(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index)
}

function normalizeStatusValue(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80)
}

function makeStatusValue(label) {
  return normalizeStatusValue(label) || `status_${Date.now()}`
}

async function customerStatusExists(connection, value) {
  const [rows] = await connection.execute(
    'SELECT id FROM customer_statuses WHERE value = ? AND is_active = 1 LIMIT 1',
    [value],
  )

  return Boolean(rows[0])
}

async function replaceCustomerTags(connection, customerId, tagsText) {
  const tagNames = parseTagNames(tagsText)

  await connection.execute('DELETE FROM customer_tag_assignments WHERE customer_id = ?', [customerId])

  for (const tagName of tagNames) {
    await connection.execute(
      `INSERT INTO customer_tags (name, color, is_active)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE is_active = 1`,
      [tagName, '#0f766e'],
    )

    const [tagRows] = await connection.execute(
      'SELECT id FROM customer_tags WHERE name = ? LIMIT 1',
      [tagName],
    )

    if (tagRows[0]) {
      await connection.execute(
        `INSERT IGNORE INTO customer_tag_assignments (customer_id, tag_id)
         VALUES (?, ?)`,
        [customerId, tagRows[0].id],
      )
    }
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

function makeSlug(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || `project-${Date.now()}`
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())
}

async function makeUniqueCustomerSlug(connection, name) {
  const baseSlug = makeSlug(name)
  let slug = baseSlug
  let suffix = 2

  while (true) {
    const [rows] = await connection.execute(
      'SELECT id FROM customers WHERE slug = ? LIMIT 1',
      [slug],
    )

    if (!rows[0]) return slug

    const suffixText = `-${suffix}`
    slug = `${baseSlug.slice(0, 100 - suffixText.length)}${suffixText}`
    suffix += 1
  }
}

async function makeUniqueFlowCode(connection, name) {
  const baseCode = makeCode(name) || 'FLOW'
  let code = baseCode
  let suffix = 2

  while (true) {
    const [rows] = await connection.execute(
      'SELECT id FROM workflow_templates WHERE code = ? AND version = 1 LIMIT 1',
      [code],
    )

    if (!rows[0]) return code

    const suffixText = `_${suffix}`
    code = `${baseCode.slice(0, 50 - suffixText.length)}${suffixText}`
    suffix += 1
  }
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

async function getPhaseNotificationContext(connection, { customerId, phaseId }) {
  const [customerRows] = await connection.execute(
    `SELECT id, name, slug
     FROM customers
     WHERE id = ?
     LIMIT 1`,
    [customerId],
  )

  const [phaseRows] = await connection.execute(
    `SELECT
       workflow_phases.id,
       workflow_phases.label,
       workflow_phases.name,
       workflow_stages.stage_position,
       workflow_stages.name AS stage_name
     FROM workflow_phases
     INNER JOIN (
       SELECT
         workflow_stages.*,
         ROW_NUMBER() OVER (PARTITION BY workflow_stages.template_id ORDER BY workflow_stages.sort_order ASC, workflow_stages.id ASC) AS stage_position
       FROM workflow_stages
     ) AS workflow_stages
       ON workflow_stages.id = workflow_phases.stage_id
     WHERE workflow_phases.id = ?
     LIMIT 1`,
    [phaseId],
  )

  const [departmentRows] = await connection.execute(
    `SELECT DISTINCT departments.name
     FROM workflow_phase_branches
     INNER JOIN departments
       ON departments.id = workflow_phase_branches.department_id
      AND departments.is_active = 1
     WHERE workflow_phase_branches.phase_id = ?
     ORDER BY departments.name ASC`,
    [phaseId],
  )

  const [recipientRows] = await connection.execute(
    `SELECT DISTINCT
       departments.id AS department_id,
       departments.name AS department_name,
       users.email
     FROM workflow_phase_branches
     INNER JOIN departments
       ON departments.id = workflow_phase_branches.department_id
      AND departments.is_active = 1
     INNER JOIN users
       ON users.is_active = 1
      AND (
        users.department_id = departments.id
        OR EXISTS (
          SELECT 1
          FROM user_departments
          WHERE user_departments.user_id = users.id
            AND user_departments.department_id = departments.id
        )
      )
     WHERE workflow_phase_branches.phase_id = ?
     ORDER BY departments.name ASC, users.email ASC`,
    [phaseId],
  )

  if (!customerRows[0] || !phaseRows[0]) return null
  const recipientsByDepartment = recipientRows.reduce((groups, row) => {
    const departmentId = Number(row.department_id)
    if (!groups.has(departmentId)) {
      groups.set(departmentId, {
        departmentId,
        departmentName: row.department_name,
        recipients: [],
      })
    }
    groups.get(departmentId).recipients.push(row.email)
    return groups
  }, new Map())

  return {
    customer: customerRows[0],
    phase: {
      ...phaseRows[0],
      departments: departmentRows.map((row) => row.name),
      departmentRecipients: [...recipientsByDepartment.values()],
    },
    recipients: recipientRows.map((row) => row.email),
  }
}

async function recordEmailNotificationResult({ actorUserId, error, notification, result }) {
  if (!notification?.customer || !notification?.phase) return

  const to = result?.to || notification.recipients || []
  const skipped = Boolean(result?.skipped)
  const action = error ? 'email_notification_failed' : skipped ? 'email_notification_skipped' : 'email_notification_sent'
  const message = error
    ? `Email notification failed for phase ${notification.phase.label}: ${notification.phase.name}`
    : skipped
      ? `Email notification skipped for phase ${notification.phase.label}: ${notification.phase.name}`
      : `Email notification sent for phase ${notification.phase.label}: ${notification.phase.name}`

  try {
    await pool.execute(
      `INSERT INTO workflow_activity_logs (customer_id, phase_id, actor_user_id, action, message, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        notification.customer.id,
        notification.phase.id,
        actorUserId,
        action,
        message,
        JSON.stringify({
          error: error ? error.message : null,
          recipients: to,
        }),
      ],
    )
  } catch (logError) {
    console.warn('Failed to record email notification result:', logError.message)
  }
}

async function sendCustomerCreatedNotification({ actorUserId, notification }) {
  if (!notification?.customer || !notification?.phase) return

  try {
    const result = await sendPhaseAdvancedEmail({
      customerName: notification.customer.name,
      nextPhase: notification.phase,
      recipients: notification.recipients,
    })
    await recordEmailNotificationResult({
      actorUserId,
      notification,
      result,
    })
  } catch (error) {
    await recordEmailNotificationResult({
      actorUserId,
      error,
      notification,
    })
  }
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
         departments.name AS department_name,
         user_department_groups.department_ids,
         user_department_groups.department_names
       FROM users
       LEFT JOIN departments ON departments.id = users.department_id
       LEFT JOIN (
         SELECT
           user_departments.user_id,
           GROUP_CONCAT(departments.id ORDER BY departments.name ASC SEPARATOR ',') AS department_ids,
           GROUP_CONCAT(departments.name ORDER BY departments.name ASC SEPARATOR '\n') AS department_names
         FROM user_departments
         INNER JOIN departments ON departments.id = user_departments.department_id
         GROUP BY user_departments.user_id
       ) AS user_department_groups ON user_department_groups.user_id = users.id
       ORDER BY users.id ASC`,
    )

    return res.json({ users: rows.map(mapUser) })
  } catch (error) {
    return next(error)
  }
}

async function createUser(req, res, next) {
  const connection = await pool.getConnection()

  try {
    const {
      departmentId,
      departmentIds,
      email,
      name,
      password = 'password123',
      role = 'user',
      status = 'active',
    } = req.body

    if (!email || !name) {
      return res.status(400).json({ message: 'name and email are required.' })
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'A valid email is required for notifications.' })
    }

    const normalizedRole = String(role || 'user').trim().toLowerCase()
    const normalizedEmail = String(email).trim().toLowerCase()
    const passwordHash = await bcrypt.hash(password, 10)
    const selectedDepartmentIds = Array.isArray(departmentIds)
      ? departmentIds.map((item) => Number(item)).filter(Boolean)
      : departmentId ? [Number(departmentId)] : []
    const primaryDepartmentId = selectedDepartmentIds[0] || null

    await connection.beginTransaction()

    const [result] = await connection.execute(
      `INSERT INTO users (department_id, name, email, password_hash, role, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [primaryDepartmentId, name, normalizedEmail, passwordHash, normalizedRole, status === 'active' ? 1 : 0],
    )

    for (const assignedDepartmentId of selectedDepartmentIds) {
      await connection.execute(
        'INSERT IGNORE INTO user_departments (user_id, department_id) VALUES (?, ?)',
        [result.insertId, assignedDepartmentId],
      )
    }

    await connection.commit()

    await logAdminAction(req, {
      action: 'create_user',
      entityType: 'user',
      entityId: result.insertId,
      afterData: { departmentIds: selectedDepartmentIds, email: normalizedEmail, name, role: normalizedRole, status },
    })

    return res.status(201).json({ id: result.insertId })
  } catch (error) {
    await connection.rollback()
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'This email is already used by another user.' })
    }
    return next(error)
  } finally {
    connection.release()
  }
}

async function updateUser(req, res, next) {
  const connection = await pool.getConnection()

  try {
    const { id } = req.params
    const { departmentId, departmentIds, email, name, role, status } = req.body

    const [beforeRows] = await connection.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [id])
    if (!beforeRows[0]) return res.status(404).json({ message: 'User not found.' })

    const normalizedRole = role === undefined || role === null ? null : String(role).trim().toLowerCase()
    const normalizedEmail = email === undefined || email === null ? null : String(email).trim().toLowerCase()
    if (normalizedEmail !== null && !isValidEmail(normalizedEmail)) {
      return res.status(400).json({ message: 'A valid email is required for notifications.' })
    }
    const selectedDepartmentIds = Array.isArray(departmentIds)
      ? departmentIds.map((item) => Number(item)).filter(Boolean)
      : departmentId ? [Number(departmentId)] : null
    const primaryDepartmentId = selectedDepartmentIds ? selectedDepartmentIds[0] || null : departmentId ?? null

    await connection.beginTransaction()

    await connection.execute(
      `UPDATE users
       SET department_id = COALESCE(?, department_id),
           email = COALESCE(?, email),
           name = COALESCE(?, name),
           role = COALESCE(?, role),
           is_active = COALESCE(?, is_active)
       WHERE id = ?`,
      [
        primaryDepartmentId,
        normalizedEmail,
        name ?? null,
        normalizedRole,
        status ? (status === 'active' ? 1 : 0) : null,
        id,
      ],
    )

    if (selectedDepartmentIds) {
      await connection.execute('DELETE FROM user_departments WHERE user_id = ?', [id])
      for (const assignedDepartmentId of selectedDepartmentIds) {
        await connection.execute(
          'INSERT IGNORE INTO user_departments (user_id, department_id) VALUES (?, ?)',
          [id, assignedDepartmentId],
        )
      }
    }

    await connection.commit()

    await logAdminAction(req, {
      action: 'update_user',
      entityType: 'user',
      entityId: Number(id),
      beforeData: beforeRows[0],
      afterData: { departmentIds: selectedDepartmentIds, departmentId, email: normalizedEmail, name, role: normalizedRole, status },
    })

    return res.status(204).send()
  } catch (error) {
    await connection.rollback()
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'This email is already used by another user.' })
    }
    return next(error)
  } finally {
    connection.release()
  }
}

async function deleteUser(req, res, next) {
  try {
    const { id } = req.params
    if (Number(id) === req.user.id) {
      return res.status(400).json({ message: 'You cannot delete your own account.' })
    }

    const [beforeRows] = await pool.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [id])
    if (!beforeRows[0]) return res.status(404).json({ message: 'User not found.' })

    await pool.execute('DELETE FROM users WHERE id = ?', [id])

    await logAdminAction(req, {
      action: 'delete_user',
      entityType: 'user',
      entityId: Number(id),
      beforeData: beforeRows[0],
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
         COUNT(DISTINCT user_departments.user_id) AS member_count,
         MAX(CASE WHEN users.role IN ('admin', 'manager') THEN users.name ELSE NULL END) AS manager_name
       FROM departments
       LEFT JOIN user_departments ON user_departments.department_id = departments.id
       LEFT JOIN users ON users.id = user_departments.user_id
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

async function getFlowStructure(req, res, next) {
  try {
    const { id } = req.params
    const [flowRows] = await pool.execute(
      'SELECT id, name FROM workflow_templates WHERE id = ? LIMIT 1',
      [id],
    )

    if (!flowRows[0]) return res.status(404).json({ message: 'Flow not found.' })

    const [stageRows] = await pool.execute(
      `SELECT id, name, sort_order
       FROM workflow_stages
       WHERE template_id = ?
       ORDER BY sort_order ASC, id ASC`,
      [id],
    )

    const stageIds = stageRows.map((stage) => stage.id)
    let phasesByStage = new Map()

    if (stageIds.length > 0) {
      const placeholders = stageIds.map(() => '?').join(', ')
      const [phaseRows] = await pool.execute(
        `SELECT id, stage_id, label, name, global_order, sort_order
         FROM workflow_phases
         WHERE stage_id IN (${placeholders})
         ORDER BY global_order ASC, sort_order ASC, id ASC`,
        stageIds,
      )

      const phaseIds = phaseRows.map((phase) => phase.id)
      let departmentsByPhase = new Map()

      if (phaseIds.length > 0) {
        const phasePlaceholders = phaseIds.map(() => '?').join(', ')
        const [branchRows] = await pool.execute(
          `SELECT
             workflow_phase_branches.phase_id,
             departments.id,
             departments.name
           FROM workflow_phase_branches
           INNER JOIN departments ON departments.id = workflow_phase_branches.department_id
           WHERE workflow_phase_branches.phase_id IN (${phasePlaceholders})
           ORDER BY workflow_phase_branches.sort_order ASC, departments.name ASC`,
          phaseIds,
        )

        departmentsByPhase = branchRows.reduce((groups, branch) => {
          if (!groups.has(branch.phase_id)) groups.set(branch.phase_id, [])
          groups.get(branch.phase_id).push({
            id: branch.id,
            name: branch.name,
          })
          return groups
        }, new Map())
      }

      phasesByStage = phaseRows.reduce((groups, phase) => {
        if (!groups.has(phase.stage_id)) groups.set(phase.stage_id, [])
        groups.get(phase.stage_id).push({
          id: phase.id,
          label: phase.label,
          name: phase.name,
          departments: departmentsByPhase.get(phase.id) || [],
        })
        return groups
      }, new Map())
    }

    return res.json({
      flow: flowRows[0],
      stages: stageRows.map((stage) => ({
        id: stage.id,
        name: stage.name,
        phases: phasesByStage.get(stage.id) || [],
      })),
    })
  } catch (error) {
    return next(error)
  }
}

async function updateFlowStructure(req, res, next) {
  const connection = await pool.getConnection()

  try {
    const { id } = req.params
    const { stages = [] } = req.body

    if (!Array.isArray(stages) || stages.length === 0) {
      return res.status(400).json({ message: 'At least one stage is required.' })
    }

    await connection.beginTransaction()

    const [flowRows] = await connection.execute(
      'SELECT * FROM workflow_templates WHERE id = ? LIMIT 1',
      [id],
    )
    if (!flowRows[0]) {
      await connection.rollback()
      return res.status(404).json({ message: 'Flow not found.' })
    }

    const [existingStages] = await connection.execute(
      'SELECT id FROM workflow_stages WHERE template_id = ?',
      [id],
    )
    const requestedStageIds = new Set(stages.map((stage) => Number(stage.id)).filter(Boolean))

    for (const stage of existingStages) {
      if (!requestedStageIds.has(Number(stage.id))) {
        await connection.execute('DELETE FROM workflow_stages WHERE id = ?', [stage.id])
      }
    }

    for (const [index, stage] of stages.entries()) {
      if (stage.id) {
        await connection.execute(
          'UPDATE workflow_stages SET sort_order = ? WHERE id = ? AND template_id = ?',
          [100000 + index, stage.id, id],
        )
      }
    }

    let globalOrder = 1

    for (const [stageIndex, stage] of stages.entries()) {
      const stageName = String(stage.name || '').trim()
      if (!stageName) {
        await connection.rollback()
        return res.status(400).json({ message: 'Stage name is required.' })
      }

      const stageSortOrder = (stageIndex + 1) * 10
      let stageId = Number(stage.id) || null

      if (stageId) {
        await connection.execute(
          `UPDATE workflow_stages
           SET name = ?, sort_order = ?
           WHERE id = ? AND template_id = ?`,
          [stageName, stageSortOrder, stageId, id],
        )
      } else {
        const [stageResult] = await connection.execute(
          'INSERT INTO workflow_stages (template_id, name, sort_order) VALUES (?, ?, ?)',
          [id, stageName, stageSortOrder],
        )
        stageId = stageResult.insertId
      }

      const phases = Array.isArray(stage.phases) ? stage.phases : []
      const [existingPhases] = await connection.execute(
        'SELECT id FROM workflow_phases WHERE stage_id = ?',
        [stageId],
      )
      const requestedPhaseIds = new Set(phases.map((phase) => Number(phase.id)).filter(Boolean))

      for (const phase of existingPhases) {
        if (!requestedPhaseIds.has(Number(phase.id))) {
          await connection.execute('DELETE FROM workflow_phases WHERE id = ?', [phase.id])
        }
      }

      for (const [phaseIndex, phase] of phases.entries()) {
        if (phase.id) {
          await connection.execute(
            `UPDATE workflow_phases
             SET label = ?, global_order = ?, sort_order = ?
             WHERE id = ? AND stage_id = ?`,
            [`TMP${phase.id}`.slice(0, 20), 100000 + globalOrder + phaseIndex, 100000 + phaseIndex, phase.id, stageId],
          )
        }
      }

      for (const [phaseIndex, phase] of phases.entries()) {
        const label = String(phase.label || '').trim()
        const phaseName = String(phase.name || '').trim()
        const departmentIds = Array.isArray(phase.departmentIds)
          ? phase.departmentIds.map((departmentId) => Number(departmentId)).filter(Boolean)
          : []

        if (!label || !phaseName) {
          await connection.rollback()
          return res.status(400).json({ message: 'Phase label and name are required.' })
        }

        if (departmentIds.length === 0) {
          await connection.rollback()
          return res.status(400).json({ message: 'Each phase needs at least one department.' })
        }

        const phaseSortOrder = (phaseIndex + 1) * 10

        let phaseId = Number(phase.id) || null

        if (phaseId) {
          await connection.execute(
            `UPDATE workflow_phases
             SET label = ?, name = ?, global_order = ?, sort_order = ?
             WHERE id = ? AND stage_id = ?`,
            [label, phaseName, globalOrder, phaseSortOrder, phaseId, stageId],
          )
        } else {
          const [phaseResult] = await connection.execute(
            `INSERT INTO workflow_phases (stage_id, label, name, global_order, sort_order)
             VALUES (?, ?, ?, ?, ?)`,
            [stageId, label, phaseName, globalOrder, phaseSortOrder],
          )
          phaseId = phaseResult.insertId
        }

        const [existingBranches] = await connection.execute(
          'SELECT id, department_id FROM workflow_phase_branches WHERE phase_id = ?',
          [phaseId],
        )
        const requestedDepartmentIds = new Set(departmentIds)

        for (const branch of existingBranches) {
          if (!requestedDepartmentIds.has(Number(branch.department_id))) {
            await connection.execute('DELETE FROM workflow_phase_branches WHERE id = ?', [branch.id])
          }
        }

        for (const [departmentIndex, departmentId] of departmentIds.entries()) {
          const [branchRows] = await connection.execute(
            'SELECT id FROM workflow_phase_branches WHERE phase_id = ? AND department_id = ? LIMIT 1',
            [phaseId, departmentId],
          )

          let branchId = branchRows[0]?.id
          if (branchId) {
            await connection.execute(
              'UPDATE workflow_phase_branches SET sort_order = ? WHERE id = ?',
              [(departmentIndex + 1) * 10, branchId],
            )
          } else {
            const [branchResult] = await connection.execute(
              'INSERT INTO workflow_phase_branches (phase_id, department_id, sort_order) VALUES (?, ?, ?)',
              [phaseId, departmentId, (departmentIndex + 1) * 10],
            )
            branchId = branchResult.insertId
          }

          const [itemRows] = await connection.execute(
            'SELECT id FROM workflow_checklist_items WHERE branch_id = ? LIMIT 1',
            [branchId],
          )

          if (!itemRows[0]) {
            await connection.execute(
              `INSERT INTO workflow_checklist_items (branch_id, label, sort_order, is_required)
               VALUES (?, ?, 10, 1)`,
              [branchId, phaseName],
            )
          }
        }

        globalOrder += 1
      }
    }

    await connection.execute(
      'UPDATE workflow_templates SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [id],
    )

    await connection.commit()

    await logAdminAction(req, {
      action: 'update_flow_structure',
      entityType: 'system',
      entityId: Number(id),
      beforeData: null,
      afterData: { stages },
    })

    return res.status(204).send()
  } catch (error) {
    await connection.rollback()
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Stage order or phase label is duplicated.' })
    }
    return next(error)
  } finally {
    connection.release()
  }
}

async function listCustomers(req, res, next) {
  try {
    const [rows] = await pool.execute(
      `SELECT
         customers.id,
         customers.slug,
         customers.name,
         customers.status,
         customers.cost_syrup,
         customers.cost_package,
         customers.price,
         customers.volume,
         customers.due_date,
         customers.salesperson,
         customers.updated_at,
         customer_workflows.template_id,
         customer_workflows.current_phase_id,
         workflow_templates.name AS flow_name,
         workflow_phases.name AS current_phase_name
       FROM customers
       LEFT JOIN customer_workflows
         ON customer_workflows.customer_id = customers.id
        AND customer_workflows.status = 'active'
       LEFT JOIN workflow_templates
         ON workflow_templates.id = customer_workflows.template_id
       LEFT JOIN workflow_phases
         ON workflow_phases.id = customer_workflows.current_phase_id
       ORDER BY customers.updated_at DESC, customers.id DESC`,
    )

    return res.json({ customers: rows.map(mapCustomer) })
  } catch (error) {
    return next(error)
  }
}

async function listCustomerStatuses(req, res, next) {
  try {
    const [rows] = await pool.execute(
      `SELECT
         customer_statuses.id,
         customer_statuses.value,
         customer_statuses.label,
         customer_statuses.sort_order,
         customer_statuses.is_active,
         customer_statuses.updated_at,
         COUNT(customers.id) AS customer_count
       FROM customer_statuses
       LEFT JOIN customers
         ON customers.status = customer_statuses.value
       GROUP BY
         customer_statuses.id,
         customer_statuses.value,
         customer_statuses.label,
         customer_statuses.sort_order,
         customer_statuses.is_active,
         customer_statuses.updated_at
       ORDER BY customer_statuses.sort_order ASC, customer_statuses.id ASC`,
    )

    return res.json({ statuses: rows.map(mapCustomerStatus) })
  } catch (error) {
    return next(error)
  }
}

async function createCustomerStatus(req, res, next) {
  try {
    const label = String(req.body.label || '').trim()
    const value = makeStatusValue(req.body.value || label)
    const sortOrder = Number(req.body.sortOrder || 0)

    if (!label) return res.status(400).json({ message: 'Status label is required.' })

    const [result] = await pool.execute(
      `INSERT INTO customer_statuses (value, label, sort_order, is_active)
       VALUES (?, ?, ?, 1)`,
      [value, label, sortOrder],
    )

    await logAdminAction(req, {
      action: 'create_customer_status',
      entityType: 'system',
      entityId: result.insertId,
      afterData: { label, sortOrder, value },
    })

    return res.status(201).json({ id: result.insertId, label, sortOrder, status: 'active', value })
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'A customer status with this code already exists.' })
    }
    return next(error)
  }
}

async function updateCustomerStatus(req, res, next) {
  const connection = await pool.getConnection()

  try {
    const { id } = req.params
    const label = req.body.label === undefined ? undefined : String(req.body.label || '').trim()
    const nextValue = req.body.value === undefined ? undefined : normalizeStatusValue(req.body.value)
    const sortOrder = req.body.sortOrder === undefined ? undefined : Number(req.body.sortOrder || 0)
    const status = req.body.status === undefined ? undefined : String(req.body.status || '').trim().toLowerCase()

    if (label !== undefined && !label) return res.status(400).json({ message: 'Status label is required.' })
    if (nextValue !== undefined && !nextValue) return res.status(400).json({ message: 'Status code is required.' })
    if (status !== undefined && !['active', 'inactive'].includes(status)) {
      return res.status(400).json({ message: 'Status must be active or inactive.' })
    }

    const [beforeRows] = await connection.execute('SELECT * FROM customer_statuses WHERE id = ? LIMIT 1', [id])
    const before = beforeRows[0]
    if (!before) return res.status(404).json({ message: 'Customer status not found.' })

    await connection.beginTransaction()

    await connection.execute(
      `UPDATE customer_statuses
       SET value = COALESCE(?, value),
           label = COALESCE(?, label),
           sort_order = COALESCE(?, sort_order),
           is_active = COALESCE(?, is_active)
       WHERE id = ?`,
      [
        nextValue ?? null,
        label ?? null,
        sortOrder ?? null,
        status === undefined ? null : status === 'active' ? 1 : 0,
        id,
      ],
    )

    if (nextValue && nextValue !== before.value) {
      await connection.execute('UPDATE customers SET status = ? WHERE status = ?', [nextValue, before.value])
    }

    await connection.commit()

    await logAdminAction(req, {
      action: 'update_customer_status',
      entityType: 'system',
      entityId: Number(id),
      beforeData: before,
      afterData: { label, sortOrder, status, value: nextValue },
    })

    return res.status(204).send()
  } catch (error) {
    await connection.rollback()
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'A customer status with this code already exists.' })
    }
    return next(error)
  } finally {
    connection.release()
  }
}

async function deleteCustomerStatus(req, res, next) {
  try {
    const { id } = req.params
    const [beforeRows] = await pool.execute('SELECT * FROM customer_statuses WHERE id = ? LIMIT 1', [id])
    const before = beforeRows[0]
    if (!before) return res.status(404).json({ message: 'Customer status not found.' })

    const [usageRows] = await pool.execute('SELECT COUNT(*) AS count FROM customers WHERE status = ?', [before.value])
    if (Number(usageRows[0].count) > 0) {
      return res.status(409).json({ message: 'This status is used by customers and cannot be deleted.' })
    }

    await pool.execute('DELETE FROM customer_statuses WHERE id = ?', [id])

    await logAdminAction(req, {
      action: 'delete_customer_status',
      entityType: 'system',
      entityId: Number(id),
      beforeData: before,
    })

    return res.status(204).send()
  } catch (error) {
    return next(error)
  }
}

async function listTags(req, res, next) {
  try {
    const [rows] = await pool.execute(
      `SELECT
         customer_tags.id,
         customer_tags.name,
         customer_tags.color,
         customer_tags.is_active,
         customer_tags.updated_at,
         COUNT(customer_tag_assignments.customer_id) AS customer_count
       FROM customer_tags
       LEFT JOIN customer_tag_assignments
         ON customer_tag_assignments.tag_id = customer_tags.id
       WHERE customer_tags.is_active = 1
       GROUP BY
         customer_tags.id,
         customer_tags.name,
         customer_tags.color,
         customer_tags.is_active,
         customer_tags.updated_at
       ORDER BY customer_tags.updated_at DESC, customer_tags.name ASC`,
    )

    return res.json({ tags: rows.map(mapTag) })
  } catch (error) {
    return next(error)
  }
}

async function updateTag(req, res, next) {
  try {
    const { id } = req.params
    const name = String(req.body.name || '').trim()
    const color = normalizeColor(req.body.color)

    if (!name) return res.status(400).json({ message: 'Tag name is required.' })

    const [beforeRows] = await pool.execute('SELECT * FROM customer_tags WHERE id = ? LIMIT 1', [id])
    if (!beforeRows[0]) return res.status(404).json({ message: 'Tag not found.' })

    await pool.execute(
      `UPDATE customer_tags
       SET name = ?, color = ?, is_active = 1
       WHERE id = ?`,
      [name, color, id],
    )

    await logAdminAction(req, {
      action: 'update_tag',
      entityType: 'system',
      entityId: Number(id),
      beforeData: beforeRows[0],
      afterData: { name, color },
    })

    return res.status(204).send()
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'A tag with this name already exists.' })
    }
    return next(error)
  }
}

async function deleteTag(req, res, next) {
  const connection = await pool.getConnection()

  try {
    const { id } = req.params
    const [beforeRows] = await connection.execute('SELECT * FROM customer_tags WHERE id = ? LIMIT 1', [id])
    if (!beforeRows[0]) {
      return res.status(404).json({ message: 'Tag not found.' })
    }

    await connection.beginTransaction()
    await connection.execute('DELETE FROM customer_tag_assignments WHERE tag_id = ?', [id])
    await connection.execute('UPDATE customer_tags SET is_active = 0 WHERE id = ?', [id])
    await connection.commit()

    await logAdminAction(req, {
      action: 'delete_tag',
      entityType: 'system',
      entityId: Number(id),
      beforeData: beforeRows[0],
    })

    return res.status(204).send()
  } catch (error) {
    await connection.rollback()
    return next(error)
  } finally {
    connection.release()
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

async function initializeCustomerWorkflow(connection, customerWorkflowId, templateId, firstPhaseId) {
  const [phases] = await connection.execute(
    `SELECT workflow_phases.id
     FROM workflow_stages
     INNER JOIN workflow_phases ON workflow_phases.stage_id = workflow_stages.id
     WHERE workflow_stages.template_id = ?
     ORDER BY workflow_phases.global_order ASC, workflow_phases.sort_order ASC`,
    [templateId],
  )

  for (const phase of phases) {
    const [phaseStateResult] = await connection.execute(
      `INSERT INTO customer_phase_states (customer_workflow_id, phase_id, status)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status)`,
      [customerWorkflowId, phase.id, phase.id === firstPhaseId ? 'active' : 'locked'],
    )

    const phaseStateId = phaseStateResult.insertId || (await connection.execute(
      `SELECT id
       FROM customer_phase_states
       WHERE customer_workflow_id = ? AND phase_id = ?
       LIMIT 1`,
      [customerWorkflowId, phase.id],
    ))[0][0].id

    const [branches] = await connection.execute(
      'SELECT id FROM workflow_phase_branches WHERE phase_id = ? ORDER BY sort_order ASC',
      [phase.id],
    )

    for (const branch of branches) {
      const [branchStateResult] = await connection.execute(
        `INSERT INTO customer_branch_states (customer_phase_state_id, branch_id, status)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE status = VALUES(status)`,
        [phaseStateId, branch.id, phase.id === firstPhaseId ? 'active' : 'waiting'],
      )

      const branchStateId = branchStateResult.insertId || (await connection.execute(
        `SELECT id
         FROM customer_branch_states
         WHERE customer_phase_state_id = ? AND branch_id = ?
         LIMIT 1`,
        [phaseStateId, branch.id],
      ))[0][0].id

      const [items] = await connection.execute(
        'SELECT id FROM workflow_checklist_items WHERE branch_id = ? ORDER BY sort_order ASC',
        [branch.id],
      )

      for (const item of items) {
        await connection.execute(
          `INSERT INTO customer_checklist_states (customer_branch_state_id, checklist_item_id)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE checklist_item_id = VALUES(checklist_item_id)`,
          [branchStateId, item.id],
        )
      }
    }
  }
}

async function getDefaultSourceFlowId(connection) {
  const [rows] = await connection.execute(
    `SELECT id
     FROM workflow_templates
     WHERE code = 'OEM_FLOW'
     ORDER BY version DESC
     LIMIT 1`,
  )

  return rows[0]?.id || null
}

async function createFlowTemplateFromSource(connection, { name, sourceFlowId }) {
  const resolvedSourceFlowId = sourceFlowId || await getDefaultSourceFlowId(connection)
  if (!resolvedSourceFlowId) {
    const error = new Error('No source flow template is available.')
    error.statusCode = 400
    throw error
  }

  const [sourceRows] = await connection.execute(
    'SELECT id FROM workflow_templates WHERE id = ? LIMIT 1',
    [resolvedSourceFlowId],
  )
  if (!sourceRows[0]) {
    const error = new Error('Source flow not found.')
    error.statusCode = 404
    throw error
  }

  const code = await makeUniqueFlowCode(connection, name)
  const [result] = await connection.execute(
    `INSERT INTO workflow_templates (parent_template_id, code, name, version, status, is_active)
     VALUES (?, ?, ?, 1, 'draft', 0)`,
    [resolvedSourceFlowId, code, name],
  )

  await cloneFlowTemplate(connection, resolvedSourceFlowId, result.insertId)

  return {
    id: result.insertId,
    code,
    sourceFlowId: resolvedSourceFlowId,
  }
}

async function createCustomerProjectForFlow(connection, { createdByUserId, flowId, name }) {
  const [firstPhaseRows] = await connection.execute(
    `SELECT workflow_phases.id
     FROM workflow_stages
     INNER JOIN workflow_phases ON workflow_phases.stage_id = workflow_stages.id
     WHERE workflow_stages.template_id = ?
     ORDER BY workflow_phases.global_order ASC, workflow_phases.sort_order ASC
     LIMIT 1`,
    [flowId],
  )

  if (!firstPhaseRows[0]) {
    const error = new Error('Selected flow has no phases.')
    error.statusCode = 400
    throw error
  }

  const slug = await makeUniqueCustomerSlug(connection, name)
  const [customerResult] = await connection.execute(
    `INSERT INTO customers (slug, name, status, created_by)
     VALUES (?, ?, 'brief_spec', ?)`,
    [slug, name, createdByUserId],
  )

  const [workflowResult] = await connection.execute(
    `INSERT INTO customer_workflows (customer_id, template_id, current_phase_id, status)
     VALUES (?, ?, ?, 'active')`,
    [customerResult.insertId, flowId, firstPhaseRows[0].id],
  )

  await initializeCustomerWorkflow(connection, workflowResult.insertId, flowId, firstPhaseRows[0].id)

  return {
    id: customerResult.insertId,
    firstPhaseId: firstPhaseRows[0].id,
    name,
    slug,
  }
}

async function createCustomer(req, res, next) {
  const connection = await pool.getConnection()

  try {
    const { flowId, name } = req.body
    if (!name) return res.status(400).json({ message: 'name is required.' })

    await connection.beginTransaction()

    const templateId = flowId || await getDefaultSourceFlowId(connection)
    if (!templateId) {
      await connection.rollback()
      return res.status(400).json({ message: 'No flow template is available.' })
    }

    const customer = await createCustomerProjectForFlow(connection, {
      createdByUserId: req.user.id,
      flowId: templateId,
      name,
    })
    const notification = await getPhaseNotificationContext(connection, {
      customerId: customer.id,
      phaseId: customer.firstPhaseId,
    })

    await connection.commit()

    await logAdminAction(req, {
      action: 'create_customer',
      entityType: 'system',
      entityId: customer.id,
      afterData: { flowId: templateId, name, slug: customer.slug },
    })

    await sendCustomerCreatedNotification({
      actorUserId: req.user.id,
      notification,
    })

    return res.status(201).json(customer)
  } catch (error) {
    await connection.rollback()
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message })
    }
    return next(error)
  } finally {
    connection.release()
  }
}

async function createProjectWithFlow(req, res, next) {
  const connection = await pool.getConnection()

  try {
    const { flowName, projectName, sourceFlowId } = req.body
    if (!projectName || !flowName) {
      return res.status(400).json({ message: 'projectName and flowName are required.' })
    }

    await connection.beginTransaction()

    const flow = await createFlowTemplateFromSource(connection, {
      name: flowName,
      sourceFlowId,
    })
    const customer = await createCustomerProjectForFlow(connection, {
      createdByUserId: req.user.id,
      flowId: flow.id,
      name: projectName,
    })

    const notification = await getPhaseNotificationContext(connection, {
      customerId: customer.id,
      phaseId: customer.firstPhaseId,
    })

    await connection.commit()

    await logAdminAction(req, {
      action: 'create_project_with_flow',
      entityType: 'system',
      entityId: customer.id,
      afterData: {
        flowId: flow.id,
        flowName,
        projectName,
        sourceFlowId: flow.sourceFlowId,
      },
    })

    await sendCustomerCreatedNotification({
      actorUserId: req.user.id,
      notification,
    })

    return res.status(201).json({
      flow,
      project: customer,
    })
  } catch (error) {
    await connection.rollback()
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message })
    }
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'A duplicate flow or project already exists.' })
    }
    return next(error)
  } finally {
    connection.release()
  }
}

async function updateCustomer(req, res, next) {
  const connection = await pool.getConnection()

  try {
    const { id } = req.params
    const { costPackage, costSyrup, dueDate, name, price, salesperson, status, tagsText, volume } = req.body

    if (status && !(await customerStatusExists(connection, status))) {
      return res.status(400).json({ message: 'Invalid customer status.' })
    }

    const [beforeRows] = await connection.execute('SELECT * FROM customers WHERE id = ? LIMIT 1', [id])
    if (!beforeRows[0]) return res.status(404).json({ message: 'Customer not found.' })

    await connection.beginTransaction()

    const updates = []
    const values = []

    if (name !== undefined) {
      updates.push('name = ?')
      values.push(name)
    }
    if (status !== undefined) {
      updates.push('status = ?')
      values.push(status)
    }
    if (costSyrup !== undefined) {
      updates.push('cost_syrup = ?')
      values.push(normalizeNullableDecimal(costSyrup))
    }
    if (costPackage !== undefined) {
      updates.push('cost_package = ?')
      values.push(normalizeNullableDecimal(costPackage))
    }
    if (price !== undefined) {
      updates.push('price = ?')
      values.push(normalizeNullableDecimal(price))
    }
    if (volume !== undefined) {
      updates.push('volume = ?')
      values.push(normalizeNullableDecimal(volume))
    }
    if (dueDate !== undefined) {
      updates.push('due_date = ?')
      values.push(normalizeDueDate(dueDate))
    }
    if (salesperson !== undefined) {
      updates.push('salesperson = ?')
      values.push(normalizeNullableText(salesperson))
    }

    if (updates.length > 0) {
      await connection.execute(
        `UPDATE customers
         SET ${updates.join(', ')}
         WHERE id = ?`,
        [...values, id],
      )
    }

    if (tagsText !== undefined) {
      await replaceCustomerTags(connection, id, tagsText)
    }

    await connection.commit()

    await logAdminAction(req, {
      action: 'update_customer',
      entityType: 'system',
      entityId: Number(id),
      beforeData: beforeRows[0],
      afterData: { costPackage, costSyrup, dueDate, name, price, salesperson, status, tagsText, volume },
    })

    return res.status(204).send()
  } catch (error) {
    await connection.rollback()
    return next(error)
  } finally {
    connection.release()
  }
}

async function deleteCustomer(req, res, next) {
  try {
    const { id } = req.params
    const [beforeRows] = await pool.execute('SELECT * FROM customers WHERE id = ? LIMIT 1', [id])
    if (!beforeRows[0]) return res.status(404).json({ message: 'Customer not found.' })

    await pool.execute('DELETE FROM customers WHERE id = ?', [id])

    await logAdminAction(req, {
      action: 'delete_customer',
      entityType: 'system',
      entityId: Number(id),
      beforeData: beforeRows[0],
    })

    return res.status(204).send()
  } catch (error) {
    return next(error)
  }
}

async function createFlow(req, res, next) {
  const connection = await pool.getConnection()

  try {
    const { name, sourceFlowId } = req.body
    if (!name) {
      return res.status(400).json({ message: 'name is required.' })
    }

    await connection.beginTransaction()

    const flow = await createFlowTemplateFromSource(connection, { name, sourceFlowId })
    await connection.commit()

    await logAdminAction(req, {
      action: 'create_flow',
      entityType: 'system',
      entityId: flow.id,
      afterData: { name, sourceFlowId: flow.sourceFlowId },
    })

    return res.status(201).json({ id: flow.id })
  } catch (error) {
    await connection.rollback()
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message })
    }
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'A flow with this code and version already exists.' })
    }
    return next(error)
  } finally {
    connection.release()
  }
}

async function updateFlow(req, res, next) {
  try {
    const { id } = req.params
    const { name, status } = req.body

    const [beforeRows] = await pool.execute('SELECT * FROM workflow_templates WHERE id = ? LIMIT 1', [id])
    if (!beforeRows[0]) return res.status(404).json({ message: 'Flow not found.' })

    await pool.execute(
      `UPDATE workflow_templates
       SET name = COALESCE(?, name),
           status = COALESCE(?, status),
           is_active = CASE
             WHEN ? = 'active' THEN 1
             WHEN ? IN ('draft', 'inactive') THEN 0
             ELSE is_active
           END
       WHERE id = ?`,
      [name ?? null, status ?? null, status ?? null, status ?? null, id],
    )

    await logAdminAction(req, {
      action: 'update_flow',
      entityType: 'system',
      entityId: Number(id),
      beforeData: beforeRows[0],
      afterData: { name, status },
    })

    return res.status(204).send()
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'A flow with this code and version already exists.' })
    }
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
  createCustomer,
  createCustomerStatus,
  createFlow,
  createProjectWithFlow,
  createUser,
  deleteCustomerStatus,
  deleteTag,
  deleteUser,
  deleteCustomer,
  deleteFlow,
  getFlowStructure,
  listCustomers,
  listCustomerStatuses,
  listDepartments,
  listFlows,
  listTags,
  listUsers,
  updateCustomerStatus,
  updateTag,
  updateCustomer,
  updateDepartment,
  updateFlow,
  updateFlowStructure,
  updateUser,
}
