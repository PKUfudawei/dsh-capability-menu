/**
 * Resident / On-demand / Disabled capability projection policy for the DeepSeek
 * Harness.
 *
 * @module @daweifu/capability-menu (policy plugin)
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { escapeText } from '@deepseek-ai/dsh-skill'
import { serverNameOf, type CapabilityKind } from './registry.ts'
import { addEntryOverride, findEntry, mutatePatch, setEntryConfig } from './patch-file.ts'
import {
  LocationRegistry,
  defaultLocationConfig,
  type McpInput,
  type McpLocation,
  type McpUpdateInput,
  type SkillLocation,
} from './locations.ts'

/**
 * Canonical policy classes, mirroring the registry's `CapabilityKind`.
 *
 * - `resident`: the capability is on the dsh-native exposure surface — tools in
 *   `assembly.tools` (the request `tools` payload), skills in the
 *   `<available_skills>` catalog — so the model can call/load it single-hop.
 * - `on-demand`: absent from the native surface but discoverable in the
 *   persistent meta registry; the model reaches it via `meta_search` then
 *   `meta_invoke` (catalog-resident, load/execute on demand).
 * - `disabled`: neither resident nor discoverable nor executable.
 */
export type CapabilityClass = 'resident' | 'on-demand' | 'disabled'

/**
 * A single classify rule: an exact name or a `*`-glob pattern.
 * A pattern matches a capability id (`mcp__<server>__<raw>`, a native tool
 * name, or a bare skill name) or a server name (`server:<name>`).
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
 * Per-kind explicit configuration. `resident`/`on-demand`/`disabled` are
 * ordered lists of exact-name / glob rules. Empty lists mean "nothing
 * explicitly classified", so the default (`resident`) applies.
 */
export interface CapabilitySetConfig {
  /** Explicitly-Resident rule list (exact name or glob). */
  resident?: string[]
  /** Explicitly-On-demand rule list (exact name or glob). */
  'on-demand'?: string[]
  /** Explicitly-Disabled rule list (exact name or glob); wins over everything. */
  disabled?: string[]
  /**
   * @deprecated pre-rename alias of `disabled`; accepted and mapped so legacy
   * profiles written with the `blocked` key keep working without an on-disk
   * rewrite.
   */
  blocked?: string[]
  /**
   * @deprecated pre-rename alias of `resident`; accepted and mapped so legacy
   * profiles keep working without an on-disk rewrite.
   */
  exposed?: string[]
  /**
   * @deprecated pre-rename alias of `on-demand`; accepted and mapped so legacy
   * profiles keep working without an on-disk rewrite.
   */
  progressive?: string[]
}

/** Resident / On-demand / Disabled projection policy configuration. */
export interface Config {
  /** Tool classification: `tools.resident` / `tools.on-demand` / `tools.disabled`. */
  tools?: CapabilitySetConfig
  /** Skill classification: `skills.resident` / `skills.on-demand` / `skills.disabled`. */
  skills?: CapabilitySetConfig
  /**
   * Tool names that are ALWAYS kept resident and can never be classified
   * On-demand or Disabled. Default `[meta_search, meta_invoke]`.
   */
  metaTools?: string[]
  /**
   * Patch file holding the MCP server rows the 能力菜单 UI manages. Defaults
   * to the home-level layer (`~/.dsh/cordis.patch.yml`) — the same file as any
   * hand-written `@deepseek-ai/dsh-mcp-client` rows, so both are managed in one
   * place. dsh owns the mounting; this plugin only edits the file.
   */
  patchFile?: string
  /** Skill root that UI skill registration links into. Defaults to `~/.dsh/skills`. */
  skillsDir?: string
  /** Milliseconds to coalesce tier changes before persisting them. */
  persistDebounceMs?: number
}

