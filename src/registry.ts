/**
 * Unified capability catalog for the DeepSeek Harness.
 *
 * @module @daweifu/capability-menu (registry plugin)
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import type { JsonSchemaNode, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { isModelInvocable, type SkillSummary } from '@deepseek-ai/dsh-skill'
import yaml from 'js-yaml'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'

/**
 * Kinds of capability the catalog can hold.
 * - `tool`:   action capability — executes a concrete action (an MCP tool or a
 *   harness-native tool cataloged under the reserved `built-in` server).
 * - `skill`:  action capability — loads the method/instructions for a task.
 */
export type CapabilityKind = 'tool' | 'skill'

/**
 * Stable invocation actions a capability can declare. Each kind maps to one
 * canonical action; a new kind only deserves a new value here when it
 * introduces a new action (not a new flavor of an existing one).
 * `execute` = run the concrete action (a tool — MCP or native — via `ctx.tools.execute`);
 * `load`    = load the method/instructions (a skill).
 */
export type CapabilityAction = 'execute' | 'load'

/** Stable identifier prefixes: MCP tools keep `mcp__...`, skills use `skill:<name>`. */
export const SKILL_ID_PREFIX = 'skill:'
export const MCP_ID_PREFIX = 'mcp__'
/**
 * Reserved pseudo-server that groups harness-native (non-MCP) tools in the
 * management surface. Native tools (bash/read/write/…) are cataloged like MCP
 * tools — same `server` dimension — so the 能力菜单 can group them, classify
 * them Resident/On-demand/Blocked, and `meta_invoke` can dispatch them.
 */
export const BUILT_IN_SERVER = 'built-in'
/**
 * Tool names that never enter the capability catalog: this plugin's own
 * control plane (`meta_search`/`meta_invoke`, always Resident) and the
 * reserved Code Mode presentation transport (`run_code`).
 */
export const CATALOG_EXCLUDED_TOOLS: ReadonlySet<string> = new Set(['meta_search', 'meta_invoke', 'run_code'])

/** Capability-stable origin metadata used by search filters and detail views. */
export interface CapabilityOrigin {
  /** Human/namespace label: an MCP server name, the reserved `built-in` for native tools, or a skill provider. */
  readonly provider: string
  /** Server namespace, present only for `kind: 'tool'` (`built-in` for native tools). */
  readonly serverName?: string
  /** Local skill path, present only for `kind: 'skill'`. */
  readonly path?: string
  /** Skill source root label (`project-dsh`/`user-agents`/…), present only for skills. */
  readonly source?: string
}

/** Objective and subjective usage statistics, written back from `tools/result`. */
export interface CapabilityStats {
  readonly uses: number
  readonly successes: number
  readonly failures: number
  readonly totalMs: number
  readonly lastUsedAt?: number
}

/** One indexed capability. */
export interface CapabilityRecord {
  /** Stable identifier: `mcp__<server>__<raw>` or `skill:<name>`. */
  readonly id: string
  readonly kind: CapabilityKind
  /** The canonical invocation action(s) this capability exposes. */
  readonly actions: readonly CapabilityAction[]
  /** Model-facing name (the tool name or skill name without prefix). */
  readonly name: string
  readonly description: string
  /** Skill-only extra routing guidance. */
  readonly whenToUse?: string
  readonly origin: CapabilityOrigin
  /** Full parameter schema (MCP inputSchema / empty object for skills). */
  readonly parameters: JsonSchemaNode
  readonly invocation: { modelInvocable: boolean; userInvocable: boolean }
  readonly tags: readonly string[]
  readonly stats: CapabilityStats
  /** Token-trimmed short description used by `meta_search` list mode. */
  readonly summary: string
}

/** Lightweight list-mode projection of one capability (no full schema). */
export interface CapabilitySummary {
  readonly id: string
  readonly kind: CapabilityKind
  readonly name: string
  readonly summary: string
  readonly server?: string
  /** Skill source root label, present only for `kind: 'skill'`. */
  readonly source?: string
  readonly tags: readonly string[]
  readonly success_rate?: number
  readonly uses: number
}

