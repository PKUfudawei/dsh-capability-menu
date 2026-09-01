/**
 * Model-facing `meta_invoke` tool: unified execution/loading of capabilities.
 *
 * @module @daweifu/capability-menu (invoke plugin)
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import * as dshLlm from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

// The call-id brand was renamed across dsh releases: `ToolCallId` in
// dsh-llm ≤0.1.0-rc.x and ≥0.1.2-alpha, `CallId` in 0.1.1-rc.x. A static
// named import would throw SyntaxError at load on the mismatched version,
// so resolve whichever brand the resolved dsh-llm copy provides.
const CallId = ((dshLlm as { CallId?: unknown }).CallId
  ?? (dshLlm as { ToolCallId?: unknown }).ToolCallId) as typeof dshLlm.CallId
import type { ToolRunContext, JsonValue } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { isModelInvocable, renderSkillContent, type SkillDefinition, type SkillResourceBase, type SkillSource } from '@deepseek-ai/dsh-skill'
import { SKILL_ID_PREFIX, skillNameOf, type CapabilityRecord } from './registry.ts'

export const name = 'capability-menu-invoke'
export const inject = ['capability', 'tools', 'skills']

/** Forwarding mode for the MCP branch. */
export type MetaForwardMode = 'direct' | 'resolve'

/** Model-facing `meta_invoke` configuration. */
export interface Config {
  /** How to forward MCP calls: `direct` executes via the tool pipeline; `resolve` returns the schema for the model to call directly. */
  forwardMode?: MetaForwardMode
}

/** Validate and default the tool configuration. */
export const Config: z<Config> = z.object({
  forwardMode: z.union(['direct', 'resolve']).default('direct'),
})

/** Canonical MCP result shape. */
export interface MetaInvokeMcpDetail {
  readonly forwarded: true
  readonly target: string
  readonly content: ContentBlock[]
}

/** Canonical skill result shape (matches the `skill` tool output). */
export interface MetaInvokeSkillDetail {
  readonly name: string
  readonly provider: string
  readonly resourceBase?: SkillResourceBase
  readonly content: string
}

/** Canonical resolve-mode result shape (forwardMode: 'resolve'). */
export interface MetaInvokeResolveDetail {
  readonly target: string
  readonly kind: string
  readonly name: string
  readonly description: string
  readonly parameters: unknown
}

/** Discriminated canonical result. */
export type MetaInvokeResult =
  | { ok: true; kind: 'mcp'; id: string; detail: MetaInvokeMcpDetail }
  | { ok: true; kind: 'skill'; id: string; detail: MetaInvokeSkillDetail }
  | { ok: true; kind: 'resolve'; id: string; detail: MetaInvokeResolveDetail }

/**
 * Register the `meta_invoke` tool.
 *
 * Dispatch is by `capability.kind`, not by id prefix (the id-prefix check is
 * kept only as a defensive guard alongside the kind check).
 *
 * - Tools (`kind: 'tool'`, id `mcp__...`): forwards to the underlying server
 *   call via the official `ctx.tools.execute` pipeline, preserving
 *   `agent`/`signal`/parent lineage. `forwardMode: 'resolve'` instead returns
 *   the target schema so the model can call the tool directly.
 * - Skills (`kind: 'skill'`, id `skill:<name>`): loads the full skill
 *   instructions and returns them as `<skill_content>` — no args, no script
 *   execution (matches the existing `skill` tool semantics).
 */
