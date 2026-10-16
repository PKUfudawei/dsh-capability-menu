window.__ModuleLoader__.load({ id: "@daweifu/capability-menu", factory: (require) => {
var module = { exports: {} };
var exports = module.exports;

import { Context } from "@deepseek-ai/cordis";
import { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import "@deepseek-ai/schemastery";
import { ScopeKey } from "@deepseek-ai/dsh-scope";
import { JsonSchemaNode } from "@deepseek-ai/dsh-tools";
//#region src/registry.d.ts
/**
 * Kinds of capability the catalog can hold.
 * - `tool`:   action capability — executes a concrete action (an MCP tool or a
 *   harness-native tool cataloged under the reserved `built-in` server).
 * - `skill`:  action capability — loads the method/instructions for a task.
 */
type CapabilityKind = 'tool' | 'skill';
/**
 * Stable invocation actions a capability can declare. Each kind maps to one
 * canonical action; a new kind only deserves a new value here when it
 * introduces a new action (not a new flavor of an existing one).
 * `execute` = run the concrete action (a tool — MCP or native — via `ctx.tools.execute`);
 * `load`    = load the method/instructions (a skill).
 */
type CapabilityAction = 'execute' | 'load';
/** Capability-stable origin metadata used by search filters and detail views. */
interface CapabilityOrigin {
  /** Human/namespace label: an MCP server name, the reserved `built-in` for native tools, or a skill provider. */
  readonly provider: string;
  /** Server namespace, present only for `kind: 'tool'` (`built-in` for native tools). */
  readonly serverName?: string;
  /** Local skill path, present only for `kind: 'skill'`. */
  readonly path?: string;
  /** Skill source root label (`project-dsh`/`user-agents`/…), present only for skills. */
  readonly source?: string;
  /**
   * Agent preset whose standing scope this skill was collected from, present
   * only for skills that live in a preset layer.
   *
   * A preset's own `skill-filesystem` mounts its `skills/` directory through
   * `customSkillDirs`, so such a skill is labelled `source: 'custom'` — the
   * same label a user-configured `customSkillDirs` entry gets. The source
   * label therefore cannot tell the two apart; this field is what the
   * management surface groups on ("预设技能" vs. a user's custom root).
   */
  readonly preset?: string;
}
/** Objective and subjective usage statistics, written back from `tools/result`. */
interface CapabilityStats {
  readonly uses: number;
  readonly successes: number;
  readonly failures: number;
  readonly totalMs: number;
  readonly lastUsedAt?: number;
}
/** One indexed capability. */
interface CapabilityRecord {
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
interface CapabilitySummary {
  readonly id: string;
  readonly kind: CapabilityKind;
  readonly name: string;
  readonly summary: string;
  readonly server?: string;
  /** Skill source root label, present only for `kind: 'skill'`. */
  readonly source?: string;
  /** Agent preset id, present only for skills collected from a preset scope. */
  readonly preset?: string;
  readonly path?: string;
  readonly tags: readonly string[];
  readonly success_rate?: number;
  readonly uses: number;
}
/** Full detail projection, including the parameter schema. */
interface CapabilityDetail {
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
interface MetaSearchOptions {
  readonly kind?: CapabilityKind | 'all';
  readonly server?: string | undefined;
  readonly tag?: string | undefined;
  /** Maximum number of results to return. */
  readonly maxResults?: number;
  /** Zero-based result offset. */
  readonly offset?: number;
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
interface MetaLookupContext {
  readonly cwd?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly scope?: ScopeKey | undefined;
}
/** One direct child in a skill directory listing. */
interface SkillDirEntry {
  readonly name: string;
  readonly type: 'file' | 'directory';
}
interface CapabilityDiagnostics {
  readonly unavailableSkills: readonly {
    readonly name: string;
    readonly source: string;
    readonly preset?: string;
  }[];
  readonly shadowedSkills: readonly {
    readonly name: string;
    readonly selectedFrom: string;
    readonly shadowedFrom: string;
  }[];
  readonly brokenPresets: readonly {
    readonly id: string;
    readonly reason: string;
  }[];
  readonly unbrowseableSkills: readonly {
    readonly name: string;
    readonly reason: string;
  }[];
  readonly undocumentedSkills: readonly {
    readonly name: string;
    readonly summary: string;
  }[];
  readonly catalog: {
    readonly state: 'disabled' | 'policy-unmounted' | 'empty' | 'ready' | 'write-failed';
    readonly path?: string;
    readonly error?: string;
    readonly count: number;
  };
}
/** User-owned text used only for discovery; the provider's definition stays intact. */
interface SearchMetadata {
  readonly id: string;
  readonly kind: CapabilityKind;
  readonly defaultDescription: string;
  readonly description?: string;
  readonly maxChars: number;
}
interface SearchMetadataUpdate {
  readonly id: string;
  readonly kind: CapabilityKind;
  /** Empty or provider-identical text restores the provider-derived description. */
  readonly description: string;
}
/** The `ctx.capability` service surface. */
interface CapabilityService {
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
  /**
   * Indexed skills whose provider exposes a filesystem directory, as
   * `{ name, skillDir }` where `skillDir` is `<entryDir>/<name>`.
   */
  skillDirs(): ReadonlyArray<{
    readonly name: string;
    readonly skillDir: string;
    readonly source?: string;
  }>;
  diagnostics(): CapabilityDiagnostics;
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
   * Monotonic catalog version. It advances only when a rebuild finishes
   * applying, so a caller that compares two samples learns "the catalog really
   * moved" without re-reading the rows — which is what lets the management UI
   * poll a single number instead of `classifyAll` on every tick.
   *
   * Not guaranteed to increase across a plugin restart (the counter is
   * in-process), so compare with `!==`, never with `>`.
   */
  version(): number;
  /**
   * Rebuild the catalog from the current tool/skill registries; resolves when
   * done. In production the registry rebuilds automatically on `tools/change`
   * / `skills/change`; this public handle is for tests and external orchestrators
   * that want to force a rebuild.
   */
  refresh(): Promise<void>;
  /**
   * Ask for a rebuild without waiting for it. The scheduler coalesces bursts,
   * so a caller that changes something repeatedly (the management UI cycling
   * a classification) triggers one rebuild, not one per call.
   */
  requestRefresh(): void;
  /**
   * Re-emit the materialized on-demand catalog from the index already in hand,
   * without re-enumerating tools or skills. Moving a capability between tiers
   * changes no inventory, so the only thing stale on disk is that file — and a
   * full rebuild would re-scan the global skill layer plus every agent preset
   * for no new information, which is what made a tier click stall.
   */
  rewriteCatalog(): Promise<void>;
  getSearchMetadata(id: string, kind: CapabilityKind): SearchMetadata | undefined;
  updateSearchMetadata(input: SearchMetadataUpdate): Promise<void>;
  summaryMaxChars(): number;
  searchSettingsEnabled(): boolean;
  updateSummaryMaxChars(value: number): Promise<void>;
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    capability: CapabilityService;
  }
}
//#endregion
//#region src/client/remote.d.ts
/** Read-only row: one capability's Resident/On-demand/Disabled classification. */
interface CapabilityRow {
  readonly id: string;
  readonly kind: 'tool' | 'skill';
  readonly name: string;
  readonly server?: string;
  /** Skill source root label (`project-dsh`/`user-agents`/…), present only for skills. */
  readonly source?: string;
  /**
   * Agent preset id, present only for skills that live in a preset's own layer.
   * The source label is `custom` for these as well, so this is what tells a
   * preset skill apart from one in a user-configured `customSkillDirs` root.
   */
  readonly preset?: string;
  /** The skill's own directory on disk, present only for skills whose provider has one. */
  readonly path?: string;
  readonly class: 'resident' | 'on-demand' | 'disabled';
  readonly classLabel?: string;
  readonly mandatory: boolean;
}
/** Current exposure rules and the generated on-demand search catalog. */
interface CatalogDocs {
  /** Effective rule configuration in YAML. */
  readonly policyYaml: string;
  readonly summaryMaxChars: number;
  readonly searchSettingsEnabled: boolean;
  /** 按需能力目录物化文件（path + content）。 */
  readonly catalog?: {
    readonly path: string;
    readonly content: string;
  };
  /** catalog 不可用原因：'disabled' = 物化未启用；'read-failed' = 读盘失败。 */
  readonly catalogMissing?: 'disabled' | 'read-failed' | 'policy-unmounted' | 'empty' | 'write-failed';
  readonly catalogState?: 'disabled' | 'policy-unmounted' | 'empty' | 'ready' | 'write-failed';
}
/** One direct child in a skill directory listing. */
interface SkillFileEntry {
  readonly name: string;
  readonly type: 'file' | 'directory';
}
/** Full detail projection of one capability (schema, description, stats). */
interface ToolDetail {
  readonly id: string;
  readonly kind: 'tool' | 'skill';
  readonly actions: readonly string[];
  readonly name: string;
  readonly description: string;
  readonly whenToUse?: string;
  readonly skillContent?: string;
  readonly parameters: Record<string, unknown>;
  readonly output?: Record<string, unknown>;
  readonly origin: {
    readonly provider: string;
    readonly serverName?: string;
    readonly path?: string;
    readonly source?: string;
    readonly preset?: string;
  };
  readonly tags: readonly string[];
  readonly stats: {
    readonly uses: number;
    readonly successes: number;
    readonly failures: number;
    readonly totalMs: number;
    readonly lastUsedAt?: number;
  };
}
/** One MCP server declared in the patch file. */
interface McpLocation {
  readonly id: string;
  readonly serverName: string;
  readonly transport: 'stdio' | 'streamable-http';
  readonly disabled: boolean;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly toolCallTimeoutMs?: number;
}
/** One skill entry under a managed skill root (the user root or a project's). */
interface SkillLocation {
  /** The entry's own name under `entryDir`; what update and remove address. */
  readonly name: string;
  /** The name the skill declares in its `SKILL.md` — dsh's identity for it, and what a capability row is named. */
  readonly skillName?: string;
  readonly path: string;
  readonly linked: boolean;
  readonly valid: boolean;
  /** `user` for the default root, `project` for a project's own skill root. */
  readonly root: 'user' | 'project';
  /** The skills directory holding the entry; pass it back to update or remove. */
  readonly entryDir: string;
  /** The directory the entry points at, with symlinks resolved. */
  readonly target?: string;
}
/** Input for registering a new MCP server. */
interface McpInput {
  readonly serverName: string;
  readonly transport: 'stdio' | 'streamable-http';
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly toolCallTimeoutMs?: number;
}
/** Input for editing a declared server (`serverName` is immutable). */
type McpUpdateInput = Omit<McpInput, 'serverName'>;
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$6361706162696c697479506f6c696379 {
    getConfig: () => Promise<RemoteResult<Record<string, unknown>>>;
    updateConfig: (partial: Record<string, unknown>) => Promise<RemoteResult<void>>;
    classifyAll: () => Promise<RemoteResult<CapabilityRow[]>>;
    getDiagnostics: () => Promise<RemoteResult<CapabilityDiagnostics>>;
    refresh: () => Promise<RemoteResult<void>>;
    catalogVersion: () => Promise<RemoteResult<number>>;
    listSkillDir: (id: string, relPath?: string) => Promise<RemoteResult<SkillFileEntry[] | undefined>>;
    readSkillFile: (id: string, relPath: string) => Promise<RemoteResult<string | undefined>>;
    getDetail: (id: string) => Promise<RemoteResult<ToolDetail | undefined>>;
    getSearchMetadata: (id: string, kind: 'tool' | 'skill') => Promise<RemoteResult<SearchMetadata | undefined>>;
    updateSearchMetadata: (input: SearchMetadataUpdate) => Promise<RemoteResult<void>>;
    updateSummaryMaxChars: (value: number) => Promise<RemoteResult<void>>;
    getCatalogDocs: () => Promise<RemoteResult<CatalogDocs>>;
    listLocations: () => Promise<RemoteResult<McpLocation[]>>;
    addLocation: (input: McpInput) => Promise<RemoteResult<string>>;
    removeLocation: (id: string) => Promise<RemoteResult<boolean>>;
    updateLocation: (id: string, input: McpUpdateInput) => Promise<RemoteResult<boolean>>;
    listSkillLocations: () => Promise<RemoteResult<SkillLocation[]>>;
    addSkillLocation: (dir: string, projectPath?: string) => Promise<RemoteResult<string>>;
    importSkillFromGitHub: (url: string, projectPath?: string) => Promise<RemoteResult<string>>;
    removeSkillLocation: (name: string, entryDir?: string) => Promise<RemoteResult<boolean>>;
    adoptSkillLocation: (name: string) => Promise<RemoteResult<string>>;
    updateSkillLocation: (name: string, dir: string, entryDir?: string) => Promise<RemoteResult<boolean>>;
  }
  interface TypertRemoteMap {
    'capabilityPolicy/getConfig': () => Promise<RemoteResult<Record<string, unknown>>>;
    'capabilityPolicy/updateConfig': (partial: Record<string, unknown>) => Promise<RemoteResult<void>>;
    'capabilityPolicy/classifyAll': () => Promise<RemoteResult<CapabilityRow[]>>;
    'capabilityPolicy/getDiagnostics': () => Promise<RemoteResult<CapabilityDiagnostics>>;
    'capabilityPolicy/refresh': () => Promise<RemoteResult<void>>;
    'capabilityPolicy/catalogVersion': () => Promise<RemoteResult<number>>;
    'capabilityPolicy/listSkillDir': (id: string, relPath?: string) => Promise<RemoteResult<SkillFileEntry[] | undefined>>;
    'capabilityPolicy/readSkillFile': (id: string, relPath: string) => Promise<RemoteResult<string | undefined>>;
    'capabilityPolicy/getDetail': (id: string) => Promise<RemoteResult<ToolDetail | undefined>>;
    'capabilityPolicy/getSearchMetadata': (id: string, kind: 'tool' | 'skill') => Promise<RemoteResult<SearchMetadata | undefined>>;
    'capabilityPolicy/updateSearchMetadata': (input: SearchMetadataUpdate) => Promise<RemoteResult<void>>;
    'capabilityPolicy/updateSummaryMaxChars': (value: number) => Promise<RemoteResult<void>>;
    'capabilityPolicy/getCatalogDocs': () => Promise<RemoteResult<CatalogDocs>>;
    'capabilityPolicy/listLocations': () => Promise<RemoteResult<McpLocation[]>>;
    'capabilityPolicy/addLocation': (input: McpInput) => Promise<RemoteResult<string>>;
    'capabilityPolicy/removeLocation': (id: string) => Promise<RemoteResult<boolean>>;
    'capabilityPolicy/updateLocation': (id: string, input: McpUpdateInput) => Promise<RemoteResult<boolean>>;
    'capabilityPolicy/listSkillLocations': () => Promise<RemoteResult<SkillLocation[]>>;
    'capabilityPolicy/addSkillLocation': (dir: string, projectPath?: string) => Promise<RemoteResult<string>>;
    'capabilityPolicy/importSkillFromGitHub': (url: string, projectPath?: string) => Promise<RemoteResult<string>>;
    'capabilityPolicy/removeSkillLocation': (name: string, entryDir?: string) => Promise<RemoteResult<boolean>>;
    'capabilityPolicy/adoptSkillLocation': (name: string) => Promise<RemoteResult<string>>;
    'capabilityPolicy/updateSkillLocation': (name: string, dir: string, entryDir?: string) => Promise<RemoteResult<boolean>>;
  }
  interface TypertRemoteNamespaceMap {
    'capabilityPolicy': TypertRemoteNamespace$6361706162696c697479506f6c696379;
  }
}
//#endregion
//#region src/client/store.d.ts
/** Snapshot of the management surface. */
interface CapabilitySnapshot {
  readonly rows: readonly CapabilityRow[];
  readonly diagnostics?: CapabilityDiagnostics;
}
/** The Host `capabilityPolicy` remote face (generated contribution). */
interface CapabilityPolicyRemote {
  getConfig(): Promise<{
    ok: true;
    value: Record<string, unknown>;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  updateConfig(partial: Record<string, unknown>): Promise<{
    ok: true;
    value: void;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  classifyAll(): Promise<{
    ok: true;
    value: CapabilityRow[];
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  getDiagnostics?(): Promise<{
    ok: true;
    value: CapabilityDiagnostics;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  refresh(): Promise<{
    ok: true;
    value: void;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  /** One number naming the host's current catalog state; see the registry's `version()`. */
  catalogVersion(): Promise<{
    ok: true;
    value: number;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  listSkillDir(id: string, relPath?: string): Promise<{
    ok: true;
    value: SkillFileEntry[] | undefined;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  readSkillFile(id: string, relPath: string): Promise<{
    ok: true;
    value: string | undefined;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  getDetail(id: string): Promise<{
    ok: true;
    value: ToolDetail | undefined;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  getSearchMetadata(id: string, kind: 'tool' | 'skill'): Promise<{
    ok: true;
    value: SearchMetadata | undefined;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  updateSearchMetadata(input: SearchMetadataUpdate): Promise<{
    ok: true;
    value: void;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  updateSummaryMaxChars(value: number): Promise<{
    ok: true;
    value: void;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  getCatalogDocs(): Promise<{
    ok: true;
    value: CatalogDocs;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  listLocations(): Promise<{
    ok: true;
    value: McpLocation[];
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  addLocation(input: McpInput): Promise<{
    ok: true;
    value: string;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  removeLocation(id: string): Promise<{
    ok: true;
    value: boolean;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  updateLocation(id: string, input: McpUpdateInput): Promise<{
    ok: true;
    value: boolean;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  listSkillLocations(): Promise<{
    ok: true;
    value: SkillLocation[];
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  addSkillLocation(dir: string, projectPath?: string): Promise<{
    ok: true;
    value: string;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  importSkillFromGitHub(url: string, projectPath?: string): Promise<{
    ok: true;
    value: string;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  removeSkillLocation(name: string, entryDir?: string): Promise<{
    ok: true;
    value: boolean;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  adoptSkillLocation(name: string): Promise<{
    ok: true;
    value: string;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  updateSkillLocation(name: string, dir: string, entryDir?: string): Promise<{
    ok: true;
    value: boolean;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
}
//#endregion
//#region src/client/CapabilitySection.d.ts
/** Props injected by the settings.section registration (see index.ts). */
interface CapabilitySectionInjected {
  remote: CapabilityPolicyRemote;
  t(key: CapabilityKey, params?: Record<string, unknown>): string;
  /** Diagnostic: `$mount` failure surfaced instead of crashing the section. */
  mountError?: string;
  /**
   * Subscribe to signals that the host catalog may have moved without this page
   * asking: a settings document edit (registering a source, editing a
   * composition file outside the browser) or a carrier reconnect. Returns a
   * disposer. Optional so the section still mounts on a runtime that predates
   * the forwarded-event API — it then falls back to the version poll alone.
   */
  subscribeSignals?: (listener: () => void) => () => void;
}
type CapabilitySectionProps = CapabilitySectionInjected;
type CapabilityKey = 'nav' | 'title' | 'packageName' | 'desc' | 'resident' | 'on-demand' | 'disabled' | 'tool' | 'skill' | 'mandatory' | 'toolsGroup' | 'skillsGroup' | 'builtInGroup' | 'globalSkills' | 'projectSkills' | 'presetSkills' | 'emptyTools' | 'emptySkills' | 'emptyGlobalSkills' | 'emptyProjectSkills' | 'emptyPresetSkills' | 'filterByName' | 'filterHint' | 'filterNoMatch' | 'toolCount' | 'residentShort' | 'onDemandShort' | 'disabledShort' | 'cycleHint' | 'notPreviewable' | 'previewClose' | 'markdownCode' | 'markdownWrap' | 'markdownUnwrap' | 'markdownCopy' | 'markdownCopied' | 'markdownFootnotes' | 'detailNotFound' | 'cycleOverridden' | 'refreshFailed' | 'mcpToolsPending' | 'feedback' | 'retry' | 'carrierFailureHint' | 'registerCapability' | 'editMcp' | 'editSkillNamed' | 'edit' | 'save' | 'remove' | 'cancel' | 'confirmRemove' | 'confirmRemoveMcp' | 'confirmRemoveSkillLink' | 'confirmRemoveSkillDir' | 'confirmSaveAnyway' | 'saveConfirmRealDir' | 'register' | 'notEditable' | 'entryNotFound' | 'mcpServers' | 'skillDirs' | 'skillDirPath' | 'skillDirHint' | 'skillRoot' | 'skillRootUser' | 'skillRootProject' | 'skillRootHintUser' | 'skillRootHintProject' | 'skillProjectPath' | 'skillProjectPathHint' | 'skillRegisteredAt' | 'skillRepointed' | 'skillAdopted' | 'skillSource' | 'skillSourceHint' | 'skillFromPreset' | 'skillFromPresetHint' | 'githubImporting' | 'importing' | 'skillUnmanaged' | 'adoptSkill' | 'adoptSkillHint' | 'adoptSkillTitle' | 'sourceCustom' | 'sourceBundled' | 'serverName' | 'serverNameImmutable' | 'transport' | 'transportStdio' | 'transportHttp' | 'transportHintStdio' | 'transportHintHttp' | 'command' | 'args' | 'cwd' | 'env' | 'url' | 'headers' | 'headersHint' | 'timeout' | 'timeoutInvalid' | 'viewCatalog' | 'catalogPolicy' | 'catalogOnDemand' | 'catalogPolicyNote' | 'catalogDisabled' | 'catalogUnreadable' | 'diagnosticTitle' | 'diagnosticUnavailable' | 'diagnosticShadowed' | 'diagnosticBroken' | 'diagnosticUnbrowseable' | 'diagnosticUndocumented' | 'catalogWriteFailed' | 'catalogPolicyUnavailable' | 'editSearchMetadata' | 'searchMetadataButton' | 'searchDescription' | 'searchMetadataNote' | 'searchMetadataSave' | 'searchMetadataRestore' | 'searchMetadataRestoreHint' | 'searchMetadataSaved' | 'summaryLimit' | 'summaryLimitUnit' | 'summaryLimitInvalid' | 'summaryLimitDisabled' | 'summaryLimitSaved' | 'projectRootLabel' | 'skillBrowseUnavailable';
//#endregion
//#region src/client/index.d.ts
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 能力菜单 tab copy. */
    'settings.capability': Record<CapabilityKey, string>;
  }
}
/** Required services (cordis fiber inject). `remote.capabilityPolicy` is NOT
 *  injected: we mount it in `apply`, so declaring it would deadlock the boot
 *  ("waiting for service"). Access it via `ctx.get('remote.capabilityPolicy')`,
 *  which resolves the mounted namespace service without the inject gate. */
declare const inject: string[];
/** Register the 能力菜单 section once `settings.section` is on the ledger. */
declare function apply(ctx: Context): Promise<() => void>;
//#endregion
export { type CapabilityKey, type CapabilityPolicyRemote, type CapabilityRow, type CapabilitySectionInjected, type CapabilitySectionProps, type CapabilitySnapshot, apply, inject };

return module.exports;
}});
//# sourceMappingURL=client.d.ts.map