/**
 * ⚠️ VERIFIED AGAINST REAL rc.8 CLIENT API.
 *
 * Client (browser) registration of the 能力菜单 settings tab. Follows the real
 * dsh client pattern (`dsh-client-ui-settings-plugin-inventory`): inject the
 * remote face, mount the generated `capabilityPolicy` Typert contribution, and
 * register a `settings.section` (order 12, between `models`=10 and `plugins`=15)
 * whose card renders the classification lists.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
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
    desc: '管理工具与技能的 常驻 / 按需 / 禁用 三档分类。',
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
    emptyGlobalSkills: '暂无全局技能',
    emptyProjectSkills: '暂无项目技能',
    emptyTools: '暂无工具',
    emptySkills: '暂无 Skill',
    toolCount: '{count} 个工具',
    residentShort: '常驻',
    onDemandShort: '按需',
    disabledShort: '禁用',
    cycleHint: '点击标签切换分类（按需 → 禁用 → 常驻）',
    notPreviewable: '该文件不是可预览的文本文件',
    previewClose: '关闭',
    detailNotFound: '未找到该工具的详情',
    cycleOverridden: '分类未生效：{count} 个能力被更高优先级规则覆盖（如通配规则），可移除对应通配规则后重试',
    refresh: '刷新',
    refreshing: '刷新中…',
    refreshFailed: '刷新失败，请查看日志',
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
    skillUnmanaged: '未纳入管理',
    sourceCustom: '自定义技能目录',
    sourceBundled: '随 dsh 预置',
    adoptSkill: '纳入管理',
    adoptSkillHint: '把它软链进 dsh 的技能根目录（默认 ~/.dsh/skills），内容不动；之后就能编辑与移除了。',
    adoptSkillTitle: '纳入管理「{name}」？',
    skillDirHint: '目录内需有 SKILL.md（按 dsh 的 skill 格式校验）。技能名以 SKILL.md 里声明的为准，目录名只决定注册后的软链名，两者不同也可以。',
    serverName: 'serverName',
    serverNameImmutable: 'serverName 不可修改：它构成工具名前缀 mcp__<serverName>__<tool>，并已被既有会话历史与权限规则引用；修改后这些记录将不再匹配。',
    transport: '传输方式',
    transportStdio: 'stdio（本地子进程）',
    transportHttp: 'streamable-http（HTTP MCP 端点）',
    transportHintStdio: '由客户端将该 MCP server 作为子进程启动，JSON-RPC 报文经标准输入 / 输出交换。',
    transportHintHttp: '该 MCP server 作为独立进程运行，可服务多个客户端连接；客户端经单个支持 POST / GET 的 HTTP 端点（MCP endpoint）与其通信。',
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
    catalogPolicy: '三档策略配置',
    catalogOnDemand: '按需能力目录',
    catalogPolicyNote: '实时生成；点选改动会在停手后自动写回 cordis.patch.yml（未列出规则的能力默认常驻）',
    catalogDisabled: '按需能力目录未启用（catalogFile 为空）',
    catalogUnreadable: '按需能力目录文件读取失败',
  } satisfies Record<CapabilityKey, string>
  const en = {
    nav: 'Capability Management',
    title: 'Capability Management',
    desc: 'Manage the Resident / On-demand / Disabled classification of tools and skills.',
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
    emptyGlobalSkills: 'No global skills',
    emptyProjectSkills: 'No project skills',
    emptyTools: 'No tools',
    emptySkills: 'No skills',
    toolCount: '{count} tools',
    residentShort: 'Resident',
    onDemandShort: 'On-demand',
    disabledShort: 'Disabled',
    cycleHint: 'Click a tag to cycle its classification (On-demand → Disabled → Resident)',
    notPreviewable: 'This file is not a previewable text file',
    previewClose: 'Close',
    detailNotFound: 'Tool detail not found',
    cycleOverridden: 'Classification not applied: {count} capability(ies) overridden by a higher-priority rule (e.g. a wildcard). Remove the matching wildcard rule and retry.',
    refresh: 'Refresh',
    refreshing: 'Refreshing…',
    refreshFailed: 'Refresh failed; see the log',
    retry: 'Retry',
    carrierFailureHint: 'The request never reached the server: the browser connection to dsh is broken ("Failed to fetch" is a transport failure, so no server method ran). If dsh web was just restarted, hard-refresh the page (Ctrl/Cmd+Shift+R) and retry.',
    registerCapability: 'Register capability',
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
    skillUnmanaged: 'Not managed here',
    sourceCustom: 'custom skill dirs',
    sourceBundled: 'bundled with dsh',
    adoptSkill: 'Adopt',
    adoptSkillHint: "Link it into dsh's skill root (default ~/.dsh/skills); the content is untouched, and it becomes editable and removable.",
    adoptSkillTitle: 'Adopt "{name}"?',
    skillDirHint: 'The directory must hold a SKILL.md in dsh\'s skill format. The skill name is the one declared in SKILL.md; the directory name only names the link this registers, so the two may differ.',
    serverName: 'serverName',
    serverNameImmutable: 'serverName is immutable: it forms the tool name prefix mcp__<serverName>__<tool> and is referenced by existing session history and permission rules, which stop matching once it changes.',
    transport: 'Transport',
    transportStdio: 'stdio (local subprocess)',
    transportHttp: 'streamable-http (HTTP MCP endpoint)',
    transportHintStdio: 'The client launches the MCP server as a subprocess and exchanges JSON-RPC messages over its standard input and output.',
    transportHintHttp: 'The server runs as an independent process that can handle multiple client connections; the client reaches it over a single HTTP endpoint (the MCP endpoint) supporting POST and GET.',
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
    catalogPolicy: 'Policy (effective)',
    catalogOnDemand: 'On-demand catalog',
    catalogPolicyNote: 'Generated live from the effective policy; clicked changes are written back to cordis.patch.yml once you stop. Capabilities without a rule default to Resident.',
    catalogDisabled: 'On-demand catalog emission is disabled (catalogFile is empty).',
    catalogUnreadable: 'Failed to read the on-demand catalog file.',
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
  const injected = (): CapabilitySectionInjected => {
    // Resolve by key rather than by property access: `ctx.remote.capabilityPolicy`
    // would hit the "without inject" gate, since this plugin mounts the namespace
    // itself instead of injecting it.
    return {
      remote: remote() as CapabilitySectionInjected['remote'],
      t,
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
