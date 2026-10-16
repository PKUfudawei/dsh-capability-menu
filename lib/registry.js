/**
 * Unified capability catalog for the DeepSeek Harness.
 *
 * @module @daweifu/capability-menu (registry plugin)
 */
import z from '@deepseek-ai/schemastery';
import { isModelInvocable } from '@deepseek-ai/dsh-skill';
import yaml from 'js-yaml';
import { copyFile, mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { constants, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { BUILT_IN_SERVER, MCP_ID_PREFIX } from "./constants.js";
// Re-exported for the package's public surface (`/registry` subpath).
export { BUILT_IN_SERVER, MCP_ID_PREFIX };
/**
 * Tool names that never enter the capability catalog: this plugin's own
 * control plane (`meta_search`/`meta_invoke`, always Resident) and the
 * reserved Code Mode presentation transport (`run_code`).
 *
 * Tool ids (the key everything else uses) are the REAL registered tool name:
 * MCP tools are registered as `mcp__<server>__<raw>` by the harness MCP client
 * and natives keep their bare name (`bash`/`read`/…). Skills have no
 * name-level namespace: a skill's id IS its bare name and `kind` disambiguates
 * it from a same-named tool.
 */
export const CATALOG_EXCLUDED_TOOLS = new Set(['meta_search', 'meta_invoke', 'run_code']);
const ASYNC_DISPOSE = Symbol.asyncDispose ?? Symbol.for('nodejs.asyncDispose');
/**
 * Read one preset's tool/skill view across both Agent preset APIs.
 * Newer DSH versions return a lease so hot-replaced preset generations cannot
 * be disposed while the registry is reading their scoped capabilities.
 */
async function withAgentPresetScope(agentPresets, id, read) {
    if (agentPresets.acquireScope !== undefined) {
        const lease = await agentPresets.acquireScope(id);
        try {
            return await read(lease.key);
        }
        finally {
            const dispose = lease[ASYNC_DISPOSE];
            if (typeof dispose === 'function')
                await dispose.call(lease);
        }
    }
    if (agentPresets.standingKeyFor !== undefined) {
        return await read(await agentPresets.standingKeyFor(id));
    }
    throw new Error('agentPresets exposes neither acquireScope() nor standingKeyFor()');
}
/** Validate and default the registry configuration. */
export const Config = z.object({
    summaryMaxChars: z.number().default(320),
    detailIncludesBody: z.boolean().default(false),
    maxResults: z.number().default(20),
    weighting: z.number().default(0.1),
    // schemastery object properties are optional-by-default: a missing key or
    // undefined value is accepted (no `meta.required`), so no `.optional()` needed.
    catalogFile: z.string(),
    searchMetadataFile: z.string(),
    refreshDebounceMs: z.number().default(200),
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
/** True when `target` is `root` itself or sits below it. */
function isUnder(root, target) {
    return target === root || target.startsWith(`${root}${sep}`);
}
/**
 * Containment check for skill-directory access: `target` must stay inside
 * `root`, both lexically (`resolve` already collapsed `..`) and physically —
 * a symlink inside the skill directory must not lead out of it. Paths that do
 * not exist yet cannot be resolved physically; those stay governed by the
 * lexical check and the caller's own stat/read failure handling.
 */
async function isInside(root, target) {
    if (!isUnder(root, target))
        return false;
    const realRoot = await realpath(root).catch(() => undefined);
    const realTarget = await realpath(target).catch(() => undefined);
    if (realRoot === undefined || realTarget === undefined)
        return true;
    return isUnder(realRoot, realTarget);
}
/** Trim a description to a model-friendly summary. */
function toSummary(description, maxChars) {
    const collapsed = description.replace(/\s+/g, ' ').trim();
    if (collapsed.length <= maxChars)
        return collapsed;
    const prefix = collapsed.slice(0, maxChars - 1);
    const lastBoundary = Math.max(...['。', '！', '？', '.', '!', '?', '；', ';', '，', ',', '、', ' '].map(char => prefix.lastIndexOf(char)));
    const summary = lastBoundary >= Math.floor(prefix.length * 0.75)
        ? prefix.slice(0, lastBoundary + (prefix[lastBoundary] === ' ' ? 0 : 1)).trimEnd()
        : prefix;
    return `${summary}…`;
}
function toSkillSummary(description, whenToUse, name, maxChars) {
    const meaningful = (value) => value.replace(/[|\s\-—–_·•]+/g, '').trim().length > 0;
    if (meaningful(description))
        return toSummary(description, maxChars);
    if (whenToUse !== undefined && meaningful(whenToUse))
        return toSummary(whenToUse, maxChars);
    return `Skill: ${name.replace(/[-_]+/g, ' ')}`;
}
/** BM25-ish keyword score over one record (pure JS, zero dependencies). */
function keywordScore(record, tokens, includeSourceDescription) {
    const haystack = [
        record.name,
        record.summary,
        ...(includeSourceDescription ? [record.description] : []),
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
    const configuredSummaryMaxChars = config.summaryMaxChars ?? 320;
    let summaryMaxChars = configuredSummaryMaxChars;
    const detailIncludesBody = config.detailIncludesBody ?? false;
    const maxResults = config.maxResults ?? 20;
    const weighting = config.weighting ?? 0.1;
    const dshHome = process.env['DSH_HOME']?.trim();
    const catalogFile = (config.catalogFile ?? join(dshHome || join(homedir(), '.dsh'), 'capability-catalog.yaml')).trim();
    const searchMetadataFile = (config.searchMetadataFile ?? join(dshHome || join(homedir(), '.dsh'), 'capability-menu-search-metadata.json')).trim();
    const refreshDebounceMs = config.refreshDebounceMs ?? 200;
    assertPositiveInteger('summaryMaxChars', summaryMaxChars, 20);
    assertPositiveInteger('maxResults', maxResults, 1);
    assertPositiveInteger('refreshDebounceMs', refreshDebounceMs, 0);
    assertWeight('weighting', weighting);
    /** Tool records keyed by tool name (MCP tools plus native tools under `built-in`); skills keyed by bare skill name. */
    let toolRecords = new Map();
    let skillRecords = new Map();
    /** The scope each indexed skill was collected from; undefined = global layer. */
    let skillScopes = new Map();
    /** On-demand count of the latest catalog emission (0 until first write). */
    let onDemandCount = 0;
    let catalogError;
    let unavailableSkills = [];
    let shadowedSkills = [];
    let brokenPresets = [];
    let undocumentedSkills = [];
    /** Last emitted catalog text, so an unchanged rebuild skips the write. */
    let lastCatalogContent;
    const metadata = new Map();
    const metadataKey = (kind, id) => `${kind}:${id}`;
    let legacyMetadata = false;
    let savedSummaryMaxChars;
    if (searchMetadataFile.length > 0) {
        try {
            const saved = JSON.parse(readFileSync(searchMetadataFile, 'utf8'));
            if (saved === null || typeof saved !== 'object' || Array.isArray(saved))
                throw new Error('expected an object');
            const settings = saved['_settings'];
            if (settings !== null && typeof settings === 'object' && !Array.isArray(settings)) {
                const value = settings['summaryMaxChars'];
                if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 20) {
                    savedSummaryMaxChars = value;
                    summaryMaxChars = value;
                }
            }
            for (const [key, value] of Object.entries(saved)) {
                if (!/^(tool|skill):/.test(key) || value === null || typeof value !== 'object' || Array.isArray(value))
                    continue;
                const entry = value;
                if ('summary' in entry || 'tags' in entry)
                    legacyMetadata = true;
                const description = typeof entry.description === 'string' ? entry.description : entry.summary;
                if (typeof description === 'string' && description.trim().length > 0) {
                    metadata.set(key, description.trim());
                }
            }
        }
        catch (error) {
            if (error.code !== 'ENOENT') {
                ctx.logger.warn(`capability-registry: search metadata read failed (${searchMetadataFile}): ${String(error)}`);
            }
        }
    }
    let metadataWrite = Promise.resolve();
    const persistSearchState = async (next, savedLimit) => {
        const entries = Object.fromEntries([...next].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, { description: value }]));
        const content = JSON.stringify({
            ...(savedLimit !== undefined ? { _settings: { summaryMaxChars: savedLimit } } : {}),
            ...entries,
        }, null, 2) + '\n';
        await mkdir(dirname(searchMetadataFile), { recursive: true });
        if (legacyMetadata) {
            try {
                await copyFile(searchMetadataFile, `${searchMetadataFile}.legacy.bak`, constants.COPYFILE_EXCL);
            }
            catch (error) {
                if (error.code !== 'EEXIST')
                    throw error;
            }
        }
        const temp = `${searchMetadataFile}.${process.pid}.${Date.now()}.tmp`;
        try {
            await writeFile(temp, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
            await rename(temp, searchMetadataFile);
        }
        catch (error) {
            await unlink(temp).catch(() => undefined);
            throw error;
        }
        metadata.clear();
        for (const [key, value] of next)
            metadata.set(key, value);
        savedSummaryMaxChars = savedLimit;
        legacyMetadata = false;
    };
    const overrideOf = (record) => {
        const value = metadata.get(metadataKey(record.kind, record.id));
        return value === record.summary ? undefined : value;
    };
    const effectiveRecord = (record) => {
        const override = overrideOf(record);
        return override === undefined ? record : { ...record, summary: override };
    };
    const statsOf = (record) => record.stats;
    /**
     * Kind-aware record lookup. With `kind` only that table is consulted; without
     * it a name present in BOTH tables is ambiguous and resolves to undefined
     * (never silently pick one kind over the other).
     */
    const resolveRecord = (key, kind) => {
        if (kind === 'tool')
            return toolRecords.get(key);
        if (kind === 'skill')
            return skillRecords.get(key);
        const tool = toolRecords.get(key);
        const skill = skillRecords.get(key);
        if (tool !== undefined && skill !== undefined)
            return undefined;
        return tool ?? skill;
    };
    /**
     * Resolve a skill's root directory from the live skill registry. The
     * directory comes from the skill provider's own locator (`resourceBase` for
     * bundle skills, the SKILL.md parent for flat files) — never from caller input.
     */
    const skillRootOf = async (id) => {
        const name = id;
        const scope = skillScopes.get(name);
        const lookup = scope === undefined ? {} : { scope };
        const definition = await ctx.skills.get(name, lookup).catch(() => undefined);
        if (definition !== undefined) {
            if (definition.resourceBase !== undefined && definition.resourceBase.kind === 'directory') {
                return definition.resourceBase.path;
            }
            if (definition.path !== undefined)
                return dirname(definition.path);
        }
        return undefined;
    };
    /**
     * Index one visible tool schema into `next`, the accumulator owned by the
     * current rebuild pass, deduped by name.
     * 全部可见工具都进编目，仅排除 meta_search/meta_invoke（本插件控制面，
     * 恒常驻）与 run_code（Code Mode 保留传输层）。mcp__ 工具按真实 server
     * 分组；原生工具（无 mcp__ 前缀）统一归入保留的 built-in server，使能力
     * 菜单能统一按 server 分组、三档管理，meta_invoke 也能派发它们。
     * A schema may surface from several preset scope views; the first wins.
     */
    const indexToolSchema = (next, schema) => {
        if (CATALOG_EXCLUDED_TOOLS.has(schema.name))
            return;
        if (next.has(schema.name))
            return;
        const existing = toolRecords.get(schema.name);
        const stats = existing?.stats ?? { uses: 0, successes: 0, failures: 0, totalMs: 0 };
        const isMcp = schema.name.startsWith(MCP_ID_PREFIX);
        const serverName = isMcp ? serverNameOf(schema.name) : BUILT_IN_SERVER;
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
    };
    /**
     * Rebuild the tool index from the visible tool registries.
     *
     * Harness-native tools are registered on the agent plane (per agent preset's
     * standing scope), not the root/global layer the plugin's own `ctx.tools`
     * view sees — exactly the layout the skills side enumerates below. Mirror
     * that: index the global view first, then every mountable preset's standing
     * scope, so natives land under the reserved `built-in` pseudo-server.
     */
    // Rebuilds can overlap (eager mount-time run vs. a change-event refresh);
    // the epoch guard drops a superseded run so its older snapshot never
    // clobbers a newer one. The accumulator is local to each run for the same
    // reason: a shared one would be reset by the newer run mid-flight, letting
    // the older run publish a partial catalog when it wins the epoch check.
    let toolIndexEpoch = 0;
    // Remember which optional agent-preset service instance the registry has
    // already observed. Cordis may invoke an inject callback after another path
    // (such as an explicit refresh) has already enumerated the same instance;
    // scheduling again would trigger a redundant full scan on policy-only edits.
    let observedAgentPresets;
    const rebuildTools = async () => {
        const epoch = ++toolIndexEpoch;
        const nextToolRecords = new Map();
        for (const schema of ctx.tools.schemas())
            indexToolSchema(nextToolRecords, schema);
        const agentPresets = ctx.get('agentPresets');
        if (agentPresets !== undefined) {
            observedAgentPresets = agentPresets;
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
                    await withAgentPresetScope(agentPresets, preset.id, scope => {
                        for (const schema of ctx.tools.schemas(scope))
                            indexToolSchema(nextToolRecords, schema);
                    });
                }
                catch (error) {
                    ctx.logger.warn(`meta-registry: preset "${preset.id}" tool scope unavailable: ${String(error)}`);
                }
            }
        }
        if (epoch === toolIndexEpoch)
            toolRecords = nextToolRecords;
    };
    /**
     * Rebuild the skill index asynchronously; resolves when the refresh completes.
     *
     * Skills live in a per-scope registry: the global layer plus one layer per
     * agent preset that mounts skill providers (a preset's `skill-filesystem`
     * registers into that preset's layer, so the host-plane global read alone
     * sees nothing). The management catalog enumerates the global layer and then
     * every mountable preset's standing scope, so preset-scoped skills surface.
     *
     * Each skill records the preset it came from (see `CapabilityOrigin.preset`),
     * which is the only way to tell a preset's own `customSkillDirs` apart from a
     * user's: both are labelled `source: 'custom'`.
     *
     * Same-name rule: the global layer wins, then presets in enumeration order
     * (first wins). A skill id is a bare name with no namespace, so two scopes
     * declaring the same name can only yield one record; overwriting instead
     * would make the catalog depend on scan order rather than on where the skill
     * actually sits.
     *
     * Same epoch guard as the tool side: overlapping refreshes resolve out of
     * order, and a stale snapshot must not overwrite a newer one.
     */
    let skillIndexEpoch = 0;
    const refreshSkills = async () => {
        const epoch = ++skillIndexEpoch;
        const nextSkills = new Map();
        const nextSkillScopes = new Map();
        const nextUnavailable = new Map();
        const nextShadowed = new Map();
        const nextBroken = new Map();
        const nextUndocumented = new Map();
        const indexSkill = (skill, scope, preset) => {
            const id = skill.name;
            const descriptionIsPlaceholder = skill.description.replace(/[|\s\-—–_·•]+/g, '').trim().length === 0;
            if (descriptionIsPlaceholder)
                nextUndocumented.set(`${preset ?? 'global'}\0${id}`, { name: id, summary: toSkillSummary(skill.description, skill.whenToUse, id, summaryMaxChars) });
            if (!isModelInvocable(skill)) {
                nextUnavailable.set(`${preset ?? 'global'}\0${id}`, { name: id, source: skill.provider, ...(preset !== undefined ? { preset } : {}) });
                return;
            }
            // First wins (global layer, then presets in order): see the same-name
            // rule in this function's doc comment.
            if (nextSkills.has(id)) {
                const winner = nextSkills.get(id);
                const candidatePath = skill.resourceBase?.kind === 'directory' ? skill.resourceBase.path : undefined;
                if (winner.origin.provider === skill.provider && winner.origin.path === candidatePath)
                    return;
                nextShadowed.set(`${preset ?? 'global'}\0${id}`, {
                    name: id,
                    selectedFrom: winner.origin.preset ?? 'global',
                    shadowedFrom: preset ?? 'global',
                });
                return;
            }
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
                    ...preset !== undefined ? { preset } : {},
                    // The skill's own directory, when its provider has one. It is what lets
                    // the location manager address project-scoped skills for edit/remove.
                    ...skill.resourceBase?.kind === 'directory' ? { path: skill.resourceBase.path } : {},
                },
                parameters: { type: 'object', properties: {}, additionalProperties: false },
                invocation: { modelInvocable: skill.invocation.modelInvocable, userInvocable: skill.invocation.userInvocable },
                tags: [skill.provider, 'skill'],
                stats,
                summary: toSkillSummary(skill.description, skill.whenToUse, id, summaryMaxChars),
            });
            nextSkillScopes.set(id, scope);
        };
        const collectScoped = async (label, scope, preset) => {
            let skills = [];
            try {
                skills = scope === undefined ? await ctx.skills.list({}) : await ctx.skills.list({ scope });
            }
            catch (error) {
                ctx.logger.warn(`meta-registry: skill catalog refresh failed for ${label}: ${String(error)}`);
                return;
            }
            for (const skill of skills)
                indexSkill(skill, scope, preset);
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
                if (preset.broken !== undefined) {
                    nextBroken.set(preset.id, { id: preset.id, reason: preset.broken });
                    continue;
                }
                try {
                    await withAgentPresetScope(agentPresets, preset.id, scope => collectScoped(`preset "${preset.id}"`, scope, preset.id));
                }
                catch (error) {
                    nextBroken.set(preset.id, { id: preset.id, reason: String(error) });
                    ctx.logger.warn(`meta-registry: preset "${preset.id}" skill scope unavailable: ${String(error)}`);
                }
            }
        }
        if (epoch !== skillIndexEpoch)
            return;
        skillRecords = nextSkills;
        skillScopes = nextSkillScopes;
        unavailableSkills = [...nextUnavailable.values()];
        shadowedSkills = [...nextShadowed.values()];
        brokenPresets = [...nextBroken.values()];
        undocumentedSkills = [...nextUndocumented.values()];
    };
    /**
     * Emit the on-demand capability catalog as a YAML file the model can browse
     * with grep/read. Only On-demand capabilities are written; Resident ones are
     * already in the model surface and Disabled ones must stay undiscoverable.
     * Skips emission when the policy plugin is not mounted (no classification) or
     * the file path is disabled.
     */
    const writeCatalog = async () => {
        catalogError = undefined;
        onDemandCount = 0;
        if (catalogFile.length === 0)
            return;
        const policy = ctx.get('capabilityPolicy');
        if (policy === undefined)
            return;
        const onDemand = [...toolRecords.values(), ...skillRecords.values()]
            .filter(record => policy.classifyCapability(record.id, record.kind) === 'on-demand')
            .map(source => {
            const record = effectiveRecord(source);
            return {
                id: record.id,
                kind: record.kind,
                // Keep the file small so model-side grep/read remains useful.
                description: record.summary,
                ...record.whenToUse !== undefined ? { whenToUse: record.whenToUse } : {},
                ...record.origin.serverName !== undefined ? { server: record.origin.serverName } : {},
            };
        });
        onDemandCount = onDemand.length;
        const content = yaml.dump({ capabilities: onDemand });
        // A rebuild that changed nothing must not touch the disk: at debounce rate
        // this was rewriting the file several times a second.
        if (content === lastCatalogContent)
            return;
        try {
            await mkdir(dirname(catalogFile), { recursive: true });
            await writeFile(catalogFile, content, 'utf8');
            lastCatalogContent = content;
        }
        catch (error) {
            catalogError = String(error);
            ctx.logger.warn(`capability-registry: on-demand catalog write failed (${catalogFile}): ${String(error)}`);
        }
    };
    // --- Refresh scheduling --------------------------------------------------
    // Change events (`tools/change` / `skills/change`) arrive in bursts: the
    // skill/preset lifecycle invalidates caches and re-registers providers in
    // quick succession, and a rebuild's own registry access can emit further
    // change events. Rebuilding once per event produced an unbounded CPU storm
    // (a full preset re-scan per event), so the scheduler:
    //   1. runs at most one rebuild at a time (single flight);
    //   2. coalesces every event landing during a run into at most one
    //      debounced follow-up rebuild;
    //   3. lets an explicit `refresh()` await the rebuild chain covering its own
    //      call, so callers never observe a stale (or empty) catalog.
    // The epoch guards inside `rebuildTools`/`refreshSkills` stay as the last
    // line of defence for concurrent correctness.
    /** Monotonic count of rebuild requests received (events + explicit calls). */
    let eventSeq = 0;
    /** The `eventSeq` value fully applied by the last completed rebuild. */
    let appliedSeq = 0;
    let rebuilding = false;
    let stopped = false;
    let timer;
    const waiters = [];
    /** Resolve every waiter whose snapshot is already covered by `appliedSeq`. */
    const settleWaiters = () => {
        if (waiters.length === 0)
            return;
        const ready = waiters.filter(waiter => waiter.seq <= appliedSeq);
        if (ready.length === 0)
            return;
        for (const waiter of ready)
            waiters.splice(waiters.indexOf(waiter), 1);
        for (const waiter of ready)
            waiter.resolve();
    };
    /**
     * Consecutive rebuilds that reproduced the previous catalog. A noisy event
     * stream that never changes anything (session re-registrations, the skill
     * watcher) would otherwise keep the scheduler at the debounce rate, and each
     * rebuild re-enumerates every preset's tools and skills — measured at ~1.5s
     * CPU each, enough to starve the event loop and stall unrelated UI calls.
     */
    let idleStreak = 0;
    /** Upper bound for the backoff, so a real change is never pending long. */
    const BACKOFF_MAX_MS = 10_000;
    const currentDelay = () => {
        // The ceiling can never fall below the configured base, or a large
        // `refreshDebounceMs` would be clamped *down* into a faster schedule.
        const ceiling = Math.max(BACKOFF_MAX_MS, refreshDebounceMs);
        return Math.min(refreshDebounceMs * 2 ** idleStreak, ceiling);
    };
    /** Queue a coalesced rebuild after the (possibly backed-off) window. */
    const schedule = () => {
        if (stopped || rebuilding || timer !== undefined)
            return;
        timer = setTimeout(() => {
            timer = undefined;
            if (stopped || rebuilding)
                return;
            void runRebuild();
        }, currentDelay());
    };
    /**
     * Fingerprint of the indexed catalog — capability ids only, order-insensitive.
     * Used to tell a rebuild that found something new from one that merely
     * reproduced the previous catalog.
     */
    const catalogSignature = () => {
        const ids = [];
        for (const id of toolRecords.keys())
            ids.push(`t:${id}`);
        for (const id of skillRecords.keys())
            ids.push(`s:${id}`);
        ids.sort();
        return ids.join('\u0000');
    };
    let lastSignature;
    /** Consecutive follow-up runs that reproduced the previous catalog. */
    let unchangedChain = 0;
    /** One full rebuild; never rejects (a failed run must not hang waiters). */
    const runRebuild = async () => {
        rebuilding = true;
        // Every request received so far is covered by this run.
        const seqAtStart = eventSeq;
        const startedAt = Date.now();
        try {
            await rebuildTools();
            await refreshSkills();
            await writeCatalog();
        }
        catch (error) {
            ctx.logger.warn(`capability-registry: catalog rebuild failed: ${String(error)}`);
        }
        finally {
            rebuilding = false;
            if (seqAtStart > appliedSeq)
                appliedSeq = seqAtStart;
            settleWaiters();
            // Requests that landed mid-run are not covered yet, so chain a
            // follow-up — but never indefinitely. Two runs in a row that reproduce
            // the same catalog mean the pending events carried no new capability:
            // our own registry reads can emit change events, and dsh's skill watcher
            // can stream them, so chaining on would spin at the debounce rate
            // forever. One follow-up is still allowed before stopping, because a
            // real change that lands mid-run is only visible to the *next* run.
            const signature = catalogSignature();
            const changed = signature !== lastSignature;
            lastSignature = signature;
            // One line per full rebuild. These are the expensive runs (every tool plus
            // every agent-preset skill scope); if they are repeating, this is where it
            // shows — and a caller blocked behind one sees that as the UI stalling.
            ctx.logger.info(`capability-registry: rebuild took ${Date.now() - startedAt}ms (catalog changed: ${changed}, ${toolRecords.size} tools, ${skillRecords.size} skills)`);
            if (changed)
                idleStreak = 0;
            else if (idleStreak < 10)
                idleStreak += 1;
            if (!stopped && eventSeq > appliedSeq) {
                if (changed) {
                    unchangedChain = 0;
                    schedule();
                }
                else if (unchangedChain === 0) {
                    unchangedChain = 1;
                    schedule();
                }
            }
        }
    };
    /** Start a rebuild immediately, skipping the debounce window. */
    const runNow = () => {
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
        if (!stopped && !rebuilding)
            void runRebuild();
    };
    // The registry is also used in bundles without agent presets, so this is
    // intentionally an optional dependency. In the web host, however, the
    // capability plugin can mount before the preset service. Its first pass then
    // sees only global tools (which may be non-empty) and the later preset mounts
    // do not necessarily emit tools/change from this scope. Re-run the complete
    // inventory when agentPresets becomes available or is replaced; rebuildTools
    // will enumerate every healthy standing preset scope, independent of which
    // preset is the default for new sessions.
    ctx.inject(['agentPresets'], () => {
        const agentPresets = ctx.get('agentPresets');
        if (agentPresets === undefined || agentPresets === observedAgentPresets)
            return;
        observedAgentPresets = agentPresets;
        eventSeq++;
        schedule();
    });
    /**
     * Refresh the whole catalog, resolving once the rebuild chain covering this
     * call has converged (including any coalesced follow-up).
     */
    const refresh = async () => {
        if (stopped)
            return;
        const seq = ++eventSeq;
        runNow();
        if (seq <= appliedSeq)
            return;
        await new Promise(resolve => {
            waiters.push({ seq, resolve });
        });
    };
    /** Register once; also subscribe to change events. */
    const disposers = [];
    disposers.push(ctx.on('tools/change', () => {
        eventSeq++;
        schedule();
    }));
    disposers.push(ctx.on('skills/change', () => {
        eventSeq++;
        schedule();
    }));
    // Index the global tool view eagerly. The first explicit refresh enumerates
    // preset standing scopes; the optional-service injection above also triggers
    // a full pass if agentPresets is mounted after this plugin.
    void rebuildTools();
    void refreshSkills();
    ctx.effect(() => () => {
        stopped = true;
        if (timer !== undefined)
            clearTimeout(timer);
        // Unblock any in-flight `refresh()`: the plugin is going away and no
        // further rebuild will run.
        for (const waiter of waiters.splice(0))
            waiter.resolve();
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
            // Resident/On-demand is a projection-layer concern (`dsh-capability-policy`),
            // so an On-demand tool hidden from the model's exposure surface must still
            // be searchable so `meta_search` can return it for `meta_invoke`. Disabled
            // enforcement lives at the model-facing tools (meta_search/meta_invoke),
            // keeping the management surface able to list Disabled capabilities.
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
            const ranked = filtered.map(source => {
                const record = effectiveRecord(source);
                let score = 0;
                if (query !== undefined && query.length > 0) {
                    const exact = record.id === query || record.name === query;
                    if (exact)
                        score += 100;
                    score += keywordScore(record, tokens, overrideOf(source) === undefined);
                }
                const rate = successRate(record.stats);
                if (rate !== undefined && weighting > 0)
                    score += rate * weighting * 10;
                if (record.stats.uses > 0 && weighting > 0)
                    score += Math.min(record.stats.uses, 100) * weighting * 0.01;
                return { record, score };
            }).sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id));
            const limit = Math.max(1, options.maxResults ?? maxResults);
            const offset = options.offset ?? 0;
            if (!Number.isInteger(offset) || offset < 0)
                throw new Error('offset must be a non-negative integer');
            return ranked.slice(offset, offset + limit).map(({ record }) => {
                const rate = successRate(record.stats);
                return {
                    id: record.id,
                    kind: record.kind,
                    name: record.name,
                    summary: record.summary,
                    ...record.origin.serverName !== undefined ? { server: record.origin.serverName } : {},
                    ...record.origin.source !== undefined ? { source: record.origin.source } : {},
                    ...record.origin.preset !== undefined ? { preset: record.origin.preset } : {},
                    ...record.origin.path !== undefined ? { path: record.origin.path } : {},
                    tags: record.tags,
                    ...rate !== undefined ? { success_rate: rate } : {},
                    uses: record.stats.uses,
                };
            });
        },
        get(id, kind) {
            const record = resolveRecord(id.trim(), kind);
            return record === undefined ? undefined : effectiveRecord(record);
        },
        getSearchMetadata(id, kind) {
            const record = resolveRecord(id.trim(), kind);
            if (record === undefined)
                return undefined;
            const override = overrideOf(record);
            return {
                id: record.id,
                kind: record.kind,
                defaultDescription: record.summary,
                ...override !== undefined ? { description: override } : {},
                maxChars: summaryMaxChars,
            };
        },
        summaryMaxChars() {
            return summaryMaxChars;
        },
        searchSettingsEnabled() {
            return searchMetadataFile.length > 0;
        },
        async updateSummaryMaxChars(value) {
            assertPositiveInteger('summaryMaxChars', value, 20);
            if (!Number.isSafeInteger(value))
                throw new Error('summaryMaxChars must be a safe integer');
            if (searchMetadataFile.length === 0)
                throw new Error('检索信息存储未启用');
            const commit = metadataWrite.then(async () => {
                const tooLong = [...metadata].find(([, description]) => description.length > value);
                if (tooLong !== undefined) {
                    throw new Error(`已有检索描述超过 ${value} 个字符：${tooLong[0]}；请先缩短该描述`);
                }
                if (value === summaryMaxChars)
                    return;
                await persistSearchState(new Map(metadata), value);
                summaryMaxChars = value;
                await refresh();
            });
            metadataWrite = commit.then(() => undefined, () => undefined);
            await commit;
        },
        async updateSearchMetadata(input) {
            const record = resolveRecord(input.id.trim(), input.kind);
            if (record === undefined)
                throw new Error('能力不存在，无法修改检索描述');
            if (searchMetadataFile.length === 0)
                throw new Error('检索描述存储未启用');
            const description = input.description.replace(/\s+/g, ' ').trim();
            const key = metadataKey(input.kind, record.id);
            const commit = metadataWrite.then(async () => {
                if (description.length > summaryMaxChars)
                    throw new Error(`检索描述不能超过 ${summaryMaxChars} 个字符`);
                const next = new Map(metadata);
                const defaultDescription = record.kind === 'tool'
                    ? toSummary(record.description, summaryMaxChars)
                    : toSkillSummary(record.description, record.whenToUse, record.name, summaryMaxChars);
                if (description.length === 0 || description === defaultDescription)
                    next.delete(key);
                else
                    next.set(key, description);
                await persistSearchState(next, savedSummaryMaxChars);
                await writeCatalog();
            });
            metadataWrite = commit.then(() => undefined, () => undefined);
            await commit;
        },
        async getDetail(id, kind, context = {}) {
            const source = resolveRecord(id.trim(), kind);
            const record = source === undefined ? undefined : effectiveRecord(source);
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
            // Containment: the resolved path must stay inside the skill root, both
            // lexically (`..`) and after resolving symlinks (a link inside the skill
            // directory must not lead out of it).
            if (!(await isInside(root, target)))
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
            // Containment: see `listSkillDir` — lexical `..` and symlinks both checked.
            if (!(await isInside(root, target)))
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
        skillDirs() {
            const out = [];
            for (const record of skillRecords.values()) {
                const skillDir = record.origin.path;
                if (skillDir === undefined)
                    continue;
                out.push({
                    name: record.name,
                    skillDir,
                    ...record.origin.source !== undefined ? { source: record.origin.source } : {},
                });
            }
            return out;
        },
        diagnostics() {
            const policy = ctx.get('capabilityPolicy');
            const state = catalogFile.length === 0
                ? 'disabled'
                : policy === undefined
                    ? 'policy-unmounted'
                    : catalogError !== undefined
                        ? 'write-failed'
                        : onDemandCount === 0 ? 'empty' : 'ready';
            return {
                unavailableSkills,
                shadowedSkills,
                brokenPresets,
                undocumentedSkills,
                unbrowseableSkills: [...skillRecords.values()]
                    .filter(record => record.origin.path === undefined)
                    .map(record => ({ name: record.name, reason: '技能提供方没有可浏览的目录路径' })),
                catalog: {
                    state,
                    ...(catalogFile.length > 0 ? { path: catalogFile } : {}),
                    ...(catalogError !== undefined ? { error: catalogError } : {}),
                    count: onDemandCount,
                },
            };
        },
        size() {
            return toolRecords.size + skillRecords.size;
        },
        catalogPath() {
            return catalogFile.length === 0 ? undefined : catalogFile;
        },
        onDemandCount() {
            return onDemandCount;
        },
        version() {
            return appliedSeq;
        },
        refresh() {
            return refresh();
        },
        requestRefresh() {
            if (stopped)
                return;
            eventSeq++;
            schedule();
        },
        rewriteCatalog() {
            return writeCatalog();
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
//# sourceMappingURL=registry.js.map