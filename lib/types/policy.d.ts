/**
 * Exposed / Progressive / Blocked capability projection policy for the DeepSeek
 * Harness.
 *
 * @module @daweifu/capability-menu (policy plugin)
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt';
import { type CapabilityKind } from './registry.ts';
/**
 * Canonical policy classes, mirroring the registry's `CapabilityKind`.
 *
 * - `exposed`: the capability is on the dsh-native exposure surface — tools in
 *   `assembly.tools` (the request `tools` payload), skills in the
 *   `<available_skills>` catalog — so the model can call/load it single-hop.
 * - `progressive`: absent from the native surface but discoverable in the
 *   persistent meta registry; the model reaches it via `meta_search` then
 *   `meta_invoke` (catalog-resident, load/execute on demand).
 * - `blocked`: neither exposed nor discoverable nor executable.
 */
export type CapabilityClass = 'exposed' | 'progressive' | 'blocked';
/**
 * A single classify rule: an exact name or a `*`-glob pattern.
 * A pattern matches a capability id (`mcp__<server>__<raw>` / `skill:<name>`)
 * or a server name (`server:<name>`).
 */
export interface PolicyRule {
    /** Whether the rule is a literal exact name (`*` free) or a glob pattern. */
    readonly wildcard: boolean;
    /** The normalized pattern/literal this rule represents. */
    readonly pattern: string;
    /** When non-empty, this rule only applies to the given capability kind. */
    readonly kind?: CapabilityKind;
    /** When `'server'`, the pattern is matched against the server name only. */
    readonly target: 'id' | 'server';
}
/**
 * Per-kind explicit configuration. `exposed`/`progressive`/`blocked` are
 * ordered lists of exact-name / glob rules. Empty lists mean "nothing
 * explicitly classified", so the default (`exposed`) applies.
 */
export interface CapabilitySetConfig {
    /** Explicitly-Exposed rule list (exact name or glob). */
    exposed?: string[];
    /** Explicitly-Progressive rule list (exact name or glob). */
    progressive?: string[];
    /** Explicitly-Blocked rule list (exact name or glob); wins over everything. */
    blocked?: string[];
}
/** Exposed / Progressive / Blocked projection policy configuration. */
export interface Config {
    /** Tool classification: `tools.exposed` / `tools.progressive` / `tools.blocked`. */
    tools?: CapabilitySetConfig;
    /** Skill classification: `skills.exposed` / `skills.progressive` / `skills.blocked`. */
    skills?: CapabilitySetConfig;
    /**
     * Tool names that are ALWAYS kept exposed and can never be classified
     * Progressive or Blocked. Default `[meta_search, meta_invoke]`.
     */
    metaTools?: string[];
    /**
     * Optional path to a Progressive-skill catalog YAML (name + description +
     * path). Consumed by the registry as an additional skill index source (see
     * `@daweifu/capability-menu-registry` `progressiveSkillCatalog`).
     */
    progressiveSkillCatalog?: string;
    /**
     * Location-registry persistence file; defaults to
     * `$DSH_HOME/capability-locations.yaml` (or `~/.dsh/…`).
     */
    locationsFile?: string;
}
/** Validate and default the policy configuration. */
export declare const Config: z<Config>;
export declare const DEFAULT_META_TOOLS: readonly ["meta_search", "meta_invoke"];
/**
 * Convert a user-facing rule string into a normalized {@link PolicyRule}.
 * - `server:<name>` → server-targeted rule (`target: 'server'`).
 * - `server:<name>:*` → server-targeted glob over that server's tools.
 * - contains `*` → glob (target `id`).
 * - otherwise → literal exact name.
 */
export declare function parseRule(rule: string): PolicyRule;
/** Compile a `*`-glob into a RegExp (escaped, `*` → `.*`). */
export declare function compileGlob(pattern: string): RegExp;
/** A compiled rule set for one capability kind. */
export interface CompiledCapabilityRules {
    readonly exposed: readonly PolicyRule[];
    readonly progressive: readonly PolicyRule[];
    readonly blocked: readonly PolicyRule[];
}
/** Compile a {@link CapabilitySetConfig} into fast-matchable rules. */
export declare function compileSet(set?: CapabilitySetConfig): CompiledCapabilityRules;
/** Candidate fields a rule is matched against. */
export interface MatchTarget {
    /** Full capability id: `mcp__<server>__<raw>` or `skill:<name>`. */
    readonly id: string;
    /** Bare model-facing name (tool name or skill name without `skill:` prefix). */
    readonly name: string;
    /** Server name for tools; undefined for skills. */
    readonly server?: string;
    /** Capability kind. */
    readonly kind: CapabilityKind;
    /** Rule kind the candidates belong to (mirrors `kind` for tool/skill rule sets). */
    readonly ruleKind: CapabilityKind;
}
/**
 * Classify a capability against compiled rules. Priority (hit stops the walk):
 * blocked-exact > blocked-wildcard > exposed-exact > progressive-exact >
 * exposed-wildcard > progressive-wildcard > default (exposed). `blocked` is a
 * control decision, so it beats an explicit `exposed` rule. Within
 * exposed/progressive an exact name beats a wildcard, so the management UI can
 * pin a single capability to a class even when a broader wildcard rule says
 * otherwise (e.g. `tools.exposed: ['mcp__gongfeng__*']` must not silently win
 * over an explicit per-tool `progressive` rule).
 */
