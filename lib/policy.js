/**
 * Exposed / Progressive / Blocked capability projection policy for the DeepSeek
 * Harness.
 *
 * @module @daweifu/capability-menu (policy plugin)
 */
import z from '@deepseek-ai/schemastery';
import { escapeText } from '@deepseek-ai/dsh-skill';
import * as mcpClient from '@deepseek-ai/dsh-mcp-client';
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem';
import yaml from 'js-yaml';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
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
    locationsFile: z.string(),
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
export async function apply(ctx, config = {}) {
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
    // ---- Location registry: global add/remove of MCP servers and skill
    // directories by position reference. Entries persist to a YAML file
    // (default `$DSH_HOME/capability-locations.yaml`) and hold only the
    // location plus an enable flag — definitions stay where they are.
    // Mounting an MCP entry loads an equivalent `dsh-mcp-client` instance at
    // runtime (dispose unregisters its tools); skill entries feed one shared
    // FileSystemSkillProvider with only the registered dirs, so registered
    // skills are visible to every agent session while preset-level discovery
    // keeps working unchanged. Orthogonal to the three-class policy above.
    const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh');
    const locationsFile = config.locationsFile ?? join(dshHome, 'capability-locations.yaml');
    /** Live mcp-client fibers by location id (mounted + enabled entries only). */
    const mcpFibers = new Map();
    /** Last mount error per MCP location id; cleared on a successful mount. */
    const mcpErrors = new Map();
    /** Disposer of the shared skill provider; undefined when no skill entry is enabled. */
    let skillProviderDispose;
    let entries = [];
    const projectLocation = (entry) => ({
        id: entry.id,
        type: entry.type,
        enabled: entry.enabled,
        name: entry.type === 'mcp' ? entry.mcp.serverName : basename(entry.skill.dir),
        ...(mcpErrors.get(entry.id) !== undefined ? { error: mcpErrors.get(entry.id) } : {}),
        ...(entry.type === 'mcp' ? { mcp: entry.mcp } : { skill: { dir: entry.skill.dir } }),
    });
    const persistLocations = async () => {
        const text = yaml.dump({ locations: entries });
        const tmp = `${locationsFile}.tmp`;
        await writeFile(tmp, text, 'utf8');
        await rename(tmp, locationsFile);
    };
    /** Normalize one YAML entry: schema-check MCP via mcp-client Config, require an absolute skill dir. */
    const normalizeEntry = (raw) => {
        if (raw === null || typeof raw !== 'object')
            throw new Error('location entry must be an object');
        const record = raw;
        if (typeof record.id !== 'string' || record.id.length === 0) {
            throw new Error('location entry requires a string "id"');
        }
        if (record.type === 'skill') {
            const skill = record.skill;
            if (skill === null || typeof skill !== 'object' || typeof skill.dir !== 'string') {
                throw new Error(`skill location "${record.id}" requires "skill.dir"`);
            }
            if (!isAbsolute(skill.dir)) {
                throw new Error(`skill location "${record.id}" dir must be absolute, got "${skill.dir}"`);
            }
            return { id: record.id, type: 'skill', enabled: record.enabled !== false, skill: { dir: skill.dir } };
        }
        if (record.type === 'mcp') {
            if (record.mcp === null || typeof record.mcp !== 'object') {
                throw new Error(`mcp location "${record.id}" requires an "mcp" object`);
            }
            const mcp = mcpClient.Config(record.mcp);
            return { id: record.id, type: 'mcp', enabled: record.enabled !== false, mcp };
        }
        throw new Error(`location "${record.id}" has unknown type ${JSON.stringify(record.type)}`);
    };
    const loadLocationsFile = async () => {
        let text;
        try {
            text = await readFile(locationsFile, 'utf8');
        }
        catch (error) {
            if (error && typeof error === 'object' && error.code === 'ENOENT')
                return [];
            throw error;
        }
        const doc = yaml.load(text);
        const list = doc === null || doc === undefined ? undefined : doc.locations;
        if (list !== undefined && !Array.isArray(list)) {
            throw new Error(`locations file "${locationsFile}" must contain a "locations" array`);
        }
        return (list ?? []).map(normalizeEntry);
    };
    const mountMcp = async (entry) => {
        const fiber = ctx.plugin({ name: mcpClient.name, inject: [...mcpClient.inject], apply: mcpClient.apply }, entry.mcp);
        try {
            await Promise.resolve(fiber);
            mcpFibers.set(entry.id, fiber);
            mcpErrors.delete(entry.id);
        }
        catch (error) {
            // A rejected activation has already been rolled back by cordis;
            // disposal here only clears a half-mounted fiber.
            try {
                await fiber.dispose();
            }
            catch {
                // The fiber rejected before any effect registered — nothing else can fail here.
            }
            mcpErrors.set(entry.id, String(error));
            console.error(`[capability-menu-policy] mount MCP location "${entry.id}" failed:`, error);
        }
    };
    const unmountMcp = async (entry) => {
        const fiber = mcpFibers.get(entry.id);
        if (fiber === undefined)
            return;
        mcpFibers.delete(entry.id);
        await fiber.dispose();
    };
    const rebuildSkillProvider = () => {
        if (skillProviderDispose !== undefined) {
            skillProviderDispose();
            skillProviderDispose = undefined;
        }
        const dirs = entries
            .filter((e) => e.type === 'skill' && e.enabled)
            .map(e => e.skill.dir);
        if (dirs.length === 0)
            return;
        skillProviderDispose = ctx.skills.registerProvider((control) => new FileSystemSkillProvider(ctx, control, {
            providerName: 'capability-locations',
            includeDefaultRoots: false,
            customSkillDirs: dirs,
        }));
    };
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
        async updateConfig(partial) {
            current = { ...current, ...partial };
            if (partial.metaTools !== undefined) {
                metaTools = [...(partial.metaTools ?? DEFAULT_META_TOOLS)];
                metaToolSet = new Set(metaTools);
            }
            recompile();
            // Classification changed → the on-demand catalog on disk is stale (a
            // capability reclassified to blocked must disappear from the grep-able
            // YAML). Await the registry refresh so callers get a completion signal:
            // the disk catalog is rewritten before the call returns, closing the
            // window where a blocked capability stayed visible on disk.
            await ctx.capability.refresh();
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
        // ---- Location registry management surface (add / remove / enable) ----
        async listLocations() {
            return entries.map(projectLocation);
        },
        async addLocation(payload) {
            if (payload === null || typeof payload !== 'object') {
                throw new Error('addLocation: payload must be an object');
            }
            let entry;
            if (payload.type === 'skill') {
                const dir = payload.skill?.dir;
                if (typeof dir !== 'string' || dir.length === 0) {
                    throw new Error('addLocation: skill location requires "skill.dir"');
                }
                if (!isAbsolute(dir)) {
                    throw new Error(`addLocation: skill dir must be an absolute path, got "${dir}"`);
                }
                const md = await stat(join(dir, 'SKILL.md')).catch(() => undefined);
                if (md === undefined || !md.isFile())
                    throw new Error(`addLocation: no SKILL.md under "${dir}"`);
                entry = { id: `skill-${basename(dir)}`, type: 'skill', enabled: true, skill: { dir } };
            }
            else if (payload.type === 'mcp') {
                if (payload.mcp === null || typeof payload.mcp !== 'object') {
                    throw new Error('addLocation: mcp location requires an "mcp" object');
                }
                const mcp = mcpClient.Config(payload.mcp);
                // Fail before persisting: mcp-client would reject the mount with
                // a serverName reservation error anyway.
                if (entries.some(e => e.type === 'mcp' && e.mcp.serverName === mcp.serverName)) {
                    throw new Error(`addLocation: MCP serverName "${mcp.serverName}" is already registered`);
                }
                entry = { id: `mcp-${mcp.serverName}`, type: 'mcp', enabled: true, mcp };
            }
            else {
                throw new Error(`addLocation: unknown type ${JSON.stringify(payload.type)}`);
            }
            if (entries.some(e => e.id === entry.id)) {
                let n = 2;
                while (entries.some(e => e.id === `${entry.id}-${n}`))
                    n++;
                entry = { ...entry, id: `${entry.id}-${n}` };
            }
            entries = [...entries, entry];
            await persistLocations();
            if (entry.type === 'mcp')
                await mountMcp(entry);
            else
                rebuildSkillProvider();
            return projectLocation(entry);
        },
        async removeLocation(id) {
            const entry = entries.find(e => e.id === id);
            if (entry === undefined)
                throw new Error(`removeLocation: unknown id "${id}"`);
            if (entry.type === 'mcp')
                await unmountMcp(entry);
            entries = entries.filter(e => e.id !== id);
            mcpErrors.delete(id);
            if (entry.type === 'skill')
                rebuildSkillProvider();
            await persistLocations();
        },
        async setLocationEnabled(id, enabled) {
            const index = entries.findIndex(e => e.id === id);
            if (index === -1)
                throw new Error(`setLocationEnabled: unknown id "${id}"`);
            const entry = { ...entries[index], enabled };
            entries = [...entries.slice(0, index), entry, ...entries.slice(index + 1)];
            if (entry.type === 'mcp') {
                if (enabled)
                    await mountMcp(entry);
                else
                    await unmountMcp(entry);
            }
            else {
                rebuildSkillProvider();
            }
            await persistLocations();
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
        // Skip the pointer when there is nothing Progressive to browse: an empty
        // hint wastes ~77 tokens of context and points at an empty file.
        if (catalogPath === undefined || (ctx.capability.progressiveCount?.() ?? 0) === 0)
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
    // Re-mount persisted locations after (re)start: each enabled MCP entry gets
    // a fresh mcp-client fiber; skill dirs feed the shared provider. A broken
    // locations file (or one failing mount) degrades to a logged error — the
    // three-class policy above keeps working either way.
    void (async () => {
        try {
            entries = await loadLocationsFile();
        }
        catch (error) {
            console.error(`[capability-menu-policy] cannot read locations file "${locationsFile}":`, error);
            return;
        }
        for (const entry of entries) {
            if (entry.type === 'mcp' && entry.enabled)
                await mountMcp(entry);
        }
        rebuildSkillProvider();
    })();
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