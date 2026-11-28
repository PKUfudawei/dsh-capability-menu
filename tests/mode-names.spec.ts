import { describe, expect, it, vi } from 'vitest'
import { ModeNames } from '../src/client/mode-names.ts'
import { compileNameFilter, filterRows } from '../src/client/skillGroups.ts'

describe('host mode names', () => {
  it('uses host translations dynamically and preserves explicit custom names', async () => {
    let language = 'zh'
    const hostCopy = (key: string) => ({ zh: { presetStandardName: '标准模式', presetCordisName: '创造模式' }, en: { presetStandardName: 'Standard mode', presetCordisName: 'Creator mode' } }[language] as Record<string, string>)[key] ?? key
    const names = new ModeNames(async () => [{ id: 'standard' }, { id: 'cordis' }, { id: 'team', name: 'Team workflow' }, { id: 'unnamed' }], hostCopy)
    expect(names.name('standard')).toBe('standard')
    await names.load()
    expect(names.name('standard')).toBe('标准模式')
    expect(names.name('cordis')).toBe('创造模式')
    language = 'en'
    expect(names.name('cordis')).toBe('Creator mode')
    expect(names.name('team')).toBe('Team workflow')
    expect(names.name('unnamed')).toBe('unnamed')
    expect(names.name('missing')).toBe('missing')
    const custom = new ModeNames(async () => [{ id: 'standard', name: 'My standard' }], hostCopy)
    await custom.load()
    expect(custom.name('standard')).toBe('My standard')
  })
  it('keeps the last roster on connection failure and refreshes metadata when available', async () => {
    const read = vi.fn().mockResolvedValueOnce([{ id: 'team', name: 'First' }]).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([{ id: 'team', name: 'Second' }])
    const names = new ModeNames(read, key => key)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await names.load(); await names.load()
      expect(names.name('team')).toBe('First')
      await names.load()
      expect(names.name('team')).toBe('Second')
    } finally { warn.mockRestore() }
  })
  it('matches both a visible translated mode name and the unchanged policy id', () => {
    const rows = [{ id: 's', name: 's', kind: 'skill' as const, class: 'resident' as const, mandatory: false, preset: 'cordis' }]
    const labels = { preset: () => '创造模式' }
    expect(filterRows(rows, compileNameFilter('创造模式'), labels)).toEqual(rows)
    expect(filterRows(rows, compileNameFilter('cordis'), labels)).toEqual(rows)
    expect(rows[0].preset).toBe('cordis')
  })
})
