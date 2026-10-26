import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { windowsCommand } from '../src/server/self-update.ts'

const exec = promisify(execFile)
const PACKAGE = '@daweifu/capability-menu'
const previous = '0.1.7'
const latest = '0.1.8'
const oldLock = 'original lockfile\n'
const temporaryDirs: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('windowsCommand', () => {
  it('quotes the executable and arguments, including the outer pair required by /s', () => {
    expect(windowsCommand('pnpm', ['add', `${PACKAGE}@${latest}`, '--save-exact']))
      .toBe('""pnpm" "add" "@daweifu/capability-menu@0.1.8" "--save-exact""')
    expect(windowsCommand('C:\\Program Files\\pnpm.cmd', ['-v']))
      .toBe('""C:\\Program Files\\pnpm.cmd" "-v""')
  })

  it.each(['a"b', 'a\nb', 'a\rb', 'a\0b', '%TEMP%', '!TEMP!'])('rejects shell expansion or unsupported characters: %j', value => {
    expect(() => windowsCommand('pnpm', [value])).toThrow(/unsupported character/)
    expect(() => windowsCommand(value, [])).toThrow(/unsupported character/)
  })
})

type Mode = 'success' | 'install-failure' | 'wrong-version' | 'wrong-pin' | 'rollback-failure'
interface Invocation {
  args: string[]
  cwd: string
  manifest: string
  lock: string | null
}

/**
 * Run the updater in a disposable installed package, with a real pnpm shim on
 * PATH. Only registry responses and pnpm's installation work are faked; process
 * creation, Windows shell parsing, profile discovery, and rollback IO are real.
 */
