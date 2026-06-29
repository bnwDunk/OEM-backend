const pool = require('../config/db')
const { sendPhaseAdvancedEmail } = require('../services/mailService')

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

function groupWorkflowStateRows(rows) {
  return rows.reduce((groups, row) => {
    const customerId = String(row.customer_id)
    if (!groups.has(customerId)) {
      groups.set(customerId, {
        branch: [],
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

    state.branch[phaseIndex][branchIndex].live[itemIndex] = Boolean(row.live_checked)
    state.branch[phaseIndex][branchIndex].saved[itemIndex] = Boolean(row.saved_checked)
    state.branch[phaseIndex][branchIndex].done = row.branch_status === 'done'

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

  for (const [index, item] of checklistRows.entries()) {
    const checked = checkedValues[index] ? 1 : 0
    await connection.execute(
      `UPDATE customer_checklist_states
       SET
         live_checked = ?,
         saved_checked = CASE WHEN ? = 1 THEN ? ELSE saved_checked END,
         checked_by_user_id = ?,
         checked_at = NOW()
       WHERE id = ?`,
      [checked, markSaved ? 1 : 0, checked, userId, item.id],
    )
  }
}

async function getPhaseNotificationContext(connection, { customerId, customerWorkflowId, phaseId }) {
  const [phaseRows] = await connection.execute(
    `SELECT
       workflow_phases.id,
       workflow_phases.label,
       workflow_phases.name,
       workflow_phases.global_order,
       workflow_stages.name AS stage_name
     FROM workflow_phases
     INNER JOIN workflow_stages
       ON workflow_stages.id = workflow_phases.stage_id
     INNER JOIN customer_workflows
       ON customer_workflows.template_id = workflow_stages.template_id
     WHERE customer_workflows.id = ?
       AND workflow_phases.id = ?
     LIMIT 1`,
    [customerWorkflowId, phaseId],
  )

  if (!phaseRows[0]) return null

  const [recipientRows] = await connection.execute(
    `SELECT DISTINCT users.email
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
     ORDER BY users.email ASC`,
    [phaseId],
  )

  const [customerRows] = await connection.execute(
    `SELECT id, name, slug
     FROM customers
     WHERE id = ?
     LIMIT 1`,
    [customerId],
  )

  return {
    customer: customerRows[0] || null,
    phase: phaseRows[0],
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

async function listOverview(req, res, next) {
  try {
    const [customerRows] = await pool.execute(
      `SELECT
         customers.id,
         customers.slug,
         customers.name,
         customers.status,
         customers.cost_syrup,
         customers.cost_package,
         customers.price,
         customers.volume,
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

    const [notificationRows] = await pool.execute(
      `SELECT customer_id, message, created_at
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
         opened_departments.name AS opened_by_department,
         target_departments.name AS target_department
       FROM workflow_issues
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
         customer_checklist_states.live_checked,
         customer_checklist_states.saved_checked,
         DENSE_RANK() OVER (
           PARTITION BY workflow_phases.id
           ORDER BY workflow_phase_branches.sort_order ASC, workflow_phase_branches.id ASC
         ) AS branch_position,
         ROW_NUMBER() OVER (
           PARTITION BY workflow_phase_branches.id
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
          name: row.name,
          status: row.status,
          currentPhase: Math.max(0, Number(row.current_phase_order || 0) - 1),
          tags: (tagsByCustomer.get(customerId) || []).map((tag) => ({
            id: tag.id,
            name: tag.name,
            color: tag.color,
          })),
          info: {
            costSyrup: formatMoney(row.cost_syrup),
            costPackage: formatMoney(row.cost_package),
            price: formatMoney(row.price),
            volume: formatVolume(row.volume),
          },
          notifications: (notificationsByCustomer.get(customerId) || []).map((notification) => ({
            text: notification.message,
            time: formatRelativeTime(notification.created_at),
          })),
          issues: (issuesByCustomer.get(customerId) || []).map((issue) => ({
            openedBy: issue.opened_by_name,
            openedByDept: issue.opened_by_department,
            targetDept: issue.target_department,
            text: issue.message,
            closed: issue.status === 'closed',
            time: formatRelativeTime(issue.created_at),
          })),
          ...(workflowState ? {
            branch: workflowState.branch,
            singleResets: workflowState.singleResets,
          } : {}),
        }
      }),
    })
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

    if (!Array.isArray(live) || !live.every(Boolean)) {
      await connection.rollback()
      return res.status(400).json({ message: 'All checklist items must be checked before completing this branch.' })
    }

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
      try {
        const result = await sendPhaseAdvancedEmail({
          customerName: advanceResult.notification.customer.name,
          nextPhase: advanceResult.notification.phase,
          recipients: advanceResult.notification.recipients,
        })
        await recordEmailNotificationResult({
          actorUserId: req.user.id,
          notification: advanceResult.notification,
          result,
        })
      } catch (emailError) {
        await recordEmailNotificationResult({
          actorUserId: req.user.id,
          error: emailError,
          notification: advanceResult.notification,
        })
      }
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
  listOverview,
  listTags,
  removeCustomerTag,
  resetPhase,
  saveBranchProgress,
  updateTag,
}
