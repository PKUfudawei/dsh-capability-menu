import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lstat, readFile, readdir, realpath, unlink, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const PACKAGE = '@daweifu/capability-menu'
const execFileAsync = promisify(execFile)

/**
 * Build the command line handed to `cmd.exe /d /s /c`. The line is wrapped in
 * one extra pair of quotes because `/s` strips the first and the last quote and
 * leaves the remaining quotes in place. Reject shell expansion characters too:
 * double quotes do not stop cmd.exe from expanding environment variables.
 * Profile paths are passed via cwd, never through this command line.
 */
export function windowsCommand(file: string, args: string[]): string {
  // Keep a bare PATH command unquoted: quoting an extensionless batch command
  // can make its %~dp0 resolve against cwd instead of the shim's directory.
  if (!/^[\w.-]+$/.test(file)) throw new Error(`Cannot run ${file}: unsupported character in command`)
  for (const value of [file, ...args]) {
    if (/["%!\0\r\n]/.test(value)) throw new Error(`Cannot run ${file}: unsupported character in argument`)
  }
  return `"${file} ${args.map(arg => `"${arg}"`).join(' ')}"`
}

/**
 * `pnpm` ships as a `.cmd` shim on Windows: CreateProcess cannot execute it and
 * Node refuses to wrap a `.cmd` in a shell by itself, so a bare
 * `execFile('pnpm', …)` fails with ENOENT — and so does the rollback that calls
 * the same helper. Route Windows through cmd.exe instead.
 */
const run = (file: string, args: string[], options: { cwd: string; timeout: number; maxBuffer: number }) =>
  process.platform === 'win32'
    ? execFileAsync(process.env['ComSpec'] || 'cmd.exe', ['/d', '/v:off', '/s', '/c', windowsCommand(file, args)], { ...options, windowsVerbatimArguments: true })
    : execFileAsync(file, args, options)
let installing = false

export interface SelfUpdateStatus {
  current: string
  latest: string
  updateAvailable: boolean
  updatable: boolean
  reason?: 'local' | 'non-registry' | 'profile-unavailable'
  sourcePath?: string
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string): { parts: number[]; prerelease: string[] } => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([\da-z.-]+))?(?:\+[\da-z.-]+)?$/i.exec(value)
    if (!match) throw new Error(`Unsupported version: ${value}`)
    return { parts: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4]?.split('.') ?? [] }
  }
  const a = parse(left)
  const b = parse(right)
  for (let i = 0; i < 3; i++) {
    if (a.parts[i]! !== b.parts[i]!) return Math.sign(a.parts[i]! - b.parts[i]!)
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) return Math.sign(b.prerelease.length - a.prerelease.length)
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i]
    const y = b.prerelease[i]
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    if (x === y) continue
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) return Math.sign(Number(x) - Number(y))
    if (xn !== yn) return xn ? -1 : 1
    return x < y ? -1 : 1
  }
  return 0
}

async function packageRoot(): Promise<string> {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 5; i++, dir = dirname(dir)) {
    try {
      const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { name?: string }
      if (manifest.name === PACKAGE) return dir
    } catch { /* Continue toward the package root. */ }
  }
  throw new Error('Cannot locate capability-menu package')
}

async function activeProfile(root: string): Promise<{ name: string; dir: string; source: 'registry' | 'local' | 'other' } | undefined> {
  const home = process.env['DSH_HOME']?.trim() || join(homedir(), '.dsh')
  const profiles = join(home, 'profiles')
  const matches: { name: string; dir: string; source: 'registry' | 'local' | 'other' }[] = []
  for (const entry of await readdir(profiles, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || !/^[\w-]+$/.test(entry.name)) continue
    const dir = join(profiles, entry.name)
    const installed = join(dir, 'node_modules', PACKAGE)
    try {
      await lstat(installed)
      if (await realpath(installed) !== await realpath(root)) continue
      const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
      const spec = manifest.dependencies?.[PACKAGE] ?? ''
      const source = /^(?:file:|link:|workspace:)/.test(spec) ? 'local'
        : spec === 'latest' || spec === '*' || /^[~^=]?\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i.test(spec) ? 'registry'
        : 'other'
      matches.push({ name: entry.name, dir, source })
    } catch { /* This profile does not own this package. */ }
  }
  if (matches.length === 1) return matches[0]
  const active = process.env['DSH_PROFILE']
  return active ? matches.find(profile => profile.name === active) : undefined
}

