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
  /** Runs after a successful mutation; `notice` reports what changed, when worth saying. */
  onChanged: (notice?: string) => void
}

const CSS_ID = 'capability-menu-location-css'
const CSS = `
.lm-block{display:flex;flex-direction:column;gap:8px}
.lm-btn{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:20px;padding:0 10px;cursor:pointer;white-space:nowrap}
.lm-btn:hover{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}
.lm-btn--danger:hover{color:#b3261e;border-color:#b3261e}
.lm-btn:disabled{opacity:.55;cursor:default}
/* Each field is its own two-column grid with a fixed label track.
   A single form-wide grid looked tidier but was fragile: it needed
   .lm-field{display:contents}, which turned every hint into a free-floating grid
   item, and one extra half-width item pushed the following labels into column 2 and
   their inputs into column 1 — which is exactly how the streamable-http layout got
   scrambled (that branch has an odd number of items). Per-field grids mean a hint
   can only ever affect its own field, and a fixed label track (rather than
   min-width, which sizes per row) keeps every label column identical. */
.lm-form{display:flex;flex-direction:column;gap:6px}
.lm-field{--lm-label-w:104px;display:grid;grid-template-columns:var(--lm-label-w) 1fr;gap:2px 8px;align-items:start}
.lm-label{grid-column:1;min-width:0;overflow-wrap:anywhere;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
/* width:100% must come with border-box: the field carries a 1px border plus 8px of
   padding, which would otherwise overflow the column and clip. */
.lm-input{grid-column:2;width:100%;box-sizing:border-box;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:12px;line-height:20px;padding:2px 8px}
.lm-input:disabled{opacity:.6}
textarea.lm-input{resize:vertical;font-family:var(--dsw-font-markdown-code-block-font-family)}
/* Lives inside its field, in the content column: it lines up with the box it
   annotates and takes the caption colour so it does not read as another label. */
.lm-hint{grid-column:2;margin:0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption)}
.lm-error{margin:0;font-size:12px;color:#b3261e;word-break:break-word}
.lm-actions{display:flex;gap:8px;justify-content:flex-end;padding:4px 0 0}
/* Removal is irreversible, so it takes over the action row for one confirmation
   step: the message states the consequence, then the buttons act. */
.lm-confirm{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;border:1px solid #b3261e;border-radius:6px}
.lm-confirm-msg{flex:1 1 auto;margin:0;font-size:12px;line-height:18px;word-break:break-word}
.lm-confirm-actions{display:flex;gap:8px;flex-shrink:0}
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
  /** 移除 takes over the action row for one confirmation step. */
  const [confirmRemove, setConfirmRemove] = useState(false)

  // MCP form. Prefilled from the entry when editing; `serverName` stays fixed.
  const [serverName, setServerName] = useState(editMcp?.serverName ?? '')
  // Registration defaults to streamable-http: it needs only a URL, and it is what
  // a service-hosted MCP endpoint looks like. dsh's own contract marks `transport`
  // required with no default, so the form is free to pick the cheaper one; edit
  // mode always follows the row being edited.
  const [transport, setTransport] = useState<Transport>(editMcp?.transport ?? 'streamable-http')
  const [command, setCommand] = useState(editMcp?.command ?? '')
  const [args, setArgs] = useState((editMcp?.args ?? []).join(' '))
  const [cwd, setCwd] = useState(editMcp?.cwd ?? '')
  const [env, setEnv] = useState(toLines(editMcp?.env))
  const [url, setUrl] = useState(editMcp?.url ?? '')
  const [headers, setHeaders] = useState(toLines(editMcp?.headers))
  const [timeoutSec, setTimeoutSec] = useState(
    editMcp?.toolCallTimeoutMs === undefined ? '' : String(Math.round(editMcp.toolCallTimeoutMs / 1000)),
  )
  // Skill form. `target` is the directory the entry points at, so editing shows
  // the real source rather than our own symlink under the skill root.
  const [skillDir, setSkillDir] = useState(editSkill?.target ?? editSkill?.path ?? '')
  const [skillRoot, setSkillRoot] = useState<'user' | 'project'>(editSkill?.root ?? 'user')
  /** A path inside the project; the server derives the project root from it. */
  const [projectPath, setProjectPath] = useState('')

  const title = useMemo(() => {
    if (editMcp !== undefined) return t('editMcp')
    // A skill's name is derived (and immutable), so it is stated here rather than
    // given a field that would only ever look editable-but-disabled.
    if (editSkill !== undefined) return t('editSkillNamed', { name: editSkill.name })
    return t('registerCapability')
  }, [editMcp, editSkill, t])

  /** Run a mutation; on success close and ask the parent to re-pull. */
  const submit = useCallback(async (action: () => Promise<unknown>, noticeFor?: (result: unknown) => string) => {
    if (busy) return
    setBusy(true)
    try {
      const changed = await action()
      if (changed === false) throw new Error(t('entryNotFound'))
      setError(null)
      onChanged(noticeFor?.(changed))
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
    const asked = skillRoot === 'project' ? projectPath.trim() : undefined
    void submit(
      async () => editSkill !== undefined
        ? unwrapMessage(await remote.updateSkillLocation(editSkill.name, skillDir.trim(), editSkill.entryDir))
        : unwrapMessage(await remote.addSkillLocation(skillDir.trim(), asked)),
      result => editSkill !== undefined
        ? t('skillRepointed', { dir: skillDir.trim() })
        : t('skillRegisteredAt', { path: String(result) }),
    )
  }, [submit, remote, editSkill, skillDir, skillRoot, projectPath, t])

  const remove = useCallback(() => {
    if (editMcp !== undefined) {
      void submit(async () => unwrapMessage(await remote.removeLocation(editMcp.id)))
      return
    }
    if (editSkill !== undefined) {
      void submit(async () => unwrapMessage(await remote.removeSkillLocation(editSkill.name, editSkill.entryDir)))
    }
  }, [submit, remote, editMcp, editSkill])

  /**
   * What removal actually costs, which differs by target: an MCP row only loses
   * its config, a linked skill only loses its symlink — but `removeSkill`
   * recursively deletes a *real* directory in the skill root, so that case has to
   * say so before the click, not after.
   */
  const removalWarning = useMemo(() => {
    if (editMcp !== undefined) return t('confirmRemoveMcp', { name: editMcp.serverName })
    if (editSkill === undefined) return ''
    return editSkill.linked
      ? t('confirmRemoveSkillLink', { name: editSkill.name })
      : t('confirmRemoveSkillDir', { name: editSkill.name })
  }, [editMcp, editSkill, t])

  /** The action row, or the confirmation step that replaces it once 移除 is pressed. */
  const renderActions = (onSubmit: () => void): JSX.Element => confirmRemove
    ? (
      <div className="lm-confirm" role="alert">
        <p className="lm-confirm-msg">{removalWarning}</p>
        <div className="lm-confirm-actions">
          <button type="button" className="lm-btn" disabled={busy} onClick={() => setConfirmRemove(false)}>
            {t('cancel')}
          </button>
          <button type="button" className="lm-btn lm-btn--danger" disabled={busy} onClick={() => void remove()}>
            {t('confirmRemove')}
          </button>
        </div>
      </div>
    )
    : (
      <div className="lm-actions">
        <button type="button" className="lm-btn" disabled={busy} onClick={onSubmit}>
          {editing ? t('save') : t('register')}
        </button>
        {editing && (
          <button type="button" className="lm-btn lm-btn--danger" disabled={busy} onClick={() => setConfirmRemove(true)}>
            {t('remove')}
          </button>
        )}
      </div>
    )

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
                  {/* Transport first: it is the only field that decides which
                      fields follow, and in edit mode the fields above it would
                      otherwise be the read-only one. Mirrors the order of the
                      dsh-mcp-client config contract (transport, then serverName). */}
                  <div className="lm-field">
                    <span className="lm-label">{t('transport')}</span>
                    <select
                      className="lm-input"
                      value={transport}
                      onChange={e => setTransport(e.target.value === 'stdio' ? 'stdio' : 'streamable-http')}
                    >
                      <option value="stdio">{t('transportStdio')}</option>
                      <option value="streamable-http">{t('transportHttp')}</option>
                    </select>
                    <p className="lm-hint">
                      {transport === 'stdio' ? t('transportHintStdio') : t('transportHintHttp')}
                    </p>
                  </div>
                  <div className="lm-field">
                    <span className="lm-label">{t('serverName')}</span>
                    <input
                      className="lm-input"
                      value={serverName}
                      disabled={editMcp !== undefined}
                      onChange={e => setServerName(e.target.value)}
                    />
                    {editMcp !== undefined && <p className="lm-hint">{t('serverNameImmutable')}</p>}
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
                          <p className="lm-hint">{t('headersHint')}</p>
                        </div>
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
                  {renderActions(() => void submitMcp())}
                </div>
              </div>
            )
            : (
              <div className="lm-block">
                <div className="lm-form">
                  {/* Which root the skill lands in. Editing never moves an entry
                      between roots (a move is remove + register), so it is shown
                      read-only there. */}
                  <div className="lm-field">
                    <span className="lm-label">{t('skillRoot')}</span>
                    {editSkill !== undefined
                      ? <input className="lm-input" value={t(editSkill.root === 'project' ? 'skillRootProject' : 'skillRootUser')} disabled />
                      : (
                        <select
                          className="lm-input"
                          value={skillRoot}
                          onChange={e => setSkillRoot(e.target.value === 'project' ? 'project' : 'user')}
                        >
                          <option value="user">{t('skillRootUser')}</option>
                          <option value="project">{t('skillRootProject')}</option>
                        </select>
                      )}
                    <p className="lm-hint">
                      {skillRoot === 'project' || editSkill?.root === 'project'
                        ? t('skillRootHintProject')
                        : t('skillRootHintUser')}
                    </p>
                  </div>
                  {editSkill === undefined && skillRoot === 'project' && (
                    <div className="lm-field">
                      <span className="lm-label">{t('skillProjectPath')}</span>
                      <input className="lm-input" value={projectPath} onChange={e => setProjectPath(e.target.value)} />
                      <p className="lm-hint">{t('skillProjectPathHint')}</p>
                    </div>
                  )}
                  <div className="lm-field">
                    <span className="lm-label">{t('skillDirPath')}</span>
                    <input className="lm-input" value={skillDir} onChange={e => setSkillDir(e.target.value)} />
                    <p className="lm-hint">{t('skillDirHint')}</p>
                  </div>
                  {renderActions(() => void submitSkill())}
                </div>
              </div>
            )}
        </div>
      </div>
    </div>
  )
}

export default LocationModal
