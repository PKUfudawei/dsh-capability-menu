/**
 * Location registry: the places capabilities come from.
 *
 * Two kinds of location, each following the medium dsh itself uses:
 *
 * - **MCP servers** are declared as `@deepseek-ai/dsh-mcp-client` rows in the
 *   patch file. Writing the row is all we do — dsh mounts the server, reconnects
 *   and disposes it. That is why this module never imports `dsh-mcp-client`,
 *   never mounts a fiber, and never has to arbitrate `serverName` reservations:
 *   there is exactly one source of truth (the file) and one owner (dsh).
 * - **Skill directories** are registered in the user or project skill root.
 *   Local sources are symlinked; GitHub imports copy only the selected subtree.
 *   No patch entry, no hot reload.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, cp, readdir, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import yaml from 'js-yaml';
import { addEntry, defaultPatchFile, mutatePatch, readEntries, removeEntry, setEntryConfig } from "./patch-file.js";
/** Plugin name of the MCP bridge, as declared in patch rows. */
export const MCP_CLIENT_PLUGIN = '@deepseek-ai/dsh-mcp-client';
/** `serverName` must match `[A-Za-z0-9_-]{1,32}` and be unique per scope. */
const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
const GITHUB_IMPORT_PREFIX = '.capability-menu-import-';
const execFileAsync = promisify(execFile);
export function defaultLocationConfig() {
    return {
        patchFile: defaultPatchFile(),
        skillsDir: defaultSkillsDir(),
    };
}
/** Default skill root: the user root `skill-filesystem` scans with no config. */
export function defaultSkillsDir() {
    const home = process.env['DSH_HOME'];
    if (home !== undefined && home.length > 0)
        return join(home, 'skills');
    return join(homedir(), '.dsh', 'skills');
}
export class LocationRegistry {
    ctx;
    config;
    constructor(ctx, config) {
        this.ctx = ctx;
        this.config = config;
    }
    // --- MCP servers -------------------------------------------------------
    /** Every MCP server declared in the patch file, in file order. */
    async listMcp() {
        const entries = await readEntries(this.config.patchFile).catch((error) => {
            this.ctx.logger.warn(`capability-locations: cannot read ${this.config.patchFile}: ${String(error)}`);
            return [];
        });
        const rows = [];
        for (const entry of entries) {
            if (entry.name !== MCP_CLIENT_PLUGIN)
                continue;
            const config = entry.config ?? {};
            const serverName = config['serverName'];
            if (typeof serverName !== 'string')
                continue;
            const transport = config['transport'] === 'stdio' ? 'stdio' : 'streamable-http';
            const command = typeof config['command'] === 'string' ? config['command'] : undefined;
            const args = Array.isArray(config['args'])
                ? config['args'].filter((arg) => typeof arg === 'string')
                : undefined;
            const url = typeof config['url'] === 'string' ? config['url'] : undefined;
            const cwd = typeof config['cwd'] === 'string' ? config['cwd'] : undefined;
            const env = stringRecord(config['env']);
            const headers = stringRecord(config['headers']);
            const timeout = typeof config['toolCallTimeoutMs'] === 'number' ? config['toolCallTimeoutMs'] : undefined;
            rows.push({
                id: entry.id,
                serverName,
                transport,
                disabled: entry.disabled === true,
                ...command !== undefined ? { command } : {},
                ...args !== undefined && args.length > 0 ? { args } : {},
                ...url !== undefined ? { url } : {},
                ...cwd !== undefined ? { cwd } : {},
                ...env !== undefined ? { env } : {},
                ...headers !== undefined ? { headers } : {},
                ...timeout !== undefined ? { toolCallTimeoutMs: timeout } : {},
            });
        }
        return rows;
    }
    /** Declare a new MCP server row. Throws on invalid or duplicate input. */
    async addMcp(input) {
        const serverName = input.serverName.trim();
        if (!SERVER_NAME_RE.test(serverName)) {
            throw new Error(`serverName 必须匹配 [A-Za-z0-9_-]{1,32}：${serverName}`);
        }
        if (input.transport === 'stdio' && (input.command ?? '').trim().length === 0) {
            throw new Error('stdio 传输必须提供 command');
        }
        if (input.transport === 'streamable-http' && (input.url ?? '').trim().length === 0) {
            throw new Error('streamable-http 传输必须提供 url');
        }
        // Duplicate `serverName` fails at mount time with a reservation error, so
        // reject it here where the user can still fix the form.
        const rows = await this.listMcp();
        if (rows.some(row => row.serverName === serverName)) {
            throw new Error(`serverName 已被占用：${serverName}`);
        }
        const id = `mcp-${serverName}`;
        if (rows.some(row => row.id === id)) {
            throw new Error(`条目 id 已存在：${id}`);
        }
        const written = await mutatePatch(this.config.patchFile, doc => {
            addEntry(doc, { id, name: MCP_CLIENT_PLUGIN, config: mcpConfig(input) });
            return true;
        });
        if (written)
            this.ctx.logger.info(`capability-locations: registered MCP server "${serverName}"`);
        return id;
    }
    /** Remove a declared MCP server. Returns false when the row is absent. */
    async removeMcp(id) {
        const known = await this.hasMcp(id);
        if (!known)
            return false;
        const written = await mutatePatch(this.config.patchFile, doc => removeEntry(doc, id));
        if (written)
            this.ctx.logger.info(`capability-locations: removed MCP row "${id}"`);
        return written;
    }
    /**
     * Replace a declared server's connection config. The row id (and therefore
     * `serverName`, which is baked into every `mcp__<serverName>__<tool>` tool
     * name, session history and permission rule) is never changed here.
     */
    async updateMcp(id, input) {
        const rows = await this.listMcp();
        const existing = rows.find(row => row.id === id);
        if (existing === undefined)
            return false;
        if (input.transport === 'stdio' && (input.command ?? '').trim().length === 0) {
            throw new Error('stdio 传输必须提供 command');
        }
        if (input.transport === 'streamable-http' && (input.url ?? '').trim().length === 0) {
            throw new Error('streamable-http 传输必须提供 url');
        }
        const written = await mutatePatch(this.config.patchFile, doc => setEntryConfig(doc, id, 
        // Keep the existing serverName: it is the row's identity.
        mcpConfig({ ...input, serverName: existing.serverName })));
        if (written)
            this.ctx.logger.info(`capability-locations: updated MCP server "${existing.serverName}"`);
        return written;
    }
    async hasMcp(id) {
        const rows = await this.listMcp();
        return rows.some(row => row.id === id);
    }
    // --- Skill directories -------------------------------------------------
    // --- Skill directories -------------------------------------------------
    //
    // Two root shapes are managed: the default user root (`~/.dsh/skills`, or
    // `$DSH_HOME/skills`) and a project's own `<projectRoot>/.dsh/skills`. dsh also
    // scans `~/.agents/skills` and `<projectRoot>/.agents/skills`; entries there
    // are listed and editable when a project's root produced them, but a
    // registration always writes the `.dsh` root.
    /** Every entry under the default (user) skill root. */
    async listSkills() {
        let names = [];
        try {
            names = await readdir(this.config.skillsDir);
        }
        catch (error) {
            this.ctx.logger.warn(`capability-locations: cannot read ${this.config.skillsDir}: ${String(error)}`);
            return [];
        }
        const rows = [];
        for (const name of names) {
            if (name.startsWith(GITHUB_IMPORT_PREFIX))
                continue;
            const row = await describeSkillEntry(this.config.skillsDir, name, 'user');
            if (row !== undefined)
                rows.push(row);
        }
        return rows.sort((a, b) => a.name.localeCompare(b.name));
    }
    /**
     * Which skills directory an operation targets.
     *
     * `entryDir` comes back from a listing and is taken as given, but validated —
     * a caller must not be able to aim `remove` at an arbitrary tree. Otherwise,
     * `projectPath` is a path *inside* a project and the project root is derived
     * from it exactly the way dsh derives it; with neither, the user root.
     */
    async resolveSkillsDir(entryDir, projectPath) {
        if (entryDir !== undefined && entryDir.length > 0) {
            const dir = resolve(entryDir);
            if (dir !== resolve(this.config.skillsDir))
                await assertSkillsDir(dir);
            return dir;
        }
        const asked = projectPath?.trim() ?? '';
        if (asked.length === 0)
            return this.config.skillsDir;
        if (!isAbsolute(asked))
            throw new Error('项目路径必须是绝对路径');
        const start = await realpath(asked).catch(() => undefined);
        if (start === undefined)
            throw new Error(`项目路径不存在：${asked}`);
        const projectRoot = await findProjectRoot(start);
        this.ctx.logger.info(`capability-locations: project path "${asked}" resolves to project root "${projectRoot}"`);
        return join(projectRoot, '.dsh/skills');
    }
    /**
     * Register a skill directory by symlinking it into a managed root — the user
     * root by default, or a project's `.dsh/skills` when `projectPath` is given.
     * Returns the entry path actually written, so the caller can report where the
     * skill landed instead of leaving the operator to guess.
     */
    async addSkill(dir, projectPath) {
        const skillsDir = await this.resolveSkillsDir(undefined, projectPath);
        if (!isAbsolute(dir))
            throw new Error('skill 目录必须是绝对路径');
        const target = await realpath(dir).catch(() => undefined);
        if (target === undefined)
            throw new Error(`skill 目录不存在：${dir}`);
        const info = await stat(target);
        if (!info.isDirectory())
            throw new Error(`不是目录：${dir}`);
        const manifest = await checkSkillManifest(target);
        if (!manifest.ok)
            throw new Error(manifest.message);
        const name = basename(target);
        if (name.length === 0)
            throw new Error(`无法从路径推导技能名：${dir}`);
        const link = join(skillsDir, name);
        const existing = await lstat(link).catch(() => undefined);
        if (existing !== undefined) {
            throw new Error(skillsDir === this.config.skillsDir
                ? `技能「${name}」已存在`
                : `技能「${name}」已存在于该项目的 ${skillsDir}`);
        }
        await mkdir(skillsDir, { recursive: true });
        await symlink(target, link, 'dir');
        this.ctx.logger.info(`capability-locations: linked skill "${name}" → ${target} (root ${skillsDir})`);
        return link;
    }
    /** Import one public GitHub skill directory into the selected managed root. */
    async importSkillFromGitHub(url, projectPath) {
        const source = parseGitHubSkillUrl(url);
        const skillsDir = await this.resolveSkillsDir(undefined, projectPath);
        const name = source.path === '.' ? source.repo : basename(source.path);
        const destination = join(skillsDir, name);
        if (await lstat(destination).then(() => true, () => false)) {
            throw new Error(`技能「${name}」已存在于 ${skillsDir}`);
        }
        const checkoutRootParent = this.config.skillsDir;
        await mkdir(checkoutRootParent, { recursive: true });
        const checkoutRoot = await mkdtemp(join(checkoutRootParent, GITHUB_IMPORT_PREFIX));
        const repoDir = join(checkoutRoot, 'repo');
        let targetStage;
        try {
            await runGit([
                '-c', 'credential.helper=',
                '-c', 'credential.interactive=never',
                'clone', '--depth=1', '--filter=blob:none', '--sparse', '--single-branch',
                ...source.ref !== undefined ? [`--branch=${source.ref}`] : [],
                '--', source.repoUrl, repoDir,
            ]);
            await runGit(['-C', repoDir, 'sparse-checkout', 'set', '--cone', '--', source.path]);
            const sourceDir = source.path === '.' ? repoDir : resolve(repoDir, ...source.path.split('/'));
            const outsideRepo = relative(repoDir, sourceDir);
            if (outsideRepo === '..' || outsideRepo.startsWith(`..${sep}`) || isAbsolute(outsideRepo)) {
                throw new Error('GitHub 技能目录路径无效');
            }
            const sourceStat = await stat(sourceDir).catch(() => undefined);
            if (sourceStat?.isDirectory() !== true) {
                throw new Error(`仓库中没有该目录：${source.path}`);
            }
            await assertSafeSkillTree(sourceDir, source.path === '.');
            const manifest = await checkSkillManifest(sourceDir);
            if (!manifest.ok)
                throw new Error(manifest.message);
            await mkdir(skillsDir, { recursive: true });
            if (await lstat(destination).then(() => true, () => false)) {
                throw new Error(`技能「${name}」已存在于 ${skillsDir}`);
            }
            targetStage = await mkdtemp(join(skillsDir, GITHUB_IMPORT_PREFIX));
            const stagedSkill = join(targetStage, name);
            await cp(sourceDir, stagedSkill, {
                recursive: true,
                force: false,
                errorOnExist: true,
                filter: path => !(source.path === '.' && basename(path) === '.git'),
            });
            const copiedManifest = await checkSkillManifest(stagedSkill);
            if (!copiedManifest.ok)
                throw new Error(copiedManifest.message);
            await rename(stagedSkill, destination);
            this.ctx.logger.info(`capability-locations: imported GitHub skill "${manifest.name}" from ${url.trim()} → ${destination}`);
            return destination;
        }
        catch (error) {
            if (isGitMissing(error))
                throw new Error('导入 GitHub Skill 需要在运行 dsh 的机器上安装 git');
            if (isGitFailure(error)) {
                const detail = gitFailureMessage(error);
                throw new Error(`GitHub 检出失败：${detail}`);
            }
            throw error;
        }
        finally {
            if (targetStage !== undefined)
                await rm(targetStage, { recursive: true, force: true }).catch(() => undefined);
            await rm(checkoutRoot, { recursive: true, force: true }).catch(error => {
                this.ctx.logger.warn(`capability-locations: cannot clean temporary GitHub checkout ${checkoutRoot}: ${String(error)}`);
            });
        }
    }
    /**
     * Unregister a skill entry. Only removes a symlink or a directory that
     * actually carries a `SKILL.md` — never an arbitrary file.
     */
    async removeSkill(name, entryDir) {
        if (name.includes('/') || name.includes('..') || name.length === 0) {
            throw new Error(`无效的技能名：${name}`);
        }
        const skillsDir = await this.resolveSkillsDir(entryDir);
        const path = join(skillsDir, name);
        const info = await lstat(path).catch(() => undefined);
        if (info === undefined)
            return false;
        if (info.isSymbolicLink()) {
            await rm(path);
            this.ctx.logger.info(`capability-locations: unlinked skill "${name}" (root ${skillsDir})`);
            return true;
        }
        if (info.isDirectory() && (await readSkillManifest(path)) !== undefined) {
            await rm(path, { recursive: true });
            this.ctx.logger.info(`capability-locations: removed skill directory "${name}" (root ${skillsDir})`);
            return true;
        }
        throw new Error(`「${name}」不是可移除的技能目录`);
    }
    /**
     * Repoint a registered skill at a different directory: unlink the old entry
     * and link the new one under the same name. The name is the skill's identity
     * in `ctx.skills`, so a rename is a remove + add, not an update.
     */
    async updateSkill(name, dir, entryDir) {
        const skillsDir = await this.resolveSkillsDir(entryDir);
        const existing = await describeSkillEntry(skillsDir, name, entryDir === undefined ? 'user' : 'project');
        if (existing === undefined)
            return false;
        if (!isAbsolute(dir))
            throw new Error('skill 目录必须是绝对路径');
        const target = await realpath(dir).catch(() => undefined);
        if (target === undefined)
            throw new Error(`skill 目录不存在：${dir}`);
        if (!(await stat(target)).isDirectory())
            throw new Error(`不是目录：${dir}`);
        const manifest = await checkSkillManifest(target);
        if (!manifest.ok)
            throw new Error(manifest.message);
        // Resolve the current target so re-submitting the same path is a no-op
        // rather than an unlink/relink that briefly removes the skill.
        const current = await realpath(existing.path).catch(() => undefined);
        if (current === target)
            return false;
        await this.removeSkill(name, entryDir);
        await symlink(target, join(skillsDir, name), 'dir');
        this.ctx.logger.info(`capability-locations: repointed skill "${name}" → ${target} (root ${skillsDir})`);
        return true;
    }
}
/**
 * Describe `<entryDir>/<name>` as a skill entry, or `undefined` when nothing
 * there looks like one. Used both for listing the user root and for describing
 * project entries that dsh discovered on its own.
 */
