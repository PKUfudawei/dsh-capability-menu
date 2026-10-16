/**
 * Host-side Typert gateway exposing the server-side `ctx.capabilityPolicy`
 * management surface (see `src/policy.ts`) to the browser. Built as
 * `lib/server/remote.js` and mounted by the package root entry (`src/index.ts`).
 *
 * Consumed by the browser bundle under `src/client` via
 * `ctx.remote.capabilityPolicy.classifyAll()` / `getConfig()` /
 * `updateConfig()`.
 */
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { readFile } from 'node:fs/promises'
import yaml from 'js-yaml'
import type {
  CapabilityClassification,
  CapabilityPolicyService,
  Config as CapabilityPolicyConfig,
} from '../policy.ts'
import type { CapabilityDetail, SkillDirEntry, CapabilityService, CapabilityDiagnostics, SearchMetadata, SearchMetadataUpdate } from '../registry.ts'
import { describeSkillEntry, isProjectSkillsDir } from '../locations.ts'
import type { McpInput, McpLocation, McpUpdateInput, SkillLocation } from '../locations.ts'
import { ADOPTABLE_SKILL_SOURCES, PROJECT_SKILL_SOURCES } from '../constants.ts'
import { basename, dirname, resolve } from 'node:path'

// The `ctx.capabilityPolicy` augmentation lives in `@daweifu/capability-menu`
// policy.ts; a type-only `import {}` does not reliably apply it across install
// closures, so redeclare it here against the exact cordis this package resolves.
declare module '@deepseek-ai/cordis' {
  interface Context {
    capabilityPolicy: CapabilityPolicyService
    capability: CapabilityService
  }
}

/** Effective exposure rules and the generated on-demand search catalog. */
export interface CatalogDocs {
  /** Effective rules (`getConfig()` + `metaTools()`), rendered as YAML. */
  readonly policyYaml: string
  readonly summaryMaxChars: number
  readonly searchSettingsEnabled: boolean
  /** 按需能力目录物化文件（capability.catalogPath()）。 */
  readonly catalog?: { readonly path: string; readonly content: string }
  /** catalog 不可用原因：'disabled' = catalogFile 为空（未启用物化）；'read-failed' = 读盘失败。 */
  readonly catalogMissing?: 'disabled' | 'read-failed' | 'policy-unmounted' | 'empty' | 'write-failed'
  readonly catalogState?: 'disabled' | 'policy-unmounted' | 'empty' | 'ready' | 'write-failed'
}

/**
 * Host-side remote face for the 能力菜单 tab. Every method delegates to the
 * policy service installed by `@daweifu/capability-menu/policy`; the registry
 * sibling (`capability`) must be mounted for `classifyAll` to return anything.
 *
 * The service registers under a distinct key (`capabilityPolicyGateway`) so it
 * does not collide with the `capabilityPolicy` service the policy plugin
 * provides; the Typert wire namespace is still `capabilityPolicy` (matching
 * the client remote descriptors), and the gateway reads the real policy
 * service through `this.ctx.capabilityPolicy`.
 */
export class CapabilityPolicyGateway extends TypertRemoteService {
  static inject = ['capabilityPolicy', 'capability']

  constructor(ctx: Context) {
    super(ctx, 'capabilityPolicyGateway', { namespace: 'capabilityPolicy' })
  }

  /** Current (resolved) policy config. */
  @Remote('getConfig')
  getConfig(): CapabilityPolicyConfig {
    return this.ctx.capabilityPolicy.getConfig()
  }

  /** Replace a subset of the policy config (recompile rules + rewrite catalog). */
  @Remote('updateConfig')
  async updateConfig(partial: Partial<CapabilityPolicyConfig>): Promise<void> {
    await this.ctx.capabilityPolicy.updateConfig(partial)
  }

  /** Classify every capability currently indexed by `ctx.capability`. */
  @Remote('classifyAll')
  classifyAll(): CapabilityClassification[] {
    return [...this.ctx.capabilityPolicy.classifyAll()]
  }

  /** Explain filtered, overridden, broken, empty, and unbrowseable inventory states. */
  @Remote('getDiagnostics')
  getDiagnostics(): CapabilityDiagnostics {
    return this.ctx.capability.diagnostics()
  }

  /**
   * Rebuild the capability catalog now and resolve once it has converged.
   * The UI calls this after registering a new source (an MCP server or a
   * skill directory) so the list reflects it without waiting for the
   * scheduler's debounce window.
   */
  @Remote('refresh')
  async refresh(): Promise<void> {
    await this.ctx.capability.refresh()
  }

