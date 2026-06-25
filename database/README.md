# OEM Database Design

This database is designed around the current OEM Flow web UI.

## UI Mapping

| Web UI | Database tables |
| --- | --- |
| Login | `users`, `departments`, `oauth_refresh_tokens` |
| Admin dashboard | `users`, `departments`, `admin_audit_logs` |
| Admin flow management | `workflow_templates`, `workflow_stages`, `workflow_phases`, `workflow_phase_branches`, `workflow_checklist_items` |
| Overview customer cards | `customers`, `customer_tags`, `customer_tag_assignments`, `customer_workflows` |
| Stage / phase rails | `workflow_templates`, `workflow_stages`, `workflow_phases`, `customer_phase_states` |
| Department branch cards | `workflow_phase_branches`, `workflow_checklist_items`, `customer_branch_states`, `customer_checklist_states` |
| Department work view | `customer_workflows`, `customer_phase_states`, `customer_branch_states`, `workflow_phase_branches` |
| Company modal | `customers.cost_syrup`, `customers.cost_package`, `customers.price`, `customers.volume` |
| Ticket panel | `workflow_issues` |
| Notification bell / activity feed | `workflow_notifications`, `workflow_activity_logs` |
| Reset to draft | `customer_phase_states.reset_mode`, `reset_by_department_id`, `reset_at` |
| Configuration | `departments`, `users`, workflow template tables |

## Main Tables

- `departments`: departments shown in the top-right department switcher and configuration page.
- `users`: login accounts, department members, and role values such as `admin`, `manager`, `user`.
- `admin_audit_logs`: history of admin changes to users, departments, roles, and system settings.
- `customers`: OEM customer/project records.
- `customer_tags`: tag options shown on customer cards.
- `workflow_templates`: versioned workflow definition.
- `workflow_stages`: large stage groups shown as S1-S5.
- `workflow_phases`: phase/stop rows inside each stage.
- `workflow_phase_branches`: department-owned work branches inside each phase.
- `workflow_checklist_items`: checklist rows inside each branch card.
- `customer_workflows`: one customer's active workflow and current phase.
- `customer_phase_states`: per-customer phase status, including reset state.
- `customer_branch_states`: per-customer branch status.
- `customer_checklist_states`: per-customer checklist checkbox state.
- `workflow_issues`: cross-department tickets.
- `workflow_notifications`: bell notifications.
- `workflow_activity_logs`: audit/feed history.

## Install

Fresh database:

```bash
mysql -u root -p < database/schema.sql
```

Existing database:

```bash
mysql -u root -p oem_app < database/migrations/001_add_departments.sql
mysql -u root -p oem_app < database/migrations/002_oem_workflow_tables.sql
mysql -u root -p oem_app < database/migrations/003_admin_dashboard.sql
mysql -u root -p oem_app < database/migrations/004_seed_standard_user.sql
mysql -u root -p oem_app < database/migrations/005_flow_template_parent.sql
mysql -u root -p oem_app < database/migrations/006_flow_template_status.sql
```

## Notes

- The frontend currently keeps demo workflow data in `src/data/oemWorkflow.ts`.
- `schema.sql` creates the structure needed to move that data into MySQL.
- The first admin account is seeded as `admin@oem.local` with role `admin`.
- A standard user account is seeded as `user@oem.local` with role `user`.
- Flow templates can reference a source flow through `workflow_templates.parent_template_id`.
- Workflow template seed data can be added next from the React `stages` array.
