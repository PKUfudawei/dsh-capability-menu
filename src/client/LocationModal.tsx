/**
 * 能力来源弹窗：注册与编辑 MCP 服务器 / Skill 目录。
 *
 * Two modes, one form implementation:
 *
 * - **注册** — opened from the header's 注册能力 button. Carries the two
 *   sub-tabs (MCP servers / skill directories) and opens on the one matching
 *   the main tab the user is on, so one button is context-sensitive. No list of
 *   what is already registered: that lives on the entries themselves, behind
 *   the per-row 编辑 buttons, where it is actually actionable.
 * - **编辑** — opened from a row's 编辑 button with the entry prefilled.
 *
 * Only 注册 / 保存 / 移除 are offered. Temporarily silencing a source is the
 * exposure policy's job (classify the capability as Disabled), so there is no
 * second enable switch here.
 */
import { useCallback, useMemo, useState } from 'react'
import type { CapabilityKey } from './CapabilitySection.tsx'
import {
  unwrapMessage,
  type CapabilityPolicyRemote,
  type McpLocation,
  type McpUpdateInput,
  type SkillLocation,
} from './store.ts'

export type Translate = (key: CapabilityKey, params?: Record<string, unknown>) => string

export interface LocationModalProps {
  remote: CapabilityPolicyRemote
  t: Translate
  /** 注册 mode: which sub-tab to open on (follows the main tab). */
  defaultKind?: 'mcp' | 'skill'
  /** 编辑 mode: the MCP server being edited. */
  editMcp?: McpLocation
  /** 编辑 mode: the skill directory being edited. */
  editSkill?: SkillLocation
  onClose: () => void
  onChanged: () => void
}

