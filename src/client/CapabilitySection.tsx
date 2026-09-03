/**
 * ⚠️ VERIFIED AGAINST REAL rc.8 CLIENT API.
 *
 * React section for the 能力管理 settings tab. Follows the real dsh client
 * pattern (see `dsh-client-ui-settings-plugins`): two tabs (工具 / Skills)
 * under one heading, each listing capabilities with a clickable class chip.
 *
 * Layout:
 *   - summary strip   → per-class counts for the active tab (Skills tab counts
 *                       its active 全局/项目 sub-tab)
 *   - tabs            → Tools | Skills (plugins-tab chrome)
 *   - Tools tab       → grouped by server, collapsible disclosure rows; the
 *                       per-class count chip and each tool's class chip are
 *                       clickable to cycle Resident → On-demand → Blocked.
 *                       Harness-native tools (no real MCP server) share the
 *                       reserved `built-in` group, shown as 「系统内置」.
 *   - Skills tab      → sub-tabs 全局技能 / 项目技能 (always visible), each
 *                       with flat skill rows carrying the same clickable class
 *                       chip plus a directory tree / file preview
 */
import { useState, useEffect, useCallback } from 'react'
import type { KeyboardEvent } from 'react'
import { IconTriangleRightFill14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CapabilityPolicyRemote, CapabilitySnapshot, CapabilityRow, CatalogDocs, SkillFileEntry, ToolDetail } from './store.ts'
import { loadSnapshot, unwrap } from './store.ts'

/** Props injected by the settings.section registration (see index.ts). */
export interface CapabilitySectionInjected {
  remote: CapabilityPolicyRemote
  t(key: CapabilityKey, params?: Record<string, unknown>): string
  /** Diagnostic: `$mount` failure surfaced instead of crashing the section. */
  mountError?: string
  /** Diagnostic: namespace methods actually installed on `ctx.remote.capabilityPolicy`. */
  remoteKeys?: string
}

export type CapabilitySectionProps = CapabilitySectionInjected

export type CapabilityKey =
  | 'nav'
  | 'title'
  | 'desc'
  | 'resident'
  | 'on-demand'
  | 'blocked'
  | 'kind'
  | 'class'
  | 'tool'
  | 'skill'
  | 'mandatory'
  | 'rules'
  | 'toolsGroup'
  | 'skillsGroup'
  | 'builtInGroup'
  | 'globalSkills'
  | 'projectSkills'
  | 'emptyTools'
  | 'emptySkills'
  | 'emptyGlobalSkills'
  | 'emptyProjectSkills'
  | 'toolCount'
  | 'residentShort'
  | 'onDemandShort'
  | 'blockedShort'
  | 'cycleHint'
  | 'notPreviewable'
  | 'previewClose'
  | 'detailNotFound'
  | 'cycleOverridden'
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

const CLASS_KEYS = ['resident', 'on-demand', 'blocked'] as const
type CapabilityClass = (typeof CLASS_KEYS)[number]

/** Click-cycle order on machine values (displayed as On-demand → Blocked → Resident). */
const NEXT_CLASS: Record<CapabilityClass, CapabilityClass> = {
  'on-demand': 'blocked',
  blocked: 'resident',
  resident: 'on-demand',
}

/** i18n keys for the short display labels, keyed by the machine class value. */
const CLASS_SHORT_KEYS: Record<CapabilityClass, CapabilityKey> = {
  resident: 'residentShort',
  'on-demand': 'onDemandShort',
  blocked: 'blockedShort',
}

