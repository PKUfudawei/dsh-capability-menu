/**
 * The decisions behind the management page keeping itself fresh. The wiring
 * (timers, `visibilitychange`, the two host subscriptions) has no DOM harness
 * here; these are the parts that can be got wrong quietly.
 */
import { describe, expect, it } from 'vitest'
import {
  POLL_BACKOFF_MAX_MS,
  POLL_INTERVAL_MS,
  canRevalidate,
  pollDelayMs,
  versionChanged,
  type RevalidateGate,
} from '../src/client/revalidate.ts'

describe('pollDelayMs', () => {
  it('uses the plain interval after a successful sample', () => {
    expect(pollDelayMs(0)).toBe(POLL_INTERVAL_MS)
  })

  it('doubles the delay per consecutive failure until the ceiling', () => {
    expect(pollDelayMs(1)).toBe(POLL_INTERVAL_MS * 2)
    expect(pollDelayMs(2)).toBe(POLL_INTERVAL_MS * 4)
    expect(pollDelayMs(3)).toBe(POLL_BACKOFF_MAX_MS)
    expect(pollDelayMs(4)).toBe(POLL_BACKOFF_MAX_MS)
    expect(pollDelayMs(50)).toBe(POLL_BACKOFF_MAX_MS)
  })

  it('treats a nonsense failure count as "no failures" rather than as a delay', () => {
    // NaN would otherwise propagate into setTimeout as a 0ms hot loop.
    expect(pollDelayMs(Number.NaN)).toBe(POLL_INTERVAL_MS)
    expect(pollDelayMs(-1)).toBe(POLL_INTERVAL_MS)
  })
})

describe('versionChanged', () => {
  it('records the first sample instead of treating it as a change', () => {
    // The page has just read the snapshot; it has no baseline to compare
    // against, and re-reading because of that would be a wasted round trip on
    // every mount.
    expect(versionChanged(undefined, 0)).toBe(false)
    expect(versionChanged(undefined, 7)).toBe(false)
  })

  it('is false for the same version and true for any other', () => {
    expect(versionChanged(7, 7)).toBe(false)
    expect(versionChanged(7, 8)).toBe(true)
    expect(versionChanged(7, 6)).toBe(true)
  })

  it('treats a restarted counter as a change, not as "lower is older"', () => {
    // The counter is in-process: after a plugin reload it starts over at 0, and
    // a "greater than" comparison would sit there believing nothing happened.
    expect(versionChanged(12, 0)).toBe(true)
  })
})

describe('canRevalidate', () => {
  const idle: RevalidateGate = { visible: true, ready: true, busy: false, rebuilding: false }

  it('allows a signal when the page is visible, ready and idle', () => {
    expect(canRevalidate(idle)).toBe(true)
  })

  it('refuses while a classification round trip is in flight', () => {
    // Its local change is optimistic; a re-read landing here would repaint the
    // old tier on the row the operator just clicked.
    expect(canRevalidate({ ...idle, busy: true })).toBe(false)
  })

  it('refuses while a rebuild-and-re-read is already running', () => {
    expect(canRevalidate({ ...idle, rebuilding: true })).toBe(false)
  })

  it('refuses behind a hidden tab and before a snapshot exists', () => {
    expect(canRevalidate({ ...idle, visible: false })).toBe(false)
    expect(canRevalidate({ ...idle, ready: false })).toBe(false)
  })
})
