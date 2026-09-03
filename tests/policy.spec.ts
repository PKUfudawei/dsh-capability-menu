import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
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
  it('classifies exact resident, wildcard on-demand, server prefix, and default resident', () => {
    const ctx = null as unknown as Context
    // Pure matcher tests do not need a live context.
    const toolRules = policy.compileSet({
      resident: ['execute_cmd', 'mcp__gongfeng__*'],
      'on-demand': ['mcp__*', 'server:km:*'],
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
    expect(matcher('execute_cmd')).toBe('resident')                 // resident exact
    expect(matcher('meta_search')).toBe('resident')                 // mandatory meta tool
    expect(matcher('mcp__gongfeng__create_issue')).toBe('resident') // resident glob beats on-demand glob
    expect(matcher('mcp__km__search')).toBe('on-demand')         // on-demand glob (server:km:*)
    expect(matcher('mcp__other__tool')).toBe('on-demand')        // on-demand glob mcp__*
    expect(matcher('non_mcp_tool')).toBe('resident')                // default resident
  })

  it('gives resident priority over on-demand on conflicts', () => {
    const rules = policy.compileSet({ resident: ['mcp__*'], 'on-demand': ['mcp__*'] })
    const target = { id: 'mcp__x__y', server: 'x', kind: 'tool' as const, ruleKind: 'tool' as const }
    expect(policy.classify(rules, target)).toBe('resident')
  })

  it('gives disabled priority over resident on conflicts', () => {
    const rules = policy.compileSet({ resident: ['mcp__*'], disabled: ['mcp__x__*'] })
    const target = { id: 'mcp__x__y', server: 'x', kind: 'tool' as const, ruleKind: 'tool' as const }
    expect(policy.classify(rules, target)).toBe('disabled')
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

  it('gives exact rules priority over wildcard rules across resident/on-demand', () => {
    // README's example `tools.resident: ['mcp__gongfeng__*']` must not silently
    // override an exact per-tool on-demand rule written by the UI click.
    const rules = policy.compileSet({
      resident: ['mcp__gongfeng__*'],
      'on-demand': ['mcp__gongfeng__create_issue'],
    })
    const target = { id: 'mcp__gongfeng__create_issue', server: 'gongfeng', kind: 'tool' as const, ruleKind: 'tool' as const }
    expect(policy.classify(rules, target)).toBe('on-demand')
  })

  it('gives resident exact priority over on-demand wildcard', () => {
    const rules = policy.compileSet({
      resident: ['mcp__gongfeng__create_issue'],
      'on-demand': ['mcp__*'],
    })
    const target = { id: 'mcp__gongfeng__create_issue', server: 'gongfeng', kind: 'tool' as const, ruleKind: 'tool' as const }
    expect(policy.classify(rules, target)).toBe('resident')
  })

  it('keeps disabled above every exact rule', () => {
    const rules = policy.compileSet({
      resident: ['mcp__x__y'],
      'on-demand': ['mcp__x__y'],
      disabled: ['mcp__x__*'],
    })
    const target = { id: 'mcp__x__y', server: 'x', kind: 'tool' as const, ruleKind: 'tool' as const }
    expect(policy.classify(rules, target)).toBe('disabled')
  })

  it('classifies skills with default resident', () => {
    const rules = policy.compileSet({ resident: ['debugging'] })
    const target = (name: string) => ({ id: name, name, kind: 'skill' as const, ruleKind: 'skill' as const })
    expect(policy.classify(rules, target('debugging'), new Set())).toBe('resident')
    expect(policy.classify(rules, target('coding'), new Set())).toBe('resident')
    expect(policy.classify(rules, target('forbidden'), new Set())).toBe('resident')
  })

  it('classifies a skill disabled by an exact rule (bare name and legacy `skill:` spelling)', () => {
    const target = { id: 'forbidden', name: 'forbidden', kind: 'skill' as const, ruleKind: 'skill' as const }
    expect(policy.classify(policy.compileSet({ disabled: ['forbidden'] }), target)).toBe('disabled')
    // Legacy configs that still spell skill rules with a `skill:` prefix keep matching.
    expect(policy.classify(policy.compileSet({ disabled: ['skill:forbidden'] }), target)).toBe('disabled')
  })
})

describe('capability-menu-policy plugin', () => {
  it('projects assembly.tools to Resident + meta tools only', async () => {
    const ctx = await setup({
      tools: { resident: ['execute_cmd', 'mcp__gongfeng__*'], 'on-demand': ['mcp__*'] },
    })
    registerTool(ctx, 'execute_cmd')
    registerTool(ctx, 'meta_search')
    registerTool(ctx, 'meta_invoke')
    registerTool(ctx, 'mcp__gongfeng__create_issue')
    registerTool(ctx, 'mcp__km__search')

    const service = ctx.capabilityPolicy
    expect(service.isResidentTool('execute_cmd')).toBe(true)
    expect(service.isResidentTool('mcp__gongfeng__create_issue')).toBe(true)
    expect(service.isResidentTool('mcp__km__search')).toBe(false)
    expect(service.isResidentTool('meta_search')).toBe(true)

    const assembly = await ctx.systemPrompt.assemble()
    const names = assembly.tools.map(t => t.name)
    expect(names).toContain('execute_cmd')
    expect(names).toContain('meta_search')
    expect(names).toContain('meta_invoke')
    expect(names).toContain('mcp__gongfeng__create_issue')
    expect(names).not.toContain('mcp__km__search')
  })

  it('keeps every tool when the resident list is empty (default resident)', async () => {
    // With no explicit resident list, every non-meta tool defaults to Resident.
    const ctx = await setup({})
    registerTool(ctx, 'meta_search')
    registerTool(ctx, 'some_tool')
    const assembly = await ctx.systemPrompt.assemble()
    const names = assembly.tools.map(t => t.name)
    expect(names).toContain('meta_search')
    expect(names).toContain('some_tool')
  })

  it('excludes disabled tools from the projection even when also resident', async () => {
    const ctx = await setup({ tools: { resident: ['a'], disabled: ['a'] } })
    registerTool(ctx, 'a')
    registerTool(ctx, 'meta_search')
    const service = ctx.capabilityPolicy
    expect(service.isDisabledTool('a')).toBe(true)
    expect(service.isResidentTool('a')).toBe(false)
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.tools.map(t => t.name)).not.toContain('a')
  })

  it('fails loud when a meta tool is disabled', async () => {
    await expect(setup({ tools: { disabled: ['meta_search'] } })).rejects.toThrow(/meta tool "meta_search" cannot be disabled/)
  })

  it('auto-maps legacy rule keys (exposed/progressive) to resident/on-demand', async () => {
    // Pre-rename profiles still declare tools.exposed / tools.progressive; the
    // policy must keep working and classify with the current semantics.
    const legacyConfig = {
      tools: { exposed: ['mcp__gongfeng__*'], progressive: ['mcp__km__search'] },
    } as never
    const ctx = await setup(legacyConfig as policy.Config)
    registerTool(ctx, 'mcp__gongfeng__create_issue')
    registerTool(ctx, 'mcp__km__search')
    expect(ctx.capabilityPolicy.isResidentTool('mcp__gongfeng__create_issue')).toBe(true)
    expect(ctx.capabilityPolicy.isResidentTool('mcp__km__search')).toBe(false)
    expect(ctx.capabilityPolicy.classifyCapability('mcp__km__search')).toBe('on-demand')
  })

  it('classifies skills via the service', async () => {
    const ctx = await setup({ skills: { resident: ['debugging'] } })
    expect(ctx.capabilityPolicy.isResidentSkill('debugging')).toBe(true)
    expect(ctx.capabilityPolicy.isResidentSkill('coding')).toBe(true)
    expect(ctx.capabilityPolicy.classifyCapability('coding', 'skill')).toBe('resident')
  })

  it('denies direct execution of a disabled tool at pre-execute', async () => {
    const ctx = await setup({ tools: { disabled: ['mcp__secret__read'] } })
    registerTool(ctx, 'mcp__secret__read')
    const decision = await ctx.waterfall('tools/pre-execute', {
      callId: ToolCallId('call-1'),
      name: 'mcp__secret__read',
      arguments: {},
      signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'allow' }))
    expect(decision).toEqual({ kind: 'deny', reason: 'capability "mcp__secret__read" is disabled and cannot be executed' })
  })

  it('denies the skill loader for a disabled skill at pre-execute', async () => {
    const ctx = await setup({ skills: { disabled: ['forbidden-skill'] } })
    const decision = await ctx.waterfall('tools/pre-execute', {
      callId: ToolCallId('call-1'),
      name: 'skill',
      arguments: { name: 'forbidden-skill' },
      signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'allow' }))
    expect(decision).toEqual({ kind: 'deny', reason: 'skill "forbidden-skill" is disabled and cannot be loaded' })
  })

  it('denies direct execution of a disabled native tool at pre-execute', async () => {
    const ctx = await setup({ tools: { disabled: ['bash'] } })
    registerTool(ctx, 'bash')
    const decision = await ctx.waterfall('tools/pre-execute', {
      callId: ToolCallId('call-1'),
      name: 'bash',
      arguments: {},
      signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'allow' }))
    expect(decision).toEqual({ kind: 'deny', reason: 'capability "bash" is disabled and cannot be executed' })
  })

  it('does not deny On-demand tools so meta_invoke can still execute them', async () => {
    const ctx = await setup({ tools: { 'on-demand': ['mcp__km__search'] } })
    const decision = await ctx.waterfall('tools/pre-execute', {
      callId: ToolCallId('call-1'),
      name: 'mcp__km__search',
      arguments: {},
      signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'allow' }))
    expect(decision).toEqual({ kind: 'allow' })
  })

  it('filters the skill catalog to Resident skills at pre-step', async () => {
    const ctx = await setup({ skills: { resident: ['frontend-design'], 'on-demand': ['legacy-skill'] } })
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
    const ctx = await setup({ tools: { 'on-demand': ['mcp__km__search'] } }, { catalogFile })
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

  it('does not inject a catalog pointer when nothing is On-demand', async () => {
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

describe('capability-policy management surface (能力管理)', () => {
  it('live-updates config via getConfig/updateConfig', async () => {
    const ctx = await setup({ tools: { resident: ['a'], 'on-demand': ['b'] } })
    registerTool(ctx, 'a')
    registerTool(ctx, 'b')
    const service = ctx.capabilityPolicy

    expect(service.getConfig().tools?.resident).toContain('a')
    expect(service.isResidentTool('b')).toBe(false)

    await service.updateConfig({ tools: { resident: ['a', 'b'] } })
    expect(service.isResidentTool('b')).toBe(true)
    expect(service.getConfig().tools?.resident).toEqual(['a', 'b'])
  })

  it('classifyAll reports every indexed capability and its class', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(registry, { catalogFile: '' })
    await ctx.plugin(policy, {
      tools: { resident: ['mcp__gongfeng__*'], 'on-demand': ['mcp__*'], disabled: ['mcp__km__search'] },
    })

    registerTool(ctx, 'mcp__gongfeng__create_issue')
    registerTool(ctx, 'mcp__km__search')

    await ctx.capability.refresh()
    const classified = ctx.capabilityPolicy.classifyAll()
    const byId = new Map(classified.map(c => [c.id, c]))
    expect(byId.get('mcp__gongfeng__create_issue')?.class).toBe('resident')
    expect(byId.get('mcp__gongfeng__create_issue')?.classLabel).toBe('Resident · 常驻（直接调用）')
    expect(byId.get('mcp__km__search')?.class).toBe('disabled')
    expect(byId.get('mcp__km__search')?.classLabel).toBe('Disabled · 禁用')
    expect(byId.get('mcp__gongfeng__create_issue')?.mandatory).toBe(false)
  })

  it('classifyAll surfaces native tools under the built-in server and lets them cycle to On-demand', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(registry, { catalogFile: '' })
    await ctx.plugin(policy, {})

    registerTool(ctx, 'grep')
    registerTool(ctx, 'mcp__gongfeng__create_issue')
    await ctx.capability.refresh()

    const service = ctx.capabilityPolicy
    const row = service.classifyAll().find(c => c.id === 'grep')
    expect(row?.server).toBe('built-in')
    expect(row?.class).toBe('resident')
    expect(row?.classLabel).toContain('Resident')

    // The UI cycle writes an exact rule; the native reclassifies immediately.
    await service.updateConfig({ tools: { 'on-demand': ['grep'] } })
    expect(service.classifyCapability('grep')).toBe('on-demand')
    expect(service.classifyAll().find(c => c.id === 'grep')?.classLabel).toContain('On-demand')
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

describe('legacy rule-key aliases', () => {
  it('maps the pre-rename `blocked` tier key onto `disabled`', () => {
    const mapped = policy.normalizeSetConfig({
      resident: ['bash'],
      'on-demand': ['legacy_skill'],
      blocked: ['mcp__secret__*'],
    })
    expect(mapped?.resident).toEqual(['bash'])
    expect(mapped?.['on-demand']).toEqual(['legacy_skill'])
    expect(mapped?.disabled).toEqual(['mcp__secret__*'])
    expect(mapped?.blocked).toBeUndefined()
  })

  it('prefers the current `disabled` key over the legacy `blocked` key', () => {
    const mapped = policy.normalizeSetConfig({ disabled: ['read'], blocked: ['write'] })
    expect(mapped?.disabled).toEqual(['read'])
  })
})
