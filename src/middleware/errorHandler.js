function notFound(req, res) {
  return res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` })
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error)
  }

  const status = error.status || 500

  return res.status(status).json({
    message: status === 500 ? 'Internal server error.' : error.message,
  })
}

module.exports = {
  errorHandler,
  notFound,
}