const CSS_ID = 'capability-menu-location-css'
const CSS = `
.lm-block{display:flex;flex-direction:column;gap:8px}
.lm-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0}
.lm-tag{font-size:11px;line-height:18px;padding:0 6px;border-radius:4px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}
.lm-btn{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:20px;padding:0 10px;cursor:pointer;white-space:nowrap}
.lm-btn:hover{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}
.lm-btn--danger:hover{color:#b3261e;border-color:#b3261e}
.lm-btn:disabled{opacity:.55;cursor:default}
.lm-form{display:flex;flex-direction:column;gap:6px}
.lm-field{display:flex;align-items:flex-start;gap:8px}
.lm-label{font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary);min-width:104px;flex:none}
.lm-input{flex:1 1 auto;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:12px;line-height:20px;padding:2px 8px}
.lm-input:disabled{opacity:.6}
textarea.lm-input{resize:vertical;font-family:var(--dsw-font-markdown-code-block-font-family)}
.lm-hint{margin:0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.lm-error{margin:0;font-size:12px;color:#b3261e;word-break:break-word}
.lm-actions{display:flex;gap:8px;padding:4px 0 0}
/* The modal shell itself carries no padding (it is shared with the read-only
   catalog viewer, whose body supplies its own); the form supplies it here. */
.lm-body{padding:14px 16px;overflow:auto;flex:1 1 auto;min-height:0}
`
if (typeof document !== 'undefined' && document.querySelector(`style[data-css-id="${CSS_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.cssId = CSS_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

type SubTab = 'mcp' | 'skill'
type Transport = 'stdio' | 'streamable-http'

/** Render a key/value map as `Key: Value` lines. */
function toLines(record: Readonly<Record<string, string>> | undefined): string {
  if (record === undefined) return ''
  return Object.entries(record).map(([key, value]) => `${key}: ${value}`).join('\n')
}

/** Parse `Key: Value` lines into a map; blank lines and lines without `:` are skipped. */
function fromLines(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const at = trimmed.indexOf(':')
    if (at <= 0) continue
    const key = trimmed.slice(0, at).trim()
    const value = trimmed.slice(at + 1).trim()
    if (key.length > 0) out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function LocationModal(props: LocationModalProps): JSX.Element {
  const { remote, t, defaultKind = 'mcp', editMcp, editSkill, onClose, onChanged } = props
  const editing = editMcp !== undefined || editSkill !== undefined

  const [subTab, setSubTab] = useState<SubTab>(
    editSkill !== undefined ? 'skill' : editMcp !== undefined ? 'mcp' : defaultKind,
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // MCP form. Prefilled from the entry when editing; `serverName` stays fixed.
  const [serverName, setServerName] = useState(editMcp?.serverName ?? '')
  const [transport, setTransport] = useState<Transport>(editMcp?.transport ?? 'stdio')
  const [command, setCommand] = useState(editMcp?.command ?? '')
  const [args, setArgs] = useState((editMcp?.args ?? []).join(' '))
  const [cwd, setCwd] = useState(editMcp?.cwd ?? '')
  const [env, setEnv] = useState(toLines(editMcp?.env))
  const [url, setUrl] = useState(editMcp?.url ?? '')
  const [headers, setHeaders] = useState(toLines(editMcp?.headers))
  const [timeoutSec, setTimeoutSec] = useState(
    editMcp?.toolCallTimeoutMs === undefined ? '' : String(Math.round(editMcp.toolCallTimeoutMs / 1000)),
  )
  // Skill form
  const [skillDir, setSkillDir] = useState(editSkill?.path ?? '')

  const title = useMemo(() => {
    if (editMcp !== undefined) return t('editMcp')
    if (editSkill !== undefined) return t('editSkill')
    return t('registerCapability')
  }, [editMcp, editSkill, t])

  /** Run a mutation; on success close and ask the parent to re-pull. */
  const submit = useCallback(async (action: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try {
      const changed = await action()
      if (changed === false) throw new Error(t('entryNotFound'))
      setError(null)
      onChanged()
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }, [busy, onChanged, onClose, t])

  const submitMcp = useCallback(() => {
    const trimmedTimeout = timeoutSec.trim()
    const timeoutMs = trimmedTimeout.length === 0 ? undefined : Math.round(Number(trimmedTimeout) * 1000)
    if (timeoutMs !== undefined && !Number.isFinite(timeoutMs)) {
      setError(t('timeoutInvalid'))
      return
    }
    const parsedEnv = fromLines(env)
    const parsedHeaders = fromLines(headers)
    const common: McpUpdateInput = {
      transport,
      ...transport === 'stdio'
        ? {
            command: command.trim(),
            ...args.trim().length > 0 ? { args: args.trim().split(/\s+/) } : {},
            ...parsedEnv !== undefined ? { env: parsedEnv } : {},
            ...cwd.trim().length > 0 ? { cwd: cwd.trim() } : {},
          }
        : {
            url: url.trim(),
            ...parsedHeaders !== undefined ? { headers: parsedHeaders } : {},
          },
      ...timeoutMs !== undefined ? { toolCallTimeoutMs: timeoutMs } : {},
    }
    void submit(async () => editMcp !== undefined
      ? unwrapMessage(await remote.updateLocation(editMcp.id, common))
      : unwrapMessage(await remote.addLocation({ serverName: serverName.trim(), ...common })))
  }, [submit, remote, editMcp, serverName, transport, command, args, cwd, env, url, headers, timeoutSec, t])

  const submitSkill = useCallback(() => {
    void submit(async () => editSkill !== undefined
      ? unwrapMessage(await remote.updateSkillLocation(editSkill.name, skillDir.trim()))
      : unwrapMessage(await remote.addSkillLocation(skillDir.trim())))
  }, [submit, remote, editSkill, skillDir])

  const remove = useCallback(() => {
    if (editMcp !== undefined) {
      void submit(async () => unwrapMessage(await remote.removeLocation(editMcp.id)))
      return
    }
    if (editSkill !== undefined) {
      void submit(async () => unwrapMessage(await remote.removeSkillLocation(editSkill.name)))
    }
  }, [submit, remote, editMcp, editSkill])

  return (
    <div className="mc-preview-mask" onClick={onClose}>
      <div className="mc-preview" onClick={e => e.stopPropagation()}>
        <div className="mc-preview-head">
          <span className="mc-preview-title">{title}</span>
          <button type="button" className="mc-preview-close" onClick={onClose}>
            {t('previewClose')}
          </button>
        </div>

        {!editing && (
          <div className="mc-subtabs mc-catalog-tabs">
            <div className="mc-tab-group" role="tablist" aria-label={t('registerCapability')}>
              <button
                type="button"
                role="tab"
                className="mc-tab"
                aria-selected={subTab === 'mcp'}
                data-active={subTab === 'mcp' ? 'true' : undefined}
                onClick={() => setSubTab('mcp')}
              >
                {t('mcpServers')}
              </button>
              <button
                type="button"
                role="tab"
                className="mc-tab"
                aria-selected={subTab === 'skill'}
                data-active={subTab === 'skill' ? 'true' : undefined}
                onClick={() => setSubTab('skill')}
              >
                {t('skillDirs')}
              </button>
            </div>
          </div>
        )}

        <div className="lm-body">
          {error !== null && <p className="lm-error">{error}</p>}

          {subTab === 'mcp'
            ? (
              <div className="lm-block">
                <div className="lm-form">
                  <div className="lm-field">
                    <span className="lm-label">{t('serverName')}</span>
                    <input
                      className="lm-input"
                      value={serverName}
                      disabled={editMcp !== undefined}
                      onChange={e => setServerName(e.target.value)}
                    />
                  </div>
                  {editMcp !== undefined && <p className="lm-hint">{t('serverNameImmutable')}</p>}
                  <div className="lm-field">
                    <span className="lm-label">{t('transport')}</span>
                    <select
                      className="lm-input"
                      value={transport}
                      onChange={e => setTransport(e.target.value === 'stdio' ? 'stdio' : 'streamable-http')}
                    >
                      <option value="stdio">stdio</option>
                      <option value="streamable-http">streamable-http</option>
                    </select>
                  </div>
                  {transport === 'stdio'
                    ? (
                      <>
                        <div className="lm-field">
                          <span className="lm-label">{t('command')}</span>
                          <input className="lm-input" value={command} onChange={e => setCommand(e.target.value)} />
                        </div>
                        <div className="lm-field">
                          <span className="lm-label">{t('args')}</span>
                          <input className="lm-input" value={args} onChange={e => setArgs(e.target.value)} />
                        </div>
                        <div className="lm-field">
                          <span className="lm-label">{t('cwd')}</span>
                          <input className="lm-input" value={cwd} onChange={e => setCwd(e.target.value)} />
                        </div>
                        <div className="lm-field">
                          <span className="lm-label">{t('env')}</span>
                          <textarea className="lm-input" rows={3} value={env} onChange={e => setEnv(e.target.value)} />
                        </div>
                      </>
                    )
                    : (
                      <>
                        <div className="lm-field">
                          <span className="lm-label">{t('url')}</span>
                          <input className="lm-input" value={url} onChange={e => setUrl(e.target.value)} />
                        </div>
                        <div className="lm-field">
                          <span className="lm-label">{t('headers')}</span>
                          <textarea className="lm-input" rows={4} value={headers} onChange={e => setHeaders(e.target.value)} />
                        </div>
                        <p className="lm-hint">{t('headersHint')}</p>
                      </>
                    )}
                  <div className="lm-field">
                    <span className="lm-label">{t('timeout')}</span>
                    <input
                      className="lm-input"
                      value={timeoutSec}
                      placeholder="60"
                      onChange={e => setTimeoutSec(e.target.value)}
                    />
                  </div>
                  <div className="lm-actions">
                    <button type="button" className="lm-btn" disabled={busy} onClick={() => void submitMcp()}>
                      {editMcp !== undefined ? t('save') : t('register')}
                    </button>
                    {editMcp !== undefined && (
                      <button type="button" className="lm-btn lm-btn--danger" disabled={busy} onClick={() => void remove()}>
                        {t('remove')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
            : (
              <div className="lm-block">
                <div className="lm-form">
                  <div className="lm-field">
                    <span className="lm-label">{t('skillName')}</span>
                    <input className="lm-input" value={editSkill?.name ?? ''} disabled placeholder="—" />
                  </div>
                  <div className="lm-field">
                    <span className="lm-label">{t('skillDirPath')}</span>
                    <input className="lm-input" value={skillDir} onChange={e => setSkillDir(e.target.value)} />
                  </div>
                  <p className="lm-hint">{t('skillDirHint')}</p>
                  <div className="lm-actions">
                    <button type="button" className="lm-btn" disabled={busy} onClick={() => void submitSkill()}>
                      {editSkill !== undefined ? t('save') : t('register')}
                    </button>
                    {editSkill !== undefined && (
                      <button type="button" className="lm-btn lm-btn--danger" disabled={busy} onClick={() => void remove()}>
                        {t('remove')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
        </div>
      </div>
    </div>
  )
}

export default LocationModal
