const express = require('express')
const {
  createDepartment,
  createFlow,
  createUser,
  deleteFlow,
  listDepartments,
  listFlows,
  listUsers,
  updateDepartment,
  updateFlow,
  updateUser,
} = require('../controllers/adminController')
const authenticate = require('../middleware/authenticate')
const requireAdmin = require('../middleware/requireAdmin')

const router = express.Router()

router.use(authenticate, requireAdmin)

router.get('/users', listUsers)
router.post('/users', createUser)
router.patch('/users/:id', updateUser)

router.get('/departments', listDepartments)
router.post('/departments', createDepartment)
router.patch('/departments/:id', updateDepartment)

router.get('/flows', listFlows)
router.post('/flows', createFlow)
router.patch('/flows/:id', updateFlow)
router.delete('/flows/:id', deleteFlow)

module.exports = router
