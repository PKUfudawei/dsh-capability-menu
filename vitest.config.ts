import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { defineConfig, type Plugin } from 'vitest/config'

const root = dirname(fileURLToPath(import.meta.url))

/**
 * Compile `src/server` with the project's own TypeScript, the way `npm run
 * build` does.
 *
 * Vite 8 transforms TypeScript with oxc and exposes no option for the TC39
 * (standard) decorators `@Remote` is written against: importing
 * `src/server/remote.ts` through the default pipeline dies with a syntax error,
 * which left the whole gateway untested. `typescript` is already a devDependency
 * and is what emits `lib/server/*.js`, so running it here keeps the tests on the
 * same compiler as the shipped artifact rather than adding a second one free to
 * disagree with it. Only the decorated layer needs this; everything else stays
 * on the fast default path.
 */
function tscServerFiles(): Plugin {
  const parsed = ts.parseJsonConfigFileContent(
    ts.readConfigFile(`${root}/tsconfig.json`, ts.sys.readFile).config,
    ts.sys,
    root,
  )
  return {
    name: 'capability-menu:tsc-server',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.ts') || !id.includes('/src/server/')) return undefined
      const { outputText, sourceMapText } = ts.transpileModule(code, {
        compilerOptions: {
          ...parsed.options,
          // Kept as written, unlike the build. `rewriteRelativeImportExtensions`
          // rewrites `./x.ts` to `./x.js` in the emitted file, which resolves
          // under vitest only through its `.js`-to-`.ts` fallback; leaving the
          // specifiers alone lets the test resolve the repo's own files.
          rewriteRelativeImportExtensions: false,
        },
        fileName: id,
      })
      return { code: outputText, map: sourceMapText ?? null }
    },
  }
}

export default defineConfig({
  plugins: [tscServerFiles()],
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
