import { isAbsolute, relative, resolve } from 'node:path'

export type SafetyMode = 'SAFE' | 'AUTONOMOUS' | 'TRUSTED'
export type EgressMode = 'none' | 'read' | 'write'

export interface SafetyInput {
  readonly toolName: string
  readonly args: unknown
  readonly autonomy: string
  readonly egress: EgressMode
  readonly accessLevel: string
  readonly projectRoot: string
}

export interface SafetyDenial {
  readonly rule: string
  readonly message: string
}

const SHELL_TOOLS = new Set(['pwsh', 'bash', 'run_code'])
const WRITE_TOOLS = new Set([
  'write',
  'edit',
  'office_write_docx',
  'office_write_xlsx',
  'office_edit_docx',
  'office_edit_xlsx',
  'office_convert',
])
const NETWORK_READ_TOOLS = new Set(['web_search', 'web_fetch', 'factory_sync'])
const NETWORK_WRITE_TOOLS = new Set([
  'ssh_list',
  'ssh_exec',
  'ssh_upload',
  'ssh_download',
  'ssh_tunnel',
  'ssh_cluster',
])
const FACTORY_READ_TOOLS = new Set([
  'factory_status',
  'factory_tools_list',
  'factory_memory_search',
  'factory_memory_get',
  'factory_memory_history',
  'factory_memory_stats',
  'factory_task_list',
  'factory_task_get',
  'factory_task_events',
  'factory_task_stats',
  'factory_director_brief',
  'factory_capability_check',
  'factory_capability_list',
  'factory_capability_get',
  'factory_skill_list',
  'factory_skill_get',
  'factory_skill_validate',
  'factory_knowledge_search',
  'factory_knowledge_list',
  'factory_backup_verify',
  'factory_improve_list',
  'factory_dashboard',
])

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function commandOf(value: unknown): string {
  const args = record(value)
  for (const key of ['command', 'cmd', 'script', 'code', 'input']) {
    const candidate = args[key]
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate
  }
  return ''
}

function pathOf(value: unknown): string | undefined {
  const args = record(value)
  for (const key of ['path', 'file', 'filePath', 'target', 'destination', 'outputPath', 'output']) {
    const candidate = args[key]
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate
  }
  return undefined
}

function isInside(root: string, path: string): boolean {
  const resolved = resolve(root, path)
  const rel = relative(resolve(root), resolved)
  if (rel === '') return true
  if (rel.startsWith('..') || isAbsolute(rel)) return false
  if (process.platform === 'win32') return resolved.toLowerCase().startsWith(`${resolve(root).toLowerCase()}\\`)
  return resolved.startsWith(`${resolve(root)}/`)
}

function isNetworkRead(tool: string): boolean {
  return NETWORK_READ_TOOLS.has(tool) || tool.startsWith('browser_')
}

function isNetworkWrite(tool: string): boolean {
  return NETWORK_WRITE_TOOLS.has(tool)
}

function isFactoryMutation(tool: string): boolean {
  if (FACTORY_READ_TOOLS.has(tool)) return false
  if (tool === 'factory_task_tell' || tool === 'factory_task_cancel') return true
  if (tool === 'factory_memory_remember' || tool === 'factory_memory_update' || tool === 'factory_memory_forget') return true
  if (tool.startsWith('factory_task_')) return true
  if (tool.startsWith('factory_skill_') || tool.startsWith('factory_agent_')) return true
  if (tool === 'factory_capability_scan' || tool === 'factory_capability_refresh') return true
  if (tool === 'factory_knowledge_add' || tool === 'factory_knowledge_delete') return true
  if (tool.startsWith('factory_improve_')) return true
  if (tool === 'factory_plan_create' || tool === 'factory_dispatch' || tool === 'factory_run' || tool === 'factory_review') return true
  if (tool === 'factory_workflow_run' || tool === 'factory_auto_workflow') return true
  if (tool === 'factory_backup_restore_test') return true
  return false
}

