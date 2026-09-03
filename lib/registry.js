/**
 * Unified capability catalog for the DeepSeek Harness.
 *
 * @module @daweifu/capability-menu (registry plugin)
 */
import z from '@deepseek-ai/schemastery';
import { isModelInvocable } from '@deepseek-ai/dsh-skill';
import yaml from 'js-yaml';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
/** Stable identifier prefixes: MCP tools keep `mcp__...`, skills use `skill:<name>`. */
export const SKILL_ID_PREFIX = 'skill:';
export const MCP_ID_PREFIX = 'mcp__';
/**
 * Reserved pseudo-server that groups harness-native (non-MCP) tools in the
 * management surface. Native tools (bash/read/write/…) are cataloged like MCP
 * tools — same `server` dimension — so the 能力菜单 can group them, classify
 * them Resident/On-demand/Blocked, and `meta_invoke` can dispatch them.
 */
export const BUILTIN_SERVER = 'builtin';
/**
 * Tool names that never enter the capability catalog: this plugin's own
 * control plane (`meta_search`/`meta_invoke`, always Resident) and the
 * reserved Code Mode presentation transport (`run_code`).
 */
export const CATALOG_EXCLUDED_TOOLS = new Set(['meta_search', 'meta_invoke', 'run_code']);
/** Validate and default the registry configuration. */
export const Config = z.object({
    summaryMaxChars: z.number().default(160),
    detailIncludesBody: z.boolean().default(false),
    maxResults: z.number().default(20),
    weighting: z.number().default(0.1),
    // schemastery object properties are optional-by-default: a missing key or
    // undefined value is accepted (no `meta.required`), so no `.optional()` needed.
    progressiveSkillCatalog: z.string(),
    catalogFile: z.string(),
});
function assertPositiveInteger(name, value, min) {
    if (!Number.isInteger(value) || value < min) {
        throw new Error(`${name} must be an integer >= ${min}`);
    }
}
function assertWeight(name, value) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`${name} must be a number in [0, 1]`);
    }
}
/** Trim a description to a model-friendly summary. */
function toSummary(description, maxChars) {
    const collapsed = description.replace(/\s+/g, ' ').trim();
    if (collapsed.length <= maxChars)
        return collapsed;
    return `${collapsed.slice(0, maxChars - 1)}…`;
}
/** BM25-ish keyword score over one record (pure JS, zero dependencies). */
function keywordScore(record, tokens) {
    const haystack = [
        record.name,
        record.description,
        record.whenToUse ?? '',
        record.origin.provider,
        ...record.tags,
    ].join(' ').toLowerCase();
    let score = 0;
    for (const token of tokens) {
        if (token.length === 0)
            continue;
        if (haystack.includes(token))
            score += 1;
        // Substring hits on the identifier are stronger (exact id match handled separately).
        if (record.id.toLowerCase().includes(token))
            score += 1.5;
    }
    return score;
}
function successRate(stats) {
    if (stats.uses === 0)
        return undefined;
    return stats.successes / stats.uses;
}
/** Build the registry plugin. */
export const name = 'capability-menu-registry';
export const inject = ['tools', 'skills'];
export function apply(ctx, config = {}) {
    const summaryMaxChars = config.summaryMaxChars ?? 160;
    const detailIncludesBody = config.detailIncludesBody ?? false;
    const maxResults = config.maxResults ?? 20;
    const weighting = config.weighting ?? 0.1;
    const catalogFile = (config.catalogFile ?? join(homedir(), '.dsh', 'capability-catalog.yaml')).trim();
    assertPositiveInteger('summaryMaxChars', summaryMaxChars, 20);
    assertPositiveInteger('maxResults', maxResults, 1);
    assertWeight('weighting', weighting);
    /** Tool records keyed by tool name (MCP tools plus native tools under `builtin`); skills keyed by `skill:<name>`. */
    let toolRecords = new Map();
    let skillRecords = new Map();
    /** The scope each indexed skill was collected from; undefined = global layer. */
    let skillScopes = new Map();
    /** Progressive count of the latest catalog emission (0 until first write). */
    let progressiveCount = 0;
    const statsOf = (record) => record.stats;
    /**
     * Resolve a skill's root directory from the live skill registry. The
     * directory comes from the skill provider's own locator (`resourceBase` for
     * bundle skills, the SKILL.md parent for flat files) or the indexed origin
     * path for progressive-catalog entries — never from caller input.
     */
    const skillRootOf = async (id) => {
        const name = skillNameOf(id);
        const scope = skillScopes.get(id);
        const lookup = scope === undefined ? {} : { scope };
        const definition = await ctx.skills.get(name, lookup).catch(() => undefined);
        if (definition !== undefined) {
            if (definition.resourceBase !== undefined && definition.resourceBase.kind === 'directory') {
                return definition.resourceBase.path;
            }
            if (definition.path !== undefined)
                return dirname(definition.path);
        }
        // Progressive-catalog skills are not registered with a provider; fall
        // back to the catalog-declared path (a directory holding the SKILL.md).
        const record = skillRecords.get(id);
        if (record?.origin.path !== undefined)
            return record.origin.path;
        return undefined;
    };
    /** Rebuild the tool index synchronously from the visible tool registry. */
    const rebuildTools = () => {
        const next = new Map();
        for (const schema of ctx.tools.schemas()) {
            // 全部可见工具都进编目，仅排除 meta_search/meta_invoke（本插件控制面，
            // 恒常驻）与 run_code（Code Mode 保留传输层）。mcp__ 工具按真实 server
            // 分组；原生工具（无 mcp__ 前缀）统一归入保留的 builtin server，使能力
            // 菜单能统一按 server 分组、三档管理，meta_invoke 也能派发它们。
            if (CATALOG_EXCLUDED_TOOLS.has(schema.name))
                continue;
            const existing = toolRecords.get(schema.name);
            const stats = existing?.stats ?? { uses: 0, successes: 0, failures: 0, totalMs: 0 };
            const isMcp = schema.name.startsWith(MCP_ID_PREFIX);
            const serverName = isMcp ? serverNameOf(schema.name) : BUILTIN_SERVER;
            next.set(schema.name, {
                id: schema.name,
                kind: 'tool',
                actions: ['execute'],
                name: schema.name,
                description: schema.description,
                origin: { provider: serverName, serverName },
                parameters: schema.parameters,
                invocation: { modelInvocable: true, userInvocable: false },
                tags: [serverName, 'tool'],
                stats,
                summary: toSummary(schema.description, summaryMaxChars),
            });
        }
        toolRecords = next;
    };
    /** Read and parse the Progressive-skill catalog YAML into entries (empty when unconfigured/unreadable). */
    const loadProgressiveSkills = async () => {
        const file = config.progressiveSkillCatalog;
        if (file === undefined || file.length === 0)
            return [];
        const path = resolve(process.cwd(), file);
        let text;
        try {
            text = await readFile(path, 'utf8');
        }
        catch (error) {
            ctx.logger.warn(`meta-registry: progressive skill catalog not readable (${path}): ${String(error)}`);
            return [];
        }
        let parsed;
        try {
            parsed = yaml.load(text);
        }
        catch (error) {
            ctx.logger.warn(`meta-registry: progressive skill catalog parse failed (${path}): ${String(error)}`);
            return [];
        }
        if (parsed === null || typeof parsed !== 'object')
            return [];
        const list = parsed.skills;
        if (!Array.isArray(list))
            return [];
        const entries = [];
        for (const raw of list) {
            if (raw === null || typeof raw !== 'object')
                continue;
            const item = raw;
            if (typeof item.name !== 'string' || item.name.length === 0)
                continue;
            const description = typeof item.description === 'string' ? item.description : '';
            entries.push({
                name: item.name,
                description,
                ...typeof item.whenToUse === 'string' ? { whenToUse: item.whenToUse } : {},
                ...typeof item.path === 'string' ? { path: item.path } : {},
            });
        }
        return entries;
    };
    /**
     * Rebuild the skill index asynchronously; resolves when the refresh completes.
     *
     * Skills live in a per-scope registry: the global layer plus one layer per
     * agent preset that mounts skill providers (a preset's `skill-filesystem`
     * registers into that preset's layer, so the host-plane global read alone
     * sees nothing). The management catalog enumerates the global layer and then
     * every mountable preset's standing scope, so preset-scoped skills surface.
     */
    const refreshSkills = async () => {
        const nextSkills = new Map();
        const nextSkillScopes = new Map();
        const indexSkill = (skill, scope) => {
            if (!isModelInvocable(skill))
                return;
            const id = skillId(skill.name);
            const existing = skillRecords.get(id);
            const stats = existing?.stats ?? { uses: 0, successes: 0, failures: 0, totalMs: 0 };
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
            });
            nextSkillScopes.set(id, scope);
        };
        const collectScoped = async (label, scope) => {
            let skills = [];
            try {
                skills = scope === undefined ? await ctx.skills.list({}) : await ctx.skills.list({ scope });
            }
            catch (error) {
                ctx.logger.warn(`meta-registry: skill catalog refresh failed for ${label}: ${String(error)}`);
                return;
            }
            for (const skill of skills)
                indexSkill(skill, scope);
        };
        // Global layer first: the host's own skill providers.
        await collectScoped('global', undefined);
        // Preset layers: agent presets mount skill providers into their own scope
        // (web surface disables the host-plane rows by design). `agentPresets` is
        // optional — headless bundles without it index the global layer only.
        const agentPresets = ctx.get('agentPresets');
        if (agentPresets !== undefined) {
            let presets = [];
            try {
                presets = await agentPresets.list();
            }
            catch (error) {
                ctx.logger.warn(`meta-registry: agent-presets enumeration failed: ${String(error)}`);
            }
            for (const preset of presets) {
                if (preset.broken !== undefined)
                    continue;
                try {
                    const scope = await agentPresets.standingKeyFor(preset.id);
                    await collectScoped(`preset "${preset.id}"`, scope);
                }
                catch (error) {
                    ctx.logger.warn(`meta-registry: preset "${preset.id}" skill scope unavailable: ${String(error)}`);
                }
            }
        }
        // Additionally index Progressive skills from the independent YAML catalog.
        // Exposed skills (from ctx.skills) win on a name collision so an Exposed
        // skill is never shadowed by a stale Progressive catalog entry.
        const progressive = await loadProgressiveSkills();
        for (const entry of progressive) {
            const id = skillId(entry.name);
            if (nextSkills.has(id))
                continue;
            const existing = skillRecords.get(id);
            const stats = existing?.stats ?? { uses: 0, successes: 0, failures: 0, totalMs: 0 };
            nextSkills.set(id, {
                id,
                kind: 'skill',
                actions: ['load'],
                name: entry.name,
                description: entry.description,
                ...entry.whenToUse !== undefined ? { whenToUse: entry.whenToUse } : {},
                origin: {
                    provider: 'progressive-catalog',
                    ...entry.path !== undefined ? { path: entry.path } : {},
                },
                parameters: { type: 'object', properties: {}, additionalProperties: false },
                invocation: { modelInvocable: true, userInvocable: false },
                tags: ['progressive-catalog', 'skill'],
                stats,
                summary: toSummary(entry.description, summaryMaxChars),
            });
            nextSkillScopes.set(id, undefined);
        }
        skillRecords = nextSkills;
        skillScopes = nextSkillScopes;
    };
    /**
     * Emit the on-demand (Progressive) capability catalog as a YAML file the
     * model can browse with grep/read. Only Progressive capabilities are written;
     * Exposed ones are already in the model surface and Blocked ones must stay
     * undiscoverable. Skips emission when the policy plugin is not mounted (no
     * classification) or the file path is disabled.
     */
    const writeCatalog = async () => {
        progressiveCount = 0;
        if (catalogFile.length === 0)
            return;
        const policy = ctx.get('capabilityPolicy');
        if (policy === undefined)
            return;
        const progressive = [...toolRecords.values(), ...skillRecords.values()]
            .filter(record => policy.classifyCapability(record.id) === 'progressive')
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
        }));
        progressiveCount = progressive.length;
        try {
            await writeFile(catalogFile, yaml.dump({ capabilities: progressive }), 'utf8');
        }
        catch (error) {
            ctx.logger.warn(`capability-registry: on-demand catalog write failed (${catalogFile}): ${String(error)}`);
        }
    };
    /** Refresh the whole catalog: tools synchronously, skills asynchronously. */
    const refresh = async () => {
        rebuildTools();
        await refreshSkills();
        await writeCatalog();
    };
    /** Register once; also subscribe to change events. */
    const disposers = [];
    disposers.push(ctx.on('tools/change', () => void refresh()));
    disposers.push(ctx.on('skills/change', () => void refresh()));
    // Build the synchronous tool index eagerly; the skill index is left to
    // the first explicit `refresh()` (or a change event) so an eager load never
    // snapshots — and caches inside the skill registry — an incomplete catalog.
    rebuildTools();
    void refreshSkills();
    ctx.effect(() => () => {
        for (const dispose of disposers)
            dispose();
    });
    const service = {
        search(options = {}) {
            const kind = options.kind ?? 'all';
            const server = options.server;
            const tag = options.tag;
            const query = options.query?.trim();
            const id = options.id?.trim();
            const all = [];
            // Index/source is the GLOBAL registry — no visibility filter here.
            // Exposed/Progressive is a projection-layer concern (`dsh-capability-policy`),
            // so a Progressive tool hidden from the model's exposure surface must still
            // be searchable so `meta_search` can return it for `meta_invoke`. Blocked
            // enforcement lives at the model-facing tools (meta_search/meta_invoke),
            // keeping the management surface able to list Blocked capabilities.
            if (kind === 'all' || kind === 'tool') {
                for (const record of toolRecords.values())
                    all.push(record);
            }
            if (kind === 'all' || kind === 'skill') {
                for (const record of skillRecords.values())
                    all.push(record);
            }
            const filtered = all.filter(record => {
                if (server !== undefined && record.origin.serverName !== server)
                    return false;
                if (tag !== undefined && !record.tags.includes(tag))
                    return false;
                if (id !== undefined && record.id !== id)
                    return false;
                return true;
            });
            // Rank: exact id/name first, then keyword score, then experience weight.
            const tokens = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
            const ranked = filtered.map(record => {
                let score = 0;
                if (query !== undefined && query.length > 0) {
                    const exact = record.id === query || record.name === query;
                    if (exact)
                        score += 100;
                    score += keywordScore(record, tokens);
                }
                const rate = successRate(record.stats);
                if (rate !== undefined && weighting > 0)
                    score += rate * weighting * 10;
                if (record.stats.uses > 0 && weighting > 0)
                    score += Math.min(record.stats.uses, 100) * weighting * 0.01;
                return { record, score };
            }).sort((a, b) => b.score - a.score);
            const limit = Math.max(1, options.maxResults ?? maxResults);
            return ranked.slice(0, limit).map(({ record }) => {
                const rate = successRate(record.stats);
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
                };
            });
        },
        get(id) {
            const key = id.trim();
            return toolRecords.get(key) ?? skillRecords.get(key);
        },
        async getDetail(id, context = {}) {
            const key = id.trim();
            const record = toolRecords.get(key) ?? skillRecords.get(key);
            if (record === undefined)
                return undefined;
            if (record.kind === 'tool') {
                const definition = ctx.tools.get(record.name, context.scope);
                if (definition === undefined)
                    return undefined;
                return {
                    id: record.id,
                    kind: 'tool',
                    actions: record.actions,
                    name: record.name,
                    description: definition.description,
                    parameters: definition.parameters,
                    output: definition.output.schema,
                    origin: record.origin,
                    tags: record.tags,
                    stats: statsOf(record),
                };
            }
            // Skill: resolve the body if configured.
            const lookup = {
                cwd: context.cwd,
                signal: context.signal,
                scope: context.scope,
            };
            const skill = await ctx.skills.get(record.name, lookup).catch(() => undefined);
            const detail = {
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
            };
            if (skill !== undefined && detailIncludesBody) {
                return { ...detail, output: { type: 'object', properties: { content: { type: 'string' } } } };
            }
            return detail;
        },
        async listSkillDir(id, relPath = '') {
            const root = await skillRootOf(id);
            if (root === undefined)
                return undefined;
            const target = relPath.length === 0 ? root : resolve(root, relPath);
            // Containment: the resolved path must stay inside the skill root.
            if (target !== root && !target.startsWith(`${root}${sep}`))
                return undefined;
            try {
                const entries = await readdir(target, { withFileTypes: true });
                return entries.map(entry => ({
                    name: entry.name,
                    type: entry.isDirectory() ? 'directory' : 'file',
                }));
            }
            catch (error) {
                ctx.logger.warn(`meta-registry: skill dir listing failed for "${id}" at ${target}: ${String(error)}`);
                return undefined;
            }
        },
        async readSkillFile(id, relPath) {
            const root = await skillRootOf(id);
            if (root === undefined)
                return undefined;
            const target = resolve(root, relPath);
            // Containment: the resolved path must stay inside the skill root.
            if (target !== root && !target.startsWith(`${root}${sep}`))
                return undefined;
            try {
                const info = await stat(target);
                if (!info.isFile())
                    return undefined;
                const text = await readFile(target, 'utf8');
                // NUL marks binary content; do not surface it as a text preview.
                return text.includes('\0') ? undefined : text;
            }
            catch (error) {
                ctx.logger.warn(`meta-registry: skill file read failed for "${id}" at ${target}: ${String(error)}`);
                return undefined;
            }
        },
        size() {
            return toolRecords.size + skillRecords.size;
        },
        catalogPath() {
            return catalogFile.length === 0 ? undefined : catalogFile;
        },
        progressiveCount() {
            return progressiveCount;
        },
        refresh() {
            return refresh();
        },
    };
    // Observe tool results to write back objective stats. Nested dispatches
    // (parent set by meta_invoke) attribute to the target capability; the
    // meta_invoke wrapper itself records nothing for any capability.
    ctx.on('tools/result', (exec, result) => {
        const name = exec.name;
        const record = toolRecords.get(name);
        if (record === undefined)
            return;
        // Nested dispatches (a meta_invoke call or a native-tool forward) carry the
        // target tool's own name, so stats always attribute to the target capability.
        const durationMs = result.meta !== undefined && typeof result.meta === 'object'
            && result.meta !== null && 'durationMs' in result.meta
            ? result.meta.durationMs
            : undefined;
        const base = statsOf(record);
        const next = {
            uses: base.uses + 1,
            successes: base.successes + (result.isError ? 0 : 1),
            failures: base.failures + (result.isError ? 1 : 0),
            totalMs: base.totalMs + (typeof durationMs === 'number' && Number.isFinite(durationMs) ? durationMs : 0),
            lastUsedAt: Date.now(),
        };
        toolRecords.set(name, { ...record, stats: next });
    });
    ctx.provide('capability', service);
}
/** Derive the server namespace from an `mcp__<server>__<raw>` name. */
export function serverNameOf(publicName) {
    const rest = publicName.startsWith(MCP_ID_PREFIX) ? publicName.slice(MCP_ID_PREFIX.length) : publicName;
    const index = rest.indexOf('__');
    return index === -1 ? rest : rest.slice(0, index);
}
/** Build the stable skill identifier `skill:<name>`. */
export function skillId(name) {
    return `${SKILL_ID_PREFIX}${name}`;
}
/** Strip the `skill:` prefix from a capability id. */
export function skillNameOf(id) {
    return id.startsWith(SKILL_ID_PREFIX) ? id.slice(SKILL_ID_PREFIX.length) : id;
}
//# sourceMappingURL=registry.js.map