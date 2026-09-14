/**
 * ⚠️ VERIFIED AGAINST REAL rc.8 TYPERT PROTOCOL.
 *
 * Client-side Typert remote contribution for the `capabilityPolicy` Host
 * gateway (`src/server/remote.ts`). Mirrors the generated shape that
 * `@deepseek-ai/dsh-typert-generator` emits (see
 * `@deepseek-ai/dsh-host-plugin-inventory/lib/typert.remote-client.js`): it
 * augments `@deepseek-ai/dsh-typert-protocol` with the `capabilityPolicy`
 * namespace and exports a `TYPERT_REMOTE` contribution that the browser
 * plugin mounts via `ctx.remote.$mount(...)`.
 */
import { z } from 'zod'
import type {
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'

/** Read-only row: one capability's Resident/On-demand/Disabled classification. */
export interface CapabilityRow {
  readonly id: string
  readonly kind: 'tool' | 'skill'
  readonly name: string
  readonly server?: string
  /** Skill source root label (`project-dsh`/`user-agents`/…), present only for skills. */
  readonly source?: string
  readonly class: 'resident' | 'on-demand' | 'disabled'
  readonly classLabel?: string
  readonly mandatory: boolean
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

/** One MCP server declared in the patch file. */
export interface McpLocation {
  readonly id: string
  readonly serverName: string
  readonly transport: 'stdio' | 'streamable-http'
  readonly disabled: boolean
  readonly command?: string
  readonly args?: readonly string[]
  readonly url?: string
}

/** One skill directory registered under the default skill root. */
export interface SkillLocation {
  readonly name: string
  readonly path: string
  readonly linked: boolean
  readonly valid: boolean
}

/** Input for registering a new MCP server. */
export interface McpInput {
  readonly serverName: string
  readonly transport: 'stdio' | 'streamable-http'
  readonly command?: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly url?: string
  readonly headers?: Readonly<Record<string, string>>
}

const mcpLocation$schema = z.object({
  id: z.string().readonly(),
  serverName: z.string().readonly(),
  transport: z.union([z.literal('stdio'), z.literal('streamable-http')]).readonly(),
  disabled: z.boolean().readonly(),
  command: z.string().optional().readonly(),
  args: z.array(z.string()).optional().readonly(),
  url: z.string().optional().readonly(),
})

const skillLocation$schema = z.object({
  name: z.string().readonly(),
  path: z.string().readonly(),
  linked: z.boolean().readonly(),
  valid: z.boolean().readonly(),
})

const mcpInput$schema = z.object({
  serverName: z.string(),
  transport: z.union([z.literal('stdio'), z.literal('streamable-http')]),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
})

const capabilityRow$schema = z.object({
  id: z.string().readonly(),
  kind: z.union([z.literal('tool'), z.literal('skill')]).readonly(),
  name: z.string().readonly(),
  server: z.string().optional().readonly(),
  source: z.string().optional().readonly(),
  class: z.union([z.literal('resident'), z.literal('on-demand'), z.literal('disabled')]).readonly(),
  classLabel: z.string().optional().readonly(),
  mandatory: z.boolean().readonly(),
})

const skillFileEntry$schema = z.object({
  name: z.string().readonly(),
  type: z.union([z.literal('file'), z.literal('directory')]).readonly(),
})

const catalogDocs$schema = z.object({
  policyYaml: z.string().readonly(),
  catalog: z.object({
    path: z.string().readonly(),
    content: z.string().readonly(),
  }).optional().readonly(),
  catalogMissing: z.union([z.literal('disabled'), z.literal('read-failed')]).optional().readonly(),
})

const toolDetail$schema = z.object({
  id: z.string().readonly(),
  kind: z.union([z.literal('tool'), z.literal('skill')]).readonly(),
  actions: z.array(z.string()).readonly(),
  name: z.string().readonly(),
  description: z.string().readonly(),
  whenToUse: z.string().optional().readonly(),
  parameters: z.record(z.string(), z.unknown()).readonly(),
  output: z.record(z.string(), z.unknown()).optional().readonly(),
  origin: z.object({
    provider: z.string().readonly(),
    serverName: z.string().optional().readonly(),
    path: z.string().optional().readonly(),
    source: z.string().optional().readonly(),
  }).readonly(),
  tags: z.array(z.string()).readonly(),
  stats: z.object({
    uses: z.number().readonly(),
    successes: z.number().readonly(),
    failures: z.number().readonly(),
    totalMs: z.number().readonly(),
    lastUsedAt: z.number().optional().readonly(),
  }).readonly(),
})

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$6361706162696c697479506f6c696379 {
    getConfig: () => Promise<RemoteResult<Record<string, unknown>>>
    updateConfig: (partial: Record<string, unknown>) => Promise<RemoteResult<void>>
    classifyAll: () => Promise<RemoteResult<CapabilityRow[]>>
    refresh: () => Promise<RemoteResult<void>>
    listSkillDir: (id: string, relPath?: string) => Promise<RemoteResult<SkillFileEntry[] | undefined>>
    readSkillFile: (id: string, relPath: string) => Promise<RemoteResult<string | undefined>>
    getDetail: (id: string) => Promise<RemoteResult<ToolDetail | undefined>>
    getCatalogDocs: () => Promise<RemoteResult<CatalogDocs>>
    listLocations: () => Promise<RemoteResult<McpLocation[]>>
    addLocation: (input: McpInput) => Promise<RemoteResult<string>>
    removeLocation: (id: string) => Promise<RemoteResult<boolean>>
    setLocationEnabled: (id: string, enabled: boolean) => Promise<RemoteResult<boolean>>
    listSkillLocations: () => Promise<RemoteResult<SkillLocation[]>>
    addSkillLocation: (dir: string) => Promise<RemoteResult<string>>
    removeSkillLocation: (name: string) => Promise<RemoteResult<boolean>>
  }
  interface TypertRemoteMap {
    'capabilityPolicy/getConfig': () => Promise<RemoteResult<Record<string, unknown>>>
    'capabilityPolicy/updateConfig': (partial: Record<string, unknown>) => Promise<RemoteResult<void>>
    'capabilityPolicy/classifyAll': () => Promise<RemoteResult<CapabilityRow[]>>
    'capabilityPolicy/refresh': () => Promise<RemoteResult<void>>
    'capabilityPolicy/listSkillDir': (id: string, relPath?: string) => Promise<RemoteResult<SkillFileEntry[] | undefined>>
    'capabilityPolicy/readSkillFile': (id: string, relPath: string) => Promise<RemoteResult<string | undefined>>
    'capabilityPolicy/getDetail': (id: string) => Promise<RemoteResult<ToolDetail | undefined>>
    'capabilityPolicy/getCatalogDocs': () => Promise<RemoteResult<CatalogDocs>>
    'capabilityPolicy/listLocations': () => Promise<RemoteResult<McpLocation[]>>
    'capabilityPolicy/addLocation': (input: McpInput) => Promise<RemoteResult<string>>
    'capabilityPolicy/removeLocation': (id: string) => Promise<RemoteResult<boolean>>
    'capabilityPolicy/setLocationEnabled': (id: string, enabled: boolean) => Promise<RemoteResult<boolean>>
    'capabilityPolicy/listSkillLocations': () => Promise<RemoteResult<SkillLocation[]>>
    'capabilityPolicy/addSkillLocation': (dir: string) => Promise<RemoteResult<string>>
    'capabilityPolicy/removeSkillLocation': (name: string) => Promise<RemoteResult<boolean>>
  }
  interface TypertRemoteNamespaceMap {
    'capabilityPolicy': TypertRemoteNamespace$6361706162696c697479506f6c696379
  }
}

export const TYPERT_REMOTE: TypertRemoteContribution = {
  package: '@daweifu/capability-menu',
  descriptors: [
    {
      id: '@daweifu/capability-menu#capabilityPolicy/getConfig',
      service: 'capabilityPolicy',
      namespace: 'capabilityPolicy',
      method: 'getConfig',
      invocation: { kind: 'direct' },
      parameters: [],
      result: { mode: 'strict', typeSymbol: 'Record<string, unknown>', schema: z.record(z.string(), z.unknown()) },
      sourceLocation: { file: 'src/server/remote.ts', line: 61, column: 3 },
    },
    {
      id: '@daweifu/capability-menu#capabilityPolicy/updateConfig',
      service: 'capabilityPolicy',
      namespace: 'capabilityPolicy',
      method: 'updateConfig',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'partial', wire: 'partial', source: 'json', codec: { mode: 'strict', typeSymbol: 'Record<string, unknown>', schema: z.record(z.string(), z.unknown()) } },
      ],
      result: { mode: 'strict', typeSymbol: 'void', schema: z.undefined() },
      sourceLocation: { file: 'src/server/remote.ts', line: 67, column: 3 },
    },
    {
      id: '@daweifu/capability-menu#capabilityPolicy/classifyAll',
      service: 'capabilityPolicy',
      namespace: 'capabilityPolicy',
      method: 'classifyAll',
      invocation: { kind: 'direct' },
      parameters: [],
      result: { mode: 'strict', typeSymbol: '@daweifu/capability-menu#CapabilityRow', schema: z.array(capabilityRow$schema) },
      sourceLocation: { file: 'src/server/remote.ts', line: 73, column: 3 },
    },
    {
      id: '@daweifu/capability-menu#capabilityPolicy/refresh',
      service: 'capabilityPolicy',
      namespace: 'capabilityPolicy',
      method: 'refresh',
      invocation: { kind: 'direct' },
      parameters: [],
      result: { mode: 'strict', typeSymbol: 'void', schema: z.undefined() },
      sourceLocation: { file: 'src/server/remote.ts', line: 84, column: 3 },
    },
    {
      id: '@daweifu/capability-menu#capabilityPolicy/listSkillDir',
      service: 'capabilityPolicy',
      namespace: 'capabilityPolicy',
      method: 'listSkillDir',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'id', wire: 'id', source: 'json', codec: { mode: 'strict', typeSymbol: 'string', schema: z.string() } },
        { name: 'relPath', wire: 'relPath', source: 'json', acceptsUndefined: true, codec: { mode: 'strict', typeSymbol: 'string', schema: z.string().optional() } },
      ],
      result: { mode: 'strict', typeSymbol: '@daweifu/capability-menu#SkillFileEntry[]', schema: z.array(skillFileEntry$schema).optional() },
      sourceLocation: { file: 'src/server/remote.ts', line: 85, column: 3 },
    },
    {
      id: '@daweifu/capability-menu#capabilityPolicy/readSkillFile',
      service: 'capabilityPolicy',
      namespace: 'capabilityPolicy',
      method: 'readSkillFile',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'id', wire: 'id', source: 'json', codec: { mode: 'strict', typeSymbol: 'string', schema: z.string() } },
        { name: 'relPath', wire: 'relPath', source: 'json', codec: { mode: 'strict', typeSymbol: 'string', schema: z.string() } },
      ],
      result: { mode: 'strict', typeSymbol: 'string', schema: z.string().optional() },
      sourceLocation: { file: 'src/server/remote.ts', line: 91, column: 3 },
    },
    {
      id: '@daweifu/capability-menu#capabilityPolicy/getDetail',
      service: 'capabilityPolicy',
      namespace: 'capabilityPolicy',
      method: 'getDetail',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'id', wire: 'id', source: 'json', codec: { mode: 'strict', typeSymbol: 'string', schema: z.string() } },
      ],
      result: { mode: 'strict', typeSymbol: '@daweifu/capability-menu#ToolDetail', schema: toolDetail$schema.optional() },
      sourceLocation: { file: 'src/server/remote.ts', line: 79, column: 3 },
    },
    {
      id: '@daweifu/capability-menu#capabilityPolicy/getCatalogDocs',
      service: 'capabilityPolicy',
      namespace: 'capabilityPolicy',
      method: 'getCatalogDocs',
      invocation: { kind: 'direct' },
      parameters: [],
      result: { mode: 'strict', typeSymbol: '@daweifu/capability-menu#CatalogDocs', schema: catalogDocs$schema },
      sourceLocation: { file: 'src/server/remote.ts', line: 104, column: 3 },
    },
    {
      id: '@daweifu/capability-menu#capabilityPolicy/listLocations',
      service: 'capabilityPolicy',
      namespace: 'capabilityPolicy',
      method: 'listLocations',
      invocation: { kind: 'direct' },
      parameters: [],
      result: { mode: 'strict', typeSymbol: '@daweifu/capability-menu#McpLocation[]', schema: z.array(mcpLocation$schema) },
      sourceLocation: { file: 'src/server/remote.ts', line: 193, column: 3 },
    },
    {
      id: '@daweifu/capability-menu#capabilityPolicy/addLocation',
      service: 'capabilityPolicy',
      namespace: 'capabilityPolicy',
      method: 'addLocation',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'input', wire: 'input', source: 'json', codec: { mode: 'strict', typeSymbol: '@daweifu/capability-menu#McpInput', schema: mcpInput$schema } },
      ],
      result: { mode: 'strict', typeSymbol: 'string', schema: z.string() },
      sourceLocation: { file: 'src/server/remote.ts', line: 199, column: 3 },
    },
    {
      id: '@daweifu/capability-menu#capabilityPolicy/removeLocation',
      service: 'capabilityPolicy',
      namespace: 'capabilityPolicy',
      method: 'removeLocation',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'id', wire: 'id', source: 'json', codec: { mode: 'strict', typeSymbol: 'string', schema: z.string() } },
      ],
      result: { mode: 'strict', typeSymbol: 'boolean', schema: z.boolean() },
      sourceLocation: { file: 'src/server/remote.ts', line: 205, column: 3 },
    },
    {
      id: '@daweifu/capability-menu#capabilityPolicy/setLocationEnabled',
      service: 'capabilityPolicy',
      namespace: 'capabilityPolicy',
      method: 'setLocationEnabled',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'id', wire: 'id', source: 'json', codec: { mode: 'strict', typeSymbol: 'string', schema: z.string() } },
        { name: 'enabled', wire: 'enabled', source: 'json', codec: { mode: 'strict', typeSymbol: 'boolean', schema: z.boolean() } },
      ],
      result: { mode: 'strict', typeSymbol: 'boolean', schema: z.boolean() },
      sourceLocation: { file: 'src/server/remote.ts', line: 211, column: 3 },
    },
    {
      id: '@daweifu/capability-menu#capabilityPolicy/listSkillLocations',
      service: 'capabilityPolicy',
      namespace: 'capabilityPolicy',
      method: 'listSkillLocations',
      invocation: { kind: 'direct' },
      parameters: [],
      result: { mode: 'strict', typeSymbol: '@daweifu/capability-menu#SkillLocation[]', schema: z.array(skillLocation$schema) },
      sourceLocation: { file: 'src/server/remote.ts', line: 217, column: 3 },
    },
    {
      id: '@daweifu/capability-menu#capabilityPolicy/addSkillLocation',
      service: 'capabilityPolicy',
      namespace: 'capabilityPolicy',
      method: 'addSkillLocation',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'dir', wire: 'dir', source: 'json', codec: { mode: 'strict', typeSymbol: 'string', schema: z.string() } },
      ],
      result: { mode: 'strict', typeSymbol: 'string', schema: z.string() },
      sourceLocation: { file: 'src/server/remote.ts', line: 223, column: 3 },
    },
    {
      id: '@daweifu/capability-menu#capabilityPolicy/removeSkillLocation',
      service: 'capabilityPolicy',
      namespace: 'capabilityPolicy',
      method: 'removeSkillLocation',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'name', wire: 'name', source: 'json', codec: { mode: 'strict', typeSymbol: 'string', schema: z.string() } },
      ],
      result: { mode: 'strict', typeSymbol: 'boolean', schema: z.boolean() },
      sourceLocation: { file: 'src/server/remote.ts', line: 229, column: 3 },
    },
  ],
}

export default TYPERT_REMOTE
