/**
 * Model-facing `meta_search` tool: capability catalog search + detail.
 *
 * @module @daweifu/capability-menu (search plugin)
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { CapabilityDetail, CapabilitySummary } from './registry.ts'

export const name = 'capability-menu-search'
export const inject = ['capability', 'tools', 'skills']
const MAX_SEARCH_RESULTS = 100

/** Model-facing `meta_search` configuration. */
export interface Config {
  /** Maximum results returned in list mode (default 20). */
  maxResults?: number
}

/** Validate and default the tool configuration. */
export const Config: z<Config> = z.object({
  maxResults: z.number().default(20),
})

/** Canonical list-mode result. */
export interface MetaSearchListResult {
  readonly mode: 'list'
  /** Matching On-demand capabilities in the caller scope, before truncation. */
  readonly total: number
  readonly returned: number
  readonly truncated: boolean
  readonly results: CapabilitySummary[]
  readonly hint: string
}

/** Canonical detail-mode result. */
export interface MetaSearchDetailResult {
  readonly mode: 'detail'
  readonly result: CapabilityDetail
}

/** Canonical tool result: one of the two modes. */
export type MetaSearchResult = MetaSearchListResult | MetaSearchDetailResult

/**
 * Register the `meta_search` tool.
 *
 * - Mode A (list, default): search by keyword/tag/server and return a bounded candidate list.
 * - Mode B (detail): pass a candidate's exact id to inspect its full description and tool schema or Skill usage guidance before invocation.
 *
 * Validation rules enforced here:
 * - `query` and `id` are mutually exclusive.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const maxResults = config.maxResults ?? 20
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_SEARCH_RESULTS) {
    throw new Error(`maxResults must be an integer from 1 to ${MAX_SEARCH_RESULTS}`)
  }

  const tool = defineTool({
    name: 'meta_search',
    description: 'Find an On-demand capability id by keyword/tag/source, then call meta_search with the exact id and kind to inspect its full tool parameter schema before meta_invoke. Exact id returns detail; list mode returns up to max_results matches without pagination.',
    parameters: {
      query: { type: 'string', description: 'Natural-language or keyword query; mutually exclusive with id.' },
      id: { type: 'string', description: 'Exact capability id (from a previous search results[].id); mutually exclusive with query, takes precedence.' },
      kind: { type: 'string', enum: ['tool', 'skill', 'all'], description: 'Filter by capability kind (default all).' },
      server: { type: 'string', description: 'Filter by server name — an MCP server (gongfeng/iwiki/km/zhiyan_qci) or the reserved built-in pseudo-server grouping harness-native tools.' },
      tag: { type: 'string', description: 'Filter by tag.' },
      max_results: { type: 'integer', description: 'Maximum results in list mode (default 20, max 100); refine query if truncated.' },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              mode: { type: 'string', required: true, const: 'list' },
              total: { type: 'integer', required: true },
              returned: { type: 'integer', required: true },
              truncated: { type: 'boolean', required: true },
              results: { type: 'array', required: true, items: { type: 'json' } },
              hint: { type: 'string', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              mode: { type: 'string', required: true, const: 'detail' },
              result: { type: 'json', required: true },
            },
          },
        ],
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args: {
      query?: string
      id?: string
      kind?: 'tool' | 'skill' | 'all'
      server?: string
      tag?: string
      max_results?: number
    }, exec: ToolRunContext) {
      const query = args.query?.trim() ?? ''
      const id = args.id?.trim() ?? ''
      const kind = args.kind ?? 'all'
      const server = args.server?.trim() || undefined
      const tag = args.tag?.trim() || undefined
      const requestedMax = args.max_results
      if (requestedMax !== undefined && (!Number.isInteger(requestedMax) || requestedMax < 1 || requestedMax > MAX_SEARCH_RESULTS)) {
        throw new Error(`meta_search: max_results must be an integer from 1 to ${MAX_SEARCH_RESULTS}`)
      }

      if (query.length > 0 && id.length > 0) {
        throw new Error('meta_search: query and id are mutually exclusive; pass exactly one')
      }

      const scope = exec.agent
      const context = {
        cwd: exec.agent?.session.header.cwd,
        signal: exec.signal,
        scope,
      }
      const allowedIds = new Set<string>()
      for (const schema of ctx.tools.schemas(scope)) allowedIds.add(schema.name)
      for (const skill of await ctx.skills.list({ scope, cwd: context.cwd })) allowedIds.add(skill.name)
      // The registry keeps every tier for management. Model search exposes
      // only On-demand capabilities in the current session.
      const policy = ctx.get('capabilityPolicy')
      const isOnDemand = (capId: string, capKind: 'tool' | 'skill'): boolean =>
        policy?.classifyCapability(capId, capKind) === 'on-demand'
      // The kind filter doubles as a disambiguator for exact-id lookups.
      const kindArg = kind === 'all' || kind === undefined ? undefined : kind

      if (id.length > 0) {
        const resolved = ctx.capability.get(id, kindArg)
        if (resolved === undefined) {
          throw new Error(`meta_search: capability "${id}" is unknown, unavailable, or ambiguous — pass kind: "tool" | "skill" when both exist`)
        }
        if (!allowedIds.has(id)) throw new Error(`meta_search: capability "${id}" is not available in the current session scope`)
        if (!isOnDemand(id, resolved.kind)) {
          throw new Error(`meta_search: capability "${id}" is not On-demand and cannot be inspected`)
        }
        const result = await ctx.capability.getDetail(id, resolved.kind, context)
        if (result === undefined) {
          throw new Error(`meta_search: capability "${id}" is unknown or no longer available`)
        }
        return { mode: 'detail' as const, result: result as unknown as JsonValue }
      }

      // Filter by tier and caller scope before applying the model-facing limit.
      // The registry ranks the whole index and imposes no upper bound.
      const limit = requestedMax ?? maxResults
      const matches = ctx.capability.search({
        query,
        kind,
        server,
        tag,
        maxResults: Number.MAX_SAFE_INTEGER,
        scope,
      })
        .filter(result => allowedIds.has(result.id) && isOnDemand(result.id, result.kind))
      const results = matches.slice(0, limit)
      const truncated = results.length < matches.length
      return {
        mode: 'list' as const,
        total: matches.length,
        returned: results.length,
        truncated,
        results: results as unknown as JsonValue[],
        hint: truncated
          ? 'Results were truncated. Refine query, kind, server, or tag to narrow the search; then call meta_search({id, kind}) for the full schema before meta_invoke({id, kind, args}).'
          : 'Use a result id from this meta_search list, then call meta_search({id, kind}) for the full schema before meta_invoke({id, kind, args}).',
      }
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: args.id !== undefined ? `Inspect capability ${args.id}` : `Search capabilities${args.query ? `: ${args.query}` : ''}`,
        kind: 'read',
        rawInput: args.id ?? args.query ?? '',
      }
    },
  })

  ctx.tools.register(tool)
}
