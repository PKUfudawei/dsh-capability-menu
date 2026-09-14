/**
 * Location registry: the places capabilities come from.
 *
 * Two kinds of location, each following the medium dsh itself uses:
 *
 * - **MCP servers** are declared as `@deepseek-ai/dsh-mcp-client` rows in the
 *   patch file. Writing the row is all we do — dsh mounts the server, reconnects
 *   and disposes it. That is why this module never imports `dsh-mcp-client`,
 *   never mounts a fiber, and never has to arbitrate `serverName` reservations:
 *   there is exactly one source of truth (the file) and one owner (dsh).
 * - **Skill directories** are symlinked into `~/.dsh/skills/`, the default user
 *   root `skill-filesystem` discovers with no configuration at all. No patch
 *   entry, no hot reload.
 */
import { readdir, lstat, mkdir, readFile, realpath, rm, stat, symlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import yaml from 'js-yaml'
import { addEntry, defaultPatchFile, mutatePatch, readEntries, removeEntry, setEntryConfig } from './patch-file.ts'

/** Plugin name of the MCP bridge, as declared in patch rows. */
export const MCP_CLIENT_PLUGIN = '@deepseek-ai/dsh-mcp-client'

/** `serverName` must match `[A-Za-z0-9_-]{1,32}` and be unique per scope. */
const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/

export interface LocationConfig {
  /** Patch file holding the MCP rows. Defaults to the home-level layer. */
  readonly patchFile: string
  /** Skill root that `skill-filesystem` discovers by default. */
  readonly skillsDir: string
}

export function defaultLocationConfig(): LocationConfig {
  return {
    patchFile: defaultPatchFile(),
    skillsDir: defaultSkillsDir(),
  }
}

/** Default skill root: the user root `skill-filesystem` scans with no config. */
export function defaultSkillsDir(): string {
  const home = process.env['DSH_HOME']
  if (home !== undefined && home.length > 0) return join(home, 'skills')
  return join(homedir(), '.dsh', 'skills')
}

/** One MCP server, as declared in the patch file. */
export interface McpLocation {
  /** Patch row id (e.g. `mcp-gongfeng`). */
  readonly id: string
  readonly serverName: string
  readonly transport: 'stdio' | 'streamable-http'
  readonly disabled: boolean
  /** stdio: executable, argv, extra environment, working directory. */
  readonly command?: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
  /** streamable-http: endpoint and extra request headers (auth lives here). */
  readonly url?: string
  readonly headers?: Readonly<Record<string, string>>
  /** Per-tool-call timeout in milliseconds (`dsh-mcp-client` default 60000). */
  readonly toolCallTimeoutMs?: number
}

/** One skill directory registered under the default skill root. */
export interface SkillLocation {
  readonly name: string
  readonly path: string
  /** True when the entry is a symlink to a directory outside the skill root. */
  readonly linked: boolean
  /**
   * False when dsh would not load the entry: no `SKILL.md`, or a frontmatter
   * that is not a YAML mapping with a kebab-case `name` and a `description`.
   */
  readonly valid: boolean
}

/**
 * Input for editing a declared MCP server. `serverName` is deliberately absent:
 * it is the row's identity and is baked into every `mcp__<serverName>__<tool>`
 * name, session history and permission rule, so editing must not change it.
 */
export type McpUpdateInput = Omit<McpInput, 'serverName'>

/** Input for registering a new MCP server. */
export interface McpInput {
  readonly serverName: string
  readonly transport: 'stdio' | 'streamable-http'
  readonly command?: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
  readonly url?: string
  readonly headers?: Readonly<Record<string, string>>
  /** Per-tool-call timeout in milliseconds; omit to use the dsh default. */
  readonly toolCallTimeoutMs?: number
}

export class LocationRegistry {
  constructor(
    private readonly ctx: Context,
    private readonly config: LocationConfig,
  ) {}

  // --- MCP servers -------------------------------------------------------

  /** Every MCP server declared in the patch file, in file order. */
  async listMcp(): Promise<McpLocation[]> {
    const entries = await readEntries(this.config.patchFile).catch((error: unknown) => {
      this.ctx.logger.warn(`capability-locations: cannot read ${this.config.patchFile}: ${String(error)}`)
      return []
    })
    const rows: McpLocation[] = []
    for (const entry of entries) {
      if (entry.name !== MCP_CLIENT_PLUGIN) continue
      const config = entry.config ?? {}
      const serverName = config['serverName']
      if (typeof serverName !== 'string') continue
      const transport = config['transport'] === 'stdio' ? 'stdio' : 'streamable-http'
      const command = typeof config['command'] === 'string' ? config['command'] : undefined
      const args = Array.isArray(config['args'])
        ? config['args'].filter((arg): arg is string => typeof arg === 'string')
        : undefined
      const url = typeof config['url'] === 'string' ? config['url'] : undefined
      const cwd = typeof config['cwd'] === 'string' ? config['cwd'] : undefined
      const env = stringRecord(config['env'])
      const headers = stringRecord(config['headers'])
      const timeout = typeof config['toolCallTimeoutMs'] === 'number' ? config['toolCallTimeoutMs'] : undefined
      rows.push({
        id: entry.id,
        serverName,
        transport,
        disabled: entry.disabled === true,
        ...command !== undefined ? { command } : {},
        ...args !== undefined && args.length > 0 ? { args } : {},
        ...url !== undefined ? { url } : {},
        ...cwd !== undefined ? { cwd } : {},
        ...env !== undefined ? { env } : {},
        ...headers !== undefined ? { headers } : {},
        ...timeout !== undefined ? { toolCallTimeoutMs: timeout } : {},
      })
    }
    return rows
  }

  /** Declare a new MCP server row. Throws on invalid or duplicate input. */
  async addMcp(input: McpInput): Promise<string> {
    const serverName = input.serverName.trim()
    if (!SERVER_NAME_RE.test(serverName)) {
      throw new Error(`serverName 必须匹配 [A-Za-z0-9_-]{1,32}：${serverName}`)
    }
    if (input.transport === 'stdio' && (input.command ?? '').trim().length === 0) {
      throw new Error('stdio 传输必须提供 command')
    }
    if (input.transport === 'streamable-http' && (input.url ?? '').trim().length === 0) {
      throw new Error('streamable-http 传输必须提供 url')
    }

    // Duplicate `serverName` fails at mount time with a reservation error, so
    // reject it here where the user can still fix the form.
    const rows = await this.listMcp()
    if (rows.some(row => row.serverName === serverName)) {
      throw new Error(`serverName 已被占用：${serverName}`)
    }
    const id = `mcp-${serverName}`
    if (rows.some(row => row.id === id)) {
      throw new Error(`条目 id 已存在：${id}`)
    }

    const written = await mutatePatch(this.config.patchFile, doc => {
      addEntry(doc, { id, name: MCP_CLIENT_PLUGIN, config: mcpConfig(input) })
      return true
    })
    if (written) this.ctx.logger.info(`capability-locations: registered MCP server "${serverName}"`)
    return id
  }

  /** Remove a declared MCP server. Returns false when the row is absent. */
  async removeMcp(id: string): Promise<boolean> {
    const known = await this.hasMcp(id)
    if (!known) return false
    const written = await mutatePatch(this.config.patchFile, doc => removeEntry(doc, id))
    if (written) this.ctx.logger.info(`capability-locations: removed MCP row "${id}"`)
    return written
  }

  /**
   * Replace a declared server's connection config. The row id (and therefore
   * `serverName`, which is baked into every `mcp__<serverName>__<tool>` tool
   * name, session history and permission rule) is never changed here.
   */
  async updateMcp(id: string, input: McpUpdateInput): Promise<boolean> {
    const rows = await this.listMcp()
    const existing = rows.find(row => row.id === id)
    if (existing === undefined) return false
    if (input.transport === 'stdio' && (input.command ?? '').trim().length === 0) {
      throw new Error('stdio 传输必须提供 command')
    }
    if (input.transport === 'streamable-http' && (input.url ?? '').trim().length === 0) {
      throw new Error('streamable-http 传输必须提供 url')
    }
    const written = await mutatePatch(this.config.patchFile, doc => setEntryConfig(
      doc,
      id,
      // Keep the existing serverName: it is the row's identity.
      mcpConfig({ ...input, serverName: existing.serverName }),
    ))
    if (written) this.ctx.logger.info(`capability-locations: updated MCP server "${existing.serverName}"`)
    return written
  }

  private async hasMcp(id: string): Promise<boolean> {
    const rows = await this.listMcp()
    return rows.some(row => row.id === id)
  }

  // --- Skill directories -------------------------------------------------

  /** Every entry under the default skill root. */
  async listSkills(): Promise<SkillLocation[]> {
    let names: string[] = []
    try {
      names = await readdir(this.config.skillsDir)
    } catch (error) {
      this.ctx.logger.warn(`capability-locations: cannot read ${this.config.skillsDir}: ${String(error)}`)
      return []
    }
    const rows: SkillLocation[] = []
    for (const name of names) {
      const path = join(this.config.skillsDir, name)
      const info = await lstat(path).catch(() => undefined)
      if (info === undefined) continue
      const target = info.isSymbolicLink() ? path : await realpath(path).catch(() => path)
      // A skill root is either a directory or a link to one.
      if (!(info.isDirectory() || info.isSymbolicLink())) continue
      const statTarget = await stat(target).catch(() => undefined)
      if (statTarget?.isDirectory() !== true) continue
      rows.push({ name, path, linked: info.isSymbolicLink(), valid: (await checkSkillManifest(target)).ok })
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Register a skill directory by symlinking it into the default skill root. */
  async addSkill(dir: string): Promise<string> {
    if (!isAbsolute(dir)) throw new Error('skill 目录必须是绝对路径')
    const target = await realpath(dir).catch(() => undefined)
    if (target === undefined) throw new Error(`skill 目录不存在：${dir}`)
    const info = await stat(target)
    if (!info.isDirectory()) throw new Error(`不是目录：${dir}`)
    const manifest = await checkSkillManifest(target)
    if (!manifest.ok) throw new Error(manifest.message)

    const name = basename(target)
    if (name.length === 0) throw new Error(`无法从路径推导技能名：${dir}`)
    const link = join(this.config.skillsDir, name)
    const existing = await lstat(link).catch(() => undefined)
    if (existing !== undefined) throw new Error(`技能「${name}」已存在`)

    await mkdir(this.config.skillsDir, { recursive: true })
    await symlink(target, link, 'dir')
    this.ctx.logger.info(`capability-locations: linked skill "${name}" → ${target}`)
    return name
  }

  /**
   * Unregister a skill directory. Only removes a symlink or a directory that
   * actually carries a `SKILL.md` — never an arbitrary file.
   */
  async removeSkill(name: string): Promise<boolean> {
    if (name.includes('/') || name.includes('..') || name.length === 0) {
      throw new Error(`无效的技能名：${name}`)
    }
    const path = join(this.config.skillsDir, name)
    const info = await lstat(path).catch(() => undefined)
    if (info === undefined) return false

    if (info.isSymbolicLink()) {
      await rm(path)
      this.ctx.logger.info(`capability-locations: unlinked skill "${name}"`)
      return true
    }
    if (info.isDirectory() && (await readSkillManifest(path)) !== undefined) {
      await rm(path, { recursive: true })
      this.ctx.logger.info(`capability-locations: removed skill directory "${name}"`)
      return true
    }
    throw new Error(`「${name}」不是可移除的技能目录`)
  }

  /**
   * Repoint a registered skill at a different directory: unlink the old entry
   * and link the new one under the same name. The name is the skill's identity
   * in `ctx.skills`, so a rename is a remove + add, not an update.
   */
  async updateSkill(name: string, dir: string): Promise<boolean> {
    const rows = await this.listSkills()
    const existing = rows.find(row => row.name === name)
    if (existing === undefined) return false
    if (!isAbsolute(dir)) throw new Error('skill 目录必须是绝对路径')
    const target = await realpath(dir).catch(() => undefined)
    if (target === undefined) throw new Error(`skill 目录不存在：${dir}`)
    if (!(await stat(target)).isDirectory()) throw new Error(`不是目录：${dir}`)
    const manifest = await checkSkillManifest(target)
    if (!manifest.ok) throw new Error(manifest.message)

    // Resolve the current target so re-submitting the same path is a no-op
    // rather than an unlink/relink that briefly removes the skill.
    const current = await realpath(existing.path).catch(() => undefined)
    if (current === target) return false

    await this.removeSkill(name)
    await symlink(target, join(this.config.skillsDir, name), 'dir')
    this.ctx.logger.info(`capability-locations: repointed skill "${name}" → ${target}`)
    return true
  }
}

/** Build the `config:` block of a `dsh-mcp-client` row. */
function mcpConfig(input: McpInput): Record<string, unknown> {
  const config: Record<string, unknown> = {
    serverName: input.serverName.trim(),
    transport: input.transport,
  }
  if (input.transport === 'stdio') {
    config['command'] = (input.command ?? '').trim()
    if (input.args !== undefined && input.args.length > 0) config['args'] = [...input.args]
    if (input.env !== undefined && Object.keys(input.env).length > 0) config['env'] = { ...input.env }
    if (input.cwd !== undefined && input.cwd.trim().length > 0) config['cwd'] = input.cwd.trim()
  } else {
    config['url'] = (input.url ?? '').trim()
    if (input.headers !== undefined && Object.keys(input.headers).length > 0) config['headers'] = { ...input.headers }
  }
  // Only write a timeout when explicitly set, so an unset field keeps falling
  // back to the `dsh-mcp-client` default instead of pinning today's value.
  if (input.toolCallTimeoutMs !== undefined && Number.isFinite(input.toolCallTimeoutMs)) {
    config['toolCallTimeoutMs'] = input.toolCallTimeoutMs
  }
  return config
}

/** Narrow an unknown config value to a string→string map, or undefined. */
function stringRecord(value: unknown): Record<string, string> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string') out[key] = item
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Skill-name grammar enforced by `@deepseek-ai/dsh-skill` (`isSkillName`):
 * lowercase alphanumerics in kebab-case.
 */
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Outcome of validating a directory's `SKILL.md` manifest. */
type SkillManifestCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string }

/**
 * Invocation keys the loader reads, and the legacy spellings it rejects. Both
 * are optional; a legacy key or a value that cannot be read as a boolean makes
 * `parseInvocationPolicy` throw, which drops the whole skill.
 */
const INVOCATION_KEYS = ['disable-model-invocation', 'user-invocable'] as const
const LEGACY_INVOCATION_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['disableModelInvocation', 'disable-model-invocation'],
  ['modelInvocable', 'disable-model-invocation'],
  ['userInvocable', 'user-invocable'],
]

/** Read `dir/SKILL.md`, or `undefined` when it is missing or unreadable. */
async function readSkillManifest(dir: string): Promise<string | undefined> {
  return await readFile(join(dir, 'SKILL.md'), 'utf8').catch(() => undefined)
}

/** The failing side of {@link SkillManifestCheck}. */
function manifestProblem(message: string): SkillManifestCheck {
  return { ok: false, message }
}

/**
 * Validate the manifest in `dir` the way `@deepseek-ai/dsh-skill-filesystem`
 * will when it loads the skill root.
 *
 * The loader needs YAML frontmatter that parses to a mapping carrying a
 * kebab-case `name` and a `description`, and an invocation policy it can read
 * (`parseSkillFile` in that package); for anything else it logs a warning and
 * *silently skips* the skill. A directory that fails those checks would
 * therefore register successfully here and then never appear in a session, so
 * we run the same checks and reject loudly.
 */
async function checkSkillManifest(dir: string): Promise<SkillManifestCheck> {
  const raw = await readSkillManifest(dir)
  if (raw === undefined) return manifestProblem(`目录中没有 SKILL.md：${dir}`)
  const front = parseFrontmatter(raw)
  if (front === 'no-frontmatter') {
    return manifestProblem(`SKILL.md 缺少 YAML frontmatter（首行需为 --- 并以 --- 闭合）：${dir}`)
  }
  if (front === 'bad-yaml') {
    return manifestProblem(`SKILL.md 的 frontmatter 不是合法的 YAML 对象：${dir}`)
  }
  const { name, description } = front
  if (typeof name !== 'string' || typeof description !== 'string') {
    return manifestProblem(`SKILL.md 的 frontmatter 需要字符串 name 和 description：${dir}`)
  }
  if (!SKILL_NAME_RE.test(name)) {
    return manifestProblem(`SKILL.md 的 name「${name}」不是合法技能名（需为小写 kebab-case）：${dir}`)
  }
  return checkInvocation(front, dir)
}

/**
 * Validate the invocation fields. A skill without them is fine — the loader
 * defaults to model- and user-invocable — but one it cannot parse is dropped,
 * so a legacy spelling or a non-boolean value is rejected here with the
 * canonical replacement named.
 */
function checkInvocation(front: Record<string, unknown>, dir: string): SkillManifestCheck {
  for (const [legacy, canonical] of LEGACY_INVOCATION_KEYS) {
    if (Object.hasOwn(front, legacy)) {
      return manifestProblem(`SKILL.md 的 frontmatter 字段「${legacy}」已废弃，请改用「${canonical}」：${dir}`)
    }
  }
  for (const key of INVOCATION_KEYS) {
    if (Object.hasOwn(front, key) && !isFrontmatterBoolean(front[key])) {
      return manifestProblem(`SKILL.md 的 frontmatter 字段「${key}」必须是布尔值：${dir}`)
    }
  }
  return { ok: true }
}

/**
 * Whether the loader would read `value` as a boolean: a boolean, the numbers
 * 1/0, or an on/off word in any case. Mirrors `frontmatterBoolean` in
 * `@deepseek-ai/dsh-skill-filesystem`, so a manifest it accepts is not
 * rejected here.
 */
function isFrontmatterBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return true
  if (value === 1 || value === 0 || value === '1' || value === '0') return true
  if (typeof value !== 'string') return false
  return ['true', 'false', 'yes', 'no', 'on', 'off'].includes(value.toLowerCase())
}

/**
 * Split the `---`-delimited YAML frontmatter off a markdown document, mirroring
 * the loader's parser: the opening `---` must be the first line and a closing
 * `---` must exist on a line of its own.
 */
function parseFrontmatter(raw: string): Record<string, unknown> | 'no-frontmatter' | 'bad-yaml' {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return 'no-frontmatter'
  if (raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') return 'no-frontmatter'
  let closing = -1
  let lineStart = firstLineEnd + 1
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') {
      closing = lineStart
      break
    }
    if (nextNewline < 0) break
    lineStart = nextNewline + 1
  }
  if (closing < 0) return 'no-frontmatter'
  let parsed: unknown
  try {
    parsed = yaml.load(raw.slice(firstLineEnd + 1, closing))
  } catch {
    return 'bad-yaml'
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'bad-yaml'
  return parsed as Record<string, unknown>
}
