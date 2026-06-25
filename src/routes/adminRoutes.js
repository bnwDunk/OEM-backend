const express = require('express')
const {
  createDepartment,
  createCustomer,
  createFlow,
  createProjectWithFlow,
  createUser,
  deleteUser,
  deleteCustomer,
  deleteFlow,
  getFlowStructure,
  listCustomers,
  listDepartments,
  listFlows,
  listUsers,
  updateCustomer,
  updateDepartment,
  updateFlow,
  updateFlowStructure,
  updateUser,
} = require('../controllers/adminController')
const authenticate = require('../middleware/authenticate')
const requireAdmin = require('../middleware/requireAdmin')

const router = express.Router()

router.use(authenticate, requireAdmin)

router.get('/users', listUsers)
router.post('/users', createUser)
router.patch('/users/:id', updateUser)
router.delete('/users/:id', deleteUser)

router.get('/departments', listDepartments)
router.post('/departments', createDepartment)
router.patch('/departments/:id', updateDepartment)

router.get('/flows', listFlows)
router.post('/flows', createFlow)
router.patch('/flows/:id', updateFlow)
router.delete('/flows/:id', deleteFlow)
router.get('/flows/:id/structure', getFlowStructure)
router.put('/flows/:id/structure', updateFlowStructure)

router.get('/customers', listCustomers)
router.post('/customers', createCustomer)
router.patch('/customers/:id', updateCustomer)
router.delete('/customers/:id', deleteCustomer)

router.post('/project-flows', createProjectWithFlow)

module.exports = router
