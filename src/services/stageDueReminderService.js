const pool = require('../config/db')
const { env } = require('../config/env')
const { sendStageDueReminderEmail } = require('./mailService')

let reminderTimer = null
let reminderRunInProgress = false

function getTomorrowDate(timeZone = env.mail.reminderTimeZone, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      month: '2-digit',
      timeZone,
      year: 'numeric',
    }).formatToParts(now).map((part) => [part.type, part.value]),
  )
  const tomorrow = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1))
  return tomorrow.toISOString().slice(0, 10)
}

async function getReminderCandidates(targetDate) {
  const [rows] = await pool.execute(
    `SELECT
       customer_workflows.id AS customer_workflow_id,
       customers.id AS customer_id,
       customers.customer_code,
       customers.name AS customer_name,
       customers.slug AS customer_slug,
       current_stage.id AS stage_id,
       current_stage.name AS stage_name,
       current_stage.stage_position,
       current_phase.id AS phase_id,
       current_phase.label AS phase_label,
       current_phase.name AS phase_name,
       DATE_FORMAT(customer_stage_due_dates.due_date, '%Y-%m-%d') AS stage_due_date
     FROM customer_workflows
     INNER JOIN customers
       ON customers.id = customer_workflows.customer_id
     INNER JOIN workflow_phases AS current_phase
       ON current_phase.id = customer_workflows.current_phase_id
     INNER JOIN (
       SELECT
         workflow_stages.id,
         workflow_stages.template_id,
         workflow_stages.name,
         ROW_NUMBER() OVER (
           PARTITION BY workflow_stages.template_id
           ORDER BY workflow_stages.id ASC
         ) AS stage_position
       FROM workflow_stages
     ) AS current_stage
       ON current_stage.id = current_phase.stage_id
      AND current_stage.template_id = customer_workflows.template_id
     INNER JOIN customer_phase_states
       ON customer_phase_states.customer_workflow_id = customer_workflows.id
      AND customer_phase_states.phase_id = current_phase.id
      AND customer_phase_states.status <> 'done'
     INNER JOIN customer_stage_due_dates
       ON customer_stage_due_dates.customer_workflow_id = customer_workflows.id
      AND customer_stage_due_dates.stage_id = current_stage.id
      AND customer_stage_due_dates.due_date = ?
     LEFT JOIN stage_due_email_reminders
       ON stage_due_email_reminders.customer_workflow_id = customer_workflows.id
      AND stage_due_email_reminders.stage_id = current_stage.id
      AND stage_due_email_reminders.due_date = customer_stage_due_dates.due_date
     WHERE customer_workflows.status = 'active'
       AND stage_due_email_reminders.id IS NULL
     ORDER BY customer_workflows.id ASC`,
    [targetDate],
  )
  return rows
}

async function getPhaseRecipients(phaseId) {
  const [rows] = await pool.execute(
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

  const groups = new Map()
  for (const row of rows) {
    const departmentId = Number(row.department_id)
    if (!groups.has(departmentId)) {
      groups.set(departmentId, {
        departmentId,
        departmentName: row.department_name,
        recipients: [],
      })
    }
    groups.get(departmentId).recipients.push(row.email)
  }

  return [...groups.values()]
}

async function claimReminder(candidate) {
  const [result] = await pool.execute(
    `INSERT IGNORE INTO stage_due_email_reminders
       (customer_workflow_id, stage_id, phase_id, due_date)
     VALUES (?, ?, ?, ?)`,
    [candidate.customer_workflow_id, candidate.stage_id, candidate.phase_id, candidate.stage_due_date],
  )
  return result.affectedRows === 1
}

async function releaseReminder(candidate) {
  await pool.execute(
    `DELETE FROM stage_due_email_reminders
     WHERE customer_workflow_id = ? AND stage_id = ? AND due_date = ?`,
    [candidate.customer_workflow_id, candidate.stage_id, candidate.stage_due_date],
  )
}

async function recordReminderResult(candidate, result) {
  await pool.execute(
    `INSERT INTO workflow_activity_logs
       (customer_id, phase_id, action, message, metadata)
     VALUES (?, ?, 'stage_due_email_reminder_sent', ?, ?)`,
    [
      candidate.customer_id,
      candidate.phase_id,
      `Stage Due Date reminder sent for S${candidate.stage_position}-${candidate.phase_label}: ${candidate.phase_name}`,
      JSON.stringify({
        dueDate: candidate.stage_due_date,
        recipients: result.to,
        stageId: candidate.stage_id,
      }),
    ],
  )
}

async function sendCandidateReminder(candidate) {
  if (!(await claimReminder(candidate))) return { sent: false, skipped: true }

  try {
    const departmentRecipients = await getPhaseRecipients(candidate.phase_id)
    const recipients = departmentRecipients.flatMap((group) => group.recipients)
    const result = await sendStageDueReminderEmail({
      customerCode: candidate.customer_code,
      customerName: candidate.customer_name,
      customerReference: candidate.customer_slug || candidate.customer_id,
      currentPhase: {
        departmentRecipients,
        departments: departmentRecipients.map((group) => group.departmentName),
        label: candidate.phase_label,
        name: candidate.phase_name,
        stage_name: candidate.stage_name,
        stage_position: candidate.stage_position,
      },
      recipients,
      stageDueDate: candidate.stage_due_date,
    })

    if (result.skipped) {
      await releaseReminder(candidate)
      return { sent: false, skipped: true }
    }

    await recordReminderResult(candidate, result)
    return { sent: true, skipped: false }
  } catch (error) {
    await releaseReminder(candidate)
    throw error
  }
}

async function runStageDueReminders({ now = new Date(), targetDate } = {}) {
  if (reminderRunInProgress) return { candidates: 0, sent: 0, skipped: 0 }

  reminderRunInProgress = true
  try {
    const dueDate = targetDate || getTomorrowDate(env.mail.reminderTimeZone, now)
    const candidates = await getReminderCandidates(dueDate)
    let sent = 0
    let skipped = 0

    for (const candidate of candidates) {
      try {
        const result = await sendCandidateReminder(candidate)
        if (result.sent) sent += 1
        else skipped += 1
      } catch (error) {
        skipped += 1
        console.warn(`Failed to send Stage Due Date reminder for customer ${candidate.customer_id}:`, error.message)
      }
    }

    return { candidates: candidates.length, sent, skipped, targetDate: dueDate }
  } finally {
    reminderRunInProgress = false
  }
}

function startStageDueReminderScheduler() {
  if (!env.mail.enabled) {
    console.log('Stage Due Date reminder scheduler is disabled because email is disabled.')
    return null
  }
  if (reminderTimer) return reminderTimer

  const run = () => runStageDueReminders().then((result) => {
    if (result.candidates > 0) console.log('Stage Due Date reminder run:', result)
  }).catch((error) => {
    console.warn('Stage Due Date reminder run failed:', error.message)
  })

  void run()
  reminderTimer = setInterval(run, env.mail.reminderIntervalMs)
  reminderTimer.unref?.()
  return reminderTimer
}

module.exports = {
  getTomorrowDate,
  runStageDueReminders,
  startStageDueReminderScheduler,
}
