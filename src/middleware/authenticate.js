const jwt = require('jsonwebtoken')
const { env } = require('../config/env')
const { findUserById } = require('../models/userModel')

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization || ''
    const [scheme, token] = authHeader.split(' ')

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ message: 'Bearer token is required.' })
    }

    const payload = jwt.verify(token, env.jwt.accessSecret)

    if (payload.token_type !== 'access_token') {
      return res.status(401).json({ message: 'Invalid access token.' })
    }

    const user = await findUserById(payload.sub)

    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'User is not active.' })
    }

    req.user = user
    return next()
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Invalid access token.' })
    }

    return next(error)
  }
}

module.exports = authenticate
