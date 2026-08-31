import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { serverNameOf } from '../src/registry.ts'
import * as registry from '../src/registry.ts'
import * as policy from '../src/policy.ts'

async function setup(config: policy.Config = {}, registryConfig: registry.Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  // Disable on-demand catalog emission by default so tests never write the
  // real ~/.dsh; callers override via registryConfig when they test it.
  await ctx.plugin(registry, { catalogFile: '', ...registryConfig })
  await ctx.plugin(policy, config)
  return ctx
}

function registerTool(ctx: Context, name: string, description = 'A tool'): void {
  ctx.tools.register(defineTool({
    name,
    description,
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: false } },
    async execute() {
      return { ok: true }
    },
  }))
}

describe('wildcard / rule matching', () => {
  it('classifies exact exposed, wildcard progressive, server prefix, and default exposed', () => {
    const ctx = null as unknown as Context
    // Pure matcher tests do not need a live context.
    const toolRules = policy.compileSet({
      exposed: ['execute_cmd', 'mcp__gongfeng__*'],
      progressive: ['mcp__*', 'server:km:*'],
    })
    const matcher = (id: string) =>
      policy.classify(
        toolRules,
        {
          id,
          name: id,
          server: serverNameOf(id),
          kind: 'tool',
          ruleKind: 'tool',
        },
        new Set(['meta_search', 'meta_invoke']),
      )
    expect(matcher('execute_cmd')).toBe('exposed')                 // exposed exact
    expect(matcher('meta_search')).toBe('exposed')                 // mandatory meta tool
    expect(matcher('mcp__gongfeng__create_issue')).toBe('exposed') // exposed glob beats progressive glob
    expect(matcher('mcp__km__search')).toBe('progressive')         // progressive glob (server:km:*)
    expect(matcher('mcp__other__tool')).toBe('progressive')        // progressive glob mcp__*
    expect(matcher('non_mcp_tool')).toBe('exposed')                // default exposed
  })

  it('gives exposed priority over progressive on conflicts', () => {
    const rules = policy.compileSet({ exposed: ['mcp__*'], progressive: ['mcp__*'] })
    const target = { id: 'mcp__x__y', server: 'x', kind: 'tool' as const, ruleKind: 'tool' as const }
    expect(policy.classify(rules, target)).toBe('exposed')
  })

  it('gives blocked priority over exposed on conflicts', () => {
    const rules = policy.compileSet({ exposed: ['mcp__*'], blocked: ['mcp__x__*'] })
    const target = { id: 'mcp__x__y', server: 'x', kind: 'tool' as const, ruleKind: 'tool' as const }
    expect(policy.classify(rules, target)).toBe('blocked')
  })

  it('parses server rules correctly', () => {
    const serverGlob = policy.parseRule('server:gongfeng:*')
    expect(serverGlob).toEqual({ wildcard: true, pattern: 'gongfeng', target: 'server', kind: 'tool' })
    const serverExact = policy.parseRule('server:km')
    expect(serverExact.target).toBe('server')
    expect(serverExact.wildcard).toBe(false)
    const idGlob = policy.parseRule('mcp__*')
    expect(idGlob.wildcard).toBe(true)
    expect(idGlob.target).toBe('id')
  })

  it('gives exact rules priority over wildcard rules across exposed/progressive', () => {
    // README's example `tools.exposed: ['mcp__gongfeng__*']` must not silently
    // override an exact per-tool progressive rule written by the UI click.
    const rules = policy.compileSet({
      exposed: ['mcp__gongfeng__*'],
      progressive: ['mcp__gongfeng__create_issue'],
    })
    const target = { id: 'mcp__gongfeng__create_issue', server: 'gongfeng', kind: 'tool' as const, ruleKind: 'tool' as const }
    expect(policy.classify(rules, target)).toBe('progressive')
  })

  it('gives exposed exact priority over progressive wildcard', () => {
    const rules = policy.compileSet({
      exposed: ['mcp__gongfeng__create_issue'],
      progressive: ['mcp__*'],
    })
    const target = { id: 'mcp__gongfeng__create_issue', server: 'gongfeng', kind: 'tool' as const, ruleKind: 'tool' as const }
    expect(policy.classify(rules, target)).toBe('exposed')
  })

  it('keeps blocked above every exact rule', () => {
    const rules = policy.compileSet({
      exposed: ['mcp__x__y'],
      progressive: ['mcp__x__y'],
      blocked: ['mcp__x__*'],
    })
    const target = { id: 'mcp__x__y', server: 'x', kind: 'tool' as const, ruleKind: 'tool' as const }
    expect(policy.classify(rules, target)).toBe('blocked')
  })

  it('classifies skills with default exposed', () => {
    const rules = policy.compileSet({ exposed: ['debugging'] })
    const target = (id: string, name: string) => ({ id, name, kind: 'skill' as const, ruleKind: 'skill' as const })
    expect(policy.classify(rules, target('skill:debugging', 'debugging'), new Set())).toBe('exposed')
    expect(policy.classify(rules, target('skill:coding', 'coding'), new Set())).toBe('exposed')
    expect(policy.classify(rules, target('skill:forbidden', 'forbidden'), new Set())).toBe('exposed')
  })

  it('classifies a skill blocked by an exact rule', () => {
    const rules = policy.compileSet({ blocked: ['forbidden'] })
    const target = { id: 'skill:forbidden', name: 'forbidden', kind: 'skill' as const, ruleKind: 'skill' as const }
    expect(policy.classify(rules, target)).toBe('blocked')
  })
})