/** Full detail projection, including the parameter schema. */
export interface CapabilityDetail {
  readonly id: string
  readonly kind: CapabilityKind
  readonly actions: readonly CapabilityAction[]
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly parameters: JsonSchemaNode
  readonly output?: JsonSchemaNode
  readonly origin: CapabilityOrigin
  readonly tags: readonly string[]
  readonly stats: CapabilityStats
}

/** Search filter options. */
export interface MetaSearchOptions {
  readonly kind?: CapabilityKind | 'all'
  readonly server?: string | undefined
  readonly tag?: string | undefined
  /** Maximum number of results to return. */
  readonly maxResults?: number
  /**
   * Viewing scope. Retained for caller ergonomics and optional authorization
   * checks, but the policy does NOT use it to filter visibility — On-demand
   * capabilities must remain searchable regardless of the caller's projection.
   */
  readonly scope?: ScopeKey | undefined
  /** Query string for keyword matching; exact id/name match wins. */
  readonly query?: string
  /** Exact capability id. */
  readonly id?: string
  /** Whether to include the full body for skills in `getDetail` (default false). */
  readonly detailIncludesBody?: boolean
}

/** Runtime detail resolution context. */
export interface MetaLookupContext {
  readonly cwd?: string | undefined
  readonly signal?: AbortSignal | undefined
  readonly scope?: ScopeKey | undefined
}

/** One direct child in a skill directory listing. */
export interface SkillDirEntry {
  readonly name: string
  readonly type: 'file' | 'directory'
}

/** The `ctx.capability` service surface. */
export interface CapabilityService {
  /** Enumerate the current catalog (optionally filtered). */
  search(options?: MetaSearchOptions): CapabilitySummary[]
  /** Resolve one record by id, or undefined. */
  get(id: string): CapabilityRecord | undefined
  /** Resolve one record's full detail (schema, output; skill body optional). */
  getDetail(id: string, context?: MetaLookupContext): Promise<CapabilityDetail | undefined>
  /**
   * List a skill's directory children (one level deep). The directory is
   * resolved from the skill's own provider path, never from caller input;
   * `relPath` (optional, relative to the skill root) descends into a child
   * directory.
   */
  listSkillDir(id: string, relPath?: string): Promise<SkillDirEntry[] | undefined>
  /**
   * Read a text file inside a skill's directory, addressed by a relative path
   * that is resolved against and confined to the skill root. Binary files
   * (content containing NUL) return undefined.
   */
  readSkillFile(id: string, relPath: string): Promise<string | undefined>
  /** Return the current number of indexed capabilities. */
  size(): number
  /**
   * Absolute path of the on-demand capability catalog YAML, when emission is
   * enabled. The model can browse this file with grep/read instead of only
   * reaching the catalog through `meta_search`.
   */
  catalogPath(): string | undefined
  /**
   * Number of On-demand capabilities in the latest catalog emission. Used by
   * the policy's assemble hook to skip the catalog pointer when there is
   * nothing On-demand to browse.
   */
  onDemandCount(): number
  /**
   * Rebuild the catalog from the current tool/skill registries; resolves when
   * done. In production the registry rebuilds automatically on `tools/change`
   * / `skills/change`; this public handle is for tests and external orchestrators
   * that want to force a rebuild.
   */
  refresh(): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    capability: CapabilityService
  }
}

/** Registry configuration. */
export interface Config {
  /** Maximum summary length in characters (min 20). */
  summaryMaxChars?: number
  /** Whether to include the skill body in `getDetail` results (default false). */
  detailIncludesBody?: boolean
  /** Maximum search results returned (default 20, max 100). */
  maxResults?: number
  /** Experience-weighting intensity for ranking (0 disables, default 0.1). */
  weighting?: number
  /**
   * Optional path for the on-demand capability catalog emitted as a YAML file
   * for model-side grep/read browsing. Defaults to
   * `~/.dsh/capability-catalog.yaml`; set to an empty string to disable
   * emission. Blocked capabilities are never written.
   */
  catalogFile?: string
}

