/**
 * Model-facing `meta_invoke` tool: unified execution/loading of capabilities.
 *
 * @module @daweifu/capability-menu (invoke plugin)
 */
import z from '@deepseek-ai/schemastery';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { isModelInvocable, renderSkillContent } from '@deepseek-ai/dsh-skill';
import { MCP_ID_PREFIX } from "./registry.js";
export const name = 'capability-menu-invoke';
export const inject = ['capability', 'tools', 'skills'];
/** Validate and default the tool configuration. */
export const Config = z.object({
    forwardMode: z.union(['direct', 'resolve']).default('direct'),
});
/**
 * Register the `meta_invoke` tool.
 *
 * Dispatch is by the explicit `kind` argument (no id-prefix parsing).
 *
 * - Tools (`kind: 'tool'`, e.g. `mcp__gongfeng__create_issue` or a harness-native
 *   tool such as `bash`): forwards to the underlying tool call via the official
 *   `ctx.tools.execute` pipeline, preserving `agent`/`signal`/parent lineage.
 *   `forwardMode: 'resolve'` instead returns the target schema so the model can
 *   call the tool directly.
 * - Skills (`kind: 'skill'`, id is the bare skill name): loads the full skill
 *   instructions and returns them as `<skill_content>` — no args, no script
 *   execution (matches the existing `skill` tool semantics).
 */
