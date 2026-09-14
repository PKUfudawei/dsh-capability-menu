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
/** One skill directory registered under the default skill root. */
export interface SkillLocation {
    readonly name: string;
    readonly path: string;
    /** True when the entry is a symlink to a directory outside the skill root. */
    readonly linked: boolean;
    /**
     * False when dsh would not load the entry: no `SKILL.md`, or a frontmatter
     * that is not a YAML mapping with a kebab-case `name` and a `description`.
     */
    readonly valid: boolean;
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
    /** Every entry under the default skill root. */
    listSkills(): Promise<SkillLocation[]>;
    /** Register a skill directory by symlinking it into the default skill root. */
    addSkill(dir: string): Promise<string>;
    /**
     * Unregister a skill directory. Only removes a symlink or a directory that
     * actually carries a `SKILL.md` — never an arbitrary file.
     */
    removeSkill(name: string): Promise<boolean>;
    /**
     * Repoint a registered skill at a different directory: unlink the old entry
     * and link the new one under the same name. The name is the skill's identity
     * in `ctx.skills`, so a rename is a remove + add, not an update.
     */
    updateSkill(name: string, dir: string): Promise<boolean>;
}
//# sourceMappingURL=locations.d.ts.map