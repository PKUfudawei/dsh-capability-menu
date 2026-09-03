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
 *   - `policy`   (P3): Resident/On-demand/Disabled projection policy + `ctx.capabilityPolicy`.
 * - the package root entry (`name` + `apply` below): mounts the Typert gateway
 *   that exposes `ctx.capabilityPolicy` to the browser as the `capabilityPolicy`
 *   remote namespace — the data source of the 能力管理 settings tab.
 * - a browser bundle via the `./client` subpath (`src/client`), discovered by
 *   `@deepseek-ai/dsh-client-modules` from this package's `dsh.client`
 *   declaration and served as `/plugins/<id>/client.js`.
 *
 * NOTE: this module deliberately re-exports nothing from the subpath plugins
 * (not even types — those live at `/registry`, `/search`, `/invoke`, `/policy`).
 * Re-exporting would either pollute the root entry's plugin identity with the
 * sub-plugins' `name`/`apply`/`inject`, or trigger ambiguous-type re-exports
 * (each subpath exports its own `Config` interface).
 *
 * @module @daweifu/capability-menu
 */
import type { Context } from '@deepseek-ai/cordis';
/** Root plugin identity (matches the `capability-menu` patch entry id). */
export declare const name = "capability-menu";
/** Root entry: mount the browser-facing capabilityPolicy gateway. */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map