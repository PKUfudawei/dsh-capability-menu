import type { PolicyChoice } from './remote.ts'

/** Coalesce clicks, serialize writes, and retain failed changes for explicit retry. */
export class PolicySaveQueue {
  private pending = new Map<string, PolicyChoice>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private writing: Promise<void> | undefined
  private inFlight = new Map<string, PolicyChoice>()
  revision = 0
  error: unknown = null
  constructor(private save: (changes: PolicyChoice[]) => Promise<void>, private changed: () => void, private delay = 1500) {}
  get dirty(): boolean { return this.pending.size > 0 || this.writing !== undefined }
  get choices(): PolicyChoice[] { return [...new Map([...this.inFlight, ...this.pending]).values()] }
  enqueue(changes: PolicyChoice[]): void {
    for (const change of changes) this.pending.set(JSON.stringify([change.kind, change.id]), change)
    this.revision++
    this.error = null
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush() }, this.delay)
    this.changed()
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer)
    this.timer = undefined
    if (this.writing) { await this.writing; if (!this.error && this.timer === undefined) await this.flush(); return }
    if (!this.pending.size) return
    const batch = this.pending
    this.inFlight = batch
    this.pending = new Map()
    this.error = null
    this.writing = Promise.resolve().then(() => this.save([...batch.values()])).catch(error => {
      for (const [key, choice] of batch) if (!this.pending.has(key)) this.pending.set(key, choice)
      this.error = error
    })
    this.changed()
    await this.writing
    this.writing = undefined
    this.inFlight = new Map()
    this.changed()
  }
}
