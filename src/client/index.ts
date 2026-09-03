/**
 * ⚠️ VERIFIED AGAINST REAL rc.8 CLIENT API.
 *
 * Client (browser) registration of the 能力管理 settings tab. Follows the real
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
    /** 能力管理 tab copy. */
    'settings.capability': Record<CapabilityKey, string>
  }
}

/** Required services (cordis fiber inject). `remote.capabilityPolicy` is NOT
 *  injected: we mount it in `apply`, so declaring it would deadlock the boot
 *  ("waiting for service"). Access it via `ctx.get('remote.capabilityPolicy')`,
 *  which resolves the mounted namespace service without the inject gate. */
export const inject = ['slots', 'locale', 'remote']

/** Register the 能力管理 section once `settings.section` is on the ledger. */
export async function apply(ctx: ClientContext): Promise<() => void> {
  const zh = {
    nav: '能力管理',
    title: '能力管理',
    desc: '管理工具与技能的 常驻 / 按需 / 禁用 三档分类。',
    resident: 'Resident（常驻上下文）',
    'on-demand': 'On-demand（按需发现）',
    blocked: 'Blocked（禁用）',
    kind: '类型',
    class: '分类',
    tool: 'tool',
    skill: 'skill',
    mandatory: 'meta',
    rules: '规则',
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
    blockedShort: '禁用',
    cycleHint: '点击标签切换分类（按需 → 禁用 → 常驻）',
    notPreviewable: '该文件不是可预览的文本文件',
    previewClose: '关闭',
    detailNotFound: '未找到该工具的详情',
    cycleOverridden: '分类未生效：{count} 个能力被更高优先级规则覆盖（如通配规则），可移除对应通配规则后重试',
    viewCatalog: '查看能力目录',
    catalogPolicy: '三档策略配置',
    catalogOnDemand: '按需能力目录',
    catalogPolicyNote: '实时生成，只读；持久化入口为 cordis.patch.yml（未列出规则的能力默认常驻）',
    catalogDisabled: '按需能力目录未启用（catalogFile 为空）',
    catalogUnreadable: '按需能力目录文件读取失败',
  } satisfies Record<CapabilityKey, string>
  const en = {
    nav: 'Capability Management',
    title: 'Capability Management',
    desc: 'Manage the Resident / On-demand / Blocked classification of tools and skills.',
    resident: 'Resident',
    'on-demand': 'On-demand',
    blocked: 'Blocked',
    kind: 'kind',
    class: 'class',
    tool: 'tool',
    skill: 'skill',
    mandatory: 'meta',
    rules: 'rules',
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
    blockedShort: 'Blocked',
    cycleHint: 'Click a tag to cycle its classification (On-demand → Blocked → Resident)',
    notPreviewable: 'This file is not a previewable text file',
    previewClose: 'Close',
    detailNotFound: 'Tool detail not found',
    cycleOverridden: 'Classification not applied: {count} capability(ies) overridden by a higher-priority rule (e.g. a wildcard). Remove the matching wildcard rule and retry.',
    viewCatalog: 'View capability catalog',
    catalogPolicy: 'Policy (effective)',
    catalogOnDemand: 'On-demand catalog',
    catalogPolicyNote: 'Generated live from the effective policy (read-only); persist via cordis.patch.yml. Capabilities without a rule default to Resident.',
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
  const injected = (): CapabilitySectionInjected & { mountError?: string; remoteKeys?: string } => {
    const namespace = remote()
    const remoteKeys = namespace == null
      ? undefined
      : Object.keys(namespace).filter(k => ['getConfig', 'updateConfig', 'classifyAll'].includes(k)).join(',')
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
    disposeRemote?.()
  }
}