export async function describeSkillEntry(entryDir, name, root) {
    if (name.length === 0 || name.includes('/') || name.includes('..'))
        return undefined;
    const path = join(entryDir, name);
    const info = await lstat(path).catch(() => undefined);
    if (info === undefined)
        return undefined;
    // A skill entry is either a directory or a link to one.
    if (!(info.isDirectory() || info.isSymbolicLink()))
        return undefined;
    const target = await realpath(path).catch(() => undefined);
    if (target === undefined)
        return undefined;
    if ((await stat(target).catch(() => undefined))?.isDirectory() !== true)
        return undefined;
    const manifest = await checkSkillManifest(target);
    return {
        name,
        ...manifest.ok ? { skillName: manifest.name } : {},
        path,
        linked: info.isSymbolicLink(),
        valid: manifest.ok,
        root,
        entryDir,
        target,
    };
}
/** True when `dir` has the shape of a project skills root. */
export function isProjectSkillsDir(dir) {
    const owner = basename(dirname(dir));
    return basename(dir) === 'skills' && (owner === '.dsh' || owner === '.agents');
}
/** True when `path` exists, of any type. */
async function pathExists(path) {
    return await access(path).then(() => true, () => false);
}
/**
 * The project root dsh derives from a working directory: the nearest ancestor
 * carrying `.git`, falling back to the starting directory when there is none.
 *
 * Mirrors `findProjectRoot` in `@deepseek-ai/dsh-skill-filesystem`, which looks
 * for project skills under `<projectRoot>/.dsh/skills` and
 * `<projectRoot>/.agents/skills`. A directory placed anywhere else is never
 * scanned, so this walk has to agree with dsh's exactly — otherwise we would
 * write entries that nothing ever loads, which is the silent failure this whole
 * code path exists to avoid.
 */
