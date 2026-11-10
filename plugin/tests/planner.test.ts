import { describe, expect, it } from 'vitest'
import { createTestRuntime, track } from './helpers.js'

describe('PlannerService', () => {
  it('persists a DAG, assigns roles and promotes steps when dependencies finish', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const plan = runtime.planner.createPlan({
      projectId,
      goal: 'Выпустить проверенную функцию',
      steps: [
        { key: 'research', title: 'Исследовать', role: 'researcher' },
        { key: 'build', title: 'Реализовать', role: 'developer', dependsOn: ['research'] },
        { key: 'review', title: 'Проверить', role: 'reviewer', dependsOn: ['build'] },
      ],
    })
    expect(plan.parent.status).toBe('PLANNING')
    expect(plan.steps).toHaveLength(3)
    expect(plan.steps[0]?.status).toBe('READY')
    expect(plan.steps[1]?.status).toBe('WAITING')
    expect(plan.steps[0]?.assignedAgentId).toBeTruthy()

    const research = runtime.tasks.require(plan.steps[0]!.taskId)
    const build = runtime.tasks.require(plan.steps[1]!.taskId)
    const review = runtime.tasks.require(plan.steps[2]!.taskId)
    expect(build.dependencies).toContain(research.id)
    expect(review.dependencies).toContain(build.id)

    runtime.tasks.claim(research.id, { owner: 'worker' })
    runtime.tasks.complete(research.id, 'worker')
    expect(runtime.tasks.require(build.id).status).toBe('READY')
    runtime.tasks.claim(build.id, { owner: 'worker' })
    runtime.tasks.complete(build.id, 'worker')
    expect(runtime.tasks.require(review.id).status).toBe('READY')
  })

  it('rejects cycles and unknown dependencies', () => {
    const { runtime, projectId } = track(createTestRuntime())
    expect(() =>
      runtime.planner.createPlan({
        projectId,
        goal: 'cycle',
        steps: [
          { key: 'a', title: 'A', dependsOn: ['b'] },
          { key: 'b', title: 'B', dependsOn: ['a'] },
        ],
      }),
    ).toThrowError(/Цикл/)
    expect(() =>
      runtime.planner.createPlan({
        projectId,
        goal: 'missing',
        steps: [{ key: 'a', title: 'A', dependsOn: ['nope'] }],
      }),
    ).toThrowError(/неизвестную зависимость/)
  })
})
