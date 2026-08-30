/**
 * @daweifu/capability-menu — consolidated plugin package (server + browser).
 *
 * One installable source package exposing:
 *
 * - four cordis plugin factories via subpath exports (`/registry`, `/search`,
 *   `/invoke`, `/policy`), mounted by the bundle patch as separate entries:
 *   - `registry` (P0): capability catalog + `ctx.capability` service (no model tool).
 *   - `search`   (P1): registers `meta_search`.
 *   - `invoke`   (P2): registers `meta_invoke`.
 *   - `policy`   (P3): Exposed/Progressive/Blocked projection policy + `ctx.capabilityPolicy`.
 * - the package root entry (`apply` below): mounts the Typert gateway that
 *   exposes `ctx.capabilityPolicy` to the browser as the `capabilityPolicy`
 *   remote namespace — the data source of the 能力菜单 settings tab.
 * - a browser bundle via the `./client` subpath (`src/client`), discovered by
 *   `@deepseek-ai/dsh-client-modules` from this package's `dsh.client`
 *   declaration and served as `/plugins/<id>/client.js`.
 *
 * @module @daweifu/capability-menu
 */

import type { Context } from '@deepseek-ai/cordis'
import { CapabilityPolicyGateway } from './server/remote.ts'

export * from './registry.ts'
export * as registry from './registry.ts'
export * as search from './search.ts'
export * as invoke from './invoke.ts'
export * as policy from './policy.ts'

/** Root entry: mount the browser-facing capabilityPolicy gateway. */
export function apply(ctx: Context): void {
  ctx.plugin(CapabilityPolicyGateway)
}
