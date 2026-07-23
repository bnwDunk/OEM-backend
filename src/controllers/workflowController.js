const pool = require('../config/db')
const { sendPhaseAdvancedEmail, sendTicketCreatedEmail } = require('../services/mailService')

function formatMoney(value) {
  if (value === null || value === undefined) return ''
  return Number(value).toFixed(2)
}

function formatVolume(value) {
  if (value === null || value === undefined) return ''
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
  }).format(Number(value))
}

function formatDateInput(value) {
  if (!value) return ''
  if (typeof value === 'string') return value.slice(0, 10)
  return value.toISOString().slice(0, 10)
}

function formatRelativeTime(value) {
  if (!value) return ''

  const createdAt = new Date(value).getTime()
  const diffMs = Date.now() - createdAt
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000))

  if (diffMinutes < 1) return 'เมื่อสักครู่'
  if (diffMinutes < 60) return `${diffMinutes} นาทีที่แล้ว`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} ชม.ที่แล้ว`

  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays} วันที่แล้ว`
}

function groupByCustomerId(rows) {
  return rows.reduce((groups, row) => {
    const customerId = String(row.customer_id)
    if (!groups.has(customerId)) groups.set(customerId, [])
    groups.get(customerId).push(row)
    return groups
  }, new Map())
}

function normalizeColor(color) {
  const value = String(color || '').trim()
  return /^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#0f766e'
}

const allowedCustomerFileTypes = new Set([
  'application/pdf',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
])
const maxCustomerFileSize = 10 * 1024 * 1024

function customerFileMatchesType(buffer, mimeType) {
  if (mimeType === 'application/pdf') return buffer.subarray(0, 5).toString() === '%PDF-'
  if (mimeType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  if (mimeType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (mimeType === 'image/gif') return ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString())
  if (mimeType === 'image/webp') return buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP'
  return false
}

function normalizeCustomerFileName(value) {
  return String(value || 'file')
    .replace(/[\\/\u0000-\u001f\u007f]/g, '_')
    .trim()
    .slice(0, 255) || 'file'
}

function mapCustomerStatus(row) {
  return {
    id: row.id,
    value: row.value,
    label: row.label,
    sortOrder: Number(row.sort_order || 0),
    status: row.is_active ? 'active' : 'inactive',
  }
}

function mapWorkflowFlow(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    phaseCount: Number(row.phase_count || 0),
    stageCount: Number(row.stage_count || 0),
    status: row.status || (row.is_active ? 'active' : 'inactive'),
  }
}

function groupWorkflowStateRows(rows) {
  return rows.reduce((groups, row) => {
    const customerId = String(row.customer_id)
    if (!groups.has(customerId)) {
      groups.set(customerId, {
        branch: [],
        workflowBranches: [],
        singleResets: {},
      })
    }

    const state = groups.get(customerId)
    const phaseIndex = Math.max(0, Number(row.global_order || 1) - 1)
    const branchIndex = Math.max(0, Number(row.branch_position || 1) - 1)
    const itemIndex = Math.max(0, Number(row.item_position || 1) - 1)

    if (!state.branch[phaseIndex]) state.branch[phaseIndex] = []
    if (!state.branch[phaseIndex][branchIndex]) {
      state.branch[phaseIndex][branchIndex] = {
        live: [],
        saved: [],
        done: row.branch_status === 'done',
      }
    }
    if (!state.workflowBranches[phaseIndex]) state.workflowBranches[phaseIndex] = []
    if (!state.workflowBranches[phaseIndex][branchIndex]) {
      state.workflowBranches[phaseIndex][branchIndex] = {
        dept: row.department_name || '',
        items: [],
      }
    }

    state.branch[phaseIndex][branchIndex].live[itemIndex] = Boolean(row.live_checked)
    state.branch[phaseIndex][branchIndex].saved[itemIndex] = Boolean(row.saved_checked)
    state.branch[phaseIndex][branchIndex].done = row.branch_status === 'done'
    state.workflowBranches[phaseIndex][branchIndex].items[itemIndex] = row.checklist_label || `Checklist ${itemIndex + 1}`

    if (row.phase_status === 'reset') {
      state.singleResets[phaseIndex] = true
    }

    return groups
  }, new Map())
}

async function getBranchContext(connection, { branchIndex, customerId, phaseIndex }) {
  const [rows] = await connection.execute(
    `SELECT
       customers.id AS customer_id,
       customer_workflows.id AS customer_workflow_id,
       customer_workflows.current_phase_id,
       customer_phase_states.id AS customer_phase_state_id,
       customer_phase_states.status AS phase_status,
       workflow_phases.id AS phase_id,
       workflow_phases.name AS phase_name,
       workflow_phases.global_order,
       workflow_phase_branches.id AS branch_id,
       workflow_phase_branches.department_id,
       departments.name AS department_name,
       customer_branch_states.id AS customer_branch_state_id,
       customer_branch_states.status AS branch_status
     FROM customers
     INNER JOIN customer_workflows
       ON customer_workflows.customer_id = customers.id
      AND customer_workflows.status = 'active'
     INNER JOIN workflow_phases
       ON workflow_phases.global_order = ?
     INNER JOIN workflow_stages
       ON workflow_stages.id = workflow_phases.stage_id
      AND workflow_stages.template_id = customer_workflows.template_id
     INNER JOIN customer_phase_states
       ON customer_phase_states.customer_workflow_id = customer_workflows.id
      AND customer_phase_states.phase_id = workflow_phases.id
     INNER JOIN (
       SELECT
         workflow_phase_branches.*,
         ROW_NUMBER() OVER (PARTITION BY workflow_phase_branches.phase_id ORDER BY workflow_phase_branches.sort_order ASC, workflow_phase_branches.id ASC) AS branch_position
       FROM workflow_phase_branches
     ) AS workflow_phase_branches
       ON workflow_phase_branches.phase_id = workflow_phases.id
      AND workflow_phase_branches.branch_position = ?
     INNER JOIN departments
       ON departments.id = workflow_phase_branches.department_id
     INNER JOIN customer_branch_states
       ON customer_branch_states.customer_phase_state_id = customer_phase_states.id
      AND customer_branch_states.branch_id = workflow_phase_branches.id
     WHERE customers.id = ?
     LIMIT 1`,
    [Number(phaseIndex) + 1, Number(branchIndex) + 1, customerId],
  )

  return rows[0] || null
}

