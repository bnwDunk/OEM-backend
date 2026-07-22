const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { env } = require('../config/env')
const pool = require('../config/db')
const {
  createRefreshToken,
  findActiveRefreshToken,
  revokeRefreshToken,
  revokeUserRefreshTokens,
} = require('../models/refreshTokenModel')
const { findUserByIdentifier, findUserById, toPublicUser } = require('../models/userModel')
const {
  getJwtExpiry,
  hashToken,
  signAccessToken,
  signRefreshToken,
} = require('../utils/token')

function buildTokenResponse(user, refreshToken) {
  return {
    token_type: 'Bearer',
    access_token: signAccessToken(user),
    refresh_token: refreshToken,
    expires_in: env.jwt.accessExpiresIn,
    user: toPublicUser(user),
  }
}

async function login(req, res, next) {
  try {
    const { password } = req.body
    const identifier = String(req.body.identifier || req.body.username || req.body.email || '').trim()

    if (!identifier || !password) {
      return res.status(400).json({ message: 'Username or email and password are required.' })
    }

    const user = await findUserByIdentifier(identifier)

    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Invalid username/email or password.' })
    }

    const passwordMatched = await bcrypt.compare(password, user.passwordHash)

    if (!passwordMatched) {
      return res.status(401).json({ message: 'Invalid username/email or password.' })
    }

    const refreshToken = signRefreshToken(user)

    await createRefreshToken({
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: getJwtExpiry(refreshToken),
    })

    return res.json(buildTokenResponse(user, refreshToken))
  } catch (error) {
    return next(error)
  }
}

async function refresh(req, res, next) {
  try {
    const { refresh_token: refreshToken } = req.body

    if (!refreshToken) {
      return res.status(400).json({ message: 'refresh_token is required.' })
    }

    const payload = jwt.verify(refreshToken, env.jwt.refreshSecret)

    if (payload.token_type !== 'refresh_token') {
      return res.status(401).json({ message: 'Invalid refresh token.' })
    }

    const activeToken = await findActiveRefreshToken(hashToken(refreshToken))

    if (!activeToken) {
      return res.status(401).json({ message: 'Refresh token is expired or revoked.' })
    }

    const user = await findUserById(payload.sub)

    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'User is not active.' })
    }

    const newRefreshToken = signRefreshToken(user)

    await revokeRefreshToken(hashToken(refreshToken))
    await createRefreshToken({
      userId: user.id,
      tokenHash: hashToken(newRefreshToken),
      expiresAt: getJwtExpiry(newRefreshToken),
    })

    return res.json(buildTokenResponse(user, newRefreshToken))
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Invalid refresh token.' })
    }

    return next(error)
  }
}

async function logout(req, res, next) {
  try {
    const { refresh_token: refreshToken } = req.body

    if (refreshToken) {
      await revokeRefreshToken(hashToken(refreshToken))
    } else if (req.user) {
      await revokeUserRefreshTokens(req.user.id)
    }

    return res.status(204).send()
  } catch (error) {
    return next(error)
  }
}

function me(req, res) {
  return res.json({ user: toPublicUser(req.user) })
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())
}

async function updateMe(req, res, next) {
  try {
    const name = String(req.body.name || '').trim()
    const email = String(req.body.email || '').trim().toLowerCase()
    const currentPassword = String(req.body.currentPassword || '')
    const newPassword = String(req.body.newPassword || '')
    const changingPassword = Boolean(currentPassword || newPassword)

    if (!name || !email) {
      return res.status(400).json({ message: 'name and email are required.' })
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'A valid email is required for notifications.' })
    }

    if (changingPassword && (!currentPassword || !newPassword)) {
      return res.status(400).json({ message: 'Current password and new password are required.' })
    }

    if (changingPassword && newPassword.length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters.' })
    }

    if (changingPassword && !(await bcrypt.compare(currentPassword, req.user.passwordHash))) {
      return res.status(400).json({ message: 'Current password is incorrect.' })
    }

    const passwordHash = changingPassword ? await bcrypt.hash(newPassword, 10) : null

    await pool.execute(
      `UPDATE users
       SET name = ?, email = ?, password_hash = COALESCE(?, password_hash)
       WHERE id = ?`,
      [name, email, passwordHash, req.user.id],
    )

    const user = await findUserById(req.user.id)

    return res.json({ user: toPublicUser(user) })
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'This email is already used by another user.' })
    }

    return next(error)
  }
}

function oauthToken(req, res, next) {
  const { grant_type: grantType } = req.body

  if (grantType === 'password') {
    req.body.identifier = req.body.identifier || req.body.username || req.body.email
    return login(req, res, next)
  }

  if (grantType === 'refresh_token') {
    return refresh(req, res, next)
  }

  return res.status(400).json({
    error: 'unsupported_grant_type',
    message: 'Supported grant_type values are password and refresh_token.',
  })
}

module.exports = {
  login,
  logout,
  me,
  oauthToken,
  refresh,
  updateMe,
}
