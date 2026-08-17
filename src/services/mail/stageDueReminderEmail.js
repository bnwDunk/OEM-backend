const { env } = require('../../config/env')
const { renderEmailLayout } = require('./layout')
const { getTransporter } = require('./transport')
const { formatStageDueDate, getDepartmentRecipientGroups, getPhaseTitle, getStageTitle, getWorkflowUrl, uniqueEmails } = require('./helpers')

async function sendStageDueReminderEmail({ customerCode, customerName, customerReference, currentPhase, recipients, stageDueDate }) {
  const mailer = getTransporter()
  const recipientGroups = getDepartmentRecipientGroups(currentPhase, recipients)
  const to = uniqueEmails(recipientGroups.flatMap((group) => group.recipients))
  if (!mailer || to.length === 0) return { skipped: true, to }

  const stageTitle = getStageTitle(currentPhase)
  const phaseTitle = getPhaseTitle(currentPhase)
  const workflowUrl = getWorkflowUrl(customerReference)
  await Promise.all(recipientGroups.map((group) => {
    const rows = [
      { label: 'Customer', value: customerName },
      ...(customerCode ? [{ label: 'Customer Code', value: customerCode }] : []),
      { label: 'Stage', value: stageTitle },
      { label: 'Stage Due Date', value: formatStageDueDate(stageDueDate) },
      { label: 'Current Phase', value: phaseTitle },
      { label: 'Assigned Department', value: group.departmentName },
      { label: 'Status', value: 'Phase ปัจจุบันยังไม่เสร็จ และ Stage จะครบกำหนดในวันพรุ่งนี้' },
    ]
    return mailer.sendMail({
      from: env.mail.from,
      to: group.recipients,
      subject: `[P.PIYA Solution - OEM] Stage Due Date พรุ่งนี้ | ${customerName} | ${stageTitle} | ${phaseTitle}`,
      html: renderEmailLayout({ intro: 'แจ้งเตือน Stage Due Date ล่วงหน้า 1 วัน', recipientName: group.departmentName, rows, workflowUrl }),
      text: [`เรียน ทีม ${group.departmentName}`, '', 'แจ้งเตือน Stage Due Date ล่วงหน้า 1 วัน', ...rows.map((row) => `${row.label}: ${row.value}`), '', `เปิดระบบ: ${workflowUrl}`].join('\n'),
    })
  }))
  return { skipped: false, to, departmentCount: recipientGroups.length }
}

module.exports = { sendStageDueReminderEmail }
