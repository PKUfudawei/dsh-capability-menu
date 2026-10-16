/**
 * Resident / On-demand / Disabled capability projection policy for the DeepSeek
 * Harness.
 *
 * @module @daweifu/capability-menu (policy plugin)
 */
import z from '@deepseek-ai/schemastery';
import { escapeText } from '@deepseek-ai/dsh-skill';
import { serverNameOf } from "./registry.js";
import { addEntryOverride, findEntry, mutatePatch, setEntryConfig } from "./patch-file.js";
import { LocationRegistry, defaultLocationConfig, } from "./locations.js";
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
    patchFile: z.string(),
    skillsDir: z.string(),
    /**
     * How long a tier change waits before it is written to the patch file. Long
     * enough that a burst of clicks produces one write, because every write makes
     * dsh hot-reload this plugin and re-run the catalog enumeration.
     */
    persistDebounceMs: z.number().default(1500),
});
export const DEFAULT_META_TOOLS = ['meta_search', 'meta_invoke'];
/**
 * Upper bound on the catalog refresh `apply` awaits before it finishes mounting
 * (see the end of `apply`). Generous: a healthy refresh resolves in
 * milliseconds, and the failure this guards against never resolves at all.
 */
const CATALOG_REFRESH_TIMEOUT_MS = 5_000;
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
            // tool `bash` whose public name is its bare name).
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
    // Mutable runtime state so the management surface (能力菜单) can live-update
    // the policy without a reload.
    let current = normalized;
    let metaTools = [...(normalized.metaTools ?? DEFAULT_META_TOOLS)];
    let metaToolSet = new Set(metaTools);
    let toolCompiled;
    let skillCompiled;
    // Location registry: the places capabilities come from. Editing the patch
    // file makes dsh hot-reload and mount/unmount the server itself, so this
    // plugin never imports or drives `dsh-mcp-client` directly.
    const defaults = defaultLocationConfig();
    const patchFile = (config.patchFile ?? defaults.patchFile).trim();
    const locations = new LocationRegistry(ctx, {
        patchFile,
        skillsDir: (config.skillsDir ?? defaults.skillsDir).trim(),
    });
    /**
     * Tier rules are persisted into the profile patch, in the entry the bundle
     * already declares for this plugin. Until now that config field was resolved
     * and never read: the surface edited memory only, so every tier change was
     * lost on restart.
     *
     * Persisting is deferred rather than done per click. A click recompiles the
     * rule sets in memory, which is what makes it feel instant; a patch write, by
     * contrast, makes dsh hot-reload this plugin — and its mount awaits a full
     * catalog enumeration. Debouncing puts that cost after the operator stops
     * clicking instead of on every click.
     */
    const POLICY_ENTRY_ID = 'capability-menu-policy';
    const POLICY_ENTRY_NAME = '@daweifu/capability-menu/policy';
    const persistDebounceMs = config.persistDebounceMs ?? 1500;
    let persistTimer;
    /**
     * Tier moves this instance made, per capability kind: id → the class the
     * operator put it in. Persisting replays exactly these onto the lists the
     * *file* already has, so the file stays authoritative.
     *
     * Writing the whole in-memory rule set out instead loses entries this
     * instance never saw: another profile (or a hand edit) can have added or
     * moved rules since this instance loaded, and any later write — including the
     * teardown flush — would then put the stale set back, so flipping one
     * capability silently rewrote its neighbours.
     */
    const movedTiers = {
        tool: new Map(),
        skill: new Map(),
    };
    /** Order-insensitive signature of one rule set (resident / on-demand / disabled). */
    const tierSetSignature = (rules) => {
        if (rules === null || typeof rules !== 'object')
            return '';
        const record = rules;
        return ['resident', 'on-demand', 'disabled']
            .map(tier => Array.isArray(record[tier]) ? [...record[tier]].sort().join('\u0000') : '')
            .join('\u0001');
    };
    /** The three classes, in the order every patch file lists them. */
    const TIER_KEYS = ['resident', 'on-demand', 'disabled'];
    /** One set config's three lists as writable arrays (non-string entries dropped). */
    const tierLists = (set) => {
        const record = set !== null && typeof set === 'object' && !Array.isArray(set)
            ? set
            : {};
        const lists = { resident: [], 'on-demand': [], disabled: [] };
        for (const tier of TIER_KEYS) {
            const raw = record[tier];
            lists[tier] = Array.isArray(raw) ? raw.filter((entry) => typeof entry === 'string') : [];
        }
        return lists;
    };
    /** `name → class` for one set config, so two views can be compared per id. */
    const classByName = (set) => {
        const map = new Map();
        const lists = tierLists(set);
        for (const tier of TIER_KEYS) {
            for (const name of lists[tier])
                map.set(name, tier);
        }
        return map;
    };
    /** Record the ids whose class differs between two set configs. */
    const recordMoves = (previousSet, nextSet, moves) => {
        const previous = classByName(previousSet);
        for (const [name, tier] of classByName(nextSet)) {
            if (previous.get(name) !== tier)
                moves.set(name, tier);
        }
    };
    /** Apply `id → class` moves to one set's own lists, leaving other entries alone. */
    const replayMoves = (set, moves) => {
        const lists = tierLists(set);
        for (const [name, tier] of moves) {
            for (const key of TIER_KEYS)
                lists[key] = lists[key].filter(entry => entry !== name);
            lists[tier] = [...lists[tier], name];
        }
        return lists;
    };
    /**
     * Order-insensitive signature of the whole policy config (tools + skills).
     *
     * The function operates on the *full config* object (`{ tools, skills,
     * metaTools, ... }`) — the tier arrays live at `config.tools.*` and
     * `config.skills.*`, never at the top level. Passing the config directly
     * (rather than the inner `tools` / `skills` objects) used to make both
     * sides of the comparison empty (`'\u0001\u0001'`) and silently swallow
     * every tier change after the first write. Splitting the comparison along
     * the real structure keeps the no-op optimization while letting an actual
     * change land.
     */
    const policyTierSignature = (config) => {
        if (config === null || typeof config !== 'object')
            return '\u0002';
        const record = config;
        return [
            tierSetSignature(record['tools']),
            tierSetSignature(record['skills']),
        ].join('\u0002');
    };
    /** Serialize writes so a later click cannot race an earlier patch rewrite. */
    let persistInFlight = Promise.resolve();
    /** Write validated moves into the patch, when they differ from the file. */
    const writeTiers = async () => {
        if (patchFile.length === 0)
            return;
        const toolMoves = new Map(movedTiers.tool);
        const skillMoves = new Map(movedTiers.skill);
        const configAtWrite = current;
        try {
            const written = await mutatePatch(patchFile, doc => {
                const existing = findEntry(doc, POLICY_ENTRY_ID);
                // Merge instead of replace: the row can carry keys this surface never
                // edits (`metaTools`, a legacy rule spelling), and patch semantics
                // replace the whole `config:` value.
                const raw = existing?.get('config');
                const prior = raw?.toJSON?.();
                const next = typeof prior === 'object' && prior !== null
                    ? { ...prior }
                    : {};
                if (existing === undefined) {
                    // An override row, never an insert: this file is normally not where the
                    // policy row comes from — the package's own bundle patch inserts it,
                    // and a home/profile layer is applied after that one. Inserting a
                    // second row with the same id would compose into a tree the loader
                    // rejects (`duplicate loader entry id: capability-menu-policy`), so the
                    // config has to be landed on the row that already exists.
                    next['tools'] = configAtWrite.tools ?? {};
                    next['skills'] = configAtWrite.skills ?? {};
                    addEntryOverride(doc, { id: POLICY_ENTRY_ID, name: POLICY_ENTRY_NAME, config: next });
                    return true;
                }
                // Nothing moved since the last write: not writing at all is what keeps a
                // no-op flush — and a plain restart — from making dsh reload the plugin.
                if (toolMoves.size === 0 && skillMoves.size === 0)
                    return false;
                // Replay this instance's own moves onto the file's lists instead of
                // writing the in-memory sets out wholesale (see `movedTiers`): entries
                // another writer touched since this instance loaded stay as it left them.
                const priorRecord = (prior ?? {});
                if (toolMoves.size > 0)
                    next['tools'] = replayMoves(priorRecord['tools'], toolMoves);
                if (skillMoves.size > 0)
                    next['skills'] = replayMoves(priorRecord['skills'], skillMoves);
                // Rewriting an unchanged config would still make dsh reload the plugin.
                if (policyTierSignature(prior) === policyTierSignature(next))
                    return false;
                return setEntryConfig(doc, POLICY_ENTRY_ID, next);
            });
            // A no-op means another writer already landed these moves. Retire only
            // the snapshot just handled: a click made during the disk write stays
            // queued for the next serialized write.
            for (const [name, tier] of toolMoves)
                if (movedTiers.tool.get(name) === tier)
                    movedTiers.tool.delete(name);
            for (const [name, tier] of skillMoves)
                if (movedTiers.skill.get(name) === tier)
                    movedTiers.skill.delete(name);
            if (written)
                ctx.logger.info(`capability-policy: persisted tier rules to ${patchFile}`);
        }
        catch (error) {
            ctx.logger.warn(`capability-policy: cannot persist tier rules to ${patchFile}: ${String(error)}`);
        }
    };
    const persistTiers = () => {
        persistInFlight = persistInFlight.then(writeTiers);
        return persistInFlight;
    };
    const schedulePersistTiers = () => {
        if (patchFile.length === 0)
            return;
        if (persistTimer !== undefined)
            clearTimeout(persistTimer);
        persistTimer = setTimeout(() => {
            persistTimer = undefined;
            void persistTiers();
        }, persistDebounceMs);
    };
    // A pending write must not be dropped when the plugin is torn down (a hot
    // reload tears it down): flush it, so the file matches the state that was
    // live. The flush finds the config unchanged and writes nothing, so it cannot
    // start a reload loop. Returning an async disposer lets Cordis await the
    // write before letting the new instance (or shutdown) proceed, so a HMR
    // cannot race ahead of a pending persist.
    ctx.effect(() => async () => {
        if (persistTimer !== undefined) {
            clearTimeout(persistTimer);
            persistTimer = undefined;
            await persistTiers();
        }
        else {
            await persistInFlight;
        }
    }, 'capability-menu-policy: flush tier persistence');
    /**
     * Compile a candidate config into rule sets without touching live state.
     * Meta tools are the control-plane escape hatch: blocking one is a
     * misconfiguration that must fail loud, never silently disable the surface.
     * Throws before anything is committed when validation fails.
     */
    const compileConfig = (candidate, meta) => {
        const toolRules = compileSet(candidate.tools);
        const skillRules = compileSet(candidate.skills);
        // Normalize tool/skill rule kinds for matching.
        const tools = {
            resident: toolRules.resident.map(rule => ({ ...rule, kind: 'tool' })),
            onDemand: toolRules.onDemand.map(rule => ({ ...rule, kind: 'tool' })),
            disabled: toolRules.disabled.map(rule => ({ ...rule, kind: 'tool' })),
        };
        const skills = {
            resident: skillRules.resident.map(rule => ({ ...rule, kind: 'skill' })),
            onDemand: skillRules.onDemand.map(rule => ({ ...rule, kind: 'skill' })),
            disabled: skillRules.disabled.map(rule => ({ ...rule, kind: 'skill' })),
        };
        for (const name of meta) {
            const target = { id: name, name, server: serverNameOf(name), kind: 'tool', ruleKind: 'tool' };
            if (anyRuleMatches(tools.disabled, target)) {
                throw new Error(`meta tool "${name}" cannot be disabled; remove it from tools.disabled`);
            }
        }
        return { tools, skills };
    };
    /**
     * Compile, then commit. Compiling first keeps a rejected update from landing
     * half-applied: `current`, `metaTools` and the rule sets move together or not
     * at all.
     */
    const applyConfig = (candidate, meta) => {
        const compiled = compileConfig(candidate, meta);
        current = candidate;
        metaTools = [...meta];
        metaToolSet = new Set(metaTools);
        toolCompiled = compiled.tools;
        skillCompiled = compiled.skills;
    };
    applyConfig(normalized, [...(normalized.metaTools ?? DEFAULT_META_TOOLS)]);
    const service = {
        classifyTool(name) {
            const server = serverNameOf(name);
            return classify(toolCompiled, { id: name, name, server, kind: 'tool', ruleKind: 'tool' }, metaToolSet);
        },
        classifySkill(name) {
            return classify(skillCompiled, { id: name, name, kind: 'skill', ruleKind: 'skill' }, new Set());
        },
        classifyCapability(id, kind) {
            // `kind` disambiguates a bare name shared by a tool and a skill.
            return kind === 'skill' ? service.classifySkill(id) : service.classifyTool(id);
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
            // Only the materialized On-demand catalog on disk depends on the
            // classification: the model-facing projection is derived from the rules
            // on every assemble, so it needs no rebuild. Cycling a capability
            // between Resident and Disabled changes nothing on disk, so it must not
            // pay for a full re-enumeration.
            const updateStartedAt = Date.now();
            const before = onDemandSignature();
            const previousTools = current.tools;
            const previousSkills = current.skills;
            const merged = { ...current, ...partial };
            // Validate first, commit second (see `applyConfig`): a rejected update
            // leaves the live policy exactly as it was.
            applyConfig(merged, partial.metaTools !== undefined ? [...(partial.metaTools ?? DEFAULT_META_TOOLS)] : metaTools);
            // Only a validated update can enter the pending disk journal. Diffing
            // against the previous in-memory view excludes unrelated stale entries.
            recordMoves(previousTools, merged.tools, movedTiers.tool);
            recordMoves(previousSkills, merged.skills, movedTiers.skill);
            // The On-demand set moved, so the grep-able YAML is stale (and a
            // capability reclassified to Disabled must disappear from it). Re-emit it
            // from the index we already have and await that: it is a filter plus a
            // small write, so awaiting keeps the file consistent with what the UI is
            // about to read. `requestRefresh` would instead re-enumerate every tool
            // and every agent preset scope — no inventory changed, and the cost of
            // that was exactly what made a tier click feel like a hang.
            const moved = onDemandSignature() !== before;
            if (moved)
                await ctx.capability.rewriteCatalog();
            // One line per tier write: the whole handler's cost, and whether the
            // catalog was re-emitted. A slow click with a fast line here means the
            // time went somewhere else (a queued rebuild, the carrier, the browser).
            ctx.logger.info(`capability-policy: tier write took ${Date.now() - updateStartedAt}ms (catalog rewritten: ${moved})`);
            schedulePersistTiers();
        },
        classifyAll() {
            // The registry default maxResults (20) would truncate the management
            // surface: enumerate every indexed capability, not just the top-20.
            return ctx.capability.search({ maxResults: Number.MAX_SAFE_INTEGER }).map(summary => {
                const cls = service.classifyCapability(summary.id, summary.kind);
                const mandatory = summary.kind === 'tool' && metaToolSet.has(summary.id);
                // Summaries carry no directory, so a skill's own is resolved from its
                // record — the same lookup 纳入管理 itself uses to decide what to link.
                const skillPath = summary.kind === 'skill'
                    ? ctx.capability.get(summary.id, 'skill')?.origin.path
                    : undefined;
                return {
                    id: summary.id,
                    kind: summary.kind,
                    name: summary.name,
                    ...summary.server !== undefined ? { server: summary.server } : {},
                    ...summary.source !== undefined ? { source: summary.source } : {},
                    ...summary.preset !== undefined ? { preset: summary.preset } : {},
                    ...skillPath !== undefined ? { path: skillPath } : {},
                    class: cls,
                    classLabel: CLASS_LABELS[cls],
                    mandatory,
                };
            });
        },
        // — location registry —
        listLocations() {
            return locations.listMcp();
        },
        addLocation(input) {
            return locations.addMcp(input);
        },
        removeLocation(id) {
            return locations.removeMcp(id);
        },
        updateLocation(id, input) {
            return locations.updateMcp(id, input);
        },
        listSkillLocations() {
            return locations.listSkills();
        },
        addSkillLocation(dir, projectPath) {
            return locations.addSkill(dir, projectPath);
        },
        importSkillFromGitHub(url, projectPath) {
            return locations.importSkillFromGitHub(url, projectPath);
        },
        removeSkillLocation(name, entryDir) {
            return locations.removeSkill(name, entryDir);
        },
        updateSkillLocation(name, dir, entryDir) {
            return locations.updateSkill(name, dir, entryDir);
        },
    };
    /**
     * Fingerprint of the capability ids currently classified On-demand. This set
     * is the only thing a classification change can invalidate on disk, so it
     * decides whether `updateConfig` needs to request a rebuild at all.
     */
    const onDemandSignature = () => {
        const ids = ctx.capability
            .search({ maxResults: Number.MAX_SAFE_INTEGER })
            .filter(summary => service.classifyCapability(summary.id, summary.kind) === 'on-demand')
            .map(summary => `${summary.kind}:${summary.id}`);
        ids.sort();
        return ids.join('\u0000');
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
            if (source?.kind !== 'skill-catalog')
                return message;
            if (!Array.isArray(source.entries)) {
                // Cannot tell which skills the message lists, so it stays untouched —
                // but say so: silently skipping the filter would leak Disabled skills
                // into the model surface with no trace.
                ctx.logger.warn('capability-policy: skill-catalog message has no entries array; leaving it unfiltered');
                return message;
            }
            const entries = source.entries.filter((entry) => typeof entry === 'object' && entry !== null && typeof entry.name === 'string');
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
    //
    // A pending preset scope must not hold this fiber in `loading` forever. On
    // timeout, emit the catalog from whatever the registry has indexed so far;
    // the original refresh remains in flight and will replace it if it finishes.
    let refreshTimer;
    let needsFallback = false;
    try {
        const outcome = await Promise.race([
            ctx.capability.refresh().then(() => 'complete'),
            new Promise(resolve => {
                refreshTimer = setTimeout(() => resolve('timeout'), CATALOG_REFRESH_TIMEOUT_MS);
                refreshTimer.unref();
            }),
        ]);
        if (outcome === 'timeout') {
            needsFallback = true;
            ctx.logger.warn(`capability-policy: catalog refresh still pending after ${CATALOG_REFRESH_TIMEOUT_MS}ms; emitting current index`);
        }
    }
    catch (error) {
        needsFallback = true;
        ctx.logger.warn(`capability-policy: on-demand catalog refresh failed: ${String(error)}`);
    }
    finally {
        if (refreshTimer !== undefined)
            clearTimeout(refreshTimer);
    }
    if (needsFallback) {
        // Run after this plugin settles so the registry can resolve the provided
        // policy service when it writes the catalog.
        setTimeout(() => {
            void ctx.capability.rewriteCatalog().catch((error) => {
                ctx.logger.warn(`capability-policy: fallback catalog write failed: ${String(error)}`);
            });
        }, 0).unref();
    }
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