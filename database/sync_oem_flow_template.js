const fs = require('fs')
const path = require('path')
const vm = require('vm')
const dotenv = require('dotenv')
const mysql = require('mysql2/promise')

dotenv.config()

const frontendWorkflowPath = path.resolve(
  __dirname,
  '..',
  '..',
  'OEM',
  'oem-workflow',
  'src',
  'data',
  'oemWorkflow.ts',
)

function readFrontendStages() {
  const source = fs.readFileSync(frontendWorkflowPath, 'utf8')
  const start = source.indexOf('export const stages')
  const end = source.indexOf('export const departments')

  if (start === -1 || end === -1) {
    throw new Error(`Unable to find stages export in ${frontendWorkflowPath}`)
  }

  const executable = source
    .slice(start, end)
    .replace('export const stages: StageTemplate[]', 'const stages')

  const context = { globalThis: {} }
  vm.runInNewContext(`${executable}\nglobalThis.stages = stages;`, context)

  return context.globalThis.stages
}

async function getTemplateId(connection) {
  await connection.execute(
    `INSERT INTO workflow_templates (code, name, version, status, is_active)
     VALUES ('OEM_FLOW', 'OEM Flow', 1, 'active', 1)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       status = 'active',
       is_active = 1`,
  )

  const [rows] = await connection.execute(
    `SELECT id
     FROM workflow_templates
     WHERE code = 'OEM_FLOW'
     ORDER BY version DESC
     LIMIT 1`,
  )

  return rows[0].id
}

async function getDepartmentId(connection, departmentName) {
  const code = departmentName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 50)

  await connection.execute(
    `INSERT INTO departments (code, name, sort_order)
     VALUES (?, ?, (SELECT next_sort FROM (SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_sort FROM departments) AS sort_value))
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [code, departmentName],
  )

  const [rows] = await connection.execute(
    'SELECT id FROM departments WHERE name = ? LIMIT 1',
    [departmentName],
  )

  return rows[0].id
}

async function syncWorkflow() {
  const stages = readFrontendStages()
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'oem_app',
  })

  try {
    await connection.beginTransaction()

    const templateId = await getTemplateId(connection)
    let globalOrder = 1

    for (const [stageIndex, stage] of stages.entries()) {
      const stageSortOrder = (stageIndex + 1) * 10
      await connection.execute(
        `INSERT INTO workflow_stages (template_id, name, sort_order)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name)`,
        [templateId, stage.name, stageSortOrder],
      )

      const [stageRows] = await connection.execute(
        'SELECT id FROM workflow_stages WHERE template_id = ? AND sort_order = ? LIMIT 1',
        [templateId, stageSortOrder],
      )
      const stageId = stageRows[0].id

      for (const [phaseIndex, phase] of stage.stops.entries()) {
        const phaseSortOrder = (phaseIndex + 1) * 10
        await connection.execute(
          `INSERT INTO workflow_phases (stage_id, label, name, global_order, sort_order)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             global_order = VALUES(global_order),
             sort_order = VALUES(sort_order)`,
          [stageId, phase.label, phase.name, globalOrder, phaseSortOrder],
        )

        const [phaseRows] = await connection.execute(
          'SELECT id FROM workflow_phases WHERE stage_id = ? AND sort_order = ? LIMIT 1',
          [stageId, phaseSortOrder],
        )
        const phaseRow = phaseRows[0]

        if (!phaseRow) {
          throw new Error(
            `Unable to resolve phase after upsert: stage=${stage.name}, label=${phase.label}, sortOrder=${phaseSortOrder}`,
          )
        }

        const phaseId = phaseRow.id

        for (const [branchIndex, branch] of phase.branches.entries()) {
          const departmentId = await getDepartmentId(connection, branch.dept)
          await connection.execute(
            `INSERT INTO workflow_phase_branches (phase_id, department_id, sort_order)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order)`,
            [phaseId, departmentId, (branchIndex + 1) * 10],
          )

          const [branchRows] = await connection.execute(
            'SELECT id FROM workflow_phase_branches WHERE phase_id = ? AND department_id = ? LIMIT 1',
            [phaseId, departmentId],
          )
          const branchId = branchRows[0].id

          for (const [itemIndex, item] of branch.items.entries()) {
            await connection.execute(
              `INSERT INTO workflow_checklist_items (branch_id, label, sort_order, is_required)
               VALUES (?, ?, ?, 1)
               ON DUPLICATE KEY UPDATE
                 label = VALUES(label),
                 is_required = VALUES(is_required)`,
              [branchId, item, (itemIndex + 1) * 10],
            )
          }
        }

        globalOrder += 1
      }
    }

    await connection.commit()

    console.log(`Synced ${stages.length} stages and ${globalOrder - 1} phases into OEM_FLOW.`)
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    await connection.end()
  }
}

syncWorkflow().catch((error) => {
  console.error(error.stack || error)
  process.exit(1)
})
