import { defineConfig } from 'tsdown'
import { readFileSync } from 'node:fs'

const id = '@daweifu/capability-menu'
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig([{
  entry: { client: 'src/client/index.ts' },
  format: ['cjs'],
  outDir: 'lib',
  // The server half (tsc) emits into the same `lib` dir; never wipe it.
  clean: false,
  platform: 'node',
  sourcemap: false,
  // The panel shows which build it is. The browser half cannot read
  // package.json at runtime, and asking the host over a remote call for one
  // display string is not worth the round trip, so the version is inlined at
  // build time — which is also exactly the version this tarball will carry.
  define: { __CAPABILITY_MENU_VERSION__: JSON.stringify(version) },
  // Keep the file name the package.json `exports` refer to: the browser
  // bundle is served from `./client` → `lib/client.js`. tsdown emits
  // `.cjs`/`.mjs` by default; force `.js`.
  outExtensions: () => ({ js: '.js' }),
  // The dsh client module system injects these via the factory `require`:
  // never bundle them, keep them as external `require("...")` calls.
  external: [
    'react',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    // NOTE: `zod` is deliberately NOT external — the real client bundles (e.g.
    // @deepseek-ai/dsh-api-remotes) inline it, and it is not a platform seed
    // word, so an external `require("zod")` would miss the module table.
    // It also has to stay in `devDependencies`: tsdown externalizes
    // `dependencies` by default, and moving it there silently turns this into
    // `require("zod")` in the browser bundle (verified — it breaks at runtime).
    /^@deepseek-ai\//,
  ],
  // The dsh ModuleLoader invokes the factory with only `require` — the bundle
  // must declare its own CommonJS locals, mirroring every official client
  // bundle (`var module = { exports: {} }; var exports = module.exports;`),
  // and return `module.exports` so the loader captures the module table.
  banner: (ctx) => `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {\nvar module = { exports: {} };\nvar exports = module.exports;\n`,
  footer: () => `\nreturn module.exports;\n}});`,
}])
