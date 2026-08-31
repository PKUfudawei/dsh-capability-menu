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
}
/** Register the remote gateway on a context. */
export declare const name = "capability-menu-remote";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
//# sourceMappingURL=remote.d.ts.map