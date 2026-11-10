import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import type { ResolvedConfig } from '../config.js'
import type { AgentProfile } from '../agents/types.js'

export interface ModelRoute {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: string
  readonly source: 'profile' | 'parent' | 'fallback'
  readonly options: AgentOptions
}

export interface RoutePlan {
  readonly enabled: boolean
  readonly primary: ModelRoute | null
  readonly fallbacks: readonly ModelRoute[]
  readonly attempts: readonly ModelRoute[]
  readonly maxAttempts: number
}

export function parseModelRoute(raw: string): { provider: string; model: string } | null {
  const value = raw.trim()
  const slash = value.indexOf('/')
  if (slash <= 0 || slash === value.length - 1) return null
  const provider = value.slice(0, slash).trim()
  const model = value.slice(slash + 1).trim()
  if (provider === '' || model === '') return null
  return { provider, model }
}

function routeOptions(provider: string, model: string, reasoningEffort = ''): AgentOptions {
  return {
    provider,
    model,
    ...(reasoningEffort ? { reasoningEffort: reasoningEffort as AgentOptions['reasoningEffort'] } : {}),
  }
}

function routeFromProfile(profile: AgentProfile): ModelRoute | null {
  if (!profile.modelProvider || !profile.model) return null
  return {
    provider: profile.modelProvider,
    model: profile.model,
    reasoningEffort: profile.reasoningEffort ?? '',
    source: 'profile',
    options: routeOptions(profile.modelProvider, profile.model, profile.reasoningEffort ?? ''),
  }
}

function routeFromParent(parent: Agent | undefined): ModelRoute | null {
  const provider = parent?.options?.provider
  const model = parent?.options?.model
  if (!provider || !model) return null
  const effort = parent?.options?.reasoningEffort ?? ''
  return {
    provider,
    model,
    reasoningEffort: effort,
    source: 'parent',
    options: routeOptions(provider, model, effort),
  }
}

/**
 * Resolve the model route chain for a child profile.
 *
 * Priority: explicit profile route → parent route → configured fallbacks.
 * The chain is capped by modelMaxAttempts and deduplicated by provider/model.
 */
export class ModelRouter {
  constructor(private readonly config: ResolvedConfig) {}

  plan(profile: AgentProfile, parent?: Agent): RoutePlan {
    const primary = routeFromProfile(profile) ?? routeFromParent(parent)
    const fallbacks: ModelRoute[] = []
    if (this.config.modelRouterEnabled) {
      for (const raw of this.config.modelFallbacks.split(',')) {
        const parsed = parseModelRoute(raw)
        if (!parsed) continue
        if (primary && primary.provider === parsed.provider && primary.model === parsed.model) continue
        if (fallbacks.some((route) => route.provider === parsed.provider && route.model === parsed.model)) continue
        fallbacks.push({
          provider: parsed.provider,
          model: parsed.model,
          reasoningEffort: '',
          source: 'fallback',
          options: routeOptions(parsed.provider, parsed.model),
        })
        if (fallbacks.length >= 2) break
      }
    }
    const attempts = [...(primary ? [primary] : []), ...fallbacks].slice(
      0,
      Math.max(1, Math.min(3, this.config.modelMaxAttempts)),
    )
    return {
      enabled: this.config.modelRouterEnabled,
      primary,
      fallbacks,
      attempts,
      maxAttempts: Math.max(1, Math.min(3, this.config.modelMaxAttempts)),
    }
  }
}
