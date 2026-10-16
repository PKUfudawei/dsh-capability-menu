import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import * as registry from '../src/registry.ts'
import * as policy from '../src/policy.ts'
import * as toolMetaSearch from '../src/search.ts'

const testSignal = new AbortController().signal

function agentStub(name: string) {
  return {
    id: name,
    options: {},
    session: { header: { cwd: process.cwd() } },
    ctx: new Context(),
    status: 'idle',
  } as never
}

async function setup(home: string, config: toolMetaSearch.Config = {}, registryConfig: registry.Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, {
    dshHome: `${home}/.dsh`,
    agentsHome: `${home}/.agents`,
    watch: false,
  })
  // Disable on-demand catalog emission by default so tests never write the
  // real ~/.dsh; callers override via registryConfig when they test it.
  await ctx.plugin(registry, { catalogFile: '', ...registryConfig })
  await ctx.plugin(toolMetaSearch, config)
  return ctx
}

function registerMcpTool(ctx: Context, server: string, raw: string, description: string): string {
  const name = `mcp__${server}__${raw}`
  ctx.tools.register(defineTool({
    name,
    description,
    parameters: { title: { type: 'string', required: true, description: 'Title' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, received: { type: 'json' } } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      return { ok: true, received: args }
    },
  }))
  return name
}

function registerNativeTool(ctx: Context, name: string, description: string): string {
  ctx.tools.register(defineTool({
    name,
    description,
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: false } },
    async execute() {
      return { ok: true }
    },
  }))
  return name
}

