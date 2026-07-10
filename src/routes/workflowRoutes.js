const express = require('express')
const {
  addCustomerTag,
  completeBranch,
  createIssue,
  getFlowStructure,
  listFlows,
  listCustomerStatuses,
  listOverview,
  listTags,
  markAllNotificationsRead,
  markNotificationRead,
  removeCustomerTag,
  resetPhase,
  saveBranchProgress,
  updateFlowBranchItems,
  updateTag,
} = require('../controllers/workflowController')
const authenticate = require('../middleware/authenticate')

const router = express.Router()

router.use(authenticate)

router.get('/overview', listOverview)
router.get('/flows', listFlows)
router.get('/flows/:id/structure', getFlowStructure)
router.put('/flows/:flowId/phases/:phaseId/branches/:branchId/items', updateFlowBranchItems)
router.get('/customer-statuses', listCustomerStatuses)
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
