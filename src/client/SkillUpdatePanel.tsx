import { useCallback, useEffect, useRef, useState } from 'react'
import type { CapabilityPolicyRemote, SkillLocation, SkillUpdateStatus } from './store.ts'
import { unwrap } from './store.ts'
import { runSkillUpdateBatch } from './skillUpdateBatch.ts'
import { skillUpdateError, summarizeSkillChecks } from './skillUpdatePresentation.ts'
import type { CapabilityKey } from './CapabilitySection.tsx'

interface Row {
  entry: SkillLocation
  status?: SkillUpdateStatus
  error?: ReturnType<typeof skillUpdateError>
}
const CHECK_INTERVAL_MS = 60 * 60 * 1000

export function SkillUpdatePanel(props: {
  remote: CapabilityPolicyRemote
  active: boolean
  t(key: CapabilityKey, params?: Record<string, unknown>): string
  onUpdated(): void
  onAvailableCount(count: number): void
}): JSX.Element {
  const { remote, active, t, onUpdated, onAvailableCount } = props
  const [rows, setRows] = useState<Row[]>([])
  const [sourceDraft, setSourceDraft] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<Record<string, boolean>>({})
  const [phase, setPhase] = useState<'idle' | 'checking' | 'updating' | 'associating'>('idle')
  const [progress, setProgress] = useState('')
  const [currentPath, setCurrentPath] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const running = useRef(false)

  useEffect(() => {
    setElapsed(0)
    if (phase === 'idle') return
    const start = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [phase])

  const checkAll = useCallback(async () => {
    if (running.current) return
    running.current = true
    setPhase('checking')
    setProgress('')
    try {
      const entries = unwrap(await remote.listSkillLocations(), 'capabilityPolicy.listSkillLocations').filter(entry => !entry.linked && entry.valid)
      const checked: Row[] = []
      setRows(entries.map(entry => ({ entry })))
      for (const [index, entry] of entries.entries()) {
        setCurrentPath(entry.path)
        setProgress(t('skillCheckProgress', { name: entry.skillName ?? entry.name, done: index, total: entries.length }))
        let row: Row
        try {
          row = { entry, status: unwrap(await remote.checkSkillUpdate(entry.name, entry.entryDir), 'capabilityPolicy.checkSkillUpdate') }
        } catch (error) { row = { entry, error: skillUpdateError(error) } }
        checked.push(row)
        setRows(previous => previous.map(item => item.entry.path === entry.path ? row : item))
      }
      setProgress(t('skillCheckComplete', { total: entries.length, ...summarizeSkillChecks(checked) }))
    } catch (error) {
      setProgress(skillUpdateError(error).message)
    } finally {
      running.current = false
      setCurrentPath('')
      setPhase('idle')
    }
  }, [remote, t])

  useEffect(() => {
    if (!active) return undefined
    void checkAll()
    const timer = setInterval(() => void checkAll(), CHECK_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [active, checkAll])

  const updateRows = useCallback(async (selected: Row[]) => {
    if (running.current || selected.length === 0) return
    running.current = true
    setPhase('updating')
    let succeeded = 0
    let failed = 0
    try {
      await runSkillUpdateBatch(selected,
        async row => {
          setCurrentPath(row.entry.path)
          setProgress(t('skillUpdatingItem', { name: row.entry.skillName ?? row.entry.name, done: succeeded + failed, total: selected.length }))
          const { revision } = unwrap(await remote.updateSkillFromGitHub(row.entry.name, row.entry.entryDir), 'capabilityPolicy.updateSkillFromGitHub')
          return { ...row.status, name: row.entry.name, entryDir: row.entry.entryDir,
            status: 'current' as const, installedRevision: revision, latestRevision: revision, changedFiles: undefined, compareUrl: undefined }
        },
        (row, result) => {
          if (result.ok) succeeded++; else failed++
          setRows(previous => previous.map(item => item.entry.path !== row.entry.path ? item
            : result.ok ? { entry: item.entry, status: result.value } : { ...item, error: skillUpdateError(result.error) }))
        },
        () => {},
      )
      setProgress(t('skillUpdateComplete', { succeeded, failed }))
      onUpdated()
    } finally {
      running.current = false
      setCurrentPath('')
      setPhase('idle')
    }
  }, [remote, t, onUpdated])

  const changeSource = useCallback(async (row: Row, unlink = false) => {
    if (running.current) return
    running.current = true
    setPhase('associating')
    setCurrentPath(row.entry.path)
    setProgress(t(unlink ? 'skillUnlinking' : 'skillAssociatingItem', { name: row.entry.skillName ?? row.entry.name }))
    try {
      let status: SkillUpdateStatus
      if (unlink) {
        unwrap(await remote.dissociateGitHubSkillSource(row.entry.name, row.entry.entryDir), 'capabilityPolicy.dissociateGitHubSkillSource')
        status = { name: row.entry.name, entryDir: row.entry.entryDir, status: 'unmanaged' }
      } else {
        status = unwrap(await remote.associateGitHubSkillSource(row.entry.name, sourceDraft[row.entry.path] ?? '', row.entry.entryDir), 'capabilityPolicy.associateGitHubSkillSource')
      }
      setRows(previous => previous.map(item => item.entry.path === row.entry.path ? { entry: item.entry, status } : item))
      setEditing(previous => ({ ...previous, [row.entry.path]: false }))
      setProgress(t(unlink ? 'skillUnlinked' : 'skillAssociated'))
    } catch (error) {
      setRows(previous => previous.map(item => item.entry.path === row.entry.path ? { ...item, error: skillUpdateError(error) } : item))
      setProgress(t('skillSourceFailed'))
    } finally {
      running.current = false
      setCurrentPath('')
      setPhase('idle')
    }
  }, [remote, sourceDraft, t])

  const available = rows.filter(row => row.status?.status === 'available' && row.error === undefined)
  const updatable = available.filter(row => !row.status?.gitManaged)
  useEffect(() => onAvailableCount(available.length), [available.length, onAvailableCount])
  const busy = phase !== 'idle'
  return <section className="mc-skill-updates" aria-label={t('skillUpdates')} aria-busy={busy}>
    <div className="mc-skill-update-head">
      <strong>{t('skillUpdates')}</strong>
      <span>{t('skillAvailableCount', { count: available.length })}</span>
      <button type="button" className="mc-catalog-btn" disabled={busy} onClick={() => void checkAll()}>{t('skillCheckUpdates')}</button>
      {updatable.length > 0 && <button type="button" className="mc-catalog-btn" disabled={busy} onClick={() => void updateRows(updatable)}>{t('skillUpdateAll', { count: updatable.length })}</button>}
    </div>
    {rows.some(row => row.status?.status === 'unmanaged') && <p>{t('skillAssociateHint')}</p>}
    {(busy || progress) && <p role="status">{progress || t('skillChecking')} {busy && elapsed >= 10 ? t('skillWaiting', { seconds: elapsed }) : ''}</p>}
    {rows.map(row => {
      const status = row.status
      const key = row.entry.path
      const sourceOpen = status?.status === 'unmanaged' || editing[key]
      return <div className="mc-skill-update-row" key={key} aria-busy={busy && currentPath === key}>
        <strong>{row.entry.skillName ?? row.entry.name}</strong>
        {busy && currentPath === key && <span role="status">{t(phase === 'checking' ? 'skillChecking' : phase === 'updating' ? 'skillUpdating' : 'skillAssociating')}</span>}
        {status?.sourceUrl?.startsWith('https://github.com/') && <a href={status.sourceUrl} target="_blank" rel="noopener noreferrer">GitHub</a>}
        {status?.installedRevision && <span>{t('skillInstalledRevision', { revision: status.installedRevision.slice(0, 8) })}</span>}
        {status?.latestRevision && <span>{t('skillLatestRevision', { revision: status.latestRevision.slice(0, 8) })}</span>}
        {status?.status === 'current' && <span>{t('skillUpToDate')}</span>}
        {status?.status === 'modified' && <span>{t('skillLocalModified')}</span>}
        {status?.status === 'available' && <span>{t('skillUpdateAvailable')}</span>}
        {status?.gitManaged && <span>{t('skillGitManaged')}</span>}
        {sourceOpen ? <>
          <input type="url" disabled={busy} aria-label={t('skillSourceUrl')} placeholder="https://github.com/owner/repo/tree/branch/path" value={sourceDraft[key] ?? ''} onChange={event => setSourceDraft(previous => ({ ...previous, [key]: event.target.value }))} />
          <button type="button" className="mc-catalog-btn" disabled={busy || !(sourceDraft[key] ?? '').trim()} onClick={() => void changeSource(row)}>{t('skillAssociateSource')}</button>
        </> : <button type="button" className="mc-catalog-btn" disabled={busy} onClick={() => {
          setSourceDraft(previous => ({ ...previous, [key]: status?.sourceUrl ?? '' }))
          setEditing(previous => ({ ...previous, [key]: true }))
        }}>{t('skillEditSource')}</button>}
        {status?.status !== 'unmanaged' && <button type="button" className="mc-catalog-btn" disabled={busy} onClick={() => void changeSource(row, true)}>{t('skillUnlinkSource')}</button>}
        {status?.changedFiles && status.changedFiles.length > 0 && <details><summary>{t('skillChangedFiles', { count: status.changedFiles.length })}</summary><ul>{status.changedFiles.map(path => <li key={path}>{path}</li>)}</ul></details>}
        {status?.compareUrl && <a href={status.compareUrl} target="_blank" rel="noopener noreferrer">{t('skillViewChanges')}</a>}
        {row.error && <div role="alert" style={{ whiteSpace: 'pre-wrap' }}>{row.error.message.split(/(https:\/\/github\.com\/[^\s]+)/).map((part, index) => part.startsWith('https://github.com/') ? <a key={index} href={part} target="_blank" rel="noopener noreferrer">{part}</a> : part)}
          {row.error.detail && <details><summary>{t('skillErrorDetails')}</summary>{row.error.detail}</details>}
        </div>}
        {status?.status === 'available' && !status.gitManaged && !row.error && <button type="button" className="mc-catalog-btn" disabled={busy} onClick={() => void updateRows([row])}>{t('skillUpdateOne')}</button>}
        {row.error && !sourceOpen && <button type="button" className="mc-catalog-btn" disabled={busy} onClick={() => void (status?.status === 'available' && !status.gitManaged ? updateRows([row]) : checkAll())}>{t('retry')}</button>}
      </div>
    })}
  </section>
}
