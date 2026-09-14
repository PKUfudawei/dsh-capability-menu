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
import {
  addEntry,
  defaultPatchFile,
  mutatePatch,
  readEntries,
  removeEntry,
  setEntryConfig,
  setEntryDisabled,
} from './patch-file.ts'

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
  readonly command?: string
  readonly args?: readonly string[]
  readonly url?: string
}

/** One skill directory registered under the default skill root. */
export interface SkillLocation {
  readonly name: string
  readonly path: string
  /** True when the entry is a symlink to a directory outside the skill root. */
  readonly linked: boolean
  /** False when the entry does not look like a skill (no `SKILL.md`). */
  readonly valid: boolean
}

/** Input for registering a new MCP server. */
export interface McpInput {
  readonly serverName: string
  readonly transport: 'stdio' | 'streamable-http'
  readonly command?: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly url?: string
  readonly headers?: Readonly<Record<string, string>>
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
      rows.push({
        id: entry.id,
        serverName,
        transport,
        disabled: entry.disabled === true,
        ...command !== undefined ? { command } : {},
        ...args !== undefined && args.length > 0 ? { args } : {},
        ...url !== undefined ? { url } : {},
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

  /** Enable or disable a declared MCP server. */
  async setMcpEnabled(id: string, enabled: boolean): Promise<boolean> {
    const known = await this.hasMcp(id)
    if (!known) return false
    const written = await mutatePatch(this.config.patchFile, doc => setEntryDisabled(doc, id, !enabled))
    if (written) {
      this.ctx.logger.info(`capability-locations: ${enabled ? 'enabled' : 'disabled'} MCP row "${id}"`)
    }
    return written
  }

  /** Replace a row's connection config (used to edit an existing server). */
  async updateMcp(id: string, input: McpInput): Promise<boolean> {
    const known = await this.hasMcp(id)
    if (!known) return false
    const written = await mutatePatch(this.config.patchFile, doc => setEntryConfig(doc, id, mcpConfig(input)))
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
      rows.push({ name, path, linked: info.isSymbolicLink(), valid: await hasSkillManifest(target) })
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
    if (!(await hasSkillManifest(target))) throw new Error(`目录中没有 SKILL.md：${dir}`)

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
    if (info.isDirectory() && await hasSkillManifest(path)) {
      await rm(path, { recursive: true })
      this.ctx.logger.info(`capability-locations: removed skill directory "${name}"`)
      return true
    }
    throw new Error(`「${name}」不是可移除的技能目录`)
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
  } else {
    config['url'] = (input.url ?? '').trim()
    if (input.headers !== undefined && Object.keys(input.headers).length > 0) config['headers'] = { ...input.headers }
  }
  return config
}

/** True when `dir` carries a skill manifest. */
async function hasSkillManifest(dir: string): Promise<boolean> {
  try {
    await readFile(join(dir, 'SKILL.md'), 'utf8')
    return true
  } catch {
    return false
  }
}
