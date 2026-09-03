/**
 * Resident / On-demand / Disabled capability projection policy for the DeepSeek
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
 * - `resident`: the capability is on the dsh-native exposure surface — tools in
 *   `assembly.tools` (the request `tools` payload), skills in the
 *   `<available_skills>` catalog — so the model can call/load it single-hop.
 * - `on-demand`: absent from the native surface but discoverable in the
 *   persistent meta registry; the model reaches it via `meta_search` then
 *   `meta_invoke` (catalog-resident, load/execute on demand).
 * - `disabled`: neither resident nor discoverable nor executable.
 */
export type CapabilityClass = 'resident' | 'on-demand' | 'disabled';
/**
 * A single classify rule: an exact name or a `*`-glob pattern.
 * A pattern matches a capability id (`mcp__<server>__<raw>`, a native tool
 * name, or a bare skill name) or a server name (`server:<name>`).
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
 * Per-kind explicit configuration. `resident`/`on-demand`/`disabled` are
 * ordered lists of exact-name / glob rules. Empty lists mean "nothing
 * explicitly classified", so the default (`resident`) applies.
 */
export interface CapabilitySetConfig {
    /** Explicitly-Resident rule list (exact name or glob). */
    resident?: string[];
    /** Explicitly-On-demand rule list (exact name or glob). */
    'on-demand'?: string[];
    /** Explicitly-Disabled rule list (exact name or glob); wins over everything. */
    disabled?: string[];
    /**
     * @deprecated pre-rename alias of `disabled`; accepted and mapped so legacy
     * profiles written with the `blocked` key keep working without an on-disk
     * rewrite.
     */
    blocked?: string[];
    /**
     * @deprecated pre-rename alias of `resident`; accepted and mapped so legacy
     * profiles keep working without an on-disk rewrite.
     */
    exposed?: string[];
    /**
     * @deprecated pre-rename alias of `on-demand`; accepted and mapped so legacy
     * profiles keep working without an on-disk rewrite.
     */
    progressive?: string[];
}
/** Resident / On-demand / Disabled projection policy configuration. */
export interface Config {
    /** Tool classification: `tools.resident` / `tools.on-demand` / `tools.disabled`. */
    tools?: CapabilitySetConfig;
    /** Skill classification: `skills.resident` / `skills.on-demand` / `skills.disabled`. */
    skills?: CapabilitySetConfig;
    /**
     * Tool names that are ALWAYS kept resident and can never be classified
     * On-demand or Disabled. Default `[meta_search, meta_invoke]`.
     */
    metaTools?: string[];
}
/** Validate and default the policy configuration. */
export declare const Config: z<Config>;
export declare const DEFAULT_META_TOOLS: readonly ["meta_search", "meta_invoke"];
/**
 * Map a legacy rule set (old keys `exposed`/`progressive`/`blocked`) onto the
 * current key names (`resident`/`on-demand`/`disabled`), so already-deployed
 * `cordis.patch.yml` profiles keep working without an on-disk rewrite. New
 * keys win when they carry rules; a legacy key fills in when the matching new
 * list is empty.
 */
export declare function normalizeSetConfig(set: CapabilitySetConfig | undefined): CapabilitySetConfig | undefined;
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
    readonly resident: readonly PolicyRule[];
    readonly onDemand: readonly PolicyRule[];
    readonly disabled: readonly PolicyRule[];
}
/** Compile a {@link CapabilitySetConfig} into fast-matchable rules. */
export declare function compileSet(set?: CapabilitySetConfig): CompiledCapabilityRules;
/** Candidate fields a rule is matched against. */
export interface MatchTarget {
    /** Capability id: `mcp__<server>__<raw>`, a native tool name, or a bare skill name. */
    readonly id: string;
    /** Model-facing name (for skills it equals the id; for MCP tools the public `mcp__...` name). */
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
 * disabled-exact > disabled-wildcard > resident-exact > on-demand-exact >
 * resident-wildcard > on-demand-wildcard > default (resident). `disabled` is a
 * control decision, so it beats an explicit `resident` rule. Within
 * resident/on-demand an exact name beats a wildcard, so the management UI can
 * pin a single capability to a class even when a broader wildcard rule says
 * otherwise (e.g. `tools.resident: ['mcp__gongfeng__*']` must not silently win
 * over an explicit per-tool `on-demand` rule).
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
    /** Server namespace for tools (`built-in` for harness-native tools); undefined for skills. */
    readonly server?: string;
    /** Skill source root label, present only for skills. */
    readonly source?: string;
    readonly class: CapabilityClass;
    /** Human-friendly display label for the classification. */
    readonly classLabel: string;
    /** True when this capability is a mandatory meta tool (always Resident). */
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
    /** True when a tool is Resident (or a mandatory meta tool). */
    isResidentTool(name: string): boolean;
    /** True when a skill is Resident. */
    isResidentSkill(name: string): boolean;
    /** True when a tool is Disabled. */
    isDisabledTool(name: string): boolean;
    /** True when a skill is Disabled. */
    isDisabledSkill(name: string): boolean;
    /**
     * True when a capability (by id, with optional `kind` disambiguation) is
     * Disabled. Without `kind`, a legacy `skill:`-prefixed id is treated as a
     * skill.
     */
    isDisabledCapability(id: string, kind?: CapabilityKind): boolean;
    /** Tool names that are always kept Resident. */
    metaTools(): readonly string[];
    /**
     * Resolve a capability's id to a class. Pass `kind` when the caller knows it
     * (ids are bare names now); a legacy `skill:`-prefixed id is treated as a
     * skill when `kind` is omitted.
     */
    classifyCapability(id: string, kind?: CapabilityKind): CapabilityClass;
    /** Rules resident for the registry/other consumers. */
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
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        capabilityPolicy: CapabilityPolicyService;
    }
}
/**
 * Build the projection listener for one assembly: keep only Resident tools plus
 * the mandatory meta tools.
 */
export declare function projectAssemblyTools(assembly: PromptAssembly, service: CapabilityPolicyService): PromptAssembly;
/** Build the policy plugin. */
export declare const name = "capability-menu-policy";
export declare const inject: string[];
export declare function apply(ctx: Context, config?: Config): Promise<void>;
//# sourceMappingURL=policy.d.ts.map