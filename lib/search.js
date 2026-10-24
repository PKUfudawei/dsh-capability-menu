/**
 * Model-facing `meta_search` tool: capability catalog search + detail.
 *
 * @module @daweifu/capability-menu (search plugin)
 */
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
export const name = 'capability-menu-search';
export const inject = ['capability', 'tools', 'skills'];
/** Validate and default the tool configuration. */
export const Config = z.object({
    maxResults: z.number().default(20),
});
/**
 * Register the `meta_search` tool.
 *
 * - Mode A (list, default): search by keyword/tag/server and return a paginated candidate list.
 * - Mode B (detail): pass a candidate's exact id to inspect its full description and tool schema or Skill usage guidance before invocation.
 *
 * Validation rules enforced here:
 * - `query` and `id` are mutually exclusive.
 */
export function apply(ctx, config = {}) {
    const maxResults = config.maxResults ?? 20;
    if (!Number.isInteger(maxResults) || maxResults < 1) {
        throw new Error('maxResults must be a positive integer');
    }
    const tool = defineTool({
        name: 'meta_search',
        description: 'Find a capability id by keyword/tag/source, then call meta_search with the exact id and kind to inspect its full tool parameter schema before meta_invoke. Exact id returns detail; list mode supports offset pagination.',
        parameters: {
            query: { type: 'string', description: 'Natural-language or keyword query; mutually exclusive with id.' },
            id: { type: 'string', description: 'Exact capability id (from a previous search results[].id); mutually exclusive with query, takes precedence.' },
            kind: { type: 'string', enum: ['tool', 'skill', 'all'], description: 'Filter by capability kind (default all).' },
            server: { type: 'string', description: 'Filter by server name — an MCP server (gongfeng/iwiki/km/zhiyan_qci) or the reserved built-in pseudo-server grouping harness-native tools.' },
            tag: { type: 'string', description: 'Filter by tag.' },
            max_results: { type: 'integer', description: 'Maximum results in list mode (default 20, max 50).' },
            offset: { type: 'integer', description: 'Zero-based result offset for pagination (default 0).' },
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
                            offset: { type: 'integer', required: true },
                            has_more: { type: 'boolean', required: true },
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
        async execute(args, exec) {
            const query = args.query?.trim() ?? '';
            const id = args.id?.trim() ?? '';
            const kind = args.kind ?? 'all';
            const server = args.server?.trim() || undefined;
            const tag = args.tag?.trim() || undefined;
            const requestedMax = args.max_results;
            const offset = args.offset ?? 0;
            if (!Number.isInteger(offset) || offset < 0)
                throw new Error('meta_search: offset must be a non-negative integer');
            if (requestedMax !== undefined && (!Number.isInteger(requestedMax) || requestedMax < 1)) {
                throw new Error('meta_search: max_results must be a positive integer');
            }
            if (query.length > 0 && id.length > 0) {
                throw new Error('meta_search: query and id are mutually exclusive; pass exactly one');
            }
            const scope = exec.agent;
            const context = {
                cwd: exec.agent?.session.header.cwd,
                signal: exec.signal,
                scope,
            };
            const allowedIds = new Set();
            for (const schema of ctx.tools.schemas(scope))
                allowedIds.add(schema.name);
            for (const skill of await ctx.skills.list({ scope, cwd: context.cwd }))
                allowedIds.add(skill.name);
            // Disabled capabilities are not discoverable: the registry keeps them
            // indexed for the management surface, but meta_search never surfaces
            // them to the model.
            const policy = ctx.get('capabilityPolicy');
            const isDisabled = (capId, capKind) => policy?.isDisabledCapability(capId, capKind) ?? false;
            // The kind filter doubles as a disambiguator for exact-id lookups.
            const kindArg = kind === 'all' || kind === undefined ? undefined : kind;
            if (id.length > 0) {
                const resolved = ctx.capability.get(id, kindArg);
                if (resolved === undefined) {
                    throw new Error(`meta_search: capability "${id}" is unknown, unavailable, or ambiguous — pass kind: "tool" | "skill" when both exist`);
                }
                if (!allowedIds.has(id))
                    throw new Error(`meta_search: capability "${id}" is not available in the current session scope`);
                if (isDisabled(id, resolved.kind)) {
                    throw new Error(`meta_search: capability "${id}" is disabled and cannot be inspected`);
                }
                const result = await ctx.capability.getDetail(id, resolved.kind, context);
                if (result === undefined) {
                    throw new Error(`meta_search: capability "${id}" is unknown or no longer available`);
                }
                return { mode: 'detail', result: result };
            }
            // Filter Disabled BEFORE applying the result cap: a Disabled hit inside
            // the top-N would otherwise consume a slot and hide a matching Resident
            // capability ranked below it (the extreme case being an all-Disabled
            // top-N returning nothing). Over-fetch — the registry imposes no upper
            // bound and already ranks the whole catalog — then slice.
            const limit = Math.min(requestedMax ?? maxResults, 50);
            const matches = ctx.capability.search({
                query,
                kind,
                server,
                tag,
                maxResults: Number.MAX_SAFE_INTEGER,
                scope,
            })
                .filter(result => allowedIds.has(result.id) && !isDisabled(result.id, result.kind));
            const results = matches.slice(offset, offset + limit);
            const catalogPath = ctx.capability.catalogPath?.();
            return {
                mode: 'list',
                total: matches.length,
                returned: results.length,
                offset,
                has_more: offset + results.length < matches.length,
                results: results,
                hint: catalogPath !== undefined
                    ? `Use a result id from this meta_search list, then call meta_search({id, kind}) for the full schema before meta_invoke({id, kind, args}). Optional YAML catalog: ${catalogPath}.`
                    : 'Use a result id from this meta_search list, then call meta_search({id, kind}) for the full schema before meta_invoke({id, kind, args}).',
            };
        },
        presentCall(args) {
            return {
                card: 'generic',
                title: args.id !== undefined ? `Inspect capability ${args.id}` : `Search capabilities${args.query ? `: ${args.query}` : ''}`,
                kind: 'read',
                rawInput: args.id ?? args.query ?? '',
            };
        },
    });
    ctx.tools.register(tool);
}
//# sourceMappingURL=search.js.map