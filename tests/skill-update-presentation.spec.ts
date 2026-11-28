import { describe, expect, it } from 'vitest'
import { skillUpdateError, matchesSkillCheck } from '../src/client/skillUpdatePresentation.ts'
import { compileNameFilter, filterRows } from '../src/client/skillGroups.ts'
import type { CapabilityRow, SkillLocation } from '../src/client/store.ts'

describe('Skill update search scope', () => {
  const entry: SkillLocation = { name: 'alpha', skillName: 'alpha', path: '/home/skills/alpha', target: '/sources/alpha', root: 'user', entryDir: '/home/skills', valid: true, linked: true }
  const row: CapabilityRow = { id: 'alpha', name: 'alpha', kind: 'skill', path: '/sources/alpha', source: 'user-dsh', class: 'resident', mandatory: false }
  it('uses the same regular-expression search as the catalog, including link targets', () => {
    const selected = filterRows([row, { ...row, id: 'beta', name: 'beta', path: '/sources/beta' }], compileNameFilter('^alpha$'))
    expect(matchesSkillCheck(entry, selected)).toBe(true)
    expect(matchesSkillCheck({ ...entry, name: 'beta', skillName: 'beta', path: '/home/skills/beta', target: '/sources/beta' }, selected)).toBe(false)
  })
  it('does not fall back to all skills for an empty result or match another same-name directory', () => {
    expect(matchesSkillCheck(entry)).toBe(true)
    expect(matchesSkillCheck(entry, [])).toBe(false)
    expect(matchesSkillCheck(entry, [{ ...row, path: '/project/alpha', source: 'project-dsh' }])).toBe(false)
    expect(matchesSkillCheck(entry, [{ ...row, preset: 'standard' }])).toBe(false)
  })
  it('matches Windows path separators and respects source roots when catalog paths are absent', () => {
    expect(matchesSkillCheck({ ...entry, target: 'C:\\Skills\\Alpha' }, [{ ...row, path: 'c:/skills/alpha/' }])).toBe(true)
    expect(matchesSkillCheck(entry, [{ ...row, path: undefined }])).toBe(true)
    expect(matchesSkillCheck(entry, [{ ...row, path: undefined, source: 'project-dsh' }])).toBe(false)
  })
})

describe('Skill update feedback', () => {
  it('separates git diagnostics from readable errors', () => {
    const raw = 'capabilityPolicy.checkSkillUpdate failed: gateway/internal: 仓库不存在或当前无法访问\n\n[details]\nfatal: repository not found'
    expect(skillUpdateError(new Error(raw))).toEqual({ message: '仓库不存在或当前无法访问', detail: 'fatal: repository not found' })
  })
  it('keeps useful multiline candidate links in the main message', () => {
    const message = '没有 SKILL.md\n可用技能目录：\nalpha: https://github.com/owner/repo/tree/main/skills/alpha'
    expect(skillUpdateError(new Error(message))).toEqual({ message })
  })
})
