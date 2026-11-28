import type { CapabilityRow, SkillLocation } from './store.ts'
import { PROJECT_SKILL_SOURCES } from '../constants.ts'

/** Match the catalog's filtered results to installed entries, including links.
 * Prefer paths so same-name skills in different roots cannot be checked by mistake.
 */
export function matchesSkillCheck(entry: SkillLocation, filtered?: readonly CapabilityRow[]): boolean {
  if (filtered === undefined) return true
  const normalize = (path: string): string => {
    const value = path.replace(/\\/g, '/').replace(/\/$/, '')
    return /^[a-z]:\//i.test(value) ? value.toLowerCase() : value
  }
  return filtered.some(row => {
    if (row.kind !== 'skill' || row.preset !== undefined) return false
    if (row.path) return [entry.path, entry.target].some(path => path !== undefined && normalize(path) === normalize(row.path!))
    return row.name === (entry.skillName ?? entry.name)
      && (entry.root === 'project') === PROJECT_SKILL_SOURCES.has(row.source ?? '')
  })
}

/** Separate a readable summary from transport/git diagnostics. */
export function skillUpdateError(error: unknown): { message: string; detail?: string } {
  const raw = error instanceof Error ? error.message : String(error)
  const cleaned = raw.replace(/^Error:\s*/, '').replace(/^capabilityPolicy\.\w+ failed:\s*/, '').replace(/^gateway\/\w+:\s*/, '')
  const [message = cleaned, ...details] = cleaned.split('\n\n[details]\n')
  const detail = details.join('\n\n') || (cleaned !== raw ? raw : undefined)
  return { message, ...(detail ? { detail } : {}) }
}
