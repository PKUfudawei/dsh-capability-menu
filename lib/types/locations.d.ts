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
    readonly command?: string;
    readonly args?: readonly string[];
    readonly url?: string;
}
/** One skill directory registered under the default skill root. */
export interface SkillLocation {
    readonly name: string;
    readonly path: string;
    /** True when the entry is a symlink to a directory outside the skill root. */
    readonly linked: boolean;
    /** False when the entry does not look like a skill (no `SKILL.md`). */
    readonly valid: boolean;
}
/** Input for registering a new MCP server. */
export interface McpInput {
    readonly serverName: string;
    readonly transport: 'stdio' | 'streamable-http';
    readonly command?: string;
    readonly args?: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
    readonly url?: string;
    readonly headers?: Readonly<Record<string, string>>;
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
    /** Enable or disable a declared MCP server. */
    setMcpEnabled(id: string, enabled: boolean): Promise<boolean>;
    /** Replace a row's connection config (used to edit an existing server). */
    updateMcp(id: string, input: McpInput): Promise<boolean>;
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
}
//# sourceMappingURL=locations.d.ts.map