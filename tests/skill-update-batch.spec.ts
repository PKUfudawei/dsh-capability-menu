import { describe, expect, it } from 'vitest'
import { runSkillUpdateBatch } from '../src/client/skillUpdateBatch.ts'

describe('Skill update batch', () => {
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
