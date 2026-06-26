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

async function sendPhaseAdvancedEmail({ customerName, nextPhase, recipients }) {
  const mailer = getTransporter()
  const to = uniqueEmails(recipients)

  if (!mailer || to.length === 0) {
    return { skipped: true, to }
  }

  const phaseTitle = `Phase ${nextPhase.label}: ${nextPhase.name}`
  const subject = `[OEM Workflow] New work arrived - ${phaseTitle}`
  const customer = escapeHtml(customerName)
  const safePhaseTitle = escapeHtml(phaseTitle)
  const appUrl = escapeHtml(env.mail.appUrl)

  await mailer.sendMail({
    from: env.mail.from,
    to,
    subject,
    html: `
      <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#172033">
        <p>New OEM work has arrived for your department.</p>
        <p>
          <strong>Customer:</strong> ${customer}<br>
          <strong>Next phase:</strong> ${safePhaseTitle}
        </p>
        <p>
          Please open OEM Workflow to review and continue the work:<br>
          <a href="${appUrl}">${appUrl}</a>
        </p>
      </div>
    `,
    text: [
      'New OEM work has arrived for your department.',
      `Customer: ${customerName}`,
      `Next phase: ${phaseTitle}`,
      `Open OEM Workflow: ${env.mail.appUrl}`,
    ].join('\n'),
  })

  return { skipped: false, to }
}

module.exports = {
  isMailEnabled,
  sendPhaseAdvancedEmail,
}
