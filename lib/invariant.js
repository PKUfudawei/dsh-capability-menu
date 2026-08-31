/**
 * Package-owned invariant companion for `@daweifu/capability-menu`.
 * @module @daweifu/capability-menu/invariant
 */
const PACKAGE_NAME = '@daweifu/capability-menu';
/** Cordis companion plugin name. */
export const name = 'capability-menu-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: the capability catalog has no independent lifecycle
 * stream; its index mirrors the tools/skills registries it observes.
 */
const install = () => { };
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
/* jscpd:ignore-end */
//# sourceMappingURL=invariant.js.map