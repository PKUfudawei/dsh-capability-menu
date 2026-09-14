import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import YAML from 'yaml'
import {
  addEntry,
  findEntry,
  mutatePatch,
  readEntries,
  removeEntry,
  setEntryDisabled,
} from '../src/patch-file.ts'

/**
 * Hand-written patch file, shaped like a real one: an `- insert:` block, a top
 * comment, an inline comment and a trailing comment. Nothing here may be lost
 * by an edit.
 */
const SAMPLE = `# 顶部说明：我的 MCP 服务器
- insert:
    # gongfeng 内部服务
    - id: mcp-gongfeng
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: gongfeng
        transport: streamable-http
        url: https://example.com/mcp   # 行尾注释
`

async function sampleFile(): Promise<string> {
  const dir = await mkdtemp('/tmp/dsh-patch-file-')
  const file = join(dir, 'cordis.patch.yml')
  await writeFile(file, SAMPLE, 'utf8')
  return file
}

describe('patch-file', () => {
  it('reads entries out of an insert block', async () => {
    const file = await sampleFile()
    const entries = await readEntries(file)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.id).toBe('mcp-gongfeng')
    expect(entries[0]?.name).toBe('@deepseek-ai/dsh-mcp-client')
    expect(entries[0]?.config?.['serverName']).toBe('gongfeng')
  })

  it('appends an entry without losing any comment', async () => {
    const file = await sampleFile()
    const changed = await mutatePatch(file, doc => {
      addEntry(doc, { id: 'mcp-new', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'new' } })
      return true
    })
    expect(changed).toBe(true)

    const after = await readFile(file, 'utf8')
    expect(after).toContain('顶部说明')
    expect(after).toContain('gongfeng 内部服务')
    expect(after).toContain('行尾注释')

    const entries = await readEntries(file)
    expect(entries.map(entry => entry.id)).toEqual(['mcp-gongfeng', 'mcp-new'])
  })

  it('removes one entry and keeps the rest', async () => {
    const file = await sampleFile()
    await mutatePatch(file, doc => {
      addEntry(doc, { id: 'mcp-keep', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'keep' } })
      return true
    })

    const changed = await mutatePatch(file, doc => removeEntry(doc, 'mcp-gongfeng'))
    expect(changed).toBe(true)
    const after = await readFile(file, 'utf8')
    // The hand-written header survives the edit.
    expect(after).toContain('顶部说明')
    expect((await readEntries(file)).map(entry => entry.id)).toEqual(['mcp-keep'])
  })

  it('leaves a parseable file when the last entry is removed', async () => {
    const file = await sampleFile()
    expect(await mutatePatch(file, doc => removeEntry(doc, 'mcp-gongfeng'))).toBe(true)
    expect(await readEntries(file)).toHaveLength(0)
    // The file must still compose as a valid patch list.
    const doc = YAML.parseDocument(await readFile(file, 'utf8'))
    expect(doc.errors).toHaveLength(0)
    expect(YAML.isSeq(doc.contents)).toBe(true)
  })

  it('never writes — and never hot-reloads — when the mutation is a no-op', async () => {
    const file = await sampleFile()
    const before = await readFile(file, 'utf8')

    // Removing a row that is not there must report "no change".
    const changed = await mutatePatch(file, doc => removeEntry(doc, 'mcp-does-not-exist'))
    expect(changed).toBe(false)
    expect(await readFile(file, 'utf8')).toBe(before)
  })

  it('toggles disabled on and back off', async () => {
    const file = await sampleFile()
    await mutatePatch(file, doc => setEntryDisabled(doc, 'mcp-gongfeng', true))
    expect((await readEntries(file))[0]?.disabled).toBe(true)

    await mutatePatch(file, doc => setEntryDisabled(doc, 'mcp-gongfeng', false))
    expect((await readEntries(file))[0]?.disabled).toBeUndefined()
  })

  it('reports a write so callers know dsh will reload', async () => {
    const file = await sampleFile()
    // A second identical disable is a real edit, so it still reports a write;
    // the caller is responsible for idempotence at a higher level.
    const first = await mutatePatch(file, doc => setEntryDisabled(doc, 'mcp-gongfeng', true))
    expect(first).toBe(true)
    expect(await readFile(`${file}.bak`, 'utf8')).toBe(SAMPLE)
  })

  it('creates an insert block when the file has none', async () => {
    const dir = await mkdtemp('/tmp/dsh-patch-file-')
    const file = join(dir, 'cordis.patch.yml')
    await writeFile(file, '[]\n', 'utf8')

    await mutatePatch(file, doc => {
      addEntry(doc, { id: 'mcp-new', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'new' } })
      return true
    })
    expect((await readEntries(file)).map(entry => entry.id)).toEqual(['mcp-new'])
  })

  it('finds entries by id', async () => {
    const file = await sampleFile()
    const doc = YAML.parseDocument(await readFile(file, 'utf8'))
    expect(findEntry(doc, 'mcp-gongfeng')).toBeDefined()
    expect(findEntry(doc, 'nope')).toBeUndefined()
  })
})
