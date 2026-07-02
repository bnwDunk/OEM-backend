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
    emails
      .map((email) => String(email || '').trim().toLowerCase())
      .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      .filter((email) => !email.endsWith('.local')),
  )]
}

function getWorkflowUrl() {
  const appUrl = String(env.mail.appUrl || '').trim().replace(/\/$/, '')
  return appUrl.endsWith('/flow') ? appUrl : `${appUrl}/flow`
}

async function sendPhaseAdvancedEmail({ customerName, nextPhase, recipients }) {
  const mailer = getTransporter()
  const to = uniqueEmails(recipients)

  if (!mailer || to.length === 0) {
    return { skipped: true, to }
  }

  const phaseTitle = `Phase ${nextPhase.label}: ${nextPhase.name}`
  const stageTitle = nextPhase.stage_position ? `Stage ${nextPhase.stage_position}` : (nextPhase.stage_name || 'Stage')
  const departmentName = Array.isArray(nextPhase.departments) && nextPhase.departments.length > 0
    ? nextPhase.departments.join(' / ')
    : 'ที่เกี่ยวข้อง'
  const subject = `[P.PIYA Solution - OEM] New Task — ${customerName} | Phase ${nextPhase.label}`
  const customer = escapeHtml(customerName)
  const department = escapeHtml(departmentName)
  const safeStageTitle = escapeHtml(stageTitle)
  const safePhaseTitle = escapeHtml(phaseTitle)
  const workflowUrl = getWorkflowUrl()
  const appUrl = escapeHtml(workflowUrl)

  await mailer.sendMail({
    from: env.mail.from,
    to,
    subject,
    html: `
      <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#172033">
        <p>เรียน ทีม ${department}</p>
        <p>งานใหม่รอดำเนินการสำหรับแผนกของคุณ</p>
        <p>
          <strong>Customer</strong> : ${customer}<br>
          <strong>Stage</strong> : ${safeStageTitle}<br>
          <strong>Phase</strong> : ${safePhaseTitle}
        </p>
        <p>
          กดลิงก์เพื่อเปิดระบบและดำเนินการต่อ:<br>
          <a href="${appUrl}">${appUrl}</a>
        </p>
        <p>—<br>OEM Workflow System | This email was sent automatically. Please do not reply</p>
      </div>
    `,
    text: [
      'แจ้งเตือน Phase',
      `เรียน ทีม ${departmentName}`,
      '',
      'งานใหม่รอดำเนินการสำหรับแผนกของคุณ',
      '',
      `Customer : ${customerName}`,
      `Stage : ${stageTitle}`,
      `Phase : ${phaseTitle}`,
      '',
      'กดลิงก์เพื่อเปิดระบบและดำเนินการต่อ:',
      workflowUrl,
      '',
      '—',
      'OEM Workflow System | This email was sent automatically. Please do not reply',
    ].join('\n'),
  })

  return { skipped: false, to }
}

async function sendTicketCreatedEmail({ customerName, detail, openedByDepartment, openedByName, recipients, targetDepartment, ticketName }) {
  const mailer = getTransporter()
  const to = uniqueEmails(recipients)

  if (!mailer || to.length === 0) {
    return { skipped: true, to }
  }

  const subject = `[P.PIYA Solution - OEM] New Ticket — ${customerName} | ${ticketName}`
  const customer = escapeHtml(customerName)
  const department = escapeHtml(targetDepartment)
  const opener = escapeHtml(openedByName)
  const openerDepartment = escapeHtml(openedByDepartment)
  const safeDetail = escapeHtml(detail)
  const workflowUrl = getWorkflowUrl()
  const appUrl = escapeHtml(workflowUrl)

  await mailer.sendMail({
    from: env.mail.from,
    to,
    subject,
    html: `
      <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#172033">
        <p>เรียน ทีม ${department}</p>
        <p>มี Ticket ใหม่ส่งมาถึงแผนกของคุณ</p>
        <p>
          <strong>Customer</strong> : ${customer}<br>
          <strong>Opened by</strong> : ${opener} | ${openerDepartment}<br>
          <strong>Detai</strong>l : ${safeDetail}
        </p>
        <p>
          กดลิงก์เพื่อเปิดระบบและดำเนินการต่อ:<br>
          <a href="${appUrl}">${appUrl}</a>
        </p>
        <p>—<br>OEM Workflow System | This email was sent automatically. Please do not reply.</p>
      </div>
    `,
    text: [
      `เรียน ทีม ${targetDepartment}`,
      '',
      'มี Ticket ใหม่ส่งมาถึงแผนกของคุณ',
      '',
      `Customer : ${customerName}`,
      `Opened by : ${openedByName} | ${openedByDepartment}`,
      `Detail : ${detail}`,
      '',
      'กดลิงก์เพื่อเปิดระบบและดำเนินการต่อ:',
      workflowUrl,
      '',
      '—',
      'OEM Workflow System | This email was sent automatically. Please do not reply.',
    ].join('\n'),
  })

  return { skipped: false, to }
}

module.exports = {
  isMailEnabled,
  sendPhaseAdvancedEmail,
  sendTicketCreatedEmail,
}