describe('capability-menu-policy plugin', () => {
  it('projects assembly.tools to Exposed + meta tools only', async () => {
    const ctx = await setup({
      tools: { exposed: ['execute_cmd', 'mcp__gongfeng__*'], progressive: ['mcp__*'] },
    })
    registerTool(ctx, 'execute_cmd')
    registerTool(ctx, 'meta_search')
    registerTool(ctx, 'meta_invoke')
    registerTool(ctx, 'mcp__gongfeng__create_issue')
    registerTool(ctx, 'mcp__km__search')

    const service = ctx.capabilityPolicy
    expect(service.isExposedTool('execute_cmd')).toBe(true)
    expect(service.isExposedTool('mcp__gongfeng__create_issue')).toBe(true)
    expect(service.isExposedTool('mcp__km__search')).toBe(false)
    expect(service.isExposedTool('meta_search')).toBe(true)

    const assembly = await ctx.systemPrompt.assemble()
    const names = assembly.tools.map(t => t.name)
    expect(names).toContain('execute_cmd')
    expect(names).toContain('meta_search')
    expect(names).toContain('meta_invoke')
    expect(names).toContain('mcp__gongfeng__create_issue')
    expect(names).not.toContain('mcp__km__search')
  })

  it('keeps every tool when the exposed list is empty (default exposed)', async () => {
    // With no explicit exposed list, every non-meta tool defaults to Exposed.
    const ctx = await setup({})
    registerTool(ctx, 'meta_search')
    registerTool(ctx, 'some_tool')
    const assembly = await ctx.systemPrompt.assemble()
    const names = assembly.tools.map(t => t.name)
    expect(names).toContain('meta_search')
    expect(names).toContain('some_tool')
  })

  it('excludes blocked tools from the projection even when also exposed', async () => {
    const ctx = await setup({ tools: { exposed: ['a'], blocked: ['a'] } })
    registerTool(ctx, 'a')
    registerTool(ctx, 'meta_search')
    const service = ctx.capabilityPolicy
    expect(service.isBlockedTool('a')).toBe(true)
    expect(service.isExposedTool('a')).toBe(false)
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.tools.map(t => t.name)).not.toContain('a')
  })

  it('fails loud when a meta tool is blocked', async () => {
    await expect(setup({ tools: { blocked: ['meta_search'] } })).rejects.toThrow(/meta tool "meta_search" cannot be blocked/)
  })

  it('classifies skills via the service', async () => {
    const ctx = await setup({ skills: { exposed: ['debugging'] } })
    expect(ctx.capabilityPolicy.isExposedSkill('debugging')).toBe(true)
    expect(ctx.capabilityPolicy.isExposedSkill('coding')).toBe(true)
    expect(ctx.capabilityPolicy.classifyCapability('skill:coding')).toBe('exposed')
  })

  it('denies direct execution of a blocked tool at pre-execute', async () => {
    const ctx = await setup({ tools: { blocked: ['mcp__secret__read'] } })
    registerTool(ctx, 'mcp__secret__read')
    const decision = await ctx.waterfall('tools/pre-execute', {
      callId: CallId('call-1'),
      name: 'mcp__secret__read',
      arguments: {},
      signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'allow' }))
    expect(decision).toEqual({ kind: 'deny', reason: 'capability "mcp__secret__read" is blocked and cannot be executed' })
  })

  it('denies the skill loader for a blocked skill at pre-execute', async () => {
    const ctx = await setup({ skills: { blocked: ['forbidden-skill'] } })
    const decision = await ctx.waterfall('tools/pre-execute', {
      callId: CallId('call-1'),
      name: 'skill',
      arguments: { name: 'forbidden-skill' },
      signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'allow' }))
    expect(decision).toEqual({ kind: 'deny', reason: 'skill "forbidden-skill" is blocked and cannot be loaded' })
  })

  it('does not deny Progressive tools so meta_invoke can still execute them', async () => {
    const ctx = await setup({ tools: { progressive: ['mcp__km__search'] } })
    const decision = await ctx.waterfall('tools/pre-execute', {
      callId: CallId('call-1'),
      name: 'mcp__km__search',
      arguments: {},
      signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'allow' }))
    expect(decision).toEqual({ kind: 'allow' })
  })

  it('filters the skill catalog to Exposed skills at pre-step', async () => {
    const ctx = await setup({ skills: { exposed: ['frontend-design'], progressive: ['legacy-skill'] } })
    const message = {
      id: 'msg-1',
      role: 'user',
      content: [{ type: 'text', text: '<available_skills>...</available_skills>' }],
      source: {
        kind: 'skill-catalog',
        form: 'catalog',
        entries: [
          { name: 'frontend-design', description: 'Design guidance' },
          { name: 'legacy-skill', description: 'Low-frequency skill' },
        ],
      },
    } as never
    const decision = await ctx.waterfall('agent/pre-step', {
      agent: { id: 'agent-1' } as never,
      messages: [message],
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter', messages: [message] }))
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    const [filtered] = decision.messages
    const source = filtered.source as { kind: string; entries: Array<{ name: string }> }
    expect(source.entries.map(entry => entry.name)).toEqual(['frontend-design'])
    const text = (filtered.content[0] as { text: string }).text
    expect(text).toContain('<available_skills>')
    expect(text).not.toContain('legacy-skill')
  })

  it('appends a catalog pointer section when a catalog file is configured', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-policy-'))
    const { stat } = await import('node:fs/promises')
    const catalogFile = `${home}/capability-catalog.yaml`
    const ctx = await setup({ tools: { progressive: ['mcp__km__search'] } }, { catalogFile })
    registerTool(ctx, 'meta_search')
    registerTool(ctx, 'meta_invoke')
    registerTool(ctx, 'mcp__km__search')
    // C1: the on-demand catalog must exist right after policy mount, without an
    // explicit refresh() (the registry startup path skips writeCatalog).
    await vi.waitFor(async () => {
      const exists = await stat(catalogFile).then(() => true, () => false)
      expect(exists).toBe(true)
    })

    const assembly = await ctx.systemPrompt.assemble()
    const pointer = assembly.sections.find(section => section.name === 'capability-menu-catalog')
    expect(pointer).toBeDefined()
    expect(pointer?.text).toContain(catalogFile)
  })

  it('does not inject a catalog pointer when nothing is Progressive', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-policy-'))
    const catalogFile = `${home}/capability-catalog.yaml`
    const ctx = await setup({}, { catalogFile })
    registerTool(ctx, 'meta_search')
    registerTool(ctx, 'meta_invoke')
    await ctx.capability.refresh()

    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(section => section.name === 'capability-menu-catalog')).toBeUndefined()
  })
})