export function apply(ctx: Context, config: Config = {}): void {
  const forwardMode = config.forwardMode ?? 'direct'
  if (forwardMode !== 'direct' && forwardMode !== 'resolve') {
    throw new Error(`forwardMode must be "direct" or "resolve", received "${String(forwardMode)}"`)
  }

  // Per-session dedup for loaded skills. Re-loading an already-injected skill
  // only returns a short reminder instead of re-injecting the full
  // instructions, saving tokens (mirrors synapse's `_loaded_skills`). Keyed by
  // the agent object so two sessions in the same process never share state; a
  // WeakMap lets entries be collected with the agent. Without an agent context
  // (headless dispatch) nothing is cached.
  const loadedSkills = new WeakMap<object, Set<string>>()

  /**
   * Load a Progressive skill's full body. Progressive skills are indexed from
   * the independent YAML catalog and may not be registered in `ctx.skills`; read
   * the catalog entry's `path` (SKILL.md) directly and strip frontmatter to
   * produce a `SkillDefinition`-compatible body.
   */
  const loadProgressiveSkill = async (
    name: string,
    capability: CapabilityRecord,
    signal: AbortSignal | undefined,
  ): Promise<SkillDefinition | undefined> => {
    // If the skill is registered globally, prefer the registry's parser.
    const registered = await ctx.skills.get(name, { signal }).catch(() => undefined)
    if (registered !== undefined) return registered
    const basePath = capability.origin.path
    if (basePath === undefined) return undefined
    const { readFile } = await import('node:fs/promises')
    const { resolve } = await import('node:path')
    const markdownPath = resolve(process.cwd(), basePath, 'SKILL.md')
    let text: string
    try {
      text = await readFile(markdownPath, 'utf8')
    } catch (error) {
      ctx.logger.warn(`meta_invoke: progressive skill "${name}" body not readable (${markdownPath}): ${String(error)}`)
      return undefined
    }
    const content = stripFrontmatter(text)
    return {
      name,
      description: capability.description,
      ...capability.whenToUse !== undefined ? { whenToUse: capability.whenToUse } : {},
      invocation: { modelInvocable: true, userInvocable: false },
      source: { type: 'local' } as unknown as SkillSource,
      provider: capability.origin.provider ?? 'progressive-catalog',
      ...capability.origin.path !== undefined ? { path: resolve(process.cwd(), capability.origin.path) } : {},
      resourceBase: { kind: 'directory', path: resolve(process.cwd(), basePath) },
      content,
    }
  }

  const tool = defineTool({
    name: 'meta_invoke',
    description: 'Execute a capability by its exact id (from meta_search), dispatching by capability kind. For tools (kind "tool", id starts with "mcp__"), forwards to the underlying server call with args. For skills (kind "skill", id starts with "skill:"), loads the full skill instructions and returns them as <skill_content> — no args needed.',
    parameters: {
      id: { type: 'string', required: true, description: 'Capability id from meta_search, e.g. mcp__gongfeng__create_issue or skill:frontend-design.' },
      args: { type: 'json', description: 'Arguments forwarded to a tool; ignored for skills.' },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', required: true, const: true },
              kind: { type: 'string', required: true, const: 'mcp' },
              id: { type: 'string', required: true },
              detail: {
                type: 'object',
                required: true,
                additionalProperties: false,
                properties: {
                  forwarded: { type: 'boolean', required: true, const: true },
                  target: { type: 'string', required: true },
                  content: { type: 'array', required: true, items: { type: 'json' } },
                },
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', required: true, const: true },
              kind: { type: 'string', required: true, const: 'skill' },
              id: { type: 'string', required: true },
              detail: {
                type: 'object',
                required: true,
                additionalProperties: false,
                properties: {
                  name: { type: 'string', required: true },
                  provider: { type: 'string', required: true },
                  resourceBase: { type: 'json' },
                  content: { type: 'string', required: true },
                },
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', required: true, const: true },
              kind: { type: 'string', required: true, const: 'resolve' },
              id: { type: 'string', required: true },
              detail: {
                type: 'object',
                required: true,
                additionalProperties: false,
                properties: {
                  target: { type: 'string', required: true },
                  kind: { type: 'string', required: true },
                  name: { type: 'string', required: true },
                  description: { type: 'string', required: true },
                  parameters: { type: 'json', required: true },
                },
              },
            },
          },
        ],
      },
      render: (_args, value) => {
        const result = value as MetaInvokeResult
        if (result.ok && result.kind === 'skill') {
          return [{ type: 'text', text: renderSkillContent(result.detail as unknown as MetaInvokeSkillDetail) }]
        }
        return [{ type: 'text', text: JSON.stringify(value) }]
      },
    },
    async execute(args: { id: string; args?: unknown }, exec: ToolRunContext) {
      const id = args.id.trim()
      // Blocked capabilities are a hard deny at the execution surface: the
      // registry keeps them indexed so the management UI can list them, but the
      // model can never reach a blocked capability through meta_invoke.
      const policy = ctx.get('capabilityPolicy')
      if (policy?.isBlockedCapability(id)) {
        throw new Error(`meta_invoke: capability "${id}" is blocked and cannot be invoked`)
      }
      const capability = ctx.capability.get(id)
      if (capability === undefined) {
        throw new Error(`meta_invoke: capability "${id}" is unknown or no longer available`)
      }

      // Tool: forward to the underlying MCP server call (or resolve its schema).
      if (capability.kind === 'tool' && id.startsWith('mcp__')) {
        // Resolve the definition on the GLOBAL view (no agent scope) so a
        // Progressive tool hidden from the caller's exposure is still addressable.
        const definition = ctx.tools.get(capability.name)
        if (definition === undefined) {
          throw new Error(`meta_invoke: tool "${capability.name}" is not available`)
        }
        if (forwardMode === 'resolve') {
          return {
            ok: true,
            kind: 'resolve' as const,
            id,
            detail: {
              target: capability.name,
              kind: 'tool' as const,
              name: definition.name,
              description: definition.description,
              parameters: definition.parameters as unknown as JsonValue,
            },
          }
        }
        // Nested execution through the official pipeline. The parent token marks
        // this as a transport sub-dispatch so code-mode collapse rules treat it
        // like a nested SDK call, and `tools/result` observers can attribute the
        // outcome to the target capability.
        // Do NOT pass `agent` — `ctx.tools.execute` resolves through the
        // caller's `view.visible`, so passing an agent whose projection hid the
        // Progressive tool would surface `UNKNOWN_TOOL`. Executing on the global view
        // keeps Progressive tools runnable; the target tool's own guards still apply
        // (no permission bypass — see README).
        const result = await ctx.tools.execute({
          callId: CallId(`${exec.callId}:meta:${id}`),
          name: capability.name,
          arguments: args.args,
          signal: exec.signal,
          parent: exec.token,
        })
        if (result.isError) {
          const message = result.content.map(block => block.type === 'text' ? block.text : `[${block.type} content]`).join('\n')
          throw new Error(message || `meta_invoke: ${capability.name} failed`)
        }
        return {
          ok: true,
          kind: 'mcp' as const,
          id,
          detail: {
            forwarded: true,
            target: capability.name,
            content: result.content as unknown as JsonValue[],
          },
        }
      }

      // Skill: load the full instructions.
      if (capability.kind === 'skill' && id.startsWith(SKILL_ID_PREFIX)) {
        const name = skillNameOf(id)

        // Per-session loaded set (see the WeakMap above); undefined when there
        // is no agent context, in which case nothing is deduped.
        const agent = exec.agent
        let sessionSkills: Set<string> | undefined
        if (agent !== undefined) {
          sessionSkills = loadedSkills.get(agent)
          if (sessionSkills === undefined) {
            sessionSkills = new Set<string>()
            loadedSkills.set(agent, sessionSkills)
          }
        }

        // Already loaded this session → return a short reminder, no re-injection.
        if (sessionSkills?.has(name) === true) {
          return {
            ok: true,
            kind: 'skill' as const,
            id,
            detail: {
              name,
              provider: capability.origin.provider,
              content: `Skill "${name}" is already loaded in this conversation. Read the <skill_content> above and follow it.`,
            },
          }
        }

        const lookup = {
          cwd: exec.agent?.session.header.cwd,
          signal: exec.signal,
          scope: exec.agent,
        }
        let skill = await ctx.skills.get(name, lookup).catch(() => undefined)
        // Progressive skills are indexed from the independent YAML catalog; they may
        // not be registered in the session skill registry. Fall back to reading
        // the catalog entry's path (or the catalog-provided name lookup) so the
        // full SKILL.md can still be loaded on demand.
        if (skill === undefined) {
          skill = await loadProgressiveSkill(name, capability, exec.signal)
        }
        if (skill === undefined) {
          throw new Error(`meta_invoke: skill "${name}" is unknown or no longer available`)
        }
        if (!isModelInvocable(skill)) {
          throw new Error(`meta_invoke: skill "${name}" is not available for model invocation`)
        }
        sessionSkills?.add(name)
        return {
          ok: true,
          kind: 'skill' as const,
          id,
          detail: {
            name: skill.name,
            provider: skill.provider,
            ...skill.resourceBase !== undefined ? { resourceBase: { ...skill.resourceBase } } : {},
            content: skill.content,
          },
        }
      }

      throw new Error(`meta_invoke: capability id "${id}" has an unrecognized kind`)
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: `Execute capability ${args.id}`,
        kind: args.id.startsWith('skill:') ? 'read' : 'other',
        rawInput: args.id,
      }
    },
  })

  ctx.tools.register(tool)
}

/**
 * Strip leading YAML frontmatter (`---\n...\n---`) from a raw SKILL.md body,
 * returning the remaining markdown. Falls back to the raw text when no
 * frontmatter delimiter is present.
 */
export function stripFrontmatter(markdown: string): string {
  const text = markdown.startsWith('\uFEFF') ? markdown.slice(1) : markdown
  if (!text.startsWith('---')) return text
  const end = text.indexOf('\n---', 3)
  if (end === -1) return text
  return text.slice(end + 4).replace(/^\n+/, '')
}

