const express = require('express')
const { login, logout, me, refresh, updateMe } = require('../controllers/authController')
const authenticate = require('../middleware/authenticate')

const router = express.Router()

router.post('/login', login)
router.post('/refresh', refresh)
router.post('/logout', authenticate, logout)
router.get('/me', authenticate, me)
router.patch('/me', authenticate, updateMe)

module.exports = router