/** Validate and default the registry configuration. */
export const Config: z<Config> = z.object({
  summaryMaxChars: z.number().default(160),
  detailIncludesBody: z.boolean().default(false),
  maxResults: z.number().default(20),
  weighting: z.number().default(0.1),
  // schemastery object properties are optional-by-default: a missing key or
  // undefined value is accepted (no `meta.required`), so no `.optional()` needed.
  catalogFile: z.string(),
})

function assertPositiveInteger(name: string, value: number, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min}`)
  }
}

function assertWeight(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a number in [0, 1]`)
  }
}

/** Trim a description to a model-friendly summary. */
function toSummary(description: string, maxChars: number): string {
  const collapsed = description.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= maxChars) return collapsed
  return `${collapsed.slice(0, maxChars - 1)}…`
}

/** BM25-ish keyword score over one record (pure JS, zero dependencies). */
function keywordScore(record: CapabilityRecord, tokens: readonly string[]): number {
  const haystack = [
    record.name,
    record.description,
    record.whenToUse ?? '',
    record.origin.provider,
    ...record.tags,
  ].join(' ').toLowerCase()
  let score = 0
  for (const token of tokens) {
    if (token.length === 0) continue
    if (haystack.includes(token)) score += 1
    // Substring hits on the identifier are stronger (exact id match handled separately).
    if (record.id.toLowerCase().includes(token)) score += 1.5
  }
  return score
}

function successRate(stats: CapabilityStats): number | undefined {
  if (stats.uses === 0) return undefined
  return stats.successes / stats.uses
}

/** Build the registry plugin. */
export const name = 'capability-menu-registry'
export const inject = ['tools', 'skills']

