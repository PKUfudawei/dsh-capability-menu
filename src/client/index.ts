/**
 * Client (browser) registration of the 能力菜单 settings tab. Follows the real
 * dsh client pattern (`dsh-client-ui-settings-plugin-inventory`): inject the
 * remote face, mount the generated `capabilityPolicy` Typert contribution, and
 * register a `settings.section` (order 12, between `models`=10 and `plugins`=15)
 * whose card renders the classification lists.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { installSettingsNavIcon } from './settings-nav-icon.ts'
import { TYPERT_REMOTE } from './remote.ts'
import { CapabilitySection, type CapabilitySectionInjected, type CapabilityKey } from './CapabilitySection.tsx'

export type { CapabilitySectionInjected, CapabilitySectionProps } from './CapabilitySection.tsx'
export type { CapabilityKey } from './CapabilitySection.tsx'
export type { CapabilityRow, CapabilitySnapshot, CapabilityPolicyRemote } from './store.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.capability'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 能力菜单 tab copy. */
    'settings.capability': Record<CapabilityKey, string>
  }
}

/** Required services (cordis fiber inject). `remote.capabilityPolicy` is NOT
 *  injected: we mount it in `apply`, so declaring it would deadlock the boot
 *  ("waiting for service"). Access it via `ctx.get('remote.capabilityPolicy')`,
 *  which resolves the mounted namespace service without the inject gate. */
export const inject = ['slots', 'locale', 'remote']

