import { useCallback, useEffect, useRef, useState } from 'react'
import type { CapabilityPolicyRemote, SkillLocation, SkillUpdateStatus } from './store.ts'
import { unwrap } from './store.ts'
import { runSkillUpdateBatch } from './skillUpdateBatch.ts'
import type { CapabilityKey } from './CapabilitySection.tsx'

interface Row {
  entry: SkillLocation
  status?: SkillUpdateStatus
  error?: string
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
  const [phase, setPhase] = useState<'idle' | 'checking' | 'updating' | 'associating'>('idle')
  const [progress, setProgress] = useState('')
  const running = useRef(false)

  const checkAll = useCallback(async () => {
    if (running.current) return
    running.current = true
    setPhase('checking')
    setProgress('')
    try {
      const entries = unwrap(await remote.listSkillLocations(), 'capabilityPolicy.listSkillLocations')
      const checked: Row[] = []
      let processed = 0
      for (const entry of entries) {
        try {
          const status = unwrap(await remote.checkSkillUpdate(entry.name, entry.entryDir), 'capabilityPolicy.checkSkillUpdate')
          if (status.status !== 'unmanaged' || (!entry.linked && entry.valid)) checked.push({ entry, status })
        } catch (error) {
          checked.push({ entry, error: String(error) })
        }
        processed++
        setRows([...checked])
        setProgress(t('skillUpdateProgress', { done: processed, total: entries.length }))
      }
      setRows(checked)
    } catch (error) {
      setProgress(String(error))
    } finally {
      running.current = false
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
    setProgress(t('skillUpdateProgress', { done: 0, total: selected.length }))
    await runSkillUpdateBatch(selected,
      async row => {
        const { revision } = unwrap(await remote.updateSkillFromGitHub(row.entry.name, row.entry.entryDir), 'capabilityPolicy.updateSkillFromGitHub')
        return {
          name: row.entry.name, entryDir: row.entry.entryDir, sourceUrl: row.status?.sourceUrl,
          status: 'current' as const, installedRevision: revision, latestRevision: revision,
        }
      },
      (row, result) => setRows(previous => previous.map(item => item.entry.path !== row.entry.path ? item
        : result.ok ? { entry: item.entry, status: result.value } : { ...item, error: String(result.error) })),
      (done, total) => setProgress(t('skillUpdateProgress', { done, total })),
    )
    running.current = false
    setPhase('idle')
    onUpdated()
  }, [remote, t, onUpdated])

  const associate = useCallback(async (row: Row) => {
    if (running.current) return
    running.current = true
    setPhase('associating')
    setProgress('')
    try {
      const status = unwrap(await remote.associateGitHubSkillSource(row.entry.name, sourceDraft[row.entry.path] ?? '', row.entry.entryDir), 'capabilityPolicy.associateGitHubSkillSource')
      setRows(previous => previous.map(item => item.entry.path === row.entry.path ? { entry: item.entry, status } : item))
    } catch (error) {
      setRows(previous => previous.map(item => item.entry.path === row.entry.path ? { ...item, error: String(error) } : item))
    } finally {
      running.current = false
      setPhase('idle')
    }
  }, [remote, sourceDraft])

  const available = rows.filter(row => row.status?.status === 'available' && row.error === undefined)
  useEffect(() => onAvailableCount(available.length), [available.length, onAvailableCount])
  return (
    <section className="mc-skill-updates" aria-label={t('skillUpdates')}>
      <div className="mc-skill-update-head">
        <strong>{t('skillUpdates')}</strong>
        <button type="button" className="mc-catalog-btn" disabled={phase !== 'idle'} onClick={() => void checkAll()}>{t('skillCheckUpdates')}</button>
        {available.length > 0 && <button type="button" className="mc-catalog-btn" disabled={phase !== 'idle'} onClick={() => void updateRows(available)}>{t('skillUpdateAll', { count: available.length })}</button>}
      </div>
      {rows.some(row => row.status?.status === 'unmanaged') && <p>{t('skillAssociateHint')}</p>}
      {(phase !== 'idle' || progress.length > 0) && <p role="status">{phase === 'checking' ? t('skillChecking') : phase === 'updating' ? t('skillUpdating') : phase === 'associating' ? t('skillAssociating') : ''} {progress}</p>}
      {rows.map(row => {
        const status = row.status
        const key = row.entry.path
        return <div className="mc-skill-update-row" key={key}>
          <strong>{row.entry.skillName ?? row.entry.name}</strong>
          {status?.sourceUrl && <a href={status.sourceUrl} target="_blank" rel="noopener noreferrer">GitHub</a>}
          {status?.installedRevision && <span>{t('skillInstalledRevision', { revision: status.installedRevision.slice(0, 8) })}</span>}
          {status?.latestRevision && <span>{t('skillLatestRevision', { revision: status.latestRevision.slice(0, 8) })}</span>}
          {status?.status === 'current' && <span>{t('skillUpToDate')}</span>}
          {status?.status === 'modified' && <span>{t('skillLocalModified')}</span>}
          {status?.status === 'available' && <span>{t('skillUpdateAvailable')}</span>}
          {status?.status === 'unmanaged' && <>
            <input type="url" aria-label={t('skillSourceUrl')} placeholder="https://github.com/owner/repo/tree/branch/path" value={sourceDraft[key] ?? ''} onChange={event => setSourceDraft(previous => ({ ...previous, [key]: event.target.value }))} />
            <button type="button" className="mc-catalog-btn" disabled={phase !== 'idle' || !(sourceDraft[key] ?? '').trim()} onClick={() => void associate(row)}>{t('skillAssociateSource')}</button>
          </>}
          {status?.changedFiles && status.changedFiles.length > 0 && <details><summary>{t('skillChangedFiles', { count: status.changedFiles.length })}</summary><ul>{status.changedFiles.map(path => <li key={path}>{path}</li>)}</ul></details>}
          {status?.compareUrl && <a href={status.compareUrl} target="_blank" rel="noopener noreferrer">{t('skillViewChanges')}</a>}
          {row.error && <span role="alert">{row.error}</span>}
          {status?.status === 'available' && !row.error && <button type="button" className="mc-catalog-btn" disabled={phase !== 'idle'} onClick={() => void updateRows([row])}>{t('skillUpdateOne')}</button>}
          {row.error && status?.status !== 'unmanaged' && <button type="button" className="mc-catalog-btn" disabled={phase !== 'idle'} onClick={() => void (status?.status === 'available' ? updateRows([row]) : checkAll())}>{t('retry')}</button>}
        </div>
      })}
    </section>
  )
}
