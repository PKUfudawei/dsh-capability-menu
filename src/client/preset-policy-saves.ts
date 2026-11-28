import { PolicySaveQueue } from './policy-save-queue.ts'
import { unwrap, type CapabilityPolicyRemote } from './store.ts'

/** Plugin-owned queues outlive panels and navigation. Every write captures its preset. */
export class PresetPolicySaves {
  private queues = new Map<string, PolicySaveQueue>()
  private listeners = new Set<() => void>()
  private version = 0
  constructor(private remote: () => CapabilityPolicyRemote) {}
  getSnapshot = (): number => this.version
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  forPreset(preset: string): PolicySaveQueue {
    if (!preset.trim()) throw new Error('A resolved session preset is required')
    let queue = this.queues.get(preset)
    if (!queue) {
      queue = new PolicySaveQueue(async changes => {
        const remote = this.remote()
        if (!remote.setPolicyChoices) throw new Error('Host policy scope API unavailable; restart DSH')
        unwrap(await remote.setPolicyChoices(preset, changes), 'setPolicyChoices')
      }, () => { this.version++; for (const listener of this.listeners) listener() })
      this.queues.set(preset, queue)
    }
    return queue
  }
  get failures(): [string, PolicySaveQueue][] { return [...this.queues].filter(([, queue]) => queue.error != null) }
  get dirty(): boolean { return [...this.queues.values()].some(queue => queue.dirty) }
  async flush(): Promise<void> { await Promise.all([...this.queues.values()].map(queue => queue.flush())) }
}
