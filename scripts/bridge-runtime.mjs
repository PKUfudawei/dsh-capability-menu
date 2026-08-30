/**
 * Runtime-only bridge for the dsh profile.
 *
 * The dsh host and this plugin both load `@deepseek-ai` packages that carry
 * module-level identity the two sides must SHARE:
 *
 *   - `@deepseek-ai/dsh-typert-protocol`: the `@Remote` marker table is a
 *     module-private WeakMap — if the plugin resolves a different copy than the
 *     host's api-gateway, `remoteMethods()` sees no markers and the
 *     `/api/<namespace>/<method>` route is never claimed (HTTP 404).
 *   - `@deepseek-ai/cordis`: the `Service` base class the Typert gateway
 *     extends — a foreign copy is not recognized as a Service by the host ctx.
 *   - `@deepseek-ai/schemastery`: config schema identity.
 *
 * This script re-points those entries in THIS package's `node_modules` at the
 * dsh host's copies (resolved through the profile), so Node dedupes to one
 * module instance. It is NOT part of `build`/`prepare` (CI must stay
 * self-contained) — run it after `pnpm install` in a local dsh environment.
 */
import { existsSync, lstatSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('..', import.meta.url))
const modules = join(here, 'node_modules')
const profileScope = process.env.DSH_PROFILES_NODE_MODULES ?? '/root/.dsh/profiles/node_modules'

const shared = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-typert-protocol',
  '@deepseek-ai/schemastery',
]

let changed = 0
for (const name of shared) {
  const link = join(modules, name)
  const target = join(profileScope, name)
  if (!existsSync(target)) {
    console.warn(`bridge-runtime: skip ${name} (host copy not found at ${target})`)
    continue
  }
  if (existsSync(link)) {
    const stat = lstatSync(link)
    if (stat.isSymbolicLink()) {
      if (readlinkSync(link) === target) continue
      rmSync(link)
    } else {
      rmSync(link, { recursive: true })
    }
  }
  symlinkSync(target, link, 'dir')
  console.log(`bridge-runtime: ${name} -> ${target}`)
  changed += 1
}
console.log(changed > 0
  ? `bridge-runtime: bridged ${changed} package(s); restart dsh for it to take effect`
  : 'bridge-runtime: nothing to bridge')
