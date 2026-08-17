const nodemailer = require('nodemailer')
const { env } = require('../../config/env')

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
      auth: { user: env.mail.user, pass: env.mail.pass },
    })
  }
  return transporter
}

module.exports = { getTransporter, isMailEnabled }
