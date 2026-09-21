/**
 * ⚠️ VERIFIED AGAINST REAL rc.8 CLIENT API.
 *
 * React section for the 能力菜单 settings tab. Follows the real dsh client
 * pattern (see `dsh-client-ui-settings-plugins`): two tabs (工具 / Skills)
 * under one heading, each listing capabilities with a clickable class chip.
 *
 * Layout:
 *   - summary strip   → per-class counts for the active tab (Skills tab counts
 *                       its active 全局/项目 sub-tab)
 *   - tabs            → Tools | Skills (plugins-tab chrome)
 *   - Tools tab       → grouped by server, collapsible disclosure rows; the
 *                       per-class count chip and each tool's class chip are
 *                       clickable to cycle Resident → On-demand → Disabled.
 *                       Harness-native tools (no real MCP server) share the
 *                       reserved `built-in` group, shown as 「系统内置」.
 *   - Skills tab      → sub-tabs 全局技能 / 项目技能 (always visible), each
 *                       with flat skill rows carrying the same clickable class
 *                       chip plus a directory tree / file preview
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { IconTriangleRightFill14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  CapabilityPolicyRemote,
  CapabilitySnapshot,
  CapabilityRow,
  CatalogDocs,
  McpLocation,
  SkillFileEntry,
  SkillLocation,
  ToolDetail,
} from './store.ts'
import { cachedSnapshot, loadSnapshot, unwrap } from './store.ts'
import { LocationModal } from './LocationModal.tsx'
import { ADOPTABLE_SKILL_SOURCES, BUILT_IN_SERVER, PROJECT_SKILL_SOURCES } from '../constants.ts'
import {
  compileNameFilter,
  countByClass,
  filterRows,
  groupRows,
  resolveSkillTab,
  splitSkillGroups,
  type SkillTab,
} from './skillGroups.ts'
import { canRevalidate, pollDelayMs, versionChanged, type RevalidateGate } from './revalidate.ts'

/** Props injected by the settings.section registration (see index.ts). */
export interface CapabilitySectionInjected {
  remote: CapabilityPolicyRemote
  t(key: CapabilityKey, params?: Record<string, unknown>): string
  /** Diagnostic: `$mount` failure surfaced instead of crashing the section. */
  mountError?: string
  /**
   * Subscribe to signals that the host catalog may have moved without this page
   * asking: a settings document edit (registering a source, editing a
   * composition file outside the browser) or a carrier reconnect. Returns a
   * disposer. Optional so the section still mounts on a runtime that predates
   * the forwarded-event API — it then falls back to the version poll alone.
   */
  subscribeSignals?: (listener: () => void) => () => void
}

export type CapabilitySectionProps = CapabilitySectionInjected

export type CapabilityKey =
  | 'nav'
  | 'title'
  | 'desc'
  | 'resident'
  | 'on-demand'
  | 'disabled'
  | 'tool'
  | 'skill'
  | 'mandatory'
  | 'toolsGroup'
  | 'skillsGroup'
  | 'builtInGroup'
  | 'globalSkills'
  | 'projectSkills'
  | 'presetSkills'
  | 'emptyTools'
  | 'emptySkills'
  | 'emptyGlobalSkills'
  | 'emptyProjectSkills'
  | 'filterByName'
  | 'filterHint'
  | 'filterNoMatch'
  | 'toolCount'
  | 'residentShort'
  | 'onDemandShort'
  | 'disabledShort'
  | 'cycleHint'
  | 'notPreviewable'
  | 'previewClose'
  | 'detailNotFound'
  | 'cycleOverridden'
  | 'refreshFailed'
  | 'retry'
  | 'carrierFailureHint'
  | 'registerCapability'
  | 'editMcp'
  | 'editSkillNamed'
  | 'edit'
  | 'save'
  | 'remove'
  | 'cancel'
  | 'confirmRemove'
  | 'confirmRemoveMcp'
  | 'confirmRemoveSkillLink'
  | 'confirmRemoveSkillDir'
  | 'confirmSaveAnyway'
  | 'saveConfirmRealDir'
  | 'register'
  | 'notEditable'
  | 'entryNotFound'
  | 'mcpServers'
  | 'skillDirs'
  | 'skillDirPath'
  | 'skillDirHint'
  | 'skillRoot'
  | 'skillRootUser'
  | 'skillRootProject'
  | 'skillRootHintUser'
  | 'skillRootHintProject'
  | 'skillProjectPath'
  | 'skillProjectPathHint'
  | 'skillRegisteredAt'
  | 'skillRepointed'
  | 'skillAdopted'
  | 'skillSource'
  | 'skillSourceHint'
  | 'skillFromPreset'
  | 'skillFromPresetHint'
  | 'skillUnmanaged'
  | 'adoptSkill'
  | 'adoptSkillHint'
  | 'adoptSkillTitle'
  | 'sourceCustom'
  | 'sourceBundled'
  | 'serverName'
  | 'serverNameImmutable'
  | 'transport'
  | 'transportStdio'
  | 'transportHttp'
  | 'transportHintStdio'
  | 'transportHintHttp'
  | 'command'
  | 'args'
  | 'cwd'
  | 'env'
  | 'url'
  | 'headers'
  | 'headersHint'
  | 'timeout'
  | 'timeoutInvalid'
  | 'viewCatalog'
  | 'catalogPolicy'
  | 'catalogOnDemand'
  | 'catalogPolicyNote'
  | 'catalogDisabled'
  | 'catalogUnreadable'

type ViewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; snapshot: CapabilitySnapshot }

const CLASS_KEYS = ['resident', 'on-demand', 'disabled'] as const
type CapabilityClass = (typeof CLASS_KEYS)[number]

/** Click-cycle order on machine values (displayed as On-demand → Disabled → Resident). */
const NEXT_CLASS: Record<CapabilityClass, CapabilityClass> = {
  'on-demand': 'disabled',
  disabled: 'resident',
  resident: 'on-demand',
}

/** i18n keys for the short display labels, keyed by the machine class value. */
const CLASS_SHORT_KEYS: Record<CapabilityClass, CapabilityKey> = {
  resident: 'residentShort',
  'on-demand': 'onDemandShort',
  disabled: 'disabledShort',
}

