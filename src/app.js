const cors = require('cors')
const express = require('express')
const { env } = require('./config/env')
const { errorHandler, notFound } = require('./middleware/errorHandler')
const authRoutes = require('./routes/authRoutes')
const oauthRoutes = require('./routes/oauthRoutes')

const app = express()

app.use(cors({ origin: env.clientOrigin, credentials: true }))
app.use(express.json())

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/auth', authRoutes)
app.use('/api/oauth', oauthRoutes)

app.use(notFound)
app.use(errorHandler)

module.exports = app
