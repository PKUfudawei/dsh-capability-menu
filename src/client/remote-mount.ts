export type RemoteMountState<T> =
  | { status: 'loading' }
  | { status: 'ready', remote: T }
  | { status: 'error', error: string }

export interface RemoteMount<T> {
  start(): void
  dispose(): void
  getSnapshot(): RemoteMountState<T>
  subscribe(listener: () => void): () => void
}

/** Own asynchronous mounting without extending the plugin activation promise. */
export function createRemoteMount<T>(
  mount: () => Promise<() => void | Promise<void>>,
  resolve: () => T | undefined,
): RemoteMount<T> {
  let state: RemoteMountState<T> = { status: 'loading' }
  let disposed = false
  let started = false
  let cleanup: (() => void | Promise<void>) | undefined
  const listeners = new Set<() => void>()
  const release = async (dispose: () => void | Promise<void>): Promise<void> => {
    try { await dispose() } catch (error) {
      console.error('[capability-menu] remote disposal failed:', error)
    }
  }
  const run = async (): Promise<void> => {
    try {
      const dispose = await mount()
      if (disposed) { await release(dispose); return }
      cleanup = dispose
      const remote = resolve()
      if (remote === undefined) throw new Error('capabilityPolicy remote unavailable after mounting')
      state = { status: 'ready', remote }
    } catch (error) {
      if (disposed) return
      console.error('[capability-menu] $mount failed:', error)
      state = { status: 'error', error: String(error) }
    }
    if (!disposed) for (const listener of listeners) {
      try { listener() } catch (error) {
        console.error('[capability-menu] remote state listener failed:', error)
      }
    }
  }
  return {
    start() {
      if (started || disposed) return
      started = true
      void run()
    },
    dispose() {
      if (disposed) return
      disposed = true
      listeners.clear()
      if (cleanup) { const dispose = cleanup; cleanup = undefined; void release(dispose) }
    },
    getSnapshot: () => state,
    subscribe(listener) {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
