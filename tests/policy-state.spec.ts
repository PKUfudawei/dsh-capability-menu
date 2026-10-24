import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateLegacySearchState, readMenuState, writeSearchState, writeTierState } from '../src/policy-state.ts'

describe('unified menu state', () => {
  it('migrates legacy search choices without losing tier choices', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-menu-state-'))
    const stateFile = join(dir, 'capability-menu-policy.json')
    const legacyFile = join(dir, 'capability-menu-search-metadata.json')
    await writeFile(stateFile, JSON.stringify({ version: 1, tools: { bash: 'resident' }, skills: { slides: 'on-demand' } }))
    await writeFile(legacyFile, JSON.stringify({
      _settings: { summaryMaxChars: 180 },
      'skill:slides': { description: 'Make presentation slides' },
    }))

    expect(await migrateLegacySearchState(stateFile, legacyFile)).toBe(true)
    const state = await readMenuState(stateFile)
    expect(state.tiers.tool.get('bash')).toBe('resident')
    expect(state.tiers.skill.get('slides')).toBe('on-demand')
    expect(state.search.summaryMaxChars).toBe(180)
    expect(state.search.descriptions.get('skill:slides')).toBe('Make presentation slides')
    expect(JSON.parse(await readFile(stateFile, 'utf8')).version).toBe(2)
    const backup = (await readdir(dir)).find(name => name.startsWith('capability-menu-search-metadata.json.migrated-'))
    expect(backup).toBeDefined()
    expect(await readFile(join(dir, backup!), 'utf8')).toContain('Make presentation slides')

    await writeSearchState(stateFile, { description: { key: 'skill:slides', value: 'New description' } })
    expect(await migrateLegacySearchState(stateFile, legacyFile)).toBe(false)
    expect((await readMenuState(stateFile)).search.descriptions.get('skill:slides')).toBe('New description')
  })

  it('preserves both sections when policy and search write together', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-menu-state-'))
    const stateFile = join(dir, 'capability-menu-policy.json')
    await Promise.all([
      writeTierState(stateFile, { tool: new Map([['bash', 'on-demand']]), skill: new Map() }),
      writeSearchState(stateFile, { description: { key: 'tool:bash', value: 'Run a command' } }),
      writeSearchState(stateFile, { summaryMaxChars: 120 }),
    ])

    const state = await readMenuState(stateFile)
    expect(state.tiers.tool.get('bash')).toBe('on-demand')
    expect(state.search.descriptions.get('tool:bash')).toBe('Run a command')
    expect(state.search.summaryMaxChars).toBe(120)
  })

  it('imports legacy search choices after a tier edit upgraded the state file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-menu-state-'))
    const stateFile = join(dir, 'capability-menu-policy.json')
    const legacyFile = join(dir, 'capability-menu-search-metadata.json')
    await writeFile(stateFile, JSON.stringify({ version: 1, tools: {}, skills: {} }))
    await writeFile(legacyFile, JSON.stringify({
      _settings: { summaryMaxChars: 160 },
      'tool:bash': { description: 'Run commands' },
    }))
    await writeTierState(stateFile, { tool: new Map([['bash', 'on-demand']]), skill: new Map() })

    expect(await migrateLegacySearchState(stateFile, legacyFile)).toBe(true)
    const state = await readMenuState(stateFile)
    expect(state.tiers.tool.get('bash')).toBe('on-demand')
    expect(state.search.summaryMaxChars).toBe(160)
    expect(state.search.descriptions.get('tool:bash')).toBe('Run commands')
  })
})
