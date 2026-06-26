const express = require('express')
const {
  addCustomerTag,
  completeBranch,
  listOverview,
  listTags,
  saveBranchProgress,
} = require('../controllers/workflowController')
const authenticate = require('../middleware/authenticate')

const router = express.Router()

router.use(authenticate)

router.get('/overview', listOverview)
router.get('/tags', listTags)
router.post('/customers/:id/tags', addCustomerTag)
router.put('/customers/:id/phases/:phaseIndex/branches/:branchIndex', saveBranchProgress)
router.post('/customers/:id/phases/:phaseIndex/branches/:branchIndex/complete', completeBranch)

module.exports = router