async function update(mode: Mode = 'success', options: { lock?: boolean; source?: 'registry' | 'local' } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'capability-update-'))
  temporaryDirs.push(base)
  // The variable is explicitly defined below, so accidental shell expansion
  // cannot pass unnoticed. Keep the profile name valid for activeProfile().
  const home = join(base, '中文 home %UPDATE_TEST_EXPANSION% !UPDATE_TEST_EXPANSION! & (data)')
  const profile = join(home, 'profiles', 'desktop')
  const root = join(base, 'installed-package')
  const bin = join(base, 'pnpm with spaces')
  const manifestPath = join(profile, 'package.json')
  const lockPath = join(profile, 'pnpm-lock.yaml')
  const source = options.source ?? 'registry'
  const oldManifest = JSON.stringify({
    private: true,
    dependencies: { [PACKAGE]: source === 'local' ? `file:${root}` : `^${previous}`, unrelated: '1.2.3' },
    custom: { keep: true },
  }, null, 2) + '\n'
  await Promise.all([
    mkdir(join(profile, 'node_modules', '@daweifu'), { recursive: true }),
    mkdir(root, { recursive: true }),
    mkdir(bin, { recursive: true }),
  ])
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: PACKAGE, version: previous, type: 'module' }))
  await symlink(root, join(profile, 'node_modules', PACKAGE), process.platform === 'win32' ? 'junction' : 'dir')
  await writeFile(manifestPath, oldManifest)
  if (options.lock !== false) await writeFile(lockPath, oldLock)

  const sourceText = await readFile(new URL('../src/server/self-update.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(sourceText, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  await writeFile(join(root, 'self-update.js'), compiled)
  await writeFile(join(root, 'runner.mjs'), `
    import { installSelfUpdate, switchSelfToNpm } from './self-update.js';
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ version: '${latest}' }) });
    let error = null;
    try { await ${source === 'local' ? 'switchSelfToNpm' : 'installSelfUpdate'}('${latest}'); }
    catch (caught) { error = String(caught); }
    process.stdout.write(JSON.stringify({ error }));
  `)
  const log = join(base, 'calls.jsonl')
  await writeFile(join(bin, 'fake-pnpm.cjs'), `
    const fs = require('node:fs');
    const path = require('node:path');
    const pkg = '${PACKAGE}';
    const args = process.argv.slice(2);
    const manifestPath = path.join(process.cwd(), 'package.json');
    const lockPath = path.join(process.cwd(), 'pnpm-lock.yaml');
    const installedPath = path.join(process.cwd(), 'node_modules', pkg, 'package.json');
    const manifest = fs.readFileSync(manifestPath, 'utf8');
    const lock = fs.existsSync(lockPath) ? fs.readFileSync(lockPath, 'utf8') : null;
    fs.appendFileSync(process.env.UPDATE_TEST_LOG, JSON.stringify({ args, cwd: process.cwd(), manifest, lock }) + '\\n');
    const mode = process.env.UPDATE_TEST_MODE;
    if (args[0] === 'add') {
      const next = JSON.parse(manifest);
      next.dependencies[pkg] = mode === 'wrong-pin' ? '^${latest}' : '${latest}';
      fs.writeFileSync(manifestPath, JSON.stringify(next));
      fs.writeFileSync(lockPath, 'updated lockfile');
      const installed = JSON.parse(fs.readFileSync(installedPath, 'utf8'));
      installed.version = mode === 'wrong-version' ? '${previous}' : '${latest}';
      fs.writeFileSync(installedPath, JSON.stringify(installed));
      if (mode === 'install-failure' || mode === 'rollback-failure') {
        console.error('simulated install failure'); process.exit(1);
      }
    } else if (args[0] === 'install' && args[1] === '--frozen-lockfile') {
      if (mode === 'rollback-failure') {
        console.error('simulated rollback failure'); process.exit(2);
      }
      const installed = JSON.parse(fs.readFileSync(installedPath, 'utf8'));
      installed.version = '${previous}';
      fs.writeFileSync(installedPath, JSON.stringify(installed));
    } else {
      console.error('unexpected pnpm arguments'); process.exit(3);
    }
  `)
  if (process.platform === 'win32') {
    await writeFile(join(bin, 'pnpm.cmd'), '@echo off\r\n"%UPDATE_TEST_NODE%" "%~dp0fake-pnpm.cjs" %*\r\n')
  } else {
    await writeFile(join(bin, 'pnpm'), '#!/bin/sh\nexec "$UPDATE_TEST_NODE" "$(dirname "$0")/fake-pnpm.cjs" "$@"\n')
    await chmod(join(bin, 'pnpm'), 0o755)
  }
  // Windows environment names are case insensitive. Avoid duplicate PATH/Path
  // keys, which Node would sort and silently discard when spawning the child.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'))
  const currentPath = Object.entries(process.env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? ''
  const { stdout } = await exec(process.execPath, [join(root, 'runner.mjs')], {
    cwd: base,
    env: { ...env, PATH: bin + delimiter + currentPath, DSH_HOME: home, DSH_PROFILE: 'desktop',
      UPDATE_TEST_NODE: process.execPath, UPDATE_TEST_LOG: log, UPDATE_TEST_MODE: mode, UPDATE_TEST_EXPANSION: 'expanded-by-shell' },
    timeout: 15_000,
  })
  const outcome = JSON.parse(stdout) as { error: string | null }
  const recorded = await readFile(log, 'utf8').catch(error => {
    throw new Error(`Updater did not invoke the pnpm fixture: ${outcome.error}`, { cause: error })
  })
  const calls = recorded.trim().split('\n').map(line => JSON.parse(line) as Invocation)
  return {
    error: outcome.error,
    calls, profile, oldManifest,
    manifest: await readFile(manifestPath, 'utf8'),
    lock: await readFile(lockPath, 'utf8').catch(() => null),
    installed: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version: string },
  }
}

describe('self-update process and rollback', () => {
  it.each(['registry', 'local'] as const)('installs the exact scoped version from %s using the literal profile cwd', async source => {
    const result = await update('success', { source })
    expect(result.error).toBeNull()
    expect(result.calls).toEqual([{
      args: ['add', `${PACKAGE}@${latest}`, '--save-exact'],
      cwd: result.profile, manifest: result.oldManifest, lock: oldLock,
    }])
    const expected = JSON.parse(result.oldManifest)
    expected.dependencies[PACKAGE] = latest
    expect(JSON.parse(result.manifest)).toEqual(expected)
    expect(result.installed.version).toBe(latest)
    expect(result.lock).toBe('updated lockfile')
  }, 20_000)

  it.each([
    ['install-failure', /simulated install failure/],
    ['wrong-version', /Installed version 0\.1\.7 differs from 0\.1\.8/],
    ['wrong-pin', /Could not pin/],
  ] as const)('restores the previous installation after %s', async (mode, error) => {
    const result = await update(mode)
    expect(result.error).toMatch(error)
    expect(result.calls).toHaveLength(2)
    expect(result.calls[1]).toEqual({
      args: ['install', '--frozen-lockfile'], cwd: result.profile,
      manifest: result.oldManifest, lock: oldLock,
    })
    expect(result.manifest).toBe(result.oldManifest)
    expect(result.lock).toBe(oldLock)
    expect(result.installed.version).toBe(previous)
  }, 20_000)

  it('removes a newly created lockfile before rollback when there was no original lockfile', async () => {
    const result = await update('install-failure', { lock: false })
    expect(result.error).toMatch(/simulated install failure/)
    expect(result.calls[1]).toEqual({
      args: ['install', '--frozen-lockfile'], cwd: result.profile,
      manifest: result.oldManifest, lock: null,
    })
    expect(result.manifest).toBe(result.oldManifest)
    expect(result.lock).toBeNull()
  }, 20_000)

  it('reports both failures if restoring the installation also fails', async () => {
    const result = await update('rollback-failure')
    expect(result.error).toMatch(/simulated install failure/)
    expect(result.error).toMatch(/restoring the previous installation also failed/)
    expect(result.error).toMatch(/simulated rollback failure/)
    expect(result.manifest).toBe(result.oldManifest)
    expect(result.lock).toBe(oldLock)
  }, 20_000)
})
