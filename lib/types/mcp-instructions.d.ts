import type { PromptPresentation } from '@deepseek-ai/dsh-system-prompt';
/**
 * DSH's MCP client publishes literal instructions as `mcp:<server>` sections,
 * independently of tool schemas (verified against dsh-mcp-client 0.2.2-rc.1).
 * Use the caller's registered tool view BEFORE Resident-only admission: an
 * On-demand tool still needs its server's instructions. Empty/unknown servers
 * are not evidence of an explicit Disabled decision.
 */
export declare function projectMcpInstructions<T extends PromptPresentation>(assembly: T, tools: readonly {
    readonly name: string;
}[], isDisabled: (name: string) => boolean): T;
//# sourceMappingURL=mcp-instructions.d.ts.map