async function writeSkill(root: string, name: string, description: string, body: string): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`)
}

async function runTool(
  ctx: Context,
  name: string,
  args: Record<string, unknown>,
): Promise<{ value: unknown; isError: boolean }> {
  const result = await ctx.tools.execute({
    callId: ToolCallId(`call-${name}`),
    name,
    arguments: args,
    agent: agentStub('agent'),
    signal: testSignal,
  })
  return { value: result.value, isError: result.isError }
}

describe('capability-menu-search', () => {
  it('lists capabilities by keyword query', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-meta-search-'))
    const ctx = await setup(home)
    const issue = registerMcpTool(ctx, 'gongfeng', 'create_issue', 'Create a new issue/ticket/bug report in a Gongfeng project')
    await ctx.capability.refresh()

    const { value, isError } = await runTool(ctx, 'meta_search', { query: 'issue' })
    expect(isError).toBe(false)
    const result = value as { mode: string; total: number; returned: number; offset: number; has_more: boolean; results: Array<{ id: string }> }
    expect(result.mode).toBe('list')
    expect(result.results.some(item => item.id === issue)).toBe(true)
    expect(result.total).toBeGreaterThanOrEqual(result.returned)
    expect(result.offset).toBe(0)
  })

  it('reports the full filtered total and reaches results after the first page', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-meta-search-'))
    const ctx = await setup(home)
    const ids = Array.from({ length: 57 }, (_, index) => registerMcpTool(ctx, 'paging', `item_${String(index).padStart(2, '0')}`, 'pagination sample capability'))
    await ctx.capability.refresh()

    const first = await runTool(ctx, 'meta_search', { query: 'pagination sample', kind: 'tool', max_results: 50 })
    expect(first.isError).toBe(false)
    const page1 = first.value as { total: number; returned: number; offset: number; has_more: boolean; results: Array<{ id: string }> }
    expect(page1.total).toBe(57)
    expect(page1.returned).toBe(50)
    expect(page1.offset).toBe(0)
    expect(page1.has_more).toBe(true)

    const second = await runTool(ctx, 'meta_search', { query: 'pagination sample', kind: 'tool', max_results: 50, offset: 50 })
    expect(second.isError).toBe(false)
    const page2 = second.value as { total: number; returned: number; offset: number; has_more: boolean; results: Array<{ id: string }> }
    expect(page2.total).toBe(57)
    expect(page2.returned).toBe(7)
    expect(page2.offset).toBe(50)
    expect(page2.has_more).toBe(false)
    expect(new Set([...page1.results, ...page2.results].map(row => row.id))).toEqual(new Set(ids))
  })

  it('does not search or inspect capabilities outside the caller scope', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-meta-search-'))
    await writeSkill(`${home}/.agents/skills`, 'out-of-scope-skill', 'Hidden skill description', 'Hidden body.')
    const ctx = await setup(home)
    await ctx.capability.refresh()
    ctx.skills.list = async () => []
    expect(await ctx.skills.list({})).toEqual([])

    const list = await runTool(ctx, 'meta_search', { query: 'Hidden skill', kind: 'skill' })
    expect(list.isError).toBe(false)
    expect((list.value as { total: number; results: Array<{ id: string }> }).total).toBe(0)
    const detail = await runTool(ctx, 'meta_search', { id: 'out-of-scope-skill', kind: 'skill' })
    expect(detail.isError).toBe(true)
  })

  it('returns full detail for an exact id', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-meta-search-'))
    const ctx = await setup(home)
    const issue = registerMcpTool(ctx, 'gongfeng', 'create_issue', 'Create an issue')
    await ctx.capability.refresh()

    const { value, isError } = await runTool(ctx, 'meta_search', { id: issue })
    expect(isError).toBe(false)
    const result = value as { mode: string; result: { kind: string; parameters: { properties?: Record<string, unknown> } } }
    expect(result.mode).toBe('detail')
    expect(result.result.kind).toBe('tool')
    expect(result.result.parameters.properties).toHaveProperty('title')
  })

  it('rejects detail:true without an exact id', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-meta-search-'))
    const ctx = await setup(home)
    registerMcpTool(ctx, 'gongfeng', 'create_issue', 'Create an issue')
    await ctx.capability.refresh()

    const { isError } = await runTool(ctx, 'meta_search', { query: 'issue', detail: true })
    expect(isError).toBe(true)
  })

  it('rejects query and id together', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-meta-search-'))
    const ctx = await setup(home)
    const issue = registerMcpTool(ctx, 'gongfeng', 'create_issue', 'Create an issue')
    await ctx.capability.refresh()

    const { isError } = await runTool(ctx, 'meta_search', { query: 'issue', id: issue })
    expect(isError).toBe(true)
  })

  it('searches and details harness-native tools via the built-in server', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-meta-search-'))
    const ctx = await setup(home)
    const grep = registerNativeTool(ctx, 'grep', 'Search file contents with regular expressions')
    registerMcpTool(ctx, 'gongfeng', 'search', 'Find issues by keyword')
    await ctx.capability.refresh()

    const { value, isError } = await runTool(ctx, 'meta_search', { query: 'regular expressions' })
    expect(isError).toBe(false)
    const result = value as { mode: string; results: Array<{ id: string; server?: string }> }
    // The native is ranked and carries the reserved built-in server on the wire.
    expect(result.results.some(item => item.id === grep && item.server === 'built-in')).toBe(true)

    const detail = await runTool(ctx, 'meta_search', { id: grep })
    expect(detail.isError).toBe(false)
    const detailResult = detail.value as { mode: string; result: { kind: string; name: string } }
    expect(detailResult.mode).toBe('detail')
    expect(detailResult.result.kind).toBe('tool')
    expect(detailResult.result.name).toBe(grep)
  })

  it('hides disabled capabilities from list and rejects disabled detail', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-meta-search-'))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, {
      dshHome: `${home}/.dsh`,
      agentsHome: `${home}/.agents`,
      watch: false,
    })
    await ctx.plugin(registry, { catalogFile: '' })
    await ctx.plugin(policy, { tools: { disabled: ['mcp__gongfeng__create_issue'] } })
    await ctx.plugin(toolMetaSearch, {})
    const issue = registerMcpTool(ctx, 'gongfeng', 'create_issue', 'Create an issue')
    await ctx.capability.refresh()

    const list = await runTool(ctx, 'meta_search', { query: 'issue' })
    expect(list.isError).toBe(false)
    const listResult = list.value as { mode: string; results: Array<{ id: string }> }
    expect(listResult.results.some(item => item.id === issue)).toBe(false)

    const detail = await runTool(ctx, 'meta_search', { id: issue })
    expect(detail.isError).toBe(true)
  })

  it('does not let disabled hits consume result slots', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-meta-search-'))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, {
      dshHome: `${home}/.dsh`,
      agentsHome: `${home}/.agents`,
      watch: false,
    })
    await ctx.plugin(registry, { catalogFile: '' })
    await ctx.plugin(policy, { tools: { disabled: ['mcp__gongfeng__blocked_issue'] } })
    await ctx.plugin(toolMetaSearch, {})
    // Registered first, so it ranks first for the shared keyword — and used to
    // eat the only result slot before being filtered out.
    registerMcpTool(ctx, 'gongfeng', 'blocked_issue', 'Issue tool that is disabled')
    const allowed = registerMcpTool(ctx, 'gongfeng', 'open_issue', 'Issue tool that stays resident')
    await ctx.capability.refresh()

    const { value, isError } = await runTool(ctx, 'meta_search', { query: 'issue', max_results: 1 })
    expect(isError).toBe(false)
    const result = value as { mode: string; results: Array<{ id: string }> }
    expect(result.results.map(item => item.id)).toEqual([allowed])
  })

  it('hides disabled skills from list and rejects disabled skill detail', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-meta-search-'))
    await writeSkill(`${home}/.agents/skills`, 'forbidden-skill', 'Forbidden skill body', 'Body text.')
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, {
      dshHome: `${home}/.dsh`,
      agentsHome: `${home}/.agents`,
      watch: false,
    })
    await ctx.plugin(registry, { catalogFile: '' })
    await ctx.plugin(policy, { skills: { disabled: ['forbidden-skill'] } })
    await ctx.plugin(toolMetaSearch, {})
    await ctx.capability.refresh()

    const list = await runTool(ctx, 'meta_search', { query: 'Forbidden' })
    expect(list.isError).toBe(false)
    const listResult = list.value as { mode: string; results: Array<{ id: string }> }
    expect(listResult.results.some(item => item.id === 'forbidden-skill')).toBe(false)

    const detail = await runTool(ctx, 'meta_search', { id: 'forbidden-skill' })
    expect(detail.isError).toBe(true)
  })
})
