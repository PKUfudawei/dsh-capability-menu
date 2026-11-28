import { afterEach, describe, expect, it, vi } from 'vitest'
import { PresetPolicySaves } from '../src/client/preset-policy-saves.ts'
import type { CapabilityPolicyRemote } from '../src/client/store.ts'
const change = { kind: 'skills' as const, id: 'test', tier: 'disabled' as const }
afterEach(() => vi.useRealTimers())
describe('preset-bound saves', () => {
  it('keeps writes bound to the original preset when navigation occurs during debounce', async () => {
    vi.useFakeTimers()
    const write = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const saves = new PresetPolicySaves(() => ({ setPolicyChoices: write } as unknown as CapabilityPolicyRemote))
    saves.forPreset('cordis').enqueue([change])
    saves.forPreset('minimal').enqueue([{ ...change, tier: 'resident' }])
    await vi.advanceTimersByTimeAsync(1500)
    expect(write.mock.calls).toEqual([
      ['cordis', [change]], ['minimal', [{ ...change, tier: 'resident' }]],
    ])
    expect(saves.dirty).toBe(false)
    expect(saves.forPreset('cordis')).toBe(saves.forPreset('cordis'))
    expect(() => saves.forPreset('')).toThrow(/resolved/)
  })
  it('retains a failed old-preset queue across panels and retries only that preset', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue({ ok: true, value: undefined })
    const saves = new PresetPolicySaves(() => ({ setPolicyChoices: write } as unknown as CapabilityPolicyRemote))
    const old = saves.forPreset('cordis')
    old.enqueue([change])
    await old.flush()
    const current = saves.forPreset('minimal')
    expect(saves.failures.map(([id]) => id)).toEqual(['cordis'])
    expect(old.choices).toEqual([change])
    expect(current.choices).toEqual([])
    await saves.failures[0][1].flush()
    expect(write.mock.calls.map(call => call[0])).toEqual(['cordis', 'cordis'])
    expect(saves.failures).toEqual([])
    expect(saves.forPreset('cordis').choices).toEqual([])
  })
  it('keeps in-flight optimistic choices available when returning to an old preset', async () => {
    let finish!: () => void
    const write = vi.fn(() => new Promise<{ ok: true; value: undefined }>(resolve => { finish = () => resolve({ ok: true, value: undefined }) }))
    const saves = new PresetPolicySaves(() => ({ setPolicyChoices: write } as unknown as CapabilityPolicyRemote))
    const queue = saves.forPreset('cordis')
    queue.enqueue([change])
    const saving = queue.flush()
    await Promise.resolve()
    expect(saves.forPreset('cordis').choices).toEqual([change])
    saves.forPreset('minimal')
    finish(); await saving
    expect(write).toHaveBeenCalledExactlyOnceWith('cordis', [change])
  })
})
