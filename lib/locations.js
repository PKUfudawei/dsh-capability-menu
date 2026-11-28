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
import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { access, cp, readdir, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import yaml from 'js-yaml';
import { addEntry, defaultPatchFile, mutatePatch, readEntries, removeEntry, setEntryConfig } from "./patch-file.js";
/** Plugin name of the MCP bridge, as declared in patch rows. */
export const MCP_CLIENT_PLUGIN = '@deepseek-ai/dsh-mcp-client';
/** `serverName` must match `[A-Za-z0-9_-]{1,32}` and be unique per scope. */
const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
const GITHUB_IMPORT_PREFIX = '.capability-menu-import-';
const GITHUB_SOURCE_FILE = '.capability-menu-sources.json';
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
    sourceWrite = Promise.resolve();
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
        await this.forgetGitHubSource(skillsDir, name);
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
        let installed = false;
        try {
            await runGit([
                '-c', 'credential.helper=',
                '-c', 'credential.interactive=never',
                'clone', '--depth=1', '--filter=blob:none', '--sparse', '--single-branch',
                ...source.ref !== undefined ? [`--branch=${source.ref}`] : [],
                '--', source.repoUrl, repoDir,
            ]);
            await runGit(['-C', repoDir, 'sparse-checkout', ...(source.path === '.' ? ['disable'] : ['set', '--cone', '--', source.path])]);
            const sourceDir = source.path === '.' ? repoDir : resolve(repoDir, ...source.path.split('/'));
            const outsideRepo = relative(repoDir, sourceDir);
            if (outsideRepo === '..' || outsideRepo.startsWith(`..${sep}`) || isAbsolute(outsideRepo)) {
                throw new Error('GitHub 技能目录路径无效');
            }
            const sourceStat = await stat(sourceDir).catch(() => undefined);
            if (sourceStat?.isDirectory() !== true) {
                throw new Error(`仓库中没有该目录：${source.path}`);
            }
            const manifest = await checkGitHubManifest(repoDir, source);
            await assertSafeSkillTree(sourceDir, source.path === '.');
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
            const installedRevision = await runGit(['-C', repoDir, 'rev-parse', 'HEAD']);
            const installedTree = await gitSkillTree(repoDir, source.path);
            const installedDigest = await skillDigest(stagedSkill);
            await rename(stagedSkill, destination);
            installed = true;
            await this.saveGitHubSource(skillsDir, name, {
                url: url.trim(), installedRevision, installedTree, installedDigest, skillName: copiedManifest.name,
            });
            this.ctx.logger.info(`capability-locations: imported GitHub skill "${manifest.name}" from ${url.trim()} → ${destination}`);
            return destination;
        }
        catch (error) {
            if (installed)
                await rm(destination, { recursive: true, force: true });
            if (isGitMissing(error))
                throw new Error('导入 GitHub Skill 需要在运行 dsh 的机器上安装 git');
            if (isGitFailure(error)) {
                const detail = gitFailureMessage(error);
                throw new Error(gitUserMessage(detail));
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
            await this.forgetGitHubSource(skillsDir, name);
            this.ctx.logger.info(`capability-locations: unlinked skill "${name}" (root ${skillsDir})`);
            return true;
        }
        if (info.isDirectory() && (await readSkillManifest(path)) !== undefined) {
            await rm(path, { recursive: true });
            await this.forgetGitHubSource(skillsDir, name);
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
    /** Compare an imported Skill with its tracked GitHub directory. */
    async checkSkillUpdate(name, entryDir) {
        const skillsDir = await this.resolveSkillsDir(entryDir);
        const entry = await describeSkillEntry(skillsDir, name, entryDir === undefined ? 'user' : 'project');
        const record = (await readGitHubSources(skillsDir))[name];
        const base = { name, entryDir: skillsDir };
        if (entry?.linked && entry.valid)
            return checkLinkedSkillUpdate(entry, base);
        if (entry === undefined || record === undefined)
            return { ...base, status: 'unmanaged' };
        const common = { ...base, sourceUrl: record.url, installedRevision: record.installedRevision, gitManaged: await hasGitMetadata(entry.path) };
        if (await skillDigest(entry.path) !== record.installedDigest)
            return { ...common, status: 'modified' };
        const source = parseGitHubSkillUrl(record.url);
        return withGitHubCheckout(source, async (repoDir) => {
            const latestRevision = await runGit(['-C', repoDir, 'rev-parse', 'HEAD']);
            await checkGitHubManifest(repoDir, source);
            const latestTree = await gitSkillTree(repoDir, source.path);
            const directory = await skillDirectoryMetadata(repoDir, source, latestRevision);
            if (latestTree === record.installedTree)
                return { ...common, ...directory, latestRevision, status: 'current' };
            const sourceDir = source.path === '.' ? repoDir : resolve(repoDir, ...source.path.split('/'));
            const changedFiles = await changedSkillFiles(entry.path, sourceDir);
            const compareUrl = `${source.repoUrl.slice(0, -4)}/compare/${encodeURIComponent(record.installedRevision)}...${encodeURIComponent(latestRevision)}`;
            return { ...common, ...directory, latestRevision, changedFiles, compareUrl, status: 'available' };
        });
    }
    /** Validate a source against the complete local snapshot before saving it. */
    async associateGitHubSkillSource(name, url, entryDir) {
        const skillsDir = await this.resolveSkillsDir(entryDir);
        const entry = await describeSkillEntry(skillsDir, name, entryDir === undefined ? 'user' : 'project');
        if (entry === undefined || entry.linked || !entry.valid)
            throw new Error(`Skill「${name}」不是可关联的本地目录`);
        const previous = (await readGitHubSources(skillsDir))[name];
        const installedDigest = await skillDigest(entry.path);
        if (previous && previous.installedDigest !== installedDigest)
            throw new Error(`Skill「${name}」含有本地修改，不能修改来源`);
        const source = parseGitHubSkillUrl(url);
        return withGitHubCheckout(source, async (repoDir) => {
            const sourceDir = source.path === '.' ? repoDir : resolve(repoDir, ...source.path.split('/'));
            await checkGitHubManifest(repoDir, source);
            await assertSafeSkillTree(sourceDir, source.path === '.');
            const latestRevision = await runGit(['-C', repoDir, 'rev-parse', 'HEAD']);
            const latestTree = await gitSkillTree(repoDir, source.path);
            const changedFiles = await changedSkillFiles(entry.path, sourceDir);
            const match = await matchSkillHistory(repoDir, source, installedDigest, latestRevision);
            const manifest = await checkGitHubManifest(repoDir, source);
            if (manifest.name !== entry.skillName)
                throw new Error(`GitHub Skill name 与已安装的「${entry.skillName}」不一致`);
            // Downloading and searching can take time. Never save a stale baseline.
            if (await skillDigest(entry.path) !== installedDigest)
                throw new Error(`Skill「${name}」在关联期间发生变化，请重试`);
            const gitManaged = await hasGitMetadata(entry.path);
            await this.changeGitHubSources(skillsDir, records => {
                if (JSON.stringify(records[name]) !== JSON.stringify(previous))
                    throw new Error('来源记录已变化，请重试');
                records[name] = { url: url.trim(), installedRevision: match.revision, installedTree: match.tree, installedDigest, skillName: manifest.name };
            });
            return {
                status: match.tree === latestTree ? 'current' : 'available', name, entryDir: skillsDir,
                sourceUrl: url.trim(), installedRevision: match.revision, latestRevision, gitManaged,
                ...await skillDirectoryMetadata(repoDir, source, latestRevision),
                ...(match.tree === latestTree ? {} : { changedFiles,
                    compareUrl: `${source.repoUrl.slice(0, -4)}/compare/${match.revision}...${latestRevision}` }),
            };
        });
    }
    /** Forget provenance only; never remove the installed files. */
    async dissociateGitHubSkillSource(name, entryDir) {
        const skillsDir = await this.resolveSkillsDir(entryDir);
        const entry = await describeSkillEntry(skillsDir, name, entryDir === undefined ? 'user' : 'project');
        if (!entry || entry.linked)
            throw new Error('该技能不是可管理的本地目录');
        await this.forgetGitHubSource(skillsDir, name);
        return true;
    }
    /** Validate and replace an imported Skill, keeping its old directory on failure. */
    async updateSkillFromGitHub(name, entryDir) {
        const skillsDir = await this.resolveSkillsDir(entryDir);
        const entry = await describeSkillEntry(skillsDir, name, entryDir === undefined ? 'user' : 'project');
        const record = (await readGitHubSources(skillsDir))[name];
        if (entry === undefined || entry.linked || record === undefined)
            throw new Error(`Skill「${name}」没有可更新的 GitHub 来源`);
        if (await hasGitMetadata(entry.path))
            throw new Error('该技能由 Git 管理，请通过 Git 更新');
        if (await skillDigest(entry.path) !== record.installedDigest)
            throw new Error(`Skill「${name}」含有本地修改，更新已取消`);
        const source = parseGitHubSkillUrl(record.url);
        return withGitHubCheckout(source, async (repoDir) => {
            const sourceDir = source.path === '.' ? repoDir : resolve(repoDir, ...source.path.split('/'));
            const manifest = await checkGitHubManifest(repoDir, source);
            await assertSafeSkillTree(sourceDir, source.path === '.');
            if (manifest.name !== record.skillName)
                throw new Error(`Skill name 已从「${record.skillName}」变为「${manifest.name}」，无法自动更新`);
            const revision = await runGit(['-C', repoDir, 'rev-parse', 'HEAD']);
            const installedTree = await gitSkillTree(repoDir, source.path);
            const stage = await mkdtemp(join(skillsDir, GITHUB_IMPORT_PREFIX));
            const stagedSkill = join(stage, name);
            // Keep the previous Skill one level below the staging directory. The
            // host scans direct children of the managed root for SKILL.md, so a
            // backup placed directly there could briefly appear as another Skill.
            const backup = join(stage, 'previous');
            let backedUp = false;
            let replaced = false;
            let committed = false;
            try {
                await cp(sourceDir, stagedSkill, {
                    recursive: true, force: false, errorOnExist: true,
                    filter: path => !(source.path === '.' && basename(path) === '.git'),
                });
                const copied = await checkSkillManifest(stagedSkill);
                if (!copied.ok)
                    throw new Error(copied.message);
                const installedDigest = await skillDigest(stagedSkill);
                // Recheck after the download: an editor may have changed the installed
                // Skill while the clone was in progress.
                if (await skillDigest(entry.path) !== record.installedDigest)
                    throw new Error(`Skill「${name}」含有本地修改，更新已取消`);
                if (await hasGitMetadata(entry.path))
                    throw new Error('该技能由 Git 管理，请通过 Git 更新');
                await rename(entry.path, backup);
                backedUp = true;
                await rename(stagedSkill, entry.path);
                replaced = true;
                await this.changeGitHubSources(skillsDir, records => {
                    if (JSON.stringify(records[name]) !== JSON.stringify(record))
                        throw new Error('来源记录已变化，更新已取消，请重试');
                    records[name] = { ...record, installedRevision: revision, installedTree, installedDigest };
                });
                committed = true;
                try {
                    await rm(backup, { recursive: true, force: true });
                    backedUp = false;
                }
                catch (error) {
                    this.ctx.logger.warn(`capability-locations: cannot clean Skill update backup ${backup}: ${String(error)}`);
                }
                this.ctx.logger.info(`capability-locations: updated GitHub skill "${name}" to ${revision}`);
                return { revision };
            }
            catch (error) {
                if (!committed) {
                    if (replaced)
                        await rm(entry.path, { recursive: true, force: true });
                    if (backedUp) {
                        await rename(backup, entry.path);
                        backedUp = false;
                    }
                }
                throw error;
            }
            finally {
                if (!backedUp)
                    await rm(stage, { recursive: true, force: true }).catch(() => undefined);
            }
        });
    }
    async saveGitHubSource(skillsDir, name, record) {
        await this.changeGitHubSources(skillsDir, records => { records[name] = record; });
    }
    async forgetGitHubSource(skillsDir, name) {
        if (!Object.hasOwn(await readGitHubSources(skillsDir), name))
            return;
        await this.changeGitHubSources(skillsDir, records => { delete records[name]; });
    }
    async changeGitHubSources(skillsDir, change) {
        const operation = this.sourceWrite.then(async () => {
            const records = await readGitHubSources(skillsDir);
            change(records);
            const target = join(skillsDir, GITHUB_SOURCE_FILE);
            const temporary = join(skillsDir, `.capability-menu-sources-${randomUUID()}.tmp`);
            try {
                await writeFile(temporary, JSON.stringify(records, null, 2) + '\n', { flag: 'wx' });
                await rename(temporary, target);
            }
            finally {
                await rm(temporary, { force: true }).catch(() => undefined);
            }
        });
        this.sourceWrite = operation.catch(() => undefined);
        await operation;
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
async function runGit(args, timeout = 120_000) {
    const { stdout } = await execFileAsync('git', args, {
        timeout,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    });
    return stdout.trim();
}
async function readGitHubSources(skillsDir) {
    const raw = await readFile(join(skillsDir, GITHUB_SOURCE_FILE), 'utf8').catch(error => {
        if (error.code === 'ENOENT')
            return '{}';
        throw error;
    });
    const data = JSON.parse(raw);
    if (typeof data !== 'object' || data === null || Array.isArray(data))
        throw new Error('GitHub Skill 来源记录格式无效');
    const records = Object.create(null);
    for (const [name, value] of Object.entries(data)) {
        if (typeof value !== 'object' || value === null || Array.isArray(value))
            throw new Error(`Skill「${name}」来源记录格式无效`);
        const row = value;
        if (typeof row['url'] !== 'string' || typeof row['installedRevision'] !== 'string'
            || typeof row['installedTree'] !== 'string' || typeof row['installedDigest'] !== 'string'
            || typeof row['skillName'] !== 'string')
            throw new Error(`Skill「${name}」来源记录格式无效`);
        records[name] = {
            url: row['url'], installedRevision: row['installedRevision'],
            installedTree: row['installedTree'], installedDigest: row['installedDigest'], skillName: row['skillName'],
        };
    }
    return records;
}
async function gitSkillTree(repoDir, path) {
    return runGit(['-C', repoDir, 'rev-parse', path === '.' ? 'HEAD^{tree}' : `HEAD:${path}`]);
}
/** The last commit touching this skill directory, with its GitHub commit link.
 * Shallow boundaries look like changes to every path: deepen before trusting
 * them. Optional history lookup must not turn a successful content check into
 * an error, nor substitute an unrelated HEAD subject when history is limited.
 */
async function skillDirectoryMetadata(repoDir, source, head) {
    try {
        for (const deepen of [0, 64, 256, 1024]) {
            if (deepen)
                await runGit(['-C', repoDir, 'fetch', '--deepen=' + deepen, '--filter=blob:none', 'origin']);
            const result = await runGit(['-C', repoDir, 'log', '-1', '--format=%H%x00%s', head, '--', `:(literal)${source.path}`]);
            const [revision, subject] = result.split('\0');
            if (!revision)
                return {};
            const shallow = await readFile(join(repoDir, '.git', 'shallow'), 'utf8').catch(error => {
                if (error.code === 'ENOENT')
                    return '';
                throw error;
            });
            if (!shallow.split('\n').includes(revision))
                return { latestCommitUrl: `${source.repoUrl.slice(0, -4)}/commit/${revision}`, latestCommitRevision: revision, latestCommitSubject: subject };
        }
    }
    catch { /* Keep the content result when optional history is unavailable. */ }
    return {};
}
/** Links are inspected read-only. Network operations run in a disposable checkout. */
async function checkLinkedSkillUpdate(entry, base) {
    const target = await realpath(entry.path);
    let source;
    let installedTree;
    let installedRevision;
    let locallyModified = false;
    const repo = await runGit(['-C', target, 'rev-parse', '--show-toplevel']).catch(() => undefined);
    if (repo) {
        const branch = await runGit(['-C', target, 'symbolic-ref', '--short', 'HEAD']).catch(() => undefined);
        const remote = branch ? await runGit(['-C', target, 'config', '--get', `branch.${branch}.remote`]).catch(() => 'origin') : 'origin';
        const url = await runGit(['-C', target, 'config', '--get', `remote.${remote}.url`]).catch(() => undefined);
        if (url) {
            const https = url.replace(/^git@github\.com:/, 'https://github.com/').replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/').replace(/\.git$/, '');
            try {
                source = parseGitHubSkillUrl(https);
            }
            catch { /* Unsupported remote: report unknown source. */ }
            if (source) {
                const path = relative(repo, target).split(sep).join('/') || '.';
                const trackedBranch = branch ? await runGit(['-C', target, 'config', '--get', `branch.${branch}.merge`]).catch(() => `refs/heads/${branch}`) : undefined;
                source = { ...source, path, ref: trackedBranch?.replace(/^refs\/heads\//, '') };
                installedRevision = await runGit(['-C', repo, 'rev-parse', 'HEAD']);
                installedTree = await gitSkillTree(repo, path);
                locallyModified = !!await runGit(['--no-optional-locks', '-C', repo, 'status', '--porcelain', '--untracked-files=normal', '--', `:(literal)${path}`]);
            }
        }
    }
    else if (basename(dirname(target)) === 'skills') {
        // The skills installer records copied sources alongside its skills directory.
        const lockPath = join(dirname(dirname(target)), '.skill-lock.json');
        const lock = await readFile(lockPath, 'utf8').then(text => JSON.parse(text)).catch(error => {
            if (error.code === 'ENOENT')
                return undefined;
            throw error;
        });
        const record = lock?.skills?.[basename(target)];
        if (record?.sourceType === 'github' && record.sourceUrl && record.skillPath?.endsWith('SKILL.md')) {
            try {
                const root = parseGitHubSkillUrl(record.sourceUrl.replace(/\.git$/, ''));
                const path = record.skillPath.split('/').slice(0, -1).join('/') || '.';
                // Reuse the source parser's traversal validation; do not guess a lock hash algorithm.
                const checked = parseGitHubSkillUrl(`${root.repoUrl.slice(0, -4)}/tree/main/${path === '.' ? '' : path}`);
                source = { ...checked, ref: root.ref };
            }
            catch { /* Unrecognized installer source stays unmanaged. */ }
        }
    }
    if (!source)
        return { ...base, status: 'unmanaged' };
    const sourceUrl = source.repoUrl.slice(0, -4);
    return withGitHubCheckout(source, async (repoDir) => {
        await checkGitHubManifest(repoDir, source);
        const latestRevision = await runGit(['-C', repoDir, 'rev-parse', 'HEAD']);
        const latestDir = source.path === '.' ? repoDir : resolve(repoDir, ...source.path.split('/'));
        const changedFiles = await changedSkillFiles(target, latestDir);
        const latestTree = await gitSkillTree(repoDir, source.path);
        const status = installedTree
            ? locallyModified ? 'modified' : latestTree === installedTree ? 'current' : 'available'
            : changedFiles.length === 0 ? 'current' : 'modified';
        const directory = await skillDirectoryMetadata(repoDir, source, latestRevision);
        return { ...base, ...directory, status, sourceUrl, gitManaged: true, installedRevision, latestRevision, changedFiles };
    });
}
async function withGitHubCheckout(source, use) {
    const checkoutRoot = await mkdtemp(join(tmpdir(), GITHUB_IMPORT_PREFIX));
    const repoDir = join(checkoutRoot, 'repo');
    try {
        await runGit([
            '-c', 'credential.helper=', '-c', 'credential.interactive=never',
            'clone', '--depth=1', '--filter=blob:none', '--sparse', '--single-branch',
            ...source.ref !== undefined ? [`--branch=${source.ref}`] : [],
            '--', source.repoUrl, repoDir,
        ]);
        await runGit(['-C', repoDir, 'sparse-checkout', ...(source.path === '.' ? ['disable'] : ['set', '--cone', '--', source.path])]);
        return await use(repoDir);
    }
    catch (error) {
        if (isGitMissing(error))
            throw new Error('检查 GitHub Skill 更新需要在运行 dsh 的机器上安装 git');
        if (isGitFailure(error))
            throw new Error(gitUserMessage(gitFailureMessage(error)));
        throw error;
    }
    finally {
        await rm(checkoutRoot, { recursive: true, force: true });
    }
}
async function hasGitMetadata(dir) {
    return lstat(join(dir, '.git')).then(() => true, error => {
        if (error.code === 'ENOENT')
            return false;
        throw error;
    });
}
async function skillFiles(dir, ignoreGit = true) {
    const result = new Map();
    async function visit(current, prefix) {
        const entries = await readdir(current, { withFileTypes: true });
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
            if (ignoreGit && prefix === '' && entry.name === '.git')
                continue;
            const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
            const path = join(current, entry.name);
            if (entry.isDirectory())
                await visit(path, relativePath);
            else if (entry.isFile())
                result.set(relativePath, createHash('sha256').update(await readFile(path)).digest('hex'));
            else
                result.set(relativePath, `unsupported:${entry.isSymbolicLink() ? 'link' : 'special'}`);
        }
    }
    await visit(dir, '');
    return result;
}
async function skillDigest(dir, ignoreGit = true) {
    const files = await skillFiles(dir, ignoreGit);
    const hash = createHash('sha256');
    for (const [path, digest] of [...files].sort(([a], [b]) => a.localeCompare(b)))
        hash.update(path).update('\0').update(digest).update('\0');
    return hash.digest('hex');
}
async function changedSkillFiles(installedDir, latestDir) {
    const [installed, latest] = await Promise.all([skillFiles(installedDir), skillFiles(latestDir, true)]);
    return [...new Set([...installed.keys(), ...latest.keys()])]
        .filter(path => installed.get(path) !== latest.get(path)).sort();
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
 * Invocation keys the loader reads. Both are optional; a value that cannot be
 * read as a boolean makes `parseInvocationPolicy` throw and drops the skill.
 */
const INVOCATION_KEYS = ['disable-model-invocation', 'user-invocable'];
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
 * so a non-boolean value is rejected here. Returns the problem, or undefined
 * when the fields are all readable.
 */
function checkInvocation(front, dir) {
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
/** Keep diagnostics available without making raw git stderr the main message. */
function gitUserMessage(detail) {
    const summary = /timed out|timeout|SIGTERM/i.test(detail) ? 'GitHub 操作超时，请稍后重试'
        : /Could not resolve|Failed to connect|unable to access/i.test(detail) ? '无法连接 GitHub，请检查网络后重试'
            : /Remote branch|not a valid object|unknown revision/i.test(detail) ? '找不到指定分支或版本，请检查来源链接'
                : /not found|Authentication|password|Username|Permission denied/i.test(detail) ? '仓库不存在或当前无法访问；仅支持公开 GitHub 仓库'
                    : 'GitHub 操作失败，请检查来源链接后重试';
    return `${summary}\n\n[details]\n${detail}`;
}
async function checkGitHubManifest(repoDir, source) {
    const dir = source.path === '.' ? repoDir : resolve(repoDir, ...source.path.split('/'));
    const manifest = await checkSkillManifest(dir);
    if (manifest.ok)
        return manifest;
    if (!await pathExists(join(dir, 'SKILL.md'))) {
        // Query the Git tree rather than sparse working files. Never auto-select a Skill.
        const paths = (await runGit(['-C', repoDir, 'ls-tree', '-r', '--name-only', '-z', 'HEAD'])).split('\0')
            .filter(path => path === 'SKILL.md' || path.endsWith('/SKILL.md'));
        const ref = source.ref ?? await runGit(['-C', repoDir, 'symbolic-ref', '--short', 'HEAD']);
        const candidates = paths.slice(0, 20).map(path => {
            const directory = path === 'SKILL.md' ? '' : path.slice(0, -9);
            return `${directory || '.'}: ${source.repoUrl.slice(0, -4)}/tree/${encodeURIComponent(ref)}${directory ? '/' + directory.split('/').map(encodeURIComponent).join('/') : ''}`;
        });
        throw new Error(`所选目录「${source.path}」没有 SKILL.md。请使用包含 SKILL.md 的技能子目录链接。${candidates.length ? '\n可用技能目录：\n' + candidates.join('\n') : '\n仓库中未找到可用技能。'}`);
    }
    throw new Error(manifest.message.replaceAll(dir, source.path));
}
/** Search only on explicit association, with a shared deadline and distinct-tree budget. */
async function matchSkillHistory(repoDir, source, digest, tip) {
    const deadline = Date.now() + 60_000;
    const limitMessage = '历史搜索达到限制，尚未找到匹配版本；本地内容未被修改，请稍后重试或使用更接近安装版本的分支';
    const git = async (args) => {
        const remaining = deadline - Date.now();
        if (remaining <= 0)
            throw new Error(limitMessage);
        try {
            return await runGit(['--literal-pathspecs', '-C', repoDir, ...args], remaining);
        }
        catch (error) {
            if (Date.now() >= deadline || error.killed)
                throw new Error(limitMessage);
            throw error;
        }
    };
    const seen = new Set();
    const visited = new Set();
    const dir = source.path === '.' ? repoDir : resolve(repoDir, ...source.path.split('/'));
    for (let depth = 0; depth <= 8192; depth = depth === 0 ? 64 : depth * 2) {
        if (depth)
            await git(['fetch', '--deepen=' + depth, '--filter=blob:none', 'origin']);
        const revisions = [tip, ...(await git(['log', '--full-history', '--format=%H', '-n', '1001', tip, '--', source.path])).split('\n').filter(Boolean)];
        for (const revision of revisions) {
            if (visited.has(revision))
                continue;
            visited.add(revision);
            // A deletion has no tree at this path. ls-tree represents it as an empty result.
            const tree = source.path === '.' ? await git(['rev-parse', `${revision}^{tree}`])
                : (await git(['ls-tree', revision, '--', source.path])).split(/\s+/)[2];
            if (!tree || seen.has(tree))
                continue;
            if (seen.size >= 200)
                throw new Error(limitMessage);
            seen.add(tree);
            await git(['checkout', '--detach', '--force', revision]);
            await assertSafeSkillTree(dir, source.path === '.');
            const matches = await skillDigest(dir) === digest;
            if (Date.now() >= deadline)
                throw new Error(limitMessage);
            if (matches)
                return { revision, tree };
        }
        if (revisions.length >= 1002)
            throw new Error(limitMessage);
        if (await git(['rev-parse', '--is-shallow-repository']) === 'false') {
            throw new Error('本地技能与该来源的历史版本内容不同，不能安全关联；请检查来源或本地修改');
        }
    }
    throw new Error(limitMessage);
}
//# sourceMappingURL=locations.js.map