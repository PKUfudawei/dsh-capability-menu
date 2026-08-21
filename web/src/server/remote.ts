/**
 * Host-side Typert gateway exposing the server-side `ctx.capabilityPolicy`
 * management surface (see `@daweifu/capability-menu` `src/policy.ts`) to the
 * browser. Built as `lib/server/remote.js` and mounted by the package root
 * entry (`src/index.ts`).
 *
 * Consumed by the client package under `web/src/client` via
 * `ctx.remote.capabilityPolicy.classifyAll()` / `getConfig()` /
 * `updateConfig()`.
 */
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type {
  CapabilityClassification,
  CapabilityPolicyService,
  Config as CapabilityPolicyConfig,
} from '@daweifu/capability-menu/policy'
import type { CapabilityDetail, SkillDirEntry, MetaService } from '@daweifu/capability-menu/registry'

// The `ctx.capabilityPolicy` augmentation lives in `@daweifu/capability-menu`
// policy.ts; a type-only `import {}` does not reliably apply it across install
// closures, so redeclare it here against the exact cordis this package resolves.
declare module '@deepseek-ai/cordis' {
  interface Context {
    capabilityPolicy: CapabilityPolicyService
    meta: MetaService
  }
}

/**
 * Host-side remote face for the 能力菜单 tab. Every method delegates to the
 * policy service installed by `@daweifu/capability-menu/policy`; the registry
 * sibling (`meta`) must be mounted for `classifyAll` to return anything.
 *
 * The service registers under a distinct key (`capabilityPolicyGateway`) so it
 * does not collide with the `capabilityPolicy` service the policy plugin
 * provides; the Typert wire namespace is still `capabilityPolicy` (matching
 * the client remote descriptors), and the gateway reads the real policy
 * service through `this.ctx.capabilityPolicy`.
 */
export class CapabilityPolicyGateway extends TypertRemoteService {
  static inject = ['capabilityPolicy', 'meta']

  constructor(ctx: Context) {
    super(ctx, 'capabilityPolicyGateway', { namespace: 'capabilityPolicy' })
  }

  /** Current (resolved) policy config. */
  @Remote('getConfig')
  getConfig(): CapabilityPolicyConfig {
    return this.ctx.capabilityPolicy.getConfig()
  }

  /** Replace a subset of the policy config (recompile rules). */
  @Remote('updateConfig')
  updateConfig(partial: Partial<CapabilityPolicyConfig>): void {
    this.ctx.capabilityPolicy.updateConfig(partial)
  }

  /** Classify every capability currently indexed by `ctx.meta`. */
  @Remote('classifyAll')
  classifyAll(): CapabilityClassification[] {
    return [...this.ctx.capabilityPolicy.classifyAll()]
  }

  /** Resolve one capability's full detail (schema, description; skill body optional). */
  @Remote('getDetail')
  async getDetail(id: string): Promise<CapabilityDetail | undefined> {
    return this.ctx.meta.getDetail(id)
  }

  /** List a skill's directory children (one level deep; optional subpath). */
  @Remote('listSkillDir')
  async listSkillDir(id: string, relPath?: string): Promise<SkillDirEntry[] | undefined> {
    return this.ctx.meta.listSkillDir(id, relPath)
  }

  /** Read a text file inside a skill's directory. */
  @Remote('readSkillFile')
  async readSkillFile(id: string, relPath: string): Promise<string | undefined> {
    return this.ctx.meta.readSkillFile(id, relPath)
  }
}

/** Register the remote gateway on a context. */
export const name = 'capability-menu-remote'
export const inject = ['capabilityPolicy', 'meta']
export function apply(ctx: Context): void {
  ctx.plugin(CapabilityPolicyGateway)
}
