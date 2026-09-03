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
  readonly total: number
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
 * - Mode A (list, default): query by keyword/tag/server, returns id + short summary.
 * - Mode B (detail): pass an exact id (optionally `detail: true`) to get the full schema.
 *
 * Validation rules enforced here:
 * - `query` and `id` are mutually exclusive.
 * - `detail: true` with a fuzzy query (no exact id) is rejected.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const maxResults = config.maxResults ?? 20
  if (!Number.isInteger(maxResults) || maxResults < 1) {
    throw new Error('maxResults must be a positive integer')
  }

  const tool = defineTool({
    name: 'meta_search',
    description: 'Search capabilities (tools and skills) by keyword/tag/source, or get full detail for one capability by exact id. Mode A (list, default): returns id + short summary for each hit. Mode B (detail): pass an exact id (optionally detail:true) to get the full schema/description. Use meta_invoke with a returned id to run/load the capability.',
    parameters: {
      query: { type: 'string', description: 'Natural-language or keyword query; mutually exclusive with id.' },
      id: { type: 'string', description: 'Exact capability id (from a previous search results[].id); mutually exclusive with query, takes precedence.' },
      detail: { type: 'boolean', description: 'When true, returns the single capability full schema; only meaningful with an exact id.' },
      kind: { type: 'string', enum: ['tool', 'skill', 'all'], description: 'Filter by capability kind (default all).' },
      server: { type: 'string', description: 'Filter by server name — an MCP server (gongfeng/iwiki/km/zhiyan_qci) or the reserved built-in pseudo-server grouping harness-native tools.' },
      tag: { type: 'string', description: 'Filter by tag.' },
      max_results: { type: 'integer', description: 'Maximum results in list mode (default 20, max 50).' },
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
      detail?: boolean
      kind?: 'tool' | 'skill' | 'all'
      server?: string
      tag?: string
      max_results?: number
    }, exec: ToolRunContext) {
      const query = args.query?.trim() ?? ''
      const id = args.id?.trim() ?? ''
      const detail = args.detail === true
      const kind = args.kind ?? 'all'
      const server = args.server?.trim() || undefined
      const tag = args.tag?.trim() || undefined
      const requestedMax = args.max_results

      if (query.length > 0 && id.length > 0) {
        throw new Error('meta_search: query and id are mutually exclusive; pass exactly one')
      }
      if (detail && id.length === 0) {
        throw new Error('meta_search: detail:true requires an exact id; pass id to get the full schema of one capability')
      }

      const scope = exec.agent
      const context = {
        cwd: exec.agent?.session.header.cwd,
        signal: exec.signal,
        scope,
      }
      // Blocked capabilities are not discoverable: the registry keeps them
      // indexed for the management surface, but meta_search never surfaces
      // them to the model.
      const policy = ctx.get('capabilityPolicy')
      const isBlocked = (id: string): boolean => policy?.isBlockedCapability(id) ?? false

      if (id.length > 0) {
        if (isBlocked(id)) {
          throw new Error(`meta_search: capability "${id}" is blocked and cannot be inspected`)
        }
        const result = await ctx.capability.getDetail(id, context)
        if (result === undefined) {
          throw new Error(`meta_search: capability "${id}" is unknown or no longer available`)
        }
        return { mode: 'detail' as const, result: result as unknown as JsonValue }
      }

      const results = ctx.capability.search({
        query,
        kind,
        server,
        tag,
        maxResults: Math.min(requestedMax ?? maxResults, 50),
        scope,
      }).filter(result => !isBlocked(result.id))
      const catalogPath = ctx.capability.catalogPath?.()
      return {
        mode: 'list' as const,
        total: results.length,
        results: results as unknown as JsonValue[],
        hint: catalogPath !== undefined
          ? `On-demand capabilities catalog: ${catalogPath} (YAML, grep/read searchable). Call meta_search with an exact id for full schema, or meta_invoke to run/load it.`
          : 'Call meta_search with an exact id for full schema, or meta_invoke to run/load it.',
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
