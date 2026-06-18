const express = require('express')
const { oauthToken } = require('../controllers/authController')

const router = express.Router()

router.post('/token', oauthToken)

module.exports = router