async function latestVersion(): Promise<string> {
  const response = await fetch('https://registry.npmjs.org/@daweifu%2Fcapability-menu/latest', {
    signal: AbortSignal.timeout(10_000),
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`)
  const data = await response.json() as { version?: unknown }
  if (typeof data.version !== 'string') throw new Error('npm registry returned no version')
  return data.version
}

export async function checkSelfUpdate(): Promise<SelfUpdateStatus> {
  const root = await packageRoot()
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version: string }
  const latest = await latestVersion()
  const profile = await activeProfile(root)
  return {
    current: manifest.version,
    latest,
    updateAvailable: compareVersions(latest, manifest.version) > 0,
    updatable: profile?.source === 'registry',
    ...(profile?.source === 'local' ? { sourcePath: root } : {}),
    ...(!profile ? { reason: 'profile-unavailable' as const }
      : profile.source === 'local' ? { reason: 'local' as const }
      : profile.source === 'other' ? { reason: 'non-registry' as const } : {}),
  }
}

async function installVersion(version: string, expectedSource: 'registry' | 'local'): Promise<void> {
  if (installing) throw new Error('An update is already in progress')
  installing = true
  try {
    const status = await checkSelfUpdate()
    if (!status.updateAvailable || status.latest !== version) throw new Error('The requested version is no longer the latest update')
    const profile = await activeProfile(await packageRoot())
    if (!profile || profile.source !== expectedSource) throw new Error('The installation source changed; check for updates again')
    const manifestPath = join(profile.dir, 'package.json')
    const lockPath = join(profile.dir, 'pnpm-lock.yaml')
    const oldManifest = await readFile(manifestPath, 'utf8')
    const oldLock = await readFile(lockPath, 'utf8').catch(() => undefined)
    // `dsh plugin add package@version` can retain an existing `^` range and
    // its newer lockfile resolution, so pin the exact version. `pnpm pkg set`
    // cannot address a scoped name (its property-path parser rejects `@` with
    // ERR_PNPM_UNEXPECTED_TOKEN_IN_PROPERTY_PATH), so pin and resolve in one
    // `pnpm add --save-exact` instead of editing the manifest first.
    try {
      await run('pnpm', ['add', `${PACKAGE}@${version}`, '--save-exact'], {
        cwd: profile.dir,
        timeout: 180_000,
        maxBuffer: 1024 * 1024,
      })
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { dependencies?: Record<string, string> }
      if (manifest.dependencies?.[PACKAGE] !== version) throw new Error('Could not pin the profile dependency to the requested version')
      const installed = JSON.parse(await readFile(join(profile.dir, 'node_modules', PACKAGE, 'package.json'), 'utf8')) as { version?: string }
      if (installed.version !== version) throw new Error(`Installed version ${installed.version ?? 'unknown'} differs from ${version}`)
    } catch (error) {
      try {
        await writeFile(manifestPath, oldManifest)
        if (oldLock === undefined) await unlink(lockPath).catch(() => undefined)
        else await writeFile(lockPath, oldLock)
        await run('pnpm', ['install', '--frozen-lockfile'], {
          cwd: profile.dir,
          timeout: 180_000,
          maxBuffer: 1024 * 1024,
        })
      } catch (rollbackError) {
        throw new Error(`Update failed: ${String(error)}; restoring the previous installation also failed: ${String(rollbackError)}`)
      }
      throw error
    }
  } finally {
    installing = false
  }
}

export async function installSelfUpdate(version: string): Promise<void> {
  await installVersion(version, 'registry')
}

export async function switchSelfToNpm(version: string): Promise<void> {
  await installVersion(version, 'local')
}
