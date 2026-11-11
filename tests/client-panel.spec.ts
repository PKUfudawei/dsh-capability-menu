import { describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { createRemoteMount } from '../src/client/remote-mount.ts'
import type { CapabilityPolicyRemote } from '../src/client/store.ts'

vi.hoisted(() => { vi.stubGlobal('__CAPABILITY_MENU_VERSION__', 'test') })

// Inspect the outer component's gate without executing the inner panel's hooks.
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ MarkdownText: () => null, IconTriangleRightFillMedium: () => null }))
import { CapabilitySection } from '../src/client/CapabilitySection.tsx'

describe('remote readiness panel gate', () => {
  it('keeps the operational panel unmounted until the remote is ready', async () => {
    let finish!: (dispose: () => void) => void
    const remote = {} as CapabilityPolicyRemote
    const remoteMount = createRemoteMount(() => new Promise(resolve => { finish = resolve }), () => remote)
    const props = { remoteMount, t: (key: string) => key, subscribeSignals: () => () => {} }
    remoteMount.start()
    expect(CapabilitySection(props).type).toBe('section')
    finish(() => {})
    await Promise.resolve()
    const panel = CapabilitySection(props) as ReactElement<{ remote: CapabilityPolicyRemote }>
    expect(typeof panel.type).toBe('function')
    expect(panel.props.remote).toBe(remote)
    remoteMount.dispose()
  })

  it('shows the mount failure without mounting the operational panel', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const remoteMount = createRemoteMount<CapabilityPolicyRemote>(async () => { throw new Error('offline') }, () => undefined)
      remoteMount.start()
      await Promise.resolve()
      const panel = CapabilitySection({ remoteMount, t: key => key, subscribeSignals: () => () => {} })
      expect(panel.type).toBe('section')
      expect(JSON.stringify(panel)).toContain('Error: offline')
      remoteMount.dispose()
    } finally { log.mockRestore() }
  })
})
