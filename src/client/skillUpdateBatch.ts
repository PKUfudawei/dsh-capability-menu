/** Bounded workers; writes stay sequential by default, checks can opt into concurrency. */
export async function runSkillUpdateBatch<T, Result>(
  items: readonly T[],
  run: (item: T) => Promise<Result>,
  onResult: (item: T, result: { ok: true; value: Result } | { ok: false; error: unknown }) => void,
  onProgress: (done: number, total: number) => void,
  concurrency = 1,
): Promise<void> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new RangeError('Invalid concurrency')
  let done = 0
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const item = items[next++]!
      let result: { ok: true; value: Result } | { ok: false; error: unknown }
      try {
        result = { ok: true, value: await run(item) }
      } catch (error) {
        result = { ok: false, error }
      }
      onResult(item, result)
      onProgress(++done, items.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
}
