const pool = require('../config/db')

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

async function listOverview(req, res, next) {
  try {
    const [customerRows] = await pool.execute(
      `SELECT
         customers.id,
         customers.slug,
         customers.name,
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
       WHERE customers.status = 'active'
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

    const tagsByCustomer = groupByCustomerId(tagRows)
    const notificationsByCustomer = groupByCustomerId(notificationRows)
    const issuesByCustomer = groupByCustomerId(issueRows)

    return res.json({
      customers: customerRows.map((row) => {
        const customerId = String(row.id)

        return {
          id: row.slug || customerId,
          databaseId: row.id,
          name: row.name,
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

module.exports = {
  addCustomerTag,
  listOverview,
  listTags,
}
