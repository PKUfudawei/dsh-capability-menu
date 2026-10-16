/** Persist UI tier moves without touching dsh's watched patch files. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
function emptyState() {
    return { tool: new Map(), skill: new Map() };
}
function parseTierMap(value, key) {
    if (value === undefined)
        return new Map();
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${key} must be an object`);
    }
    const entries = Object.entries(value);
    for (const [name, tier] of entries) {
        if (name.length === 0 || (tier !== 'resident' && tier !== 'on-demand' && tier !== 'disabled')) {
            throw new Error(`${key} contains an invalid tier for ${JSON.stringify(name)}`);
        }
    }
    return new Map(entries);
}
/** Missing files mean no UI overrides; malformed files fail instead of losing edits. */
export async function readTierState(file) {
    let source;
    try {
        source = await readFile(file, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return emptyState();
        throw error;
    }
    const data = JSON.parse(source);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('tier state must be an object');
    }
    const record = data;
    if (record['version'] !== 1)
        throw new Error('unsupported tier state version');
    return {
        tool: parseTierMap(record['tools'], 'tools'),
        skill: parseTierMap(record['skills'], 'skills'),
    };
}
/** Merge only this instance's moves with the latest file, then replace atomically. */
export async function writeTierState(file, moves) {
    if (moves.tool.size === 0 && moves.skill.size === 0)
        return false;
    const state = await readTierState(file);
    let changed = false;
    for (const kind of ['tool', 'skill']) {
        for (const [name, tier] of moves[kind]) {
            if (state[kind].get(name) === tier)
                continue;
            state[kind].set(name, tier);
            changed = true;
        }
    }
    if (!changed)
        return false;
    const content = JSON.stringify({
        version: 1,
        tools: Object.fromEntries(state.tool),
        skills: Object.fromEntries(state.skill),
    }, null, 2) + '\n';
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${randomUUID()}`;
    try {
        await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        await rename(temporary, file);
    }
    catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
    return true;
}
//# sourceMappingURL=policy-state.js.map