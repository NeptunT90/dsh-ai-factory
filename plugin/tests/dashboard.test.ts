import { afterEach, describe, expect, it } from 'vitest'
import { DashboardServer } from '../src/dashboard/server.js'
import { createTestRuntime, track } from './helpers.js'

const servers: DashboardServer[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.stop().catch(() => undefined)
  }
})

describe('DashboardServer', () => {
  it('requires the token and serves read-only state', async () => {
    const { runtime } = track(createTestRuntime())
    runtime.tasks.create({ projectId: runtime.projects.ensure('C:/workspace', 'Test').id, title: 'Dashboard task' })
    const server = new DashboardServer(
      runtime,
      () => [{ name: 'factory_status', description: 'status' }],
      {
        getToolHealth: () => [{
          toolName: 'factory_status',
          risk: 'R0',
          status: 'HEALTHY',
          source: 'auto',
          lastCheckedAt: 1,
          latencyMs: 1,
          errorKind: null,
          errorMessage: null,
          dependenciesChecked: false,
          actions: [],
        }],
      },
    )
    servers.push(server)
    const started = await server.start()
    const base = `http://127.0.0.1:${started.port}`

    const unauthorized = await fetch(`${base}/api/state`)
    expect(unauthorized.status).toBe(401)

    const authorized = await fetch(`${base}/api/state`, {
      headers: { Authorization: `Bearer ${started.token}` },
    })
    expect(authorized.status).toBe(200)
    const state = (await authorized.json()) as {
      overview: { version: string; agents: number; tasks: { total: number } }
      agents: unknown[]
      tasks: unknown[]
      tools: unknown[]
      models: { enabled: boolean; maxAttempts: number; fallbacks: string[] }
      sync: { configured: boolean; auto: boolean; pending: number; failed: number }
    }
    expect(state.overview.version).toBe('0.30.2')
    expect(state.overview.agents).toBe(9)
    expect(state.overview.tasks.total).toBeGreaterThanOrEqual(1)
    expect(state.agents).toHaveLength(9)
    expect(state.tasks.length).toBeGreaterThanOrEqual(1)
    expect(state.tools).toHaveLength(1)
    expect((state.tools[0] as { healthStatus?: string }).healthStatus).toBe('HEALTHY')
    expect(state.models.enabled).toBe(true)
    expect(state.models.maxAttempts).toBe(2)
    expect(state.sync.configured).toBe(false)
    expect(state.sync.pending).toBe(0)

    const redirect = await fetch(`${base}/?token=${started.token}`, { redirect: 'manual' })
    expect(redirect.status).toBe(302)
    const cookie = redirect.headers.get('set-cookie')
    expect(cookie).toContain('HttpOnly')
    const page = await fetch(`${base}/`, { headers: { Cookie: cookie ?? '' } })
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('AI FACTORY')
    expect(html).toContain('/api/state')
    expect(html).toContain('data-tab="models"')
    expect(html).toContain('data-tab="sync"')
    expect(html).toContain('Статус')

    const post = await fetch(`${base}/api/state`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${started.token}` },
    })
    expect(post.status).toBe(405)
  })

  it('rejects a non-loopback request without the token and stops cleanly', async () => {
    const { runtime } = track(createTestRuntime())
    const server = new DashboardServer(runtime, () => [])
    servers.push(server)
    const started = await server.start()
    expect(started.port).toBeGreaterThan(0)
    expect(server.url).toContain('127.0.0.1')
    expect(server.url).toContain('token=')
    const noToken = await fetch(`http://127.0.0.1:${started.port}/api/overview`)
    expect(noToken.status).toBe(401)
    await server.stop()
    await expect(fetch(`http://127.0.0.1:${started.port}/health`)).rejects.toThrow()
  })
})
