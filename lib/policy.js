/**
 * Resident / On-demand / Disabled capability projection policy for the DeepSeek
 * Harness.
 *
 * @module @daweifu/capability-menu (policy plugin)
 */
import z from '@deepseek-ai/schemastery';
import { escapeText } from '@deepseek-ai/dsh-skill';
import { serverNameOf, skillNameOf } from "./registry.js";
/** Validate and default the policy configuration. */
export const Config = z.object({
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
});
export const DEFAULT_META_TOOLS = ['meta_search', 'meta_invoke'];
/**
 * Map a legacy rule set (old keys `exposed`/`progressive`/`blocked`) onto the
 * current key names (`resident`/`on-demand`/`disabled`), so already-deployed
 * `cordis.patch.yml` profiles keep working without an on-disk rewrite. New
 * keys win when they carry rules; a legacy key fills in when the matching new
 * list is empty.
 */
export function normalizeSetConfig(set) {
    if (set === undefined)
        return undefined;
    const next = {};
    const resident = set.resident !== undefined && set.resident.length > 0 ? set.resident : undefined;
    if (resident !== undefined)
        next.resident = resident;
    else if (set.exposed !== undefined && set.exposed.length > 0)
        next.resident = set.exposed;
    const onDemand = set['on-demand'] !== undefined && set['on-demand'].length > 0 ? set['on-demand'] : undefined;
    if (onDemand !== undefined)
        next['on-demand'] = onDemand;
    else if (set.progressive !== undefined && set.progressive.length > 0)
        next['on-demand'] = set.progressive;
    const disabled = set.disabled !== undefined && set.disabled.length > 0 ? set.disabled : undefined;
    if (disabled !== undefined)
        next.disabled = disabled;
    else if (set.blocked !== undefined && set.blocked.length > 0)
        next.disabled = set.blocked;
    return next;
}
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
        resident: (set.resident ?? []).map(parseRule),
        onDemand: (set['on-demand'] ?? []).map(parseRule),
        disabled: (set.disabled ?? []).map(parseRule),
    };
}
function ruleMatches(rule, target) {
    if (rule.kind !== undefined && rule.kind !== target.ruleKind)
        return false;
    if (rule.target === 'id') {
        if (!rule.wildcard) {
            // An exact rule matches the full id OR the bare name (e.g. `debugging`
            // matches a skill named `debugging`, `bash` matches the harness-native
            // tool `bash` whose public name is its bare name). Legacy skill rules
            // still spelled with a `skill:`/`skill__` prefix also match the bare name.
            const legacySkill = target.ruleKind === 'skill'
                ? rule.pattern === `skill:${target.name}` || rule.pattern === `skill__${target.name}`
                : false;
            return rule.pattern === target.id || rule.pattern === target.name || legacySkill;
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
 * disabled-exact > disabled-wildcard > resident-exact > on-demand-exact >
 * resident-wildcard > on-demand-wildcard > default (resident). `disabled` is a
 * control decision, so it beats an explicit `resident` rule. Within
 * resident/on-demand an exact name beats a wildcard, so the management UI can
 * pin a single capability to a class even when a broader wildcard rule says
 * otherwise (e.g. `tools.resident: ['mcp__gongfeng__*']` must not silently win
 * over an explicit per-tool `on-demand` rule).
 */
export function classify(compiled, target, metaTools = DEFAULT_META_TOOLS) {
    const meta = metaTools instanceof Set ? metaTools : new Set(metaTools);
    const id = target.id;
    // metaTools can never be On-demand/Disabled for tools.
    if (target.kind === 'tool' && meta.has(id))
        return 'resident';
    for (const rule of compiled.disabled) {
        if (!rule.wildcard && ruleMatches(rule, target))
            return 'disabled';
    }
    for (const rule of compiled.disabled) {
        if (rule.wildcard && ruleMatches(rule, target))
            return 'disabled';
    }
    for (const rule of compiled.resident) {
        if (!rule.wildcard && ruleMatches(rule, target))
            return 'resident';
    }
    for (const rule of compiled.onDemand) {
        if (!rule.wildcard && ruleMatches(rule, target))
            return 'on-demand';
    }
    for (const rule of compiled.resident) {
        if (rule.wildcard && ruleMatches(rule, target))
            return 'resident';
    }
    for (const rule of compiled.onDemand) {
        if (rule.wildcard && ruleMatches(rule, target))
            return 'on-demand';
    }
    return 'resident';
}
/** True when any rule in the list matches the target (used for fail-loud validation). */
function anyRuleMatches(rules, target) {
    return rules.some(rule => ruleMatches(rule, target));
}
const CLASS_LABELS = {
    resident: 'Resident · 常驻（直接调用）',
    'on-demand': 'On-demand · 按需（目录渐进加载）',
    disabled: 'Disabled · 禁用',
};
/**
 * Build the projection listener for one assembly: keep only Resident tools plus
 * the mandatory meta tools.
 */
export function projectAssemblyTools(assembly, service) {
    const kept = assembly.tools.filter(tool => service.isResidentTool(tool.name));
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
export async function apply(ctx, config = {}) {
    // Accept legacy rule keys (`exposed`/`progressive`) with the same meaning as
    // the current `resident`/`on-demand`, so pre-rename profiles keep working
    // without a disk rewrite. The management UI always writes the new keys.
    const normalized = { ...config };
    const legacyTools = config.tools?.exposed !== undefined || config.tools?.progressive !== undefined || config.tools?.blocked !== undefined;
    const legacySkills = config.skills?.exposed !== undefined || config.skills?.progressive !== undefined || config.skills?.blocked !== undefined;
    normalized.tools = normalizeSetConfig(config.tools);
    normalized.skills = normalizeSetConfig(config.skills);
    if (legacyTools || legacySkills) {
        ctx.logger.warn('capability-policy: legacy rule keys `exposed`/`progressive`/`blocked` were auto-mapped to `resident`/`on-demand`/`disabled`; edit the profile patch to persist the new keys');
    }
    // Mutable runtime state so the management surface (能力管理) can live-update
    // the policy without a reload.
    let current = normalized;
    let metaTools = [...(normalized.metaTools ?? DEFAULT_META_TOOLS)];
    let metaToolSet = new Set(metaTools);
    let toolCompiled;
    let skillCompiled;
    const recompile = () => {
        const toolRules = compileSet(current.tools);
        const skillRules = compileSet(current.skills);
        // Normalize tool/skill rule kinds for matching.
        toolCompiled = {
            resident: toolRules.resident.map(rule => ({ ...rule, kind: 'tool' })),
            onDemand: toolRules.onDemand.map(rule => ({ ...rule, kind: 'tool' })),
            disabled: toolRules.disabled.map(rule => ({ ...rule, kind: 'tool' })),
        };
        skillCompiled = {
            resident: skillRules.resident.map(rule => ({ ...rule, kind: 'skill' })),
            onDemand: skillRules.onDemand.map(rule => ({ ...rule, kind: 'skill' })),
            disabled: skillRules.disabled.map(rule => ({ ...rule, kind: 'skill' })),
        };
        // Meta tools are the control-plane escape hatch: blocking one is a
        // misconfiguration that must fail loud, never silently disable the surface.
        for (const name of metaTools) {
            const target = { id: name, name, server: serverNameOf(name), kind: 'tool', ruleKind: 'tool' };
            if (anyRuleMatches(toolCompiled.disabled, target)) {
                throw new Error(`meta tool "${name}" cannot be disabled; remove it from tools.disabled`);
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
            return classify(skillCompiled, { id: name, name, kind: 'skill', ruleKind: 'skill' }, new Set());
        },
        classifyCapability(id, kind) {
            if (kind === 'skill' || id.startsWith('skill:') || id.startsWith('skill__')) {
                return service.classifySkill(skillNameOf(id));
            }
            return service.classifyTool(id);
        },
        isResidentTool(name) {
            return service.classifyTool(name) === 'resident';
        },
        isResidentSkill(name) {
            return service.classifySkill(name) === 'resident';
        },
        isDisabledTool(name) {
            return service.classifyTool(name) === 'disabled';
        },
        isDisabledSkill(name) {
            return service.classifySkill(name) === 'disabled';
        },
        isDisabledCapability(id, kind) {
            return service.classifyCapability(id, kind) === 'disabled';
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
        async updateConfig(partial) {
            current = { ...current, ...partial };
            if (partial.metaTools !== undefined) {
                metaTools = [...(partial.metaTools ?? DEFAULT_META_TOOLS)];
                metaToolSet = new Set(metaTools);
            }
            recompile();
            // Classification changed → the on-demand catalog on disk is stale (a
            // capability reclassified to disabled must disappear from the grep-able
            // YAML). Await the registry refresh so callers get a completion signal:
            // the disk catalog is rewritten before the call returns, closing the
            // window where a disabled capability stayed visible on disk.
            await ctx.capability.refresh();
        },
        classifyAll() {
            // The registry default maxResults (20) would truncate the management
            // surface: enumerate every indexed capability, not just the top-20.
            return ctx.capability.search({ maxResults: Number.MAX_SAFE_INTEGER }).map(summary => {
                const cls = service.classifyCapability(summary.id, summary.kind);
                const mandatory = summary.kind === 'tool' && metaToolSet.has(summary.id);
                return {
                    id: summary.id,
                    kind: summary.kind,
                    name: summary.name,
                    ...summary.server !== undefined ? { server: summary.server } : {},
                    ...summary.source !== undefined ? { source: summary.source } : {},
                    class: cls,
                    classLabel: CLASS_LABELS[cls],
                    mandatory,
                };
            });
        },
    };
    // Disabled capabilities are a hard deny at the execution surface, not just a
    // projection concern: a hallucinated direct call to a disabled tool (or to the
    // `skill` loader for a disabled skill) must never reach the underlying server.
    // On-demand tools stay executable — meta_invoke forwards through this same
    // pipeline, so only Disabled is rejected here.
    ctx.on('tools/pre-execute', async (exec, next) => {
        if (service.isDisabledTool(exec.name)) {
            return { kind: 'deny', reason: `capability "${exec.name}" is disabled and cannot be executed` };
        }
        if (exec.name === 'skill') {
            const args = exec.arguments;
            const name = typeof args?.name === 'string' ? args.name : '';
            if (name.length > 0 && service.isDisabledSkill(name)) {
                return { kind: 'deny', reason: `skill "${name}" is disabled and cannot be loaded` };
            }
        }
        return next();
    });
    // On-demand/Disabled skills must not appear in the model-facing
    // `<available_skills>` catalog injected by `dsh-tool-skill`. The catalog is a
    // user-role message whose `source.kind === 'skill-catalog'`; rewrite it every
    // pre-step to keep only Resident skills. dsh-tool-skill republishes the full
    // catalog earlier on the same chain, so this filter is idempotent: whatever
    // it publishes, only the Resident subset reaches the model.
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
                .filter(entry => service.isResidentSkill(entry.name))
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
    // on-demand catalog so the model knows it exists without having to "think of"
    // meta_search first. Skills keep the dsh-native catalog, but filtered to
    // Resident by the `agent/pre-step` hook above.
    ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
        const resolved = await next();
        const projected = projectAssemblyTools(resolved, service);
        const catalogPath = ctx.capability.catalogPath?.();
        // Skip the pointer when there is nothing On-demand to browse: an empty
        // hint wastes ~77 tokens of context and points at an empty file.
        if (catalogPath === undefined || (ctx.capability.onDemandCount?.() ?? 0) === 0)
            return projected;
        const pointer = {
            name: 'capability-menu-catalog',
            text: [
                'On-demand capabilities are not in the resident tool list above. Their catalog is a YAML file you can browse with grep/read:',
                `  ${catalogPath}`,
                'Search it (e.g. grep -n "name:" <path>) or call meta_search with an exact id for a schema, then meta_invoke to run/load the capability.',
            ].join('\n'),
        };
        return { ...projected, sections: [...projected.sections, pointer] };
    });
    ctx.provide('capabilityPolicy', service);
    // Emit the on-demand catalog before the plugin finishes mounting. The
    // registry's own startup path (rebuildTools + refreshSkills) bypasses
    // refresh(), so without this the YAML would not exist until the first
    // tools/skills change event. Awaiting here closes the cold-start window
    // where the first assemble could point at a file that does not exist yet.
    await ctx.capability.refresh();
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