/** Scoped stylesheet: injected once at module scope, like every official bundle. */
const CSS_ID = 'capability-menu-section-css'
const CSS = `
.mc-section{display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary)}
.mc-heading{margin:0;font-size:18px;font-weight:600}
.mc-desc{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px}
.mc-summary{display:flex;gap:12px;flex-wrap:wrap;justify-content:flex-end;align-items:center;padding-bottom:8px}
.mc-catalog-btn{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:20px;padding:0 10px;cursor:pointer;white-space:nowrap}
.mc-catalog-btn:hover{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}
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
.mc-dot--blocked{--mc-dot:#7e7477;background:var(--mc-dot);-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='4.6' fill='none' stroke='%23000' stroke-width='1.4'/%3E%3Cline x1='3' y1='9' x2='9' y2='3' stroke='%23000' stroke-width='1.4' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='4.6' fill='none' stroke='%23000' stroke-width='1.4'/%3E%3Cline x1='3' y1='9' x2='9' y2='3' stroke='%23000' stroke-width='1.4' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat}
body[data-ds-dark-theme] .mc-dot--resident{--mc-dot:#96b6d1}
body[data-ds-dark-theme] .mc-dot--on-demand{--mc-dot:#d4b26b}
body[data-ds-dark-theme] .mc-dot--blocked{--mc-dot:#b8abad}
/* 同上色系（低饱和灰调）：仅文字着色，不加背景，浅/深主题各一档。 */
.mc-chip--resident{color:#527a9c}
.mc-chip--on-demand{color:#a57c33}
.mc-chip--blocked{color:#7e7477}
body[data-ds-dark-theme] .mc-chip--resident{color:#96b6d1}
body[data-ds-dark-theme] .mc-chip--on-demand{color:#d4b26b}
body[data-ds-dark-theme] .mc-chip--blocked{color:#b8abad}
.mc-tabs{border-bottom:1px solid var(--dsw-alias-border-l2);display:flex;align-items:flex-end;justify-content:space-between;gap:22px}
/* Skills sub-tab bar (全局技能/项目技能): same underline chrome, no right-side summary. */
.mc-subtabs{border-bottom:1px solid var(--dsw-alias-border-l2);display:flex;align-items:flex-end;gap:22px}
.mc-tab-group{display:flex;align-items:flex-end;gap:22px}
.mc-tab{color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:0 0;border:0;padding:7px 1px 9px;font-size:13px;line-height:20px;position:relative}
.mc-tab:hover,.mc-tab[data-active=true]{color:var(--dsw-alias-label-primary)}
.mc-tab[data-active=true]:after,.mc-tab:focus-visible:after{background:var(--dsw-alias-label-primary);content:"";border-radius:2px 2px 0 0;height:2px;position:absolute;bottom:-1px;left:0;right:0}
.mc-tab:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;color:var(--dsw-alias-label-primary);border-radius:2px}
.mc-panel{min-width:0;padding-top:12px}
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
.mc-count--blocked{color:#7e7477}
body[data-ds-dark-theme] .mc-count--resident{color:#96b6d1}
body[data-ds-dark-theme] .mc-count--on-demand{color:#d4b26b}
body[data-ds-dark-theme] .mc-count--blocked{color:#b8abad}
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
.mc-error pre{margin:8px 0 0;white-space:pre-wrap;word-break:break-all;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.mc-notice{padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-secondary);font-size:13px}
.mc-skill{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.mc-skill-row{box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;min-width:0;padding:10px 12px;background:0 0;border:0;color:inherit;font:inherit;text-align:left;cursor:pointer}
.mc-skill-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mc-skill-name{font-weight:600;font-size:14px;line-height:20px;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mc-skill-meta{margin-left:auto;display:flex;align-items:center;gap:8px;flex:0 1 auto;min-width:0}
.mc-skill-body{border-top:1px solid var(--dsw-alias-border-l1);padding:8px 12px 12px}
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

/** Group tools by server name; skills stay flat (no server). */
interface Grouped {
  servers: Array<{ server: string; tools: CapabilityRow[] }>
  skills: CapabilityRow[]
}

/** The reserved server key grouping harness-native (non-MCP) tools. */
const BUILT_IN_SERVER = 'built-in'

/** Skills whose source root lives inside the current project. */
const PROJECT_SOURCES = new Set(['project-dsh', 'project-agents'])

function groupRows(rows: readonly CapabilityRow[]): Grouped {
  const byServer = new Map<string, CapabilityRow[]>()
  const skills: CapabilityRow[] = []
  for (const row of rows) {
    if (row.kind === 'skill') {
      skills.push(row)
      continue
    }
    const server = row.server ?? BUILT_IN_SERVER
    const list = byServer.get(server)
    if (list === undefined) byServer.set(server, [row])
    else list.push(row)
  }
  const servers = [...byServer.entries()]
    .map(([server, tools]) => ({ server, tools: [...tools].sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.server.localeCompare(b.server))
  return { servers, skills: [...skills].sort((a, b) => a.name.localeCompare(b.name)) }
}

function countByClass(rows: readonly CapabilityRow[], cls: CapabilityClass): number {
  return rows.reduce((n, row) => (row.class === cls ? n + 1 : n), 0)
}

export function CapabilitySection(props: CapabilitySectionProps): JSX.Element {
  const { remote, t, mountError, remoteKeys } = props
  const [state, setState] = useState<ViewState>({ status: 'loading' })
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
      setState({ status: 'error', message: String(e) })
    }
  }, [remote, mountError])

  useEffect(() => {
    void reload()
  }, [reload])

  const toggleServer = useCallback((server: string) => {
    setOpenServers(prev => {
      const next = new Set(prev)
      if (next.has(server)) next.delete(server)
      else next.add(server)
      return next
    })
  }, [])

  /** Move one or more capability ids to the next class in the click cycle. */
  const cycleClass = useCallback(async (ids: readonly string[], kind: 'tool' | 'skill') => {
    if (ids.length === 0 || busy) return
    setBusy(true)
    try {
      const config = unwrap(await remote.getConfig(), 'capabilityPolicy.getConfig')
      const key = kind === 'skill' ? 'skills' : 'tools'
      const set = config[key]
      const lists: Record<CapabilityClass, string[]> = {
        resident: [],
        'on-demand': [],
        blocked: [],
      }
      for (const cls of CLASS_KEYS) {
        const raw = set && typeof set === 'object' && !Array.isArray(set) ? (set as Record<string, unknown>)[cls] : undefined
        lists[cls] = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
      }
      const first = ids.map(id => state.status === 'ready' ? state.snapshot.rows.find(r => r.id === id)?.class : undefined)
        .find((c): c is CapabilityClass => c !== undefined)
      const from: CapabilityClass = first ?? 'on-demand'
      const to = NEXT_CLASS[from]
      // Remove moved ids from every list, then append to the destination list.
      for (const cls of CLASS_KEYS) {
        lists[cls] = lists[cls].filter(id => !ids.includes(id))
      }
      lists[to] = [...lists[to], ...ids]
      const nextLists: Record<string, string[]> = {}
      for (const cls of CLASS_KEYS) nextLists[cls] = lists[cls]
      await remote.updateConfig({ [key]: nextLists })
      const next = await loadSnapshot(remote)
      setState({ status: 'ready', snapshot: next })
      // Detect silently-overridden changes: a broader wildcard rule (or a hard
      // blocked rule) still wins over the exact id just pinned, so the class
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
          <pre>{`mountError=${String(mountError)}\nremoteKeys=${String(remoteKeys)}`}</pre>
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
}): JSX.Element {
  const { remote, snapshot, openServers, busy, activeTab, t, onTabChange, onToggleServer, onCycle } = props
  const { servers, skills } = groupRows(snapshot.rows)
  // Skills whose source root is inside the current project vs. everything else
  // (user/global dirs, bundled, custom, runtime); skills without a source label
  // belong to the global group.
  const projectSkills = skills.filter(skill => PROJECT_SOURCES.has(skill.source ?? ''))
  const globalSkills = skills.filter(skill => !PROJECT_SOURCES.has(skill.source ?? ''))
  // Which sub-tab the Skills panel shows. Persists across top-tab switches.
  const [skillTab, setSkillTab] = useState<'global' | 'project'>('global')
  // Per-tab statistics: the Tools tab counts tool rows; the Skills tab counts
  // the currently active global/project sub-tab.
  const statRows = activeTab === 'tools'
    ? snapshot.rows.filter(r => r.kind === 'tool')
    : skillTab === 'project' ? projectSkills : globalSkills
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
      <p className="mc-desc">{t('desc')}</p>

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
          <button type="button" className="mc-catalog-btn" onClick={() => void openCatalogDocs()}>
            {t('viewCatalog')}
          </button>
        </div>
      </div>

      <div role="tabpanel" hidden={activeTab !== 'tools'} className="mc-panel">
        <div className="mc-panel-inner">
          {servers.length === 0 ? (
            <p className="mc-empty">{t('emptyTools')}</p>
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

      <div role="tabpanel" hidden={activeTab !== 'skills'} className="mc-panel">
        <div className="mc-panel-inner">
          {skills.length === 0 ? (
            <p className="mc-empty">{t('emptySkills')}</p>
          ) : (
            <>
              <div className="mc-subtabs">
                <div className="mc-tab-group" role="tablist" aria-label={t('skillsGroup')}>
                  <button
                    type="button"
                    role="tab"
                    className="mc-tab"
                    aria-selected={skillTab === 'global'}
                    data-active={skillTab === 'global' ? 'true' : undefined}
                    onClick={() => setSkillTab('global')}
                  >
                    {t('globalSkills')}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className="mc-tab"
                    aria-selected={skillTab === 'project'}
                    data-active={skillTab === 'project' ? 'true' : undefined}
                    onClick={() => setSkillTab('project')}
                  >
                    {t('projectSkills')}
                  </button>
                </div>
              </div>
              {skillTab === 'global' ? (
                globalSkills.length > 0 ? (
                  <SkillList
                    skills={globalSkills}
                    remote={remote}
                    busy={busy}
                    t={t}
                    onCycle={onCycle}
                  />
                ) : (
                  <p className="mc-empty">{t('emptyGlobalSkills')}</p>
                )
              ) : (
                projectSkills.length > 0 ? (
                  <SkillList
                    skills={projectSkills}
                    remote={remote}
                    busy={busy}
                    t={t}
                    onCycle={onCycle}
                  />
                ) : (
                  <p className="mc-empty">{t('emptyProjectSkills')}</p>
                )
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
}): JSX.Element {
  const { skills, remote, busy, t, onCycle } = props
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
