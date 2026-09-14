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

  it('disables and re-enables a declared server', async () => {
    const { registry, patchFile } = await fixture()
    expect(await registry.setMcpEnabled('mcp-existing', false)).toBe(true)
    expect((await readEntries(patchFile))[0]?.disabled).toBe(true)

    expect(await registry.setMcpEnabled('mcp-existing', true)).toBe(true)
    expect((await readEntries(patchFile))[0]?.disabled).toBeUndefined()
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
})