/** Validate and default the policy configuration. */
export const Config: z<Config> = z.object({
  tools: z.object({
    resident: z.array(z.string()).default([]),
    'on-demand': z.array(z.string()).default([]),
    disabled: z.array(z.string()).default([]),
    // Deprecated pre-rename aliases: kept in the schema so a config cast keeps
    // them available for `normalizeSetConfig` instead of stripping them.
    blocked: z.array(z.string()),
    exposed: z.array(z.string()),
    progressive: z.array(z.string()),
  }),
  skills: z.object({
    resident: z.array(z.string()).default([]),
    'on-demand': z.array(z.string()).default([]),
    disabled: z.array(z.string()).default([]),
    blocked: z.array(z.string()),
    exposed: z.array(z.string()),
    progressive: z.array(z.string()),
  }),
  metaTools: z.array(z.string()).default(['meta_search', 'meta_invoke']),
  // schemastery object properties are optional-by-default; no `.optional()` needed.
  patchFile: z.string(),
  skillsDir: z.string(),
  /**
   * How long a tier change waits before it is written to the patch file. Long
   * enough that a burst of clicks produces one write, because every write makes
   * dsh hot-reload this plugin and re-run the catalog enumeration.
   */
  persistDebounceMs: z.number().default(1500),
})

export const DEFAULT_META_TOOLS = ['meta_search', 'meta_invoke'] as const

/**
 * Map a legacy rule set (old keys `exposed`/`progressive`/`blocked`) onto the
 * current key names (`resident`/`on-demand`/`disabled`), so already-deployed
 * `cordis.patch.yml` profiles keep working without an on-disk rewrite. New
 * keys win when they carry rules; a legacy key fills in when the matching new
 * list is empty.
 */
export function normalizeSetConfig(set: CapabilitySetConfig | undefined): CapabilitySetConfig | undefined {
  if (set === undefined) return undefined
  const next: CapabilitySetConfig = {}
  const resident = set.resident !== undefined && set.resident.length > 0 ? set.resident : undefined
  if (resident !== undefined) next.resident = resident
  else if (set.exposed !== undefined && set.exposed.length > 0) next.resident = set.exposed
  const onDemand = set['on-demand'] !== undefined && set['on-demand'].length > 0 ? set['on-demand'] : undefined
  if (onDemand !== undefined) next['on-demand'] = onDemand
  else if (set.progressive !== undefined && set.progressive.length > 0) next['on-demand'] = set.progressive
  const disabled = set.disabled !== undefined && set.disabled.length > 0 ? set.disabled : undefined
  if (disabled !== undefined) next.disabled = disabled
  else if (set.blocked !== undefined && set.blocked.length > 0) next.disabled = set.blocked
  return next
}

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
  readonly resident: readonly PolicyRule[]
  readonly onDemand: readonly PolicyRule[]
  readonly disabled: readonly PolicyRule[]
}

/** Compile a {@link CapabilitySetConfig} into fast-matchable rules. */
export function compileSet(set: CapabilitySetConfig = {}): CompiledCapabilityRules {
  return {
    resident: (set.resident ?? []).map(parseRule),
    onDemand: (set['on-demand'] ?? []).map(parseRule),
    disabled: (set.disabled ?? []).map(parseRule),
  }
}