export function apply(ctx, config = {}) {
    const forwardMode = config.forwardMode ?? 'direct';
    if (forwardMode !== 'direct' && forwardMode !== 'resolve') {
        throw new Error(`forwardMode must be "direct" or "resolve", received "${String(forwardMode)}"`);
    }
    // Per-session dedup for loaded skills. Re-loading an already-injected skill
    // only returns a short reminder instead of re-injecting the full
    // instructions, saving tokens (mirrors synapse's `_loaded_skills`). Keyed by
    // the agent object so two sessions in the same process never share state; a
    // WeakMap lets entries be collected with the agent. Without an agent context
    // (headless dispatch) nothing is cached.
    const loadedSkills = new WeakMap();
    const tool = defineTool({
        name: 'meta_invoke',
        description: 'Execute a capability by its exact id (from meta_search) and kind. For tools (kind "tool", e.g. mcp__gongfeng__create_issue or a native tool such as bash), forwards to the underlying tool call with args. For skills (kind "skill", e.g. frontend-design), loads the full skill instructions and returns them as <skill_content> — no args needed. Always pass the same kind the search result reported.',
        parameters: {
            id: { type: 'string', required: true, description: 'Capability id from meta_search, e.g. mcp__gongfeng__create_issue or frontend-design.' },
            kind: { type: 'string', enum: ['tool', 'skill'], required: true, description: 'Capability kind reported by meta_search for this id.' },
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
                const result = value;
                if (result.ok && result.kind === 'skill') {
                    return [{ type: 'text', text: renderSkillContent(result.detail) }];
                }
                return [{ type: 'text', text: JSON.stringify(value) }];
            },
        },
        async execute(args, exec) {
            const id = args.id.trim();
            const kind = args.kind;
            if (kind !== 'tool' && kind !== 'skill') {
                throw new Error('meta_invoke: kind must be "tool" or "skill" (the kind meta_search reported for this id)');
            }
            const capability = ctx.capability.get(id, kind);
            if (capability === undefined) {
                throw new Error(`meta_invoke: no ${kind} capability "${id}" is available`);
            }
            // Disabled capabilities are a hard deny at the execution surface: the
            // registry keeps them indexed so the management UI can list them, but the
            // model can never reach a disabled capability through meta_invoke.
            const policy = ctx.get('capabilityPolicy');
            if (policy?.isDisabledCapability(id, kind)) {
                throw new Error(`meta_invoke: ${kind} capability "${id}" is disabled and cannot be invoked`);
            }
            // Tool: forward to the underlying tool execution (an MCP server call or a
            // harness-native tool cataloged under the built-in server) — or resolve its
            // schema.
            if (capability.kind === 'tool') {
                // Resolve the definition on the GLOBAL view (no agent scope) so a
                // tool hidden from the caller's exposure (On-demand) is still addressable.
                // Native tools cataloged from a preset standing scope live on the agent
                // plane and are invisible to the global view; for those, fall back to the
                // caller's own view (the agent joining the preset standing mount).
                const native = !capability.name.startsWith(MCP_ID_PREFIX);
                let definition = ctx.tools.get(capability.name);
                const nativeCallerView = native && definition === undefined ? exec.agent : undefined;
                if (definition === undefined && nativeCallerView !== undefined) {
                    definition = ctx.tools.get(capability.name, nativeCallerView);
                }
                if (definition === undefined) {
                    throw new Error(`meta_invoke: tool "${capability.name}" is not available`);
                }
                if (forwardMode === 'resolve') {
                    return {
                        ok: true,
                        kind: 'resolve',
                        id,
                        detail: {
                            target: capability.name,
                            kind: 'tool',
                            name: definition.name,
                            description: definition.description,
                            parameters: definition.parameters,
                        },
                    };
                }
                // Nested execution through the official pipeline. The parent token marks
                // this as a transport sub-dispatch so code-mode collapse rules treat it
                // like a nested SDK call, and `tools/result` observers can attribute the
                // outcome to the target capability.
                // Do NOT pass `agent` for MCP tools — `ctx.tools.execute` resolves through
                // the caller's `view.visible`, so passing an agent whose projection hid the
                // Progressive tool would surface `UNKNOWN_TOOL`. Executing on the global view
                // keeps Progressive tools runnable; the target tool's own guards still apply
                // (no permission bypass — see README). A native tool reachable only through
                // the caller's view does pass that view, mirroring the direct-call surface.
                const result = await ctx.tools.execute({
                    callId: ToolCallId(`${exec.callId}:meta:${id}`),
                    name: capability.name,
                    arguments: args.args,
                    signal: exec.signal,
                    parent: exec.token,
                    ...nativeCallerView !== undefined ? { agent: nativeCallerView } : {},
                });
                if (result.isError) {
                    const message = result.content.map(block => block.type === 'text' ? block.text : `[${block.type} content]`).join('\n');
                    throw new Error(message || `meta_invoke: ${capability.name} failed`);
                }
                return {
                    ok: true,
                    kind: 'mcp',
                    id,
                    detail: {
                        forwarded: true,
                        target: capability.name,
                        content: result.content,
                    },
                };
            }
            // Skill: load the full instructions.
            if (capability.kind === 'skill') {
                const name = capability.name;
                // Per-session loaded set (see the WeakMap above); undefined when there
                // is no agent context, in which case nothing is deduped.
                const agent = exec.agent;
                let sessionSkills;
                if (agent !== undefined) {
                    sessionSkills = loadedSkills.get(agent);
                    if (sessionSkills === undefined) {
                        sessionSkills = new Set();
                        loadedSkills.set(agent, sessionSkills);
                    }
                }
                // Already loaded this session → return a short reminder, no re-injection.
                if (sessionSkills?.has(name) === true) {
                    return {
                        ok: true,
                        kind: 'skill',
                        id,
                        detail: {
                            name,
                            provider: capability.origin.provider,
                            content: `Skill "${name}" is already loaded in this conversation. Read the <skill_content> above and follow it.`,
                        },
                    };
                }
                const lookup = {
                    cwd: exec.agent?.session.header.cwd,
                    signal: exec.signal,
                    scope: exec.agent,
                };
                const skill = await ctx.skills.get(name, lookup).catch(() => undefined);
                if (skill === undefined) {
                    throw new Error(`meta_invoke: skill "${name}" is unknown or no longer available`);
                }
                if (!isModelInvocable(skill)) {
                    throw new Error(`meta_invoke: skill "${name}" is not available for model invocation`);
                }
                sessionSkills?.add(name);
                return {
                    ok: true,
                    kind: 'skill',
                    id,
                    detail: {
                        name: skill.name,
                        provider: skill.provider,
                        ...skill.resourceBase !== undefined ? { resourceBase: { ...skill.resourceBase } } : {},
                        content: skill.content,
                    },
                };
            }
            throw new Error(`meta_invoke: capability id "${id}" has an unrecognized kind`);
        },
        presentCall(args) {
            return {
                card: 'generic',
                title: `Execute capability ${args.id}`,
                kind: args.kind === 'skill' ? 'read' : 'other',
                rawInput: args.id,
            };
        },
    });
    ctx.tools.register(tool);
}
//# sourceMappingURL=invoke.js.map