import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { CapabilityPolicyGateway } from '../src/server/remote.ts'
import type { SkillLocation } from '../src/locations.ts'
import type { CapabilityPolicyService } from '../src/policy.ts'
import type { CapabilityService } from '../src/registry.ts'

/** A skill directory with a manifest declaring `declared`, at `skillDir`. */
async function writeSkillDir(skillDir: string, declared: string): Promise<string> {
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, 'SKILL.md'), `---\nname: ${declared}\ndescription: d\n---\n\nBody.\n`)
  return skillDir
}

/** A user-root row as the location manager reports it; no disk behind it. */
function userEntry(entryDir: string, name: string, declared: string): SkillLocation {
  return {
    name,
    skillName: declared,
    path: join(entryDir, name),
    linked: true,
    valid: true,
    root: 'user',
    entryDir,
    target: `/outside/${name}`,
  }
}

/**
 * A gateway over stubbed siblings. `listSkillLocations` joins the location
 * manager's own rows with the skills dsh indexed under a project root, so those
 * two services are the whole input — booting the real catalog would only add
 * noise to a question about which rows come back.
 */
function gateway(
  userRows: readonly SkillLocation[],
  indexed: ReadonlyArray<{ name: string; skillDir: string; source?: string }>,
): CapabilityPolicyGateway {
  const ctx = new Context()
  ctx.provide('capabilityPolicy', {
    listSkillLocations: async () => [...userRows],
  } as unknown as CapabilityPolicyService)
  ctx.provide('capability', {
    skillDirs: () => indexed,
  } as unknown as CapabilityService)
  return new CapabilityPolicyGateway(ctx)
}

describe('server gateway · @Remote wiring', () => {
  it('registers one Remote method per decorated method in the source', async () => {
    // Guards the transform itself. The class constructs either way, so if the
    // test pipeline ever stopped applying the standard (TC39) decorators
    // `@Remote` is written against, every method would silently stop being
    // exported over Typert and no behavioural test would notice.
    const source = await readFile(new URL('../src/server/remote.ts', import.meta.url), 'utf8')
    // `@Remote` in either form — bound directly or called as a factory — but not
    // the unrelated `@RemoteScope`, which this count must not absorb.
    const decorated = source.match(/^\s*@Remote(?![\w$])/gm) ?? []
    expect(decorated.length).toBeGreaterThan(0)
    expect(remoteMethods(gateway([], [])).map(marker => marker.method)).toHaveLength(decorated.length)
  })
})

describe('server gateway · listSkillLocations', () => {
  it('lists a project skill whose directory name differs from the name it declares', async () => {
    const project = await mkdtemp('/tmp/dsh-gateway-')
    // dsh keys a skill by the name in its own SKILL.md; the directory under the
    // project's skill root need not share it.
    const skillDir = await writeSkillDir(join(project, '.dsh/skills/dir-name'), 'inner-name')

    const rows = await gateway([], [{ name: 'inner-name', skillDir, source: 'project-dsh' }]).listSkillLocations()

    // Addressing the entry by its declared name looked for a directory that does
    // not exist, and the row was dropped without a word — the skill could not be
    // edited or removed from the panel at all.
    expect(rows).toHaveLength(1)
    // Both names survive, because they answer different questions: `name`
    // addresses the entry on disk, `skillName` is what the panel's row is keyed by.
    expect(rows[0]).toMatchObject({ name: 'dir-name', skillName: 'inner-name', root: 'project' })
  })

  it('adds the project root to the user root and ignores roots it does not manage', async () => {
    const project = await mkdtemp('/tmp/dsh-gateway-')
    const skillDir = await writeSkillDir(join(project, '.dsh/skills/project-skill'), 'project-skill')

    const rows = await gateway(
      [userEntry('/root/.dsh/skills', 'dir-name', 'inner-name')],
      [
        { name: 'project-skill', skillDir, source: 'project-dsh' },
        // A user-level root: the location manager already reports it, so the
        // index must not add a second row for the same skill.
        { name: 'double', skillDir: '/root/.agents/skills/double', source: 'user-agents' },
      ],
    ).listSkillLocations()

    expect(rows.map(row => row.name)).toEqual(['dir-name', 'project-skill'])
    expect(rows.find(row => row.name === 'dir-name')?.root).toBe('user')
    expect(rows.find(row => row.name === 'project-skill')?.root).toBe('project')
  })
})
