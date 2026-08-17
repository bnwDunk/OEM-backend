const { env } = require('../../config/env')

function uniqueEmails(emails) {
  return [...new Set(
    (Array.isArray(emails) ? emails : [])
      .map((email) => String(email || '').trim().toLowerCase())
      .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      .filter((email) => !email.endsWith('.local')),
  )]
}

function getWorkflowUrl(customerReference) {
  const appUrl = String(env.mail.appUrl || '').trim().replace(/\/$/, '')
  const flowUrl = appUrl.endsWith('/flow') ? appUrl : `${appUrl}/flow`
  const reference = String(customerReference || '').trim()
  return reference ? `${flowUrl}/customers/${encodeURIComponent(reference)}` : flowUrl
}

function getDepartmentRecipientGroups(phase, recipients) {
  if (Array.isArray(phase.departmentRecipients) && phase.departmentRecipients.length > 0) {
    return phase.departmentRecipients
      .map((group) => ({
        departmentName: String(group.departmentName || group.department || '').trim(),
        recipients: uniqueEmails(group.recipients),
      }))
      .filter((group) => group.departmentName && group.recipients.length > 0)
  }
  const departmentName = phase.departments?.length ? phase.departments.join(' / ') : 'ฝ่ายที่เกี่ยวข้อง'
  return [{ departmentName, recipients: uniqueEmails(recipients) }]
    .filter((group) => group.recipients.length > 0)
}

function getStageTitle({ stage_name: stageName, stage_position: stagePosition } = {}) {
  if (stagePosition && stageName) return `Stage ${stagePosition}: ${stageName}`
  if (stageName) return `Stage: ${stageName}`
  if (stagePosition) return `Stage ${stagePosition}`
  return 'ไม่ระบุ Stage'
}

function getPhaseTitle({ label, name } = {}) {
  if (label && name) return `Phase ${label}: ${name}`
  if (name) return `Phase: ${name}`
  if (label) return `Phase ${label}`
  return 'ไม่ระบุ Phase'
}

function formatStageDueDate(value) {
  if (!value) return '-'
  const rawValue = value instanceof Date
    ? [value.getFullYear(), String(value.getMonth() + 1).padStart(2, '0'), String(value.getDate()).padStart(2, '0')].join('-')
    : String(value).slice(0, 10)
  const match = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : rawValue
}

module.exports = {
  formatStageDueDate,
  getDepartmentRecipientGroups,
  getPhaseTitle,
  getStageTitle,
  getWorkflowUrl,
  uniqueEmails,
}
