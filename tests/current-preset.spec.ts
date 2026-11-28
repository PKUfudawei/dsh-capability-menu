import { describe, expect, it } from 'vitest'
import { currentPresetKey, type SessionSource } from '../src/client/current-preset.ts'

function source(byId: ReturnType<SessionSource['getSnapshot']>['byId']): SessionSource {
  return { getSnapshot: () => ({ byId }), subscribe: () => () => {} }
}
describe('current session preset', () => {
  it('follows the main session, ignoring retained background sessions', () => {
    const a = { id: 'a', retainedBy: { mainView: 1 }, projectionValues: { agentPreset: 'cordis' } }
    const b = { id: 'b', retainedBy: { mainView: 0 }, projectionValues: { agentPreset: 'minimal' } }
    const sessions = source({ a, b })
    expect(currentPresetKey(sessions)).toBe('["a","cordis"]')
    a.retainedBy.mainView = 0; b.retainedBy.mainView = 1
    expect(currentPresetKey(sessions)).toBe('["b","minimal"]')
    expect(a.projectionValues.agentPreset).toBe('cordis')
  })
  it('waits for resolved navigation rather than guessing a default', () => {
    expect(currentPresetKey(source({}))).toBeNull()
    expect(currentPresetKey(source({ a: { id: 'a', retainedBy: { mainView: 1 } } }))).toBeNull()
    const row = { id: 'a', retainedBy: { mainView: 1 }, projectionValues: { agentPreset: 'cordis' } }
    expect(currentPresetKey(source({ a: row, b: { ...row, id: 'b' } }))).toBeNull()
  })
  it('distinguishes sessions sharing a preset so the panel refreshes on navigation', () => {
    const row = { id: 'a', retainedBy: { mainView: 1 }, projectionValues: { agentPreset: 'cordis' } }
    expect(currentPresetKey(source({ a: row }))).not.toBe(currentPresetKey(source({ b: { ...row, id: 'b' } })))
  })
})
