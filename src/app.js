const cors = require('cors')
const express = require('express')
const { env } = require('./config/env')
const { errorHandler, notFound } = require('./middleware/errorHandler')
const adminRoutes = require('./routes/adminRoutes')
const authRoutes = require('./routes/authRoutes')
const oauthRoutes = require('./routes/oauthRoutes')
const workflowRoutes = require('./routes/workflowRoutes')

const app = express()

app.use(cors({ origin: env.clientOrigin, credentials: true }))
app.use(express.json())

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/auth', authRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/oauth', oauthRoutes)
app.use('/api/workflow', workflowRoutes)

app.use(notFound)
app.use(errorHandler)

module.exports = app
