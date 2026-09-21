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
import type { McpInput, McpLocation, McpUpdateInput, SkillLocation } from '../locations.ts';
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
    /**
     * Rebuild the capability catalog now and resolve once it has converged.
     * The UI calls this after registering a new source (an MCP server or a
     * skill directory) so the list reflects it without waiting for the
     * scheduler's debounce window.
     */
    refresh(): Promise<void>;
    /** Resolve one capability's full detail (schema, description; skill body optional). */
    getDetail(id: string): Promise<CapabilityDetail | undefined>;
    /** List a skill's directory children (one level deep; optional subpath). */
    listSkillDir(id: string, relPath?: string): Promise<SkillDirEntry[] | undefined>;
    /** Read a text file inside a skill's directory. */
    readSkillFile(id: string, relPath: string): Promise<string | undefined>;
    /**
     * 能力目录查看：返回「三档策略配置」语义化视图——默认全部常驻，
     * tools.resident 按 server 各显示 '*'，例外（on-demand/disabled）按
     * server → 工具短名 分级列出；skills 无 server 维度，resident 恒为 '*'，
     * 例外为短名平铺。空例外不渲染 key，避免 []/{} 歧义。
     * 另返回按需能力目录物化文件（~/.dsh/capability-catalog.yaml）的路径和内容。
     * 两者都是只读视图；改规则的入口是「能力菜单」的点选，改动会自动写回 cordis.patch.yml。
     */
    getCatalogDocs(): Promise<CatalogDocs>;
    /** MCP servers declared in the patch file. */
    listLocations(): Promise<McpLocation[]>;
    /** Declare a new MCP server. */
    addLocation(input: McpInput): Promise<string>;
    /** Remove a declared MCP server. */
    removeLocation(id: string): Promise<boolean>;
    /** Replace a declared MCP server's connection config. */
    updateLocation(id: string, input: McpUpdateInput): Promise<boolean>;
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
    listSkillLocations(): Promise<SkillLocation[]>;
    /**
     * Register a skill directory: into the user root by default, or into a
     * project's `.dsh/skills` when `projectPath` names a path inside that project.
     * Returns the entry path actually written so the UI can report it.
     */
    addSkillLocation(dir: string, projectPath?: string): Promise<string>;
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
    adoptSkillLocation(name: string): Promise<string>;
    /** Unregister a skill entry; `entryDir` addresses a project entry. */
    removeSkillLocation(name: string, entryDir?: string): Promise<boolean>;
    /** Repoint a registered skill entry at a different directory. */
    updateSkillLocation(name: string, dir: string, entryDir?: string): Promise<boolean>;
}
/** Register the remote gateway on a context. */
export declare const name = "capability-menu-remote";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
//# sourceMappingURL=remote.d.ts.map