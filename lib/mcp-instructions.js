import { serverNameOf } from "./registry.js";
const RESOURCE_TOOLS = new Set([
    'list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource',
]);
/**
 * DSH's MCP client publishes literal instructions as `mcp:<server>` sections,
 * independently of tool schemas (verified against dsh-mcp-client 0.2.2-rc.1).
 * Use the caller's registered tool view BEFORE Resident-only admission: an
 * On-demand tool still needs its server's instructions. Empty/unknown servers
 * are not evidence of an explicit Disabled decision.
 */
export function projectMcpInstructions(assembly, tools, isDisabled) {
    if (!assembly.sections.some(section => section.name.startsWith('mcp:')))
        return assembly;
    // DSH exposes resources through shared tools, not mcp__server__tool names.
    // Its public resource API does not identify which server needs instructions.
    // Preserve them conservatively while resource access is still enabled in
    // this scope; never parse or rewrite server-provided prose to infer ownership.
    if (assembly.sections.some(section => section.name === 'mcp-resource-servers' && section.text.length > 0)
        && tools.some(tool => RESOURCE_TOOLS.has(tool.name) && !isDisabled(tool.name)))
        return assembly;
    const disabledServers = new Map();
    for (const tool of tools) {
        if (!tool.name.startsWith('mcp__'))
            continue;
        const server = serverNameOf(tool.name);
        disabledServers.set(server, (disabledServers.get(server) ?? true) && isDisabled(tool.name));
    }
    const sections = assembly.sections.filter(section => !section.name.startsWith('mcp:') || disabledServers.get(section.name.slice(4)) !== true);
    return sections.length === assembly.sections.length ? assembly : { ...assembly, sections };
}
//# sourceMappingURL=mcp-instructions.js.map