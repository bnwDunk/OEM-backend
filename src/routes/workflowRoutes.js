const express = require('express')
const { addCustomerTag, listOverview, listTags } = require('../controllers/workflowController')
const authenticate = require('../middleware/authenticate')

const router = express.Router()

router.use(authenticate)

router.get('/overview', listOverview)
router.get('/tags', listTags)
router.post('/customers/:id/tags', addCustomerTag)

module.exports = router