describe('capability-policy management surface (能力菜单)', () => {
  it('live-updates config via getConfig/updateConfig', async () => {
    const ctx = await setup({ tools: { exposed: ['a'], progressive: ['b'] } })
    registerTool(ctx, 'a')
    registerTool(ctx, 'b')
    const service = ctx.capabilityPolicy

    expect(service.getConfig().tools?.exposed).toContain('a')
    expect(service.isExposedTool('b')).toBe(false)

    await service.updateConfig({ tools: { exposed: ['a', 'b'] } })
    expect(service.isExposedTool('b')).toBe(true)
    expect(service.getConfig().tools?.exposed).toEqual(['a', 'b'])
  })

  it('classifyAll reports every indexed capability and its class', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(registry, { catalogFile: '' })
    await ctx.plugin(policy, {
      tools: { exposed: ['mcp__gongfeng__*'], progressive: ['mcp__*'], blocked: ['mcp__km__search'] },
    })

    registerTool(ctx, 'mcp__gongfeng__create_issue')
    registerTool(ctx, 'mcp__km__search')

    await ctx.capability.refresh()
    const classified = ctx.capabilityPolicy.classifyAll()
    const byId = new Map(classified.map(c => [c.id, c]))
    expect(byId.get('mcp__gongfeng__create_issue')?.class).toBe('exposed')
    expect(byId.get('mcp__gongfeng__create_issue')?.classLabel).toBe('Exposed · 常驻（直接调用）')
    expect(byId.get('mcp__km__search')?.class).toBe('blocked')
    expect(byId.get('mcp__km__search')?.classLabel).toBe('Blocked · 禁用')
    expect(byId.get('mcp__gongfeng__create_issue')?.mandatory).toBe(false)
  })

  it('classifyAll is not truncated by the registry maxResults default', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(registry, { catalogFile: '' })
    await ctx.plugin(policy, {})

    // The registry search default is maxResults=20; classifyAll must enumerate
    // every indexed capability regardless (iWiki alone already exceeds it).
    for (let i = 0; i < 25; i += 1) registerTool(ctx, `mcp__gongfeng__tool_${i}`)
    await ctx.capability.refresh()

    const classified = ctx.capabilityPolicy.classifyAll()
    expect(classified.length).toBe(25)
    expect(new Set(classified.map(c => c.id)).size).toBe(25)
  })
})
