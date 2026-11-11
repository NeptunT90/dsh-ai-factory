import type { FactoryDatabase } from '../storage/database.js'

export interface ToolErrorMetric {
  readonly tool: string
  readonly errorCode: string
  readonly count: number
}

export interface MetricsResult {
  readonly tasksTotal: number
  readonly completed: number
  readonly failed: number
  readonly successRate: number
  readonly avgAttempts: number
  readonly retryRate: number
  readonly toolErrorTop: readonly ToolErrorMetric[]
}

export class MetricsService {
  constructor(private readonly db: FactoryDatabase) {}

  project(projectId: string): MetricsResult {
    const row = this.db.get<{ total: number; completed: number; failed: number; attempts: number | null }>(
      `SELECT count(*) AS total,
              sum(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
              sum(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
              avg(attempts) AS attempts
       FROM tasks WHERE project_id = ?`,
      [projectId],
    )
    const total = Number(row?.total ?? 0)
    const completed = Number(row?.completed ?? 0)
    const failed = Number(row?.failed ?? 0)
    const finished = completed + failed
    const avgAttempts = Number(row?.attempts ?? 0)
    const retries = this.db.get<{ n: number }>(
      'SELECT count(*) AS n FROM tasks WHERE project_id = ? AND attempts > 1',
      [projectId],
    )
    const errors = this.db.all<{ tool_name: string; error_code: string | null; n: number }>(
      `SELECT tool_name, error_code, count(*) AS n
       FROM task_steps WHERE project_id = ? AND ok = 0
       GROUP BY tool_name, error_code ORDER BY n DESC LIMIT 5`,
      [projectId],
    )
    return {
      tasksTotal: total,
      completed,
      failed,
      successRate: finished === 0 ? 0 : completed / finished,
      avgAttempts,
      retryRate: total === 0 ? 0 : Number(retries?.n ?? 0) / total,
      toolErrorTop: errors.map((error) => ({
        tool: error.tool_name,
        errorCode: error.error_code ?? 'TOOL_ERROR',
        count: Number(error.n),
      })),
    }
  }
}
