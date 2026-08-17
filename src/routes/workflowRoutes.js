const express = require('express')
const {
  createCustomer,
  updateCustomer,
} = require('../controllers/adminController')
const {
  addCustomerTag,
  closeIssue,
  completeBranch,
  createDepartmentPhase,
  createIssue,
  deleteCustomerFile,
  getFlowStructure,
  getCustomerFile,
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
  updateFlowOrder,
  updateTag,
  uploadCustomerFile,
} = require('../controllers/workflowController')
const authenticate = require('../middleware/authenticate')
const changeEmailNotification = require('../middleware/changeEmailNotification')
const requireWebAdmin = require('../middleware/requireWebAdmin')

const router = express.Router()

router.use(authenticate, changeEmailNotification)

function restrictCustomerCodeToAdmin(req, res, next) {
  const role = String(req.user?.role || '').trim().toLowerCase()

  if (role !== 'admin' && Object.prototype.hasOwnProperty.call(req.body || {}, 'customerCode')) {
    return res.status(403).json({ message: 'Admin role is required to update customer code.' })
  }

  return next()
}

router.get('/overview', listOverview)
router.get('/flows', listFlows)
router.get('/flows/:id/structure', getFlowStructure)
router.put('/flows/:flowId/order', requireWebAdmin, updateFlowOrder)
router.post('/flows/:flowId/stages/:stageId/phases', createDepartmentPhase)
router.put('/flows/:flowId/phases/:phaseId/branches/:branchId/items', updateFlowBranchItems)
router.get('/customer-statuses', listCustomerStatuses)
router.get('/tags', listTags)
router.patch('/tags/:id', updateTag)
router.patch('/notifications/read-all', markAllNotificationsRead)
router.patch('/notifications/:id/read', markNotificationRead)
router.post('/customers', createCustomer)
router.patch('/customers/:id', restrictCustomerCodeToAdmin, updateCustomer)
router.post('/customers/:id/tags', addCustomerTag)
router.delete('/customers/:id/tags/:tagId', removeCustomerTag)
router.post('/customers/:id/files', uploadCustomerFile)
router.get('/customers/:id/files/:fileId', getCustomerFile)
router.delete('/customers/:id/files/:fileId', deleteCustomerFile)
router.post('/customers/:id/issues', createIssue)
router.patch('/customers/:id/issues/:issueId/close', closeIssue)
router.put('/customers/:id/phases/:phaseIndex/branches/:branchIndex', saveBranchProgress)
router.post('/customers/:id/phases/:phaseIndex/branches/:branchIndex/complete', completeBranch)
router.post('/customers/:id/phases/:phaseIndex/reset', resetPhase)

module.exports = router
