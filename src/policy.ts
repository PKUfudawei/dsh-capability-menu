/**
 * Exposed / Progressive / Blocked capability projection policy for the DeepSeek
 * Harness.
 *
 * @module @daweifu/capability-menu (policy plugin)
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { serverNameOf, type CapabilityKind } from './registry.ts'

/**
 * Canonical policy classes, mirroring the registry's `CapabilityKind`.
 *
 * - `exposed`: the capability is on the dsh-native exposure surface — tools in
 *   `assembly.tools` (the request `tools` payload), skills in the
 *   `<available_skills>` catalog — so the model can call/load it single-hop.
 * - `progressive`: absent from the native surface but discoverable in the
 *   persistent meta registry; the model reaches it via `meta_search` then
 *   `meta_invoke` (catalog-resident, load/execute on demand).
 * - `blocked`: neither exposed nor discoverable nor executable.
 */
export type CapabilityClass = 'exposed' | 'progressive' | 'blocked'

/**
 * A single classify rule: an exact name or a `*`-glob pattern.
 * A pattern matches a capability id (`mcp__<server>__<raw>` / `skill:<name>`)
 * or a server name (`server:<name>`).
 */
export interface PolicyRule {
  /** Whether the rule is a literal exact name (`*` free) or a glob pattern. */
  readonly wildcard: boolean
  /** The normalized pattern/literal this rule represents. */
  readonly pattern: string
  /** When non-empty, this rule only applies to the given capability kind. */
  readonly kind?: CapabilityKind
  /** When `'server'`, the pattern is matched against the server name only. */
  readonly target: 'id' | 'server'
}

/**
 * Per-kind explicit configuration. `exposed`/`progressive`/`blocked` are
 * ordered lists of exact-name / glob rules. Empty lists mean "nothing
 * explicitly classified", so the default (`exposed`) applies.
 */
export interface CapabilitySetConfig {
  /** Explicitly-Exposed rule list (exact name or glob). */
  exposed?: string[]
  /** Explicitly-Progressive rule list (exact name or glob). */
  progressive?: string[]
  /** Explicitly-Blocked rule list (exact name or glob); wins over everything. */
  blocked?: string[]
}

/** Exposed / Progressive / Blocked projection policy configuration. */
export interface Config {
  /** Tool classification: `tools.exposed` / `tools.progressive` / `tools.blocked`. */
  tools?: CapabilitySetConfig
  /** Skill classification: `skills.exposed` / `skills.progressive` / `skills.blocked`. */
  skills?: CapabilitySetConfig
  /**
   * Tool names that are ALWAYS kept exposed and can never be classified
   * Progressive or Blocked. Default `[meta_search, meta_invoke]`.
   */
  metaTools?: string[]
  /**
   * Optional path to a Progressive-skill catalog YAML (name + description +
   * path). Consumed by the registry as an additional skill index source (see
   * `@daweifu/capability-menu-registry` `progressiveSkillCatalog`).
   */
  progressiveSkillCatalog?: string
}

/** Validate and default the policy configuration. */
export const Config: z<Config> = z.object({
  tools: z.object({
    exposed: z.array(z.string()).default([]),
    progressive: z.array(z.string()).default([]),
    blocked: z.array(z.string()).default([]),
  }),
  skills: z.object({
    exposed: z.array(z.string()).default([]),
    progressive: z.array(z.string()).default([]),
    blocked: z.array(z.string()).default([]),
  }),
  metaTools: z.array(z.string()).default(['meta_search', 'meta_invoke']),
  // schemastery object properties are optional-by-default; no `.optional()` needed.
  progressiveSkillCatalog: z.string(),
})

export const DEFAULT_META_TOOLS = ['meta_search', 'meta_invoke'] as const

/**
 * Convert a user-facing rule string into a normalized {@link PolicyRule}.
 * - `server:<name>` → server-targeted rule (`target: 'server'`).
 * - `server:<name>:*` → server-targeted glob over that server's tools.
 * - contains `*` → glob (target `id`).
 * - otherwise → literal exact name.
 */