async function findProjectRoot(start) {
    let current = start;
    for (;;) {
        if (await pathExists(join(current, '.git')))
            return current;
        const parent = dirname(current);
        if (parent === current)
            return start;
        current = parent;
    }
}
/**
 * Guard for a skills directory a caller handed back to us. It must be a
 * canonical `<projectRoot>/.dsh/skills` (or `.agents/skills`) whose project root
 * carries `.git` — precisely the condition under which dsh scans it — so
 * update/remove can never be aimed at a tree dsh does not read.
 */
async function assertSkillsDir(dir) {
    if (!isProjectSkillsDir(dir)) {
        throw new Error(`不是可管理的技能目录（应为 <项目>/.dsh/skills 或 <项目>/.agents/skills）：${dir}`);
    }
    const projectRoot = dirname(dirname(dir));
    if (!(await pathExists(join(projectRoot, '.git')))) {
        throw new Error(`项目根下没有 .git，dsh 不会扫描该目录：${projectRoot}`);
    }
}
/** Accept a public GitHub repo root or an explicit tree URL. */
function parseGitHubSkillUrl(input) {
    let url;
    try {
        url = new URL(input.trim());
    }
    catch {
        throw new Error('请输入有效的 GitHub 目录链接');
    }
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port.length > 0
        || url.username.length > 0 || url.password.length > 0 || url.search.length > 0 || url.hash.length > 0) {
        throw new Error('仅支持不带凭据、参数或片段的公开 GitHub HTTPS 链接');
    }
    if (url.pathname.includes('//'))
        throw new Error('GitHub 技能目录链接格式无效');
    let parts;
    try {
        parts = url.pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part));
    }
    catch {
        throw new Error('GitHub 技能目录链接包含无效的 URL 编码');
    }
    const [owner, repo, tree, ref, ...pathParts] = parts;
    const repositoryRoot = parts.length === 2;
    if (owner === undefined || repo === undefined || (!repositoryRoot && tree !== 'tree')
        || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)
        || repo === '.' || repo === '..'
        || (!repositoryRoot && (ref === undefined || ref.length === 0 || ref.startsWith('-') || ref.includes('..') || ref.includes('\\') || /[\u0000-\u0020]/.test(ref)))) {
        throw new Error('链接应为含根目录 SKILL.md 的仓库地址 https://github.com/{owner}/{repo}，或目录地址 https://github.com/{owner}/{repo}/tree/{branch}/{skill-directory}');
    }
    if (!repositoryRoot && pathParts.some(part => part.length === 0 || part === '.' || part === '..' || part.includes('/') || part.includes('\\') || part.includes('\0'))) {
        throw new Error('GitHub 技能目录路径无效');
    }
    return {
        repoUrl: `https://github.com/${owner}/${repo}.git`,
        ...ref !== undefined ? { ref } : {},
        path: repositoryRoot || pathParts.length === 0 ? '.' : pathParts.join('/'),
        repo,
    };
}
async function runGit(args) {
    await execFileAsync('git', args, {
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    });
}
/** Reject links and special files so an imported tree cannot escape its folder. */
async function assertSafeSkillTree(dir, repositoryRoot = false) {
    const root = await lstat(dir);
    if (!root.isDirectory())
        throw new Error('GitHub 中指定的技能目录必须是普通目录');
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (repositoryRoot && entry.name === '.git')
            continue;
        const path = join(dir, entry.name);
        if (entry.isSymbolicLink())
            throw new Error(`技能目录不接受符号链接：${entry.name}`);
        if (entry.isDirectory())
            await assertSafeSkillTree(path);
        else if (!entry.isFile())
            throw new Error(`技能目录包含不支持的文件类型：${entry.name}`);
    }
}
function isGitMissing(error) {
    return error !== null && typeof error === 'object'
        && 'path' in error && error.path === 'git'
        && 'code' in error && error.code === 'ENOENT';
}
function isGitFailure(error) {
    return error !== null && typeof error === 'object'
        && 'stderr' in error && 'cmd' in error && String(error.cmd).includes('git');
}
function gitFailureMessage(error) {
    if (error !== null && typeof error === 'object') {
        const stderr = 'stderr' in error ? String(error.stderr ?? '').trim() : '';
        const message = 'message' in error ? String(error.message ?? '').trim() : '';
        if (stderr.length > 0)
            return stderr;
        if (message.length > 0)
            return message;
    }
    return String(error);
}
/** Build the `config:` block of a `dsh-mcp-client` row. */
function mcpConfig(input) {
    const config = {
        serverName: input.serverName.trim(),
        transport: input.transport,
    };
    if (input.transport === 'stdio') {
        config['command'] = (input.command ?? '').trim();
        if (input.args !== undefined && input.args.length > 0)
            config['args'] = [...input.args];
        if (input.env !== undefined && Object.keys(input.env).length > 0)
            config['env'] = { ...input.env };
        if (input.cwd !== undefined && input.cwd.trim().length > 0)
            config['cwd'] = input.cwd.trim();
    }
    else {
        config['url'] = (input.url ?? '').trim();
        if (input.headers !== undefined && Object.keys(input.headers).length > 0)
            config['headers'] = { ...input.headers };
    }
    // Only write a timeout when explicitly set, so an unset field keeps falling
    // back to the `dsh-mcp-client` default instead of pinning today's value.
    if (input.toolCallTimeoutMs !== undefined && Number.isFinite(input.toolCallTimeoutMs)) {
        config['toolCallTimeoutMs'] = input.toolCallTimeoutMs;
    }
    return config;
}
/** Narrow an unknown config value to a string→string map, or undefined. */
function stringRecord(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return undefined;
    const out = {};
    for (const [key, item] of Object.entries(value)) {
        if (typeof item === 'string')
            out[key] = item;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}
/**
 * Skill-name grammar enforced by `@deepseek-ai/dsh-skill` (`isSkillName`):
 * lowercase alphanumerics in kebab-case.
 */
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/**
 * Invocation keys the loader reads, and the legacy spellings it rejects. Both
 * are optional; a legacy key or a value that cannot be read as a boolean makes
 * `parseInvocationPolicy` throw, which drops the whole skill.
 */
const INVOCATION_KEYS = ['disable-model-invocation', 'user-invocable'];
const LEGACY_INVOCATION_KEYS = [
    ['disableModelInvocation', 'disable-model-invocation'],
    ['modelInvocable', 'disable-model-invocation'],
    ['userInvocable', 'user-invocable'],
];
/** Read `dir/SKILL.md`, or `undefined` when it is missing or unreadable. */
async function readSkillManifest(dir) {
    return await readFile(join(dir, 'SKILL.md'), 'utf8').catch(() => undefined);
}
/** The failing side of {@link SkillManifestCheck}. */
function manifestProblem(message) {
    return { ok: false, message };
}
/**
 * Validate the manifest in `dir` the way `@deepseek-ai/dsh-skill-filesystem`
 * will when it loads the skill root.
 *
 * The loader needs YAML frontmatter that parses to a mapping carrying a
 * kebab-case `name` and a `description`, and an invocation policy it can read
 * (`parseSkillFile` in that package); for anything else it logs a warning and
 * *silently skips* the skill. A directory that fails those checks would
 * therefore register successfully here and then never appear in a session, so
 * we run the same checks and reject loudly.
 */
async function checkSkillManifest(dir) {
    const raw = await readSkillManifest(dir);
    if (raw === undefined)
        return manifestProblem(`目录中没有 SKILL.md：${dir}`);
    const front = parseFrontmatter(raw);
    if (front === 'no-frontmatter') {
        return manifestProblem(`SKILL.md 缺少 YAML frontmatter（首行需为 --- 并以 --- 闭合）：${dir}`);
    }
    if (front === 'bad-yaml') {
        return manifestProblem(`SKILL.md 的 frontmatter 不是合法的 YAML 对象：${dir}`);
    }
    const { name, description } = front;
    if (typeof name !== 'string' || typeof description !== 'string') {
        return manifestProblem(`SKILL.md 的 frontmatter 需要字符串 name 和 description：${dir}`);
    }
    if (!SKILL_NAME_RE.test(name)) {
        return manifestProblem(`SKILL.md 的 name「${name}」不是合法技能名（仅小写字母、数字与连字符，如 my-skill）：${dir}`);
    }
    const problem = checkInvocation(front, dir);
    if (problem !== undefined)
        return manifestProblem(problem);
    return { ok: true, name };
}
/**
 * Validate the invocation fields. A skill without them is fine — the loader
 * defaults to model- and user-invocable — but one it cannot parse is dropped,
 * so a legacy spelling or a non-boolean value is rejected here with the
 * canonical replacement named. Returns the problem, or undefined when the
 * fields are all readable.
 */
function checkInvocation(front, dir) {
    for (const [legacy, canonical] of LEGACY_INVOCATION_KEYS) {
        if (Object.hasOwn(front, legacy)) {
            return `SKILL.md 的 frontmatter 字段「${legacy}」已废弃，请改用「${canonical}」：${dir}`;
        }
    }
    for (const key of INVOCATION_KEYS) {
        if (Object.hasOwn(front, key) && !isFrontmatterBoolean(front[key])) {
            return `SKILL.md 的 frontmatter 字段「${key}」必须是布尔值：${dir}`;
        }
    }
    return undefined;
}
/**
 * Whether the loader would read `value` as a boolean: a boolean, the numbers
 * 1/0, or an on/off word in any case. Mirrors `frontmatterBoolean` in
 * `@deepseek-ai/dsh-skill-filesystem`, so a manifest it accepts is not
 * rejected here.
 */
function isFrontmatterBoolean(value) {
    if (typeof value === 'boolean')
        return true;
    if (value === 1 || value === 0 || value === '1' || value === '0')
        return true;
    if (typeof value !== 'string')
        return false;
    return ['true', 'false', 'yes', 'no', 'on', 'off'].includes(value.toLowerCase());
}
/**
 * Split the `---`-delimited YAML frontmatter off a markdown document, mirroring
 * the loader's parser: the opening `---` must be the first line and a closing
 * `---` must exist on a line of its own.
 */
function parseFrontmatter(raw) {
    const firstLineEnd = raw.indexOf('\n');
    if (firstLineEnd < 0)
        return 'no-frontmatter';
    if (raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---')
        return 'no-frontmatter';
    let closing = -1;
    let lineStart = firstLineEnd + 1;
    while (lineStart <= raw.length) {
        const nextNewline = raw.indexOf('\n', lineStart);
        const lineEnd = nextNewline < 0 ? raw.length : nextNewline;
        if (raw.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') {
            closing = lineStart;
            break;
        }
        if (nextNewline < 0)
            break;
        lineStart = nextNewline + 1;
    }
    if (closing < 0)
        return 'no-frontmatter';
    let parsed;
    try {
        parsed = yaml.load(raw.slice(firstLineEnd + 1, closing));
    }
    catch {
        return 'bad-yaml';
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        return 'bad-yaml';
    return parsed;
}
//# sourceMappingURL=locations.js.map