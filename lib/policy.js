/**
 * Exposed / Progressive / Blocked capability projection policy for the DeepSeek
 * Harness.
 *
 * @module @daweifu/capability-menu (policy plugin)
 */
import z from '@deepseek-ai/schemastery';
import { escapeText } from '@deepseek-ai/dsh-skill';
import { serverNameOf } from "./registry.js";
/** Validate and default the policy configuration. */
export const Config = z.object({
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
});
export const DEFAULT_META_TOOLS = ['meta_search', 'meta_invoke'];
/**
 * Convert a user-facing rule string into a normalized {@link PolicyRule}.
 * - `server:<name>` → server-targeted rule (`target: 'server'`).
 * - `server:<name>:*` → server-targeted glob over that server's tools.
 * - contains `*` → glob (target `id`).
 * - otherwise → literal exact name.
 */
export function parseRule(rule) {
    const trimmed = rule.trim();
    const serverPrefix = 'server:';
    if (trimmed.startsWith(serverPrefix)) {
        const rest = trimmed.slice(serverPrefix.length);
        // `server:<name>:*` → glob over the whole server.
        if (rest.endsWith(':*')) {
            return { wildcard: true, pattern: rest.slice(0, -2), target: 'server', kind: 'tool' };
        }
        return { wildcard: false, pattern: rest, target: 'server', kind: 'tool' };
    }
    return {
        wildcard: trimmed.includes('*'),
        pattern: trimmed,
        target: 'id',
    };
}
/** Compile a `*`-glob into a RegExp (escaped, `*` → `.*`). */
export function compileGlob(pattern) {
    const escaped = pattern
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\\\*/g, '.*');
    return new RegExp(`^${escaped}$`);
}
/** Compile a {@link CapabilitySetConfig} into fast-matchable rules. */
export function compileSet(set = {}) {
    return {
        exposed: (set.exposed ?? []).map(parseRule),
        progressive: (set.progressive ?? []).map(parseRule),
        blocked: (set.blocked ?? []).map(parseRule),
    };
}
function ruleMatches(rule, target) {
    if (rule.kind !== undefined && rule.kind !== target.ruleKind)
        return false;
    if (rule.target === 'id') {
        if (!rule.wildcard) {
            // An exact rule matches the full id OR the bare name (e.g. `debugging`
            // matches `skill:debugging`, `bash` matches the harness-native tool
            // `bash` whose public name is its bare name).
            return rule.pattern === target.id || rule.pattern === target.name;
        }
        return compileGlob(rule.pattern).test(target.id);
    }
    // server-targeted
    if (target.server === undefined)
        return false;
    if (!rule.wildcard)
        return rule.pattern === target.server;
    return compileGlob(rule.pattern).test(target.server);
}
/**
 * Classify a capability against compiled rules. Priority (hit stops the walk):
 * blocked-exact > blocked-wildcard > exposed-exact > progressive-exact >
 * exposed-wildcard > progressive-wildcard > default (exposed). `blocked` is a
 * control decision, so it beats an explicit `exposed` rule. Within
 * exposed/progressive an exact name beats a wildcard, so the management UI can
 * pin a single capability to a class even when a broader wildcard rule says
 * otherwise (e.g. `tools.exposed: ['mcp__gongfeng__*']` must not silently win
 * over an explicit per-tool `progressive` rule).
 */
export function classify(compiled, target, metaTools = DEFAULT_META_TOOLS) {
    const meta = metaTools instanceof Set ? metaTools : new Set(metaTools);
    const id = target.id;
    // metaTools can never be Progressive/Blocked for tools.
    if (target.kind === 'tool' && meta.has(id))
        return 'exposed';
    for (const rule of compiled.blocked) {
        if (!rule.wildcard && ruleMatches(rule, target))
            return 'blocked';
    }
    for (const rule of compiled.blocked) {
        if (rule.wildcard && ruleMatches(rule, target))
            return 'blocked';
    }
    for (const rule of compiled.exposed) {
        if (!rule.wildcard && ruleMatches(rule, target))
            return 'exposed';
    }
    for (const rule of compiled.progressive) {
        if (!rule.wildcard && ruleMatches(rule, target))
            return 'progressive';
    }
    for (const rule of compiled.exposed) {
        if (rule.wildcard && ruleMatches(rule, target))
            return 'exposed';
    }
    for (const rule of compiled.progressive) {
        if (rule.wildcard && ruleMatches(rule, target))
            return 'progressive';
    }
    return 'exposed';
}
/** True when any rule in the list matches the target (used for fail-loud validation). */
function anyRuleMatches(rules, target) {
    return rules.some(rule => ruleMatches(rule, target));
}
const CLASS_LABELS = {
    exposed: 'Exposed · 常驻（直接调用）',
    progressive: 'Progressive · 按需（目录渐进加载）',
    blocked: 'Blocked · 禁用',
};
/**
 * Build the projection listener for one assembly: keep only Exposed tools plus
 * the mandatory meta tools.
 */
