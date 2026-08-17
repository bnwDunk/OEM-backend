const { env } = require('../../config/env')
const { renderEmailLayout } = require('./layout')
const { getTransporter } = require('./transport')
const { getPhaseTitle, getStageTitle, getWorkflowUrl, uniqueEmails } = require('./helpers')

async function sendTicketCreatedEmail({
  attachmentCount = 0, attachmentNames = [], customerCode, customerName, customerReference,
  detail, openedByDepartment, openedByName, phaseLabel, phaseName, recipients,
  stageName, stagePosition, targetDepartment, ticketName,
}) {
  const mailer = getTransporter()
  const to = uniqueEmails(recipients)
  if (!mailer || to.length === 0) return { skipped: true, to }

  const stageTitle = getStageTitle({ stage_name: stageName, stage_position: stagePosition })
  const phaseTitle = getPhaseTitle({ label: phaseLabel, name: phaseName })
  const workflowUrl = getWorkflowUrl(customerReference)
  const rows = [
    { label: 'Ticket', value: ticketName },
    { label: 'Customer', value: customerName },
    ...(customerCode ? [{ label: 'Customer Code', value: customerCode }] : []),
    { label: 'Stage', value: stageTitle },
    { label: 'Phase', value: phaseTitle },
    { label: 'Opened By', value: `${openedByName} (${openedByDepartment})` },
    { label: 'Sent To', value: targetDepartment },
    { label: 'Attachments', value: attachmentCount ? `${attachmentCount} file(s): ${attachmentNames.join(', ')}` : 'ไม่มีไฟล์แนบ' },
    { label: 'Detail', value: detail },
  ]
  await mailer.sendMail({
    from: env.mail.from,
    to,
    subject: `[P.PIYA Solution - OEM] Ticket ใหม่ | ${customerName} | ${stageTitle} | ${phaseTitle}`,
    html: renderEmailLayout({ intro: 'มี Ticket ใหม่ส่งถึงฝ่ายของคุณ', recipientName: targetDepartment, rows, workflowUrl }),
    text: [`เรียน ทีม ${targetDepartment}`, '', 'มี Ticket ใหม่ส่งถึงฝ่ายของคุณ', ...rows.map((row) => `${row.label}: ${row.value}`), '', `เปิดระบบ: ${workflowUrl}`].join('\n'),
  })
  return { skipped: false, to }
}

module.exports = { sendTicketCreatedEmail }
