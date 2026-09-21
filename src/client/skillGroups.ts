/**
 * What the capability list decides about *which* rows it shows, kept out of
 * `CapabilitySection.tsx` as pure functions.
 *
 * The split is deliberate: the grouping rules are where this plugin got its one
 * real mis-grouping (preset skills filed under 全局技能), and they are also the
 * only part of the client a test can reach — this repo has no DOM harness, so
 * anything that lives inside the component can only be checked by hand.
 */
import { BUILT_IN_SERVER, PROJECT_SKILL_SOURCES } from '../constants.ts'
import type { CapabilityRow } from './store.ts'

/** The Skills panel's sub-tab. `preset` exists only while presets ship skills. */
export type SkillTab = 'global' | 'project' | 'preset'

export interface Grouped {
  servers: Array<{ server: string; tools: CapabilityRow[] }>
  skills: CapabilityRow[]
}

/** Group tools by server name; skills stay flat (no server), both name-sorted. */
export function groupRows(rows: readonly CapabilityRow[]): Grouped {
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

/**
 * Normalize a filter box's contents into the needle an empty-vs-no-match
 * judgment can be made on. Exported so the panel's "nothing here" message and
 * `filterRows` cannot disagree about what an empty filter is.
 */
export function filterNeedle(filter: string): string {
  return filter.trim().toLowerCase()
}

/**
 * Narrow a list by name, case-insensitively. Applied *before* grouping so a
 * server header's own counts describe the rows actually listed under it.
 */
export function filterRows(rows: readonly CapabilityRow[], filter: string): CapabilityRow[] {
  const needle = filterNeedle(filter)
  if (needle === '') return [...rows]
  return rows.filter(row => row.name.toLowerCase().includes(needle))
}

export interface SkillGroups {
  /** Skills shipped by an agent preset, whatever their source label says. */
  presetSkills: CapabilityRow[]
  /** `presetSkills` grouped by preset id, groups ordered by id. */
  presetGroups: Array<[string, CapabilityRow[]]>
  /** Skills whose source root is inside the current project. */
  projectSkills: CapabilityRow[]
  /** Everything else: user/global dirs, bundled, custom, runtime, unlabelled. */
  globalSkills: CapabilityRow[]
}

/**
 * Split skill rows across the three sub-tabs.
 *
 * Preset skills are split off by their `preset` field and never by `source`: a
 * preset's own `skill-filesystem` labels its skills `custom`, exactly like a
 * user-configured `customSkillDirs` entry, so a source-based rule drags both
 * into 全局技能 — filing a preset asset as global is precisely the mis-grouping
 * this split exists to fix. Rows keep the order they arrive in, so callers that
 * pass name-sorted rows get name-sorted groups.
 */
export function splitSkillGroups(skills: readonly CapabilityRow[]): SkillGroups {
  const presetSkills: CapabilityRow[] = []
  const projectSkills: CapabilityRow[] = []
  const globalSkills: CapabilityRow[] = []
  const presetGroups: Array<[string, CapabilityRow[]]> = []
  for (const skill of skills) {
    const preset = skill.preset
    if (preset !== undefined) {
      presetSkills.push(skill)
      const group = presetGroups.find(([id]) => id === preset)
      if (group === undefined) presetGroups.push([preset, [skill]])
      else group[1].push(skill)
      continue
    }
    if (PROJECT_SKILL_SOURCES.has(skill.source ?? '')) projectSkills.push(skill)
    else globalSkills.push(skill)
  }
  presetGroups.sort(([a], [b]) => a.localeCompare(b))
  return { presetSkills, presetGroups, projectSkills, globalSkills }
}

/**
 * The sub-tab the Skills panel actually shows: the requested one, unless it is
 * 预设技能 while no preset ships skills. That tab does not exist then, and a
 * selection left on it must not survive — deployed presets are re-scanned on
 * every refresh, so the tab can disappear under the operator.
 */
export function resolveSkillTab(selected: SkillTab, groups: SkillGroups): SkillTab {
  return selected === 'preset' && groups.presetSkills.length === 0 ? 'global' : selected
}

/** Rows in one tier. Counts the *displayed* rows, not the whole catalog. */
export function countByClass(rows: readonly CapabilityRow[], cls: CapabilityRow['class']): number {
  return rows.reduce((n, row) => (row.class === cls ? n + 1 : n), 0)
}
