import { describe, expect, it } from 'vitest'
import { skillUpdateError, summarizeSkillChecks } from '../src/client/skillUpdatePresentation.ts'

describe('Skill update feedback', () => {
  it('separates git diagnostics from readable errors', () => {
    const raw = 'capabilityPolicy.checkSkillUpdate failed: gateway/internal: 仓库不存在或当前无法访问\n\n[details]\nfatal: repository not found'
    expect(skillUpdateError(new Error(raw))).toEqual({ message: '仓库不存在或当前无法访问', detail: 'fatal: repository not found' })
  })
  it('keeps useful multiline candidate links in the main message', () => {
    const message = '没有 SKILL.md\n可用技能目录：\nalpha: https://github.com/owner/repo/tree/main/skills/alpha'
    expect(skillUpdateError(new Error(message))).toEqual({ message })
  })
  it('counts available, unlinked, and failed checks separately', () => {
    expect(summarizeSkillChecks([
      { status: { status: 'available' } }, { status: { status: 'unmanaged' } },
      { status: { status: 'modified' } }, { status: { status: 'current' } },
      { status: { status: 'available' }, error: 'Failed' },
    ])).toEqual({ available: 1, unmanaged: 1, failed: 1 })
  })
})
