/**
 * Unified capability catalog for the DeepSeek Harness.
 *
 * @module @daweifu/capability-menu (registry plugin)
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { ScopeKey } from '@deepseek-ai/dsh-scope';
import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools';
/**
 * Kinds of capability the catalog can hold.
 * - `tool`:   action capability — executes a concrete action (an MCP tool or a
 *   harness-native tool cataloged under the reserved `built-in` server).
 * - `skill`:  action capability — loads the method/instructions for a task.
 */
export type CapabilityKind = 'tool' | 'skill';
/**
 * Stable invocation actions a capability can declare. Each kind maps to one
 * canonical action; a new kind only deserves a new value here when it
 * introduces a new action (not a new flavor of an existing one).
 * `execute` = run the concrete action (a tool — MCP or native — via `ctx.tools.execute`);
 * `load`    = load the method/instructions (a skill).
 */
export type CapabilityAction = 'execute' | 'load';
/**
 * Tool id prefixes are part of the REAL registered tool name: MCP tools are
 * registered as `mcp__<server>__<raw>` by the harness MCP client and natives
 * keep their bare name (`bash`/`read`/…), so tool records are keyed by that
 * name. Skills have no name-level namespace: a skill's id IS its bare name and
 * `kind` disambiguates it from a same-named tool.
 */
export declare const MCP_ID_PREFIX = "mcp__";
/**
 * Reserved pseudo-server that groups harness-native (non-MCP) tools in the
 * management surface. Native tools (bash/read/write/…) are cataloged like MCP
 * tools — same `server` dimension — so the 能力管理 can group them, classify
 * them Resident/On-demand/Disabled, and `meta_invoke` can dispatch them.
 */
export declare const BUILT_IN_SERVER = "built-in";
/**
 * Tool names that never enter the capability catalog: this plugin's own
 * control plane (`meta_search`/`meta_invoke`, always Resident) and the
 * reserved Code Mode presentation transport (`run_code`).
 */
