import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { cp, lstat, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { LocationRegistry } from '../src/locations.ts'

interface Fixture {
  readonly root: string
  readonly repo: string
  readonly skillsDir: string
  readonly registry: LocationRegistry
  readonly sourceUrl: string
  commit(message: string): string
  writeSkill(name: string, body: string, declaredName?: string): Promise<void>
}

const roots: string[] = []
const previousGitConfig = process.env.GIT_CONFIG_GLOBAL
vi.setConfig({ testTimeout: 30_000 })

afterEach(async () => {
  vi.restoreAllMocks()
  if (previousGitConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL
  else process.env.GIT_CONFIG_GLOBAL = previousGitConfig
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

async function fixture(): Promise<Fixture> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-skill-updates-')))
  roots.push(root)
  const repo = join(root, 'upstream')
  const skillsDir = join(root, 'installed')
  const patchFile = join(root, 'cordis.patch.yml')
  const config = join(root, 'gitconfig')
  await mkdir(repo)
  await mkdir(skillsDir)
  await writeFile(patchFile, '')
  git(repo, 'init', '-b', 'main')

  // Keep the production GitHub URL and import path, but route git traffic to
  // this local repository. The test never needs GitHub or a network connection.
  const sourceUrl = 'https://github.com/example-owner/example-skills/tree/main/skills/alpha'
  git(repo, 'config', '--file', config,
    `url.${pathToFileURL(repo).href}.insteadOf`,
    'https://github.com/example-owner/example-skills.git')
  process.env.GIT_CONFIG_GLOBAL = config

  const registry = new LocationRegistry(new Context(), { patchFile, skillsDir })
  return {
    root,
    repo,
    skillsDir,
    registry,
    sourceUrl,
    commit(message: string) {
      git(repo, 'add', '--all')
      git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', message)
      return git(repo, 'rev-parse', 'HEAD')
    },
    async writeSkill(name: string, body: string, declaredName = name) {
      const dir = join(repo, 'skills', name)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'SKILL.md'), `---\nname: ${declaredName}\ndescription: Test Skill\n---\n\n${body}\n`)
    },
  }
}

describe('GitHub Skill updates', () => {
  it('checks a linked Git checkout without fetching into or modifying its repository', async () => {
    const f = await fixture()
    await f.writeSkill('alpha', 'Original')
    const skillCommit = f.commit('Add alpha')
    const checkout = join(f.root, 'checkout')
    git(f.root, 'clone', f.repo, checkout)
    git(checkout, 'remote', 'set-url', 'origin', 'https://github.com/example-owner/example-skills.git')
    await f.registry.addSkill(join(checkout, 'skills', 'alpha'))
    const before = git(checkout, 'rev-parse', 'HEAD')
    const tracking = git(checkout, 'rev-parse', 'refs/remotes/origin/main')
    expect((await f.registry.checkSkillUpdate('alpha')).status).toBe('current')
    await f.writeSkill('beta', 'Unrelated')
    f.commit('Unrelated change')
    const unchanged = await f.registry.checkSkillUpdate('alpha')
    expect(unchanged).toMatchObject({ status: 'current', latestCommitRevision: skillCommit, latestCommitSubject: 'Add alpha' })
    expect(unchanged.latestCommitUrl).toBe(`https://github.com/example-owner/example-skills/commit/${skillCommit}`)
    await f.writeSkill('alpha', 'New version')
    f.commit('Update alpha')
    expect(await f.registry.checkSkillUpdate('alpha')).toMatchObject({ status: 'available', gitManaged: true, installedRevision: before, latestCommitSubject: 'Update alpha' })
    expect(git(checkout, 'rev-parse', 'HEAD')).toBe(before)
    expect(git(checkout, 'rev-parse', 'refs/remotes/origin/main')).toBe(tracking)
    expect(git(checkout, 'status', '--porcelain')).toBe('')
    expect((await lstat(join(f.skillsDir, 'alpha'))).isSymbolicLink()).toBe(true)
    await expect(f.registry.updateSkillFromGitHub('alpha')).rejects.toThrow(/没有可更新/)
    await writeFile(join(checkout, 'skills', 'alpha', 'local.txt'), 'local edits')
    expect((await f.registry.checkSkillUpdate('alpha')).status).toBe('modified')
    expect(await readFile(join(checkout, 'skills', 'alpha', 'local.txt'), 'utf8')).toBe('local edits')
  })

  it('checks linked installer copies, reports unknown sources, and never guesses a baseline hash', async () => {
    const f = await fixture()
    await f.writeSkill('alpha', 'Original')
    f.commit('Add alpha')
    const root = join(f.root, '.agents')
    const target = join(root, 'skills', 'alpha')
    await mkdir(join(root, 'skills'), { recursive: true })
    await cp(join(f.repo, 'skills', 'alpha'), target, { recursive: true })
    await f.registry.addSkill(target)
    expect((await f.registry.checkSkillUpdate('alpha')).status).toBe('unmanaged')
    const lock = JSON.stringify({ version: 3, skills: { alpha: {
      sourceType: 'github', sourceUrl: 'https://github.com/example-owner/example-skills.git',
      skillPath: 'skills/alpha/SKILL.md', skillFolderHash: 'unknown-installer-algorithm',
    } } })
    await writeFile(join(root, '.skill-lock.json'), lock)
    expect((await f.registry.checkSkillUpdate('alpha')).status).toBe('current')
    const content = await readFile(join(target, 'SKILL.md'), 'utf8')
    await f.writeSkill('alpha', 'Upstream changed')
    f.commit('Update alpha')
    expect(await f.registry.checkSkillUpdate('alpha')).toMatchObject({ status: 'modified', gitManaged: true, changedFiles: ['SKILL.md'] })
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe(content)
    expect(await readFile(join(root, '.skill-lock.json'), 'utf8')).toBe(lock)
    expect((await lstat(join(f.skillsDir, 'alpha'))).isSymbolicLink()).toBe(true)
  })

  it('remembers the import source and ignores unrelated repository commits', async () => {
    const f = await fixture()
    await f.writeSkill('alpha', 'First version')
    const installedRevision = f.commit('Add alpha')
    await f.registry.importSkillFromGitHub(f.sourceUrl)

    // Update provenance must survive a new registry instance, not just live in
    // memory for the process that imported the Skill.
    const restarted = new LocationRegistry(new Context(), {
      patchFile: join(f.root, 'cordis.patch.yml'), skillsDir: f.skillsDir,
    })
    expect(await restarted.checkSkillUpdate('alpha')).toMatchObject({
      status: 'current', installedRevision,
    })

    await writeFile(join(f.repo, 'README.md'), 'Unrelated repository change\n')
    f.commit('Edit README')
    expect(await restarted.checkSkillUpdate('alpha')).toMatchObject({
      status: 'current', latestCommitRevision: installedRevision, latestCommitSubject: 'Add alpha',
      latestCommitUrl: `https://github.com/example-owner/example-skills/commit/${installedRevision}`,
    })

    await f.writeSkill('alpha', 'Second version')
    const latestRevision = f.commit('Update alpha')
    expect(await restarted.checkSkillUpdate('alpha')).toMatchObject({
      status: 'available', installedRevision, latestRevision,
      changedFiles: ['SKILL.md'],
      compareUrl: `https://github.com/example-owner/example-skills/compare/${installedRevision}...${latestRevision}`,
    })
  })

  it('updates the selected Skill and leaves other installed Skills alone', async () => {
    const f = await fixture()
    await f.writeSkill('alpha', 'First version')
    await f.writeSkill('beta', 'Keep beta')
    f.commit('Add both Skills')
    await f.registry.importSkillFromGitHub(f.sourceUrl)
    await f.registry.importSkillFromGitHub('https://github.com/example-owner/example-skills/tree/main/skills/beta')
    const betaBefore = await readFile(join(f.skillsDir, 'beta', 'SKILL.md'), 'utf8')

    await f.writeSkill('alpha', 'Second version')
    const latestRevision = f.commit('Update alpha')
    expect(await f.registry.updateSkillFromGitHub('alpha')).toMatchObject({ revision: latestRevision })
    expect(await readFile(join(f.skillsDir, 'alpha', 'SKILL.md'), 'utf8')).toContain('Second version')
    expect(await readFile(join(f.skillsDir, 'beta', 'SKILL.md'), 'utf8')).toBe(betaBefore)
    expect((await f.registry.checkSkillUpdate('alpha')).status).toBe('current')
  })

  it('does not overwrite local edits to a GitHub-imported Skill', async () => {
    const f = await fixture()
    await f.writeSkill('alpha', 'First version')
    f.commit('Add alpha')
    await f.registry.importSkillFromGitHub(f.sourceUrl)
    const installed = join(f.skillsDir, 'alpha', 'SKILL.md')
    await writeFile(installed, '---\nname: alpha\ndescription: Test Skill\n---\n\nLocal edit\n')
    const localContent = await readFile(installed, 'utf8')

    await f.writeSkill('alpha', 'Second version')
    f.commit('Update alpha')
    expect((await f.registry.checkSkillUpdate('alpha')).status).toBe('modified')
    await expect(f.registry.updateSkillFromGitHub('alpha')).rejects.toThrow(/modif|chang|修改|变更/i)
    expect(await readFile(installed, 'utf8')).toBe(localContent)
  })

  it('rejects an upstream Skill rename without replacing the installed version', async () => {
    const f = await fixture()
    await f.writeSkill('alpha', 'First version')
    f.commit('Add alpha')
    await f.registry.importSkillFromGitHub(f.sourceUrl)
    const installed = join(f.skillsDir, 'alpha', 'SKILL.md')
    const before = await readFile(installed, 'utf8')

    await f.writeSkill('alpha', 'Second version', 'renamed-skill')
    f.commit('Rename Skill identity')
    await expect(f.registry.updateSkillFromGitHub('alpha')).rejects.toThrow(/name|identity|名称|身份/i)
    expect(await readFile(installed, 'utf8')).toBe(before)
  })

  it('does not offer automatic updates for a local linked Skill', async () => {
    const f = await fixture()
    await f.writeSkill('alpha', 'Locally managed')
    f.commit('Add alpha')
    await f.registry.addSkill(join(f.repo, 'skills', 'alpha'))

    expect((await f.registry.checkSkillUpdate('alpha')).status).toBe('unmanaged')
    await expect(f.registry.updateSkillFromGitHub('alpha')).rejects.toThrow(/source|GitHub|来源|导入/i)
  })

  it('keeps project and user Skill entries separate', async () => {
    const f = await fixture()
    await f.writeSkill('alpha', 'First version')
    f.commit('Add alpha')
    const project = join(f.root, 'project')
    await mkdir(join(project, '.git'), { recursive: true })
    const projectEntry = await f.registry.importSkillFromGitHub(f.sourceUrl, project)
    const projectRoot = join(project, '.dsh', 'skills')
    expect(projectEntry).toBe(join(projectRoot, 'alpha'))
    expect((await f.registry.checkSkillUpdate('alpha', projectRoot)).status).toBe('current')
    expect((await f.registry.checkSkillUpdate('alpha')).status).toBe('unmanaged')

    await f.writeSkill('alpha', 'Second version')
    f.commit('Update alpha')
    expect((await f.registry.checkSkillUpdate('alpha', projectRoot)).status).toBe('available')
    await f.registry.updateSkillFromGitHub('alpha', projectRoot)
    expect(await readFile(join(projectEntry, 'SKILL.md'), 'utf8')).toContain('Second version')
    expect(await readFile(join(f.skillsDir, 'alpha', 'SKILL.md'), 'utf8').catch(() => undefined)).toBeUndefined()
  })

  it('forgets GitHub provenance when an imported Skill is removed', async () => {
    const f = await fixture()
    await f.writeSkill('alpha', 'First version')
    f.commit('Add alpha')
    await f.registry.importSkillFromGitHub(f.sourceUrl)
    expect(await f.registry.removeSkill('alpha')).toBe(true)
    await f.registry.addSkill(join(f.repo, 'skills', 'alpha'))

    expect((await f.registry.checkSkillUpdate('alpha')).status).toBe('unmanaged')
  })

  it('can link an older copy to GitHub only when its contents match', async () => {
    const f = await fixture()
    await f.writeSkill('alpha', 'First version')
    const revision = f.commit('Add alpha')
    const installed = join(f.skillsDir, 'alpha')
    await mkdir(installed)
    await writeFile(join(installed, 'SKILL.md'), await readFile(join(f.repo, 'skills', 'alpha', 'SKILL.md')))

    expect(await f.registry.associateGitHubSkillSource('alpha', f.sourceUrl)).toMatchObject({
      status: 'current', installedRevision: revision,
    })
    await f.writeSkill('alpha', 'Second version')
    f.commit('Update alpha')
    expect((await f.registry.checkSkillUpdate('alpha')).status).toBe('available')
  })

  it('refuses to link a modified old copy to a mismatched GitHub source', async () => {
    const f = await fixture()
    await f.writeSkill('alpha', 'First version')
    f.commit('Add alpha')
    const installed = join(f.skillsDir, 'alpha')
    await mkdir(installed)
    await writeFile(join(installed, 'SKILL.md'), '---\nname: alpha\ndescription: Test Skill\n---\n\nLocal copy changed\n')
    const before = await readFile(join(installed, 'SKILL.md'), 'utf8')

    await expect(f.registry.associateGitHubSkillSource('alpha', f.sourceUrl)).rejects.toThrow(/内容不同/)
    expect((await f.registry.checkSkillUpdate('alpha')).status).toBe('unmanaged')
    expect(await readFile(join(installed, 'SKILL.md'), 'utf8')).toBe(before)
  })
})


describe('legacy Skill source recovery', () => {
  async function oldSnapshot() {
    const f = await fixture()
    await f.writeSkill('alpha', 'Original snapshot')
    await writeFile(join(f.repo, 'skills/alpha/data.bin'), Buffer.from([0, 1, 255, 10]))
    const original = f.commit('Original Skill')
    await cp(join(f.repo, 'skills/alpha'), join(f.skillsDir, 'alpha'), { recursive: true })
    await f.writeSkill('alpha', 'New upstream version')
    const latest = f.commit('Update Skill')
    return { ...f, original, latest }
  }

  it('links an old complete snapshot and updates it to HEAD', async () => {
    const f = await oldSnapshot()
    expect(await f.registry.associateGitHubSkillSource('alpha', f.sourceUrl)).toMatchObject({
      status: 'available', installedRevision: f.original, latestRevision: f.latest, changedFiles: ['SKILL.md'],
    })
    await f.registry.updateSkillFromGitHub('alpha')
    expect((await f.registry.checkSkillUpdate('alpha')).status).toBe('current')
    expect(await readFile(join(f.skillsDir, 'alpha/data.bin'))).toEqual(Buffer.from([0, 1, 255, 10]))
  })

  it('rejects changed attachments even if SKILL.md matches history', async () => {
    const f = await oldSnapshot()
    await writeFile(join(f.skillsDir, 'alpha/data.bin'), 'Local changes')
    await expect(f.registry.associateGitHubSkillSource('alpha', f.sourceUrl)).rejects.toThrow(/内容不同/)
    expect((await f.registry.checkSkillUpdate('alpha')).status).toBe('unmanaged')
  })

  it.each(['directory', 'file'])('ignores .git %s for matching but blocks menu updates', async kind => {
    const f = await oldSnapshot()
    const metadata = join(f.skillsDir, 'alpha/.git')
    if (kind === 'directory') {
      git(join(f.skillsDir, 'alpha'), 'init', '-b', 'main')
    } else await writeFile(metadata, 'gitdir: /some/worktree/metadata')
    const before = kind === 'file' ? await readFile(metadata, 'utf8') : await readFile(join(metadata, 'HEAD'), 'utf8')
    expect(await f.registry.associateGitHubSkillSource('alpha', f.sourceUrl)).toMatchObject({ status: 'available', gitManaged: true, changedFiles: ['SKILL.md'] })
    expect(await f.registry.checkSkillUpdate('alpha')).toMatchObject({ status: 'available', gitManaged: true })
    await expect(f.registry.updateSkillFromGitHub('alpha')).rejects.toThrow(/Git 管理/)
    expect(kind === 'file' ? await readFile(metadata, 'utf8') : await readFile(join(metadata, 'HEAD'), 'utf8')).toBe(before)
    await writeFile(join(f.skillsDir, 'alpha/data.bin'), 'Edited')
    expect((await f.registry.checkSkillUpdate('alpha')).status).toBe('modified')
  })

  it('validates source replacement and preserves files when unlinked', async () => {
    const f = await oldSnapshot()
    await f.registry.associateGitHubSkillSource('alpha', f.sourceUrl)
    const sourceFile = join(f.skillsDir, '.capability-menu-sources.json')
    const previous = await readFile(sourceFile, 'utf8')
    await expect(f.registry.associateGitHubSkillSource('alpha', f.sourceUrl.replace('skills/alpha', 'missing'))).rejects.toThrow(/SKILL.md/)
    expect(await readFile(sourceFile, 'utf8')).toBe(previous)
    git(f.repo, 'branch', 'alternate')
    const alternative = f.sourceUrl.replace('/main/', '/alternate/')
    await f.registry.associateGitHubSkillSource('alpha', alternative)
    expect((await f.registry.checkSkillUpdate('alpha')).sourceUrl).toBe(alternative)
    const installed = join(f.skillsDir, 'alpha/SKILL.md')
    await writeFile(installed, '---\nname: alpha\ndescription: test\n---\nLocal edit')
    await expect(f.registry.associateGitHubSkillSource('alpha', f.sourceUrl)).rejects.toThrow(/本地修改/)
    const before = await readFile(installed, 'utf8')
    await f.registry.dissociateGitHubSkillSource('alpha')
    expect((await f.registry.checkSkillUpdate('alpha')).status).toBe('unmanaged')
    expect(await readFile(installed, 'utf8')).toBe(before)
  })

  it('repairs an invalid stored URL without parsing it first', async () => {
    const f = await oldSnapshot()
    await f.registry.associateGitHubSkillSource('alpha', f.sourceUrl)
    const sourceFile = join(f.skillsDir, '.capability-menu-sources.json')
    const records = JSON.parse(await readFile(sourceFile, 'utf8'))
    records.alpha.url = 'not-a-url'
    await writeFile(sourceFile, JSON.stringify(records))
    await f.registry.associateGitHubSkillSource('alpha', f.sourceUrl)
    expect((await f.registry.checkSkillUpdate('alpha')).sourceUrl).toBe(f.sourceUrl)
  })

  it('offers usable subdirectory links for a multi-Skill repository root', async () => {
    const f = await oldSnapshot()
    await expect(f.registry.associateGitHubSkillSource('alpha', 'https://github.com/example-owner/example-skills'))
      .rejects.toThrow('https://github.com/example-owner/example-skills/tree/main/skills/alpha')
  })

  it('does not label a timed-out history search as modified or write provenance', async () => {
    const f = await oldSnapshot()
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(61_000)
    await expect(f.registry.associateGitHubSkillSource('alpha', f.sourceUrl)).rejects.toThrow(/历史搜索达到限制/)
    expect(await lstat(join(f.skillsDir, '.capability-menu-sources.json')).catch(() => undefined)).toBeUndefined()
    expect((await f.registry.checkSkillUpdate('alpha')).status).toBe('unmanaged')
  })

  it('rechecks local content after history search before writing provenance', async () => {
    const f = await oldSnapshot()
    const now = Date.now.bind(Date)
    vi.spyOn(Date, 'now').mockImplementationOnce(() => {
      writeFileSync(join(f.skillsDir, 'alpha/data.bin'), 'Changed during association')
      return now()
    }).mockImplementation(now)
    await expect(f.registry.associateGitHubSkillSource('alpha', f.sourceUrl)).rejects.toThrow(/关联期间发生变化/)
    expect((await f.registry.checkSkillUpdate('alpha')).status).toBe('unmanaged')
  })

  it('reports the distinct-version limit without writing provenance', async () => {
    const f = await fixture()
    await f.writeSkill('alpha', 'Version 0')
    f.commit('Initial version')
    await cp(join(f.repo, 'skills/alpha'), join(f.skillsDir, 'alpha'), { recursive: true })
    for (let version = 1; version <= 200; version++) {
      await f.writeSkill('alpha', `Version ${version}`)
      f.commit(`Version ${version}`)
    }
    await expect(f.registry.associateGitHubSkillSource('alpha', f.sourceUrl)).rejects.toThrow(/历史搜索达到限制/)
    expect((await f.registry.checkSkillUpdate('alpha')).status).toBe('unmanaged')
  })

  it('preserves provenance when a replacement repository cannot be fetched', async () => {
    const f = await oldSnapshot()
    await f.registry.associateGitHubSkillSource('alpha', f.sourceUrl)
    const before = await readFile(join(f.skillsDir, '.capability-menu-sources.json'), 'utf8')
    git(f.repo, 'config', '--file', join(f.root, 'gitconfig'),
      `url.${pathToFileURL(join(f.root, 'missing-repository')).href}.insteadOf`, 'https://github.com/example-owner/missing.git')
    await expect(f.registry.associateGitHubSkillSource('alpha', 'https://github.com/example-owner/missing'))
      .rejects.toThrow(/GitHub 操作失败|仓库不存在或当前无法访问/)
    expect(await readFile(join(f.skillsDir, '.capability-menu-sources.json'), 'utf8')).toBe(before)
  })

  it('imports root Skills including nested files and detects their changes', async () => {
    const f = await fixture()
    await writeFile(join(f.repo, 'SKILL.md'), '---\nname: root-skill\ndescription: test\n---\nRoot Skill')
    await mkdir(join(f.repo, 'resources'))
    await writeFile(join(f.repo, 'resources/example.txt'), 'original')
    f.commit('Root Skill')
    await f.registry.importSkillFromGitHub('https://github.com/example-owner/example-skills')
    expect(await readFile(join(f.skillsDir, 'example-skills/resources/example.txt'), 'utf8')).toBe('original')
    await writeFile(join(f.repo, 'resources/example.txt'), 'updated')
    f.commit('Update nested file')
    expect(await f.registry.checkSkillUpdate('example-skills')).toMatchObject({ status: 'available', changedFiles: ['resources/example.txt'] })
  })
})
