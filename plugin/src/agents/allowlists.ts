import type { AgentRole } from './types.js'

/**
 * Host capabilities are registered by DSH outside the factory tool set. They
 * are still checked by the same execution guard: a child may only call a host
 * capability whose exact tool name is in its profile allowlist.
 *
 * `run_code` is the reserved PTC transport; it is never granted to a child.
 */
export const HOST_TOOL_NAMES = [
  'read',
  'write',
  'edit',
  'apply_patch',
  'grep',
  'glob',
  'working_directory',
  'bash',
  'pwsh',
  'terminal',
  'run_code',
] as const

export const HOST_TOOL_ALIASES = [
  'read_file',
  'write_file',
  'fs_read',
  'fs_write',
  'shell',
] as const

/** Browser tools are host capabilities too; a child without them must be denied. */
export const BROWSER_TOOL_NAMES = [
  'browser_open',
  'browser_navigate',
  'browser_snapshot',
  'browser_click',
  'browser_fill',
  'browser_press',
  'browser_wait',
  'browser_history',
  'browser_screenshot',
  'browser_tabs',
] as const

export function isHostCapability(name: string): boolean {
  return (HOST_TOOL_NAMES as readonly string[]).includes(name) ||
    (HOST_TOOL_ALIASES as readonly string[]).includes(name) ||
    (BROWSER_TOOL_NAMES as readonly string[]).includes(name)
}

/**
 * Explicit model-facing tool allowlists. These are enforcement data: dispatch
 * and review pass them to the child runner, and the tool guard rejects any call
 * outside the set with TOOL_NOT_ALLOWED.
 *
 * Child profiles deliberately have no factory_dispatch / factory_review /
 * factory_workflow_run: orchestration belongs to the root agent. Reviewer and
 * researcher also have no destructive factory tools.
 */
export const ALLOWLISTS: Readonly<Record<AgentRole, readonly string[]>> = {
  director: [
    'read', 'grep', 'glob', 'working_directory',
    'web_search', 'web_fetch',
    'office_read', 'office_query',
    'factory_status', 'factory_tools_list',
    'factory_memory_search', 'factory_memory_get', 'factory_memory_history', 'factory_memory_stats', 'factory_memory_remember',
    'factory_task_list', 'factory_task_get', 'factory_task_events', 'factory_task_stats', 'factory_task_tell',
    'factory_plan_create', 'factory_task_create', 'factory_task_update',
    'factory_skill_list', 'factory_skill_get', 'factory_skill_validate', 'factory_skill_create', 'factory_skill_update', 'factory_skill_delete', 'factory_skill_assign',
    'factory_capability_scan', 'factory_capability_list', 'factory_capability_get', 'factory_capability_check', 'factory_capability_refresh',
    'factory_backup_verify', 'factory_backup_restore_test',
    'factory_dashboard',
    'factory_director_brief',
  ],
  researcher: [
    'grep', 'glob', 'working_directory',
    'web_search', 'web_fetch',
    'browser_open', 'browser_navigate', 'browser_snapshot', 'browser_wait', 'browser_screenshot', 'browser_tabs',
    'office_read', 'office_query',
    'factory_status', 'factory_tools_list',
    'factory_memory_search', 'factory_memory_get', 'factory_memory_history', 'factory_memory_update',
    'factory_memory_remember', 'factory_memory_stats',
    'factory_task_list', 'factory_task_get', 'factory_task_events', 'factory_task_stats',
  ],
  developer: [
    'read', 'write', 'edit', 'grep', 'glob', 'bash', 'pwsh', 'working_directory',
    'office_read', 'office_query',
    'factory_status', 'factory_tools_list',
    'factory_memory_search', 'factory_memory_get', 'factory_memory_history', 'factory_memory_update',
    'factory_memory_remember', 'factory_memory_stats',
    'factory_task_list', 'factory_task_get', 'factory_task_events', 'factory_task_stats',
  ],
  sysadmin: [
    'read', 'write', 'edit', 'grep', 'glob', 'bash', 'pwsh', 'working_directory',
    'ssh_list', 'ssh_exec', 'ssh_upload', 'ssh_download', 'ssh_tunnel', 'ssh_cluster',
    'factory_status', 'factory_tools_list',
  ],
  analyst: [
    'read', 'write', 'edit', 'grep', 'glob', 'bash', 'pwsh', 'working_directory',
    'office_read', 'office_query', 'office_write_xlsx', 'office_edit_xlsx',
    'factory_status', 'factory_tools_list',
    'factory_memory_search', 'factory_memory_get', 'factory_memory_history', 'factory_memory_update',
    'factory_memory_remember', 'factory_memory_stats',
    'factory_task_list', 'factory_task_get', 'factory_task_events', 'factory_task_stats',
  ],
  executor: [
    'read', 'write', 'edit', 'grep', 'glob', 'bash', 'pwsh', 'working_directory',
    'browser_open', 'browser_navigate', 'browser_snapshot', 'browser_click', 'browser_fill',
    'browser_press', 'browser_wait', 'browser_history', 'browser_screenshot', 'browser_tabs',
    'office_read', 'office_query', 'office_write_docx', 'office_write_xlsx',
    'factory_status', 'factory_tools_list',
    'factory_memory_search', 'factory_memory_get', 'factory_memory_remember', 'factory_memory_stats',
    'factory_task_list', 'factory_task_get', 'factory_task_events', 'factory_task_stats',
  ],
  reviewer: [
    'read', 'grep', 'glob', 'bash', 'pwsh', 'working_directory', 'office_read',
    'factory_status', 'factory_tools_list',
    'factory_memory_search', 'factory_memory_get', 'factory_memory_history', 'factory_memory_stats',
    'factory_task_list', 'factory_task_get', 'factory_task_events', 'factory_task_stats',
    'factory_director_brief',
  ],
  // A custom profile starts powerless; the operator must add explicit tools.
  custom: [],
}

export function defaultAllowedTools(role: AgentRole): readonly string[] {
  return ALLOWLISTS[role]
}
