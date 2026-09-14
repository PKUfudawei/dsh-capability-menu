import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocationRegistry } from '../src/locations.ts'
import { readEntries } from '../src/patch-file.ts'

const PATCH = `- insert:
    - id: mcp-existing
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: existing
        transport: streamable-http
        url: https://example.com/mcp
`

async function fixture(): Promise<{ registry: LocationRegistry; patchFile: string; skillsDir: string }> {
  const dir = await mkdtemp('/tmp/dsh-locations-')
  const patchFile = join(dir, 'cordis.patch.yml')
  const skillsDir = join(dir, 'skills')
  await writeFile(patchFile, PATCH, 'utf8')
  await mkdir(skillsDir, { recursive: true })
  const ctx = new Context()
  return { registry: new LocationRegistry(ctx, { patchFile, skillsDir }), patchFile, skillsDir }
}

async function writeSkill(root: string, name: string): Promise<string> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: d\n---\n\nBody.\n`)
  return dir
}

describe('locations · MCP servers', () => {
  it('lists the MCP rows declared in the patch file', async () => {
    const { registry } = await fixture()
    const rows = await registry.listMcp()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'mcp-existing', serverName: 'existing', transport: 'streamable-http' })
    expect(rows[0]?.disabled).toBe(false)
  })

  it('adds a stdio server as a dsh-mcp-client row', async () => {
    const { registry, patchFile } = await fixture()
    const id = await registry.addMcp({ serverName: 'newsrv', transport: 'stdio', command: 'npx', args: ['-y', 'x'] })
    expect(id).toBe('mcp-newsrv')

    const entries = await readEntries(patchFile)
    const added = entries.find(entry => entry.id === 'mcp-newsrv')
    expect(added?.name).toBe('@deepseek-ai/dsh-mcp-client')
    expect(added?.config).toMatchObject({ serverName: 'newsrv', transport: 'stdio', command: 'npx', args: ['-y', 'x'] })
  })

  it('adds a streamable-http server with headers', async () => {
    const { registry, patchFile } = await fixture()
    await registry.addMcp({
      serverName: 'httpsrv',
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer t' },
    })
    const entries = await readEntries(patchFile)
    expect(entries.find(e => e.id === 'mcp-httpsrv')?.config).toMatchObject({
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer t' },
    })
  })

  it('rejects a duplicate serverName before touching the file', async () => {
    const { registry, patchFile } = await fixture()
    await expect(registry.addMcp({ serverName: 'existing', transport: 'stdio', command: 'npx' }))
      .rejects.toThrow(/已被占用/)
    expect(await readEntries(patchFile)).toHaveLength(1)
  })

  it('rejects an invalid serverName and missing required fields', async () => {
    const { registry } = await fixture()
    await expect(registry.addMcp({ serverName: 'bad name!', transport: 'stdio', command: 'npx' })).rejects.toThrow()
    await expect(registry.addMcp({ serverName: 'ok1', transport: 'stdio' })).rejects.toThrow(/command/)
    await expect(registry.addMcp({ serverName: 'ok2', transport: 'streamable-http' })).rejects.toThrow(/url/)
  })

  it('round-trips headers, env, cwd and timeout', async () => {
    const { registry, patchFile } = await fixture()
    await registry.addMcp({
      serverName: 'authed',
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer t', 'X-Org-Id': 'vpc' },
      toolCallTimeoutMs: 30_000,
    })
    await registry.addMcp({
      serverName: 'local',
      transport: 'stdio',
      command: 'npx',
      env: { FOO: 'bar' },
      cwd: '/tmp',
    })

    const rows = await registry.listMcp()
    expect(rows.find(r => r.serverName === 'authed')).toMatchObject({
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer t', 'X-Org-Id': 'vpc' },
      toolCallTimeoutMs: 30_000,
    })
    expect(rows.find(r => r.serverName === 'local')).toMatchObject({
      command: 'npx',
      env: { FOO: 'bar' },
      cwd: '/tmp',
    })
    expect(await readEntries(patchFile)).toHaveLength(3)
  })

  it('edits a server in place without changing its serverName or row id', async () => {
    const { registry, patchFile } = await fixture()
    const changed = await registry.updateMcp('mcp-existing', {
      transport: 'streamable-http',
      url: 'https://example.com/v2',
      headers: { Authorization: 'Bearer new' },
    })
    expect(changed).toBe(true)

    const row = (await registry.listMcp()).find(r => r.id === 'mcp-existing')
    // Identity is preserved: the row id and the serverName baked into every
    // `mcp__<serverName>__<tool>` name must not move.
    expect(row?.id).toBe('mcp-existing')
    expect(row?.serverName).toBe('existing')
    expect(row?.url).toBe('https://example.com/v2')
    expect(row?.headers).toEqual({ Authorization: 'Bearer new' })
    expect(await readEntries(patchFile)).toHaveLength(1)
  })

  it('rejects an edit that leaves the transport without its required field', async () => {
    const { registry, patchFile } = await fixture()
    await expect(registry.updateMcp('mcp-existing', { transport: 'streamable-http' })).rejects.toThrow(/url/)
    await expect(registry.updateMcp('mcp-existing', { transport: 'stdio' })).rejects.toThrow(/command/)
    expect(await registry.updateMcp('mcp-nope', { transport: 'stdio', command: 'x' })).toBe(false)
    // Nothing was written by the rejected calls.
    expect((await readEntries(patchFile))[0]?.config).toMatchObject({ serverName: 'existing' })
  })

  it('removes a declared server and reports an unknown id', async () => {
    const { registry, patchFile } = await fixture()
    expect(await registry.removeMcp('mcp-existing')).toBe(true)
    expect(await readEntries(patchFile)).toHaveLength(0)
    expect(await registry.removeMcp('mcp-nope')).toBe(false)
  })
})

describe('locations · skill directories', () => {
  it('registers a directory by symlinking it into the skill root', async () => {
    const { registry, skillsDir } = await fixture()
    const source = await writeSkill(join(skillsDir, '..', 'outside'), 'my-skill')

    const name = await registry.addSkill(source)
    expect(name).toBe('my-skill')
    expect(await readlink(join(skillsDir, 'my-skill'))).toBe(source)
  })

  it('rejects a relative path, a missing directory and one without SKILL.md', async () => {
    const { registry, skillsDir } = await fixture()
    await expect(registry.addSkill('relative/path')).rejects.toThrow(/绝对路径/)
    await expect(registry.addSkill(join(skillsDir, '..', 'nope'))).rejects.toThrow(/不存在/)

    const empty = join(skillsDir, '..', 'empty-skill')
    await mkdir(empty, { recursive: true })
    await expect(registry.addSkill(empty)).rejects.toThrow(/SKILL.md/)
  })

  it('rejects a duplicate skill name', async () => {
    const { registry, skillsDir } = await fixture()
    const source = await writeSkill(join(skillsDir, '..', 'outside'), 'dup-skill')
    await registry.addSkill(source)
    await expect(registry.addSkill(source)).rejects.toThrow(/已存在/)
  })

  it('lists registered skills with link and validity flags', async () => {
    const { registry, skillsDir } = await fixture()
    const linked = await writeSkill(join(skillsDir, '..', 'outside'), 'linked-skill')
    await registry.addSkill(linked)
    // A plain directory without a manifest is listed as invalid, not hidden.
    const plain = join(skillsDir, 'plain-skill')
    await mkdir(plain, { recursive: true })

    const rows = await registry.listSkills()
    expect(rows.map(row => row.name)).toEqual(['linked-skill', 'plain-skill'])
    expect(rows.find(row => row.name === 'linked-skill')).toMatchObject({ linked: true, valid: true })
    expect(rows.find(row => row.name === 'plain-skill')).toMatchObject({ linked: false, valid: false })
  })

  it('repoints a registered skill at another directory', async () => {
    const { registry, skillsDir } = await fixture()
    const first = await writeSkill(join(skillsDir, '..', 'outside'), 'repoint-skill')
    await registry.addSkill(first)

    const second = join(skillsDir, '..', 'elsewhere', 'repoint-skill')
    await mkdir(second, { recursive: true })
    await writeFile(join(second, 'SKILL.md'), '---\nname: repoint-skill\ndescription: d\n---\n\nBody.\n')

    expect(await registry.updateSkill('repoint-skill', second)).toBe(true)
    expect(await readlink(join(skillsDir, 'repoint-skill'))).toBe(second)

    // Re-submitting the same path is a no-op, not an unlink/relink.
    expect(await registry.updateSkill('repoint-skill', second)).toBe(false)
    expect(await registry.updateSkill('nope', second)).toBe(false)
  })

  it('refuses to repoint a skill at a directory without a manifest', async () => {
    const { registry, skillsDir } = await fixture()
    const source = await writeSkill(join(skillsDir, '..', 'outside'), 'guard-skill')
    await registry.addSkill(source)
    const empty = join(skillsDir, '..', 'guard-empty')
    await mkdir(empty, { recursive: true })

    await expect(registry.updateSkill('guard-skill', empty)).rejects.toThrow(/SKILL.md/)
    // The original link is untouched by the rejected repoint.
    expect(await readlink(join(skillsDir, 'guard-skill'))).toBe(source)
  })

  it('unregisters a symlinked skill and refuses to delete arbitrary files', async () => {
    const { registry, skillsDir } = await fixture()
    const source = await writeSkill(join(skillsDir, '..', 'outside'), 'gone-skill')
    await registry.addSkill(source)

    expect(await registry.removeSkill('gone-skill')).toBe(true)
    expect(await registry.listSkills()).toHaveLength(0)

    await writeFile(join(skillsDir, 'notes.txt'), 'not a skill')
    await expect(registry.removeSkill('notes.txt')).rejects.toThrow(/不是可移除的技能目录/)
    expect(await readFile(join(skillsDir, 'notes.txt'), 'utf8')).toBe('not a skill')
  })

  it('rejects a SKILL.md whose frontmatter is missing, unclosed or not a mapping', async () => {
    const { registry, skillsDir } = await fixture()

    const noFrontmatter = join(skillsDir, '..', 'no-frontmatter')
    await mkdir(noFrontmatter, { recursive: true })
    await writeFile(join(noFrontmatter, 'SKILL.md'), '# Just a heading\n')
    await expect(registry.addSkill(noFrontmatter)).rejects.toThrow(/缺少 YAML frontmatter/)

    const unclosed = join(skillsDir, '..', 'unclosed')
    await mkdir(unclosed, { recursive: true })
    await writeFile(join(unclosed, 'SKILL.md'), '---\nname: unclosed\ndescription: d\n')
    await expect(registry.addSkill(unclosed)).rejects.toThrow(/缺少 YAML frontmatter/)

    const unparsable = join(skillsDir, '..', 'unparsable')
    await mkdir(unparsable, { recursive: true })
    await writeFile(join(unparsable, 'SKILL.md'), '---\nname: [unclosed\ndescription: d\n---\nBody.\n')
    await expect(registry.addSkill(unparsable)).rejects.toThrow(/不是合法的 YAML 对象/)

    const notAMapping = join(skillsDir, '..', 'not-a-mapping')
    await mkdir(notAMapping, { recursive: true })
    await writeFile(join(notAMapping, 'SKILL.md'), '---\n- name\n- description\n---\nBody.\n')
    await expect(registry.addSkill(notAMapping)).rejects.toThrow(/不是合法的 YAML 对象/)
  })

  it('rejects frontmatter without a string name and description', async () => {
    const { registry, skillsDir } = await fixture()

    const noName = join(skillsDir, '..', 'no-name')
    await mkdir(noName, { recursive: true })
    await writeFile(join(noName, 'SKILL.md'), '---\ndescription: d\n---\nBody.\n')
    await expect(registry.addSkill(noName)).rejects.toThrow(/需要字符串 name 和 description/)

    // `name: 7` parses as a number, which the loader rejects just like a missing one.
    const numericName = join(skillsDir, '..', 'numeric-name')
    await mkdir(numericName, { recursive: true })
    await writeFile(join(numericName, 'SKILL.md'), '---\nname: 7\ndescription: d\n---\nBody.\n')
    await expect(registry.addSkill(numericName)).rejects.toThrow(/需要字符串 name 和 description/)
  })

  it('rejects a name outside the kebab-case skill grammar', async () => {
    const { registry, skillsDir } = await fixture()
    const bad = join(skillsDir, '..', 'Bad_Name')
    await mkdir(bad, { recursive: true })
    await writeFile(join(bad, 'SKILL.md'), '---\nname: Bad_Name\ndescription: d\n---\nBody.\n')

    await expect(registry.addSkill(bad)).rejects.toThrow(/不是合法技能名/)
  })

  it('rejects a legacy invocation key and names its replacement', async () => {
    const { registry, skillsDir } = await fixture()
    const legacy = join(skillsDir, '..', 'legacy-invocation')
    await mkdir(legacy, { recursive: true })
    await writeFile(
      join(legacy, 'SKILL.md'),
      '---\nname: legacy-invocation\ndescription: d\ndisableModelInvocation: true\n---\nBody.\n',
    )

    // The loader throws on the legacy spelling, which drops the skill; the
    // rejection must point at the canonical field so the fix is obvious.
    await expect(registry.addSkill(legacy)).rejects.toThrow(/disableModelInvocation/)
    await expect(registry.addSkill(legacy)).rejects.toThrow(/disable-model-invocation/)
  })

  it('rejects an invocation value the loader cannot read as a boolean', async () => {
    const { registry, skillsDir } = await fixture()
    const bad = join(skillsDir, '..', 'bad-invocation')
    await mkdir(bad, { recursive: true })
    await writeFile(
      join(bad, 'SKILL.md'),
      '---\nname: bad-invocation\ndescription: d\nuser-invocable: maybe\n---\nBody.\n',
    )

    await expect(registry.addSkill(bad)).rejects.toThrow(/user-invocable/)
  })

  it('accepts every invocation spelling the loader coerces to a boolean', async () => {
    const { registry, skillsDir } = await fixture()
    const spellings = [['on-word', 'on'], ['one-number', '1'], ['plain-bool', 'true'], ['off-word', 'off']] as const

    for (const [name, value] of spellings) {
      const dir = join(skillsDir, '..', name)
      await mkdir(dir, { recursive: true })
      await writeFile(
        join(dir, 'SKILL.md'),
        `---\nname: ${name}\ndescription: d\ndisable-model-invocation: ${value}\n---\nBody.\n`,
      )
      // Over-rejecting here would refuse manifests dsh loads happily.
      await expect(registry.addSkill(dir)).resolves.toBe(name)
    }
  })

  it('accepts a frontmatter name that differs from the directory name', async () => {
    const { registry, skillsDir } = await fixture()
    const source = await writeSkill(join(skillsDir, '..', 'outside'), 'dir-name')
    await writeFile(join(source, 'SKILL.md'), '---\nname: inner-name\ndescription: d\n---\nBody.\n')

    // dsh keys the skill by the frontmatter name; the directory name only names
    // our symlink. Registering is allowed, matching the loader's own tolerance.
    expect(await registry.addSkill(source)).toBe('dir-name')
  })

  it('marks an unloadable manifest invalid but still allows removal', async () => {
    const { registry, skillsDir } = await fixture()
    const broken = join(skillsDir, 'broken-skill')
    await mkdir(broken, { recursive: true })
    await writeFile(join(broken, 'SKILL.md'), '---\ndescription: d\n---\nBody.\n')

    const rows = await registry.listSkills()
    expect(rows.find(row => row.name === 'broken-skill')).toMatchObject({ linked: false, valid: false })

    // Removal keys off SKILL.md presence alone: a broken manifest must not
    // strand a directory in the skill root.
    expect(await registry.removeSkill('broken-skill')).toBe(true)
  })
})
