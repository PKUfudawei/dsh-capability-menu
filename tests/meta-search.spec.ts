import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
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
  await ctx.plugin(registry, registryConfig)
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

async function runTool(
  ctx: Context,
  name: string,
  args: Record<string, unknown>,
): Promise<{ value: unknown; isError: boolean }> {
  const result = await ctx.tools.execute({
    callId: CallId(`call-${name}`),
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
    await ctx.meta.refresh()

    const { value, isError } = await runTool(ctx, 'meta_search', { query: 'issue' })
    expect(isError).toBe(false)
    const result = value as { mode: string; total: number; results: Array<{ id: string }> }
    expect(result.mode).toBe('list')
    expect(result.results.some(item => item.id === issue)).toBe(true)
  })

  it('returns full detail for an exact id', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-meta-search-'))
    const ctx = await setup(home)
    const issue = registerMcpTool(ctx, 'gongfeng', 'create_issue', 'Create an issue')
    await ctx.meta.refresh()

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
    await ctx.meta.refresh()

    const { isError } = await runTool(ctx, 'meta_search', { query: 'issue', detail: true })
    expect(isError).toBe(true)
  })

  it('rejects query and id together', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-meta-search-'))
    const ctx = await setup(home)
    const issue = registerMcpTool(ctx, 'gongfeng', 'create_issue', 'Create an issue')
    await ctx.meta.refresh()

    const { isError } = await runTool(ctx, 'meta_search', { query: 'issue', id: issue })
    expect(isError).toBe(true)
  })

  it('hides blocked capabilities from list and rejects blocked detail', async () => {
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
    await ctx.plugin(registry, {})
    await ctx.plugin(policy, { tools: { blocked: ['mcp__gongfeng__create_issue'] } })
    await ctx.plugin(toolMetaSearch, {})
    const issue = registerMcpTool(ctx, 'gongfeng', 'create_issue', 'Create an issue')
    await ctx.meta.refresh()

    const list = await runTool(ctx, 'meta_search', { query: 'issue' })
    expect(list.isError).toBe(false)
    const listResult = list.value as { mode: string; results: Array<{ id: string }> }
    expect(listResult.results.some(item => item.id === issue)).toBe(false)

    const detail = await runTool(ctx, 'meta_search', { id: issue })
    expect(detail.isError).toBe(true)
  })
})
