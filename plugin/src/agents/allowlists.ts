import type { AgentRole } from './types.js'

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
    'factory_memory_search', 'factory_memory_get', 'factory_memory_history', 'factory_memory_stats',
    'factory_task_list', 'factory_task_get', 'factory_task_events', 'factory_task_stats',
    'factory_plan_create', 'factory_task_create', 'factory_task_update',
    'factory_director_brief',
  ],
  researcher: [
    'read', 'write', 'edit', 'grep', 'glob', 'working_directory',
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
