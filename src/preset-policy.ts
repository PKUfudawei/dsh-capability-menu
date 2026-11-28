import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CapabilityClass } from './policy.ts'

export interface PolicyOverrides {
  tools: Record<string, CapabilityClass>
  skills: Record<string, CapabilityClass>
  servers: Record<string, CapabilityClass>
}
export type PolicyContext = Agent | string | undefined
export const emptyOverrides = (): PolicyOverrides => ({ tools: {}, skills: {}, servers: {} })
export function presetOf(ctx: Context, context: PolicyContext): string | undefined {
  if (typeof context === 'string') return context || undefined
  if (!context) return
  const presets = ctx.get('agentPresets') as { presetForSession?: (session: Agent['session']) => string | null } | undefined
  return presets?.presetForSession?.(context.session) ?? (context.session?.header as { agentPreset?: string } | undefined)?.agentPreset
}
export function validateOverrides(value: unknown): PolicyOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid policy overrides')
  const result = emptyOverrides()
  for (const key of ['tools', 'skills', 'servers'] as const) {
    const map = (value as Record<string, unknown>)[key] ?? {}
    if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error(`Invalid ${key} overrides`)
    for (const [id, tier] of Object.entries(map)) {
      if (!id.trim() || !['resident', 'on-demand', 'disabled'].includes(tier as string)) throw new Error('Invalid capability tier')
      Object.defineProperty(result[key], id, { value: tier, enumerable: true, writable: true, configurable: true })
    }
  }
  return result
}
