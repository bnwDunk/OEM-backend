const express = require('express')
const {
  addCustomerTag,
  completeBranch,
  listOverview,
  listTags,
  removeCustomerTag,
  resetPhase,
  saveBranchProgress,
  updateTag,
} = require('../controllers/workflowController')
const authenticate = require('../middleware/authenticate')

const router = express.Router()

router.use(authenticate)

router.get('/overview', listOverview)
router.get('/tags', listTags)
router.patch('/tags/:id', updateTag)
router.post('/customers/:id/tags', addCustomerTag)
router.delete('/customers/:id/tags/:tagId', removeCustomerTag)
router.put('/customers/:id/phases/:phaseIndex/branches/:branchIndex', saveBranchProgress)
router.post('/customers/:id/phases/:phaseIndex/branches/:branchIndex/complete', completeBranch)
router.post('/customers/:id/phases/:phaseIndex/reset', resetPhase)

module.exports = router
