/** Persistent menu choices, kept outside dsh's watched patch files. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { emptyOverrides, validateOverrides } from "./preset-policy.js";
function emptyState() {
    return {
        tiers: { tool: new Map(), skill: new Map() },
        search: { descriptions: new Map() },
    };
}
function object(value, label) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    return value;
}
function parseTierMap(value, key) {
    if (value === undefined)
        return new Map();
    const entries = Object.entries(object(value, key));
    for (const [name, tier] of entries) {
        if (name.length === 0 || (tier !== 'resident' && tier !== 'on-demand' && tier !== 'disabled')) {
            throw new Error(`${key} contains an invalid tier for ${JSON.stringify(name)}`);
        }
    }
    return new Map(entries);
}
function parseSearch(value) {
    if (value === undefined)
        return { descriptions: new Map() };
    const record = object(value, 'search state');
    const limit = record['summaryMaxChars'];
    if (limit !== undefined && (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 20)) {
        throw new Error('search.summaryMaxChars must be an integer of at least 20');
    }
    const descriptions = new Map();
    if (record['descriptions'] !== undefined) {
        for (const [key, description] of Object.entries(object(record['descriptions'], 'search.descriptions'))) {
            if (!/^(tool|skill):.+/.test(key) || typeof description !== 'string' || description.trim().length === 0) {
                throw new Error(`search.descriptions contains an invalid entry for ${JSON.stringify(key)}`);
            }
            descriptions.set(key, description.trim());
        }
    }
    return { ...(limit !== undefined ? { summaryMaxChars: limit } : {}), descriptions };
}
function parseMenuState(source) {
    const record = object(JSON.parse(source), 'menu state');
    if (![1, 2, 3, 4].includes(record['version']))
        throw new Error('unsupported menu state version');
    const modes = record['version'] === 4 ? Object.fromEntries(Object.entries(object(record['modes'] ?? {}, 'modes')).map(([id, raw]) => {
        const row = object(raw, 'mode policy');
        for (const kind of ['tools', 'skills']) {
            if (row[kind] === undefined)
                continue;
            for (const [tier, rules] of Object.entries(object(row[kind], kind))) {
                if (!['resident', 'on-demand', 'disabled'].includes(tier) || !Array.isArray(rules) || rules.some(rule => typeof rule !== 'string'))
                    throw new Error('Invalid mode rules');
            }
        }
        return [id, { tools: row['tools'], skills: row['skills'], choices: validateOverrides(row['choices']) }];
    })) : undefined;
    return {
        modes,
        overrides: Object.fromEntries(Object.entries(object(record['overrides'] ?? {}, 'overrides')).map(([key, value]) => [key, validateOverrides(value)])),
        tiers: {
            tool: parseTierMap(record['tools'], 'tools'),
            skill: parseTierMap(record['skills'], 'skills'),
        },
        search: record['version'] !== 1 ? parseSearch(record['search']) : { descriptions: new Map() },
    };
}
/** Missing files mean no UI choices; malformed files fail instead of losing edits. */
export async function readMenuState(file) {
    let source;
    try {
        source = await readFile(file, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return emptyState();
        throw error;
    }
    return parseMenuState(source);
}
export async function readTierState(file) {
    return (await readMenuState(file)).tiers;
}
/** Old registry storage: `_settings` plus `tool:id` / `skill:id` objects. */
function parseLegacySearch(source) {
    const record = object(JSON.parse(source), 'legacy search metadata');
    const settings = record['_settings'];
    const limit = settings !== null && typeof settings === 'object' && !Array.isArray(settings)
        ? settings['summaryMaxChars'] : undefined;
    const descriptions = new Map();
    for (const [key, value] of Object.entries(record)) {
        if (!/^(tool|skill):.+/.test(key) || value === null || typeof value !== 'object' || Array.isArray(value))
            continue;
        const description = value['description'];
        if (typeof description === 'string' && description.trim().length > 0)
            descriptions.set(key, description.trim());
    }
    return {
        ...(typeof limit === 'number' && Number.isSafeInteger(limit) && limit >= 20 ? { summaryMaxChars: limit } : {}),
        descriptions,
    };
}
/** A short-lived cross-process lock prevents policy and registry writes from clobbering each other. */
async function withStateLock(file, action) {
    await mkdir(dirname(file), { recursive: true });
    const lock = `${file}.lock`;
    const deadline = Date.now() + 10_000;
    while (true) {
        try {
            await mkdir(lock);
            break;
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
            const age = await stat(lock).then(info => Date.now() - info.mtimeMs, () => 0);
            if (age > 30_000)
                await rmdir(lock).catch(() => undefined);
            if (Date.now() >= deadline)
                throw new Error(`timed out waiting for menu state lock: ${lock}`);
            await new Promise(resolve => setTimeout(resolve, 25));
        }
    }
    try {
        return await action();
    }
    finally {
        await rmdir(lock);
    }
}
async function replaceState(file, state) {
    const content = JSON.stringify({
        version: state.modes ? 4 : 3,
        ...(state.modes ? { modes: state.modes } : {}),
        overrides: state.overrides ?? {},
        tools: Object.fromEntries(state.tiers.tool),
        skills: Object.fromEntries(state.tiers.skill),
        search: {
            ...(state.search.summaryMaxChars !== undefined ? { summaryMaxChars: state.search.summaryMaxChars } : {}),
            descriptions: Object.fromEntries([...state.search.descriptions].sort(([a], [b]) => a.localeCompare(b))),
        },
    }, null, 2) + '\n';
    const temporary = `${file}.tmp-${randomUUID()}`;
    try {
        await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        await rename(temporary, file);
    }
    catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
}
/** Migrate once under the same lock used for menu writes. */
export async function initializeModePolicies(file, modes) {
    return withStateLock(file, async () => {
        const state = await readMenuState(file);
        if (state.modes)
            return state.modes;
        await replaceState(file, { ...state, modes });
        return modes;
    });
}
export async function writeModeChoices(file, preset, changes) {
    return withStateLock(file, async () => {
        const state = await readMenuState(file);
        const modes = { ...state.modes };
        const mode = Object.hasOwn(modes, preset) ? modes[preset] : { choices: emptyOverrides() };
        const next = { ...mode, choices: validateOverrides(mode.choices) };
        for (const { kind, id, tier } of changes)
            Object.defineProperty(next.choices[kind], id, { value: tier, enumerable: true, writable: true, configurable: true });
        Object.defineProperty(modes, preset, { value: next, enumerable: true, writable: true, configurable: true });
        await replaceState(file, { ...state, modes });
        return next;
    });
}
/** Merge the old search file once, then move it aside as a backup. */
export async function migrateLegacySearchState(file, legacyFile) {
    if (file.length === 0 || legacyFile.length === 0 || file === legacyFile)
        return false;
    let source;
    try {
        source = await readFile(legacyFile, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return false;
        throw error;
    }
    const legacy = parseLegacySearch(source);
    return withStateLock(file, async () => {
        const state = await readMenuState(file);
        // Tier edits may have upgraded a version 1 file to version 2 with an empty
        // search section. That still needs the legacy descriptions imported.
        const alreadySaved = state.search.summaryMaxChars !== undefined || state.search.descriptions.size > 0;
        if (!alreadySaved)
            await replaceState(file, { ...state, search: legacy });
        // A second process might have edited the old file while we waited for the
        // lock. Preserve that newer source for a later migration attempt.
        if (await readFile(legacyFile, 'utf8').catch(() => undefined) === source) {
            await rename(legacyFile, `${legacyFile}.migrated-${randomUUID()}.bak`).catch(error => {
                if (error.code !== 'ENOENT')
                    throw error;
            });
        }
        return !alreadySaved;
    });
}
/** Merge only this instance's tier moves with the latest file. */
export async function writeTierState(file, moves) {
    if (moves.tool.size === 0 && moves.skill.size === 0)
        return false;
    return withStateLock(file, async () => {
        const state = await readMenuState(file);
        let changed = false;
        for (const kind of ['tool', 'skill']) {
            for (const [name, tier] of moves[kind]) {
                if (state.tiers[kind].get(name) === tier)
                    continue;
                state.tiers[kind].set(name, tier);
                changed = true;
            }
        }
        if (changed)
            await replaceState(file, state);
        return changed;
    });
}
/** Change one search field without replacing tier or unrelated search choices. */
export async function writeSearchState(file, change) {
    await withStateLock(file, async () => {
        const state = await readMenuState(file);
        const search = {
            summaryMaxChars: change.summaryMaxChars ?? state.search.summaryMaxChars,
            descriptions: new Map(state.search.descriptions),
        };
        if (change.description !== undefined) {
            if (change.description.value === undefined)
                search.descriptions.delete(change.description.key);
            else
                search.descriptions.set(change.description.key, change.description.value);
        }
        const newLimit = change.summaryMaxChars;
        if (newLimit !== undefined) {
            const tooLong = [...search.descriptions].find(([, value]) => value.length > newLimit);
            if (tooLong !== undefined)
                throw new Error(`已有检索描述超过 ${newLimit} 个字符：${tooLong[0]}`);
        }
        else if (change.description?.value !== undefined && search.summaryMaxChars !== undefined
            && change.description.value.length > search.summaryMaxChars) {
            throw new Error(`检索描述不能超过 ${search.summaryMaxChars} 个字符`);
        }
        await replaceState(file, { ...state, search });
    });
}
/** Compatibility writes for callers without a mode; never used by the menu. */
export async function writeLegacyGlobalChoices(file, changes) {
    await withStateLock(file, async () => {
        const state = await readMenuState(file);
        const overrides = { ...state.overrides };
        const current = validateOverrides(overrides[''] ?? emptyOverrides());
        for (const change of changes) {
            if (change.kind !== 'servers')
                state.tiers[change.kind === 'tools' ? 'tool' : 'skill'].delete(change.id);
            if (change.tier === null)
                delete current[change.kind][change.id];
            else
                Object.defineProperty(current[change.kind], change.id, { value: change.tier, enumerable: true, configurable: true, writable: true });
        }
        Object.defineProperty(overrides, '', { value: current, enumerable: true, configurable: true, writable: true });
        await replaceState(file, { ...state, overrides });
    });
}
//# sourceMappingURL=policy-state.js.map