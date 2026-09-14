import type { Context } from '@deepseek-ai/cordis';
/** Plugin name of the MCP bridge, as declared in patch rows. */
export declare const MCP_CLIENT_PLUGIN = "@deepseek-ai/dsh-mcp-client";
export interface LocationConfig {
    /** Patch file holding the MCP rows. Defaults to the home-level layer. */
    readonly patchFile: string;
    /** Skill root that `skill-filesystem` discovers by default. */
    readonly skillsDir: string;
}
export declare function defaultLocationConfig(): LocationConfig;
/** Default skill root: the user root `skill-filesystem` scans with no config. */
export declare function defaultSkillsDir(): string;
/** One MCP server, as declared in the patch file. */
export interface McpLocation {
    /** Patch row id (e.g. `mcp-gongfeng`). */
    readonly id: string;
    readonly serverName: string;
    readonly transport: 'stdio' | 'streamable-http';
    readonly disabled: boolean;
    /** stdio: executable, argv, extra environment, working directory. */
    readonly command?: string;
    readonly args?: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
    readonly cwd?: string;
    /** streamable-http: endpoint and extra request headers (auth lives here). */
    readonly url?: string;
    readonly headers?: Readonly<Record<string, string>>;
    /** Per-tool-call timeout in milliseconds (`dsh-mcp-client` default 60000). */
    readonly toolCallTimeoutMs?: number;
}
/** Which skill root an entry lives in. */
export type SkillRootKind = 'user' | 'project';
/** One skill entry under a managed skill root. */
export interface SkillLocation {
    readonly name: string;
    /** The entry itself: `<entryDir>/<name>`, a symlink or a real directory. */
    readonly path: string;
    /** True when the entry is a symlink to a directory outside the skill root. */
    readonly linked: boolean;
    /**
     * False when dsh would not load the entry: no `SKILL.md`, or a frontmatter
     * that is not a YAML mapping with a kebab-case `name` and a `description`.
     */
    readonly valid: boolean;
    /** `user` for the default root, `project` for a project's own skill root. */
    readonly root: SkillRootKind;
    /**
     * The skills directory holding the entry (`…/.dsh/skills` or
     * `…/.agents/skills`). Opaque to callers: pass it back to update or remove,
     * rather than rebuilding it from parts.
     */
    readonly entryDir: string;
    /** The directory the entry points at, with symlinks resolved. */
    readonly target?: string;
}
/**
 * Input for editing a declared MCP server. `serverName` is deliberately absent:
 * it is the row's identity and is baked into every `mcp__<serverName>__<tool>`
 * name, session history and permission rule, so editing must not change it.
 */
export type McpUpdateInput = Omit<McpInput, 'serverName'>;
/** Input for registering a new MCP server. */
export interface McpInput {
    readonly serverName: string;
    readonly transport: 'stdio' | 'streamable-http';
    readonly command?: string;
    readonly args?: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
    readonly cwd?: string;
    readonly url?: string;
    readonly headers?: Readonly<Record<string, string>>;
    /** Per-tool-call timeout in milliseconds; omit to use the dsh default. */
    readonly toolCallTimeoutMs?: number;
}
export declare class LocationRegistry {
    private readonly ctx;
    private readonly config;
    constructor(ctx: Context, config: LocationConfig);
    /** Every MCP server declared in the patch file, in file order. */
    listMcp(): Promise<McpLocation[]>;
    /** Declare a new MCP server row. Throws on invalid or duplicate input. */
    addMcp(input: McpInput): Promise<string>;
    /** Remove a declared MCP server. Returns false when the row is absent. */
    removeMcp(id: string): Promise<boolean>;
    /**
     * Replace a declared server's connection config. The row id (and therefore
     * `serverName`, which is baked into every `mcp__<serverName>__<tool>` tool
     * name, session history and permission rule) is never changed here.
     */
    updateMcp(id: string, input: McpUpdateInput): Promise<boolean>;
    private hasMcp;
    /** Every entry under the default (user) skill root. */
    listSkills(): Promise<SkillLocation[]>;
    /**
     * Which skills directory an operation targets.
     *
     * `entryDir` comes back from a listing and is taken as given, but validated —
     * a caller must not be able to aim `remove` at an arbitrary tree. Otherwise,
     * `projectPath` is a path *inside* a project and the project root is derived
     * from it exactly the way dsh derives it; with neither, the user root.
     */
    private resolveSkillsDir;
    /**
     * Register a skill directory by symlinking it into a managed root — the user
     * root by default, or a project's `.dsh/skills` when `projectPath` is given.
     * Returns the entry path actually written, so the caller can report where the
     * skill landed instead of leaving the operator to guess.
     */
    addSkill(dir: string, projectPath?: string): Promise<string>;
    /**
     * Unregister a skill entry. Only removes a symlink or a directory that
     * actually carries a `SKILL.md` — never an arbitrary file.
     */
    removeSkill(name: string, entryDir?: string): Promise<boolean>;
    /**
     * Repoint a registered skill at a different directory: unlink the old entry
     * and link the new one under the same name. The name is the skill's identity
     * in `ctx.skills`, so a rename is a remove + add, not an update.
     */
    updateSkill(name: string, dir: string, entryDir?: string): Promise<boolean>;
}
/**
 * Describe `<entryDir>/<name>` as a skill entry, or `undefined` when nothing
 * there looks like one. Used both for listing the user root and for describing
 * project entries that dsh discovered on its own.
 */
export declare function describeSkillEntry(entryDir: string, name: string, root: SkillRootKind): Promise<SkillLocation | undefined>;
/** True when `dir` has the shape of a project skills root. */
export declare function isProjectSkillsDir(dir: string): boolean;
//# sourceMappingURL=locations.d.ts.map