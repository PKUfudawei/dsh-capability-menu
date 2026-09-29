import { describe, expect, it, vi } from 'vitest'
import {
  loadSnapshot,
  readSnapshot,
  waitForMcpTools,
  type CapabilityPolicyRemote,
  type CapabilityRow,
} from '../src/client/store.ts'

function remoteWithRows(...responses: CapabilityRow[][]): CapabilityPolicyRemote {
  let index = 0
  return {
    classifyAll: vi.fn(async () => ({
      ok: true as const,
      value: responses[Math.min(index++, responses.length - 1)] ?? [],
    })),
  } as unknown as CapabilityPolicyRemote
}

const githubTool = { id: 'mcp__github__search_repositories', kind: 'tool' } as CapabilityRow
const nativeTool = { id: 'execute_cmd', kind: 'tool' } as CapabilityRow

describe('client capability snapshots', () => {
  it('retries an empty first snapshot so late-registered built-ins appear', async () => {
    const remote = remoteWithRows([], [nativeTool])

    const snapshot = await loadSnapshot(remote, [0])

    expect(snapshot.rows).toEqual([nativeTool])
    expect(remote.classifyAll).toHaveBeenCalledTimes(2)
  })

  it('waits for a newly registered MCP server to expose its tools', async () => {
    const remote = remoteWithRows([nativeTool], [nativeTool, githubTool])

    const snapshot = await waitForMcpTools(remote, 'github', [0])

    expect(snapshot?.rows).toEqual([nativeTool, githubTool])
    expect(remote.classifyAll).toHaveBeenCalledTimes(2)
  })

  it('reports when the registered MCP server has no indexed tools before timeout', async () => {
    const remote = remoteWithRows([nativeTool])

    await expect(waitForMcpTools(remote, 'github', [0])).resolves.toBeUndefined()
    await expect(readSnapshot(remote)).resolves.toMatchObject({ rows: [nativeTool] })
  })
})
