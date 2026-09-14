window.__ModuleLoader__.load({ id: "@daweifu/capability-menu", factory: (require) => {
var module = { exports: {} };
var exports = module.exports;

import { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
//#region src/client/remote.d.ts
/** Read-only row: one capability's Resident/On-demand/Disabled classification. */
interface CapabilityRow {
  readonly id: string;
  readonly kind: 'tool' | 'skill';
  readonly name: string;
  readonly server?: string;
  /** Skill source root label (`project-dsh`/`user-agents`/…), present only for skills. */
  readonly source?: string;
  readonly class: 'resident' | 'on-demand' | 'disabled';
  readonly classLabel?: string;
  readonly mandatory: boolean;
}
/** 能力目录查看负载：两份只读「文件」+ 缺失原因。 */
interface CatalogDocs {
  /** 当前生效的三档策略配置 YAML。 */
  readonly policyYaml: string;
  /** 按需能力目录物化文件（path + content）。 */
  readonly catalog?: {
    readonly path: string;
    readonly content: string;
  };
  /** catalog 不可用原因：'disabled' = 物化未启用；'read-failed' = 读盘失败。 */
  readonly catalogMissing?: 'disabled' | 'read-failed';
}
/** One direct child in a skill directory listing. */
interface SkillFileEntry {
  readonly name: string;
  readonly type: 'file' | 'directory';
}
/** Full detail projection of one capability (schema, description, stats). */
interface ToolDetail {
  readonly id: string;
  readonly kind: 'tool' | 'skill';
  readonly actions: readonly string[];
  readonly name: string;
  readonly description: string;
  readonly whenToUse?: string;
  readonly parameters: Record<string, unknown>;
  readonly output?: Record<string, unknown>;
  readonly origin: {
    readonly provider: string;
    readonly serverName?: string;
    readonly path?: string;
    readonly source?: string;
  };
  readonly tags: readonly string[];
  readonly stats: {
    readonly uses: number;
    readonly successes: number;
    readonly failures: number;
    readonly totalMs: number;
    readonly lastUsedAt?: number;
  };
}
/** One MCP server declared in the patch file. */
interface McpLocation {
  readonly id: string;
  readonly serverName: string;
  readonly transport: 'stdio' | 'streamable-http';
  readonly disabled: boolean;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
}
/** One skill directory registered under the default skill root. */
interface SkillLocation {
  readonly name: string;
  readonly path: string;
  readonly linked: boolean;
  readonly valid: boolean;
}
/** Input for registering a new MCP server. */
interface McpInput {
  readonly serverName: string;
  readonly transport: 'stdio' | 'streamable-http';
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$6361706162696c697479506f6c696379 {
    getConfig: () => Promise<RemoteResult<Record<string, unknown>>>;
    updateConfig: (partial: Record<string, unknown>) => Promise<RemoteResult<void>>;
    classifyAll: () => Promise<RemoteResult<CapabilityRow[]>>;
    refresh: () => Promise<RemoteResult<void>>;
    listSkillDir: (id: string, relPath?: string) => Promise<RemoteResult<SkillFileEntry[] | undefined>>;
    readSkillFile: (id: string, relPath: string) => Promise<RemoteResult<string | undefined>>;
    getDetail: (id: string) => Promise<RemoteResult<ToolDetail | undefined>>;
    getCatalogDocs: () => Promise<RemoteResult<CatalogDocs>>;
    listLocations: () => Promise<RemoteResult<McpLocation[]>>;
    addLocation: (input: McpInput) => Promise<RemoteResult<string>>;
    removeLocation: (id: string) => Promise<RemoteResult<boolean>>;
    setLocationEnabled: (id: string, enabled: boolean) => Promise<RemoteResult<boolean>>;
    listSkillLocations: () => Promise<RemoteResult<SkillLocation[]>>;
    addSkillLocation: (dir: string) => Promise<RemoteResult<string>>;
    removeSkillLocation: (name: string) => Promise<RemoteResult<boolean>>;
  }
  interface TypertRemoteMap {
    'capabilityPolicy/getConfig': () => Promise<RemoteResult<Record<string, unknown>>>;
    'capabilityPolicy/updateConfig': (partial: Record<string, unknown>) => Promise<RemoteResult<void>>;
    'capabilityPolicy/classifyAll': () => Promise<RemoteResult<CapabilityRow[]>>;
    'capabilityPolicy/refresh': () => Promise<RemoteResult<void>>;
    'capabilityPolicy/listSkillDir': (id: string, relPath?: string) => Promise<RemoteResult<SkillFileEntry[] | undefined>>;
    'capabilityPolicy/readSkillFile': (id: string, relPath: string) => Promise<RemoteResult<string | undefined>>;
    'capabilityPolicy/getDetail': (id: string) => Promise<RemoteResult<ToolDetail | undefined>>;
    'capabilityPolicy/getCatalogDocs': () => Promise<RemoteResult<CatalogDocs>>;
    'capabilityPolicy/listLocations': () => Promise<RemoteResult<McpLocation[]>>;
    'capabilityPolicy/addLocation': (input: McpInput) => Promise<RemoteResult<string>>;
    'capabilityPolicy/removeLocation': (id: string) => Promise<RemoteResult<boolean>>;
    'capabilityPolicy/setLocationEnabled': (id: string, enabled: boolean) => Promise<RemoteResult<boolean>>;
    'capabilityPolicy/listSkillLocations': () => Promise<RemoteResult<SkillLocation[]>>;
    'capabilityPolicy/addSkillLocation': (dir: string) => Promise<RemoteResult<string>>;
    'capabilityPolicy/removeSkillLocation': (name: string) => Promise<RemoteResult<boolean>>;
  }
  interface TypertRemoteNamespaceMap {
    'capabilityPolicy': TypertRemoteNamespace$6361706162696c697479506f6c696379;
  }
}
//#endregion
//#region src/client/store.d.ts
/** Snapshot of the management surface. */
interface CapabilitySnapshot {
  readonly rows: readonly CapabilityRow[];
}
/** The Host `capabilityPolicy` remote face (generated contribution). */
interface CapabilityPolicyRemote {
  getConfig(): Promise<{
    ok: true;
    value: Record<string, unknown>;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  updateConfig(partial: Record<string, unknown>): Promise<{
    ok: true;
    value: void;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  classifyAll(): Promise<{
    ok: true;
    value: CapabilityRow[];
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  refresh(): Promise<{
    ok: true;
    value: void;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  listSkillDir(id: string, relPath?: string): Promise<{
    ok: true;
    value: SkillFileEntry[] | undefined;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  readSkillFile(id: string, relPath: string): Promise<{
    ok: true;
    value: string | undefined;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  getDetail(id: string): Promise<{
    ok: true;
    value: ToolDetail | undefined;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  getCatalogDocs(): Promise<{
    ok: true;
    value: CatalogDocs;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  listLocations(): Promise<{
    ok: true;
    value: McpLocation[];
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  addLocation(input: McpInput): Promise<{
    ok: true;
    value: string;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  removeLocation(id: string): Promise<{
    ok: true;
    value: boolean;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  setLocationEnabled(id: string, enabled: boolean): Promise<{
    ok: true;
    value: boolean;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  listSkillLocations(): Promise<{
    ok: true;
    value: SkillLocation[];
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  addSkillLocation(dir: string): Promise<{
    ok: true;
    value: string;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  removeSkillLocation(name: string): Promise<{
    ok: true;
    value: boolean;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
}
//#endregion
//#region src/client/CapabilitySection.d.ts
/** Props injected by the settings.section registration (see index.ts). */
interface CapabilitySectionInjected {
  remote: CapabilityPolicyRemote;
  t(key: CapabilityKey, params?: Record<string, unknown>): string;
  /** Diagnostic: `$mount` failure surfaced instead of crashing the section. */
  mountError?: string;
  /** Diagnostic: namespace methods actually installed on `ctx.remote.capabilityPolicy`. */
  remoteKeys?: string;
}
type CapabilitySectionProps = CapabilitySectionInjected;
type CapabilityKey = 'nav' | 'title' | 'desc' | 'resident' | 'on-demand' | 'disabled' | 'kind' | 'class' | 'tool' | 'skill' | 'mandatory' | 'rules' | 'toolsGroup' | 'skillsGroup' | 'builtInGroup' | 'globalSkills' | 'projectSkills' | 'emptyTools' | 'emptySkills' | 'emptyGlobalSkills' | 'emptyProjectSkills' | 'toolCount' | 'residentShort' | 'onDemandShort' | 'disabledShort' | 'cycleHint' | 'notPreviewable' | 'previewClose' | 'detailNotFound' | 'cycleOverridden' | 'refresh' | 'refreshing' | 'refreshFailed' | 'locations' | 'mcpServers' | 'emptyMcp' | 'serverName' | 'transport' | 'command' | 'args' | 'url' | 'add' | 'cancel' | 'addMcp' | 'skillDirs' | 'emptySkillDirs' | 'noManifest' | 'skillDirPath' | 'addSkill' | 'remove' | 'enable' | 'disable' | 'viewCatalog' | 'catalogPolicy' | 'catalogOnDemand' | 'catalogPolicyNote' | 'catalogDisabled' | 'catalogUnreadable';
//#endregion
//#region src/client/index.d.ts
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 能力菜单 tab copy. */
    'settings.capability': Record<CapabilityKey, string>;
  }
}
/** Required services (cordis fiber inject). `remote.capabilityPolicy` is NOT
 *  injected: we mount it in `apply`, so declaring it would deadlock the boot
 *  ("waiting for service"). Access it via `ctx.get('remote.capabilityPolicy')`,
 *  which resolves the mounted namespace service without the inject gate. */
declare const inject: string[];
/** Register the 能力菜单 section once `settings.section` is on the ledger. */
declare function apply(ctx: ClientContext): Promise<() => void>;
//#endregion
export { type CapabilityKey, type CapabilityPolicyRemote, type CapabilityRow, type CapabilitySectionInjected, type CapabilitySectionProps, type CapabilitySnapshot, apply, inject };

return module.exports;
}});
//# sourceMappingURL=client.d.ts.map