export function parseRule(rule: string): PolicyRule {
  const trimmed = rule.trim()
  const serverPrefix = 'server:'
  if (trimmed.startsWith(serverPrefix)) {
    const rest = trimmed.slice(serverPrefix.length)
    // `server:<name>:*` → glob over the whole server.
    if (rest.endsWith(':*')) {
      return { wildcard: true, pattern: rest.slice(0, -2), target: 'server', kind: 'tool' }
    }
    return { wildcard: false, pattern: rest, target: 'server', kind: 'tool' }
  }
  return {
    wildcard: trimmed.includes('*'),
    pattern: trimmed,
    target: 'id',
  }
}

/** Compile a `*`-glob into a RegExp (escaped, `*` → `.*`). */
export function compileGlob(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

/** A compiled rule set for one capability kind. */
export interface CompiledCapabilityRules {
  readonly exposed: readonly PolicyRule[]
  readonly progressive: readonly PolicyRule[]
  readonly blocked: readonly PolicyRule[]
}

/** Compile a {@link CapabilitySetConfig} into fast-matchable rules. */
export function compileSet(set: CapabilitySetConfig = {}): CompiledCapabilityRules {
  return {
    exposed: (set.exposed ?? []).map(parseRule),
    progressive: (set.progressive ?? []).map(parseRule),
    blocked: (set.blocked ?? []).map(parseRule),
  }
}

/** Candidate fields a rule is matched against. */
export interface MatchTarget {
  /** Full capability id: `mcp__<server>__<raw>` or `skill:<name>`. */
  readonly id: string
  /** Bare model-facing name (tool name or skill name without `skill:` prefix). */
  readonly name: string
  /** Server name for tools; undefined for skills. */
  readonly server?: string
  /** Capability kind. */
  readonly kind: CapabilityKind
  /** Rule kind the candidates belong to (mirrors `kind` for tool/skill rule sets). */
  readonly ruleKind: CapabilityKind
}

function ruleMatches(rule: PolicyRule, target: MatchTarget): boolean {
  if (rule.kind !== undefined && rule.kind !== target.ruleKind) return false
  if (rule.target === 'id') {
    if (!rule.wildcard) {
      // An exact rule matches the full id OR the bare name (e.g. `debugging`
      // matches `skill:debugging`, `bash` matches the harness-native tool
      // `bash` whose public name is its bare name).
      return rule.pattern === target.id || rule.pattern === target.name
    }
    return compileGlob(rule.pattern).test(target.id)
  }
  // server-targeted
  if (target.server === undefined) return false
  if (!rule.wildcard) return rule.pattern === target.server
  return compileGlob(rule.pattern).test(target.server)
}

/**
 * Classify a capability against compiled rules. Priority (hit stops the walk):
 * blocked-exact > blocked-wildcard > exposed-exact > exposed-wildcard >
 * progressive-exact > progressive-wildcard > default (exposed). `blocked`
 * is a control decision, so it beats an explicit `exposed` rule.
 */
export function classify(
  compiled: CompiledCapabilityRules,
  target: MatchTarget,
  metaTools: ReadonlySet<string> | readonly string[] = DEFAULT_META_TOOLS,
): CapabilityClass {
  const meta = metaTools instanceof Set ? metaTools : new Set<string>(metaTools)
  const id = target.id
  // metaTools can never be Progressive/Blocked for tools.
  if (target.kind === 'tool' && meta.has(id)) return 'exposed'
  for (const rule of compiled.blocked) {
    if (!rule.wildcard && ruleMatches(rule, target)) return 'blocked'
  }
  for (const rule of compiled.blocked) {
    if (rule.wildcard && ruleMatches(rule, target)) return 'blocked'
  }
  for (const rule of compiled.exposed) {
    if (!rule.wildcard && ruleMatches(rule, target)) return 'exposed'
  }
  for (const rule of compiled.exposed) {
    if (rule.wildcard && ruleMatches(rule, target)) return 'exposed'
  }
  for (const rule of compiled.progressive) {
    if (!rule.wildcard && ruleMatches(rule, target)) return 'progressive'
  }
  for (const rule of compiled.progressive) {
    if (rule.wildcard && ruleMatches(rule, target)) return 'progressive'
  }
  return 'exposed'
}

/** True when any rule in the list matches the target (used for fail-loud validation). */
function anyRuleMatches(rules: readonly PolicyRule[], target: MatchTarget): boolean {
  return rules.some(rule => ruleMatches(rule, target))
}

/**
 * One capability's classification, as surfaced to a management UI.
 * `class` is the machine-facing value; `classLabel` is a human-friendly
 * display that ties the residency strategy to the model-facing relationship.
 */
export interface CapabilityClassification {
  readonly id: string
  readonly kind: CapabilityKind
  /** Model-facing name (tool name or skill bare name). */
  readonly name: string
  /** MCP server for tools; undefined for skills. */
  readonly server?: string
  readonly class: CapabilityClass
  /** Human-friendly display label for the classification. */
  readonly classLabel: string
  /** True when this capability is a mandatory meta tool (always Exposed). */
  readonly mandatory: boolean
}

const CLASS_LABELS: Record<CapabilityClass, string> = {
  exposed: 'Exposed · 常驻（直接调用）',
  progressive: 'Progressive · 按需（目录渐进加载）',
  blocked: 'Blocked · 禁用',
}

/**
 * The `ctx.capabilityPolicy` service surface.
 */
export interface CapabilityPolicyService {
  /** Classify a tool by its public name (`mcp__<server>__<raw>` or meta tool). */
  classifyTool(name: string): CapabilityClass
  /** Classify a skill by its bare name. */
  classifySkill(name: string): CapabilityClass
  /** True when a tool is Exposed (or a mandatory meta tool). */
  isExposedTool(name: string): boolean
  /** True when a skill is Exposed. */
  isExposedSkill(name: string): boolean
  /** True when a tool is Progressive. */
  isProgressiveTool(name: string): boolean
  /** True when a skill is Progressive. */
  isProgressiveSkill(name: string): boolean
  /** True when a tool is Blocked. */
  isBlockedTool(name: string): boolean
  /** True when a skill is Blocked. */
  isBlockedSkill(name: string): boolean
  /** True when a capability id (`mcp__...` / `skill:...`) is Blocked. */
  isBlockedCapability(id: string): boolean
  /** Tool names that are always kept Exposed. */
  metaTools(): readonly string[]
  /** Resolve a capability's id (e.g. `skill:<name>`) to a class. */
  classifyCapability(id: string): CapabilityClass
  /** Rules exposed for the registry/other consumers. */
  toolRules(): CompiledCapabilityRules
  skillRules(): CompiledCapabilityRules

  // — management surface (能力菜单) —
  /** Current (resolved) policy config. */
  getConfig(): Config
  /** Replace a subset of the policy config and recompile rules immediately. */
  updateConfig(partial: Partial<Config>): void
  /**
   * Classify every capability currently indexed by `ctx.meta` (the registry
   * sibling). Returns an empty array when the registry is not mounted.
   */
  classifyAll(): readonly CapabilityClassification[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    capabilityPolicy: CapabilityPolicyService
  }
}

/**
 * Build the projection listener for one assembly: keep only Exposed tools plus
 * the mandatory meta tools.
 */
export function projectAssemblyTools(
  assembly: PromptAssembly,
  service: CapabilityPolicyService,
): PromptAssembly {
  const kept = assembly.tools.filter(tool => service.isExposedTool(tool.name))
  if (kept.length === assembly.tools.length) return assembly
  return { ...assembly, tools: kept }
}

/** Build the policy plugin. */
export const name = 'capability-menu-policy'
// The policy needs `meta` (the registry sibling) for classifyAll(); `tools` /
// `skills` are injected purely for startup ordering — projection itself runs on
// the `system-prompt/assemble` chain, not through the registries. The bundle
// mounts registry before policy, so `meta` is always available in practice.
export const inject = ['meta', 'tools', 'skills']

export function apply(ctx: Context, config: Config = {}): void {
  // Mutable runtime state so the management surface (能力菜单) can live-update
  // the policy without a reload.
  let current = { ...config }
  let metaTools = [...(config.metaTools ?? DEFAULT_META_TOOLS)]
  let metaToolSet = new Set<string>(metaTools)
  let toolCompiled: CompiledCapabilityRules
  let skillCompiled: CompiledCapabilityRules

  const recompile = (): void => {
    const toolRules = compileSet(current.tools)
    const skillRules = compileSet(current.skills)
    // Normalize tool/skill rule kinds for matching.
    toolCompiled = {
      exposed: toolRules.exposed.map(rule => ({ ...rule, kind: 'tool' as const })),
      progressive: toolRules.progressive.map(rule => ({ ...rule, kind: 'tool' as const })),
      blocked: toolRules.blocked.map(rule => ({ ...rule, kind: 'tool' as const })),
    }
    skillCompiled = {
      exposed: skillRules.exposed.map(rule => ({ ...rule, kind: 'skill' as const })),
      progressive: skillRules.progressive.map(rule => ({ ...rule, kind: 'skill' as const })),
      blocked: skillRules.blocked.map(rule => ({ ...rule, kind: 'skill' as const })),
    }
    // Meta tools are the control-plane escape hatch: blocking one is a
    // misconfiguration that must fail loud, never silently disable the surface.
    for (const name of metaTools) {
      const target = { id: name, name, server: serverNameOf(name), kind: 'tool' as const, ruleKind: 'tool' as const }
      if (anyRuleMatches(toolCompiled.blocked, target)) {
        throw new Error(`meta tool "${name}" cannot be blocked; remove it from tools.blocked`)
      }
    }
  }
  recompile()

  const service: CapabilityPolicyService = {
    classifyTool(name: string): CapabilityClass {
      const server = serverNameOf(name)
      return classify(toolCompiled, { id: name, name, server, kind: 'tool', ruleKind: 'tool' }, metaToolSet)
    },
    classifySkill(name: string): CapabilityClass {
      return classify(skillCompiled, { id: `skill:${name}`, name, kind: 'skill', ruleKind: 'skill' }, new Set())
    },
    classifyCapability(id: string): CapabilityClass {
      if (id.startsWith('skill:')) return service.classifySkill(id.slice('skill:'.length))
      return service.classifyTool(id)
    },
    isExposedTool(name: string): boolean {
      return service.classifyTool(name) === 'exposed'
    },
    isExposedSkill(name: string): boolean {
      return service.classifySkill(name) === 'exposed'
    },
    isProgressiveTool(name: string): boolean {
      return service.classifyTool(name) === 'progressive'
    },
    isProgressiveSkill(name: string): boolean {
      return service.classifySkill(name) === 'progressive'
    },
    isBlockedTool(name: string): boolean {
      return service.classifyTool(name) === 'blocked'
    },
    isBlockedSkill(name: string): boolean {
      return service.classifySkill(name) === 'blocked'
    },
    isBlockedCapability(id: string): boolean {
      return service.classifyCapability(id) === 'blocked'
    },
    metaTools(): readonly string[] {
      return metaTools
    },
    toolRules(): CompiledCapabilityRules {
      return toolCompiled
    },
    skillRules(): CompiledCapabilityRules {
      return skillCompiled
    },
    getConfig(): Config {
      return { ...current }
    },
    updateConfig(partial: Partial<Config>): void {
      current = { ...current, ...partial }
      if (partial.metaTools !== undefined) {
        metaTools = [...(partial.metaTools ?? DEFAULT_META_TOOLS)]
        metaToolSet = new Set<string>(metaTools)
      }
      recompile()
    },
    classifyAll(): readonly CapabilityClassification[] {
      // The registry default maxResults (20) would truncate the management
      // surface: enumerate every indexed capability, not just the top-20.
      return ctx.meta.search({ maxResults: Number.MAX_SAFE_INTEGER }).map(summary => {
        const cls = service.classifyCapability(summary.id)
        const mandatory = summary.kind === 'tool' && metaToolSet.has(summary.id)
        return {
          id: summary.id,
          kind: summary.kind,
          name: summary.name,
          ...summary.server !== undefined ? { server: summary.server } : {},
          class: cls,
          classLabel: CLASS_LABELS[cls],
          mandatory,
        }
      })
    },
  }

  // Project the model-visible tool list. This runs on the projection chain only
  // (system-prompt/assemble); the execution chain (ctx.tools.execute) is
  // untouched, so Progressive tools remain executable via meta_invoke. Skills
  // keep the dsh-native `<available_skills>` catalog, which is the Exposed
  // surface; catalog-level skill filtering needs an upstream `dsh-tool-skill`
  // filter hook (out of bundle scope).
  ctx.on('system-prompt/assemble', async (_assembly: PromptAssembly, _context, next) => {
    const resolved = await next()
    return projectAssemblyTools(resolved, service)
  })

  ctx.provide('capabilityPolicy', service)
}
