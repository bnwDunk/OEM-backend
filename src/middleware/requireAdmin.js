function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin role is required.' })
  }

  return next()
}

module.exports = requireAdmin
