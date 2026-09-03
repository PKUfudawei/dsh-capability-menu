/**
 * Host-side Typert gateway exposing the server-side `ctx.capabilityPolicy`
 * management surface (see `src/policy.ts`) to the browser. Built as
 * `lib/server/remote.js` and mounted by the package root entry (`src/index.ts`).
 *
 * Consumed by the browser bundle under `src/client` via
 * `ctx.remote.capabilityPolicy.classifyAll()` / `getConfig()` /
 * `updateConfig()`.
 */
import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { CapabilityClassification, CapabilityPolicyService, Config as CapabilityPolicyConfig } from '../policy.ts';
import type { CapabilityDetail, SkillDirEntry, CapabilityService } from '../registry.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        capabilityPolicy: CapabilityPolicyService;
        capability: CapabilityService;
    }
}
/** 能力目录查看负载：两份只读「文件」+ 缺失原因。 */
export interface CatalogDocs {
    /** 当前生效的三档策略配置（getConfig() + metaTools()），YAML 文本。 */
    readonly policyYaml: string;
    /** 按需能力目录物化文件（capability.catalogPath()）。 */
    readonly catalog?: {
        readonly path: string;
        readonly content: string;
    };
    /** catalog 不可用原因：'disabled' = catalogFile 为空（未启用物化）；'read-failed' = 读盘失败。 */
    readonly catalogMissing?: 'disabled' | 'read-failed';
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
export declare class CapabilityPolicyGateway extends TypertRemoteService {
    static inject: string[];
    constructor(ctx: Context);
    /** Current (resolved) policy config. */
    getConfig(): CapabilityPolicyConfig;
    /** Replace a subset of the policy config (recompile rules + rewrite catalog). */
    updateConfig(partial: Partial<CapabilityPolicyConfig>): Promise<void>;
    /** Classify every capability currently indexed by `ctx.capability`. */
    classifyAll(): CapabilityClassification[];
    /** Resolve one capability's full detail (schema, description; skill body optional). */
    getDetail(id: string): Promise<CapabilityDetail | undefined>;
    /** List a skill's directory children (one level deep; optional subpath). */
    listSkillDir(id: string, relPath?: string): Promise<SkillDirEntry[] | undefined>;
    /** Read a text file inside a skill's directory. */
    readSkillFile(id: string, relPath: string): Promise<string | undefined>;
    /**
     * 能力目录查看：返回当前生效的三档策略配置 YAML，以及按需能力目录
     * 物化文件（~/.dsh/capability-catalog.yaml）的路径与内容。两者都是
     * 只读视图——策略持久化入口仍是 cordis.patch.yml。
     */
    getCatalogDocs(): Promise<CatalogDocs>;
}
/** Register the remote gateway on a context. */
export declare const name = "capability-menu-remote";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
//# sourceMappingURL=remote.d.ts.map