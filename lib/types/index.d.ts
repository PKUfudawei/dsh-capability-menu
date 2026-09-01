/**
 * Host loader entry for the browser implementation exported from `./client`.
 *
 * The cordis loader imports a plugin entry's package root (`main` / exports["."])
 * in the Node host process. The browser half must therefore be exposed only via
 * the `./client` subpath (which `@deepseek-ai/dsh-client-modules` scans and
 * serves as `/plugins/<id>/client.js`).
 *
 * The root entry mounts the Typert gateway that exposes the server-side
 * `ctx.capabilityPolicy` service (provided by `@daweifu/capability-menu`) to
 * the browser as the `capabilityPolicy` remote namespace — the data source of
 * the 能力菜单 tab.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map