/** Candidate fields a rule is matched against. */
export interface MatchTarget {
  /** Capability id: `mcp__<server>__<raw>`, a native tool name, or a bare skill name. */
  readonly id: string
  /** Model-facing name (for skills it equals the id; for MCP tools the public `mcp__...` name). */
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
      // matches a skill named `debugging`, `bash` matches the harness-native
      // tool `bash` whose public name is its bare name).
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
 * disabled-exact > disabled-wildcard > resident-exact > on-demand-exact >
 * resident-wildcard > on-demand-wildcard > default (resident). `disabled` is a
 * control decision, so it beats an explicit `resident` rule. Within
 * resident/on-demand an exact name beats a wildcard, so the management UI can
 * pin a single capability to a class even when a broader wildcard rule says
 * otherwise (e.g. `tools.resident: ['mcp__gongfeng__*']` must not silently win
 * over an explicit per-tool `on-demand` rule).
 */
export function classify(
  compiled: CompiledCapabilityRules,
  target: MatchTarget,
  metaTools: ReadonlySet<string> | readonly string[] = DEFAULT_META_TOOLS,
): CapabilityClass {
  const meta = metaTools instanceof Set ? metaTools : new Set<string>(metaTools)
  const id = target.id
  // metaTools can never be On-demand/Disabled for tools.
  if (target.kind === 'tool' && meta.has(id)) return 'resident'
  for (const rule of compiled.disabled) {
    if (!rule.wildcard && ruleMatches(rule, target)) return 'disabled'
  }
  for (const rule of compiled.disabled) {
    if (rule.wildcard && ruleMatches(rule, target)) return 'disabled'
  }
  for (const rule of compiled.resident) {
    if (!rule.wildcard && ruleMatches(rule, target)) return 'resident'
  }
  for (const rule of compiled.onDemand) {
    if (!rule.wildcard && ruleMatches(rule, target)) return 'on-demand'
  }
  for (const rule of compiled.resident) {
    if (rule.wildcard && ruleMatches(rule, target)) return 'resident'
  }
  for (const rule of compiled.onDemand) {
    if (rule.wildcard && ruleMatches(rule, target)) return 'on-demand'
  }
  return 'resident'
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
  /** Server namespace for tools (`built-in` for harness-native tools); undefined for skills. */
  readonly server?: string
  /** Skill source root label, present only for skills. */
  readonly source?: string
  /**
   * The skill's own directory on disk, present only for skills whose provider
   * has one. The 纳入管理 confirmation shows it so the operator sees which
   * directory is about to be linked, not just the root it came from.
   */
  readonly path?: string
  readonly class: CapabilityClass
  /** Human-friendly display label for the classification. */
  readonly classLabel: string
  /** True when this capability is a mandatory meta tool (always Resident). */
  readonly mandatory: boolean
}

const CLASS_LABELS: Record<CapabilityClass, string> = {
  resident: 'Resident · 常驻（直接调用）',
  'on-demand': 'On-demand · 按需（目录渐进加载）',
  disabled: 'Disabled · 禁用',
}

/**
 * The `ctx.capabilityPolicy` service surface.
 */
export interface CapabilityPolicyService {
  /** Classify a tool by its public name (`mcp__<server>__<raw>` or meta tool). */
  classifyTool(name: string): CapabilityClass
  /** Classify a skill by its bare name. */
  classifySkill(name: string): CapabilityClass
  /** True when a tool is Resident (or a mandatory meta tool). */
  isResidentTool(name: string): boolean
  /** True when a skill is Resident. */
  isResidentSkill(name: string): boolean
  /** True when a tool is Disabled. */
  isDisabledTool(name: string): boolean
  /** True when a skill is Disabled. */
  isDisabledSkill(name: string): boolean
  /**
   * True when a capability (by id and `kind`) is Disabled. `kind` disambiguates
   * a bare name shared by a tool and a skill.
   */
  isDisabledCapability(id: string, kind?: CapabilityKind): boolean
  /** Tool names that are always kept Resident. */
  metaTools(): readonly string[]
  /** Resolve a capability's id to a class; pass `kind` to disambiguate a bare name. */
  classifyCapability(id: string, kind?: CapabilityKind): CapabilityClass
  /** Rules resident for the registry/other consumers. */
  toolRules(): CompiledCapabilityRules
  skillRules(): CompiledCapabilityRules

  // — management surface (能力菜单) —
  /** Current (resolved) policy config. */
  getConfig(): Config
  /** Replace a subset of the policy config and recompile rules immediately. */
  updateConfig(partial: Partial<Config>): Promise<void>
  /**
   * Classify every capability currently indexed by `ctx.capability` (the
   * registry sibling). Returns an empty array when the registry is not mounted.
   */
  classifyAll(): readonly CapabilityClassification[]

