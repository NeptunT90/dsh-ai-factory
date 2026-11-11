import type { ToolHealthSpec } from './types.js'

/**
 * Explicit health registry. It covers only factory_* tools; host tools are
 * owned by DSH and never receive a health status here.
 *
 * R0 probe: safe call through ctx.tools.execute.
 * R0 observed: tool body writes audit/projects; do not probe in BLOCK 1.
 * R1 schema: registration/schema only; status REGISTERED.
 * R2 not_testable: never call; status NOT_TESTABLE.
 */
export const TOOL_HEALTH_SPECS: readonly ToolHealthSpec[] = [
  { tool: 'factory_status', action: '*', risk: 'R0', mode: 'probe', arguments: {} },
  { tool: 'factory_memory_remember', action: '*', risk: 'R1', mode: 'schema' },
  { tool: 'factory_memory_search', action: '*', risk: 'R0', mode: 'observed', probeReason: 'hidden_side_effect:audit_log' },
  { tool: 'factory_memory_get', action: '*', risk: 'R0', mode: 'probe', requiresMemoryFixture: true },
  { tool: 'factory_memory_update', action: '*', risk: 'R1', mode: 'schema' },
  { tool: 'factory_memory_forget', action: '*', risk: 'R1', mode: 'schema' },
  { tool: 'factory_memory_history', action: '*', risk: 'R0', mode: 'probe', requiresMemoryFixture: true },
  { tool: 'factory_memory_stats', action: '*', risk: 'R0', mode: 'probe', arguments: {} },
  { tool: 'factory_agent_list', action: '*', risk: 'R0', mode: 'probe', arguments: { limit: 5 } },
  { tool: 'factory_agent_get', action: '*', risk: 'R0', mode: 'probe', arguments: { id: 'agt_director' } },
  { tool: 'factory_agent_save', action: '*', risk: 'R1', mode: 'schema' },
  { tool: 'factory_agent_toggle', action: '*', risk: 'R1', mode: 'schema' },
  { tool: 'factory_agent_export', action: '*', risk: 'R1', mode: 'schema' },
  { tool: 'factory_agent_import', action: '*', risk: 'R1', mode: 'schema' },
  { tool: 'factory_agent_validate', action: '*', risk: 'R0', mode: 'observed', probeReason: 'requires_agent_file' },

  { tool: 'factory_skill_list', action: '*', risk: 'R0', mode: 'probe', arguments: {} },
  { tool: 'factory_skill_get', action: '*', risk: 'R0', mode: 'observed', probeReason: 'requires_skill_id' },
  { tool: 'factory_skill_validate', action: '*', risk: 'R0', mode: 'probe', arguments: {} },
  { tool: 'factory_skill_create', action: '*', risk: 'R1', mode: 'schema' },
  { tool: 'factory_skill_update', action: '*', risk: 'R1', mode: 'schema' },
  { tool: 'factory_skill_delete', action: '*', risk: 'R1', mode: 'schema' },
  { tool: 'factory_skill_assign', action: '*', risk: 'R1', mode: 'schema' },
  { tool: 'factory_capability_scan', action: '*', risk: 'R1', mode: 'schema' },
  { tool: 'factory_capability_list', action: '*', risk: 'R0', mode: 'probe', arguments: {} },
  { tool: 'factory_capability_get', action: '*', risk: 'R0', mode: 'observed', probeReason: 'requires_capability_id' },
  { tool: 'factory_capability_check', action: '*', risk: 'R0', mode: 'probe', arguments: { requirements: [] } },
  { tool: 'factory_capability_refresh', action: '*', risk: 'R1', mode: 'schema' },
  { tool: 'factory_backup_verify', action: '*', risk: 'R0', mode: 'observed', probeReason: 'requires_backup_archive' },
  { tool: 'factory_backup_restore_test', action: '*', risk: 'R1', mode: 'schema' },



  { tool: 'factory_task_create', action: '*', risk: 'R1', mode: 'schema' },
  { tool: 'factory_task_list', action: '*', risk: 'R0', mode: 'observed', probeReason: 'hidden_side_effect:projects.updated_at' },
  { tool: 'factory_task_get', action: '*', risk: 'R0', mode: 'observed', probeReason: 'hidden_side_effect:projects.updated_at' },
  { tool: 'factory_task_update', action: '*', risk: 'R1', mode: 'schema' },
  { tool: 'factory_task_claim', action: '*', risk: 'R1', mode: 'schema' },
  { tool: 'factory_task_heartbeat', action: '*', risk: 'R1', mode: 'schema' },
  { tool: 'factory_task_review', action: '*', risk: 'R1', mode: 'schema' },
  { tool: 'factory_task_complete', action: '*', risk: 'R1', mode: 'schema' },
  { tool: 'factory_task_fail', action: '*', risk: 'R1', mode: 'schema' },
  { tool: 'factory_task_cancel', action: '*', risk: 'R1', mode: 'schema' },
  { tool: 'factory_task_retry', action: '*', risk: 'R1', mode: 'schema' },
  { tool: 'factory_task_recover', action: '*', risk: 'R1', mode: 'schema' },
  { tool: 'factory_task_events', action: '*', risk: 'R0', mode: 'observed', probeReason: 'hidden_side_effect:projects.updated_at' },
  { tool: 'factory_task_stats', action: '*', risk: 'R0', mode: 'observed', probeReason: 'hidden_side_effect:projects.updated_at' },
  { tool: 'factory_task_tell', action: '*', risk: 'R1', mode: 'schema' },
  { tool: 'factory_plan_create', action: '*', risk: 'R1', mode: 'schema' },
  { tool: 'factory_director_brief', action: '*', risk: 'R0', mode: 'observed', probeReason: 'hidden_side_effect:projects.updated_at' },
  { tool: 'factory_tools_list', action: '*', risk: 'R0', mode: 'probe', arguments: {} },
  { tool: 'factory_dispatch', action: '*', risk: 'R2', mode: 'not_testable' },
  { tool: 'factory_dashboard', action: 'status', risk: 'R0', mode: 'probe', arguments: { action: 'status' } },
  { tool: 'factory_dashboard', action: 'start', risk: 'R1', mode: 'schema' },
  { tool: 'factory_dashboard', action: 'stop', risk: 'R1', mode: 'schema' },
  { tool: 'factory_sync', action: 'status', risk: 'R0', mode: 'probe', arguments: { action: 'status' } },
  { tool: 'factory_sync', action: 'push', risk: 'R2', mode: 'not_testable' },
  { tool: 'factory_sync', action: 'pull', risk: 'R2', mode: 'not_testable' },
  { tool: 'factory_sync', action: 'sync', risk: 'R2', mode: 'not_testable' },
  { tool: 'factory_review', action: '*', risk: 'R2', mode: 'not_testable' },
  { tool: 'factory_workflow_run', action: '*', risk: 'R2', mode: 'not_testable' },
  { tool: 'factory_model_route', action: '*', risk: 'R0', mode: 'probe', arguments: { role: 'developer' } },
  { tool: 'factory_auto_workflow', action: 'status', risk: 'R0', mode: 'probe', arguments: { action: 'status' } },
  { tool: 'factory_auto_workflow', action: 'stop', risk: 'R1', mode: 'schema' },
  { tool: 'factory_auto_workflow', action: 'run', risk: 'R2', mode: 'not_testable' },
  { tool: 'factory_auto_workflow', action: 'start', risk: 'R2', mode: 'not_testable' },
]

/** Names that are intentionally absent from the registry. */
export const HEALTH_TOOL_NAMES = [
  'factory_tool_health',
  'factory_tool_health_check',
  'factory_tool_health_history',
] as const

export function specsFor(tool?: string, action?: string): readonly ToolHealthSpec[] {
  return TOOL_HEALTH_SPECS.filter(
    (spec) => (tool === undefined || spec.tool === tool) && (action === undefined || spec.action === action),
  )
}
