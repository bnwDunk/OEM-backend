const pool = require('../config/db')

async function createRefreshToken({ userId, tokenHash, expiresAt }) {
  await pool.execute(
    `INSERT INTO oauth_refresh_tokens (user_id, token_hash, expires_at)
     VALUES (?, ?, ?)`,
    [userId, tokenHash, expiresAt],
  )
}

async function findActiveRefreshToken(tokenHash) {
  const [rows] = await pool.execute(
    `SELECT id, user_id, token_hash, expires_at, revoked_at
     FROM oauth_refresh_tokens
     WHERE token_hash = ?
       AND revoked_at IS NULL
       AND expires_at > NOW()
     LIMIT 1`,
    [tokenHash],
  )

  return rows[0] || null
}

async function revokeRefreshToken(tokenHash) {
  await pool.execute(
    `UPDATE oauth_refresh_tokens
     SET revoked_at = NOW()
     WHERE token_hash = ?
       AND revoked_at IS NULL`,
    [tokenHash],
  )
}

async function revokeUserRefreshTokens(userId) {
  await pool.execute(
    `UPDATE oauth_refresh_tokens
     SET revoked_at = NOW()
     WHERE user_id = ?
       AND revoked_at IS NULL`,
    [userId],
  )
}

module.exports = {
  createRefreshToken,
  findActiveRefreshToken,
  revokeRefreshToken,
  revokeUserRefreshTokens,
}
