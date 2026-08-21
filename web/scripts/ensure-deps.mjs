/**
 * Build-time dependency bridge for the reference web package.
 *
 * The dsh client/host dependencies (`@deepseek-ai/*`, `react`, `zod`, `tsdown`)
 * are NOT installable from this repo's registry mirror, but they resolve from
 * the dsh profile's hoisted install (`$DSH_HOME/profiles/node_modules`). This
 * script ensures `web/node_modules` bridges to that install so both tsdown and
 * tsc can resolve them at build time — and the same bridge keeps the symlinked
 * package's host entry resolvable at runtime in the profile.
 *
 * Uses a real `node_modules` directory containing per-scope symlinks (rather
 * than one directory-level symlink) so a tool that prunes or recreates the
 * directory does not silently break resolution.
 */
import { mkdirSync, readlinkSync, symlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('..', import.meta.url))
const nodeModules = join(here, 'node_modules')
const profileModules = process.env.DSH_PROFILES_NODE_MODULES
  ?? '/root/.dsh/profiles/node_modules'

const links = [
  ['@deepseek-ai', join(profileModules, '@deepseek-ai')],
  ['@daweifu', join(profileModules, '@daweifu')],
  ['react', join(profileModules, 'react')],
  ['zod', join(profileModules, 'zod')],
  // tsdown is not a profile dep; bridge it from the harness workspace so the
  // `tsdown.config.mjs` import and the `tsdown` script resolve locally.
  ['tsdown', '/data/workspace/deepseek-harness/node_modules/.pnpm/tsdown@0.22.2_oxc-resolver@11.20.0_publint@0.3.21_tsx@4.22.4_typescript@6.0.3/node_modules/tsdown'],
]

mkdirSync(nodeModules, { recursive: true })

for (const [name, target] of links) {
  const link = join(nodeModules, name)
  if (existsSync(link) && readlinkSync(link) === target) continue
  try {
    symlinkSync(target, link, 'dir')
  } catch {
    // ignore races; a subsequent build re-establishes it
  }
}

// Expose the `tsdown` binary so `npm run bundle/build` resolves it from this
// package's own node_modules, like a normal install would.
const bin = join(nodeModules, '.bin')
mkdirSync(bin, { recursive: true })
const tsdownBin = join(bin, 'tsdown')
const harnessTsdownBin = '/data/workspace/deepseek-harness/node_modules/.bin/tsdown'
if (!existsSync(tsdownBin)) {
  try {
    symlinkSync(harnessTsdownBin, tsdownBin, 'file')
  } catch {
    // ignore races
  }
}
