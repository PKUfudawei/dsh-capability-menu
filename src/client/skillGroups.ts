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
 * The filter box's contents, compiled once per render.
 *
 * The box takes a regular expression, case-insensitively. Plain text still does
 * what it always did: an unanchored regex *is* a substring test, so `dbx` keeps
 * matching `mcp__dbx__query`. A pattern that does not compile (a half-typed `(`)
 * degrades to a literal substring search instead of throwing mid-render.
 */
export interface NameFilter {
  /** Trimmed, lowercased box contents; `''` means "no filter at all". */
  readonly needle: string
  /** True when the needle came from a regex that compiled. */
  readonly regex: boolean
  test(values: readonly (string | undefined)[]): boolean
}

/**
 * Compile the box. A `/…/` wrapper is optional — it is stripped when present, so
 * both `cordis|ptc` and `/cordis|ptc/` are read as patterns — and it keeps the
 * common case of pasting a slash-delimited pattern from working.
 */
export function compileNameFilter(input: string): NameFilter {
  const raw = input.trim()
  const needle = raw.toLowerCase()
  if (raw === '') return { needle, regex: false, test: () => true }
  const wrapped = raw.length > 1 && raw.startsWith('/') && raw.endsWith('/')
  const pattern = wrapped ? raw.slice(1, -1) : raw
  try {
    // No `g` flag: a global regex carries `lastIndex` between `test` calls, so
    // reusing it per row would skip matches.
    const compiled = new RegExp(pattern, 'i')
    return { needle, regex: true, test: values => values.some(v => v !== undefined && compiled.test(v)) }
  } catch {
    return {
      needle,
      regex: false,
      test: values => values.some(v => v !== undefined && v.toLowerCase().includes(needle)),
    }
  }
}

/** Labels only the caller can produce, because they are localized or rendered. */
export interface FilterLabels {
  /** How the built-in pseudo-server is drawn (系统内置 / System built-in). */
  readonly builtIn?: string
  /** How a skill's source root is drawn on its row, e.g. `~/.dsh/skills`. */
  readonly source?: (source: string) => string | undefined
}

/**
 * Everything a row is matched against: its own name, plus the dimensions that
 * name the group it sits in — the MCP server (or the label the built-in group is
 * drawn with), the skill's source root, and the preset that ships it.
 *
 * Group headings are labels rather than row fields, which is exactly why typing
 * 系统 used to find nothing: the server id is `built-in`, and 系统内置 is only how
 * that id is painted. Both spellings are searchable now.
 */
export function searchableText(row: CapabilityRow, labels: FilterLabels = {}): string[] {
  const values: Array<string | undefined> = [row.name]
  if (row.server !== undefined) {
    values.push(row.server)
    if (row.server === BUILT_IN_SERVER) values.push(labels.builtIn)
  }
  if (row.source !== undefined) {
    values.push(row.source, labels.source?.(row.source))
  }
  values.push(row.preset)
  return values.filter((v): v is string => v !== undefined && v !== '')
}

/**
 * Narrow a list by the filter. Applied *before* grouping so a server header's
 * own counts describe the rows actually listed under it.
 */
export function filterRows(
  rows: readonly CapabilityRow[],
  filter: NameFilter,
  labels: FilterLabels = {},
): CapabilityRow[] {
  if (filter.needle === '') return [...rows]
  return rows.filter(row => filter.test(searchableText(row, labels)))
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
