const { sendChangeNotificationEmail } = require('./mail/changeNotificationEmail')
const { sendPhaseAdvancedEmail } = require('./mail/phaseAdvancedEmail')
const { sendStageDueReminderEmail } = require('./mail/stageDueReminderEmail')
const { sendTicketCreatedEmail } = require('./mail/ticketCreatedEmail')
const { isMailEnabled } = require('./mail/transport')

module.exports = {
  isMailEnabled,
  sendChangeNotificationEmail,
  sendPhaseAdvancedEmail,
  sendStageDueReminderEmail,
  sendTicketCreatedEmail,
}
