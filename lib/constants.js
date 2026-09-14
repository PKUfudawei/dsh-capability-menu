/**
 * Constants shared by the server-side registry and the browser bundle.
 *
 * Kept in a dependency-free module so `src/client` can import them without
 * pulling the registry's `node:fs` / `js-yaml` imports into the web bundle.
 */
/** Prefix of every MCP tool's registered name: `mcp__<server>__<raw>`. */
export const MCP_ID_PREFIX = 'mcp__';
/**
 * Reserved pseudo-server that groups harness-native (non-MCP) tools in the
 * management surface. Native tools (bash/read/write/…) are cataloged like MCP
 * tools — same `server` dimension — so 能力菜单 can group them, classify them
 * Resident/On-demand/Disabled, and `meta_invoke` can dispatch them.
 */
export const BUILT_IN_SERVER = 'built-in';
/**
 * dsh's source labels for a project's own skill roots — the `project`-prefixed
 * providers of `@deepseek-ai/dsh-skill-filesystem`, which scan
 * `<projectRoot>/.dsh/skills` and `<projectRoot>/.agents/skills`. Every other
 * label (`user-dsh`, `user-agents`, `bundled`, `custom`, `runtime`) is a
 * user-level root. Shared so the server's location manager and the browser's
 * 全局 / 项目 grouping agree on what "project scoped" means.
 */
export const PROJECT_SKILL_SOURCES = new Set(['project-dsh', 'project-agents']);
//# sourceMappingURL=constants.js.map