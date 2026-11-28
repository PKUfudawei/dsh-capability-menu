import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { CapabilityPolicyRemote, CapabilityRow, SkillLocation, SkillUpdateStatus } from './store.ts'
import { unwrap } from './store.ts'
import { runSkillUpdateBatch } from './skillUpdateBatch.ts'
import { skillUpdateError, matchesSkillCheck } from './skillUpdatePresentation.ts'
import type { CapabilityKey } from './CapabilitySection.tsx'

interface Row {
  entry: SkillLocation
  checking?: boolean
  status?: SkillUpdateStatus
  error?: ReturnType<typeof skillUpdateError>
}

export function SkillUpdatePanel(props: {
  remote: CapabilityPolicyRemote
  filteredSkills?: readonly CapabilityRow[]
  tabs?: ReactNode
  actions?: ReactNode
  t(key: CapabilityKey, params?: Record<string, unknown>): string
  onUpdated(): void
  onAvailableCount(count: number): void
}): JSX.Element {
  const { remote, filteredSkills, t, onUpdated, onAvailableCount } = props
  const [rows, setRows] = useState<Row[]>([])
  const [sourceDraft, setSourceDraft] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<Record<string, boolean>>({})
  const [phase, setPhase] = useState<'idle' | 'checking' | 'updating' | 'associating'>('idle')
  const [progress, setProgress] = useState('')
  const [progressHint, setProgressHint] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [currentPath, setCurrentPath] = useState('')
  const running = useRef(false)

  const checkAll = useCallback(async () => {
    if (running.current) return
    running.current = true
    setPhase('checking')
    setProgress('')
    setProgressHint('')
    try {
      const locations = unwrap(await remote.listSkillLocations(), 'capabilityPolicy.listSkillLocations').filter(entry => matchesSkillCheck(entry, filteredSkills))
      const entries = locations.filter(entry => entry.valid)
      setRows(previous => {
        const selected = new Set(entries.map(entry => entry.path))
        return [...previous.filter(row => !selected.has(row.entry.path)), ...entries.map(entry => ({ entry }))]
      })
      setProgress(t('skillCheckProgress', { done: 0, total: entries.length }))
      await runSkillUpdateBatch(entries,
        async entry => {
          setRows(previous => previous.map(row => row.entry.path === entry.path ? { ...row, checking: true } : row))
          return unwrap(await remote.checkSkillUpdate(entry.name, entry.entryDir), 'capabilityPolicy.checkSkillUpdate')
        },
        (entry, result) => {
          const row: Row = result.ok ? { entry, status: result.value } : { entry, error: skillUpdateError(result.error) }
          setRows(previous => previous.map(item => item.entry.path === entry.path ? row : item))
        },
        (done, total) => setProgress(t('skillCheckProgress', { done, total })),
        3,
      )
      if (entries.length === 0 && locations.length > 0) setProgressHint(t('skillSkippedHint'))
      setProgress(entries.length > 0 ? '' : locations.length === 0 ? t(filteredSkills === undefined ? 'skillNoLocations' : 'skillNoMatchingLocations') : t('skillSkippedInvalid', { invalid: locations.length }))
    } catch (error) {
      setProgress(skillUpdateError(error).message)
    } finally {
      running.current = false
      setCurrentPath('')
      setPhase('idle')
    }
  }, [remote, filteredSkills, t])

  const updateRows = useCallback(async (selected: Row[]) => {
    if (running.current || selected.length === 0) return
    running.current = true
    setPhase('updating')
    setProgressHint('')
    let succeeded = 0
    let failed = 0
    try {
      await runSkillUpdateBatch(selected,
        async row => {
          setCurrentPath(row.entry.path)
          setProgress(t('skillUpdatingItem', { name: row.entry.skillName ?? row.entry.name, done: succeeded + failed, total: selected.length }))
          const { revision } = unwrap(await remote.updateSkillFromGitHub(row.entry.name, row.entry.entryDir), 'capabilityPolicy.updateSkillFromGitHub')
          return { ...row.status, name: row.entry.name, entryDir: row.entry.entryDir,
            status: 'current' as const, installedRevision: revision, latestRevision: revision, changedFiles: undefined, compareUrl: undefined,
            ...(revision !== row.status?.latestRevision ? { latestCommitUrl: undefined, latestCommitRevision: undefined, latestCommitSubject: undefined } : {}) }
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
    setProgressHint('')
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

  const visibleRows = rows.filter(row => matchesSkillCheck(row.entry, filteredSkills))
  const available = visibleRows.filter(row => row.status?.status === 'available' && row.error === undefined)
  const updatable = available.filter(row => !row.entry.linked && !row.status?.gitManaged)
  useEffect(() => onAvailableCount(available.length), [available.length, onAvailableCount])
  const busy = phase !== 'idle'
  return <section className="mc-skill-updates" aria-label={t('skillUpdates')} aria-busy={busy}>
    <div className="mc-skill-update-toolbar">
    {props.tabs}
    <div className="mc-skill-update-head">
      {props.actions}
      <button type="button" className="mc-skill-toolbar-action" title={t('skillCheckAllHint')} disabled={busy} onClick={() => void checkAll()}>{t('skillCheckUpdates')}</button>

      {(visibleRows.length > 0 || busy || progress) && <button type="button" className="mc-skill-toolbar-action" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        {t(expanded ? 'skillHideDetails' : 'skillUpdateDetails')}
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : undefined }}><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>}
    </div>
    </div>
    {expanded && <>
      {progress && <span className="mc-skill-update-status" role="status" title={progressHint || (progress === t('skillNoLocations') ? t('skillNoLocationsHint') : progress)}>{progress}</span>}
      {busy && !progress && rows.length === 0 && <span role="status">{t('skillChecking')}</span>}
      {updatable.length > 0 && <button type="button" className="mc-catalog-btn" disabled={busy} onClick={() => void updateRows(updatable)}>{t('skillUpdateAll', { count: updatable.length })}</button>}
    </>}
    {expanded && visibleRows.map(row => {
      const status = row.status
      const key = row.entry.path
      const sourceOpen = !row.entry.linked && (status?.status === 'unmanaged' || editing[key])
      const commitUrl = status?.latestCommitUrl?.startsWith('https://github.com/') ? status.latestCommitUrl : undefined
      const statusKey = status?.status === 'current' ? 'skillUpToDate'
        : status?.status === 'available' ? 'skillUpdateAvailable'
          : status?.status === 'unmanaged' ? 'skillSourceUnknownShort'
            : status?.status === 'modified' ? row.entry.linked ? 'skillDifferentShort' : 'skillModifiedShort' : undefined
      const hint = [
        status?.status === 'unmanaged' ? t('skillSourceUnknown') : undefined,
        status?.status === 'modified' ? t(row.entry.linked ? 'skillLinkedDifferent' : 'skillLocalModified') : undefined,
        row.entry.linked ? t('skillLinkedReadOnly') : status?.gitManaged ? t('skillGitManaged') : undefined,
        status?.installedRevision ? t('skillInstalledRevision', { revision: status.installedRevision.slice(0, 8) }) : undefined,
        status?.latestRevision ? t('skillLatestRevision', { revision: (status.latestCommitRevision ?? status.latestRevision).slice(0, 8) }) : undefined,
      ].filter(Boolean).join('\n')
      const name = row.entry.skillName ?? row.entry.name
      const rowBusy = busy && (phase === 'checking' ? row.checking === true : currentPath === key)
      return <div className="mc-skill-update-row" key={key} aria-busy={rowBusy}>
        <div className="mc-skill-update-result">
        <strong>{name}</strong>
        {rowBusy && <span role="status">{t(phase === 'checking' ? 'skillChecking' : phase === 'updating' ? 'skillUpdating' : 'skillAssociating')}</span>}
        {phase === 'checking' && !row.checking && !row.status && !row.error && <span>{t('skillCheckQueued')}</span>}
        {!row.error && statusKey && <span title={hint || undefined} aria-label={hint ? `${t(statusKey)}. ${hint}` : undefined}>{t(statusKey)}</span>}
        {!row.error && commitUrl && status?.latestCommitRevision && <a className="mc-skill-commit-link" href={commitUrl} target="_blank" rel="noopener noreferrer" title={status.latestCommitRevision}>{status.latestCommitRevision.slice(0, 8)}</a>}
        {!row.error && status?.status === 'current' && status.latestCommitSubject && <span className="mc-skill-commit" title={status.latestCommitSubject}>{status.latestCommitSubject}</span>}
        </div>
        {!row.entry.linked && (sourceOpen ? <>
          <input type="url" disabled={busy} aria-label={t('skillSourceUrl')} placeholder="https://github.com/owner/repo/tree/branch/path" value={sourceDraft[key] ?? ''} onChange={event => setSourceDraft(previous => ({ ...previous, [key]: event.target.value }))} />
          <button type="button" className="mc-catalog-btn" disabled={busy || !(sourceDraft[key] ?? '').trim()} onClick={() => void changeSource(row)}>{t('skillAssociateSource')}</button>
        </> : <button type="button" className="mc-catalog-btn" disabled={busy} onClick={() => {
          setSourceDraft(previous => ({ ...previous, [key]: status?.sourceUrl ?? '' }))
          setEditing(previous => ({ ...previous, [key]: true }))
        }}>{t('skillEditSource')}</button>)}
        {!row.entry.linked && status?.status !== 'unmanaged' && <button type="button" className="mc-catalog-btn" disabled={busy} onClick={() => void changeSource(row, true)}>{t('skillUnlinkSource')}</button>}
        {status?.changedFiles && status.changedFiles.length > 0 && <details><summary>{t('skillChangedFiles', { count: status.changedFiles.length })}</summary><ul>{status.changedFiles.map(path => <li key={path}>{path}</li>)}</ul></details>}
        {status?.compareUrl && <a href={status.compareUrl} target="_blank" rel="noopener noreferrer">{t('skillViewChanges')}</a>}
        {row.error && <div role="alert" style={{ whiteSpace: 'pre-wrap' }}>{row.error.message.split(/(https:\/\/github\.com\/[^\s]+)/).map((part, index) => part.startsWith('https://github.com/') ? <a key={index} href={part} target="_blank" rel="noopener noreferrer">{part}</a> : part)}
          {row.error.detail && <details><summary>{t('skillErrorDetails')}</summary>{row.error.detail}</details>}
        </div>}
        {!row.entry.linked && status?.status === 'available' && !status.gitManaged && !row.error && <button type="button" className="mc-catalog-btn" disabled={busy} onClick={() => void updateRows([row])}>{t('skillUpdateOne')}</button>}
        {row.error && !sourceOpen && <button type="button" className="mc-catalog-btn" disabled={busy} onClick={() => void (!row.entry.linked && status?.status === 'available' && !status.gitManaged ? updateRows([row]) : checkAll())}>{t('retry')}</button>}
      </div>
    })}
  </section>
}
