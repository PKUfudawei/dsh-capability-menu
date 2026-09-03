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
import type { CapabilityDetail, SkillDirEntry, CapabilityService } from '../registry.ts'
import { BUILT_IN_SERVER } from '../registry.ts'

// The `ctx.capabilityPolicy` augmentation lives in `@daweifu/capability-menu`
// policy.ts; a type-only `import {}` does not reliably apply it across install
// closures, so redeclare it here against the exact cordis this package resolves.
declare module '@deepseek-ai/cordis' {
  interface Context {
    capabilityPolicy: CapabilityPolicyService
    capability: CapabilityService
  }
}

/** 能力目录查看负载：两份只读「文件」+ 缺失原因。 */
export interface CatalogDocs {
  /** 当前生效的三档策略配置（getConfig() + metaTools()），YAML 文本。 */
  readonly policyYaml: string
  /** 按需能力目录物化文件（capability.catalogPath()）。 */
  readonly catalog?: { readonly path: string; readonly content: string }
  /** catalog 不可用原因：'disabled' = catalogFile 为空（未启用物化）；'read-failed' = 读盘失败。 */
  readonly catalogMissing?: 'disabled' | 'read-failed'
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

  /** Resolve one capability's full detail (schema, description; skill body optional). */
  @Remote('getDetail')
  async getDetail(id: string): Promise<CapabilityDetail | undefined> {
    return this.ctx.capability.getDetail(id)
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

  /**
   * 能力目录查看：返回「三档策略配置」（语义化视图：未列入 on-demand/blocked
   * 的能力默认常驻，resident 只显示通配 *；例外按 server 分组列出具体工具名）
   * 与按需能力目录物化文件（~/.dsh/capability-catalog.yaml）的路径和内容。
   * 两者都是只读视图——策略持久化入口仍是 cordis.patch.yml。
   */
  @Remote('getCatalogDocs')
  async getCatalogDocs(): Promise<CatalogDocs> {
    const effective = [...this.ctx.capabilityPolicy.classifyAll()]
    const toolRows = effective.filter(row => row.kind === 'tool')
    const skillRows = effective.filter(row => row.kind === 'skill')

    const count = (rows: ReadonlyArray<{ readonly class: string }>, cls: string): number =>
      rows.filter(row => row.class === cls).length

    /** 例外档（on-demand/blocked）的生效工具，按 server 分组为 server → 短名列表。 */
    const toolGroups = (cls: 'on-demand' | 'blocked'): Record<string, string[]> => {
      const groups = new Map<string, string[]>()
      for (const row of toolRows.filter(r => r.class === cls)) {
        const server = row.server ?? BUILT_IN_SERVER
        const prefix = row.server === undefined ? undefined : `mcp__${row.server}__`
        const short = prefix !== undefined && row.name.startsWith(prefix) ? row.name.slice(prefix.length) : row.name
        const list = groups.get(server)
        if (list === undefined) groups.set(server, [short])
        else list.push(short)
      }
      return Object.fromEntries([...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([server, names]) => [server, names.sort((a, b) => a.localeCompare(b))]))
    }
    /** 例外档技能的生效短名（技能无 server 维度，平铺列表）。 */
    const skillNames = (cls: 'on-demand' | 'blocked'): string[] =>
      skillRows.filter(row => row.class === cls).map(row => row.name).sort((a, b) => a.localeCompare(b))

    const policyYaml = [
      '# 能力菜单 · 当前生效策略（只读；持久化入口：cordis.patch.yml）',
      '# 语义：未列入 on-demand / blocked 的能力默认 Resident（常驻）。',
      `# 生效：tools 常驻 ${count(toolRows, 'resident')} · 按需 ${count(toolRows, 'on-demand')} · 禁用 ${count(toolRows, 'blocked')}；` +
        `skills 常驻 ${count(skillRows, 'resident')} · 按需 ${count(skillRows, 'on-demand')} · 禁用 ${count(skillRows, 'blocked')}`,
      yaml.dump({
        metaTools: [...this.ctx.capabilityPolicy.metaTools()],
        tools: {
          resident: '*',
          'on-demand': toolGroups('on-demand'),
          blocked: toolGroups('blocked'),
        },
        skills: {
          resident: '*',
          'on-demand': skillNames('on-demand'),
          blocked: skillNames('blocked'),
        },
      }).trimEnd(),
    ].join('\n')
    const catalogPath = this.ctx.capability.catalogPath?.()
    if (catalogPath === undefined) {
      return { policyYaml, catalogMissing: 'disabled' }
    }
    try {
      const content = await readFile(catalogPath, 'utf8')
      return { policyYaml, catalog: { path: catalogPath, content } }
    } catch (error) {
      this.ctx.logger.warn(`capability-menu-remote: on-demand catalog read failed (${catalogPath}): ${String(error)}`)
      return { policyYaml, catalogMissing: 'read-failed' }
    }
  }
}

/** Register the remote gateway on a context. */
export const name = 'capability-menu-remote'
export const inject = ['capabilityPolicy', 'capability']
export function apply(ctx: Context): void {
  ctx.plugin(CapabilityPolicyGateway)
}
