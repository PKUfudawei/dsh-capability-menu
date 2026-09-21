/**
 * Build-time constants the browser bundle is compiled with.
 *
 * `tsdown.config.mjs` replaces these identifiers with literals, so they never
 * exist as values at runtime — this file only tells `tsc` what they are.
 */

/** The package version this client bundle was built from. */
declare const __CAPABILITY_MENU_VERSION__: string
