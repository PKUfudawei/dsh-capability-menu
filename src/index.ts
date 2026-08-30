/**
 * @daweifu/capability-menu — consolidated plugin package.
 *
 * One installable source package exposing four cordis plugin factories that the
 * bundle mounts as separate entries via subpath exports (`/registry`, `/search`,
 * `/invoke`, `/policy`):
 *
 * - `registry` (P0): capability catalog + `ctx.capability` service (no model tool).
 * - `search`   (P1): registers `meta_search`.
 * - `invoke`   (P2): registers `meta_invoke`.
 * - `policy`   (P3): Exposed/Progressive/Blocked projection policy + `ctx.capabilityPolicy`.
 *
 * @module @daweifu/capability-menu
 */

export * from './registry.ts'
export * as registry from './registry.ts'
export * as search from './search.ts'
export * as invoke from './invoke.ts'
export * as policy from './policy.ts'
