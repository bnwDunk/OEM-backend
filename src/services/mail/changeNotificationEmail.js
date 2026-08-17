const { env } = require('../../config/env')
const { renderEmailLayout } = require('./layout')
const { getTransporter } = require('./transport')
const { uniqueEmails } = require('./helpers')

async function sendChangeNotificationEmail({ action, actor, area, changedFields, recipients }) {
  const mailer = getTransporter()
  const bcc = uniqueEmails(recipients)
  if (!mailer || bcc.length === 0) return { skipped: true, to: bcc }

  const actorName = String(actor?.name || actor?.email || 'Unknown user')
  const actorDepartment = String(actor?.departmentName || actor?.department?.name || '-')
  const appUrl = String(env.mail.appUrl || '').trim().replace(/\/$/, '')
  const fieldRows = Array.isArray(changedFields) && changedFields.length > 0
    ? changedFields.map(({ label, value }) => ({ label, value }))
    : [{ label: 'Update', value: 'No update' }]
  const rows = [
    { label: 'Changed by', value: `${actorName} (${actor?.role || '-'})` },
    { label: 'Email', value: actor?.email || '-' },
    { label: 'Department', value: actorDepartment },
    ...(action ? [{ label: 'Action', value: action }] : []),
    { label: 'Section', value: area },
    ...(action ? [{ section: 'Changed fields' }] : []),
    ...fieldRows,
    {
      label: 'Changed at',
      value: new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium', timeStyle: 'long', timeZone: env.mail.reminderTimeZone,
      }).format(new Date()),
    },
  ]
  await mailer.sendMail({
    from: env.mail.from,
    to: env.mail.from,
    bcc,
    subject: `[P.PIYA Solution - OEM] ${action || 'File attached'} | ${area} | ${actorName}`,
    html: renderEmailLayout({ intro: 'OEM Workflow change notification', recipientName: 'administrators', rows, workflowUrl: appUrl }),
    text: [
      'OEM Workflow change notification',
      '',
      ...rows.map((row) => row.section ? `--- ${row.section} ---` : `${row.label}: ${row.value}`),
      '',
      `Open system: ${appUrl}`,
    ].join('\n'),
  })
  return { skipped: false, to: bcc }
}

module.exports = { sendChangeNotificationEmail }