  /** Resolve one capability's full detail (schema, description; skill body optional). */
  @Remote('getDetail')
  async getDetail(id: string): Promise<CapabilityDetail | undefined> {
    return this.ctx.capability.getDetail(id)
  }

  @Remote('getSearchMetadata')
  getSearchMetadata(id: string, kind: 'tool' | 'skill'): SearchMetadata | undefined {
    return this.ctx.capability.getSearchMetadata(id, kind)
  }

  @Remote('updateSearchMetadata')
  async updateSearchMetadata(input: SearchMetadataUpdate): Promise<void> {
    await this.ctx.capability.updateSearchMetadata(input)
  }

  @Remote('updateSummaryMaxChars')
  async updateSummaryMaxChars(value: number): Promise<void> {
    await this.ctx.capability.updateSummaryMaxChars(value)
  }

  /** List a skill's directory children (one level deep; optional subpath). */
  @Remote('listSkillDir')
  async listSkillDir(id: string, relPath?: string): Promise<SkillDirEntry[] | undefined> {
    return this.ctx.capability.listSkillDir(id, relPath)
  }

  /** Read a text file inside a skill's directory. */
  @Remote('readSkillFile')
  async readSkillFile(id: string, relPath: string): Promise<string | undefined> {
    return this.ctx.capability.readSkillFile(id, relPath)
  }

  /** Return the effective rules and the generated on-demand search catalog. */
  @Remote('getCatalogDocs')
  async getCatalogDocs(): Promise<CatalogDocs> {
    const config = this.ctx.capabilityPolicy.getConfig()
    const summaryMaxChars = this.ctx.capability.summaryMaxChars()
    const searchSettingsEnabled = this.ctx.capability.searchSettingsEnabled()
    const settings = { summaryMaxChars, searchSettingsEnabled }
    const policyYaml = yaml.dump({
      metaTools: [...this.ctx.capabilityPolicy.metaTools()],
      tools: config.tools ?? {},
      skills: config.skills ?? {},
    })
    const catalogPath = this.ctx.capability.catalogPath?.()
    if (catalogPath === undefined) {
      return { policyYaml, ...settings, catalogMissing: 'disabled', catalogState: 'disabled' }
    }
    const catalogStatus = this.ctx.capability.diagnostics().catalog
    if (catalogStatus.state === 'policy-unmounted' || catalogStatus.state === 'write-failed') {
      return { policyYaml, ...settings, catalogMissing: catalogStatus.state, catalogState: catalogStatus.state }
    }
    try {
      const content = await readFile(catalogPath, 'utf8')
      return { policyYaml, ...settings, catalog: { path: catalogPath, content }, catalogState: catalogStatus.state }
    } catch (error) {
      this.ctx.logger.warn(`capability-menu-remote: on-demand catalog read failed (${catalogPath}): ${String(error)}`)
      return { policyYaml, ...settings, catalogMissing: 'read-failed', catalogState: catalogStatus.state }
    }
  }

  // — 注册能力（MCP 服务器 / Skill 目录）—
  //
  // Every mutation edits the patch file and lets dsh hot-reload mount or
  // unmount the source. The gateway never mounts anything itself.

  /** MCP servers declared in the patch file. */
  @Remote('listLocations')
  async listLocations(): Promise<McpLocation[]> {
    return this.ctx.capabilityPolicy.listLocations()
  }

  /** Declare a new MCP server. */
  @Remote('addLocation')
  async addLocation(input: McpInput): Promise<string> {
    return this.ctx.capabilityPolicy.addLocation(input)
  }

  /** Remove a declared MCP server. */
  @Remote('removeLocation')
  async removeLocation(id: string): Promise<boolean> {
    return this.ctx.capabilityPolicy.removeLocation(id)
  }

  /** Replace a declared MCP server's connection config. */
  @Remote('updateLocation')
  async updateLocation(id: string, input: McpUpdateInput): Promise<boolean> {
    return this.ctx.capabilityPolicy.updateLocation(id, input)
  }

