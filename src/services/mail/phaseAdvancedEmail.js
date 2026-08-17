const { env } = require('../../config/env')
const { renderEmailLayout } = require('./layout')
const { getTransporter } = require('./transport')
const { formatStageDueDate, getDepartmentRecipientGroups, getPhaseTitle, getStageTitle, getWorkflowUrl, uniqueEmails } = require('./helpers')

async function sendPhaseAdvancedEmail({ customerCode, customerName, customerReference, nextPhase, recipients, transition }) {
  const mailer = getTransporter()
  const recipientGroups = getDepartmentRecipientGroups(nextPhase, recipients)
  const to = uniqueEmails(recipientGroups.flatMap((group) => group.recipients))
  if (!mailer || to.length === 0) return { skipped: true, to }

  const stageTitle = getStageTitle(nextPhase)
  const phaseTitle = getPhaseTitle(nextPhase)
  const departmentName = nextPhase.departments?.length ? nextPhase.departments.join(' / ') : 'ฝ่ายที่เกี่ยวข้อง'
  const workflowUrl = getWorkflowUrl(customerReference)
  await Promise.all(recipientGroups.map((group) => {
    const rows = [
      { label: 'Customer', value: customerName },
      ...(customerCode ? [{ label: 'Customer Code', value: customerCode }] : []),
      { label: 'Stage', value: stageTitle },
      ...(nextPhase.stage_due_date ? [{ label: 'Stage Due Date', value: formatStageDueDate(nextPhase.stage_due_date) }] : []),
      { label: 'Phase', value: phaseTitle },
      { label: 'Assigned Departments', value: departmentName },
      ...(transition?.previousStageName ? [{ label: 'Previous Stage', value: transition.previousStageName }] : []),
      ...(transition?.previousPhaseName ? [{ label: 'Previous Phase', value: getPhaseTitle({ label: transition.previousPhaseLabel, name: transition.previousPhaseName }) }] : []),
      ...(transition?.completedByName ? [{ label: 'Completed By', value: `${transition.completedByName} (${transition.completedByDepartment || '-'})` }] : []),
      { label: 'Status', value: 'พร้อมดำเนินงานใน Phase นี้' },
    ]
    return mailer.sendMail({
      from: env.mail.from,
      to: group.recipients,
      subject: `[P.PIYA Solution - OEM] งานใหม่ | ${customerName} | ${stageTitle} | ${phaseTitle}`,
      html: renderEmailLayout({ intro: 'มีงานใหม่รอดำเนินการ', recipientName: group.departmentName, rows, workflowUrl }),
      text: [`เรียน ทีม ${group.departmentName}`, '', 'มีงานใหม่รอดำเนินการในระบบ OEM Workflow', ...rows.map((row) => `${row.label}: ${row.value}`), '', `เปิดระบบ: ${workflowUrl}`].join('\n'),
    })
  }))
  return { skipped: false, to, departmentCount: recipientGroups.length }
}

module.exports = { sendPhaseAdvancedEmail }
