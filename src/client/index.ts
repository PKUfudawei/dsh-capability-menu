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
    desc: '管理 MCP / Skill 的 启用 / 渐进 / 隐藏 三档分类。',
    exposed: 'Exposed（常驻上下文）',
    progressive: 'Progressive（按需发现）',
    blocked: 'Blocked（禁用）',
    kind: '类型',
    class: '分类',
    tool: 'tool',
    skill: 'skill',
    mandatory: 'meta',
    rules: '规则',
    toolsGroup: 'MCP tools',
    skillsGroup: 'Skills',
    emptyTools: '暂无 MCP 工具',
    emptySkills: '暂无 Skill',
    toolCount: '{count} 个工具',
    exposedShort: '启用',
    progressiveShort: '渐进',
    blockedShort: '隐藏',
    cycleHint: '点击标签切换分类（渐进 → 隐藏 → 启用）',
    notPreviewable: '该文件不是可预览的文本文件',
    previewClose: '关闭',
    detailNotFound: '未找到该工具的详情',
    cycleOverridden: '分类未生效：{count} 个能力被更高优先级规则覆盖（如通配规则），可移除对应通配规则后重试',
    registered: '已登记位置',
    registeredHint: '尚未登记任何位置；点击「添加」登记一个 MCP 服务器或 Skill 目录。',
    addMcp: '添加 MCP 服务器',
    addSkill: '添加 Skill 目录',
    enable: '启用',
    disable: '停用',
    enabledShort: '已启用',
    disabledShort: '已停用',
    remove: '删除',
    removeConfirm: '确定删除该位置？启用的能力将一并卸载。',
    mountFailed: '装载失败',
    serverName: '服务器名',
    transport: '传输方式',
    command: '命令',
    args: '参数（每行一个）',
    env: '环境变量（每行 KEY=value）',
    headers: '请求头（每行 Key: value）',
    url: 'URL',
    dir: '目录路径',
    add: '添加',
    cancel: '取消',
    locFormError: '表单有误',
  } satisfies Record<CapabilityKey, string>
  const en = {
    nav: 'Capability Menu',
    title: 'Capability Menu',
    desc: 'Manage the Enabled / Progressive / Hidden classification of MCP tools and skills.',
    exposed: 'Exposed (context-resident)',
    progressive: 'Progressive (on-demand)',
    blocked: 'Blocked (forbidden)',
    kind: 'kind',
    class: 'class',
    tool: 'tool',
    skill: 'skill',
    mandatory: 'meta',
    rules: 'rules',
    toolsGroup: 'MCP tools',
    skillsGroup: 'Skills',
    emptyTools: 'No MCP tools',
    emptySkills: 'No skills',
    toolCount: '{count} tools',
    exposedShort: 'Enabled',
    progressiveShort: 'Progressive',
    blockedShort: 'Hidden',
    cycleHint: 'Click a tag to cycle its classification (Progressive → Hidden → Enabled)',
    notPreviewable: 'This file is not a previewable text file',
    previewClose: 'Close',
    detailNotFound: 'Tool detail not found',
    cycleOverridden: 'Classification not applied: {count} capability(ies) overridden by a higher-priority rule (e.g. a wildcard). Remove the matching wildcard rule and retry.',
    registered: 'Registered locations',
    registeredHint: 'No locations registered yet; click "Add" to register an MCP server or skill directory.',
    addMcp: 'Add MCP server',
    addSkill: 'Add skill directory',
    enable: 'Enable',
    disable: 'Disable',
    enabledShort: 'Enabled',
    disabledShort: 'Disabled',
    remove: 'Remove',
    removeConfirm: 'Remove this location? Its mounted capabilities unmount with it.',
    mountFailed: 'Mount failed',
    serverName: 'Server name',
    transport: 'Transport',
    command: 'Command',
    args: 'Arguments (one per line)',
    env: 'Environment (KEY=value per line)',
    headers: 'Headers (Key: value per line)',
    url: 'URL',
    dir: 'Directory path',
    add: 'Add',
    cancel: 'Cancel',
    locFormError: 'Invalid form',
  } satisfies Record<CapabilityKey, string>

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'capability-menu-web: dictionaries')

  // Mount the Host `capabilityPolicy` remote contribution so
  // `ctx.remote.capabilityPolicy` exists in this fiber. `$mount` runs the
  // contribution through an async effect that can fail silently; surface any
  // failure here instead of crashing the settings section later.
  let mountError: string | undefined
  try {
    await ctx.remote.$mount(TYPERT_REMOTE)
  } catch (error) {
    mountError = String(error)
    console.error('[capability-menu-web] $mount failed:', error)
  }
  const t = ctx.locale.bind(NS) as CapabilitySectionInjected['t']
  const remote = (): unknown => {
    try {
      // Resolve the mounted namespace service by its registered key; a property
      // access (`ctx.remote.capabilityPolicy`) would hit the "without inject"
      // gate because the namespace is mounted by this plugin, not injected.
      return (ctx.get as (key: string) => unknown)('remote.capabilityPolicy')
    } catch (error) {
      console.error('[capability-menu-web] ctx.get("remote.capabilityPolicy") failed:', error)
      return undefined
    }
  }
  const injected = (): CapabilitySectionInjected & { mountError?: string; remoteKeys?: string } => {
    const namespace = remote()
    const remoteKeys = namespace === undefined || namespace === null
      ? undefined
      : Object.keys(namespace).join(',')
    return {
      remote: namespace as CapabilitySectionInjected['remote'],
      t,
      ...mountError !== undefined ? { mountError } : {},
      ...remoteKeys !== undefined ? { remoteKeys } : {},
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
    // The locale dictionary (ctx.effect) and the slots registration dispose
    // with the fiber; the mounted remote namespace has no client-side unmount.
  }
}
