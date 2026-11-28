import { describe, expect, it, vi } from 'vitest'
import { runSkillUpdateBatch } from '../src/client/skillUpdateBatch.ts'

describe('Skill update batch', () => {
  it('limits concurrent checks, fills freed slots, and counts out-of-order failures as completed', async () => {
    const pending = new Map<number, { resolve(value: string): void; reject(error: Error): void }>()
    const finished: number[] = []
    const progress: number[] = []
    const failures: number[] = []
    let active = 0
    let peak = 0
    const batch = runSkillUpdateBatch([0, 1, 2, 3, 4], async id => {
      peak = Math.max(peak, ++active)
      try {
        return await new Promise<string>((resolve, reject) => pending.set(id, { resolve, reject }))
      } finally { active-- }
    }, (id, result) => {
      finished.push(id)
      if (!result.ok) failures.push(id)
    }, done => progress.push(done), 3)
    expect([...pending.keys()]).toEqual([0, 1, 2])
    pending.get(1)!.reject(new Error('offline'))
    await vi.waitFor(() => expect(pending.has(3)).toBe(true))
    expect(finished).toEqual([1])
    pending.get(2)!.resolve('current')
    await vi.waitFor(() => expect(pending.has(4)).toBe(true))
    for (const id of [4, 3, 0]) pending.get(id)!.resolve('current')
    await batch
    expect(peak).toBe(3)
    expect(active).toBe(0)
    expect(failures).toEqual([1])
    expect(new Set(finished).size).toBe(5)
    expect(progress).toEqual([1, 2, 3, 4, 5])
  })
  it('reports each result and continues after a failed update', async () => {
    const attempted: string[] = []
    const results: string[] = []
    const progress: string[] = []
    await runSkillUpdateBatch(
      ['broken', 'healthy'],
      async name => {
        attempted.push(name)
        if (name === 'broken') throw new Error('upstream directory is missing')
        return 'updated'
      },
      (name, result) => results.push(result.ok ? `${name}:${result.value}` : `${name}:${String(result.error)}`),
      (done, total) => progress.push(`${done}/${total}`),
    )

    expect(attempted).toEqual(['broken', 'healthy'])
    expect(results).toEqual(['broken:Error: upstream directory is missing', 'healthy:updated'])
    expect(progress).toEqual(['1/2', '2/2'])
  })
})
