/**
 * Constants shared by the server-side registry and the browser bundle.
 *
 * Kept in a dependency-free module so `src/client` can import them without
 * pulling the registry's `node:fs` / `js-yaml` imports into the web bundle.
 */
/** Prefix of every MCP tool's registered name: `mcp__<server>__<raw>`. */
export declare const MCP_ID_PREFIX = "mcp__";
/**
 * Reserved pseudo-server that groups harness-native (non-MCP) tools in the
 * management surface. Native tools (bash/read/write/…) are cataloged like MCP
 * tools — same `server` dimension — so 能力管理 can group them, classify them
 * Resident/On-demand/Disabled, and `meta_invoke` can dispatch them.
 */
export declare const BUILT_IN_SERVER = "built-in";
//# sourceMappingURL=constants.d.ts.map