function commandDenial(command: string, egress: EgressMode): SafetyDenial | undefined {
  const text = command.replace(/\\\n/g, ' ').replace(/\s+/g, ' ').trim()
  if (text === '') return undefined
  const deny = (rule: string, message: string): SafetyDenial => ({ rule, message })

  if (/\bgit\b[\s\S]*\bpush\b[\s\S]*(?:--force(?:-with-lease)?|(?:^|\s)-f(?:\s|$))/i.test(text)) {
    return deny('force_push_denied', 'git force push запрещён safety policy')
  }
  if (/(?:factory\.db|ai-factory)(?:[\\/]|\s|$)/i.test(text) && /\b(?:rm|del|erase|Remove-Item|unlink)\b/i.test(text)) {
    return deny('database_deletion_denied', 'удаление БД AI Factory запрещено')
  }
  if (/\b(?:rm|del|erase|Remove-Item|unlink)\b[\s\S]*(?:-\s*rf?|--recursive|-Recurse)[\s\S]*(?:\s|^)(?:\/|\\|~|[A-Za-z]:\\)/i.test(text)) {
    return deny('root_deletion_denied', 'рекурсивное удаление корня запрещено')
  }
  if (/\b(?:format|diskpart|shutdown|reboot)\b/i.test(text)) {
    return deny('system_destructive_denied', 'системная destructive-команда запрещена')
  }
  if (/\bssh\b|\bscp\b|\bsftp\b|\bnc\b|\bncat\b|\btelnet\b/i.test(text)) {
    return deny('shell_remote_denied', 'remote shell из shell-инструмента запрещён; используйте явный ssh-инструмент')
  }
  if (/\b(?:curl|wget|Invoke-WebRequest|Invoke-RestMethod)\b[\s\S]*(?:-X\s*(?:POST|PUT|PATCH|DELETE)|--data|-d\b|--upload-file|-F\b|-T\b|-Method\s+(?:Post|Put|Patch|Delete)|-InFile|-Body)/i.test(text)) {
    return deny('upload_egress_denied', 'передача данных наружу запрещена safety policy')
  }
  if (egress === 'none' && /\b(?:curl|wget|Invoke-WebRequest|Invoke-RestMethod|git\s+(?:push|pull|fetch|clone)|ssh|scp|sftp|nc|ncat|telnet)\b/i.test(text)) {
    return deny('egress_none_denied', 'egress запрещён для этого профиля')
  }
  if (egress === 'read' && /\bgit\b[\s\S]*\bpush\b/i.test(text)) {
    return deny('egress_write_required', 'git push требует egress write')
  }
  return undefined
}

/**
 * Best-effort pre-dispatch policy. This is intentionally independent from
 * model approvals: a denial is immediate and audited. Shell is not a sandbox;
 * it remains protected by the DSH sandbox and an OS-level egress boundary.
 */
export function evaluateSafety(input: SafetyInput): SafetyDenial | undefined {
  const mode: SafetyMode = input.autonomy.toLowerCase() === 'safe'
    ? 'SAFE'
    : input.autonomy.toLowerCase() === 'trusted'
      ? 'TRUSTED'
      : 'AUTONOMOUS'
  const tool = input.toolName
  const args = input.args
  const deny = (rule: string, message: string): SafetyDenial => ({ rule, message })

  if (input.accessLevel === 'read' && (SHELL_TOOLS.has(tool) || WRITE_TOOLS.has(tool) || isNetworkRead(tool) || isNetworkWrite(tool) || isFactoryMutation(tool))) {
    return deny('read_only_access', 'профиль с accessLevel=read не может изменять данные')
  }

  if (mode === 'SAFE') {
    if (SHELL_TOOLS.has(tool)) return deny('safe_shell_denied', 'SAFE запрещает shell')
    if (WRITE_TOOLS.has(tool)) return deny('safe_write_denied', 'SAFE запрещает запись')
    if (isNetworkRead(tool) || isNetworkWrite(tool)) return deny('safe_egress_denied', 'SAFE запрещает сеть')
    if (isFactoryMutation(tool)) return deny('safe_factory_mutation_denied', 'SAFE запрещает изменяющие factory tools')
  }

  if (tool === 'factory_sync') {
    const action = record(args).action
    if ((action === 'push' || action === 'pull' || action === 'sync') && input.egress !== 'write') {
      // The root operator is explicitly syncing an already configured private-LAN server.
      if (input.accessLevel !== 'trusted') {
        return deny('egress_write_required', 'factory_sync push/pull требует egress write')
      }
    }
  }

  if (isNetworkRead(tool) && input.egress === 'none') {
    return deny('egress_none_denied', 'egress запрещён для этого профиля')
  }
  if (isNetworkWrite(tool) && input.egress !== 'write') {
    return deny('egress_write_required', 'инструмент требует egress write')
  }
  if (mode === 'AUTONOMOUS' && tool === 'run_code') {
    return deny('autonomous_run_code_denied', 'run_code разрешён только TRUSTED')
  }

  if (WRITE_TOOLS.has(tool)) {
    const path = pathOf(args)
    if (path !== undefined) {
      const target = isInside(input.projectRoot, path) ? resolve(input.projectRoot, path) : null
      if (target === null) return deny('write_outside_project', 'запись за пределы project root запрещена')
      if (target.toLowerCase().endsWith('.db') || target.toLowerCase().includes(`${process.platform === 'win32' ? '\\' : '/'}.dsh${process.platform === 'win32' ? '\\' : '/'}ai-factory`)) {
        return deny('database_write_denied', 'запись в БД AI Factory запрещена')
      }
    }
  }

  if (SHELL_TOOLS.has(tool)) {
    const command = commandOf(args)
    const denied = commandDenial(command, input.egress)
    if (denied) return denied
    if (tool === 'run_code' && mode !== 'TRUSTED') {
      return deny('autonomous_run_code_denied', 'run_code разрешён только TRUSTED')
    }
  }

  if (tool === 'factory_knowledge_add' || tool === 'factory_knowledge_delete') {
    const path = pathOf(args)
    if (path !== undefined && !isInside(input.projectRoot, path)) {
      return deny('knowledge_outside_project', 'knowledge path вне project root')
    }
  }
  return undefined
}

export function safetyRuleMessage(denial: SafetyDenial): string {
  return `SECURITY_VIOLATION: ${denial.rule}: ${denial.message}`
}