export declare function classify(compiled: CompiledCapabilityRules, target: MatchTarget, metaTools?: ReadonlySet<string> | readonly string[]): CapabilityClass;
/**
 * One capability's classification, as surfaced to a management UI.
 * `class` is the machine-facing value; `classLabel` is a human-friendly
 * display that ties the residency strategy to the model-facing relationship.
 */
export interface CapabilityClassification {
    readonly id: string;
    readonly kind: CapabilityKind;
    /** Model-facing name (tool name or skill bare name). */
    readonly name: string;
    /** MCP server for tools; undefined for skills. */
    readonly server?: string;
    readonly class: CapabilityClass;
    /** Human-friendly display label for the classification. */
    readonly classLabel: string;
    /** True when this capability is a mandatory meta tool (always Exposed). */
    readonly mandatory: boolean;
}
/**
 * The `ctx.capabilityPolicy` service surface.
 */
export interface CapabilityPolicyService {
    /** Classify a tool by its public name (`mcp__<server>__<raw>` or meta tool). */
    classifyTool(name: string): CapabilityClass;
    /** Classify a skill by its bare name. */
    classifySkill(name: string): CapabilityClass;
    /** True when a tool is Exposed (or a mandatory meta tool). */
    isExposedTool(name: string): boolean;
    /** True when a skill is Exposed. */
    isExposedSkill(name: string): boolean;
    /** True when a tool is Blocked. */
    isBlockedTool(name: string): boolean;
    /** True when a skill is Blocked. */
    isBlockedSkill(name: string): boolean;
    /** True when a capability id (`mcp__...` / `skill:...`) is Blocked. */
    isBlockedCapability(id: string): boolean;
    /** Tool names that are always kept Exposed. */
    metaTools(): readonly string[];
    /** Resolve a capability's id (e.g. `skill:<name>`) to a class. */
    classifyCapability(id: string): CapabilityClass;
    /** Rules exposed for the registry/other consumers. */
    toolRules(): CompiledCapabilityRules;
    skillRules(): CompiledCapabilityRules;
    /** Current (resolved) policy config. */
    getConfig(): Config;
    /** Replace a subset of the policy config and recompile rules immediately. */
    updateConfig(partial: Partial<Config>): Promise<void>;
    /**
     * Classify every capability currently indexed by `ctx.capability` (the
     * registry sibling). Returns an empty array when the registry is not mounted.
     */
    classifyAll(): readonly CapabilityClassification[];
    /**
     * List registered locations: MCP servers and skill directories known by
     * position, each with its enable state and (for MCP) the last mount error.
     */
    listLocations(): Promise<CapabilityLocation[]>;
    /**
     * Register a new location and mount it when it starts enabled. MCP configs
     * are validated through the `dsh-mcp-client` schema; skill dirs must be
     * absolute and contain `SKILL.md`. Definitions are never copied — only the
     * location reference and enable flag persist.
     */
    addLocation(payload: AddLocationPayload): Promise<CapabilityLocation>;
    /** Unmount (when live) and forget one registered location. */
    removeLocation(id: string): Promise<void>;
    /** Enable mounts, disable unmounts; persisted either way. */
    setLocationEnabled(id: string, enabled: boolean): Promise<void>;
}
/** MCP server definition for a registered location (mcp-client config shape). */
export interface McpLocationConfig {
    readonly serverName: string;
    readonly transport: 'stdio' | 'streamable-http';
    readonly command?: string;
    readonly args?: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
    readonly cwd?: string;
    readonly url?: string;
    readonly headers?: Readonly<Record<string, string>>;
}
/** Skill directory definition for a registered location. */
export interface SkillLocationConfig {
    /** Absolute path of a directory containing `SKILL.md`. */
    readonly dir: string;
}
/** One registered location as surfaced to the management UI. */
export interface CapabilityLocation {
    readonly id: string;
    readonly type: 'mcp' | 'skill';
    /** serverName for MCP, directory basename for skills. */
    readonly name: string;
    readonly enabled: boolean;
    /** Last mount failure message; present only after a failed MCP mount. */
    readonly error?: string;
    readonly mcp?: McpLocationConfig;
    readonly skill?: SkillLocationConfig;
}
/** Payload accepted by {@link CapabilityPolicyService.addLocation}. */
export interface AddLocationPayload {
    readonly type: 'mcp' | 'skill';
    readonly mcp?: McpLocationConfig;
    readonly skill?: SkillLocationConfig;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        capabilityPolicy: CapabilityPolicyService;
    }
}
/**
 * Build the projection listener for one assembly: keep only Exposed tools plus
 * the mandatory meta tools.
 */
export declare function projectAssemblyTools(assembly: PromptAssembly, service: CapabilityPolicyService): PromptAssembly;
/** Build the policy plugin. */
export declare const name = "capability-menu-policy";
export declare const inject: string[];
export declare function apply(ctx: Context, config?: Config): Promise<void>;
//# sourceMappingURL=policy.d.ts.map