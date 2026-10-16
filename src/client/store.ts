/**
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
  CapabilityDiagnostics,
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
  CapabilityDiagnostics,
} from './remote.ts'

/** Snapshot of the management surface. */
export interface CapabilitySnapshot {
  readonly rows: readonly CapabilityRow[]
  readonly diagnostics?: CapabilityDiagnostics
}

/** The Host `capabilityPolicy` remote face (generated contribution). */
export interface CapabilityPolicyRemote {
  getConfig(): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: { code: string; message: string } }>
  updateConfig(partial: Record<string, unknown>): Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }>
  classifyAll(): Promise<{ ok: true; value: CapabilityRow[] } | { ok: false; error: { code: string; message: string } }>
  getDiagnostics?(): Promise<{ ok: true; value: CapabilityDiagnostics } | { ok: false; error: { code: string; message: string } }>
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
  importSkillFromGitHub(url: string, projectPath?: string): Promise<{ ok: true; value: string } | { ok: false; error: { code: string; message: string } }>
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
 * `classifyAll` can be slow while the host builds its catalog. Keeping the
 * previous rows lets a remount paint them immediately and revalidate behind
 * the user instead of showing a loading placeholder. This is a view cache
 * only — every read is still followed by an authoritative one.
 */
let lastSnapshot: CapabilitySnapshot | undefined

/** Short grace period for host tools that register just after the section mounts. */
const EMPTY_SNAPSHOT_RETRY_DELAYS = [250, 500, 1_000, 1_500] as const

/**
 * Grace period for the reload a tier write causes.
 *
 * Writing the profile patch makes dsh hot-reload this plugin, and for the few
 * seconds that takes the whole `capabilityPolicy/*` surface answers
 * `gateway/service-unavailable`. The sum (9.5s) is longer than an observed
 * reload (~8s).
 */
const TRANSIENT_CALL_RETRY_DELAYS = [500, 1_000, 2_000, 3_000, 3_000] as const

/** Host failures that can clear once the reload lands. A 404 is permanent. */
function isTransientHostFailure(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error)
  return /gateway\/(?:service-unavailable|context-(?:unavailable|failed))\b/.test(text)
    || /transport failure[^\n]*HTTP (?:502|503|504)\b/.test(text)
}

/**
 * Run one host call, retrying failures that can clear after a plugin reload.
 *
 * Anything else — a rejected write, a malformed argument — surfaces on the first
 * attempt: retrying those would only delay the error the operator needs to see.
 */
export async function withTransientRetry<T>(
  work: () => Promise<T>,
  retryDelays: readonly number[] = TRANSIENT_CALL_RETRY_DELAYS,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await work()
    } catch (error) {
      const delayMs = retryDelays[attempt]
      if (delayMs === undefined || !isTransientHostFailure(error)) throw error
      await new Promise<void>(resolve => setTimeout(resolve, delayMs))
    }
  }
}

/** The previously loaded snapshot, when this page session has one. */
export function cachedSnapshot(): CapabilitySnapshot | undefined {
  return lastSnapshot
}

/** Read one authoritative classification list without changing the view cache. */
export async function readSnapshot(remote: CapabilityPolicyRemote): Promise<CapabilitySnapshot> {
  const rows = unwrap(await remote.classifyAll(), 'capabilityPolicy.classifyAll')
  return { rows }
}

/** Remember a snapshot after its contents are ready to replace the current view. */
export function rememberSnapshot(snapshot: CapabilitySnapshot): CapabilitySnapshot {
  lastSnapshot = snapshot
  return lastSnapshot
}

/**
 * Load the classification list, retrying an empty result briefly because
 * built-in tools can register just after the settings section mounts.
 * Non-empty results remain authoritative and return immediately.
 */
export async function loadSnapshot(
  remote: CapabilityPolicyRemote,
  retryDelays: readonly number[] = EMPTY_SNAPSHOT_RETRY_DELAYS,
): Promise<CapabilitySnapshot> {
  let snapshot = await withTransientRetry(() => readSnapshot(remote))
  for (const delayMs of retryDelays) {
    if (snapshot.rows.length > 0) break
    await new Promise<void>(resolve => setTimeout(resolve, delayMs))
    snapshot = await withTransientRetry(() => readSnapshot(remote))
  }
  return rememberSnapshot(snapshot)
}

/** Wait briefly for an MCP's tools to enter the host catalog after registration. */
export async function waitForMcpTools(
  remote: CapabilityPolicyRemote,
  serverName: string,
  retryDelays: readonly number[],
): Promise<CapabilitySnapshot | undefined> {
  const prefix = `mcp__${serverName}__`
  const hasServerTools = (snapshot: CapabilitySnapshot): boolean =>
    snapshot.rows.some(row => row.kind === 'tool' && row.id.startsWith(prefix))

  let snapshot = await withTransientRetry(() => readSnapshot(remote))
  if (hasServerTools(snapshot)) return snapshot
  for (const delayMs of retryDelays) {
    await new Promise<void>(resolve => setTimeout(resolve, delayMs))
    snapshot = await withTransientRetry(() => readSnapshot(remote))
    if (hasServerTools(snapshot)) return snapshot
  }
  return undefined
}