/** Scoped stylesheet: injected once at module scope, like every official bundle. */
const CSS_ID = 'capability-menu-section-css'
const CSS = `
.mc-section{display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary)}
.mc-heading{margin:0;font-size:18px;font-weight:600}
.mc-desc{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px}
/* 说明行右侧放只读文档入口：把它从头部的计数行挪出来，计数多（Tools 常驻 ·
   167）时那一行不再因此折行。 */
.mc-desc-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.mc-desc-row .mc-desc{flex:1 1 auto;min-width:0}
.mc-summary{display:flex;gap:12px;flex-wrap:wrap;justify-content:flex-end;align-items:center;padding-bottom:8px}
.mc-catalog-btn{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:20px;padding:0 10px;cursor:pointer;white-space:nowrap}
.mc-catalog-btn:hover{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}
/* 忙碌态靠变淡表示，而不是换文案：换文案会改按钮宽度，把这行挤到第二行。 */
.mc-catalog-btn:disabled{cursor:default;opacity:.6}
.mc-catalog-tabs{padding:8px 16px 0}
.mc-catalog-path{padding:8px 16px 0;margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);word-break:break-all}
.mc-chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:20px;white-space:nowrap}
/* 三态圆点：常驻=实心、按需=半实心、禁用=圆环+斜杠（禁行标志）。
   形状区分之外仍保留色盲友好（蓝-黄轴）：冷蓝=常驻、暖琥珀=按需、中性灰=禁用。
   三个状态都用内联 SVG 做 mask 绘制，保证 10px 下也是矢量正圆（避免 CSS
   border-radius 小尺寸的方圆变形）；禁用不用空心圆：在「禁用 · 0」这类计数旁，
   空心圆容易被误读成数字 0。 */
.mc-dot{position:relative;width:13px;height:13px;border-radius:50%;flex:none;box-sizing:border-box}
.mc-dot--resident{--mc-dot:#527a9c;background:var(--mc-dot);-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='5.3' fill='%23000'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='5.3' fill='%23000'/%3E%3C/svg%3E") center/contain no-repeat}
.mc-dot--on-demand{--mc-dot:#a57c33;background:var(--mc-dot);-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='4.6' fill='none' stroke='%23000' stroke-width='1.4'/%3E%3Cpath d='M1.4 6 A4.6 4.6 0 0 1 10.6 6 Z' fill='%23000'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='4.6' fill='none' stroke='%23000' stroke-width='1.4'/%3E%3Cpath d='M1.4 6 A4.6 4.6 0 0 1 10.6 6 Z' fill='%23000'/%3E%3C/svg%3E") center/contain no-repeat}
.mc-dot--disabled{--mc-dot:#7e7477;background:var(--mc-dot);-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='4.6' fill='none' stroke='%23000' stroke-width='1.4'/%3E%3Cline x1='3' y1='9' x2='9' y2='3' stroke='%23000' stroke-width='1.4' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='4.6' fill='none' stroke='%23000' stroke-width='1.4'/%3E%3Cline x1='3' y1='9' x2='9' y2='3' stroke='%23000' stroke-width='1.4' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat}
body[data-ds-dark-theme] .mc-dot--resident{--mc-dot:#96b6d1}
body[data-ds-dark-theme] .mc-dot--on-demand{--mc-dot:#d4b26b}
body[data-ds-dark-theme] .mc-dot--disabled{--mc-dot:#b8abad}
/* 同上色系（低饱和灰调）：仅文字着色，不加背景，浅/深主题各一档。 */
.mc-chip--resident{color:#527a9c}
.mc-chip--on-demand{color:#a57c33}
.mc-chip--disabled{color:#7e7477}
body[data-ds-dark-theme] .mc-chip--resident{color:#96b6d1}
body[data-ds-dark-theme] .mc-chip--on-demand{color:#d4b26b}
body[data-ds-dark-theme] .mc-chip--disabled{color:#b8abad}
.mc-tabs{border-bottom:1px solid var(--dsw-alias-border-l2);display:flex;align-items:flex-end;justify-content:space-between;gap:22px}
/* 名字过滤框：两个 tab 共用一条，宽度占满，与下方列表左对齐。
   它属于上面的主 tab 栏，不属于下面的列表，所以两侧都把 .mc-section 的 12px
   栏距收掉一部分：下划线—6px—输入框—8px—全局/项目 子页签文字（后者里的 4px
   是子页签自己的 padding-top）。改之前是 12+12=24px 和 12+4=16px，读起来像
   两个不相干的块。 */
.mc-filter{display:flex;padding-top:0;margin-top:-6px;margin-bottom:-8px}
.mc-filter input{box-sizing:border-box;width:100%;min-width:0;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:13px;line-height:18px}
.mc-filter input:hover{border-color:var(--dsw-alias-border-l3)}
.mc-filter input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px;border-color:transparent}
/* Skills sub-tab bar (全局技能/项目技能): same underline chrome, no right-side summary. */
.mc-subtabs{border-bottom:1px solid var(--dsw-alias-border-l2);display:flex;align-items:flex-end;gap:22px}
.mc-tab-group{display:flex;align-items:flex-end;gap:22px}
.mc-tab{color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:0 0;border:0;padding:7px 1px 9px;font-size:13px;line-height:20px;position:relative}
.mc-tab:hover,.mc-tab[data-active=true]{color:var(--dsw-alias-label-primary)}
.mc-tab[data-active=true]:after,.mc-tab:focus-visible:after{background:var(--dsw-alias-label-primary);content:"";border-radius:2px 2px 0 0;height:2px;position:absolute;bottom:-1px;left:0;right:0}
.mc-tab:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;color:var(--dsw-alias-label-primary);border-radius:2px}
/* 面板的第一行必须和另一个 tab 的第一行从过滤框下沿出发走同样远，否则切 tab 时
   首行会跳一下。这里留 4px，加上 .mc-section 的 4px 栏距（过滤框那侧被 -8px 收
   掉后剩 4px）= 8px，正好是 Skills 面板子页签文字的位置（4px 栏距 + 子页签自己
   的 4px padding-top）。原来这里是 12px，Tools 的首个分组因此落在过滤框下 16px
   处，比「全局技能」那行低一半。 */
.mc-panel{min-width:0;padding-top:4px}
/* Skills panel: its first row is the 全局技能/项目技能 sub-tab bar, and that bar
   belongs to the header stack above it (rule → name filter → sub-tabs) rather
   than to the list below. So the panel adds no padding of its own, and the
   sub-tab labels keep a 4px top padding instead of the 7px they share with the
   primary tabs. */
.mc-panel--tight{padding-top:0}
.mc-panel--tight .mc-subtabs .mc-tab{padding-top:4px}
.mc-panel-inner{display:flex;flex-direction:column;gap:14px}
.mc-group{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden}
.mc-group-header{box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;min-width:0;padding:10px 12px;background:var(--dsw-alias-bg-layer-1);border:0;color:inherit;font:inherit;text-align:left;cursor:pointer}
.mc-group-header:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mc-group-header:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.mc-chevron{color:var(--dsw-alias-label-tertiary);transition:transform .15s ease;flex:none}
.mc-chevron--open{transform:rotate(90deg)}
.mc-server-name{font-weight:600;font-size:14px;line-height:20px;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mc-server-count{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);flex:none}
.mc-server-meta{margin-left:auto;display:flex;align-items:center;justify-content:flex-end;gap:8px;font-size:12px;color:var(--dsw-alias-label-tertiary);flex:none;min-width:0}
.mc-counts{display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap}
.mc-count{font-size:11px;line-height:18px;padding:0 8px;border-radius:999px;border:1px solid transparent;font-family:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.mc-count:hover{border-color:var(--dsw-alias-border-l3)}
.mc-count:disabled{cursor:default;opacity:.6}
.mc-count--resident{color:#527a9c}
.mc-count--on-demand{color:#a57c33}
.mc-count--disabled{color:#7e7477}
body[data-ds-dark-theme] .mc-count--resident{color:#96b6d1}
body[data-ds-dark-theme] .mc-count--on-demand{color:#d4b26b}
body[data-ds-dark-theme] .mc-count--disabled{color:#b8abad}
/* 「编辑」是动作，不是分类计数：沿用 chip 的尺寸以对齐，但用次要文字色、hover
   才变蓝加下划线。裸用 .mc-count 时会继承 .mc-section 的 label-primary（浅色
   主题下近黑），夹在着色的计数 chip 旁会读成一枚没有圆点的黑色 chip。 */
.mc-count--action{color:var(--dsw-alias-label-secondary)}
.mc-count--action:hover{color:var(--dsw-alias-state-business-primary);text-decoration:underline}
.mc-tools{border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}
.mc-tool{display:flex;align-items:center;gap:10px;padding:7px 12px 7px 26px;font-size:13px;line-height:20px;cursor:pointer}
.mc-tool:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mc-tool-name{font-family:var(--dsw-font-markdown-code-block-font-family);font-size:12px;color:var(--dsw-alias-label-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mc-tool-meta{margin-left:auto;display:flex;align-items:center;gap:8px;flex:0 1 auto;min-width:0}
.mc-dot-btn{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:1px solid transparent;border-radius:999px;background:0 0;cursor:pointer}
.mc-dot-btn:hover{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}
.mc-dot-btn:disabled{cursor:default;opacity:.6;border-color:transparent;background:0 0}
.mc-tag{font-size:11px;line-height:18px;padding:0 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}
.mc-empty{padding:16px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary);border:1px dashed var(--dsw-alias-border-l2);border-radius:8px}
.mc-error{padding:12px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;color:var(--dsw-alias-state-error-primary);font-size:13px}
.mc-error p{margin:0}
.mc-error p.mc-error-hint{margin-top:8px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.mc-error-actions{display:flex;justify-content:flex-end;margin-top:10px}
.mc-notice{padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-secondary);font-size:13px}
.mc-skill{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.mc-skill-row{box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;min-width:0;padding:10px 12px;background:0 0;border:0;color:inherit;font:inherit;text-align:left;cursor:pointer}
.mc-skill-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mc-skill-name{font-weight:600;font-size:14px;line-height:20px;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mc-skill-meta{margin-left:auto;display:flex;align-items:center;gap:8px;flex:0 1 auto;min-width:0}
/* A row has no room for prose: let a long source label truncate instead of
   pushing the row's buttons past the right edge. */
.mc-source{font-size:11px;line-height:18px;color:var(--dsw-alias-label-caption);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:0 1 auto}
/* One sentence to confirm a row action: the shared modal chrome, sized down. */
.mc-confirm-dialog{width:min(420px,calc(100vw - 48px))}
.mc-confirm-body{display:flex;flex-direction:column;gap:12px;padding:14px 16px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.mc-confirm-body p{margin:0}
/* A directory has no spaces to break at, and the modal is where it can show in
   full: wrap it instead of truncating it the way a row's 来源 slot must. */
.mc-confirm-path{font-family:var(--dsw-font-markdown-code-block-font-family);word-break:break-all}
.mc-confirm-actions{display:flex;justify-content:flex-end;gap:8px}
.mc-skill-body{border-top:1px solid var(--dsw-alias-border-l1);padding:8px 12px 12px}
/* 预设技能组：预设 id 是页签之下的分组小标题，不是新一级页签。 */
.mc-skill-group{display:flex;flex-direction:column;gap:8px;min-width:0}
.mc-skill-group-title{font-size:12px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary);padding:0 2px}
.mc-tree{display:flex;flex-direction:column;gap:2px;font-size:13px;line-height:20px}
.mc-tree-row{display:flex;align-items:center;gap:8px;padding:3px 4px;border-radius:6px;cursor:pointer;min-width:0}
.mc-tree-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mc-tree-indent{flex:none;width:16px}
.mc-tree-icon{flex:none;color:var(--dsw-alias-label-tertiary);display:inline-flex}
.mc-tree-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mc-tree-file:hover .mc-tree-name{color:var(--dsw-alias-label-primary)}
.mc-preview-mask{position:fixed;inset:0;background:var(--dsw-alias-bg-mask-2);display:flex;align-items:center;justify-content:center;z-index:1000}
.mc-preview{width:min(720px,calc(100vw - 48px));max-height:min(560px,calc(100vh - 96px));display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:var(--dsw-alias-bg-mask-drop)}
.mc-preview-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.mc-preview-title{font-size:13px;line-height:20px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.mc-preview-close{flex:none;padding:2px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.mc-preview-close:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mc-preview-body{overflow:auto;flex:1 1 auto;min-height:0;padding:14px 16px;font-family:var(--dsw-font-markdown-code-block-font-family);font-size:12px;line-height:20px;white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-primary)}
.mc-preview-hint{padding:16px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary)}
`
if (typeof document !== 'undefined' && document.querySelector(`style[data-css-id="${CSS_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.cssId = CSS_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

/**
 * dsh's skill source labels, shown on rows this plugin cannot edit — so "why is
 * there no 编辑 button" has a visible answer. Labels that name one directory are
 * shown as that path; the rest name a category and go through the dictionary, so
 * none of dsh's internal labels (`custom`, `bundled`, …) reach the operator raw.
 */
const SOURCE_PATHS: Record<string, string> = {
  'user-dsh': '~/.dsh/skills',
  'user-agents': '~/.agents/skills',
  'project-dsh': '<project>/.dsh/skills',
  'project-agents': '<project>/.agents/skills',
}

/** Source labels that name no single directory; shown via `t`. */
const SOURCE_LABEL_KEYS: Partial<Record<string, CapabilityKey>> = {
  'custom': 'sourceCustom',
  'bundled': 'sourceBundled',
}

/** How to name a skill's source root on a row we cannot manage. */
function sourceLabel(
  source: string | undefined,
  t: (key: CapabilityKey, params?: Record<string, unknown>) => string,
): string {
  if (source === undefined) return t('skillUnmanaged')
  const path = SOURCE_PATHS[source]
  if (path !== undefined) return path
  const key = SOURCE_LABEL_KEYS[source]
  return key === undefined ? source : t(key)
}

/**
 * Whether the document is visible. A hidden settings tab does no polling and
 * takes no re-reads; coming back is itself a revalidation trigger.
 */
function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const update = (): void => setVisible(document.visibilityState !== 'hidden')
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return visible
}

export function CapabilitySection(props: CapabilitySectionProps): JSX.Element {
  const { remote, t, mountError, subscribeSignals } = props
  // Paint a previous snapshot immediately when this page session has one; the
  // mount effect below still revalidates.
  const [state, setState] = useState<ViewState>(() => {
    const cached = cachedSnapshot()
    return cached === undefined ? { status: 'loading' } : { status: 'ready', snapshot: cached }
  })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [openServers, setOpenServers] = useState<ReadonlySet<string>>(new Set())
  const [activeTab, setActiveTab] = useState<'tools' | 'skills'>('tools')

  const reload = useCallback(async () => {
    if (remote === undefined) {
      setState({ status: 'error', message: mountError ?? 'capabilityPolicy remote 未挂载' })
      return
    }
    try {
      setState(await loadSnapshot(remote).then(snapshot => ({ status: 'ready' as const, snapshot })))
    } catch (e) {
      // A stale list beats a blank panel: if rows are already on screen, keep
      // them and report the failed revalidate instead of replacing everything
      // with an error (the most common cause is the carrier dying, which the
      // reconnect signal and the version poll both recover from).
      setState(prev => prev.status === 'ready' ? prev : { status: 'error', message: String(e) })
      setNotice(String(e))
    }
  }, [remote, mountError])

  useEffect(() => {
    void reload()
  }, [reload])

  const [refreshing, setRefreshing] = useState(false)

  /**
   * Rebuild the host catalog, then re-read the classification list. Used after
   * registering a new source so the list reflects it without waiting for the
   * scheduler's debounce window.
   */
  const refreshCatalog = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      if (remote !== undefined) unwrap(await remote.refresh(), 'capabilityPolicy.refresh')
      await reload()
      setNotice(null)
    } catch (e) {
      console.error('[capability-menu] refresh failed:', e)
      setNotice(t('refreshFailed'))
    } finally {
      setRefreshing(false)
    }
  }, [refreshing, remote, reload, t])

  const toggleServer = useCallback((server: string) => {
    setOpenServers(prev => {
      const next = new Set(prev)
      if (next.has(server)) next.delete(server)
      else next.add(server)
      return next
    })
  }, [])

  // ── Keeping the list fresh without a 刷新 button ─────────────────────────
  //
  // Four things can make what is on screen stale, and they are not the same
  // kind of event. A settings edit or a reconnect means the *host* may not have
  // reindexed yet, so those go through `refreshCatalog()` (rebuild, wait for it
  // to converge, then re-read) — the scheduler debounces `tools/change` /
  // `skills/change` by 200ms, so a bare re-read on the signal would read the
  // pre-rebuild catalog. A moved version number means the rebuild already
  // finished, so a plain `reload()` is enough.
  const visible = useDocumentVisible()
  const [pendingSignal, setPendingSignal] = useState(false)
  const seenVersion = useRef<number | undefined>(undefined)
  const pollFailures = useRef(0)
  // Read by the subscription callback, which is created once and must not be
  // re-created (that would re-subscribe on every keystroke in the filter box).
  const gate = useRef<RevalidateGate>({ visible: true, ready: false, busy: false, rebuilding: false })
  useEffect(() => {
    gate.current = { visible, ready: state.status === 'ready', busy, rebuilding: refreshing }
  })

  /**
   * A signal that the host catalog may have moved. Runs now when the page is
   * idle; otherwise parks until it is, so a signal that lands mid-click is
   * never dropped (and never repaints the row under the cursor).
   */
  const onExternalSignal = useCallback(() => {
    if (canRevalidate(gate.current)) void refreshCatalog()
    else setPendingSignal(true)
  }, [refreshCatalog])

  useEffect(() => {
    const dispose = subscribeSignals?.(onExternalSignal)
    return dispose
  }, [subscribeSignals, onExternalSignal])

  // The parked signal, flushed as soon as the page can take it.
  useEffect(() => {
    if (!pendingSignal) return
    if (!canRevalidate({ visible, ready: state.status === 'ready', busy, rebuilding: refreshing })) return
    setPendingSignal(false)
    void refreshCatalog()
  }, [pendingSignal, visible, state.status, busy, refreshing, refreshCatalog])

  // The one change nothing on the wire announces: a file dropped into an
  // already-registered skill directory reindexes the host through `skills/change`,
  // which is not in the forwarded-event allowlist. So ask for a cheap version
  // number and only re-read when it moves. Sampling restarts whenever this
  // effect does — mount, becoming visible, and going idle again — which is
  // exactly when a fresh answer is worth having.
  useEffect(() => {
    if (!visible || state.status !== 'ready' || busy || refreshing) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async (): Promise<void> => {
      try {
        const version = unwrap(await remote.catalogVersion(), 'capabilityPolicy.catalogVersion')
        pollFailures.current = 0
        if (versionChanged(seenVersion.current, version)) {
          seenVersion.current = version
          await reload()
        }
      } catch {
        // A dead carrier is the expected failure here; reload() already keeps
        // the stale list and reports it. Back off instead of hammering.
        pollFailures.current += 1
      }
      if (!stopped) timer = setTimeout(() => void tick(), pollDelayMs(pollFailures.current))
    }
    timer = setTimeout(() => void tick(), 0)
    return () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [visible, state.status, busy, refreshing, remote, reload])

  /** Move one or more capability ids to the next class in the click cycle. */
  const cycleClass = useCallback(async (ids: readonly string[], kind: 'tool' | 'skill') => {
    if (ids.length === 0 || busy) return
    setBusy(true)
    // The move is decided from the rows already on screen, so the dot flips on
    // the click frame rather than after a round trip: how fast this feels must
    // not depend on how busy the server happens to be. The round trips below
    // only reconcile.
    const first = ids.map(id => state.status === 'ready' ? state.snapshot.rows.find(r => r.id === id)?.class : undefined)
      .find((c): c is CapabilityClass => c !== undefined)
    const from: CapabilityClass = first ?? 'on-demand'
    const to = NEXT_CLASS[from]
    const moved = new Set(ids)
    setState(prev => prev.status === 'ready'
      ? {
          status: 'ready',
          snapshot: {
            rows: prev.snapshot.rows.map(row => moved.has(row.id)
              ? { ...row, class: to, classLabel: undefined }
              : row),
          },
        }
      : prev)
    try {
      const config = unwrap(await remote.getConfig(), 'capabilityPolicy.getConfig')
      const key = kind === 'skill' ? 'skills' : 'tools'
      const set = config[key]
      const lists: Record<CapabilityClass, string[]> = {
        resident: [],
        'on-demand': [],
        disabled: [],
      }
      for (const cls of CLASS_KEYS) {
        const raw = set && typeof set === 'object' && !Array.isArray(set) ? (set as Record<string, unknown>)[cls] : undefined
        lists[cls] = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
      }
      // Remove moved ids from every list, then append to the destination list.
      for (const cls of CLASS_KEYS) {
        lists[cls] = lists[cls].filter(id => !ids.includes(id))
      }
      lists[to] = [...lists[to], ...ids]
      const nextLists: Record<string, string[]> = {}
      for (const cls of CLASS_KEYS) nextLists[cls] = lists[cls]
      // Unwrap like every other remote call: a rejected write (e.g. the
      // server's meta-tool fail-loud check) must surface as an error, not be
      // misread below as "overridden by a higher-priority rule".
      unwrap(await remote.updateConfig({ [key]: nextLists }), 'capabilityPolicy.updateConfig')
      const next = await loadSnapshot(remote)
      setState({ status: 'ready', snapshot: next })
      // Detect silently-overridden changes: a broader wildcard rule (or a hard
      // disabled rule) still wins over the exact id just pinned, so the class
      // did not move to `to`. Surface that instead of failing silently.
      const overridden = ids.filter(id => next.rows.find(r => r.id === id)?.class !== to)
      setNotice(overridden.length > 0 ? t('cycleOverridden', { count: overridden.length }) : null)
    } catch (e) {
      setState({ status: 'error', message: String(e) })
    } finally {
      setBusy(false)
    }
  }, [remote, busy, state, t])

  return (
    <section className="mc-section">
      {state.status === 'loading' && <p className="mc-empty">{t('desc')}…</p>}
      {state.status === 'error' && (
        <div className="mc-error">
          <p>{state.message}</p>
          {/* `gateway/internal: … failed: Failed to fetch` means the request never
              reached the server — the browser's carrier died, typically a tab
              still holding the dsh process that has since restarted. Say so,
              because "Failed to fetch" alone reads like a plugin bug. */}
          {state.message.includes('Failed to fetch') && <p className="mc-error-hint">{t('carrierFailureHint')}</p>}
          {/* The one recovery path: the automatic signals all need a snapshot to
              be on screen first, so a page that never got one has to be able to
              ask again. */}
          <div className="mc-error-actions">
            <button type="button" className="mc-catalog-btn" onClick={() => void reload()}>{t('retry')}</button>
          </div>
        </div>
      )}
      {notice !== null && <div className="mc-notice">{notice}</div>}
      {state.status === 'ready' && <ReadyBody
        remote={remote}
        snapshot={state.snapshot}
        openServers={openServers}
        busy={busy}
        activeTab={activeTab}
        t={t}
        onTabChange={setActiveTab}
        onToggleServer={toggleServer}
        onCycle={cycleClass}
        onRefresh={() => void refreshCatalog()}
        onNotice={setNotice}
      />}
    </section>
  )
}

function ReadyBody(props: {
  remote: CapabilityPolicyRemote
  snapshot: CapabilitySnapshot
  openServers: ReadonlySet<string>
  busy: boolean
  activeTab: 'tools' | 'skills'
  t: CapabilitySectionInjected['t']
  onTabChange: (tab: 'tools' | 'skills') => void
  onToggleServer: (server: string) => void
  onCycle: (ids: readonly string[], kind: 'tool' | 'skill') => void
  /** Rebuild the host catalog and re-read it now. */
  onRefresh: () => void
  /** Surface a one-line message in the section header. */
  onNotice: (message: string | null) => void
}): JSX.Element {
  const { remote, snapshot, openServers, busy, activeTab, t, onTabChange, onToggleServer, onCycle, onRefresh, onNotice } = props
  /** Name filter, shared by both tabs: it narrows whichever list is shown. */
  const [filter, setFilter] = useState('')
  // Distinguishes "nothing to show" from "the filter matched nothing".
  const nameFilter = compileNameFilter(filter)
  const needle = nameFilter.needle
  // The two labels only the client can supply: both are localized or rendered,
  // and both are what an operator actually reads off the screen.
  const shownRows = filterRows(snapshot.rows, nameFilter, {
    builtIn: t('builtInGroup'),
    source: source => sourceLabel(source, t),
  })
  const { servers, skills } = groupRows(shownRows)
  // Grouping rules live in `skillGroups.ts` so they are testable; see that
  // module for why the preset split keys off `preset` and not `source`.
  const { presetSkills, presetGroups, projectSkills, globalSkills } = splitSkillGroups(skills)
  // Which sub-tab the Skills panel shows. Persists across top-tab switches.
  const [skillTab, setSkillTab] = useState<SkillTab>('global')
  // The 预设技能 tab only exists while there are preset skills, so a deployment
  // without them keeps the two-tab layout.
  const activeSkillTab = resolveSkillTab(skillTab, { presetSkills, presetGroups, projectSkills, globalSkills })
  // Per-tab statistics: the Tools tab counts tool rows; the Skills tab counts
  // the currently active global/project/preset sub-tab.
  const statRows = activeTab === 'tools'
    ? shownRows.filter(r => r.kind === 'tool')
    : activeSkillTab === 'project' ? projectSkills : activeSkillTab === 'preset' ? presetSkills : globalSkills
  const summary = CLASS_KEYS.map(cls => ({ cls, count: countByClass(statRows, cls) }))

  /** Tool-detail modal: one schema popup at a time. */
  const [toolDetail, setToolDetail] = useState<{
    id: string
    status: 'loading' | 'ready' | 'error'
    detail?: ToolDetail
    message?: string
  } | null>(null)

  /** Fetch and show the model-facing tool definition (name/description/parameters). */
  const openToolDetail = useCallback(async (id: string) => {
    setToolDetail({ id, status: 'loading' })
    try {
      const detail = unwrap(await remote.getDetail(id), 'capabilityPolicy.getDetail')
      setToolDetail(detail === undefined
        ? { id, status: 'error', message: t('detailNotFound') }
        : { id, status: 'ready', detail })
    } catch (error) {
      setToolDetail({ id, status: 'error', message: String(error) })
    }
  }, [remote, t])

  /** 能力目录弹层状态：查看三档策略配置 + 按需能力目录文件。 */
  const [catalogDocs, setCatalogDocs] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; docs: CatalogDocs }
    | null
  >(null)
  const [catalogTab, setCatalogTab] = useState<'policy' | 'catalog'>('policy')
  /** 注册能力 modal; its default sub-tab follows `activeTab`. */
  const [registerOpen, setRegisterOpen] = useState(false)
  /** 编辑 target; at most one is set. */
  const [editMcp, setEditMcp] = useState<McpLocation | undefined>(undefined)
  const [editSkill, setEditSkill] = useState<SkillLocation | undefined>(undefined)
  /**
   * Skill directories registered under the skill root. Only those can be
   * edited: a project or bundled skill has no row to repoint, so its row gets
   * no 编辑 button rather than a button that always fails.
   */
  const [editableSkills, setEditableSkills] = useState<ReadonlySet<string>>(new Set())

  // Reloaded when a skill's identity or root changes, so a skill registered or
  // removed elsewhere — and one just adopted — updates its own button. The
  // source is part of the key because 纳入管理 is exactly that: it flips
  // `user-agents`/`custom` to `user-dsh` without touching the id, and a
  // source flip is when a row must trade its 来源 label back for an 编辑 button.
  // Keyed on these two fields rather than the whole snapshot: every tier click
  // replaces the snapshot twice (optimistic, then reconcile) without touching
  // either, and depending on it would re-list the skill roots each time for no
  // reason.
  const skillSignature = skills.map(skill => `${skill.id}\u0000${skill.source ?? ''}`).join('\u0001')
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const rows = unwrap(await remote.listSkillLocations(), 'capabilityPolicy.listSkillLocations')
        // Matched on the name the skill declares, not the entry's own name: a
        // row is keyed by the former, and an entry whose symlink is named after
        // its source directory rather than the skill would otherwise never
        // match — leaving it without an 编辑 button though it is editable.
        if (!cancelled) setEditableSkills(new Set(rows.map(row => row.skillName ?? row.name)))
      } catch {
        // Leave the set empty.
      }
    })()
    return () => { cancelled = true }
  }, [remote, skillSignature])

  /** Open the 编辑 form for the MCP server behind a Tools-tab group header. */
  const openMcpEdit = useCallback(async (serverName: string) => {
    try {
      const rows = unwrap(await remote.listLocations(), 'capabilityPolicy.listLocations')
      const found = rows.find(row => row.serverName === serverName)
      if (found === undefined) {
        onNotice(t('notEditable'))
        return
      }
      setEditMcp(found)
    } catch (e) {
      onNotice(String(e))
    }
  }, [remote, t, onNotice])

  /**
   * Adopt a skill that dsh discovered from a user-level root this plugin reads
   * but does not manage: link its own directory into the user root so it becomes
   * an editable entry. The content is untouched.
   */
  const adoptSkill = useCallback(async (name: string) => {
    try {
      const entry = unwrap(await remote.adoptSkillLocation(name), 'capabilityPolicy.adoptSkillLocation')
      onNotice(t('skillAdopted', { path: entry }))
      onRefresh()
    } catch (e) {
      onNotice(String(e))
    }
  }, [remote, t, onNotice, onRefresh])

  /**
   * Open the 编辑 form for a managed skill entry. `name` is the skill's declared
   * name, which is what the row and the panel address it by — an entry is
   * matched on that rather than on its own, possibly different, name. A bare
   * name can exist in both the user root and a project root, so the row's source
   * decides which entry the click meant; without it we fall back to the first
   * match.
   */
  const openSkillEdit = useCallback(async (name: string, source?: string) => {
    try {
      const rows = unwrap(await remote.listSkillLocations(), 'capabilityPolicy.listSkillLocations')
      const wanted: 'project' | 'user' = PROJECT_SKILL_SOURCES.has(source ?? '') ? 'project' : 'user'
      const named = rows.filter(row => (row.skillName ?? row.name) === name)
      const found = named.find(row => row.root === wanted) ?? named[0]
      if (found === undefined) {
        onNotice(t('notEditable'))
        return
      }
      setEditSkill(found)
    } catch (e) {
      onNotice(String(e))
    }
  }, [remote, t, onNotice])

  /** Fetch and show the two read-only catalog documents. */
  const openCatalogDocs = useCallback(async () => {
    setCatalogDocs({ status: 'loading' })
    try {
      const docs = unwrap(await remote.getCatalogDocs(), 'capabilityPolicy.getCatalogDocs')
      setCatalogDocs({ status: 'ready', docs })
    } catch (error) {
      setCatalogDocs({ status: 'error', message: String(error) })
    }
  }, [remote])

  return (
    <>
      <h2 className="mc-heading">{t('title')}</h2>
      <div className="mc-desc-row">
        <p className="mc-desc">{t('desc')}</p>
        {/* 只读文档入口留在说明行；计数行只放 chips + 注册能力。 */}
        <button type="button" className="mc-catalog-btn" onClick={() => void openCatalogDocs()}>
          {t('viewCatalog')}
        </button>
      </div>

      <div className="mc-tabs">
        <div className="mc-tab-group" role="tablist" aria-label={t('title')}>
          <button
            type="button"
            role="tab"
            className="mc-tab"
            aria-selected={activeTab === 'tools'}
            data-active={activeTab === 'tools' ? 'true' : undefined}
            onClick={() => onTabChange('tools')}
          >
            {t('toolsGroup')}
          </button>
          <button
            type="button"
            role="tab"
            className="mc-tab"
            aria-selected={activeTab === 'skills'}
            data-active={activeTab === 'skills' ? 'true' : undefined}
            onClick={() => onTabChange('skills')}
          >
            {t('skillsGroup')}
          </button>
        </div>
        <div className="mc-summary">
          {summary.map(({ cls, count }) => (
            <span key={cls} className={`mc-chip mc-chip--${cls}`}>
              <span className={`mc-dot mc-dot--${cls}`} aria-hidden="true" />
              {t(CLASS_SHORT_KEYS[cls])} · {count}
            </span>
          ))}
          {/* 固定在最右侧：计数 chips 增减时按钮位置不漂移。 */}
          {/* No 刷新 button here: the page re-reads itself — see the four
              signals documented in `revalidate.ts` and the effects below. */}
          <button type="button" className="mc-catalog-btn" onClick={() => setRegisterOpen(true)}>
            {t('registerCapability')}
          </button>
        </div>
      </div>

      {/* Name filter. A long list is the actual problem behind "why can't I find
          this capability" — grouping only helps when you already know where to
          look — and one box serves both tabs. It matches the row name *and* the
          group the row sits in (server / source root / preset), because typing
          系统 should find 系统内置 and typing cordis should find that preset's
          skills. Hidden when there is nothing to filter at all, so the empty
          catalog keeps its plain message. */}
      {snapshot.rows.length > 0 && (
        <div className="mc-filter">
          <input
            type="search"
            value={filter}
            placeholder={t('filterByName')}
            aria-label={t('filterByName')}
            title={t('filterHint')}
            onChange={e => setFilter(e.target.value)}
          />
        </div>
      )}

      <div role="tabpanel" hidden={activeTab !== 'tools'} className="mc-panel">
        <div className="mc-panel-inner">
          {servers.length === 0 ? (
            <p className="mc-empty">{needle === '' ? t('emptyTools') : t('filterNoMatch')}</p>
          ) : (
            <>
              {servers.map(({ server, tools }) => {
                const open = openServers.has(server)
                const counts = CLASS_KEYS.map(cls => ({ cls, count: countByClass(tools, cls) }))
                return (
                  <div key={server} className="mc-group">
                    <div
                      className="mc-group-header"
                      role="button"
                      tabIndex={0}
                      aria-expanded={open}
                      onClick={() => onToggleServer(server)}
                      onKeyDown={(e: KeyboardEvent<HTMLElement>) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onToggleServer(server)
                        }
                      }}
                    >
                      <IconTriangleRightFill14 size={12} className={`mc-chevron${open ? ' mc-chevron--open' : ''}`} />
                      <span className="mc-server-name">{server === BUILT_IN_SERVER ? t('builtInGroup') : server}</span>
                      <span className="mc-server-count">{t('toolCount', { count: tools.length })}</span>
                      <span className="mc-server-meta">
                        <span className="mc-counts">
                          {counts.filter(({ count }) => count > 0).map(({ cls, count }) => (
                            <button
                              key={cls}
                              type="button"
                              className={`mc-count mc-count--${cls}`}
                              disabled={busy}
                              title={t('cycleHint')}
                              onClick={(e: { stopPropagation(): void }) => {
                                e.stopPropagation()
                                onCycle(tools.filter(t => t.class === cls).map(t => t.id), 'tool')
                              }}
                            >
                              <span className={`mc-dot mc-dot--${cls}`} aria-hidden="true" />
                              {t(CLASS_SHORT_KEYS[cls])} {count}
                            </button>
                          ))}
                        </span>
                        {/* The built-in group is not a real MCP server: there is
                            no row to edit, so it gets no button. */}
                        {server !== BUILT_IN_SERVER && (
                          <button
                            type="button"
                            className="mc-count mc-count--action"
                            disabled={busy}
                            onClick={(e: { stopPropagation(): void }) => {
                              e.stopPropagation()
                              void openMcpEdit(server)
                            }}
                          >
                            {t('edit')}
                          </button>
                        )}
                      </span>
                    </div>
                    {open && (
                      <div className="mc-tools">
                        {tools.map(tool => (
                          <div
                            key={tool.id}
                            className="mc-tool"
                            title={tool.classLabel}
                            role="button"
                            tabIndex={0}
                            aria-label={tool.name}
                            onClick={() => void openToolDetail(tool.id)}
                            onKeyDown={(e: KeyboardEvent<HTMLElement>) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                void openToolDetail(tool.id)
                              }
                            }}
                          >
                            <span className="mc-tool-name">{tool.name}</span>
                            <span className="mc-tool-meta">
                              {tool.mandatory && <span className="mc-tag">{t('mandatory')}</span>}
                              <button
                                type="button"
                                className={`mc-dot-btn mc-count--${tool.class}`}
                                disabled={busy || tool.mandatory}
                                title={tool.classLabel}
                                aria-label={tool.classLabel}
                                onClick={(e: { stopPropagation(): void }) => {
                                  e.stopPropagation()
                                  onCycle([tool.id], 'tool')
                                }}
                              >
                                <span className={`mc-dot mc-dot--${tool.class}`} aria-hidden="true" />
                              </button>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>

      <div role="tabpanel" hidden={activeTab !== 'skills'} className="mc-panel mc-panel--tight">
        <div className="mc-panel-inner">
          {skills.length === 0 ? (
            <p className="mc-empty">{needle === '' ? t('emptySkills') : t('filterNoMatch')}</p>
          ) : (
            <>
              <div className="mc-subtabs">
                <div className="mc-tab-group" role="tablist" aria-label={t('skillsGroup')}>
                  <button
                    type="button"
                    role="tab"
                    className="mc-tab"
                    aria-selected={activeSkillTab === 'global'}
                    data-active={activeSkillTab === 'global' ? 'true' : undefined}
                    onClick={() => setSkillTab('global')}
                  >
                    {t('globalSkills')}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className="mc-tab"
                    aria-selected={activeSkillTab === 'project'}
                    data-active={activeSkillTab === 'project' ? 'true' : undefined}
                    onClick={() => setSkillTab('project')}
                  >
                    {t('projectSkills')}
                  </button>
                  {/* Conditional third tab: rendered only when preset skills are
                      actually present, so a deployment without them keeps the
                      two-tab layout instead of showing an always-empty tab. */}
                  {presetSkills.length > 0 && (
                    <button
                      type="button"
                      role="tab"
                      className="mc-tab"
                      aria-selected={activeSkillTab === 'preset'}
                      data-active={activeSkillTab === 'preset' ? 'true' : undefined}
                      onClick={() => setSkillTab('preset')}
                    >
                      {t('presetSkills')}
                    </button>
                  )}
                </div>
              </div>
              {activeSkillTab === 'global' ? (
                globalSkills.length > 0 ? (
                  <SkillList
                    skills={globalSkills}
                    remote={remote}
                    busy={busy}
                    t={t}
                    onCycle={onCycle}
                    editableSkills={editableSkills}
                    onEditSkill={openSkillEdit}
                    onAdoptSkill={adoptSkill}
                  />
                ) : (
                  <p className="mc-empty">{t('emptyGlobalSkills')}</p>
                )
              ) : activeSkillTab === 'project' ? (
                projectSkills.length > 0 ? (
                  <SkillList
                    skills={projectSkills}
                    remote={remote}
                    busy={busy}
                    t={t}
                    onCycle={onCycle}
                    editableSkills={editableSkills}
                    onEditSkill={openSkillEdit}
                    onAdoptSkill={adoptSkill}
                  />
                ) : (
                  <p className="mc-empty">{t('emptyProjectSkills')}</p>
                )
              ) : (
                /* One section per preset (preset id as a heading) rather than a
                   fourth level of tabs: the id is provenance, not navigation. */
                presetGroups.map(([preset, group]) => (
                  <div key={preset} className="mc-skill-group">
                    <div className="mc-skill-group-title">{preset}</div>
                    <SkillList
                      skills={group}
                      remote={remote}
                      busy={busy}
                      t={t}
                      onCycle={onCycle}
                      editableSkills={editableSkills}
                      onEditSkill={openSkillEdit}
                      onAdoptSkill={adoptSkill}
                    />
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </div>

      {toolDetail !== null && (
        <div className="mc-preview-mask" onClick={() => setToolDetail(null)}>
          <div className="mc-preview" onClick={e => e.stopPropagation()}>
            <div className="mc-preview-head">
              <span className="mc-preview-title">{toolDetail.detail?.name ?? toolDetail.id}</span>
              <button type="button" className="mc-preview-close" onClick={() => setToolDetail(null)}>
                {t('previewClose')}
              </button>
            </div>
            {toolDetail.status === 'loading' && <div className="mc-preview-hint">…</div>}
            {toolDetail.status === 'error' && <div className="mc-preview-hint">{toolDetail.message}</div>}
            {toolDetail.status === 'ready' && toolDetail.detail !== undefined && (
              <pre className="mc-preview-body">{JSON.stringify({
                type: 'function',
                function: {
                  name: toolDetail.detail.name,
                  description: toolDetail.detail.description,
                  parameters: toolDetail.detail.parameters,
                },
              }, null, 2)}</pre>
            )}
          </div>
        </div>
      )}

      {(registerOpen || editMcp !== undefined || editSkill !== undefined) && (
        <LocationModal
          remote={remote}
          t={t}
          defaultKind={activeTab === 'skills' ? 'skill' : 'mcp'}
          {...editMcp !== undefined ? { editMcp } : {}}
          {...editSkill !== undefined ? { editSkill } : {}}
          onClose={() => {
            setRegisterOpen(false)
            setEditMcp(undefined)
            setEditSkill(undefined)
          }}
          onChanged={notice => {
            onRefresh()
            // A registration that lands in a project root is worth reporting:
            // whether it is visible depends on which project the session runs in.
            if (notice !== undefined) onNotice(notice)
          }}
        />
      )}

      {catalogDocs !== null && (
        <div className="mc-preview-mask" onClick={() => setCatalogDocs(null)}>
          <div className="mc-preview" onClick={e => e.stopPropagation()}>
            <div className="mc-preview-head">
              <span className="mc-preview-title">{t('viewCatalog')}</span>
              <button type="button" className="mc-preview-close" onClick={() => setCatalogDocs(null)}>
                {t('previewClose')}
              </button>
            </div>
            {catalogDocs.status === 'loading' && <div className="mc-preview-hint">…</div>}
            {catalogDocs.status === 'error' && <div className="mc-preview-hint">{catalogDocs.message}</div>}
            {catalogDocs.status === 'ready' && (
              <>
                <div className="mc-subtabs mc-catalog-tabs">
                  <div className="mc-tab-group" role="tablist" aria-label={t('viewCatalog')}>
                    <button
                      type="button"
                      role="tab"
                      className="mc-tab"
                      aria-selected={catalogTab === 'policy'}
                      data-active={catalogTab === 'policy' ? 'true' : undefined}
                      onClick={() => setCatalogTab('policy')}
                    >
                      {t('catalogPolicy')}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      className="mc-tab"
                      aria-selected={catalogTab === 'catalog'}
                      data-active={catalogTab === 'catalog' ? 'true' : undefined}
                      onClick={() => setCatalogTab('catalog')}
                    >
                      {t('catalogOnDemand')}
                    </button>
                  </div>
                </div>
                {catalogTab === 'policy' ? (
                  <>
                    <p className="mc-catalog-path">{t('catalogPolicyNote')}</p>
                    <pre className="mc-preview-body">{catalogDocs.docs.policyYaml}</pre>
                  </>
                ) : (
                  <>
                    {catalogDocs.docs.catalog !== undefined
                      ? <p className="mc-catalog-path">{catalogDocs.docs.catalog.path}</p>
                      : <p className="mc-catalog-path">{t('catalogOnDemand')}</p>}
                    <pre className="mc-preview-body">
                      {catalogDocs.docs.catalog?.content
                        ?? (catalogDocs.docs.catalogMissing === 'disabled'
                          ? t('catalogDisabled')
                          : t('catalogUnreadable'))}
                    </pre>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

/** One directory entry in a skill's file tree. */
interface SkillTreeState {
  /** Open directories keyed by `skillId` then joined relPath. */
  open: Record<string, boolean>
  /** Cached directory listings: `${skillId}:${relPath}` → entries. */
  dirs: Record<string, SkillFileEntry[]>
}

function SkillList(props: {
  skills: CapabilityRow[]
  remote: CapabilityPolicyRemote
  busy: boolean
  t: CapabilitySectionInjected['t']
  onCycle: (ids: readonly string[], kind: 'skill') => void
  /** Names registered under the skill root; only those show a 编辑 button. */
  editableSkills: ReadonlySet<string>
  onEditSkill: (name: string, source?: string) => void
  onAdoptSkill: (name: string) => void
}): JSX.Element {
  const { skills, remote, busy, t, onCycle, editableSkills, onEditSkill, onAdoptSkill } = props
  /** Skill id whose 纳入管理 is waiting for a confirmation click. */
  const [confirmAdopt, setConfirmAdopt] = useState<string | null>(null)
  const [openSkill, setOpenSkill] = useState<string | null>(null)
  const [tree, setTree] = useState<SkillTreeState>({ open: {}, dirs: {} })
  const [preview, setPreview] = useState<{ id: string; relPath: string; content?: string; error?: string } | null>(null)

  const toggleSkill = useCallback(async (id: string) => {
    if (openSkill === id) {
      setOpenSkill(null)
      return
    }
    setOpenSkill(id)
    const key = `${id}:`
    if (tree.dirs[key] === undefined) {
      try {
        const entries = unwrap(await remote.listSkillDir(id, ''), 'capabilityPolicy.listSkillDir') ?? []
        setTree(prev => ({ ...prev, dirs: { ...prev.dirs, [key]: entries } }))
      } catch (error) {
        console.error('[capability-menu] listSkillDir failed:', error)
        setTree(prev => ({ ...prev, dirs: { ...prev.dirs, [key]: [] } }))
      }
    }
  }, [openSkill, remote, tree.dirs])

  const toggleDir = useCallback(async (id: string, relPath: string) => {
    const openKey = `${id}:${relPath}`
    const nextOpen = !tree.open[openKey]
    setTree(prev => ({ ...prev, open: { ...prev.open, [openKey]: nextOpen } }))
    if (nextOpen) {
      const key = `${id}:${relPath}`
      if (tree.dirs[key] === undefined) {
        try {
          const entries = unwrap(await remote.listSkillDir(id, relPath), 'capabilityPolicy.listSkillDir') ?? []
          setTree(prev => ({ ...prev, dirs: { ...prev.dirs, [key]: entries } }))
        } catch (error) {
          console.error(`[capability-menu] listSkillDir ${key} failed:`, error)
          setTree(prev => ({ ...prev, dirs: { ...prev.dirs, [key]: [] } }))
        }
      }
    }
  }, [remote, tree.dirs, tree.open])

  const openPreview = useCallback(async (id: string, relPath: string) => {
    setPreview({ id, relPath })
    try {
      const content = unwrap(await remote.readSkillFile(id, relPath), 'capabilityPolicy.readSkillFile')
      if (content === undefined) {
        setPreview({ id, relPath, error: t('notPreviewable') })
      } else {
        setPreview({ id, relPath, content })
      }
    } catch (error) {
      setPreview({ id, relPath, error: String(error) })
    }
  }, [remote, t])

  const renderEntries = (entries: SkillFileEntry[] | undefined, id: string, base: string): JSX.Element[] | undefined => {
    if (entries === undefined) return undefined
    const indent = base.length === 0 ? 0 : base.split('/').length
    return entries.map(entry => {
      const relPath = base.length === 0 ? entry.name : `${base}/${entry.name}`
      if (entry.type === 'directory') {
        const openKey = `${id}:${relPath}`
        const open = tree.open[openKey] ?? false
        return (
          <div key={relPath}>
            <div
              className="mc-tree-row"
              role="button"
              tabIndex={0}
              onClick={() => void toggleDir(id, relPath)}
              onKeyDown={(e: KeyboardEvent<HTMLElement>) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  void toggleDir(id, relPath)
                }
              }}
            >
              <span className="mc-tree-indent" style={{ width: 8 + indent * 16 }} />
              <span className="mc-tree-icon">
                <IconTriangleRightFill14 size={10} className={`mc-chevron${open ? ' mc-chevron--open' : ''}`} />
              </span>
              <span className="mc-tree-name">{entry.name}/</span>
            </div>
            {open && (
              <div style={{ marginTop: 2 }}>
                {renderEntries(tree.dirs[`${id}:${relPath}`], id, relPath) ?? (
                  <div className="mc-tree-row"><span className="mc-tree-indent" style={{ width: 20 + indent * 16 }} />…</div>
                )}
              </div>
            )}
          </div>
        )
      }
      return (
        <div
          key={relPath}
          className="mc-tree-row mc-tree-file"
          role="button"
          tabIndex={0}
          title={relPath}
          onClick={() => void openPreview(id, relPath)}
          onKeyDown={(e: KeyboardEvent<HTMLElement>) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              void openPreview(id, relPath)
            }
          }}
        >
          <span className="mc-tree-indent" style={{ width: 8 + indent * 16 }} />
          <span className="mc-tree-name">{entry.name}</span>
        </div>
      )
    })
  }

  /** The row the 纳入管理 confirmation is for, so the dialog can name it and
      show the directory the click will link. */
  const confirmAdoptRow = confirmAdopt === null ? undefined : skills.find(row => row.id === confirmAdopt)

  return (
    <>
      {skills.map(skill => {
        const open = openSkill === skill.id
        return (
          <div key={skill.id} className="mc-skill">
            <div
              className="mc-skill-row"
              role="button"
              tabIndex={0}
              aria-expanded={open}
              onClick={() => void toggleSkill(skill.id)}
              onKeyDown={(e: KeyboardEvent<HTMLElement>) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  void toggleSkill(skill.id)
                }
              }}
            >
              <IconTriangleRightFill14 size={12} className={`mc-chevron${open ? ' mc-chevron--open' : ''}`} />
              <span className="mc-skill-name">{skill.name}</span>
              <span className="mc-skill-meta">
                {skill.mandatory && <span className="mc-tag">{t('mandatory')}</span>}
                <button
                  type="button"
                  className={`mc-count mc-count--${skill.class}`}
                  disabled={busy || skill.mandatory}
                  title={skill.classLabel}
                  onClick={(e: { stopPropagation(): void }) => {
                    e.stopPropagation()
                    onCycle([skill.id], 'skill')
                  }}
                >
                  <span className={`mc-dot mc-dot--${skill.class}`} aria-hidden="true" />
                  {t(CLASS_SHORT_KEYS[skill.class as CapabilityClass])}
                </button>
                {/* A skill with no manageable entry cannot be repointed, so it
                    gets no 编辑 button. Each such row shows either the action it
                    can take (adopt) or the reason it has none (where it came
                    from) — never both, which would say the same thing twice.
                    A skill shipped by an agent preset is never adoptable: 纳入管理
                    links it into the user root, i.e. makes it global for every
                    session, which is the opposite of what a preset skill is for
                    (it is visible only to sessions that mount that preset). */}
                {!editableSkills.has(skill.id) && (skill.preset !== undefined
                  ? (
                    <span className="mc-source" title={t('skillFromPresetHint')}>
                      {t('skillFromPreset', { preset: skill.preset })}
                    </span>
                  )
                  : ADOPTABLE_SKILL_SOURCES.has(skill.source ?? '')
                    ? (
                      /* The confirmation is a dialog, not an inline strip: a row
                         has no room for a sentence, and pushing one in there
                         pushed the buttons themselves out of view. */
                      <button
                        type="button"
                        className="mc-count mc-count--action"
                        disabled={busy}
                        title={t('adoptSkillHint')}
                        onClick={(e: { stopPropagation(): void }) => {
                          e.stopPropagation()
                          setConfirmAdopt(skill.id)
                        }}
                      >
                        {t('adoptSkill')}
                      </button>
                    )
                    : (
                      <span className="mc-source" title={t('skillSourceHint')}>
                        {t('skillSource', { source: sourceLabel(skill.source, t) })}
                      </span>
                    ))}
                {editableSkills.has(skill.id) && (
                  <button
                    type="button"
                    className="mc-count mc-count--action"
                    disabled={busy}
                    onClick={(e: { stopPropagation(): void }) => {
                      e.stopPropagation()
                      onEditSkill(skill.id, skill.source)
                    }}
                  >
                    {t('edit')}
                  </button>
                )}
              </span>
            </div>
            {open && (
              <div className="mc-skill-body">
                <div className="mc-tree">
                  {renderEntries(tree.dirs[`${skill.id}:`], skill.id, '') ?? (
                    <div className="mc-tree-row">…</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
      {confirmAdopt !== null && (
        <div className="mc-preview-mask" onClick={() => setConfirmAdopt(null)}>
          <div className="mc-preview mc-confirm-dialog" onClick={e => e.stopPropagation()}>
            <div className="mc-preview-head">
              <span className="mc-preview-title">
                {t('adoptSkillTitle', { name: confirmAdoptRow?.name ?? confirmAdopt })}
              </span>
            </div>
            <div className="mc-confirm-body">
              <p>{t('adoptSkillHint')}</p>
              {/* The row gave its 来源 slot to the 纳入管理 button, so the
                  directory is named here instead — the click needs a target. */}
              {confirmAdoptRow !== undefined && (
                <p className="mc-confirm-path">
                  {t('skillSource', { source: confirmAdoptRow.path ?? sourceLabel(confirmAdoptRow.source, t) })}
                </p>
              )}
              <div className="mc-confirm-actions">
                <button type="button" className="mc-catalog-btn" onClick={() => setConfirmAdopt(null)}>
                  {t('cancel')}
                </button>
                <button
                  type="button"
                  className="mc-catalog-btn"
                  onClick={() => {
                    const id = confirmAdopt
                    setConfirmAdopt(null)
                    onAdoptSkill(id)
                  }}
                >
                  {t('adoptSkill')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {preview !== null && (
        <div className="mc-preview-mask" onClick={() => setPreview(null)}>
          <div className="mc-preview" onClick={e => e.stopPropagation()}>
            <div className="mc-preview-head">
              <span className="mc-preview-title">{preview.relPath}</span>
              <button type="button" className="mc-preview-close" onClick={() => setPreview(null)}>
                {t('previewClose')}
              </button>
            </div>
            {preview.content !== undefined ? (
              <pre className="mc-preview-body">{preview.content}</pre>
            ) : (
              <div className="mc-preview-hint">{preview.error ?? '…'}</div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
