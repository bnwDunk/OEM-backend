const app = require('./app')
const pool = require('./config/db')
const { env, validateEnv } = require('./config/env')

async function startServer() {
  validateEnv()
  await pool.query('SELECT 1')

  app.listen(env.port, () => {
    console.log(`OEM backend API running on http://localhost:${env.port}`)
  })
}

startServer().catch((error) => {
  console.error('Failed to start server:', error.message)
  process.exit(1)
})
