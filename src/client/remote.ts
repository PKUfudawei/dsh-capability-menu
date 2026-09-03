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

/** Read-only row: one capability's Resident/On-demand/Blocked classification. */
export interface CapabilityRow {
  readonly id: string
  readonly kind: 'tool' | 'skill'
  readonly name: string
  readonly server?: string
  /** Skill source root label (`project-dsh`/`user-agents`/…), present only for skills. */
  readonly source?: string
  readonly class: 'resident' | 'on-demand' | 'blocked'
  readonly classLabel?: string
  readonly mandatory: boolean
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

const capabilityRow$schema = z.object({
  id: z.string().readonly(),
  kind: z.union([z.literal('tool'), z.literal('skill')]).readonly(),
  name: z.string().readonly(),
  server: z.string().optional().readonly(),
  source: z.string().optional().readonly(),
  class: z.union([z.literal('resident'), z.literal('on-demand'), z.literal('blocked')]).readonly(),
  classLabel: z.string().optional().readonly(),
  mandatory: z.boolean().readonly(),
})

const skillFileEntry$schema = z.object({
  name: z.string().readonly(),
  type: z.union([z.literal('file'), z.literal('directory')]).readonly(),
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
    listSkillDir: (id: string, relPath?: string) => Promise<RemoteResult<SkillFileEntry[] | undefined>>
    readSkillFile: (id: string, relPath: string) => Promise<RemoteResult<string | undefined>>
    getDetail: (id: string) => Promise<RemoteResult<ToolDetail | undefined>>
  }
  interface TypertRemoteMap {
    'capabilityPolicy/getConfig': () => Promise<RemoteResult<Record<string, unknown>>>
    'capabilityPolicy/updateConfig': (partial: Record<string, unknown>) => Promise<RemoteResult<void>>
    'capabilityPolicy/classifyAll': () => Promise<RemoteResult<CapabilityRow[]>>
    'capabilityPolicy/listSkillDir': (id: string, relPath?: string) => Promise<RemoteResult<SkillFileEntry[] | undefined>>
    'capabilityPolicy/readSkillFile': (id: string, relPath: string) => Promise<RemoteResult<string | undefined>>
    'capabilityPolicy/getDetail': (id: string) => Promise<RemoteResult<ToolDetail | undefined>>
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
      sourceLocation: { file: 'src/server/remote.ts', line: 47, column: 3 },
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
      sourceLocation: { file: 'src/server/remote.ts', line: 53, column: 3 },
    },
    {
      id: '@daweifu/capability-menu#capabilityPolicy/classifyAll',
      service: 'capabilityPolicy',
      namespace: 'capabilityPolicy',
      method: 'classifyAll',
      invocation: { kind: 'direct' },
      parameters: [],
      result: { mode: 'strict', typeSymbol: '@daweifu/capability-menu#CapabilityRow', schema: z.array(capabilityRow$schema) },
      sourceLocation: { file: 'src/server/remote.ts', line: 59, column: 3 },
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
      sourceLocation: { file: 'src/server/remote.ts', line: 78, column: 3 },
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
      sourceLocation: { file: 'src/server/remote.ts', line: 84, column: 3 },
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
      sourceLocation: { file: 'src/server/remote.ts', line: 70, column: 3 },
    },
  ],
}

export default TYPERT_REMOTE
