/**
 * Exposed / Progressive / Blocked capability projection policy for the DeepSeek
 * Harness.
 *
 * @module @daweifu/capability-menu (policy plugin)
 */
import z from '@deepseek-ai/schemastery';
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
 * blocked-exact > blocked-wildcard > exposed-exact > exposed-wildcard >
 * progressive-exact > progressive-wildcard > default (exposed). `blocked`
 * is a control decision, so it beats an explicit `exposed` rule.
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
    for (const rule of compiled.exposed) {
        if (rule.wildcard && ruleMatches(rule, target))
            return 'exposed';
    }
    for (const rule of compiled.progressive) {
        if (!rule.wildcard && ruleMatches(rule, target))
            return 'progressive';
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
    // Project the model-visible tool list. This runs on the projection chain only
    // (system-prompt/assemble); the execution chain (ctx.tools.execute) is
    // untouched, so Progressive tools remain executable via meta_invoke. Skills
    // keep the dsh-native `<available_skills>` catalog, which is the Exposed
    // surface; catalog-level skill filtering needs an upstream `dsh-tool-skill`
    // filter hook (out of bundle scope).
    ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
        const resolved = await next();
        return projectAssemblyTools(resolved, service);
    });
    ctx.provide('capabilityPolicy', service);
}
//# sourceMappingURL=policy.js.map