/**
 * 已登记位置（Registered locations）panel: the places capabilities come from.
 *
 * Mounted below the classification lists in the 能力菜单 tab. Every mutation
 * goes through the `capabilityPolicy` remote, which edits the patch file and
 * lets dsh hot-reload mount or unmount the source — so the panel never mounts
 * anything itself, it just declares and removes rows.
 *
 * Because the browser has no push channel, `onChanged` asks the parent to
 * re-pull the classification list (see the refresh button) after a mutation.
 */
import { useCallback, useEffect, useState } from 'react'
import type { CapabilityKey } from './CapabilitySection.tsx'
import { unwrap, type CapabilityPolicyRemote, type McpLocation, type SkillLocation } from './store.ts'

export type Translate = (key: CapabilityKey, params?: Record<string, unknown>) => string

export interface LocationsPanelProps {
  remote: CapabilityPolicyRemote
  t: Translate
  /** Ask the parent to re-pull the catalog after a mutation. */
  onChanged: () => void
}

const CSS_ID = 'capability-menu-locations-css'
const CSS = `
.ml-block{display:flex;flex-direction:column;gap:8px}
.ml-section-title{margin:0;font-size:15px;font-weight:600}
.ml-block-title{margin:0;font-size:14px;font-weight:600}
.ml-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--dsw-alias-border-l1)}
.ml-name{font-size:13px;font-weight:500}
.ml-meta{font-size:12px;color:var(--dsw-alias-label-tertiary);word-break:break-all}
.ml-tag{font-size:11px;line-height:18px;padding:0 6px;border-radius:4px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}
.ml-spacer{flex:1 1 auto}
.ml-btn{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:20px;padding:0 10px;cursor:pointer;white-space:nowrap}
.ml-btn:hover{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}
.ml-btn--danger:hover{color:#b3261e;border-color:#b3261e}
.ml-btn:disabled{opacity:.55;cursor:default}
.ml-form{display:flex;flex-direction:column;gap:6px;padding:8px 0}
.ml-field{display:flex;align-items:center;gap:8px}
.ml-label{font-size:12px;color:var(--dsw-alias-label-tertiary);min-width:88px}
.ml-input{flex:1 1 auto;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:12px;line-height:20px;padding:2px 8px}
.ml-empty{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.ml-error{margin:0;font-size:12px;color:#b3261e;word-break:break-word}
`
if (typeof document !== 'undefined' && document.querySelector(`style[data-css-id="${CSS_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.cssId = CSS_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

type Transport = 'stdio' | 'streamable-http'

export function LocationsPanel({ remote, t, onChanged }: LocationsPanelProps): JSX.Element {
  const [mcp, setMcp] = useState<McpLocation[]>([])
  const [skills, setSkills] = useState<SkillLocation[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [addingMcp, setAddingMcp] = useState(false)
  const [addingSkill, setAddingSkill] = useState(false)

  // Form state (single form per kind keeps the panel small).
  const [serverName, setServerName] = useState('')
  const [transport, setTransport] = useState<Transport>('stdio')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [url, setUrl] = useState('')
  const [skillDir, setSkillDir] = useState('')

  const reload = useCallback(async () => {
    try {
      const [mcpRows, skillRows] = await Promise.all([
        remote.listLocations().then(result => unwrap(result, 'capabilityPolicy.listLocations')),
        remote.listSkillLocations().then(result => unwrap(result, 'capabilityPolicy.listSkillLocations')),
      ])
      setMcp(mcpRows)
      setSkills(skillRows)
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }, [remote])

  useEffect(() => {
    void reload()
  }, [reload])

  /** Run a mutation, then refresh both the panel and the parent's list. */
  const mutate = useCallback(async (action: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try {
      await action()
      setError(null)
      await reload()
      onChanged()
    } catch (e) {
      // A patch write makes dsh hot-reload, which can dispose the very remote
      // face mid-flight; say so plainly instead of showing a bare error.
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }, [busy, reload, onChanged])

  const submitMcp = useCallback(() => {
    const trimmed = serverName.trim()
    if (trimmed.length === 0) return
    void mutate(async () => {
      unwrap(await remote.addLocation({
        serverName: trimmed,
        transport,
        ...transport === 'stdio'
          ? { command: command.trim(), ...args.trim().length > 0 ? { args: args.trim().split(/\s+/) } : {} }
          : { url: url.trim() },
      }), 'capabilityPolicy.addLocation')
      setServerName('')
      setCommand('')
      setArgs('')
      setUrl('')
      setAddingMcp(false)
    })
  }, [mutate, remote, serverName, transport, command, args, url])

  const submitSkill = useCallback(() => {
    const trimmed = skillDir.trim()
    if (trimmed.length === 0) return
    void mutate(async () => {
      unwrap(await remote.addSkillLocation(trimmed), 'capabilityPolicy.addSkillLocation')
      setSkillDir('')
      setAddingSkill(false)
    })
  }, [mutate, remote, skillDir])

  return (
    <div className="mc-block">
      <p className="ml-section-title">{t('locations')}</p>
      <div className="ml-block">
        <p className="ml-block-title">{t('mcpServers')}</p>
        {error !== null && <p className="ml-error">{error}</p>}
        {mcp.length === 0
          ? <p className="ml-empty">{t('emptyMcp')}</p>
          : mcp.map(row => (
            <div key={row.id} className="ml-row">
              <span className="ml-name">{row.serverName}</span>
              <span className="ml-tag">{row.transport}</span>
              {row.disabled && <span className="ml-tag">{t('disabledShort')}</span>}
              <span className="ml-meta">{row.command ?? row.url ?? ''}</span>
              <span className="ml-spacer" />
              <button
                type="button"
                className="ml-btn"
                disabled={busy}
                onClick={() => void mutate(async () => {
                  unwrap(await remote.setLocationEnabled(row.id, row.disabled), 'capabilityPolicy.setLocationEnabled')
                })}
              >
                {row.disabled ? t('enable') : t('disable')}
              </button>
              <button
                type="button"
                className="ml-btn ml-btn--danger"
                disabled={busy}
                onClick={() => void mutate(async () => {
                  unwrap(await remote.removeLocation(row.id), 'capabilityPolicy.removeLocation')
                })}
              >
                {t('remove')}
              </button>
            </div>
          ))}
        {addingMcp
          ? (
            <div className="ml-form">
              <div className="ml-field">
                <span className="ml-label">{t('serverName')}</span>
                <input className="ml-input" value={serverName} onChange={e => setServerName(e.target.value)} />
              </div>
              <div className="ml-field">
                <span className="ml-label">{t('transport')}</span>
                <select
                  className="ml-input"
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
                    <div className="ml-field">
                      <span className="ml-label">{t('command')}</span>
                      <input className="ml-input" value={command} onChange={e => setCommand(e.target.value)} />
                    </div>
                    <div className="ml-field">
                      <span className="ml-label">{t('args')}</span>
                      <input className="ml-input" value={args} onChange={e => setArgs(e.target.value)} />
                    </div>
                  </>
                )
                : (
                  <div className="ml-field">
                    <span className="ml-label">{t('url')}</span>
                    <input className="ml-input" value={url} onChange={e => setUrl(e.target.value)} />
                  </div>
                )}
              <div className="ml-field">
                <button type="button" className="ml-btn" disabled={busy} onClick={() => void submitMcp()}>{t('add')}</button>
                <button type="button" className="ml-btn" onClick={() => setAddingMcp(false)}>{t('cancel')}</button>
              </div>
            </div>
          )
          : (
            <div className="ml-field">
              <button type="button" className="ml-btn" onClick={() => setAddingMcp(true)}>{t('addMcp')}</button>
            </div>
          )}
      </div>

      <div className="ml-block">
        <p className="ml-block-title">{t('skillDirs')}</p>
        {skills.length === 0
          ? <p className="ml-empty">{t('emptySkillDirs')}</p>
          : skills.map(row => (
            <div key={row.name} className="ml-row">
              <span className="ml-name">{row.name}</span>
              {row.linked && <span className="ml-tag">link</span>}
              {!row.valid && <span className="ml-tag">{t('noManifest')}</span>}
              <span className="ml-meta">{row.path}</span>
              <span className="ml-spacer" />
              <button
                type="button"
                className="ml-btn ml-btn--danger"
                disabled={busy}
                onClick={() => void mutate(async () => {
                  unwrap(await remote.removeSkillLocation(row.name), 'capabilityPolicy.removeSkillLocation')
                })}
              >
                {t('remove')}
              </button>
            </div>
          ))}
        {addingSkill
          ? (
            <div className="ml-form">
              <div className="ml-field">
                <span className="ml-label">{t('skillDirPath')}</span>
                <input className="ml-input" value={skillDir} onChange={e => setSkillDir(e.target.value)} />
              </div>
              <div className="ml-field">
                <button type="button" className="ml-btn" disabled={busy} onClick={() => void submitSkill()}>{t('add')}</button>
                <button type="button" className="ml-btn" onClick={() => setAddingSkill(false)}>{t('cancel')}</button>
              </div>
            </div>
          )
          : (
            <div className="ml-field">
              <button type="button" className="ml-btn" onClick={() => setAddingSkill(true)}>{t('addSkill')}</button>
            </div>
          )}
      </div>
    </div>
  )
}

export default LocationsPanel