  // — location registry (能力菜单 · 注册能力) —
  /** MCP servers declared in the patch file, in file order. */
  listLocations(): Promise<McpLocation[]>
  /** Declare a new MCP server. Rejects a duplicate `serverName`. */
  addLocation(input: McpInput): Promise<string>
  /** Remove a declared MCP server. */
  removeLocation(id: string): Promise<boolean>
  /** Replace a declared server's connection config (`serverName` is immutable). */
  updateLocation(id: string, input: McpUpdateInput): Promise<boolean>
  /** Skill entries under the user root, plus project entries the skill index knows about. */
  listSkillLocations(): Promise<SkillLocation[]>
  /**
   * Register a skill directory by linking it into the user root, or into
   * `<projectRoot>/.dsh/skills` when `projectPath` names a path inside a project
   * (the project root is derived from it the way dsh derives it). Returns the
   * entry path actually written.
   */
  addSkillLocation(dir: string, projectPath?: string): Promise<string>
  /** Unregister a skill entry; `entryDir` addresses a project entry, omit it for the user root. */
  removeSkillLocation(name: string, entryDir?: string): Promise<boolean>
  /** Repoint a registered skill entry at a different directory. */
  updateSkillLocation(name: string, dir: string, entryDir?: string): Promise<boolean>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    capabilityPolicy: CapabilityPolicyService
  }
}

/**
 * Build the projection listener for one assembly: keep only Resident tools plus
 * the mandatory meta tools.
 */
export function projectAssemblyTools(
  assembly: PromptAssembly,
  service: CapabilityPolicyService,
): PromptAssembly {
  const kept = assembly.tools.filter(tool => service.isResidentTool(tool.name))
  if (kept.length === assembly.tools.length) return assembly
  return { ...assembly, tools: kept }
}

/** Build the policy plugin. */
export const name = 'capability-menu-policy'
// The policy needs `capability` (the registry sibling) for classifyAll(); `tools` /
// `skills` are injected purely for startup ordering — projection itself runs on
// the `system-prompt/assemble` chain, not through the registries. The bundle
// mounts registry before policy, so `capability` is always available in practice.
export const inject = ['capability', 'tools', 'skills']

