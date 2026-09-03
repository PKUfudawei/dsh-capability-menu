/**
 * ⚠️ VERIFIED AGAINST REAL rc.8 CLIENT API.
 *
 * Types + small helpers for the 能力管理 (Capability Management) settings
 * section. The component reads/writes the Host `ctx.capabilityPolicy` through
 * the generated `remote.capabilityPolicy` face (see `./remote.ts`), mirroring
 * how `dsh-client-ui-settings-plugin-inventory` consumes
 * `ctx.remote.pluginInventory`.
 */

/** One capability's Resident/On-demand/Disabled row, as surfaced by the server. */
export interface CapabilityRow {
  readonly id: string
  readonly kind: 'tool' | 'skill'
  readonly name: string
  /** Server namespace for tools (`built-in` groups harness-native tools); undefined for skills. */
  readonly server?: string
  /** Skill source root label (`project-dsh`/`user-agents`/…), present only for skills. */
  readonly source?: string
  readonly class: 'resident' | 'on-demand' | 'disabled'
  /** Human-friendly display: `Resident · 常驻（直接调用）` / `On-demand · 按需（目录渐进加载）` / `Disabled · 禁用`. */
  readonly classLabel?: string
  readonly mandatory: boolean
}

/** Snapshot of the management surface. */
export interface CapabilitySnapshot {
  readonly rows: readonly CapabilityRow[]
}

/** One direct child in a skill directory listing. */
export interface SkillFileEntry {
  readonly name: string
  readonly type: 'file' | 'directory'
}

/** Full detail projection of one capability (schema, description, stats). */
export interface ToolDetail {
  readonly id: string
  readonly kind: 'tool' | 'skill'
  readonly actions: readonly string[]
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly parameters: Record<string, unknown>
  readonly output?: Record<string, unknown>
  readonly origin: { readonly provider: string; readonly serverName?: string; readonly path?: string; readonly source?: string }
  readonly tags: readonly string[]
  readonly stats: {
    readonly uses: number
    readonly successes: number
    readonly failures: number
    readonly totalMs: number
    readonly lastUsedAt?: number
  }
}

/** 能力目录查看负载：两份只读「文件」+ 缺失原因。 */
export interface CatalogDocs {
  /** 当前生效的三档策略配置 YAML。 */
  readonly policyYaml: string
  /** 按需能力目录物化文件（path + content）。 */
  readonly catalog?: { readonly path: string; readonly content: string }
  /** catalog 不可用原因：'disabled' = 物化未启用；'read-failed' = 读盘失败。 */
  readonly catalogMissing?: 'disabled' | 'read-failed'
}

/** The Host `capabilityPolicy` remote face (generated contribution). */
export interface CapabilityPolicyRemote {
  getConfig(): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: { code: string; message: string } }>
  updateConfig(partial: Record<string, unknown>): Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }>
  classifyAll(): Promise<{ ok: true; value: CapabilityRow[] } | { ok: false; error: { code: string; message: string } }>
  listSkillDir(id: string, relPath?: string): Promise<{ ok: true; value: SkillFileEntry[] | undefined } | { ok: false; error: { code: string; message: string } }>
  readSkillFile(id: string, relPath: string): Promise<{ ok: true; value: string | undefined } | { ok: false; error: { code: string; message: string } }>
  getDetail(id: string): Promise<{ ok: true; value: ToolDetail | undefined } | { ok: false; error: { code: string; message: string } }>
  getCatalogDocs(): Promise<{ ok: true; value: CatalogDocs } | { ok: false; error: { code: string; message: string } }>
}

/** Unwrap a RemoteResult-like, throwing a readable error on failure. */
export function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } },
  what: string,
): T {
  if (!result.ok) throw new Error(`${what} failed: ${result.error.code}: ${result.error.message}`)
  return result.value
}

/** Load the classification list from the remote. */
export async function loadSnapshot(remote: CapabilityPolicyRemote): Promise<CapabilitySnapshot> {
  const rows = unwrap(await remote.classifyAll(), 'capabilityPolicy.classifyAll')
  return { rows }
}
