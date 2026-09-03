#!/usr/bin/env node
/**
 * Migrate legacy rule keys in a dsh profile patch.
 *
 * The Resident/On-demand/Blocked tier keys used to be spelled
 * `exposed`/`progressive`; they are now `resident`/`on-demand`. This script
 * rewrites the rule keys inside the `capability-menu-policy` entry's `config`
 * (tools.* and skills.*) of a profile's `cordis.patch.yml`, preserving all
 * other formatting and comments. The policy also auto-maps the legacy keys at
 * runtime, so this is only needed to persist the new spelling.
 *
 * Usage:
 *   node scripts/migrate-capability-keys.mjs <profile-cordis-patch.yml> [--dry-run]
 *
 * Example:
 *   node scripts/migrate-capability-keys.mjs ~/.dsh/profiles/web/cordis.patch.yml --dry-run
 *   node scripts/migrate-capability-keys.mjs ~/.dsh/profiles/web/cordis.patch.yml
 */
import { readFile, writeFile } from 'node:fs/promises'

const [, , fileArg, flag] = process.argv
const file = fileArg ?? 'cordis.patch.yml'
const dryRun = flag === '--dry-run'

const KEY_RENAME = [
  [/^(\s*)exposed(:.*)$/, '$1resident$2'],
  [/^(\s*)progressive(:.*)$/, '$1on-demand$2'],
]

const lines = (await readFile(file, 'utf8')).split('\n')

// Locate the real (non-comment) `capability-menu-policy` entry.
let policyIndex = -1
for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i]
  if (line.trimStart().startsWith('#')) continue
  if (line.includes("@daweifu/capability-menu/policy")) {
    policyIndex = i
    break
  }
}
if (policyIndex === -1) {
  console.error(`migrate-capability-keys: no '@daweifu/capability-menu/policy' entry found in ${file}`)
  process.exit(1)
}

// Find the `config:` line that belongs to that entry and its indentation.
let configIndex = -1
let configIndent = ''
for (let i = policyIndex + 1; i < lines.length; i += 1) {
  const line = lines[i]
  if (line.trimStart().startsWith('#')) continue
  const match = /^(\s*)config:$/.exec(line)
  if (match) {
    configIndex = i
    configIndent = match[1]
    break
  }
}
if (configIndex === -1) {
  console.error('migrate-capability-keys: found the policy entry but no `config:` block to migrate')
  process.exit(1)
}

// Rewrite deeper-indented `exposed:` / `progressive:` keys until the config block ends.
let changed = 0
for (let i = configIndex + 1; i < lines.length; i += 1) {
  const line = lines[i]
  const indent = /^\s*/.exec(line)?.[0] ?? ''
  if (!line.trim() || line.trimStart().startsWith('#')) continue
  // A shallower non-blank line ends the config block (next plugin entry or root key).
  if (indent.length <= configIndent.length) break
  const trimmed = line.trimStart()
  const replaced = KEY_RENAME.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    line,
  )
  if (replaced !== line) {
    if (dryRun) console.log(`- ${line}\n+ ${replaced}`)
    lines[i] = replaced
    changed += 1
  }
  void trimmed
}

if (changed === 0) {
  console.log(`migrate-capability-keys: no legacy keys found in ${file} (already migrated?)`)
} else if (!dryRun) {
  await writeFile(file, lines.join('\n'), 'utf8')
  console.log(`migrate-capability-keys: migrated ${changed} rule key(s) in ${file}`)
} else {
  console.log(`migrate-capability-keys: dry-run — ${changed} rule key(s) would change in ${file}`)
}
