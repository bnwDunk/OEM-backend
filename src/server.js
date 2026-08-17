const app = require('./app')
const pool = require('./config/db')
const { env, validateEnv } = require('./config/env')
const { startStageDueReminderScheduler } = require('./services/stageDueReminderService')

async function startServer() {
  validateEnv()
  await pool.query('SELECT 1')
  startStageDueReminderScheduler()

  app.listen(env.port, () => {
    console.log(`OEM backend API running on http://localhost:${env.port}`)
  })
}

startServer().catch((error) => {
  console.error('Failed to start server:', error.message || error.code || error)

  if (error.errors) {
    console.error(error.errors)
  }

  process.exit(1)
})