async function getBranchChecklist(connection, branchStateId) {
  const [rows] = await connection.execute(
    `SELECT
       customer_checklist_states.id,
       workflow_checklist_items.id AS checklist_item_id
     FROM customer_checklist_states
     INNER JOIN workflow_checklist_items
       ON workflow_checklist_items.id = customer_checklist_states.checklist_item_id
     WHERE customer_checklist_states.customer_branch_state_id = ?
     ORDER BY workflow_checklist_items.sort_order ASC, workflow_checklist_items.id ASC`,
    [branchStateId],
  )

  return rows
}

function assertDepartmentCanManage(req, branchContext) {
  const departmentIds = new Set((req.user.departmentIds || []).map((departmentId) => Number(departmentId)))
  if (req.user.departmentId) departmentIds.add(Number(req.user.departmentId))

  if (!departmentIds.has(Number(branchContext.department_id))) {
    const error = new Error('This branch can only be updated by its assigned department.')
    error.status = 403
    throw error
  }
}

function assertBranchCanUpdate(branchContext) {
  if (!['active', 'reset'].includes(branchContext.phase_status)) {
    const error = new Error('This phase is not active.')
    error.status = 409
    throw error
  }

  if (branchContext.branch_status === 'done') {
    const error = new Error('This branch is already done.')
    error.status = 409
    throw error
  }
}

async function updateChecklist(connection, { branchStateId, checkedValues, markSaved, userId }) {
  const checklistRows = await getBranchChecklist(connection, branchStateId)

  if (!Array.isArray(checkedValues) || checkedValues.length !== checklistRows.length) {
    const error = new Error('Checklist state does not match this branch.')
    error.status = 400
    throw error
  }

  if (checklistRows.length === 0) return

  const liveCases = []
  const liveParams = []
  const savedCases = []
  const savedParams = []
  const ids = []

  for (const [index, item] of checklistRows.entries()) {
    const checked = checkedValues[index] ? 1 : 0
    liveCases.push('WHEN ? THEN ?')
    liveParams.push(item.id, checked)
    if (markSaved) {
      savedCases.push('WHEN ? THEN ?')
      savedParams.push(item.id, checked)
    }
    ids.push(item.id)
  }

  const savedCheckedSql = markSaved
    ? `saved_checked = CASE id ${savedCases.join(' ')} ELSE saved_checked END,`
    : ''
  const placeholders = ids.map(() => '?').join(', ')

  await connection.execute(
    `UPDATE customer_checklist_states
     SET
       live_checked = CASE id ${liveCases.join(' ')} ELSE live_checked END,
       ${savedCheckedSql}
       checked_by_user_id = ?,
       checked_at = NOW()
     WHERE id IN (${placeholders})`,
    [
      ...liveParams,
      ...savedParams,
      userId,
      ...ids,
    ],
  )
}

async function listFlows(req, res, next) {
  try {
    const [rows] = await pool.execute(
      `SELECT
         workflow_templates.id,
         workflow_templates.code,
         workflow_templates.name,
         workflow_templates.status,
         workflow_templates.is_active,
         COUNT(DISTINCT workflow_stages.id) AS stage_count,
         COUNT(DISTINCT workflow_phases.id) AS phase_count
       FROM workflow_templates
       LEFT JOIN workflow_stages
         ON workflow_stages.template_id = workflow_templates.id
       LEFT JOIN workflow_phases
         ON workflow_phases.stage_id = workflow_stages.id
       WHERE workflow_templates.is_active = 1
         AND workflow_templates.status = 'active'
       GROUP BY workflow_templates.id
       ORDER BY workflow_templates.id ASC`,
    )

    return res.json({ flows: rows.map(mapWorkflowFlow) })
  } catch (error) {
    return next(error)
  }
}

