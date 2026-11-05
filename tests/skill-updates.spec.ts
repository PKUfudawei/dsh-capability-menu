import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
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
    expect((await restarted.checkSkillUpdate('alpha')).status).toBe('current')

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