/** Register the 能力菜单 section once `settings.section` is on the ledger. */
export async function apply(ctx: ClientContext): Promise<() => void> {
  const zh = {
    nav: '能力菜单',
    title: '能力菜单',
    feedback: '反馈 ↗',
    updateAvailable: 'npm 最新版本 v{version}',
    newVersion: '有新版本',
    updateDialogTitle: '能力菜单有新版本',
    updateVersionComparison: '当前版本 v{current}，npm 最新版本 v{latest}。',
    updateNpmNote: '安装更新后，重启 DSH 生效。',
    updateLocalNote: '当前通过本地源码链接安装。你可以继续更新源码，或切换到 npm 版；源码目录不会删除。',
    updateSourceSteps: '查看源码更新步骤',
    updateSourceStepsHide: '收起源码更新步骤',
    updateSourceStepsIntro: '先处理本地未提交的改动，再在源码目录执行：',
    updateSourceStepsRestart: '完成后重启 DSH。npm 的版本号不能反映本地未发布的改动。',
    installUpdate: '安装更新',
    switchAndInstall: '切换并安装 npm 版',
    updatingPlugin: '正在更新能力菜单…',
    pluginUpdated: '更新完成，重启 DSH 后生效。',
    pluginSwitched: '已切换并安装 npm 版，重启 DSH 后生效。',
    pluginNonRegistrySource: '当前不是从 npm 仓库安装，请按原来源更新。',
    pluginProfileUnavailable: '无法确定当前 DSH profile，请使用 DSH 命令更新。',
    pluginUpdateFailed: '更新失败：',
    desc: '管理工具与技能的暴露策略与检索信息。',
    resident: 'Resident（常驻上下文）',
    'on-demand': 'On-demand（按需发现）',
    disabled: 'Disabled（禁用）',
    tool: 'tool',
    skill: 'skill',
    mandatory: 'meta',
    toolsGroup: 'Tools',
    skillsGroup: 'Skills',
    builtInGroup: '系统内置',
    globalSkills: '全局技能',
    projectSkills: '项目技能',
    presetSkills: '预设技能',
    emptyGlobalSkills: '暂无全局技能',
    emptyProjectSkills: '暂无项目技能',
    emptyPresetSkills: '暂无预设技能',
    filterByName: '按名字、分组或正则过滤…',
    filterHint: '忽略大小写。匹配工具/技能名、MCP server、技能来源标签与预设 id；也可以直接写正则，例如 cordis|ptc 或 /^mcp__dbx/。',
    filterNoMatch: '没有匹配的能力（清空过滤框可恢复完整列表）',
    emptyTools: '暂无工具',
    emptySkills: '暂无 Skill',
    toolCount: '{count} 个工具',
    residentShort: '常驻',
    onDemandShort: '按需',
    disabledShort: '禁用',
    cycleHint: '点击标签切换分类（按需 → 禁用 → 常驻）',
    notPreviewable: '该文件不是可预览的文本文件',
    previewClose: '关闭',
    markdownCode: '代码',
    markdownWrap: '自动换行',
    markdownUnwrap: '不换行',
    markdownCopy: '复制',
    markdownCopied: '已复制',
    markdownFootnotes: '脚注',
    detailNotFound: '未找到该工具的详情',
    cycleOverridden: '分类未生效：{count} 个能力被更高优先级规则覆盖（如通配规则），可移除对应通配规则后重试',
    refreshFailed: '刷新失败，请查看日志',
    mcpToolsPending: '已注册「{name}」，但暂未加载出工具。请检查连接和认证后点刷新。',
    retry: '重试',
    carrierFailureHint: '请求未到达服务端：浏览器与 dsh 之间的连接已断开（Failed to fetch 属传输层失败，服务端方法未执行）。若刚重启过 dsh web，请先硬刷新页面（Ctrl/Cmd+Shift+R）再重试。',
    registerCapability: '注册能力',
    editMcp: '编辑 MCP 服务器',
    editSkillNamed: '编辑 Skill 目录：{name}',
    edit: '编辑',
    save: '保存',
    remove: '移除',
    cancel: '取消',
    confirmRemove: '确认移除',
    confirmRemoveMcp: '移除 MCP 服务器「{name}」？其 patch 文件中的配置行（含 headers、环境变量）将被删除，mcp__{name}__* 工具随之消失。',
    confirmRemoveSkillLink: '移除 Skill「{name}」？仅删除 ~/.dsh/skills 下的软链，源目录不受影响。',
    confirmRemoveSkillDir: '移除 Skill「{name}」？该项位于 ~/.dsh/skills 下且非软链，将连同文件递归删除，且不可恢复。',
    confirmSaveAnyway: '仍然保存',
    saveConfirmRealDir: '「{name}」这个条目是真实目录、不是软链：保存会先把它连同文件递归删除，再改为指向新路径，且不可恢复。',
    register: '注册',
    notEditable: '该项未在注册表中（可能是项目技能或内置技能），无法编辑。',
    entryNotFound: '目标已不存在，可能已被移除。',
    mcpServers: 'MCP 服务器',
    skillDirs: 'Skill 目录',
    skillDirPath: '技能来源路径',
    skillRoot: '技能位置',
    skillRootUser: '全局技能（~/.dsh/skills）',
    skillRootProject: '项目技能（<项目根>/.dsh/skills）',
    skillRootHintUser: '所有会话都能看到该技能。',
    skillRootHintProject: '只对 cwd 落在该项目内的会话可见。',
    skillProjectPath: '目标项目路径',
    skillProjectPathHint: '项目内任意一个已存在的路径即可；项目根按 dsh 的规则确定（向上找最近的 .git），技能写进 <项目根>/.dsh/skills。',
    skillRegisteredAt: '已注册到 {path}',
    skillRepointed: '已改为指向 {dir}',
    skillAdopted: '已纳入管理：{path}',
    skillSource: '来源：{source}',
    skillSourceHint: '该技能由 dsh 从其它根发现，不在本插件管理的技能目录里，因此没有「编辑」。',
    skillFromPreset: '来自预设 {preset}',
    skillFromPresetHint: '该技能随 agent preset 分发，只对挂载了该预设的会话可见；不能纳入管理（那会把它软链进全局技能根，对所有会话生效）。',
    githubImporting: '正在从 GitHub 获取并校验 Skill，完成后会自动注册…',
    importing: '导入中…',
    skillUnmanaged: '未纳入管理',
    sourceCustom: '自定义技能目录',
    sourceBundled: '随 dsh 预置',
    adoptSkill: '纳入管理',
    adoptSkillHint: '仅 user-agents 与 custom 来源可纳入管理；会把它软链进 dsh 的技能根目录（默认 ~/.dsh/skills），内容不动。',
    adoptSkillTitle: '纳入管理「{name}」？',
    skillDirHint: '支持本机目录或公开 GitHub HTTPS 技能链接。GitHub 导入会校验 SKILL.md，并只保留对应技能目录；运行 dsh 的机器需安装 Git。技能名取自 SKILL.md。',
    serverName: 'serverName',
    serverNameImmutable: '名称用于工具 ID 和权限规则，注册后不可更改。',
    transport: '传输方式',
    transportStdio: 'stdio（本地子进程）',
    transportHttp: 'streamable-http（HTTP MCP 端点）',
    transportHintStdio: '由客户端将该 MCP server 作为子进程启动，JSON-RPC 报文经标准输入 / 输出交换。',
    transportHintHttp: '客户端通过支持 POST/GET 的 MCP 端点连接。',
    command: '命令',
    args: '参数（空格分隔）',
    cwd: '工作目录',
    env: '环境变量',
    url: 'URL',
    headers: '请求头',
    headersHint: '每行一个 Header，格式 Key: Value；Bearer token 等认证凭据在此填写。',
    timeout: '超时（秒）',
    timeoutInvalid: '超时须为数字，单位为秒。',
    viewCatalog: '策略与目录',
    catalogPolicy: '能力暴露规则',
    catalogOnDemand: '按需检索目录',
    catalogPolicyNote: '当前生效规则（只读）；未匹配规则的能力默认常驻。',
    catalogSearchNote: '与 meta_search 共用内存索引 · 按需能力 {count} 项',
    catalogEmpty: '当前没有按需能力。',
    editSearchMetadata: '编辑检索描述',
    searchMetadataButton: '检索描述',
    searchDescription: '检索描述',
    searchMetadataNote: '这里修改按需检索文字，不会改变能力来源的原始定义。',
    searchMetadataSave: '保存',
    searchMetadataRestore: '还原',
    searchMetadataRestoreHint: '还原为来源描述；点击保存后生效',
    searchMetadataSaved: '检索描述已保存',
    summaryLimit: '检索描述上限',
    summaryLimitUnit: '字符',
    summaryLimitInvalid: '请输入不小于 20 的整数',
    summaryLimitDisabled: '检索信息存储未启用',
    summaryLimitSaved: '检索描述上限已保存',
    diagnosticTitle: '能力诊断：{count} 项',
    diagnosticUnavailable: '不可调用：{name}（来源 {source}{preset}）',
    diagnosticShadowed: '同名覆盖：{name} 保留 {winner}，隐藏 {hidden}',
    diagnosticBroken: '损坏的 preset：{id}（{reason}；受影响技能数量由 DSH 未提供）',
    diagnosticUnbrowseable: '不可浏览：{name}（{reason}）',
    diagnosticUndocumented: '描述待补：{name}；摘要回退为「{summary}」',
    projectRootLabel: '项目根：{path}',
    skillBrowseUnavailable: '该技能没有可浏览的目录根，可能是非目录型技能来源。',
  } satisfies Record<CapabilityKey, string>
  const en = {
    nav: 'Capability Menu',
    title: 'Capability Menu',
    feedback: 'Feedback ↗',
    updateAvailable: 'Latest on npm: v{version}',
    newVersion: 'New version',
    updateDialogTitle: 'Capability Menu update available',
    updateVersionComparison: 'Current version v{current}; latest on npm v{latest}.',
    updateNpmNote: 'Restart DSH after installing the update.',
    updateLocalNote: 'This is linked to local source. You can update the source or switch this profile to the npm release. The source directory will be kept.',
    updateSourceSteps: 'Show source update steps',
    updateSourceStepsHide: 'Hide source update steps',
    updateSourceStepsIntro: 'Resolve uncommitted changes first, then run these commands in the source directory:',
    updateSourceStepsRestart: 'Restart DSH afterward. The npm version number does not account for unpublished local changes.',
    installUpdate: 'Install update',
    switchAndInstall: 'Switch and install npm release',
    updatingPlugin: 'Updating Capability Menu…',
    pluginUpdated: 'Update complete. Restart DSH to apply it.',
    pluginSwitched: 'Switched to the npm release. Restart DSH to apply it.',
    pluginNonRegistrySource: 'This is not an npm registry install. Update it from its original source.',
    pluginProfileUnavailable: 'Cannot identify the active DSH profile. Update with the DSH CLI.',
    pluginUpdateFailed: 'Update failed:',
    desc: 'Manage exposure rules and search information for tools and skills.',
    resident: 'Resident',
    'on-demand': 'On-demand',
    disabled: 'Disabled',
    tool: 'tool',
    skill: 'skill',
    mandatory: 'meta',
    toolsGroup: 'Tools',
    skillsGroup: 'Skills',
    builtInGroup: 'System built-in',
    globalSkills: 'Global skills',
    projectSkills: 'Project skills',
    presetSkills: 'Preset skills',
    emptyGlobalSkills: 'No global skills',
    emptyProjectSkills: 'No project skills',
    emptyPresetSkills: 'No preset skills',
    filterByName: 'Filter by name, group, or regex…',
    filterHint: 'Case-insensitive. Matches tool/skill names, MCP servers, skill source labels and preset ids; a regular expression works too, e.g. cordis|ptc or /^mcp__dbx/.',
    filterNoMatch: 'No capability matches (clear the filter to see the full list)',
    emptyTools: 'No tools',
    emptySkills: 'No skills',
    toolCount: '{count} tools',
    residentShort: 'Resident',
    onDemandShort: 'On-demand',
    disabledShort: 'Disabled',
    cycleHint: 'Click a tag to cycle its classification (On-demand → Disabled → Resident)',
    notPreviewable: 'This file is not a previewable text file',
    previewClose: 'Close',
    markdownCode: 'Code',
    markdownWrap: 'Wrap',
    markdownUnwrap: 'Unwrap',
    markdownCopy: 'Copy',
    markdownCopied: 'Copied',
    markdownFootnotes: 'Footnotes',
    detailNotFound: 'Tool detail not found',
    cycleOverridden: 'Classification not applied: {count} capability(ies) overridden by a higher-priority rule (e.g. a wildcard). Remove the matching wildcard rule and retry.',
    refreshFailed: 'Refresh failed; see the log',
    mcpToolsPending: '"{name}" is registered, but its tools have not loaded yet. Check its connection and authentication, then refresh.',
    retry: 'Retry',
    carrierFailureHint: 'The request never reached the server: the browser connection to dsh is broken ("Failed to fetch" is a transport failure, so no server method ran). If dsh web was just restarted, hard-refresh the page (Ctrl/Cmd+Shift+R) and retry.',
    registerCapability: 'Register',
    editMcp: 'Edit MCP server',
    editSkillNamed: 'Edit skill directory: {name}',
    edit: 'Edit',
    save: 'Save',
    remove: 'Remove',
    cancel: 'Cancel',
    confirmRemove: 'Confirm removal',
    confirmRemoveMcp: 'Remove the MCP server "{name}"? Its config row in the patch file (headers and environment included) is deleted, and the mcp__{name}__* tools disappear with it.',
    confirmRemoveSkillLink: 'Unregister the skill "{name}"? Only the symlink under ~/.dsh/skills is removed; the source directory is left untouched.',
    confirmRemoveSkillDir: 'Remove the skill "{name}"? It sits under ~/.dsh/skills and is not a symlink, so it will be deleted recursively with all of its files. This cannot be undone.',
    confirmSaveAnyway: 'Save anyway',
    saveConfirmRealDir: 'The entry "{name}" is a real directory, not a symlink: saving deletes it and its files recursively before repointing it, and that cannot be undone.',
    register: 'Register',
    notEditable: 'This entry is not in the registry (a project or bundled skill), so it cannot be edited.',
    entryNotFound: 'The target no longer exists; it may have been removed.',
    mcpServers: 'MCP servers',
    skillDirs: 'Skill directories',
    skillDirPath: 'Skill source path',
    skillRoot: 'Skill location',
    skillRootUser: 'Global (~/.dsh/skills)',
    skillRootProject: 'Project (<projectRoot>/.dsh/skills)',
    skillRootHintUser: 'Visible to every session.',
    skillRootHintProject: 'Visible only to sessions whose cwd sits inside that project.',
    skillProjectPath: 'Target project path',
    skillProjectPathHint: 'Any existing path inside the project; the project root is derived the way dsh derives it (nearest .git above it) and the skill is written under <projectRoot>/.dsh/skills.',
    skillRegisteredAt: 'Registered at {path}',
    skillRepointed: 'Repointed to {dir}',
    skillAdopted: 'Adopted: {path}',
    skillSource: 'Source: {source}',
    skillSourceHint: 'dsh found this skill in another root, not in a skill directory this plugin manages, so there is no Edit button.',
    skillFromPreset: 'From preset {preset}',
    skillFromPresetHint: 'This skill ships with an agent preset and is visible only to sessions that mount it. It cannot be adopted (adopting would link it into the global skill root, making it apply to every session).',
    githubImporting: 'Fetching and validating the Skill from GitHub… It will register automatically when complete.',
    importing: 'Importing…',
    skillUnmanaged: 'Not managed here',
    sourceCustom: 'custom skill dirs',
    sourceBundled: 'bundled with dsh',
    adoptSkill: 'Adopt',
    adoptSkillHint: "Only user-agents and custom sources can be adopted. This links it into dsh's skill root (default ~/.dsh/skills); the content is untouched.",
    adoptSkillTitle: 'Adopt "{name}"?',
    skillDirHint: 'Enter a local directory or a public GitHub HTTPS skill URL. Imports validate SKILL.md and keep only the selected skill directory. Git must be installed on the machine running dsh. The skill name comes from SKILL.md.',
    serverName: 'serverName',
    serverNameImmutable: 'The name is locked after registration because tool IDs and permission rules use it.',
    transport: 'Transport',
    transportStdio: 'stdio (local subprocess)',
    transportHttp: 'streamable-http (HTTP MCP endpoint)',
    transportHintStdio: 'The client launches the MCP server as a subprocess and exchanges JSON-RPC messages over its standard input and output.',
    transportHintHttp: 'Connect through the MCP endpoint URL (supports POST and GET).',
    command: 'Command',
    args: 'Args (space separated)',
    cwd: 'Working directory',
    env: 'Environment',
    url: 'URL',
    headers: 'Headers',
    headersHint: 'One header per line as Key: Value; credentials such as a Bearer token go here.',
    timeout: 'Timeout (seconds)',
    timeoutInvalid: 'Timeout must be a number of seconds.',
    viewCatalog: 'Policy & catalog',
    catalogPolicy: 'Exposure rules',
    catalogOnDemand: 'On-demand search catalog',
    catalogPolicyNote: 'Effective rules (read only). Unmatched capabilities default to Resident.',
    catalogSearchNote: 'Shared in-memory index with meta_search · {count} On-demand capabilities',
    catalogEmpty: 'No On-demand capabilities.',
    editSearchMetadata: 'Edit search description',
    searchMetadataButton: 'Search description',
    searchDescription: 'Search description',
    searchMetadataNote: 'This changes the on-demand search text, not the provider definition.',
    searchMetadataSave: 'Save',
    searchMetadataRestore: 'Restore',
    searchMetadataRestoreHint: 'Restore the provider description; save to apply',
    searchMetadataSaved: 'Search description saved',
    summaryLimit: 'Search description limit',
    summaryLimitUnit: 'characters',
    summaryLimitInvalid: 'Enter an integer of at least 20',
    summaryLimitDisabled: 'Search information storage is disabled',
    summaryLimitSaved: 'Search description limit saved',
    diagnosticTitle: 'Capability diagnostics: {count} items',
    diagnosticUnavailable: 'Not invocable: {name} (source {source}{preset})',
    diagnosticShadowed: 'Name collision: {name} keeps {winner}; hidden from {hidden}',
    diagnosticBroken: 'Broken preset: {id} ({reason}; DSH does not provide the affected skill count)',
    diagnosticUnbrowseable: 'Cannot browse: {name} ({reason})',
    diagnosticUndocumented: 'Description needed: {name}; search summary falls back to “{summary}”.',
    projectRootLabel: 'Project root: {path}',
    skillBrowseUnavailable: 'This Skill has no browsable directory root; its provider may be non-filesystem based.',
  } satisfies Record<CapabilityKey, string>

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'capability-menu: dictionaries')

  // Mount the Host `capabilityPolicy` remote contribution so
  // `ctx.remote.capabilityPolicy` exists in this fiber. `$mount` runs the
  // contribution through an async effect that can fail silently; surface any
  // failure here instead of crashing the settings section later.
  let mountError: string | undefined
  let disposeRemote: (() => Promise<void>) | undefined
  try {
    disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  } catch (error) {
    mountError = String(error)
    console.error('[capability-menu] $mount failed:', error)
  }
  const t = ctx.locale.bind(NS) as CapabilitySectionInjected['t']
  installSettingsNavIcon(ctx, () => t('nav'))
  const remote = (): unknown => {
    try {
      // Resolve the mounted namespace service by its registered key; a property
      // access (`ctx.remote.capabilityPolicy`) would hit the "without inject"
      // gate because the namespace is mounted by this plugin, not injected.
      return (ctx.get as (key: string) => unknown)('remote.capabilityPolicy')
    } catch (error) {
      console.error('[capability-menu] ctx.get("remote.capabilityPolicy") failed:', error)
      return undefined
    }
  }
  /**
   * The two signals that say "the host catalog may have moved, and this page did
   * not ask": a settings document edit, and a carrier reconnect.
   *
   * `settings/document-updated` is one of the events dsh forwards to browsers
   * (so it arrives over the same validated channel as the remote calls) and it
   * fires for external edits too — composition files are edited outside the
   * browser, and nothing else on the wire announces that. `connection/reset` is
   * the client's own reconnect signal rather than a forwarded one, which is why
   * it is a plain local `ctx.on`; dsh's own settings sections listen to exactly
   * this pair, including the first connection, which closes the window where a
   * change lands between the initial read and the subscription.
   *
   * Neither subscription is fatal: the section falls back to its version poll.
   */
  const subscribeSignals = (listener: () => void): (() => void) => {
    const disposers: Array<() => void> = []
    // `$on` is typed against the host's forwarded-event allowlist, and the
    // Cordis `Events` seat that makes a key legal lives in
    // `@deepseek-ai/dsh-settings` — a host package this plugin does not depend
    // on (it hand-mirrors the host faces it needs instead). The runtime method
    // is verified against the shipped gateway:
    // `$on(event, listener) { return this.events.subscribe(this.ctx, event, listener) }`.
    // So reach it through one narrow cast rather than adding a host package to
    // the manifest for a single event name.
    const forwarded = ctx.remote as unknown as {
      $on?: (event: string, listener: () => void) => () => void
    }
    try {
      if (typeof forwarded.$on !== 'function') throw new Error('ctx.remote.$on is unavailable')
      disposers.push(forwarded.$on('settings/document-updated', () => listener()))
    } catch (error) {
      console.error('[capability-menu] settings/document-updated subscription failed:', error)
    }
    try {
      disposers.push(ctx.on('connection/reset', () => listener()))
    } catch (error) {
      console.error('[capability-menu] connection/reset subscription failed:', error)
    }
    return () => {
      for (const dispose of disposers) dispose()
    }
  }

  const injected = (): CapabilitySectionInjected => {
    // Resolve by key rather than by property access: `ctx.remote.capabilityPolicy`
    // would hit the "without inject" gate, since this plugin mounts the namespace
    // itself instead of injecting it.
    return {
      remote: remote() as CapabilitySectionInjected['remote'],
      t,
      subscribeSignals,
      ...mountError !== undefined ? { mountError } : {},
    }
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'capability',
    order: 12,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, CapabilitySection))

  return () => {
    disposeRemote?.()
  }
}