async function getFlowStructure(req, res, next) {
  try {
    const { id } = req.params
    const [flowRows] = await pool.execute(
      `SELECT id, code, name
       FROM workflow_templates
       WHERE id = ?
         AND is_active = 1
         AND status = 'active'
       LIMIT 1`,
      [id],
    )

    if (!flowRows[0]) return res.status(404).json({ message: 'Workflow not found.' })

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
             workflow_phase_branches.id,
             workflow_phase_branches.department_id,
             departments.name AS department_name
           FROM workflow_phase_branches
           INNER JOIN departments
             ON departments.id = workflow_phase_branches.department_id
            AND departments.is_active = 1
           WHERE workflow_phase_branches.phase_id IN (${phasePlaceholders})
           ORDER BY workflow_phase_branches.sort_order ASC, departments.name ASC`,
          phaseIds,
        )

        departmentsByPhase = branchRows.reduce((groups, branch) => {
          if (!groups.has(branch.phase_id)) groups.set(branch.phase_id, [])
          groups.get(branch.phase_id).push({
            id: branch.department_id,
            name: branch.department_name,
          })
          return groups
        }, new Map())

        const branchIds = branchRows.map((branch) => branch.id)
        let itemsByBranch = new Map()

        if (branchIds.length > 0) {
          const branchPlaceholders = branchIds.map(() => '?').join(', ')
          const [itemRows] = await pool.execute(
            `SELECT id, branch_id, label, sort_order
             FROM workflow_checklist_items
             WHERE branch_id IN (${branchPlaceholders})
             ORDER BY sort_order ASC, id ASC`,
            branchIds,
          )

          itemsByBranch = itemRows.reduce((groups, item) => {
            if (!groups.has(item.branch_id)) groups.set(item.branch_id, [])
            groups.get(item.branch_id).push({
              id: item.id,
              label: item.label,
              sortOrder: Number(item.sort_order || 0),
            })
            return groups
          }, new Map())
        }

        const branchesByPhase = branchRows.reduce((groups, branch) => {
          if (!groups.has(branch.phase_id)) groups.set(branch.phase_id, [])
          groups.get(branch.phase_id).push({
            id: branch.id,
            department: {
              id: branch.department_id,
              name: branch.department_name,
            },
            departmentId: branch.department_id,
            departmentName: branch.department_name,
            items: itemsByBranch.get(branch.id) || [],
          })
          return groups
        }, new Map())

        departmentsByPhase.branchesByPhase = branchesByPhase
      }

      phasesByStage = phaseRows.reduce((groups, phase) => {
        if (!groups.has(phase.stage_id)) groups.set(phase.stage_id, [])
        groups.get(phase.stage_id).push({
          id: phase.id,
          label: phase.label,
          name: phase.name,
          departments: departmentsByPhase.get(phase.id) || [],
          branches: departmentsByPhase.branchesByPhase?.get(phase.id) || [],
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

async function updateFlowBranchItems(req, res, next) {
  const connection = await pool.getConnection()

  try {
    const { branchId, flowId, phaseId } = req.params
    const items = Array.isArray(req.body.items) ? req.body.items : []
    const departmentIds = new Set((req.user.departmentIds || []).map((departmentId) => Number(departmentId)))
    if (req.user.departmentId) departmentIds.add(Number(req.user.departmentId))

    if (departmentIds.size === 0) {
      return res.status(403).json({ message: 'No department is assigned to this user.' })
    }

    const labels = items.map((item) => String(item.label || '').trim())
    if (labels.some((label) => !label)) {
      return res.status(400).json({ message: 'Work label is required.' })
    }

    const [branchRows] = await connection.execute(
      `SELECT
         workflow_phase_branches.id,
         workflow_phase_branches.department_id,
         workflow_phases.id AS phase_id,
         workflow_stages.template_id
       FROM workflow_phase_branches
       INNER JOIN workflow_phases
         ON workflow_phases.id = workflow_phase_branches.phase_id
       INNER JOIN workflow_stages
         ON workflow_stages.id = workflow_phases.stage_id
       INNER JOIN workflow_templates
         ON workflow_templates.id = workflow_stages.template_id
        AND workflow_templates.is_active = 1
        AND workflow_templates.status = 'active'
       WHERE workflow_stages.template_id = ?
         AND workflow_phases.id = ?
         AND workflow_phase_branches.id = ?
       LIMIT 1`,
      [flowId, phaseId, branchId],
    )

    const branch = branchRows[0]
    if (!branch) return res.status(404).json({ message: 'Workflow branch not found.' })

    if (!departmentIds.has(Number(branch.department_id))) {
      return res.status(403).json({ message: 'This work can only be updated by its assigned department.' })
    }

    await connection.beginTransaction()

    const [existingItems] = await connection.execute(
      'SELECT id FROM workflow_checklist_items WHERE branch_id = ? ORDER BY sort_order ASC, id ASC',
      [branchId],
    )
    const requestedIds = new Set(items.map((item) => Number(item.id)).filter(Boolean))

    for (const item of existingItems) {
      if (!requestedIds.has(Number(item.id))) {
        await connection.execute('DELETE FROM workflow_checklist_items WHERE id = ? AND branch_id = ?', [item.id, branchId])
      }
    }

    const savedItems = []

    for (const [index, item] of items.entries()) {
      const itemId = Number(item.id) || null
      const sortOrder = (index + 1) * 10
      const label = String(item.label || '').trim()

      if (itemId) {
        await connection.execute(
          `UPDATE workflow_checklist_items
           SET label = ?, sort_order = ?, is_required = 1
           WHERE id = ? AND branch_id = ?`,
          [label, sortOrder, itemId, branchId],
        )
        savedItems.push({ id: itemId, label, sortOrder })
      } else {
        const [result] = await connection.execute(
          `INSERT INTO workflow_checklist_items (branch_id, label, sort_order, is_required)
           VALUES (?, ?, ?, 1)`,
          [branchId, label, sortOrder],
        )
        const newItemId = result.insertId
        savedItems.push({ id: newItemId, label, sortOrder })

        await connection.execute(
          `INSERT IGNORE INTO customer_checklist_states (customer_branch_state_id, checklist_item_id)
           SELECT customer_branch_states.id, ?
           FROM customer_branch_states
           INNER JOIN customer_phase_states
             ON customer_phase_states.id = customer_branch_states.customer_phase_state_id
           INNER JOIN customer_workflows
             ON customer_workflows.id = customer_phase_states.customer_workflow_id
           WHERE customer_workflows.template_id = ?
             AND customer_phase_states.phase_id = ?
             AND customer_branch_states.branch_id = ?`,
          [newItemId, flowId, phaseId, branchId],
        )
      }
    }

    await connection.execute(
      'UPDATE workflow_templates SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [flowId],
    )

    await connection.commit()

    return res.json({ items: savedItems })
  } catch (error) {
    await connection.rollback()
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Work order is duplicated.' })
    }
    return next(error)
  } finally {
    connection.release()
  }
}

async function getPhaseNotificationContext(connection, { customerId, customerWorkflowId, phaseId }) {
  const [phaseRows] = await connection.execute(
    `SELECT
       workflow_phases.id,
       workflow_phases.label,
       workflow_phases.name,
       workflow_phases.global_order,
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
     INNER JOIN customer_workflows
       ON customer_workflows.template_id = workflow_stages.template_id
     WHERE customer_workflows.id = ?
       AND workflow_phases.id = ?
     LIMIT 1`,
    [customerWorkflowId, phaseId],
  )

  if (!phaseRows[0]) return null

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

  const [customerRows] = await connection.execute(
    `SELECT id, name, slug
     FROM customers
     WHERE id = ?
     LIMIT 1`,
    [customerId],
  )
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
    customer: customerRows[0] || null,
    phase: {
      ...phaseRows[0],
      departments: departmentRows.map((row) => row.name),
      departmentRecipients: [...recipientsByDepartment.values()],
    },
    recipients: recipientRows.map((row) => row.email),
  }
}

async function advanceWorkflowIfPhaseDone(connection, branchContext) {
  const [openBranchRows] = await connection.execute(
    `SELECT COUNT(*) AS open_count
     FROM customer_branch_states
     WHERE customer_phase_state_id = ?
       AND status <> 'done'`,
    [branchContext.customer_phase_state_id],
  )

  if (Number(openBranchRows[0].open_count) > 0) {
    return { advanced: false, completed: false, notification: null }
  }

  await connection.execute(
    `UPDATE customer_phase_states
     SET status = 'done', completed_at = NOW()
     WHERE id = ?`,
    [branchContext.customer_phase_state_id],
  )

  const [currentPhaseRows] = await connection.execute(
    `SELECT workflow_phases.global_order
     FROM customer_workflows
     INNER JOIN workflow_phases
       ON workflow_phases.id = customer_workflows.current_phase_id
     WHERE customer_workflows.id = ?
     LIMIT 1`,
    [branchContext.customer_workflow_id],
  )
  const currentPhaseOrder = Number(currentPhaseRows[0]?.global_order || 0)

  if (branchContext.phase_status === 'reset' && currentPhaseOrder > Number(branchContext.global_order)) {
    return { advanced: false, completed: false, notification: null }
  }

  const [nextPhaseRows] = await connection.execute(
    `SELECT workflow_phases.id
     FROM workflow_phases
     INNER JOIN workflow_stages
       ON workflow_stages.id = workflow_phases.stage_id
     INNER JOIN customer_workflows
       ON customer_workflows.template_id = workflow_stages.template_id
     WHERE customer_workflows.id = ?
       AND workflow_phases.global_order > ?
     ORDER BY workflow_phases.global_order ASC, workflow_phases.sort_order ASC
     LIMIT 1`,
    [branchContext.customer_workflow_id, branchContext.global_order],
  )

  if (!nextPhaseRows[0]) {
    await connection.execute(
      `UPDATE customer_workflows
       SET current_phase_id = NULL, status = 'completed', completed_at = NOW()
       WHERE id = ?`,
      [branchContext.customer_workflow_id],
    )
    return { advanced: true, completed: true, notification: null }
  }

  await connection.execute(
    `UPDATE customer_workflows
     SET current_phase_id = ?
     WHERE id = ?`,
    [nextPhaseRows[0].id, branchContext.customer_workflow_id],
  )

  await connection.execute(
    `UPDATE customer_phase_states
     SET status = 'active'
     WHERE customer_workflow_id = ?
       AND phase_id = ?`,
    [branchContext.customer_workflow_id, nextPhaseRows[0].id],
  )

  await connection.execute(
    `UPDATE customer_branch_states
     INNER JOIN customer_phase_states
       ON customer_phase_states.id = customer_branch_states.customer_phase_state_id
     SET customer_branch_states.status = 'active'
     WHERE customer_phase_states.customer_workflow_id = ?
       AND customer_phase_states.phase_id = ?`,
    [branchContext.customer_workflow_id, nextPhaseRows[0].id],
  )

  const notification = await getPhaseNotificationContext(connection, {
    customerId: branchContext.customer_id,
    customerWorkflowId: branchContext.customer_workflow_id,
    phaseId: nextPhaseRows[0].id,
  })

  return { advanced: true, completed: false, notification }
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

async function sendPhaseAdvancedNotification({ actorUserId, notification }) {
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
  } catch (emailError) {
    await recordEmailNotificationResult({
      actorUserId,
      error: emailError,
      notification,
    })
  }
}

async function listOverview(req, res, next) {
  try {
    const [customerRows] = await pool.execute(
      `SELECT
         customers.id,
         customers.slug,
         customers.customer_code,
         customers.name,
         customers.status,
         customers.cost_syrup,
         customers.cost_package,
         customers.price,
         customers.volume,
         customers.due_date,
         customers.salesperson,
         COALESCE(current_phase.global_order, first_phase.global_order, 0) AS current_phase_order
       FROM customers
       LEFT JOIN customer_workflows
         ON customer_workflows.customer_id = customers.id
        AND customer_workflows.status = 'active'
       LEFT JOIN workflow_phases AS current_phase
         ON current_phase.id = customer_workflows.current_phase_id
       LEFT JOIN (
         SELECT workflow_stages.template_id, MIN(workflow_phases.global_order) AS global_order
         FROM workflow_stages
         INNER JOIN workflow_phases ON workflow_phases.stage_id = workflow_stages.id
         GROUP BY workflow_stages.template_id
       ) AS first_phase
         ON first_phase.template_id = customer_workflows.template_id
       ORDER BY customers.updated_at DESC, customers.id DESC`,
    )

    const customerIds = customerRows.map((row) => row.id)
    if (customerIds.length === 0) {
      return res.json({ customers: [] })
    }

    const placeholders = customerIds.map(() => '?').join(', ')
    const [tagRows] = await pool.execute(
      `SELECT
         customer_tag_assignments.customer_id,
         customer_tags.id,
         customer_tags.name,
         customer_tags.color
       FROM customer_tag_assignments
       INNER JOIN customer_tags
         ON customer_tags.id = customer_tag_assignments.tag_id
       WHERE customer_tag_assignments.customer_id IN (${placeholders})
         AND customer_tags.is_active = 1
       ORDER BY customer_tags.name ASC`,
      customerIds,
    )

    const [fileRows] = await pool.execute(
      `SELECT id, customer_id, original_name, mime_type, file_size, created_at
       FROM customer_files
       WHERE customer_id IN (${placeholders})
       ORDER BY created_at DESC, id DESC`,
      customerIds,
    )

    const [notificationRows] = await pool.execute(
      `SELECT id, customer_id, message, read_at, created_at
       FROM workflow_notifications
       WHERE customer_id IN (${placeholders})
       ORDER BY created_at DESC, id DESC`,
      customerIds,
    )

    const [issueRows] = await pool.execute(
      `SELECT
         workflow_issues.customer_id,
         workflow_issues.opened_by_name,
         workflow_issues.message,
         workflow_issues.status,
         workflow_issues.created_at,
         workflow_phases.global_order AS phase_order,
         opened_departments.name AS opened_by_department,
         target_departments.name AS target_department
       FROM workflow_issues
       LEFT JOIN workflow_phases
         ON workflow_phases.id = workflow_issues.phase_id
       INNER JOIN departments AS opened_departments
         ON opened_departments.id = workflow_issues.opened_by_department_id
       INNER JOIN departments AS target_departments
         ON target_departments.id = workflow_issues.target_department_id
       WHERE workflow_issues.customer_id IN (${placeholders})
       ORDER BY workflow_issues.created_at DESC, workflow_issues.id DESC`,
      customerIds,
    )

    const [workflowStateRows] = await pool.execute(
      `SELECT
         customer_workflows.customer_id,
         workflow_phases.global_order,
         customer_phase_states.status AS phase_status,
         customer_branch_states.status AS branch_status,
         departments.name AS department_name,
         workflow_checklist_items.label AS checklist_label,
         customer_checklist_states.live_checked,
         customer_checklist_states.saved_checked,
         DENSE_RANK() OVER (
           PARTITION BY workflow_phases.id
           ORDER BY workflow_phase_branches.sort_order ASC, workflow_phase_branches.id ASC
         ) AS branch_position,
         ROW_NUMBER() OVER (
           PARTITION BY customer_branch_states.id
           ORDER BY workflow_checklist_items.sort_order ASC, workflow_checklist_items.id ASC
         ) AS item_position
       FROM customer_workflows
       INNER JOIN customer_phase_states
         ON customer_phase_states.customer_workflow_id = customer_workflows.id
       INNER JOIN workflow_phases
         ON workflow_phases.id = customer_phase_states.phase_id
       INNER JOIN customer_branch_states
         ON customer_branch_states.customer_phase_state_id = customer_phase_states.id
       INNER JOIN workflow_phase_branches
         ON workflow_phase_branches.id = customer_branch_states.branch_id
       INNER JOIN departments
         ON departments.id = workflow_phase_branches.department_id
       INNER JOIN customer_checklist_states
         ON customer_checklist_states.customer_branch_state_id = customer_branch_states.id
       INNER JOIN workflow_checklist_items
         ON workflow_checklist_items.id = customer_checklist_states.checklist_item_id
       WHERE customer_workflows.customer_id IN (${placeholders})
         AND customer_workflows.status = 'active'
       ORDER BY workflow_phases.global_order ASC,
         workflow_phase_branches.sort_order ASC,
         workflow_checklist_items.sort_order ASC`,
      customerIds,
    )

    const tagsByCustomer = groupByCustomerId(tagRows)
    const filesByCustomer = groupByCustomerId(fileRows)
    const notificationsByCustomer = groupByCustomerId(notificationRows)
    const issuesByCustomer = groupByCustomerId(issueRows)
    const workflowStateByCustomer = groupWorkflowStateRows(workflowStateRows)

    return res.json({
      customers: customerRows.map((row) => {
        const customerId = String(row.id)
        const workflowState = workflowStateByCustomer.get(customerId)

        return {
          id: row.slug || customerId,
          databaseId: row.id,
          customerCode: row.customer_code,
          name: row.name,
          dueDate: formatDateInput(row.due_date),
          salesperson: row.salesperson || '',
          status: row.status,
          currentPhase: Math.max(0, Number(row.current_phase_order || 0) - 1),
          tags: (tagsByCustomer.get(customerId) || []).map((tag) => ({
            id: tag.id,
            name: tag.name,
            color: tag.color,
          })),
          files: (filesByCustomer.get(customerId) || []).map((file) => ({
            id: file.id,
            name: file.original_name,
            mimeType: file.mime_type,
            size: Number(file.file_size || 0),
            createdAt: file.created_at,
          })),
          info: {
            costSyrup: formatMoney(row.cost_syrup),
            costPackage: formatMoney(row.cost_package),
            price: formatMoney(row.price),
            volume: formatVolume(row.volume),
          },
          notifications: (notificationsByCustomer.get(customerId) || []).map((notification) => ({
            id: notification.id,
            text: notification.message,
            time: formatRelativeTime(notification.created_at),
            read: Boolean(notification.read_at),
          })),
          issues: (issuesByCustomer.get(customerId) || []).map((issue) => ({
            openedBy: issue.opened_by_name,
            openedByDept: issue.opened_by_department,
            targetDept: issue.target_department,
            text: issue.message,
            closed: issue.status === 'closed',
            phase: issue.phase_order ? Math.max(0, Number(issue.phase_order) - 1) : undefined,
            time: formatRelativeTime(issue.created_at),
          })),
          ...(workflowState ? {
            branch: workflowState.branch,
            workflowBranches: workflowState.workflowBranches,
            singleResets: workflowState.singleResets,
          } : {}),
        }
      }),
    })
  } catch (error) {
    return next(error)
  }
}

async function uploadCustomerFile(req, res, next) {
  try {
    const customerId = Number(req.params.id)
    const mimeType = String(req.body.mimeType || '').trim().toLowerCase()
    const encodedData = String(req.body.data || '').replace(/\s/g, '')
    const name = normalizeCustomerFileName(req.body.name)

    if (!customerId) return res.status(400).json({ message: 'Customer id is required.' })
    if (!allowedCustomerFileTypes.has(mimeType)) {
      return res.status(415).json({ message: 'Only JPG, PNG, GIF, WEBP, and PDF files are allowed.' })
    }
    if (!encodedData || !/^[A-Za-z0-9+/]*={0,2}$/.test(encodedData)) {
      return res.status(400).json({ message: 'File data is invalid.' })
    }

    const fileData = Buffer.from(encodedData, 'base64')
    if (!fileData.length) return res.status(400).json({ message: 'File is empty.' })
    if (fileData.length > maxCustomerFileSize) {
      return res.status(413).json({ message: 'File size must not exceed 10 MB.' })
    }
    if (!customerFileMatchesType(fileData, mimeType)) {
      return res.status(415).json({ message: 'The file content does not match its image or PDF type.' })
    }

    const [customerRows] = await pool.execute('SELECT id FROM customers WHERE id = ? LIMIT 1', [customerId])
    if (!customerRows[0]) return res.status(404).json({ message: 'Customer not found.' })

    const [result] = await pool.execute(
      `INSERT INTO customer_files
        (customer_id, uploaded_by, original_name, mime_type, file_size, file_data)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [customerId, req.user.id || null, name, mimeType, fileData.length, fileData],
    )

    return res.status(201).json({
      file: {
        id: result.insertId,
        name,
        mimeType,
        size: fileData.length,
        createdAt: new Date(),
      },
    })
  } catch (error) {
    return next(error)
  }
}