export declare const CATALOG_EXCLUDED_TOOLS: ReadonlySet<string>;
/** Capability-stable origin metadata used by search filters and detail views. */
export interface CapabilityOrigin {
    /** Human/namespace label: an MCP server name, the reserved `built-in` for native tools, or a skill provider. */
    readonly provider: string;
    /** Server namespace, present only for `kind: 'tool'` (`built-in` for native tools). */
    readonly serverName?: string;
    /** Local skill path, present only for `kind: 'skill'`. */
    readonly path?: string;
    /** Skill source root label (`project-dsh`/`user-agents`/…), present only for skills. */
    readonly source?: string;
}
/** Objective and subjective usage statistics, written back from `tools/result`. */
export interface CapabilityStats {
    readonly uses: number;
    readonly successes: number;
    readonly failures: number;
    readonly totalMs: number;
    readonly lastUsedAt?: number;
}
/** One indexed capability. */
export interface CapabilityRecord {
    /** Stable identifier: `mcp__<server>__<raw>`, a native tool name, or a bare skill name. */
    readonly id: string;
    readonly kind: CapabilityKind;
    /** The canonical invocation action(s) this capability exposes. */
    readonly actions: readonly CapabilityAction[];
    /** Model-facing name (the tool name or skill name without prefix). */
    readonly name: string;
    readonly description: string;
    /** Skill-only extra routing guidance. */
    readonly whenToUse?: string;
    readonly origin: CapabilityOrigin;
    /** Full parameter schema (MCP inputSchema / empty object for skills). */
    readonly parameters: JsonSchemaNode;
    readonly invocation: {
        modelInvocable: boolean;
        userInvocable: boolean;
    };
    readonly tags: readonly string[];
    readonly stats: CapabilityStats;
    /** Token-trimmed short description used by `meta_search` list mode. */
    readonly summary: string;
}
/** Lightweight list-mode projection of one capability (no full schema). */
export interface CapabilitySummary {
    readonly id: string;
    readonly kind: CapabilityKind;
    readonly name: string;
    readonly summary: string;
    readonly server?: string;
    /** Skill source root label, present only for `kind: 'skill'`. */
    readonly source?: string;
    readonly tags: readonly string[];
    readonly success_rate?: number;
    readonly uses: number;
}
/** Full detail projection, including the parameter schema. */
export interface CapabilityDetail {
    readonly id: string;
    readonly kind: CapabilityKind;
    readonly actions: readonly CapabilityAction[];
    readonly name: string;
    readonly description: string;
    readonly whenToUse?: string;
    readonly parameters: JsonSchemaNode;
    readonly output?: JsonSchemaNode;
    readonly origin: CapabilityOrigin;
    readonly tags: readonly string[];
    readonly stats: CapabilityStats;
}
/** Search filter options. */
export interface MetaSearchOptions {
    readonly kind?: CapabilityKind | 'all';
    readonly server?: string | undefined;
    readonly tag?: string | undefined;
    /** Maximum number of results to return. */
    readonly maxResults?: number;
    /**
     * Viewing scope. Retained for caller ergonomics and optional authorization
     * checks, but the policy does NOT use it to filter visibility — On-demand
     * capabilities must remain searchable regardless of the caller's projection.
     */
    readonly scope?: ScopeKey | undefined;
    /** Query string for keyword matching; exact id/name match wins. */
    readonly query?: string;
    /** Exact capability id. */
    readonly id?: string;
    /** Whether to include the full body for skills in `getDetail` (default false). */
    readonly detailIncludesBody?: boolean;
}
/** Runtime detail resolution context. */
export interface MetaLookupContext {
    readonly cwd?: string | undefined;
    readonly signal?: AbortSignal | undefined;
    readonly scope?: ScopeKey | undefined;
}
/** One direct child in a skill directory listing. */
export interface SkillDirEntry {
    readonly name: string;
    readonly type: 'file' | 'directory';
}
/** The `ctx.capability` service surface. */
export interface CapabilityService {
    /** Enumerate the current catalog (optionally filtered). */
    search(options?: MetaSearchOptions): CapabilitySummary[];
    /**
     * Resolve one record by id, or undefined. Pass `kind` when the caller knows
     * it (tools and skills may share a bare name, e.g. a skill named `bash`);
     * without `kind` a same-name tool/skill pair resolves to undefined.
     */
    get(id: string, kind?: CapabilityKind): CapabilityRecord | undefined;
    /**
     * Resolve one record's full detail (schema, output; skill body optional).
     * `kind` has the same disambiguation semantics as {@link get}.
     */
    getDetail(id: string, kind?: CapabilityKind, context?: MetaLookupContext): Promise<CapabilityDetail | undefined>;
    /**
     * List a skill's directory children (one level deep). The directory is
     * resolved from the skill's own provider path, never from caller input;
     * `relPath` (optional, relative to the skill root) descends into a child
     * directory.
     */
    listSkillDir(id: string, relPath?: string): Promise<SkillDirEntry[] | undefined>;
    /**
     * Read a text file inside a skill's directory, addressed by a relative path
     * that is resolved against and confined to the skill root. Binary files
     * (content containing NUL) return undefined.
     */
    readSkillFile(id: string, relPath: string): Promise<string | undefined>;
    /** Return the current number of indexed capabilities. */
    size(): number;
    /**
     * Absolute path of the on-demand capability catalog YAML, when emission is
     * enabled. The model can browse this file with grep/read instead of only
     * reaching the catalog through `meta_search`.
     */
    catalogPath(): string | undefined;
    /**
     * Number of On-demand capabilities in the latest catalog emission. Used by
     * the policy's assemble hook to skip the catalog pointer when there is
     * nothing On-demand to browse.
     */
    onDemandCount(): number;
    /**
     * Rebuild the catalog from the current tool/skill registries; resolves when
     * done. In production the registry rebuilds automatically on `tools/change`
     * / `skills/change`; this public handle is for tests and external orchestrators
     * that want to force a rebuild.
     */
    refresh(): Promise<void>;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        capability: CapabilityService;
    }
}
/** Registry configuration. */
export interface Config {
    /** Maximum summary length in characters (min 20). */
    summaryMaxChars?: number;
    /** Whether to include the skill body in `getDetail` results (default false). */
    detailIncludesBody?: boolean;
    /** Maximum search results returned (default 20, max 100). */
    maxResults?: number;
    /** Experience-weighting intensity for ranking (0 disables, default 0.1). */
    weighting?: number;
    /**
     * Optional path for the on-demand capability catalog emitted as a YAML file
     * for model-side grep/read browsing. Defaults to
     * `~/.dsh/capability-catalog.yaml`; set to an empty string to disable
     * emission. Disabled capabilities are never written.
     */
    catalogFile?: string;
}
/** Validate and default the registry configuration. */
export declare const Config: z<Config>;
/** Build the registry plugin. */
export declare const name = "capability-menu-registry";
export declare const inject: string[];
export declare function apply(ctx: Context, config?: Config): void;
/** Derive the server namespace from an `mcp__<server>__<raw>` name. */
export declare function serverNameOf(publicName: string): string;
//# sourceMappingURL=registry.d.ts.map