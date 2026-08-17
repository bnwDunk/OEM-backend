const pool = require('../config/db')
const { env } = require('../config/env')
const { sendChangeNotificationEmail } = require('../services/mailService')

const ignoredPaths = [
  /\/notifications\/read-all$/,
  /\/notifications\/\d+\/read$/,
]
const hiddenKeyPattern = /^(data|filedata|file_data)$|password|token|secret|authorization|attachment.*data/i
const fieldLabels = {
  branchId: 'Branch',
  branches: 'Branches',
  checklistItems: 'Checklist items',
  color: 'Color',
  costPackage: 'Cost (Package)',
  costSyrup: 'Cost (Syrup)',
  customerCode: 'Customer code',
  departmentId: 'Department',
  departmentIds: 'Departments',
  dueDate: 'Due date',
  email: 'Email',
  fixedPrefix: 'Customer code prefix',
  flowId: 'Flow',
  items: 'Checklist items',
  label: 'Label',
  mimeType: 'File type',
  name: 'Name',
  phaseId: 'Phase',
  phases: 'Phases',
  price: 'Price',
  role: 'Role',
  salesperson: 'Salesperson',
  stageDueDates: 'Stage Due Date',
  stages: 'Stages',
  status: 'Status',
  suffixLength: 'Customer code running number',
  tags: 'Tags',
  tagsText: 'Tags',
  volume: 'Volume',
}
const fieldOrder = [
  'name',
  'customerCode',
  'status',
  'salesperson',
  'dueDate',
  'stageDueDates',
  'costSyrup',
  'costPackage',
  'price',
  'volume',
  'tagsText',
  'tags',
  'flowId',
]
const areaRules = [
  [/\/customer-code-settings(?:\/|$)/, 'Customer code settings'],
  [/\/customer-statuses(?:\/|$)/, 'Customer statuses'],
  [/\/project-flows(?:\/|$)/, 'Project flow'],
  [/\/customers\/[^/]+\/files(?:\/|$)/, 'Customer files'],
  [/\/customers\/[^/]+\/issues(?:\/|$)/, 'Customer tickets'],
  [/\/customers\/[^/]+\/tags(?:\/|$)/, 'Customer tags'],
  [/\/customers\/[^/]+\/phases(?:\/|$)/, 'Customer phase progress'],
  [/\/customers(?:\/|$)/, 'Customer details'],
  [/\/departments(?:\/|$)/, 'Departments'],
  [/\/flows\/[^/]+\/structure(?:\/|$)/, 'Flow structure'],
  [/\/flows\/[^/]+\/order(?:\/|$)/, 'Flow order'],
  [/\/flows\/[^/]+\/phases\/[^/]+\/branches(?:\/|$)/, 'Phase checklist'],
  [/\/flows\/[^/]+\/stages\/[^/]+\/phases(?:\/|$)/, 'Flow phases'],
  [/\/flows(?:\/|$)/, 'Flow configuration'],
  [/\/users(?:\/|$)/, 'Users'],
  [/\/tags(?:\/|$)/, 'Customer tags'],
  [/\/auth\/me$/, 'My profile'],
]

function humanizeFieldName(key, area) {
  if (key === 'name') {
    if (area === 'Customer details') return 'Customer'
    if (area === 'Customer files') return 'File name'
    if (area === 'Customer tickets') return 'Ticket'
    if (area === 'Customer tags') return 'Tag'
    if (area.startsWith('Flow')) return 'Flow name'
    if (area === 'Users') return 'User name'
    if (area === 'Departments') return 'Department name'
  }
  if (fieldLabels[key]) return fieldLabels[key]
  const text = String(key || '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : ''
}

function formatDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value
}

function summarizeValue(key, value) {
  if (key === 'stageDueDates' && Array.isArray(value)) {
    const dates = value.map((item) => formatDate(item?.dueDate)).filter(Boolean)
    return dates.length > 0 ? dates.join(', ') : 'No update'
  }
  if (Array.isArray(value)) {
    if (value.every((item) => ['string', 'number', 'boolean'].includes(typeof item))) {
      return value.join(', ') || 'No update'
    }
    const labels = value
      .map((item) => item?.label || item?.name)
      .filter(Boolean)
    return labels.length > 0 ? labels.join(', ') : (value.length > 0 ? `${value.length} item(s)` : 'No update')
  }
  if (value && typeof value === 'object') {
    const label = value.label || value.name
    const fieldCount = Object.keys(value).length
    return label || (fieldCount > 0 ? `${fieldCount} field(s)` : 'No update')
  }
  if (value === null || value === undefined || value === '') return 'No update'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(formatDate(value)).slice(0, 500)
}

function formatChangedFields(value, area) {
  if (!value || typeof value !== 'object') return []
  if (area === 'Customer files') {
    return [{ label: 'File name', value: summarizeValue('name', value.name) }]
  }
  return Object.entries(value)
    .filter(([key]) => !hiddenKeyPattern.test(key))
    .sort(([leftKey], [rightKey]) => {
      const leftIndex = fieldOrder.indexOf(leftKey)
      const rightIndex = fieldOrder.indexOf(rightKey)
      return (leftIndex < 0 ? fieldOrder.length : leftIndex)
        - (rightIndex < 0 ? fieldOrder.length : rightIndex)
    })
    .map(([key, item]) => ({
      label: humanizeFieldName(key, area),
      value: summarizeValue(key, item),
    }))
}

async function resolveSectionName(area, path) {
  if (area !== 'Customer files') return area

  const match = path.match(/\/customers\/(\d+)\/files(?:\/|$)/)
  if (!match) return 'Customer'

  const [rows] = await pool.execute(
    'SELECT name FROM customers WHERE id = ? LIMIT 1',
    [Number(match[1])],
  )
  return rows[0]?.name || 'Customer'
}

function getAction(method) {
  if (method === 'POST') return 'Created'
  if (method === 'DELETE') return 'Deleted'
  return 'Updated'
}

function getArea(path) {
  return areaRules.find(([pattern]) => pattern.test(path))?.[1] || 'OEM Workflow'
}

async function getRecipients(actor) {
  const [rows] = await pool.execute(
    `SELECT email
     FROM users
     WHERE is_active = 1
       AND role IN ('admin', 'webadmin')
       AND email IS NOT NULL
       AND email <> ''`,
  )
  return [...rows.map((row) => row.email), actor.email]
}

function shouldNotify(req, statusCode) {
  if (!env.mail.enabled || statusCode < 200 || statusCode >= 300) return false
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return false
  if (req.method === 'DELETE' && /\/customers\/[^/]+\/files\/[^/]+$/.test(req.path)) return false
  return !ignoredPaths.some((pattern) => pattern.test(req.path))
}

function changeEmailNotification(req, res, next) {
  const actor = req.user
  const method = req.method
  const path = req.originalUrl.split('?')[0]
  const area = getArea(path)
  const changedFields = formatChangedFields(req.body || {}, area).slice(0, 100)

  res.once('finish', () => {
    if (!actor || !shouldNotify(req, res.statusCode)) return

    setImmediate(async () => {
      try {
        const sectionName = await resolveSectionName(area, path)
        await sendChangeNotificationEmail({
          action: area === 'Customer files' ? null : getAction(method),
          actor,
          area: sectionName,
          changedFields,
          recipients: await getRecipients(actor),
        })
      } catch (error) {
        console.error('Failed to send change notification email:', error)
      }
    })
  })

  return next()
}

module.exports = changeEmailNotification