async function getCustomerFile(req, res, next) {
  try {
    const customerId = Number(req.params.id)
    const fileId = Number(req.params.fileId)
    if (!customerId || !fileId) return res.status(400).json({ message: 'Customer and file ids are required.' })

    const [rows] = await pool.execute(
      `SELECT original_name, mime_type, file_size, file_data
       FROM customer_files
       WHERE id = ? AND customer_id = ?
       LIMIT 1`,
      [fileId, customerId],
    )
    const file = rows[0]
    if (!file) return res.status(404).json({ message: 'File not found.' })

    const fallbackName = normalizeCustomerFileName(file.original_name).replace(/[^A-Za-z0-9._-]/g, '_')
    const encodedName = encodeURIComponent(file.original_name)
    res.set({
      'Content-Type': file.mime_type,
      'Content-Length': String(file.file_size),
      'Content-Disposition': `inline; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    })
    return res.send(file.file_data)
  } catch (error) {
    return next(error)
  }
}

async function listTags(req, res, next) {
  try {
    const [rows] = await pool.execute(
      `SELECT id, name, color
       FROM customer_tags
       WHERE is_active = 1
       ORDER BY name ASC`,
    )

    return res.json({ tags: rows })
  } catch (error) {
    return next(error)
  }
}

async function addCustomerTag(req, res, next) {
  try {
    const { id } = req.params
    const { color, name, tagId } = req.body

    const [customerRows] = await pool.execute(
      'SELECT id FROM customers WHERE id = ? LIMIT 1',
      [id],
    )
    if (!customerRows[0]) return res.status(404).json({ message: 'Customer not found.' })

    let resolvedTagId = Number(tagId) || null
    if (resolvedTagId) {
      await pool.execute(
        `UPDATE customer_tags
         SET color = COALESCE(?, color)
         WHERE id = ?`,
        [color ? normalizeColor(color) : null, resolvedTagId],
      )
    } else {
      const tagName = String(name || '').trim()
      if (!tagName) return res.status(400).json({ message: 'Tag name is required.' })

      await pool.execute(
        `INSERT INTO customer_tags (name, color)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE color = VALUES(color), is_active = 1`,
        [tagName, normalizeColor(color)],
      )
      const [tagRows] = await pool.execute(
        'SELECT id FROM customer_tags WHERE name = ? LIMIT 1',
        [tagName],
      )
      resolvedTagId = tagRows[0].id
    }

    await pool.execute(
      `INSERT IGNORE INTO customer_tag_assignments (customer_id, tag_id)
       VALUES (?, ?)`,
      [id, resolvedTagId],
    )

    return res.status(201).json({ id: resolvedTagId })
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

    const [tagRows] = await pool.execute(
      'SELECT id FROM customer_tags WHERE id = ? AND is_active = 1 LIMIT 1',
      [id],
    )
    if (!tagRows[0]) return res.status(404).json({ message: 'Tag not found.' })

    await pool.execute(
      `UPDATE customer_tags
       SET name = ?, color = ?
       WHERE id = ?`,
      [name, color, id],
    )

    return res.status(204).send()
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'A tag with this name already exists.' })
    }
    return next(error)
  }
}

async function listCustomerStatuses(req, res, next) {
  try {
    const [rows] = await pool.execute(
      `SELECT id, value, label, sort_order, is_active
       FROM customer_statuses
       ORDER BY sort_order ASC, id ASC`,
    )

    return res.json({ statuses: rows.map(mapCustomerStatus) })
  } catch (error) {
    return next(error)
  }
}

async function markNotificationRead(req, res, next) {
  try {
    const notificationId = Number(req.params.id)
    if (!notificationId) return res.status(400).json({ message: 'Notification id is required.' })

    const [result] = await pool.execute(
      `UPDATE workflow_notifications
       SET read_at = COALESCE(read_at, NOW())
       WHERE id = ?`,
      [notificationId],
    )

    if (result.affectedRows === 0) return res.status(404).json({ message: 'Notification not found.' })

    return res.json({ read: true })
  } catch (error) {
    return next(error)
  }
}

async function markAllNotificationsRead(req, res, next) {
  try {
    await pool.execute(
      `UPDATE workflow_notifications
       SET read_at = COALESCE(read_at, NOW())
       WHERE read_at IS NULL`,
    )

    return res.json({ read: true })
  } catch (error) {
    return next(error)
  }
}

function getTicketName(message) {
  const firstLine = String(message || '').split(/\r?\n/)[0].trim()
  if (!firstLine) return 'Ticket'
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine
}

async function createIssue(req, res, next) {
  const connection = await pool.getConnection()

  try {
    const { id } = req.params
    const phaseIndex = Number(req.body.phase)
    const openedByName = String(req.body.openedBy || req.user.name || '').trim()
    const targetDept = String(req.body.targetDept || '').trim()
    const message = String(req.body.text || req.body.message || '').trim()

    if (!openedByName || !targetDept || !message) {
      return res.status(400).json({ message: 'openedBy, targetDept, and text are required.' })
    }

    await connection.beginTransaction()

    const [customerRows] = await connection.execute(
      `SELECT
         customers.id,
         customers.name,
         customer_workflows.id AS customer_workflow_id,
         customer_workflows.template_id
       FROM customers
       LEFT JOIN customer_workflows
         ON customer_workflows.customer_id = customers.id
        AND customer_workflows.status = 'active'
       WHERE customers.id = ?
       LIMIT 1`,
      [id],
    )
    const customer = customerRows[0]
    if (!customer) {
      await connection.rollback()
      return res.status(404).json({ message: 'Customer not found.' })
    }

    const [targetDepartmentRows] = await connection.execute(
      `SELECT id, name
       FROM departments
       WHERE LOWER(name) = LOWER(?)
         AND is_active = 1
       LIMIT 1`,
      [targetDept],
    )
    const targetDepartment = targetDepartmentRows[0]
    if (!targetDepartment) {
      await connection.rollback()
      return res.status(404).json({ message: 'Target department not found.' })
    }

    let openedByDepartmentId = req.user.departmentId || req.user.department_id || null
    let openedByDepartmentName = req.user.department?.name || ''

    if (!openedByDepartmentId && Array.isArray(req.user.departmentIds) && req.user.departmentIds[0]) {
      openedByDepartmentId = req.user.departmentIds[0]
    }

    if (!openedByDepartmentName && openedByDepartmentId) {
      const [departmentRows] = await connection.execute(
        'SELECT name FROM departments WHERE id = ? LIMIT 1',
        [openedByDepartmentId],
      )
      openedByDepartmentName = departmentRows[0]?.name || ''
    }

    if (!openedByDepartmentId) {
      await connection.rollback()
      return res.status(400).json({ message: 'Opened-by department is required.' })
    }

    let phaseId = null
    if (Number.isInteger(phaseIndex) && phaseIndex >= 0 && customer.template_id) {
      const [phaseRows] = await connection.execute(
        `SELECT workflow_phases.id
         FROM workflow_phases
         INNER JOIN workflow_stages
           ON workflow_stages.id = workflow_phases.stage_id
          AND workflow_stages.template_id = ?
         WHERE workflow_phases.global_order = ?
         LIMIT 1`,
        [customer.template_id, phaseIndex + 1],
      )
      phaseId = phaseRows[0]?.id || null
    }

    const [issueResult] = await connection.execute(
      `INSERT INTO workflow_issues (
         customer_id,
         phase_id,
         opened_by_user_id,
         opened_by_name,
         opened_by_department_id,
         target_department_id,
         message
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [customer.id, phaseId, req.user.id || null, openedByName, openedByDepartmentId, targetDepartment.id, message],
    )

    const [recipientRows] = await connection.execute(
      `SELECT DISTINCT users.email
       FROM users
       WHERE users.is_active = 1
         AND (
           users.department_id = ?
           OR EXISTS (
             SELECT 1
             FROM user_departments
             WHERE user_departments.user_id = users.id
               AND user_departments.department_id = ?
           )
         )
       ORDER BY users.email ASC`,
      [targetDepartment.id, targetDepartment.id],
    )

    await connection.commit()

    const notification = {
      customer,
      phase: phaseId ? { id: phaseId, label: 'Ticket', name: getTicketName(message) } : { id: null, label: 'Ticket', name: getTicketName(message) },
      recipients: recipientRows.map((row) => row.email),
    }

    try {
      const result = await sendTicketCreatedEmail({
        customerName: customer.name,
        detail: message,
        openedByDepartment: openedByDepartmentName,
        openedByName,
        recipients: notification.recipients,
        targetDepartment: targetDepartment.name,
        ticketName: getTicketName(message),
      })
      await recordEmailNotificationResult({
        actorUserId: req.user.id,
        notification,
        result,
      })
    } catch (emailError) {
      await recordEmailNotificationResult({
        actorUserId: req.user.id,
        error: emailError,
        notification,
      })
    }

    return res.status(201).json({
      id: issueResult.insertId,
      issue: {
        openedBy: openedByName,
        openedByDept: openedByDepartmentName,
        targetDept: targetDepartment.name,
        text: message,
        closed: false,
        phase: Number.isInteger(phaseIndex) ? phaseIndex : undefined,
        time: formatRelativeTime(new Date()),
      },
    })
  } catch (error) {
    await connection.rollback()
    return next(error)
  } finally {
    connection.release()
  }
}

async function removeCustomerTag(req, res, next) {
  try {
    const { id, tagId } = req.params

    await pool.execute(
      `DELETE FROM customer_tag_assignments
       WHERE customer_id = ? AND tag_id = ?`,
      [id, tagId],
    )

    return res.status(204).send()
  } catch (error) {
    return next(error)
  }
}

async function saveBranchProgress(req, res, next) {
  const connection = await pool.getConnection()

  try {
    const { branchIndex, id, phaseIndex } = req.params
    const { live } = req.body

    await connection.beginTransaction()

    const branchContext = await getBranchContext(connection, {
      branchIndex,
      customerId: id,
      phaseIndex,
    })

    if (!branchContext) {
      await connection.rollback()
      return res.status(404).json({ message: 'Workflow branch not found.' })
    }

    assertDepartmentCanManage(req, branchContext)
    assertBranchCanUpdate(branchContext)

    await updateChecklist(connection, {
      branchStateId: branchContext.customer_branch_state_id,
      checkedValues: live,
      markSaved: true,
      userId: req.user.id,
    })

    await connection.execute(
      `UPDATE customer_branch_states
       SET status = 'active', saved_at = NOW()
       WHERE id = ?`,
      [branchContext.customer_branch_state_id],
    )

    await connection.commit()

    return res.json({ saved: true })
  } catch (error) {
    await connection.rollback()
    return next(error)
  } finally {
    connection.release()
  }
}

async function completeBranch(req, res, next) {
  const connection = await pool.getConnection()

  try {
    const { branchIndex, id, phaseIndex } = req.params
    const { live } = req.body

    await connection.beginTransaction()

    const branchContext = await getBranchContext(connection, {
      branchIndex,
      customerId: id,
      phaseIndex,
    })

    if (!branchContext) {
      await connection.rollback()
      return res.status(404).json({ message: 'Workflow branch not found.' })
    }

    assertDepartmentCanManage(req, branchContext)
    assertBranchCanUpdate(branchContext)

    await updateChecklist(connection, {
      branchStateId: branchContext.customer_branch_state_id,
      checkedValues: live,
      markSaved: true,
      userId: req.user.id,
    })

    await connection.execute(
      `UPDATE customer_branch_states
       SET status = 'done', saved_at = NOW(), completed_by_user_id = ?, completed_at = NOW()
       WHERE id = ?`,
      [req.user.id, branchContext.customer_branch_state_id],
    )

    const advanceResult = await advanceWorkflowIfPhaseDone(connection, branchContext)
    const message = `ฝ่าย ${branchContext.department_name} ทำงานเสร็จแล้ว - ${branchContext.phase_name}`

    await connection.execute(
      `INSERT INTO workflow_notifications (customer_id, phase_id, department_id, actor_user_id, message)
       VALUES (?, ?, ?, ?, ?)`,
      [branchContext.customer_id, branchContext.phase_id, branchContext.department_id, req.user.id, message],
    )

    await connection.execute(
      `INSERT INTO workflow_activity_logs (customer_id, phase_id, actor_user_id, actor_department_id, action, message)
       VALUES (?, ?, ?, ?, 'complete_branch', ?)`,
      [branchContext.customer_id, branchContext.phase_id, req.user.id, branchContext.department_id, message],
    )

    await connection.commit()

    if (advanceResult.notification?.customer && advanceResult.notification?.phase) {
      sendPhaseAdvancedNotification({
        actorUserId: req.user.id,
        notification: advanceResult.notification,
      }).catch((emailError) => {
        console.warn('Failed to send phase advanced notification:', emailError.message)
      })
    }

    return res.json({
      advanced: advanceResult.advanced,
      completed: true,
      emailNotificationQueued: Boolean(advanceResult.notification),
    })
  } catch (error) {
    await connection.rollback()
    return next(error)
  } finally {
    connection.release()
  }
}

async function resetPhase(req, res, next) {
  const connection = await pool.getConnection()

  try {
    const { id, phaseIndex } = req.params
    const mode = req.body.mode === 'single' ? 'single' : 'all'
    const phaseOrder = Number(phaseIndex) + 1

    await connection.beginTransaction()

    const [targetRows] = await connection.execute(
      `SELECT
         customer_workflows.id AS customer_workflow_id,
         workflow_phases.id AS phase_id
       FROM customers
       INNER JOIN customer_workflows
         ON customer_workflows.customer_id = customers.id
        AND customer_workflows.status = 'active'
       INNER JOIN workflow_phases
         ON workflow_phases.global_order = ?
       INNER JOIN workflow_stages
         ON workflow_stages.id = workflow_phases.stage_id
        AND workflow_stages.template_id = customer_workflows.template_id
       WHERE customers.id = ?
       LIMIT 1`,
      [phaseOrder, id],
    )

    const target = targetRows[0]
    if (!target) {
      await connection.rollback()
      return res.status(404).json({ message: 'Workflow phase not found.' })
    }

    if (mode === 'all') {
      await connection.execute(
        `UPDATE customer_workflows
         SET current_phase_id = ?
         WHERE id = ?`,
        [target.phase_id, target.customer_workflow_id],
      )

      await connection.execute(
        `UPDATE customer_phase_states
         INNER JOIN workflow_phases
           ON workflow_phases.id = customer_phase_states.phase_id
         SET
           customer_phase_states.status = CASE
             WHEN workflow_phases.global_order = ? THEN 'active'
             WHEN workflow_phases.global_order > ? THEN 'locked'
             ELSE customer_phase_states.status
           END,
           customer_phase_states.reset_mode = CASE
             WHEN workflow_phases.global_order >= ? THEN 'all'
             ELSE customer_phase_states.reset_mode
           END,
           customer_phase_states.reset_by_department_id = CASE
             WHEN workflow_phases.global_order >= ? THEN ?
             ELSE customer_phase_states.reset_by_department_id
           END,
           customer_phase_states.reset_by_user_id = CASE
             WHEN workflow_phases.global_order >= ? THEN ?
             ELSE customer_phase_states.reset_by_user_id
           END,
           customer_phase_states.reset_at = CASE
             WHEN workflow_phases.global_order >= ? THEN NOW()
             ELSE customer_phase_states.reset_at
           END,
           customer_phase_states.completed_at = CASE
             WHEN workflow_phases.global_order >= ? THEN NULL
             ELSE customer_phase_states.completed_at
           END
         WHERE customer_phase_states.customer_workflow_id = ?
           AND workflow_phases.global_order >= ?`,
        [
          phaseOrder,
          phaseOrder,
          phaseOrder,
          phaseOrder,
          req.user.departmentId || null,
          phaseOrder,
          req.user.id,
          phaseOrder,
          phaseOrder,
          target.customer_workflow_id,
          phaseOrder,
        ],
      )

      await connection.execute(
        `UPDATE customer_branch_states
         INNER JOIN customer_phase_states
           ON customer_phase_states.id = customer_branch_states.customer_phase_state_id
         INNER JOIN workflow_phases
           ON workflow_phases.id = customer_phase_states.phase_id
         SET
           customer_branch_states.status = CASE
             WHEN workflow_phases.global_order = ? THEN 'active'
             ELSE 'waiting'
           END,
           customer_branch_states.saved_at = NULL,
           customer_branch_states.completed_by_user_id = NULL,
           customer_branch_states.completed_at = NULL
         WHERE customer_phase_states.customer_workflow_id = ?
           AND workflow_phases.global_order >= ?`,
        [phaseOrder, target.customer_workflow_id, phaseOrder],
      )

      await connection.execute(
        `UPDATE customer_checklist_states
         INNER JOIN customer_branch_states
           ON customer_branch_states.id = customer_checklist_states.customer_branch_state_id
         INNER JOIN customer_phase_states
           ON customer_phase_states.id = customer_branch_states.customer_phase_state_id
         INNER JOIN workflow_phases
           ON workflow_phases.id = customer_phase_states.phase_id
         SET
           customer_checklist_states.live_checked = 0,
           customer_checklist_states.saved_checked = 0,
           customer_checklist_states.checked_by_user_id = NULL,
           customer_checklist_states.checked_at = NULL
         WHERE customer_phase_states.customer_workflow_id = ?
           AND workflow_phases.global_order >= ?`,
        [target.customer_workflow_id, phaseOrder],
      )
    } else {
      await connection.execute(
        `UPDATE customer_phase_states
         SET
           status = 'reset',
           reset_mode = 'single',
           reset_by_department_id = ?,
           reset_by_user_id = ?,
           reset_at = NOW(),
           completed_at = NULL
         WHERE customer_workflow_id = ?
           AND phase_id = ?`,
        [req.user.departmentId || null, req.user.id, target.customer_workflow_id, target.phase_id],
      )

      await connection.execute(
        `UPDATE customer_branch_states
         INNER JOIN customer_phase_states
           ON customer_phase_states.id = customer_branch_states.customer_phase_state_id
         SET
           customer_branch_states.status = 'active',
           customer_branch_states.saved_at = NULL,
           customer_branch_states.completed_by_user_id = NULL,
           customer_branch_states.completed_at = NULL
         WHERE customer_phase_states.customer_workflow_id = ?
           AND customer_phase_states.phase_id = ?`,
        [target.customer_workflow_id, target.phase_id],
      )

      await connection.execute(
        `UPDATE customer_checklist_states
         INNER JOIN customer_branch_states
           ON customer_branch_states.id = customer_checklist_states.customer_branch_state_id
         INNER JOIN customer_phase_states
           ON customer_phase_states.id = customer_branch_states.customer_phase_state_id
         SET
           customer_checklist_states.live_checked = 0,
           customer_checklist_states.saved_checked = 0,
           customer_checklist_states.checked_by_user_id = NULL,
           customer_checklist_states.checked_at = NULL
         WHERE customer_phase_states.customer_workflow_id = ?
           AND customer_phase_states.phase_id = ?`,
        [target.customer_workflow_id, target.phase_id],
      )
    }

    await connection.execute(
      `INSERT INTO workflow_activity_logs (customer_id, phase_id, actor_user_id, actor_department_id, action, message, metadata)
       VALUES (?, ?, ?, ?, 'reset_phase', ?, ?)`,
      [
        id,
        target.phase_id,
        req.user.id,
        req.user.departmentId || null,
        `Reset ${mode} phase ${phaseOrder}`,
        JSON.stringify({ mode, phaseIndex: Number(phaseIndex) }),
      ],
    )

    await connection.commit()

    return res.json({ reset: true, mode })
  } catch (error) {
    await connection.rollback()
    return next(error)
  } finally {
    connection.release()
  }
}

module.exports = {
  addCustomerTag,
  completeBranch,
  createIssue,
  getFlowStructure,
  getCustomerFile,
  listFlows,
  listCustomerStatuses,
  listOverview,
  listTags,
  markAllNotificationsRead,
  markNotificationRead,
  removeCustomerTag,
  resetPhase,
  saveBranchProgress,
  updateFlowBranchItems,
  updateTag,
  uploadCustomerFile,
}
