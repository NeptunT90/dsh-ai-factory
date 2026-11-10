import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ModelRouter, parseModelRoute } from '../src/models/router.js'
import { createTestRuntime, testConfig } from './helpers.js'

function parent(): Agent {
  return {
    id: 'ses_parent',
    options: { provider: 'parent-provider', model: 'parent-model' },
    session: { header: { cwd: 'C:/workspace' } },
  } as unknown as Agent
}

describe('ModelRouter', () => {
  it('prefers profile route, then parent, then configured fallbacks', () => {
    const runtime = createTestRuntime({
      modelFallbacks: 'fb/one, fb/two',
      modelMaxAttempts: 3,
    })
    try {
      const developer = runtime.runtime.agents.findByRole('developer')!
      const plan = new ModelRouter({
        ...testConfig(runtime.dir),
        modelFallbacks: 'fb/one, fb/two',
        modelMaxAttempts: 3,
      }).plan(developer, parent())
      expect(plan.primary?.source).toBe('parent')
      expect(plan.primary?.provider).toBe('parent-provider')
      expect(plan.fallbacks.map((route) => `${route.provider}/${route.model}`)).toEqual(['fb/one', 'fb/two'])
      expect(plan.attempts).toHaveLength(3)
    } finally {
      runtime.cleanup()
    }
  })

  it('uses a profile model before the parent route', () => {
    const runtime = createTestRuntime()
    try {
      const profile = {
        ...runtime.runtime.agents.findByRole('developer')!,
        modelProvider: 'profile-provider',
        model: 'profile-model',
      }
      const router = new ModelRouter({ ...testConfig(runtime.dir), modelFallbacks: 'fb/one' })
      const plan = router.plan(profile, parent())
      expect(plan.primary?.provider).toBe('profile-provider')
      expect(plan.primary?.source).toBe('profile')
      expect(plan.fallbacks).toHaveLength(1)
    } finally {
      runtime.cleanup()
    }
  })

  it('parses only provider/model routes', () => {
    expect(parseModelRoute('deepseek-official/deepseek-chat')).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-chat',
    })
    expect(parseModelRoute('bad')).toBeNull()
    expect(parseModelRoute('/model')).toBeNull()
    expect(parseModelRoute('provider/')).toBeNull()
  })
})