  /**
   * Skill entries the operator can manage: everything under the user root, plus
   * the project-scoped entries the skill index knows about.
   *
   * dsh discovers a project's skills from `<projectRoot>/.dsh/skills` and
   * `<projectRoot>/.agents/skills` for whichever project the *session* cwd sits
   * in, so reading the user root alone cannot see them. The index records each
   * skill's own directory, which is what lets these rows be edited and removed
   * rather than merely listed.
   */
  @Remote('listSkillLocations')
  async listSkillLocations(): Promise<SkillLocation[]> {
    const rows = [...await this.ctx.capabilityPolicy.listSkillLocations()]
    const seen = new Set(rows.map(row => `${row.entryDir}\u0000${row.name}`))
    for (const entry of this.ctx.capability.skillDirs()) {
      if (!PROJECT_SKILL_SOURCES.has(entry.source ?? '')) continue
      const entryDir = dirname(entry.skillDir)
      if (!isProjectSkillsDir(entryDir)) continue
      // `entry.name` is the skill's *declared* name, which need not match the
      // directory dsh found it in. `describeSkillEntry` addresses the entry
      // itself, so it has to be given the directory's own basename — passing the
      // declared name made it look for a directory that does not exist and
      // silently drop the row, leaving such a skill uneditable.
      const entryName = basename(entry.skillDir)
      const key = `${resolve(entryDir)}\u0000${entryName}`
      if (seen.has(key)) continue
      seen.add(key)
      const row = await describeSkillEntry(entryDir, entryName, 'project')
      if (row !== undefined) rows.push(row)
    }
    return rows
  }

  /**
   * Register a skill directory: into the user root by default, or into a
   * project's `.dsh/skills` when `projectPath` names a path inside that project.
   * Returns the entry path actually written so the UI can report it.
   */
  @Remote('addSkillLocation')
  async addSkillLocation(dir: string, projectPath?: string): Promise<string> {
    return this.ctx.capabilityPolicy.addSkillLocation(dir, projectPath)
  }

  /** Clone and validate the selected directory from a public GitHub skill URL. */
  @Remote('importSkillFromGitHub')
  async importSkillFromGitHub(url: string, projectPath?: string): Promise<string> {
    return this.ctx.capabilityPolicy.importSkillFromGitHub(url, projectPath)
  }

  /**
   * Adopt a skill that already lives in a user-level root this plugin reads but
   * does not manage (`~/.agents/skills`, custom dirs) by linking its own
   * directory into the user root. The content is untouched — this is exactly how
   * the entries already in `~/.dsh/skills` are set up — and the skill becomes
   * editable afterwards. Returns the entry path written.
   *
   * A skill that ships inside an agent preset is refused: linking it into the
   * user root would make it global, which is the opposite of what a preset
   * skill is for. It is also the same check the UI applies (it hides the button),
   * repeated here because the source label alone cannot tell a preset's
   * `customSkillDirs` from a user's.
   */
  @Remote('adoptSkillLocation')
  async adoptSkillLocation(name: string): Promise<string> {
    const record = this.ctx.capability.get(name.trim(), 'skill')
    const dir = record?.origin.path
    const source = record?.origin.source
    const preset = record?.origin.preset
    if (preset !== undefined) {
      throw new Error(`该技能随预设 ${preset} 分发，不支持纳入管理（纳入管理会把它变成全局技能）`)
    }
    if (dir === undefined) throw new Error(`该技能没有可链接的目录，无法纳入管理：${name}`)
    if (source === undefined || !ADOPTABLE_SKILL_SOURCES.has(source)) {
      throw new Error(`该技能来自 ${source ?? '未知来源'}，不支持纳入管理`)
    }
    return this.ctx.capabilityPolicy.addSkillLocation(dir)
  }

  /** Unregister a skill entry; `entryDir` addresses a project entry. */
  @Remote('removeSkillLocation')
  async removeSkillLocation(name: string, entryDir?: string): Promise<boolean> {
    return this.ctx.capabilityPolicy.removeSkillLocation(name, entryDir)
  }

  /** Repoint a registered skill entry at a different directory. */
  @Remote('updateSkillLocation')
  async updateSkillLocation(name: string, dir: string, entryDir?: string): Promise<boolean> {
    return this.ctx.capabilityPolicy.updateSkillLocation(name, dir, entryDir)
  }

  /**
   * The registry's catalog version — one number, cheap enough to poll. The
   * management page uses it to notice changes the wire never announces (a file
   * dropped into an already-registered skill directory reindexes the host via
   * `skills/change`, which is not a forwarded event), and only re-reads
   * `classifyAll` when the number actually moved.
   *
   * Appended at the end of the class on purpose: the client-side descriptors in
   * `src/client/remote.ts` carry each method's `sourceLocation` line, and
   * inserting here would shift every line below it.
   */
  @Remote('catalogVersion')
  catalogVersion(): number {
    return this.ctx.capability.version()
  }
}

/** Register the remote gateway on a context. */
export const name = 'capability-menu-remote'
export const inject = ['capabilityPolicy', 'capability']
export function apply(ctx: Context): void {
  ctx.plugin(CapabilityPolicyGateway)
}
