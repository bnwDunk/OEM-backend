const express = require('express')
const {
  addCustomerTag,
  completeBranch,
  createIssue,
  listOverview,
  listTags,
  markAllNotificationsRead,
  markNotificationRead,
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
router.patch('/notifications/read-all', markAllNotificationsRead)
router.patch('/notifications/:id/read', markNotificationRead)
router.post('/customers/:id/tags', addCustomerTag)
router.delete('/customers/:id/tags/:tagId', removeCustomerTag)
router.post('/customers/:id/issues', createIssue)
router.put('/customers/:id/phases/:phaseIndex/branches/:branchIndex', saveBranchProgress)
router.post('/customers/:id/phases/:phaseIndex/branches/:branchIndex/complete', completeBranch)
router.post('/customers/:id/phases/:phaseIndex/reset', resetPhase)

module.exports = router