export function projectAssemblyTools(assembly, service) {
    const kept = assembly.tools.filter(tool => service.isExposedTool(tool.name));
    if (kept.length === assembly.tools.length)
        return assembly;
    return { ...assembly, tools: kept };
}
/** Build the policy plugin. */
export const name = 'capability-menu-policy';
// The policy needs `capability` (the registry sibling) for classifyAll(); `tools` /
// `skills` are injected purely for startup ordering — projection itself runs on
// the `system-prompt/assemble` chain, not through the registries. The bundle
// mounts registry before policy, so `capability` is always available in practice.
export const inject = ['capability', 'tools', 'skills'];
export function apply(ctx, config = {}) {
    // Mutable runtime state so the management surface (能力菜单) can live-update
    // the policy without a reload.
    let current = { ...config };
    let metaTools = [...(config.metaTools ?? DEFAULT_META_TOOLS)];
    let metaToolSet = new Set(metaTools);
    let toolCompiled;
    let skillCompiled;
    const recompile = () => {
        const toolRules = compileSet(current.tools);
        const skillRules = compileSet(current.skills);
        // Normalize tool/skill rule kinds for matching.
        toolCompiled = {
            exposed: toolRules.exposed.map(rule => ({ ...rule, kind: 'tool' })),
            progressive: toolRules.progressive.map(rule => ({ ...rule, kind: 'tool' })),
            blocked: toolRules.blocked.map(rule => ({ ...rule, kind: 'tool' })),
        };
        skillCompiled = {
            exposed: skillRules.exposed.map(rule => ({ ...rule, kind: 'skill' })),
            progressive: skillRules.progressive.map(rule => ({ ...rule, kind: 'skill' })),
            blocked: skillRules.blocked.map(rule => ({ ...rule, kind: 'skill' })),
        };
        // Meta tools are the control-plane escape hatch: blocking one is a
        // misconfiguration that must fail loud, never silently disable the surface.
        for (const name of metaTools) {
            const target = { id: name, name, server: serverNameOf(name), kind: 'tool', ruleKind: 'tool' };
            if (anyRuleMatches(toolCompiled.blocked, target)) {
                throw new Error(`meta tool "${name}" cannot be blocked; remove it from tools.blocked`);
            }
        }
    };
    recompile();
    const service = {
        classifyTool(name) {
            const server = serverNameOf(name);
            return classify(toolCompiled, { id: name, name, server, kind: 'tool', ruleKind: 'tool' }, metaToolSet);
        },
        classifySkill(name) {
            return classify(skillCompiled, { id: `skill:${name}`, name, kind: 'skill', ruleKind: 'skill' }, new Set());
        },
        classifyCapability(id) {
            if (id.startsWith('skill:'))
                return service.classifySkill(id.slice('skill:'.length));
            return service.classifyTool(id);
        },
        isExposedTool(name) {
            return service.classifyTool(name) === 'exposed';
        },
        isExposedSkill(name) {
            return service.classifySkill(name) === 'exposed';
        },
        isProgressiveTool(name) {
            return service.classifyTool(name) === 'progressive';
        },
        isProgressiveSkill(name) {
            return service.classifySkill(name) === 'progressive';
        },
        isBlockedTool(name) {
            return service.classifyTool(name) === 'blocked';
        },
        isBlockedSkill(name) {
            return service.classifySkill(name) === 'blocked';
        },
        isBlockedCapability(id) {
            return service.classifyCapability(id) === 'blocked';
        },
        metaTools() {
            return metaTools;
        },
        toolRules() {
            return toolCompiled;
        },
        skillRules() {
            return skillCompiled;
        },
        getConfig() {
            return { ...current };
        },
        updateConfig(partial) {
            current = { ...current, ...partial };
            if (partial.metaTools !== undefined) {
                metaTools = [...(partial.metaTools ?? DEFAULT_META_TOOLS)];
                metaToolSet = new Set(metaTools);
            }
            recompile();
        },
        classifyAll() {
            // The registry default maxResults (20) would truncate the management
            // surface: enumerate every indexed capability, not just the top-20.
            return ctx.capability.search({ maxResults: Number.MAX_SAFE_INTEGER }).map(summary => {
                const cls = service.classifyCapability(summary.id);
                const mandatory = summary.kind === 'tool' && metaToolSet.has(summary.id);
                return {
                    id: summary.id,
                    kind: summary.kind,
                    name: summary.name,
                    ...summary.server !== undefined ? { server: summary.server } : {},
                    class: cls,
                    classLabel: CLASS_LABELS[cls],
                    mandatory,
                };
            });
        },
    };
    // Blocked capabilities are a hard deny at the execution surface, not just a
    // projection concern: a hallucinated direct call to a blocked tool (or to the
    // `skill` loader for a blocked skill) must never reach the underlying server.
    // Progressive tools stay executable — meta_invoke forwards through this same
    // pipeline, so only Blocked is rejected here.
    ctx.on('tools/pre-execute', async (exec, next) => {
        if (service.isBlockedTool(exec.name)) {
            return { kind: 'deny', reason: `capability "${exec.name}" is blocked and cannot be executed` };
        }
        if (exec.name === 'skill') {
            const args = exec.arguments;
            const name = typeof args?.name === 'string' ? args.name : '';
            if (name.length > 0 && service.isBlockedSkill(name)) {
                return { kind: 'deny', reason: `skill "${name}" is blocked and cannot be loaded` };
            }
        }
        return next();
    });
    // Progressive/Blocked skills must not appear in the model-facing
    // `<available_skills>` catalog injected by `dsh-tool-skill`. The catalog is a
    // user-role message whose `source.kind === 'skill-catalog'`; rewrite it every
    // pre-step to keep only Exposed skills. dsh-tool-skill republishes the full
    // catalog earlier on the same chain, so this filter is idempotent: whatever
    // it publishes, only the Exposed subset reaches the model.
    ctx.on('agent/pre-step', async (_payload, next) => {
        const decision = await next();
        if (decision.kind !== 'enter')
            return decision;
        let changed = false;
        const messages = decision.messages.map(message => {
            const source = message.source;
            if (source.kind !== 'skill-catalog')
                return message;
            const entries = Array.isArray(source.entries)
                ? source.entries.filter((entry) => typeof entry === 'object' && entry !== null && typeof entry.name === 'string')
                : [];
            const kept = entries
                .filter(entry => service.isExposedSkill(entry.name))
                .map(entry => ({ name: entry.name, description: entry.description ?? '' }));
            if (kept.length === entries.length)
                return message;
            changed = true;
            return {
                ...message,
                content: [{ type: 'text', text: renderSkillCatalog(kept) }],
                source: { ...message.source, entries: kept },
            };
        });
        if (!changed)
            return decision;
        return { ...decision, messages };
    });
    // Project the model-visible tool list, then append a one-line pointer to the
    // on-demand (Progressive) catalog so the model knows it exists without having
    // to "think of" meta_search first. Skills keep the dsh-native catalog, but
    // filtered to Exposed by the `agent/pre-step` hook above.
    ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
        const resolved = await next();
        const projected = projectAssemblyTools(resolved, service);
        const catalogPath = ctx.capability.catalogPath?.();
        if (catalogPath === undefined)
            return projected;
        const pointer = {
            name: 'capability-menu-catalog',
            text: [
                'On-demand capabilities (Progressive) are not in the exposed tool list above. Their catalog is a YAML file you can browse with grep/read:',
                `  ${catalogPath}`,
                'Search it (e.g. grep -n "name:" <path>) or call meta_search with an exact id for a schema, then meta_invoke to run/load the capability.',
            ].join('\n'),
        };
        return { ...projected, sections: [...projected.sections, pointer] };
    });
    ctx.provide('capabilityPolicy', service);
}
/**
 * Rebuild the text body of a skill-catalog user message from a filtered entry
 * list. Mirrors the `<available_skills>` format emitted by `dsh-tool-skill` so
 * the model sees a consistent, complete replacement catalog.
 */
function renderSkillCatalog(entries) {
    const guidance = entries.length === 0
        ? ['No skills are currently available through the `skill` tool. Do not use names from earlier skill catalogs.']
        : [
            'If the user names a skill, or the task clearly matches a skill\u2019s description, call the `skill` tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill\u2019s instructions until it has been loaded.',
        ];
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
    ].join('\n');
}
//# sourceMappingURL=policy.js.map