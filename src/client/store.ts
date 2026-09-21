/**
 * ⚠️ VERIFIED AGAINST REAL rc.8 CLIENT API.
 *
 * Types + small helpers for the 能力菜单 (Capability Management) settings
 * section. The component reads/writes the Host `ctx.capabilityPolicy` through
 * the generated `remote.capabilityPolicy` face (see `./remote.ts`), mirroring
 * how `dsh-client-ui-settings-plugin-inventory` consumes
 * `ctx.remote.pluginInventory`.
 */

// The row/detail/payload shapes live in `./remote.ts`: that is where the Typert
// wire schemas are declared, so re-exporting keeps the UI types and the
// validated wire types from drifting apart.
export type {
  CapabilityRow,
  CatalogDocs,
  SkillFileEntry,
  ToolDetail,
  McpLocation,
  McpInput,
  McpUpdateInput,
  SkillLocation,
} from './remote.ts'
import type {
  CapabilityRow,
  CatalogDocs,
  SkillFileEntry,
  ToolDetail,
  McpLocation,
  McpInput,
  McpUpdateInput,
  SkillLocation,
} from './remote.ts'

/** Snapshot of the management surface. */
export interface CapabilitySnapshot {
  readonly rows: readonly CapabilityRow[]
}

/** The Host `capabilityPolicy` remote face (generated contribution). */
export interface CapabilityPolicyRemote {
  getConfig(): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: { code: string; message: string } }>
  updateConfig(partial: Record<string, unknown>): Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }>
  classifyAll(): Promise<{ ok: true; value: CapabilityRow[] } | { ok: false; error: { code: string; message: string } }>
  refresh(): Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }>
  /** One number naming the host's current catalog state; see the registry's `version()`. */
  catalogVersion(): Promise<{ ok: true; value: number } | { ok: false; error: { code: string; message: string } }>
  listSkillDir(id: string, relPath?: string): Promise<{ ok: true; value: SkillFileEntry[] | undefined } | { ok: false; error: { code: string; message: string } }>
  readSkillFile(id: string, relPath: string): Promise<{ ok: true; value: string | undefined } | { ok: false; error: { code: string; message: string } }>
  getDetail(id: string): Promise<{ ok: true; value: ToolDetail | undefined } | { ok: false; error: { code: string; message: string } }>
  getCatalogDocs(): Promise<{ ok: true; value: CatalogDocs } | { ok: false; error: { code: string; message: string } }>
  listLocations(): Promise<{ ok: true; value: McpLocation[] } | { ok: false; error: { code: string; message: string } }>
  addLocation(input: McpInput): Promise<{ ok: true; value: string } | { ok: false; error: { code: string; message: string } }>
  removeLocation(id: string): Promise<{ ok: true; value: boolean } | { ok: false; error: { code: string; message: string } }>
  updateLocation(id: string, input: McpUpdateInput): Promise<{ ok: true; value: boolean } | { ok: false; error: { code: string; message: string } }>
  listSkillLocations(): Promise<{ ok: true; value: SkillLocation[] } | { ok: false; error: { code: string; message: string } }>
  addSkillLocation(dir: string, projectPath?: string): Promise<{ ok: true; value: string } | { ok: false; error: { code: string; message: string } }>
  removeSkillLocation(name: string, entryDir?: string): Promise<{ ok: true; value: boolean } | { ok: false; error: { code: string; message: string } }>
  adoptSkillLocation(name: string): Promise<{ ok: true; value: string } | { ok: false; error: { code: string; message: string } }>
  updateSkillLocation(name: string, dir: string, entryDir?: string): Promise<{ ok: true; value: boolean } | { ok: false; error: { code: string; message: string } }>
}

/** Unwrap a RemoteResult-like, throwing a readable error on failure. */
export function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } },
  what: string,
): T {
  if (!result.ok) throw new Error(`${what} failed: ${result.error.code}: ${result.error.message}`)
  return result.value
}

/**
 * Unwrap a RemoteResult-like for a user-facing mutation.
 *
 * The policy service's messages are already written for the person at the
 * dialog (Chinese, naming the offending path), so the RPC name and error code
 * that `unwrap` adds for diagnostics are dropped here: they would surface as
 * `capabilityPolicy.addSkillLocation failed: <code>: 目录中没有 SKILL.md：…`
 * in a dialog that is otherwise plain Chinese.
 */
export function unwrapMessage<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } },
): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/**
 * The last successful snapshot, at module scope.
 *
 * The section is remounted every time the settings tab is opened, and a cold
 * `classifyAll` can be slow once per page load (the plugin's mount awaits a full
 * catalog enumeration before the surface has data). Keeping the previous rows
 * lets a remount paint them immediately and revalidate behind the user instead
 * of showing a loading placeholder. This is a view cache only — every read is
 * still followed by an authoritative one.
 */
let lastSnapshot: CapabilitySnapshot | undefined

/** The previously loaded snapshot, when this page session has one. */
export function cachedSnapshot(): CapabilitySnapshot | undefined {
  return lastSnapshot
}

/** Load the classification list from the remote, remembering it for remounts. */
export async function loadSnapshot(remote: CapabilityPolicyRemote): Promise<CapabilitySnapshot> {
  const rows = unwrap(await remote.classifyAll(), 'capabilityPolicy.classifyAll')
  lastSnapshot = { rows }
  return lastSnapshot
}