export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  // Accept legacy rule keys (`exposed`/`progressive`) with the same meaning as
  // the current `resident`/`on-demand`, so pre-rename profiles keep working
  // without a disk rewrite. The management UI always writes the new keys.
  const normalized: Config = { ...config }
  const legacyTools = config.tools?.exposed !== undefined || config.tools?.progressive !== undefined || config.tools?.blocked !== undefined
  const legacySkills = config.skills?.exposed !== undefined || config.skills?.progressive !== undefined || config.skills?.blocked !== undefined
  normalized.tools = normalizeSetConfig(config.tools)
  normalized.skills = normalizeSetConfig(config.skills)
  if (legacyTools || legacySkills) {
    ctx.logger.warn('capability-policy: legacy rule keys `exposed`/`progressive`/`blocked` were auto-mapped to `resident`/`on-demand`/`disabled`; edit the profile patch to persist the new keys')
  }

  // Mutable runtime state so the management surface (能力菜单) can live-update
  // the policy without a reload.
  let current = normalized
  let metaTools = [...(normalized.metaTools ?? DEFAULT_META_TOOLS)]
  let metaToolSet = new Set<string>(metaTools)
  let toolCompiled: CompiledCapabilityRules
  let skillCompiled: CompiledCapabilityRules

  // Location registry: the places capabilities come from. Editing the patch
  // file makes dsh hot-reload and mount/unmount the server itself, so this
  // plugin never imports or drives `dsh-mcp-client` directly.
  const defaults = defaultLocationConfig()
  const patchFile = (config.patchFile ?? defaults.patchFile).trim()
  const locations = new LocationRegistry(ctx, {
    patchFile,
    skillsDir: (config.skillsDir ?? defaults.skillsDir).trim(),
  })

  /**
   * Tier rules are persisted into the profile patch, in the entry the bundle
   * already declares for this plugin. Until now that config field was resolved
   * and never read: the surface edited memory only, so every tier change was
   * lost on restart.
   *
   * Persisting is deferred rather than done per click. A click recompiles the
   * rule sets in memory, which is what makes it feel instant; a patch write, by
   * contrast, makes dsh hot-reload this plugin — and its mount awaits a full
   * catalog enumeration. Debouncing puts that cost after the operator stops
   * clicking instead of on every click.
   */
  const POLICY_ENTRY_ID = 'capability-menu-policy'
  const POLICY_ENTRY_NAME = '@daweifu/capability-menu/policy'
  const persistDebounceMs = config.persistDebounceMs ?? 1500
  let persistTimer: ReturnType<typeof setTimeout> | undefined

  /** Order-insensitive signature of one rule set (resident / on-demand / disabled). */
  const tierSetSignature = (rules: unknown): string => {
    if (rules === null || typeof rules !== 'object') return ''
    const record = rules as Record<string, unknown>
    return ['resident', 'on-demand', 'disabled']
      .map(tier => Array.isArray(record[tier]) ? [...(record[tier] as unknown[])].sort().join('\u0000') : '')
      .join('\u0001')
  }

  /**
   * Order-insensitive signature of the whole policy config (tools + skills).
   *
   * The function operates on the *full config* object (`{ tools, skills,
   * metaTools, ... }`) — the tier arrays live at `config.tools.*` and
   * `config.skills.*`, never at the top level. Passing the config directly
   * (rather than the inner `tools` / `skills` objects) used to make both
   * sides of the comparison empty (`'\u0001\u0001'`) and silently swallow
   * every tier change after the first write. Splitting the comparison along
   * the real structure keeps the no-op optimization while letting an actual
   * change land.
   */
  const policyTierSignature = (config: unknown): string => {
    if (config === null || typeof config !== 'object') return '\u0002'
    const record = config as Record<string, unknown>
    return [
      tierSetSignature(record['tools']),
      tierSetSignature(record['skills']),
    ].join('\u0002')
  }

  /** Write the current rule sets into the patch, when they differ from the file. */
  const persistTiers = async (): Promise<void> => {
    if (patchFile.length === 0) return
    try {
      const written = await mutatePatch(patchFile, doc => {
        const existing = findEntry(doc, POLICY_ENTRY_ID)
        // Merge instead of replace: the row can carry keys this surface never
        // edits (`metaTools`, a legacy rule spelling), and patch semantics
        // replace the whole `config:` value.
        const raw = existing?.get('config') as { toJSON?: () => unknown } | undefined
        const prior = raw?.toJSON?.()
        const next: Record<string, unknown> = typeof prior === 'object' && prior !== null
          ? { ...(prior as Record<string, unknown>) }
          : {}
        next['tools'] = current.tools ?? {}
        next['skills'] = current.skills ?? {}
        if (existing === undefined) {
          // An override row, never an insert: this file is normally not where the
          // policy row comes from — the package's own bundle patch inserts it,
          // and a home/profile layer is applied after that one. Inserting a
          // second row with the same id would compose into a tree the loader
          // rejects (`duplicate loader entry id: capability-menu-policy`), so the
          // config has to be landed on the row that already exists.
          addEntryOverride(doc, { id: POLICY_ENTRY_ID, name: POLICY_ENTRY_NAME, config: next })
          return true
        }
        // Rewriting an unchanged config would still make dsh reload the plugin.
        if (policyTierSignature(prior) === policyTierSignature(next)) return false
        return setEntryConfig(doc, POLICY_ENTRY_ID, next)
      })
      if (written) ctx.logger.info(`capability-policy: persisted tier rules to ${patchFile}`)
    } catch (error) {
      ctx.logger.warn(`capability-policy: cannot persist tier rules to ${patchFile}: ${String(error)}`)
    }
  }

  const schedulePersistTiers = (): void => {
    if (patchFile.length === 0) return
    if (persistTimer !== undefined) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = undefined
      void persistTiers()
    }, persistDebounceMs)
  }

  // A pending write must not be dropped when the plugin is torn down (a hot
  // reload tears it down): flush it, so the file matches the state that was
  // live. The flush finds the config unchanged and writes nothing, so it cannot
  // start a reload loop. Returning an async disposer lets Cordis await the
  // write before letting the new instance (or shutdown) proceed, so a HMR
  // cannot race ahead of a pending persist.
  ctx.effect(() => async () => {
    if (persistTimer === undefined) return
    clearTimeout(persistTimer)
    persistTimer = undefined
    await persistTiers()
  }, 'capability-menu-policy: flush tier persistence')

  /**
   * Compile a candidate config into rule sets without touching live state.
   * Meta tools are the control-plane escape hatch: blocking one is a
   * misconfiguration that must fail loud, never silently disable the surface.
   * Throws before anything is committed when validation fails.
   */
  const compileConfig = (
    candidate: Config,
    meta: readonly string[],
  ): { tools: CompiledCapabilityRules; skills: CompiledCapabilityRules } => {
    const toolRules = compileSet(candidate.tools)
    const skillRules = compileSet(candidate.skills)
    // Normalize tool/skill rule kinds for matching.
    const tools: CompiledCapabilityRules = {
      resident: toolRules.resident.map(rule => ({ ...rule, kind: 'tool' as const })),
      onDemand: toolRules.onDemand.map(rule => ({ ...rule, kind: 'tool' as const })),
      disabled: toolRules.disabled.map(rule => ({ ...rule, kind: 'tool' as const })),
    }
    const skills: CompiledCapabilityRules = {
      resident: skillRules.resident.map(rule => ({ ...rule, kind: 'skill' as const })),
      onDemand: skillRules.onDemand.map(rule => ({ ...rule, kind: 'skill' as const })),
      disabled: skillRules.disabled.map(rule => ({ ...rule, kind: 'skill' as const })),
    }
    for (const name of meta) {
      const target = { id: name, name, server: serverNameOf(name), kind: 'tool' as const, ruleKind: 'tool' as const }
      if (anyRuleMatches(tools.disabled, target)) {
        throw new Error(`meta tool "${name}" cannot be disabled; remove it from tools.disabled`)
      }
    }
    return { tools, skills }
  }

  /**
   * Compile, then commit. Compiling first keeps a rejected update from landing
   * half-applied: `current`, `metaTools` and the rule sets move together or not
   * at all.
   */
  const applyConfig = (candidate: Config, meta: readonly string[]): void => {
    const compiled = compileConfig(candidate, meta)
    current = candidate
    metaTools = [...meta]
    metaToolSet = new Set<string>(metaTools)
    toolCompiled = compiled.tools
    skillCompiled = compiled.skills
  }
  applyConfig(normalized, [...(normalized.metaTools ?? DEFAULT_META_TOOLS)])

  const service: CapabilityPolicyService = {
    classifyTool(name: string): CapabilityClass {
      const server = serverNameOf(name)
      return classify(toolCompiled, { id: name, name, server, kind: 'tool', ruleKind: 'tool' }, metaToolSet)
    },
    classifySkill(name: string): CapabilityClass {
      return classify(skillCompiled, { id: name, name, kind: 'skill', ruleKind: 'skill' }, new Set())
    },
    classifyCapability(id: string, kind?: CapabilityKind): CapabilityClass {
      // `kind` disambiguates a bare name shared by a tool and a skill.
      return kind === 'skill' ? service.classifySkill(id) : service.classifyTool(id)
    },
    isResidentTool(name: string): boolean {
      return service.classifyTool(name) === 'resident'
    },
    isResidentSkill(name: string): boolean {
      return service.classifySkill(name) === 'resident'
    },
    isDisabledTool(name: string): boolean {
      return service.classifyTool(name) === 'disabled'
    },
    isDisabledSkill(name: string): boolean {
      return service.classifySkill(name) === 'disabled'
    },
    isDisabledCapability(id: string, kind?: CapabilityKind): boolean {
      return service.classifyCapability(id, kind) === 'disabled'
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
    async updateConfig(partial: Partial<Config>): Promise<void> {
      // Only the materialized On-demand catalog on disk depends on the
      // classification: the model-facing projection is derived from the rules
      // on every assemble, so it needs no rebuild. Cycling a capability
      // between Resident and Disabled changes nothing on disk, so it must not
      // pay for a full re-enumeration.
      const updateStartedAt = Date.now()
      const before = onDemandSignature()
      // Validate first, commit second (see `applyConfig`): a rejected update
      // leaves the live policy exactly as it was.
      applyConfig(
        { ...current, ...partial },
        partial.metaTools !== undefined ? [...(partial.metaTools ?? DEFAULT_META_TOOLS)] : metaTools,
      )
      // The On-demand set moved, so the grep-able YAML is stale (and a
      // capability reclassified to Disabled must disappear from it). Re-emit it
      // from the index we already have and await that: it is a filter plus a
      // small write, so awaiting keeps the file consistent with what the UI is
      // about to read. `requestRefresh` would instead re-enumerate every tool
      // and every agent preset scope — no inventory changed, and the cost of
      // that was exactly what made a tier click feel like a hang.
      const moved = onDemandSignature() !== before
      if (moved) await ctx.capability.rewriteCatalog()
      // One line per tier write: the whole handler's cost, and whether the
      // catalog was re-emitted. A slow click with a fast line here means the
      // time went somewhere else (a queued rebuild, the carrier, the browser).
      ctx.logger.info(
        `capability-policy: tier write took ${Date.now() - updateStartedAt}ms (catalog rewritten: ${moved})`,
      )
      schedulePersistTiers()
    },
    classifyAll(): readonly CapabilityClassification[] {
      // The registry default maxResults (20) would truncate the management
      // surface: enumerate every indexed capability, not just the top-20.
      return ctx.capability.search({ maxResults: Number.MAX_SAFE_INTEGER }).map(summary => {
        const cls = service.classifyCapability(summary.id, summary.kind)
        const mandatory = summary.kind === 'tool' && metaToolSet.has(summary.id)
        // Summaries carry no directory, so a skill's own is resolved from its
        // record — the same lookup 纳入管理 itself uses to decide what to link.
        const skillPath = summary.kind === 'skill'
          ? ctx.capability.get(summary.id, 'skill')?.origin.path
          : undefined
        return {
          id: summary.id,
          kind: summary.kind,
          name: summary.name,
          ...summary.server !== undefined ? { server: summary.server } : {},
          ...summary.source !== undefined ? { source: summary.source } : {},
          ...skillPath !== undefined ? { path: skillPath } : {},
          class: cls,
          classLabel: CLASS_LABELS[cls],
          mandatory,
        }
      })
    },

    // — location registry —
    listLocations(): Promise<McpLocation[]> {
      return locations.listMcp()
    },
    addLocation(input: McpInput): Promise<string> {
      return locations.addMcp(input)
    },
    removeLocation(id: string): Promise<boolean> {
      return locations.removeMcp(id)
    },
    updateLocation(id: string, input: McpUpdateInput): Promise<boolean> {
      return locations.updateMcp(id, input)
    },
    listSkillLocations(): Promise<SkillLocation[]> {
      return locations.listSkills()
    },
    addSkillLocation(dir: string, projectPath?: string): Promise<string> {
      return locations.addSkill(dir, projectPath)
    },
    removeSkillLocation(name: string, entryDir?: string): Promise<boolean> {
      return locations.removeSkill(name, entryDir)
    },
    updateSkillLocation(name: string, dir: string, entryDir?: string): Promise<boolean> {
      return locations.updateSkill(name, dir, entryDir)
    },
  }

  /**
   * Fingerprint of the capability ids currently classified On-demand. This set
   * is the only thing a classification change can invalidate on disk, so it
   * decides whether `updateConfig` needs to request a rebuild at all.
   */
  const onDemandSignature = (): string => {
    const ids = ctx.capability
      .search({ maxResults: Number.MAX_SAFE_INTEGER })
      .filter(summary => service.classifyCapability(summary.id, summary.kind) === 'on-demand')
      .map(summary => `${summary.kind}:${summary.id}`)
    ids.sort()
    return ids.join('\u0000')
  }

  // Disabled capabilities are a hard deny at the execution surface, not just a
  // projection concern: a hallucinated direct call to a disabled tool (or to the
  // `skill` loader for a disabled skill) must never reach the underlying server.
  // On-demand tools stay executable — meta_invoke forwards through this same
  // pipeline, so only Disabled is rejected here.
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (service.isDisabledTool(exec.name)) {
      return { kind: 'deny', reason: `capability "${exec.name}" is disabled and cannot be executed` }
    }
    if (exec.name === 'skill') {
      const args = exec.arguments as { name?: unknown } | null | undefined
      const name = typeof args?.name === 'string' ? args.name : ''
      if (name.length > 0 && service.isDisabledSkill(name)) {
        return { kind: 'deny', reason: `skill "${name}" is disabled and cannot be loaded` }
      }
    }
    return next()
  })

  // On-demand/Disabled skills must not appear in the model-facing
  // `<available_skills>` catalog injected by `dsh-tool-skill`. The catalog is a
  // user-role message whose `source.kind === 'skill-catalog'`; rewrite it every
  // pre-step to keep only Resident skills. dsh-tool-skill republishes the full
  // catalog earlier on the same chain, so this filter is idempotent: whatever
  // it publishes, only the Resident subset reaches the model.
  ctx.on('agent/pre-step', async (_payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    let changed = false
    const messages = decision.messages.map(message => {
      const source = message.source as { kind?: unknown; entries?: unknown } | undefined
      if (source?.kind !== 'skill-catalog') return message
      if (!Array.isArray(source.entries)) {
        // Cannot tell which skills the message lists, so it stays untouched —
        // but say so: silently skipping the filter would leak Disabled skills
        // into the model surface with no trace.
        ctx.logger.warn('capability-policy: skill-catalog message has no entries array; leaving it unfiltered')
        return message
      }
      const entries = source.entries.filter((entry): entry is { name: string; description?: string } =>
        typeof entry === 'object' && entry !== null && typeof (entry as { name?: unknown }).name === 'string')
      const kept = entries
        .filter(entry => service.isResidentSkill(entry.name))
        .map(entry => ({ name: entry.name, description: entry.description ?? '' }))
      if (kept.length === entries.length) return message
      changed = true
      return {
        ...message,
        content: [{ type: 'text' as const, text: renderSkillCatalog(kept) }],
        source: { ...message.source, entries: kept } as unknown as typeof message.source,
      }
    })
    if (!changed) return decision
    return { ...decision, messages }
  })

  // Project the model-visible tool list, then append a one-line pointer to the
  // on-demand catalog so the model knows it exists without having to "think of"
  // meta_search first. Skills keep the dsh-native catalog, but filtered to
  // Resident by the `agent/pre-step` hook above.
  ctx.on('system-prompt/assemble', async (_assembly: PromptAssembly, _context, next) => {
    const resolved = await next()
    const projected = projectAssemblyTools(resolved, service)
    const catalogPath = ctx.capability.catalogPath?.()
    // Skip the pointer when there is nothing On-demand to browse: an empty
    // hint wastes ~77 tokens of context and points at an empty file.
    if (catalogPath === undefined || (ctx.capability.onDemandCount?.() ?? 0) === 0) return projected
    const pointer = {
      name: 'capability-menu-catalog',
      text: [
        'On-demand capabilities are not in the resident tool list above. Their catalog is a YAML file you can browse with grep/read:',
        `  ${catalogPath}`,
        'Search it (e.g. grep -n "name:" <path>) or call meta_search with an exact id for a schema, then meta_invoke to run/load the capability.',
      ].join('\n'),
    }
    return { ...projected, sections: [...projected.sections, pointer] }
  })

  ctx.provide('capabilityPolicy', service)

  // Emit the on-demand catalog before the plugin finishes mounting. The
  // registry's own startup path (rebuildTools + refreshSkills) bypasses
  // refresh(), so without this the YAML would not exist until the first
  // tools/skills change event. Awaiting here closes the cold-start window
  // where the first assemble could point at a file that does not exist yet.
  await ctx.capability.refresh()
}

/**
 * Rebuild the text body of a skill-catalog user message from a filtered entry
 * list. Mirrors the `<available_skills>` format emitted by `dsh-tool-skill` so
 * the model sees a consistent, complete replacement catalog.
 */
function renderSkillCatalog(entries: ReadonlyArray<{ name: string; description?: string }>): string {
  const guidance = entries.length === 0
    ? ['No skills are currently available through the `skill` tool. Do not use names from earlier skill catalogs.']
    : [
        'If the user names a skill, or the task clearly matches a skill\u2019s description, call the `skill` tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill\u2019s instructions until it has been loaded.',
      ]
  return [
    '<system-reminder>',
    'A skill is a reusable set of task-specific instructions. The following skills are available in this session:',
    '',
    '<available_skills>',
    ...entries.map(entry => `- \`${escapeText(entry.name)}\`: ${escapeText(entry.description ?? '')}`),
    '</available_skills>',
    '',
    ...guidance,
    '</system-reminder>',
  ].join('\n')
}
