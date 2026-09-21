/**
 * When to re-read the catalog, and how often to look — the decisions behind the
 * management page keeping itself fresh, kept as pure functions.
 *
 * Wiring lives in `CapabilitySection.tsx` (timers, the `visibilitychange`
 * listener, the two subscriptions); everything that could be got wrong lives
 * here, where a test can reach it. This repo has no DOM harness.
 */

/** How often a visible, idle page asks the host for its catalog version. */
export const POLL_INTERVAL_MS = 10_000

/** Ceiling for the failure backoff, so a long outage does not spin. */
export const POLL_BACKOFF_MAX_MS = 60_000

/**
 * Delay before the next version poll.
 *
 * `failures` is the run of consecutive failures ending at this decision: 0
 * means the last sample succeeded and the plain interval applies, otherwise the
 * delay doubles until it hits the ceiling. This is what turns "the carrier
 * died" from a hot loop into a slow retry that heals itself when it comes back.
 */
export function pollDelayMs(failures: number): number {
  if (!Number.isFinite(failures) || failures <= 0) return POLL_INTERVAL_MS
  return Math.min(POLL_INTERVAL_MS * 2 ** failures, POLL_BACKOFF_MAX_MS)
}

/**
 * Whether a version sample means the catalog moved under the page.
 *
 * Deliberately `!==` rather than `>`: the counter is in-process, so it restarts
 * from zero when the plugin reloads, and a plain "greater than" test would sit
 * there believing a fresh host was the same host. `undefined` (nothing sampled
 * yet) only records — the page has just read the snapshot, and re-reading it
 * because it has no baseline would be busywork.
 */
export function versionChanged(seen: number | undefined, current: number): boolean {
  return seen !== undefined && seen !== current
}

/** What the page is currently doing, as far as re-reading is concerned. */
export interface RevalidateGate {
  /** The document is visible. Nothing needs updating behind a hidden tab. */
  readonly visible: boolean
  /** A snapshot is on screen. Before that there is nothing to keep in step. */
  readonly ready: boolean
  /**
   * A classification round trip is in flight. Its local change is optimistic,
   * so a re-read landing in this window would paint the old tier back onto the
   * row the operator just clicked.
   */
  readonly busy: boolean
  /** A rebuild-and-re-read is already running; one is enough. */
  readonly rebuilding: boolean
}

/** Whether a signal may act now, or has to be parked until the page is idle. */
export function canRevalidate(gate: RevalidateGate): boolean {
  return gate.visible && gate.ready && !gate.busy && !gate.rebuilding
}
