const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { env } = require('../config/env')

function signAccessToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      role: user.role,
      department_id: user.departmentId,
      department_ids: user.departmentIds || [],
      token_type: 'access_token',
    },
    env.jwt.accessSecret,
    { expiresIn: env.jwt.accessExpiresIn },
  )
}

function signRefreshToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      token_type: 'refresh_token',
    },
    env.jwt.refreshSecret,
    { expiresIn: env.jwt.refreshExpiresIn },
  )
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function getJwtExpiry(token) {
  const decoded = jwt.decode(token)
  return new Date(decoded.exp * 1000)
}

module.exports = {
  getJwtExpiry,
  hashToken,
  signAccessToken,
  signRefreshToken,
}
