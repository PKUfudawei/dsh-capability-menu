import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lstat, readFile, readdir, realpath, unlink, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
const PACKAGE = '@daweifu/capability-menu';
const run = promisify(execFile);
let installing = false;
function compareVersions(left, right) {
    const parse = (value) => {
        const match = /^(\d+)\.(\d+)\.(\d+)(?:-([\da-z.-]+))?(?:\+[\da-z.-]+)?$/i.exec(value);
        if (!match)
            throw new Error(`Unsupported version: ${value}`);
        return { parts: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4]?.split('.') ?? [] };
    };
    const a = parse(left);
    const b = parse(right);
    for (let i = 0; i < 3; i++) {
        if (a.parts[i] !== b.parts[i])
            return Math.sign(a.parts[i] - b.parts[i]);
    }
    if (a.prerelease.length === 0 || b.prerelease.length === 0)
        return Math.sign(b.prerelease.length - a.prerelease.length);
    for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
        const x = a.prerelease[i];
        const y = b.prerelease[i];
        if (x === undefined || y === undefined)
            return x === undefined ? -1 : 1;
        if (x === y)
            continue;
        const xn = /^\d+$/.test(x);
        const yn = /^\d+$/.test(y);
        if (xn && yn)
            return Math.sign(Number(x) - Number(y));
        if (xn !== yn)
            return xn ? -1 : 1;
        return x < y ? -1 : 1;
    }
    return 0;
}
async function packageRoot() {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 5; i++, dir = dirname(dir)) {
        try {
            const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
            if (manifest.name === PACKAGE)
                return dir;
        }
        catch { /* Continue toward the package root. */ }
    }
    throw new Error('Cannot locate capability-menu package');
}
async function activeProfile(root) {
    const home = process.env['DSH_HOME']?.trim() || join(homedir(), '.dsh');
    const profiles = join(home, 'profiles');
    const matches = [];
    for (const entry of await readdir(profiles, { withFileTypes: true }).catch(() => [])) {
        if (!entry.isDirectory() || !/^[\w-]+$/.test(entry.name))
            continue;
        const dir = join(profiles, entry.name);
        const installed = join(dir, 'node_modules', PACKAGE);
        try {
            await lstat(installed);
            if (await realpath(installed) !== await realpath(root))
                continue;
            const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
            const spec = manifest.dependencies?.[PACKAGE] ?? '';
            const source = /^(?:file:|link:|workspace:)/.test(spec) ? 'local'
                : spec === 'latest' || spec === '*' || /^[~^=]?\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i.test(spec) ? 'registry'
                    : 'other';
            matches.push({ name: entry.name, dir, source });
        }
        catch { /* This profile does not own this package. */ }
    }
    if (matches.length === 1)
        return matches[0];
    const active = process.env['DSH_PROFILE'];
    return active ? matches.find(profile => profile.name === active) : undefined;
}
async function latestVersion() {
    const response = await fetch('https://registry.npmjs.org/@daweifu%2Fcapability-menu/latest', {
        signal: AbortSignal.timeout(10_000),
        headers: { accept: 'application/json' },
    });
    if (!response.ok)
        throw new Error(`npm registry returned HTTP ${response.status}`);
    const data = await response.json();
    if (typeof data.version !== 'string')
        throw new Error('npm registry returned no version');
    return data.version;
}
export async function checkSelfUpdate() {
    const root = await packageRoot();
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    const latest = await latestVersion();
    const profile = await activeProfile(root);
    return {
        current: manifest.version,
        latest,
        updateAvailable: compareVersions(latest, manifest.version) > 0,
        updatable: profile?.source === 'registry',
        ...(profile?.source === 'local' ? { sourcePath: root } : {}),
        ...(!profile ? { reason: 'profile-unavailable' }
            : profile.source === 'local' ? { reason: 'local' }
                : profile.source === 'other' ? { reason: 'non-registry' } : {}),
    };
}
async function installVersion(version, expectedSource) {
    if (installing)
        throw new Error('An update is already in progress');
    installing = true;
    try {
        const status = await checkSelfUpdate();
        if (!status.updateAvailable || status.latest !== version)
            throw new Error('The requested version is no longer the latest update');
        const profile = await activeProfile(await packageRoot());
        if (!profile || profile.source !== expectedSource)
            throw new Error('The installation source changed; check for updates again');
        const manifestPath = join(profile.dir, 'package.json');
        const lockPath = join(profile.dir, 'pnpm-lock.yaml');
        const oldManifest = await readFile(manifestPath, 'utf8');
        const oldLock = await readFile(lockPath, 'utf8').catch(() => undefined);
        // `dsh plugin add package@version` can retain an existing `^` range and
        // its newer lockfile resolution. Pin the profile manifest first, then make
        // pnpm resolve that exact requirement.
        try {
            await run('pnpm', ['--dir', profile.dir, 'pkg', 'set', `dependencies.${PACKAGE}=${version}`], {
                timeout: 30_000,
                maxBuffer: 1024 * 1024,
            });
            const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
            if (manifest.dependencies?.[PACKAGE] !== version)
                throw new Error('Could not pin the profile dependency to the requested version');
            await run('pnpm', ['--dir', profile.dir, 'install'], {
                timeout: 180_000,
                maxBuffer: 1024 * 1024,
            });
            const installed = JSON.parse(await readFile(join(profile.dir, 'node_modules', PACKAGE, 'package.json'), 'utf8'));
            if (installed.version !== version)
                throw new Error(`Installed version ${installed.version ?? 'unknown'} differs from ${version}`);
        }
        catch (error) {
            try {
                await writeFile(manifestPath, oldManifest);
                if (oldLock === undefined)
                    await unlink(lockPath).catch(() => undefined);
                else
                    await writeFile(lockPath, oldLock);
                await run('pnpm', ['--dir', profile.dir, 'install', '--frozen-lockfile'], {
                    timeout: 180_000,
                    maxBuffer: 1024 * 1024,
                });
            }
            catch (rollbackError) {
                throw new Error(`Update failed: ${String(error)}; restoring the previous installation also failed: ${String(rollbackError)}`);
            }
            throw error;
        }
    }
    finally {
        installing = false;
    }
}
export async function installSelfUpdate(version) {
    await installVersion(version, 'registry');
}
export async function switchSelfToNpm(version) {
    await installVersion(version, 'local');
}
//# sourceMappingURL=self-update.js.map