const nodemailer = require('nodemailer')
const { env } = require('../config/env')

let transporter

function isMailEnabled() {
  return Boolean(env.mail.enabled && env.mail.user && env.mail.pass && env.mail.from)
}

function getTransporter() {
  if (!isMailEnabled()) return null

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.mail.host,
      port: env.mail.port,
      secure: env.mail.secure,
      auth: {
        user: env.mail.user,
        pass: env.mail.pass,
      },
    })
  }

  return transporter
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

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

function getDepartmentRecipientGroups(nextPhase, recipients) {
  if (Array.isArray(nextPhase.departmentRecipients) && nextPhase.departmentRecipients.length > 0) {
    return nextPhase.departmentRecipients
      .map((group) => ({
        departmentName: String(group.departmentName || group.department || '').trim(),
        recipients: uniqueEmails(group.recipients),
      }))
      .filter((group) => group.departmentName && group.recipients.length > 0)
  }

  const departmentName = Array.isArray(nextPhase.departments) && nextPhase.departments.length > 0
    ? nextPhase.departments.join(' / ')
    : 'ฝ่ายที่เกี่ยวข้อง'

  return [{
    departmentName,
    recipients: uniqueEmails(recipients),
  }].filter((group) => group.recipients.length > 0)
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

function renderEmailLayout({ intro, recipientName, rows, workflowUrl }) {
  const safeRows = rows.map(({ label, value }) => `
    <tr>
      <td style="width:150px;padding:8px 12px;color:#64748b;font-weight:700;vertical-align:top">${escapeHtml(label)}</td>
      <td style="padding:8px 12px;color:#0f172a;font-weight:600;vertical-align:top;white-space:pre-wrap;word-break:break-word">${escapeHtml(value)}</td>
    </tr>
  `).join('')

  return `
    <div style="margin:0;background:#f1f5f9;padding:24px;font-family:Arial,sans-serif;color:#172033">
      <div style="max-width:720px;margin:0 auto;overflow:hidden;border:1px solid #e2e8f0;border-radius:16px;background:#ffffff">
        <div style="background:#0f766e;padding:20px 24px;color:#ffffff">
          <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.85">P.PIYA Solution · OEM Workflow</div>
          <div style="margin-top:6px;font-size:20px;font-weight:800">${escapeHtml(intro)}</div>
        </div>
        <div style="padding:22px 24px">
          <p style="margin:0 0 16px;font-size:14px;line-height:1.6">เรียน ทีม ${escapeHtml(recipientName)}</p>
          <table role="presentation" style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;background:#f8fafc;font-size:14px">
            ${safeRows}
          </table>
          <div style="margin-top:20px">
            <a href="${escapeHtml(workflowUrl)}" style="display:inline-block;border-radius:10px;background:#f59e0b;padding:11px 18px;color:#ffffff;font-size:14px;font-weight:800;text-decoration:none">เปิดระบบ OEM Workflow</a>
          </div>
          <p style="margin:22px 0 0;color:#94a3b8;font-size:12px;line-height:1.5">อีเมลนี้ส่งโดยอัตโนมัติจาก OEM Workflow System กรุณาไม่ตอบกลับอีเมลนี้</p>
        </div>
      </div>
    </div>
  `
}

async function sendPhaseAdvancedEmail({ customerCode, customerName, customerReference, nextPhase, recipients, transition }) {
  const mailer = getTransporter()
  const recipientGroups = getDepartmentRecipientGroups(nextPhase, recipients)
  const to = uniqueEmails(recipientGroups.flatMap((group) => group.recipients))

  if (!mailer || to.length === 0) {
    return { skipped: true, to }
  }

  const stageTitle = getStageTitle(nextPhase)
  const phaseTitle = getPhaseTitle(nextPhase)
  const departmentName = Array.isArray(nextPhase.departments) && nextPhase.departments.length > 0
    ? nextPhase.departments.join(' / ')
    : 'ฝ่ายที่เกี่ยวข้อง'
  const subject = `[P.PIYA Solution - OEM] งานใหม่ | ${customerName} | ${stageTitle} | ${phaseTitle}`
  const workflowUrl = getWorkflowUrl(customerReference)

  await Promise.all(recipientGroups.map((group) => {
    const rows = [
      { label: 'Customer', value: customerName },
      ...(customerCode ? [{ label: 'Customer Code', value: customerCode }] : []),
      { label: 'Stage', value: stageTitle },
      { label: 'Phase', value: phaseTitle },
      { label: 'Assigned Departments', value: departmentName },
      ...(transition?.previousStageName ? [{
        label: 'Previous Stage',
        value: transition.previousStageName,
      }] : []),
      ...(transition?.previousPhaseName ? [{
        label: 'Previous Phase',
        value: getPhaseTitle({
          label: transition.previousPhaseLabel,
          name: transition.previousPhaseName,
        }),
      }] : []),
      ...(transition?.completedByName ? [{
        label: 'Completed By',
        value: `${transition.completedByName} (${transition.completedByDepartment || '-'})`,
      }] : []),
      { label: 'Status', value: 'พร้อมดำเนินงานใน Phase นี้' },
    ]

    return mailer.sendMail({
      from: env.mail.from,
      to: group.recipients,
      subject,
      html: renderEmailLayout({
        intro: 'มีงานใหม่รอดำเนินการ',
        recipientName: group.departmentName,
        rows,
        workflowUrl,
      }),
      text: [
        `เรียน ทีม ${group.departmentName}`,
        '',
        'มีงานใหม่รอดำเนินการในระบบ OEM Workflow',
        ...rows.map((row) => `${row.label}: ${row.value}`),
        '',
        `เปิดระบบ: ${workflowUrl}`,
      ].join('\n'),
    })
  }))

  return { skipped: false, to, departmentCount: recipientGroups.length }
}

async function sendTicketCreatedEmail({
  attachmentCount = 0,
  attachmentNames = [],
  customerCode,
  customerName,
  customerReference,
  detail,
  openedByDepartment,
  openedByName,
  phaseLabel,
  phaseName,
  recipients,
  stageName,
  stagePosition,
  targetDepartment,
  ticketName,
}) {
  const mailer = getTransporter()
  const to = uniqueEmails(recipients)

  if (!mailer || to.length === 0) {
    return { skipped: true, to }
  }

  const stageTitle = getStageTitle({ stage_name: stageName, stage_position: stagePosition })
  const phaseTitle = getPhaseTitle({ label: phaseLabel, name: phaseName })
  const subject = `[P.PIYA Solution - OEM] Ticket ใหม่ | ${customerName} | ${stageTitle} | ${phaseTitle}`
  const workflowUrl = getWorkflowUrl(customerReference)
  const rows = [
    { label: 'Ticket', value: ticketName },
    { label: 'Customer', value: customerName },
    ...(customerCode ? [{ label: 'Customer Code', value: customerCode }] : []),
    { label: 'Stage', value: stageTitle },
    { label: 'Phase', value: phaseTitle },
    { label: 'Opened By', value: `${openedByName} (${openedByDepartment})` },
    { label: 'Sent To', value: targetDepartment },
    {
      label: 'Attachments',
      value: attachmentCount
        ? `${attachmentCount} file(s): ${attachmentNames.join(', ')}`
        : 'ไม่มีไฟล์แนบ',
    },
    { label: 'Detail', value: detail },
  ]

  await mailer.sendMail({
    from: env.mail.from,
    to,
    subject,
    html: renderEmailLayout({
      intro: 'มี Ticket ใหม่ส่งถึงฝ่ายของคุณ',
      recipientName: targetDepartment,
      rows,
      workflowUrl,
    }),
    text: [
      `เรียน ทีม ${targetDepartment}`,
      '',
      'มี Ticket ใหม่ส่งถึงฝ่ายของคุณ',
      ...rows.map((row) => `${row.label}: ${row.value}`),
      '',
      `เปิดระบบ: ${workflowUrl}`,
    ].join('\n'),
  })

  return { skipped: false, to }
}

module.exports = {
  isMailEnabled,
  sendPhaseAdvancedEmail,
  sendTicketCreatedEmail,
}