export function apply(ctx: Context, config: Config = {}): void {
  const summaryMaxChars = config.summaryMaxChars ?? 160
  const detailIncludesBody = config.detailIncludesBody ?? false
  const maxResults = config.maxResults ?? 20
  const weighting = config.weighting ?? 0.1
  const catalogFile = (config.catalogFile ?? join(homedir(), '.dsh', 'capability-catalog.yaml')).trim()
  assertPositiveInteger('summaryMaxChars', summaryMaxChars, 20)
  assertPositiveInteger('maxResults', maxResults, 1)
  assertWeight('weighting', weighting)

  /** Tool records keyed by tool name (MCP tools plus native tools under `built-in`); skills keyed by `skill:<name>`. */
  let toolRecords = new Map<string, CapabilityRecord>()
  let skillRecords = new Map<string, CapabilityRecord>()
  /** The scope each indexed skill was collected from; undefined = global layer. */
  let skillScopes = new Map<string, ScopeKey | undefined>()
  /** On-demand count of the latest catalog emission (0 until first write). */
  let onDemandCount = 0

  const statsOf = (record: CapabilityRecord): CapabilityStats => record.stats

  /**
   * Resolve a skill's root directory from the live skill registry. The
   * directory comes from the skill provider's own locator (`resourceBase` for
   * bundle skills, the SKILL.md parent for flat files) — never from caller input.
   */
  const skillRootOf = async (id: string): Promise<string | undefined> => {
    const name = skillNameOf(id)
    const scope = skillScopes.get(id)
    const lookup = scope === undefined ? {} : { scope }
    const definition = await ctx.skills.get(name, lookup).catch(() => undefined)
    if (definition !== undefined) {
      if (definition.resourceBase !== undefined && definition.resourceBase.kind === 'directory') {
        return definition.resourceBase.path
      }
      if (definition.path !== undefined) return dirname(definition.path)
    }
    return undefined
  }

  /** Next-catalog accumulator shared by the global and preset-scope passes. */
  let nextToolRecords = new Map<string, CapabilityRecord>()

  /**
   * Index one visible tool schema into the next catalog, deduped by name.
   * 全部可见工具都进编目，仅排除 meta_search/meta_invoke（本插件控制面，
   * 恒常驻）与 run_code（Code Mode 保留传输层）。mcp__ 工具按真实 server
   * 分组；原生工具（无 mcp__ 前缀）统一归入保留的 built-in server，使能力
   * 菜单能统一按 server 分组、三档管理，meta_invoke 也能派发它们。
   * A schema may surface from several preset scope views; the first wins.
   */
  const indexToolSchema = (schema: { name: string; description: string; parameters: JsonSchemaNode }): void => {
    if (CATALOG_EXCLUDED_TOOLS.has(schema.name)) return
    if (nextToolRecords.has(schema.name)) return
    const existing = toolRecords.get(schema.name)
    const stats = existing?.stats ?? { uses: 0, successes: 0, failures: 0, totalMs: 0 }
    const isMcp = schema.name.startsWith(MCP_ID_PREFIX)
    const serverName = isMcp ? serverNameOf(schema.name) : BUILT_IN_SERVER
    nextToolRecords.set(schema.name, {
      id: schema.name,
      kind: 'tool',
      actions: ['execute'],
      name: schema.name,
      description: schema.description,
      origin: { provider: serverName, serverName },
      parameters: schema.parameters as JsonSchemaNode,
      invocation: { modelInvocable: true, userInvocable: false },
      tags: [serverName, 'tool'],
      stats,
      summary: toSummary(schema.description, summaryMaxChars),
    })
  }

  /**
   * Rebuild the tool index from the visible tool registries.
   *
   * Harness-native tools are registered on the agent plane (per agent preset's
   * standing scope), not the root/global layer the plugin's own `ctx.tools`
   * view sees — exactly the layout the skills side enumerates below. Mirror
   * that: index the global view first, then every mountable preset's standing
   * scope, so natives land under the reserved `built-in` pseudo-server.
   */
  // Rebuilds can overlap (eager mount-time run vs. a change-event refresh);
  // the epoch guard drops a superseded run so its older snapshot never
  // clobbers a newer one.
  let toolIndexEpoch = 0
  const rebuildTools = async (): Promise<void> => {
    const epoch = ++toolIndexEpoch
    nextToolRecords = new Map<string, CapabilityRecord>()
    for (const schema of ctx.tools.schemas()) indexToolSchema(schema)

    const agentPresets = (ctx.get as (key: string) => unknown)('agentPresets') as
      | { list(): Promise<Array<{ id: string; broken?: string }>>; standingKeyFor(id?: string): Promise<ScopeKey> }
      | undefined
    if (agentPresets !== undefined) {
      let presets: Array<{ id: string; broken?: string }> = []
      try {
        presets = await agentPresets.list()
      } catch (error) {
        ctx.logger.warn(`meta-registry: agent-presets enumeration failed: ${String(error)}`)
      }
      for (const preset of presets) {
        if (preset.broken !== undefined) continue
        try {
          const scope = await agentPresets.standingKeyFor(preset.id)
          for (const schema of ctx.tools.schemas(scope)) indexToolSchema(schema)
        } catch (error) {
          ctx.logger.warn(`meta-registry: preset "${preset.id}" tool scope unavailable: ${String(error)}`)
        }
      }
    }
    if (epoch === toolIndexEpoch) toolRecords = nextToolRecords
  }

  /**
   * Rebuild the skill index asynchronously; resolves when the refresh completes.
   *
   * Skills live in a per-scope registry: the global layer plus one layer per
   * agent preset that mounts skill providers (a preset's `skill-filesystem`
   * registers into that preset's layer, so the host-plane global read alone
   * sees nothing). The management catalog enumerates the global layer and then
   * every mountable preset's standing scope, so preset-scoped skills surface.
   */
  const refreshSkills = async (): Promise<void> => {
    const nextSkills = new Map<string, CapabilityRecord>()
    const nextSkillScopes = new Map<string, ScopeKey | undefined>()

    const indexSkill = (skill: SkillSummary, scope: ScopeKey | undefined): void => {
      if (!isModelInvocable(skill)) return
      const id = skillId(skill.name)
      const existing = skillRecords.get(id)
      const stats = existing?.stats ?? { uses: 0, successes: 0, failures: 0, totalMs: 0 }
      nextSkills.set(id, {
        id,
        kind: 'skill',
        actions: ['load'],
        name: skill.name,
        description: skill.description,
        ...skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {},
        origin: {
          provider: skill.provider,
          ...typeof skill.source === 'string' ? { source: skill.source } : {},
        },
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        invocation: { modelInvocable: true, userInvocable: skill.invocation.userInvocable },
        tags: [skill.provider, 'skill'],
        stats,
        summary: toSummary(skill.description, summaryMaxChars),
      })
      nextSkillScopes.set(id, scope)
    }

    const collectScoped = async (label: string, scope: ScopeKey | undefined): Promise<void> => {
      let skills: SkillSummary[] = []
      try {
        skills = scope === undefined ? await ctx.skills.list({}) : await ctx.skills.list({ scope })
      } catch (error) {
        ctx.logger.warn(`meta-registry: skill catalog refresh failed for ${label}: ${String(error)}`)
        return
      }
      for (const skill of skills) indexSkill(skill, scope)
    }

    // Global layer first: the host's own skill providers.
    await collectScoped('global', undefined)

    // Preset layers: agent presets mount skill providers into their own scope
    // (web surface disables the host-plane rows by design). `agentPresets` is
    // optional — headless bundles without it index the global layer only.
    const agentPresets = (ctx.get as (key: string) => unknown)('agentPresets') as
      | { list(): Promise<Array<{ id: string; broken?: string }>>; standingKeyFor(id?: string): Promise<ScopeKey> }
      | undefined
    if (agentPresets !== undefined) {
      let presets: Array<{ id: string; broken?: string }> = []
      try {
        presets = await agentPresets.list()
      } catch (error) {
        ctx.logger.warn(`meta-registry: agent-presets enumeration failed: ${String(error)}`)
      }
      for (const preset of presets) {
        if (preset.broken !== undefined) continue
        try {
          const scope = await agentPresets.standingKeyFor(preset.id)
          await collectScoped(`preset "${preset.id}"`, scope)
        } catch (error) {
          ctx.logger.warn(`meta-registry: preset "${preset.id}" skill scope unavailable: ${String(error)}`)
        }
      }
    }

    skillRecords = nextSkills
    skillScopes = nextSkillScopes
  }

  /**
   * Emit the on-demand capability catalog as a YAML file the model can browse
   * with grep/read. Only On-demand capabilities are written; Resident ones are
   * already in the model surface and Blocked ones must stay undiscoverable.
   * Skips emission when the policy plugin is not mounted (no classification) or
   * the file path is disabled.
   */
  const writeCatalog = async (): Promise<void> => {
    onDemandCount = 0
    if (catalogFile.length === 0) return
    const policy = ctx.get('capabilityPolicy')
    if (policy === undefined) return
    const onDemand = [...toolRecords.values(), ...skillRecords.values()]
      .filter(record => policy.classifyCapability(record.id) === 'on-demand')
      .map(record => ({
        id: record.id,
        kind: record.kind,
        name: record.name,
        // Use the trimmed summary (160 chars), not the full description: the
        // file is for grep/read discovery, and a few hundred tools would
        // otherwise balloon to tens of KB of context.
        description: record.summary,
        ...record.whenToUse !== undefined ? { whenToUse: record.whenToUse } : {},
        ...record.origin.serverName !== undefined ? { server: record.origin.serverName } : {},
      }))
    onDemandCount = onDemand.length
    try {
      await writeFile(catalogFile, yaml.dump({ capabilities: onDemand }), 'utf8')
    } catch (error) {
      ctx.logger.warn(`capability-registry: on-demand catalog write failed (${catalogFile}): ${String(error)}`)
    }
  }

  /** Refresh the whole catalog: tools and skills, then re-emit the YAML. */
  const refresh = async (): Promise<void> => {
    await rebuildTools()
    await refreshSkills()
    await writeCatalog()
  }

  /** Register once; also subscribe to change events. */
  const disposers: Array<() => void> = []
  disposers.push(ctx.on('tools/change', () => void refresh()))
  disposers.push(ctx.on('skills/change', () => void refresh()))
  // Index the global tool view eagerly (the synchronous part of
  // `rebuildTools`); preset standing scopes and skills are enumerated by the
  // first explicit `refresh()` (policy mounts it before the surface is used)
  // or a change event, so an eager load never snapshots — and caches inside the
  // tool/skill registries — an incomplete catalog.
  void rebuildTools()
  void refreshSkills()
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  })

  const service: CapabilityService = {
    search(options: MetaSearchOptions = {}): CapabilitySummary[] {
      const kind = options.kind ?? 'all'
      const server = options.server
      const tag = options.tag
      const query = options.query?.trim()
      const id = options.id?.trim()

      const all: CapabilityRecord[] = []
      // Index/source is the GLOBAL registry — no visibility filter here.
      // Resident/On-demand is a projection-layer concern (`dsh-capability-policy`),
      // so an On-demand tool hidden from the model's exposure surface must still
      // be searchable so `meta_search` can return it for `meta_invoke`. Blocked
      // enforcement lives at the model-facing tools (meta_search/meta_invoke),
      // keeping the management surface able to list Blocked capabilities.
      if (kind === 'all' || kind === 'tool') {
        for (const record of toolRecords.values()) all.push(record)
      }
      if (kind === 'all' || kind === 'skill') {
        for (const record of skillRecords.values()) all.push(record)
      }

      const filtered = all.filter(record => {
        if (server !== undefined && record.origin.serverName !== server) return false
        if (tag !== undefined && !record.tags.includes(tag)) return false
        if (id !== undefined && record.id !== id) return false
        return true
      })

      // Rank: exact id/name first, then keyword score, then experience weight.
      const tokens = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
      const ranked = filtered.map(record => {
        let score = 0
        if (query !== undefined && query.length > 0) {
          const exact = record.id === query || record.name === query
          if (exact) score += 100
          score += keywordScore(record, tokens)
        }
        const rate = successRate(record.stats)
        if (rate !== undefined && weighting > 0) score += rate * weighting * 10
        if (record.stats.uses > 0 && weighting > 0) score += Math.min(record.stats.uses, 100) * weighting * 0.01
        return { record, score }
      }).sort((a, b) => b.score - a.score)

      const limit = Math.max(1, options.maxResults ?? maxResults)
      return ranked.slice(0, limit).map(({ record }) => {
        const rate = successRate(record.stats)
        return {
          id: record.id,
          kind: record.kind,
          name: record.name,
          summary: record.summary,
          ...record.origin.serverName !== undefined ? { server: record.origin.serverName } : {},
          ...record.origin.source !== undefined ? { source: record.origin.source } : {},
          tags: record.tags,
          ...rate !== undefined ? { success_rate: rate } : {},
          uses: record.stats.uses,
        }
      })
    },

    get(id: string): CapabilityRecord | undefined {
      const key = id.trim()
      return toolRecords.get(key) ?? skillRecords.get(key)
    },

    async getDetail(id: string, context: MetaLookupContext = {}): Promise<CapabilityDetail | undefined> {
      const key = id.trim()
      const record = toolRecords.get(key) ?? skillRecords.get(key)
      if (record === undefined) return undefined

      if (record.kind === 'tool') {
        const definition = ctx.tools.get(record.name, context.scope)
        if (definition === undefined) return undefined
        return {
          id: record.id,
          kind: 'tool',
          actions: record.actions,
          name: record.name,
          description: definition.description,
          parameters: definition.parameters as JsonSchemaNode,
          output: definition.output.schema,
          origin: record.origin,
          tags: record.tags,
          stats: statsOf(record),
        }
      }

      // Skill: resolve the body if configured.
      const lookup = {
        cwd: context.cwd,
        signal: context.signal,
        scope: context.scope,
      }
      const skill = await ctx.skills.get(record.name, lookup).catch(() => undefined)
      const detail: CapabilityDetail = {
        id: record.id,
        kind: 'skill',
        actions: record.actions,
        name: record.name,
        description: record.description,
        ...record.whenToUse !== undefined ? { whenToUse: record.whenToUse } : {},
        parameters: record.parameters,
        origin: record.origin,
        tags: record.tags,
        stats: statsOf(record),
      }
      if (skill !== undefined && detailIncludesBody) {
        return { ...detail, output: { type: 'object', properties: { content: { type: 'string' } } } as JsonSchemaNode }
      }
      return detail
    },

    async listSkillDir(id: string, relPath = ''): Promise<SkillDirEntry[] | undefined> {
      const root = await skillRootOf(id)
      if (root === undefined) return undefined
      const target = relPath.length === 0 ? root : resolve(root, relPath)
      // Containment: the resolved path must stay inside the skill root.
      if (target !== root && !target.startsWith(`${root}${sep}`)) return undefined
      try {
        const entries = await readdir(target, { withFileTypes: true })
        return entries.map(entry => ({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
        }))
      } catch (error) {
        ctx.logger.warn(`meta-registry: skill dir listing failed for "${id}" at ${target}: ${String(error)}`)
        return undefined
      }
    },

    async readSkillFile(id: string, relPath: string): Promise<string | undefined> {
      const root = await skillRootOf(id)
      if (root === undefined) return undefined
      const target = resolve(root, relPath)
      // Containment: the resolved path must stay inside the skill root.
      if (target !== root && !target.startsWith(`${root}${sep}`)) return undefined
      try {
        const info = await stat(target)
        if (!info.isFile()) return undefined
        const text = await readFile(target, 'utf8')
        // NUL marks binary content; do not surface it as a text preview.
        return text.includes('\0') ? undefined : text
      } catch (error) {
        ctx.logger.warn(`meta-registry: skill file read failed for "${id}" at ${target}: ${String(error)}`)
        return undefined
      }
    },

    size(): number {
      return toolRecords.size + skillRecords.size
    },

    catalogPath(): string | undefined {
      return catalogFile.length === 0 ? undefined : catalogFile
    },

    onDemandCount(): number {
      return onDemandCount
    },

    refresh(): Promise<void> {
      return refresh()
    },
  }

  // Observe tool results to write back objective stats. Nested dispatches
  // (parent set by meta_invoke) attribute to the target capability; the
  // meta_invoke wrapper itself records nothing for any capability.
  ctx.on('tools/result', (exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>) => {
    const name = exec.name
    const record = toolRecords.get(name)
    if (record === undefined) return
    // Nested dispatches (a meta_invoke call or a native-tool forward) carry the
    // target tool's own name, so stats always attribute to the target capability.
    const durationMs = result.meta !== undefined && typeof result.meta === 'object'
      && result.meta !== null && 'durationMs' in result.meta
      ? (result.meta as { durationMs?: unknown }).durationMs as number | undefined
      : undefined
    const base = statsOf(record)
    const next: CapabilityStats = {
      uses: base.uses + 1,
      successes: base.successes + (result.isError ? 0 : 1),
      failures: base.failures + (result.isError ? 1 : 0),
      totalMs: base.totalMs + (typeof durationMs === 'number' && Number.isFinite(durationMs) ? durationMs : 0),
      lastUsedAt: Date.now(),
    }
    toolRecords.set(name, { ...record, stats: next })
  })

  ctx.provide('capability', service)
}

/** Derive the server namespace from an `mcp__<server>__<raw>` name. */
export function serverNameOf(publicName: string): string {
  const rest = publicName.startsWith(MCP_ID_PREFIX) ? publicName.slice(MCP_ID_PREFIX.length) : publicName
  const index = rest.indexOf('__')
  return index === -1 ? rest : rest.slice(0, index)
}

/** Build the stable skill identifier `skill:<name>`. */
export function skillId(name: string): string {
  return `${SKILL_ID_PREFIX}${name}`
}

/** Strip the `skill:` prefix from a capability id. */
export function skillNameOf(id: string): string {
  return id.startsWith(SKILL_ID_PREFIX) ? id.slice(SKILL_ID_PREFIX.length) : id
}
