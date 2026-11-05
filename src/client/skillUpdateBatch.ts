/** Run Skill updates in order; one failure must not stop the remaining items. */
export async function runSkillUpdateBatch<T, Result>(
  items: readonly T[],
  run: (item: T) => Promise<Result>,
  onResult: (item: T, result: { ok: true; value: Result } | { ok: false; error: unknown }) => void,
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  let done = 0
  for (const item of items) {
    try {
      onResult(item, { ok: true, value: await run(item) })
    } catch (error) {
      onResult(item, { ok: false, error })
    }
    onProgress(++done, items.length)
  }
}
