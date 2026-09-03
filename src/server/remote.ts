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
   * 能力目录查看：返回当前生效的三档策略配置 YAML，以及按需能力目录
   * 物化文件（~/.dsh/capability-catalog.yaml）的路径与内容。两者都是
   * 只读视图——策略持久化入口仍是 cordis.patch.yml。
   */
  @Remote('getCatalogDocs')
  async getCatalogDocs(): Promise<CatalogDocs> {
    const config = this.ctx.capabilityPolicy.getConfig()
    const policyYaml = [
      '# 能力菜单 · 当前生效策略（实时视图，只读；持久化入口：cordis.patch.yml）',
      '# 未在规则列表中的能力默认 Resident（常驻）。',
      yaml.dump({
        metaTools: [...this.ctx.capabilityPolicy.metaTools()],
        tools: config.tools ?? {},
        skills: config.skills ?? {},
      }),
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
