import { presetDisplayText, type BuiltInPresetCopyKey, type PresetDisplaySource } from '@deepseek-ai/dsh-agent-preset-registry/display'

/** Read-only host names. Policy identity always remains the original preset id. */
export class ModeNames {
  private rows = new Map<string, PresetDisplaySource>()
  private listeners = new Set<() => void>()
  private version = 0
  private loading: Promise<void> | undefined
  constructor(private read: () => Promise<readonly PresetDisplaySource[]>, private t: (key: BuiltInPresetCopyKey) => string) {}
  getSnapshot = (): number => this.version
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  name = (id: string): string => {
    const row = this.rows.get(id)
    // Like DSH's session label, do not guess whether an unloaded id is built-in.
    return row ? presetDisplayText(row, this.t).name || id : id
  }
  load = (): Promise<void> => {
    if (this.loading) return this.loading
    this.loading = this.read().then(rows => {
      this.rows = new Map(rows.map(row => [row.id, row]))
      this.version++
      for (const listener of this.listeners) listener()
    }).catch(error => { console.warn('[capability-menu] mode names unavailable:', error) })
      .finally(() => { this.loading = undefined })
    return this.loading
  }
}
