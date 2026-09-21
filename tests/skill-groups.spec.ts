/**
 * The Skills tab's grouping rules, tested as plain functions.
 *
 * This repo has no DOM harness, so the React component itself stays manual — but
 * "which sub-tab does this row land in" is the part that carried the real bug
 * (issue #3: preset skills filed under 全局技能), and it is plain data in and
 * plain data out.
 */
import { describe, expect, it } from 'vitest'
import {
  countByClass,
  filterRows,
  groupRows,
  resolveSkillTab,
  splitSkillGroups,
  type SkillGroups,
} from '../src/client/skillGroups.ts'
import type { CapabilityRow } from '../src/client/store.ts'

function skill(name: string, extra: Partial<CapabilityRow> = {}): CapabilityRow {
  return { id: name, kind: 'skill', name, class: 'resident', mandatory: false, ...extra }
}

function tool(name: string, server?: string): CapabilityRow {
  return { id: name, kind: 'tool', name, class: 'resident', mandatory: false, ...server !== undefined ? { server } : {} }
}

function emptyGroups(): SkillGroups {
  return { presetSkills: [], presetGroups: [], projectSkills: [], globalSkills: [] }
}

describe('splitSkillGroups', () => {
  it('files a preset skill under 预设技能 even though its source says custom', () => {
    // The preset layer's own skill-filesystem labels its skills `custom`, which
    // is exactly why the split must key off `preset` and not `source`.
    const groups = splitSkillGroups([skill('cordis-plugin-development', { source: 'custom', preset: 'cordis' })])
    expect(groups.presetSkills.map(s => s.name)).toEqual(['cordis-plugin-development'])
    expect(groups.globalSkills).toEqual([])
    expect(groups.projectSkills).toEqual([])
  })

  it('leaves a user-configured customSkillDirs skill in 全局技能', () => {
    // Same source label, no preset id — the case a source-based rule would
    // wrongly drag along with the preset skills.
    const groups = splitSkillGroups([skill('my-own-skill', { source: 'custom' })])
    expect(groups.presetSkills).toEqual([])
    expect(groups.globalSkills.map(s => s.name)).toEqual(['my-own-skill'])
  })

  it('splits project sources from everything else', () => {
    const groups = splitSkillGroups([
      skill('a', { source: 'project-dsh' }),
      skill('b', { source: 'project-agents' }),
      skill('c', { source: 'user-agents' }),
      skill('d', { source: 'bundled' }),
      skill('e'), // no source label at all
    ])
    expect(groups.projectSkills.map(s => s.name)).toEqual(['a', 'b'])
    expect(groups.globalSkills.map(s => s.name)).toEqual(['c', 'd', 'e'])
  })

  it('groups presets into their own buckets, ordered by preset id', () => {
    const groups = splitSkillGroups([
      skill('ptc-b', { preset: 'ptc' }),
      skill('cordis-a', { preset: 'cordis' }),
      skill('cordis-c', { preset: 'cordis' }),
    ])
    expect(groups.presetGroups.map(([id, rows]) => [id, rows.map(r => r.name)])).toEqual([
      ['cordis', ['cordis-a', 'cordis-c']],
      ['ptc', ['ptc-b']],
    ])
    // Every preset skill is in exactly one group: the flat list keeps input
    // order, the groups are id-sorted, so compare them as sets of names.
    expect(groups.presetGroups.flatMap(([, rows]) => rows.map(r => r.name)).sort())
      .toEqual(groups.presetSkills.map(s => s.name).sort())
  })

  it('keeps the order it is given, so name-sorted input yields name-sorted groups', () => {
    const groups = splitSkillGroups([skill('alpha', { preset: 'p' }), skill('beta', { preset: 'p' })])
    expect(groups.presetGroups).toEqual([['p', groups.presetSkills]])
    expect(groups.presetSkills.map(s => s.name)).toEqual(['alpha', 'beta'])
  })
})

describe('resolveSkillTab', () => {
  it('falls back to 全局技能 when 预设技能 is selected but no preset ships skills', () => {
    // Deployed presets are re-scanned on every refresh, so the tab can vanish
    // under an operator who is looking at it.
    expect(resolveSkillTab('preset', emptyGroups())).toBe('global')
  })

  it('keeps 预设技能 while preset skills exist', () => {
    const groups = splitSkillGroups([skill('x', { preset: 'cordis' })])
    expect(resolveSkillTab('preset', groups)).toBe('preset')
  })

  it('passes the other two selections through untouched', () => {
    expect(resolveSkillTab('global', emptyGroups())).toBe('global')
    expect(resolveSkillTab('project', emptyGroups())).toBe('project')
  })
})

describe('filterRows', () => {
  const rows = [skill('Alpha'), skill('beta'), skill('gamma')]

  it('matches case-insensitively on a substring', () => {
    expect(filterRows(rows, 'alph').map(r => r.name)).toEqual(['Alpha'])
    expect(filterRows(rows, 'BET').map(r => r.name)).toEqual(['beta'])
  })

  it('matches inside the name, not just at the start', () => {
    expect(filterRows(rows, 'amm').map(r => r.name)).toEqual(['gamma'])
  })

  it('returns everything for an empty or whitespace-only filter', () => {
    expect(filterRows(rows, '')).toHaveLength(3)
    expect(filterRows(rows, '   ')).toHaveLength(3)
  })

  it('does not mutate the input', () => {
    const input = [...rows]
    filterRows(input, '')
    expect(input).toEqual(rows)
  })
})

describe('groupRows', () => {
  it('buckets tools by server and leaves skills flat', () => {
    const { servers, skills } = groupRows([
      tool('t2', 'zeta'),
      tool('t1', 'alpha'),
      skill('s1'),
      tool('native'),
    ])
    expect(servers.map(s => s.server)).toEqual(['alpha', 'built-in', 'zeta'])
    expect(servers[0]?.tools.map(t => t.name)).toEqual(['t1'])
    expect(servers[1]?.tools.map(t => t.name)).toEqual(['native'])
    expect(skills.map(s => s.name)).toEqual(['s1'])
  })

  it('sorts tools within a server and skills across the list', () => {
    const { servers, skills } = groupRows([
      tool('b', 's'),
      tool('a', 's'),
      skill('zebra'),
      skill('apple'),
    ])
    expect(servers[0]?.tools.map(t => t.name)).toEqual(['a', 'b'])
    expect(skills.map(s => s.name)).toEqual(['apple', 'zebra'])
  })

  it('filters before grouping, so a server header counts what is listed under it', () => {
    const rows = [tool('sql-query', 'dbx'), tool('shell', 'dbx'), skill('sql-helper')]
    const shown = filterRows(rows, 'sql')
    const { servers, skills } = groupRows(shown)
    expect(servers.map(s => [s.server, s.tools.map(t => t.name)])).toEqual([['dbx', ['sql-query']]])
    // A skill row survives the same filter and does not inflate the tool count.
    expect(skills.map(s => s.name)).toEqual(['sql-helper'])
  })
})

describe('countByClass', () => {
  it('counts only the rows it is handed', () => {
    const rows = [
      skill('a', { class: 'resident' }),
      skill('b', { class: 'on-demand' }),
      skill('c', { class: 'on-demand' }),
      skill('d', { class: 'disabled' }),
    ]
    expect(countByClass(rows, 'on-demand')).toBe(2)
    expect(countByClass(rows, 'resident')).toBe(1)
    expect(countByClass([], 'disabled')).toBe(0)
  })
})
