window.__ModuleLoader__.load({ id: "@daweifu/capability-menu", factory: (require) => {
var module = { exports: {} };
var exports = module.exports;

import { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
//#region src/client/store.d.ts
/**
 * ⚠️ VERIFIED AGAINST REAL rc.8 CLIENT API.
 *
 * Types + small helpers for the 能力菜单 (Capability Menu) settings
 * section. The component reads/writes the Host `ctx.capabilityPolicy` through
 * the generated `remote.capabilityPolicy` face (see `./remote.ts`), mirroring
 * how `dsh-client-ui-settings-plugin-inventory` consumes
 * `ctx.remote.pluginInventory`.
 */
/** One capability's Exposed/Progressive/Blocked row, as surfaced by the server. */
interface CapabilityRow {
  readonly id: string;
  readonly kind: 'tool' | 'skill';
  readonly name: string;
  readonly server?: string;
  readonly class: 'exposed' | 'progressive' | 'blocked';
  /** Human-friendly display: `Exposed · 常驻（直接调用）` / `Progressive · 按需（目录渐进加载）` / `Blocked · 禁用`. */
  readonly classLabel?: string;
  readonly mandatory: boolean;
}
/** Snapshot of the management surface. */
interface CapabilitySnapshot {
  readonly rows: readonly CapabilityRow[];
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
/** MCP server definition for a registered location (mcp-client config shape). */
interface McpLocationConfig {
  readonly serverName: string;
  readonly transport: 'stdio' | 'streamable-http';
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
}
/** Skill directory definition for a registered location. */
interface SkillLocationConfig {
  readonly dir: string;
}
/** One registered location (position reference + enable state) as surfaced by the server. */
interface CapabilityLocation {
  readonly id: string;
  readonly type: 'mcp' | 'skill';
  readonly name: string;
  readonly enabled: boolean;
  /** Last mount failure message; present only after a failed MCP mount. */
  readonly error?: string;
  readonly mcp?: McpLocationConfig;
  readonly skill?: SkillLocationConfig;
}
/** Payload accepted by `addLocation`. */
interface AddLocationPayload {
  readonly type: 'mcp' | 'skill';
  readonly mcp?: McpLocationConfig;
  readonly skill?: SkillLocationConfig;
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
  listLocations(): Promise<{
    ok: true;
    value: CapabilityLocation[];
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  addLocation(payload: AddLocationPayload): Promise<{
    ok: true;
    value: CapabilityLocation | undefined;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  removeLocation(id: string): Promise<{
    ok: true;
    value: void;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  setLocationEnabled(id: string, enabled: boolean): Promise<{
    ok: true;
    value: void;
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
type CapabilityKey = 'nav' | 'title' | 'desc' | 'exposed' | 'progressive' | 'blocked' | 'kind' | 'class' | 'tool' | 'skill' | 'mandatory' | 'rules' | 'toolsGroup' | 'skillsGroup' | 'emptyTools' | 'emptySkills' | 'toolCount' | 'exposedShort' | 'progressiveShort' | 'blockedShort' | 'cycleHint' | 'notPreviewable' | 'previewClose' | 'detailNotFound' | 'cycleOverridden' | 'registered' | 'registeredHint' | 'addMcp' | 'addSkill' | 'enable' | 'disable' | 'enabledShort' | 'disabledShort' | 'remove' | 'removeConfirm' | 'mountFailed' | 'serverName' | 'transport' | 'command' | 'args' | 'env' | 'headers' | 'url' | 'dir' | 'add' | 'cancel' | 'locFormError';
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