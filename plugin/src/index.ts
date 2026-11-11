import type { Context } from '@deepseek-ai/cordis'
import { FactoryError, errorMessage } from './core/errors.js'
import { Config, resolveConfig, type FactoryConfig } from './config.js'
import { registerMemoryTools } from './memory/tools.js'
import { FactoryRuntime, FACTORY_VERSION, type PluginLogger } from './runtime.js'
import { registerStatusTool } from './tools/status.js'
import { registerAgentTools } from './agents/tools.js'
import { registerTaskTools } from './tasks/tools.js'
import { registerOrchestrationTools } from './orchestration/tools.js'
import { registerDispatchTool } from './dispatch/tools.js'
import { DashboardManager, registerDashboardTool } from './dashboard/tools.js'
import { registerSyncTool } from './sync/tools.js'
import { registerReviewerTool } from './reviewer/tools.js'
import { registerWorkflowTool } from './workflow/tools.js'
import { registerModelTool } from './models/tools.js'
import { AutoWorkflowService } from './workflow/auto.js'
import { registerAutoWorkflowTool } from './workflow/auto-tools.js'
import { ToolHealthService } from './health/service.js'
import { registerHealthTools } from './health/tools.js'
import { registerSkillTools } from './skills/tools.js'
import { registerCapabilityTools } from './capabilities/tools.js'
import { registerBackupTools } from './backups/tools.js'
import { ConciergeService } from './concierge/service.js'

export const name = 'dsh-ai-factory'
export const inject = ['tools']
export const VERSION = FACTORY_VERSION
export { Config }
export type { FactoryConfig }

/**
 * DSH AI Factory host plugin.
 *
 * Initialization is synchronous because node:sqlite is synchronous. A startup
 * failure never crashes the host: `factory_status` stays available and every
 * other tool reports the exact reason.
 */
export function apply(ctx: Context, config: FactoryConfig): void {
  const logger = ctx.logger('dsh-ai-factory') as unknown as PluginLogger
  if (!config.enabled) {
    logger.info('[ai-factory] disabled by configuration; no tools registered')
    return
  }

  // Resolve paths once for a useful startup diagnostic; FactoryRuntime.create
  // repeats the validation for the real instance.
  try {
    resolveConfig(config)
  } catch (error) {
    logger.error(`[ai-factory] invalid configuration: ${errorMessage(error)}`)
    return
  }

  let runtime: FactoryRuntime | undefined
  let concierge: ConciergeService | undefined
  let startupError: string | undefined
  const disposers: Array<() => void> = []
  const dashboard = new DashboardManager(
    () => runtime,
    () => ctx.tools.definitions().map(({ name, description }) => ({ name, description })),
    logger,
    () => runtime?.health?.summaries() ?? [],
  )

  try {
    runtime = FactoryRuntime.create(config, logger)
    concierge = new ConciergeService(ctx, runtime)
    concierge.start()
    const crashRecovery = runtime.recoverCrashReport()
    if (crashRecovery.taskId) {
      logger.warn(`[ai-factory] crash recovery task created: ${crashRecovery.taskId}`)
    } else if (crashRecovery.reason !== 'no_report' && crashRecovery.reason !== 'already_handled') {
      logger.warn(`[ai-factory] crash recovery: ${crashRecovery.reason}`)
    }
    runtime.autoWorkflow = new AutoWorkflowService(ctx, runtime)
    runtime.health = new ToolHealthService(ctx, runtime)
    if (config.autoWorkflowEnabled) void runtime.autoWorkflow.start()
    logger.info(
      `[ai-factory] v${FACTORY_VERSION} ready; driver=${runtime.db.driver}; db=${runtime.db.path}`,
    )
  } catch (error) {
    startupError = error instanceof FactoryError ? `${error.code}: ${error.message}` : errorMessage(error)
    logger.error(`[ai-factory] startup failed: ${startupError}`)
  }

  try {
    disposers.push(
      ctx.tools.guard((execution) => {
        if (!runtime || !execution.agent) return undefined
        return runtime.toolDenial(execution.agent.id, execution.name)
      }),
    )
    disposers.push(registerStatusTool(ctx, () => runtime, () => startupError))
    if (runtime) {
      disposers.push(...registerMemoryTools(ctx, () => runtime, () => startupError))
      disposers.push(...registerAgentTools(ctx, () => runtime, () => startupError))
      disposers.push(...registerSkillTools(ctx, () => runtime, () => startupError))
      disposers.push(...registerCapabilityTools(ctx, () => runtime, () => startupError))
      disposers.push(...registerBackupTools(ctx, () => runtime, () => startupError))
      disposers.push(...registerTaskTools(ctx, () => runtime, () => startupError))
      disposers.push(...registerOrchestrationTools(ctx, () => runtime, () => startupError))
      disposers.push(registerDispatchTool(ctx, () => runtime, () => startupError))
      disposers.push(registerDashboardTool(ctx, dashboard))
      disposers.push(registerSyncTool(ctx, () => runtime, () => startupError))
      disposers.push(registerReviewerTool(ctx, () => runtime, () => startupError))
      disposers.push(registerWorkflowTool(ctx, () => runtime, () => startupError))
      disposers.push(registerModelTool(ctx, () => runtime, () => startupError))
      disposers.push(registerAutoWorkflowTool(ctx, () => runtime, () => startupError))
      disposers.push(...registerHealthTools(ctx, () => runtime, () => startupError))
      runtime.audit.record({
        event: 'factory.tools_registered',
        level: 'info',
        data: {
          count: disposers.length - 1, // exclude the tool guard
          groups: ['status', 'memory', 'agents', 'tasks', 'orchestration', 'dispatch', 'dashboard', 'sync', 'review', 'workflow', 'models', 'auto', 'skills', 'capabilities', 'backups', 'health'],
        },
      })
      logger.info(`[ai-factory] registered ${disposers.length} tools`)
      if (config.dashboardAutoStart) {
        void dashboard
          .start()
          .then((status) => {
            const message = `Панель управления доступна здесь: ${status.url}`
            logger.info(`[ai-factory] ${message}`)
            try {
              const emitter = (ctx as unknown as { emit?: (event: string, data: unknown) => void }).emit
              emitter?.('factory/dashboard/started', { url: status.url, port: status.port })
            } catch {
              // A host without a client event bus still gets the startup log link.
            }
            runtime?.audit.record({ event: 'dashboard.autostarted', level: 'info', data: { port: status.port, bind: '127.0.0.1' } })
          })
          .catch((error: unknown) => logger.warn(`[ai-factory] dashboard autostart failed: ${errorMessage(error)}`))
      }
    }
  } catch (error) {
    startupError = startupError ?? errorMessage(error)
    logger.error(`[ai-factory] tool registration failed: ${startupError}`)
  }

  ctx.effect(
    () => async () => {
      for (const dispose of disposers.splice(0).reverse()) {
        try {
          dispose()
        } catch (error) {
          logger.warn(`[ai-factory] tool disposer failed: ${errorMessage(error)}`)
        }
      }
      await dashboard.close()
      concierge?.dispose()
      runtime?.close()
      runtime = undefined
    },
    'dsh-ai-factory:lifecycle',
  )
}
