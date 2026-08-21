import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import * as registry from '../src/registry.ts'
import * as policy from '../src/policy.ts'
import * as toolMetaInvoke from '../src/invoke.ts'

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

async function setup(home: string, config: toolMetaInvoke.Config = {}, registryConfig: registry.Config = {}): Promise<Context> {
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
  await ctx.plugin(toolMetaInvoke, config)
  return ctx
}

function registerMcpTool(
  ctx: Context,
  server: string,
  raw: string,
  description: string,
  onExecute?: (args: unknown) => unknown,
): string {
  const name = `mcp__${server}__${raw}`
  ctx.tools.register(defineTool({
    name,
    description,
    parameters: { title: { type: 'string', required: true, description: 'Title' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, received: { type: 'json' }, id: { type: 'string' } } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      if (onExecute) return onExecute(args) as never
      return { ok: true, received: args }
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
    callId: CallId(`call-${name}`),
    name,
    arguments: args,
    agent: agentStub('agent'),
    signal: testSignal,
  })
  return { value: result.value, isError: result.isError }
}

describe('capability-menu-invoke', () => {
  it('forwards MCP calls through the tool pipeline and preserves args', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-meta-invoke-'))
    const ctx = await setup(home)
    let received: unknown
    const issue = registerMcpTool(ctx, 'gongfeng', 'create_issue', 'Create an issue', args => {
      received = args
      return { ok: true, id: 'issue-1' }
    })
    await ctx.meta.refresh()

    const { value, isError } = await runTool(ctx, 'meta_invoke', { id: issue, args: { title: 'hello' } })
    expect(isError).toBe(false)
    const result = value as { ok: boolean; kind: string; id: string; detail: { forwarded: boolean; target: string } }
    expect(result.ok).toBe(true)
    expect(result.kind).toBe('mcp')
    expect(result.detail.forwarded).toBe(true)
    expect(result.detail.target).toBe(issue)
    expect(received).toEqual({ title: 'hello' })
  })

  it('surfaces target failure as an isError result', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-meta-invoke-'))
    const ctx = await setup(home)
    const failing = registerMcpTool(ctx, 'gongfeng', 'boom', 'Always fails', () => {
      throw new Error('target exploded')
    })
    await ctx.meta.refresh()

    const { isError } = await runTool(ctx, 'meta_invoke', { id: failing, args: { title: 'x' } })
    expect(isError).toBe(true)
  })

  it('loads a skill and renders content like the skill tool', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-meta-invoke-'))
    // Skills must exist before the skill provider/registry load (see registry tests).
    await writeSkill(`${home}/.agents/skills`, 'frontend-design', 'Design guidance', 'Follow the design principles.')
    const ctx = await setup(home)
    await ctx.meta.refresh()

    const { value, isError } = await runTool(ctx, 'meta_invoke', { id: 'skill:frontend-design' })
    expect(isError).toBe(false)
    const result = value as { ok: boolean; kind: string; detail: { name: string; content: string } }
    expect(result.ok).toBe(true)
    expect(result.kind).toBe('skill')
    expect(result.detail.name).toBe('frontend-design')
    expect(result.detail.content).toContain('design principles')
  })

  it('resolve mode returns the target schema without executing', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-meta-invoke-'))
    let executed = false
    const ctx = await setup(home, { forwardMode: 'resolve' })
    const issue = registerMcpTool(ctx, 'gongfeng', 'create_issue', 'Create an issue', () => {
      executed = true
      return { ok: true }
    })
    await ctx.meta.refresh()

    const { value, isError } = await runTool(ctx, 'meta_invoke', { id: issue, args: { title: 'x' } })
    expect(isError).toBe(false)
    const result = value as { ok: boolean; kind: string; detail: { target: string; parameters: unknown } }
    expect(result.kind).toBe('resolve')
    expect(result.detail.target).toBe(issue)
    expect(result.detail.parameters).toBeDefined()
    expect(executed).toBe(false)
  })

  it('rejects an unknown capability id', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-meta-invoke-'))
    const ctx = await setup(home)
    const { isError } = await runTool(ctx, 'meta_invoke', { id: 'mcp__nope__missing' })
    expect(isError).toBe(true)
  })

  it('loads a Progressive skill from the YAML catalog path when not registered in ctx.skills', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-meta-invoke-'))
    const { mkdir, writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    // Progressive skill exists on disk only via its catalog path, not in the agent skill dir.
    const progressiveRoot = join(home, 'progressive-skills')
    await mkdir(join(progressiveRoot, 'sql-analytics'), { recursive: true })
    await writeFile(join(progressiveRoot, 'sql-analytics', 'SKILL.md'), [
      '---',
      'name: sql-analytics',
      'description: SQL analytics templates',
      '---',
      '',
      'Run the aggregation query templates.',
    ].join('\n'))
    const catalog = join(home, 'progressive-skills.yaml')
    await writeFile(catalog, [
      'skills:',
      `  - name: sql-analytics`,
      `    description: SQL analytics query templates and methods`,
      `    path: ${progressiveRoot}/sql-analytics`,
      '',
    ].join('\n'))
    const ctx = await setup(home, {}, { progressiveSkillCatalog: catalog })
    await ctx.meta.refresh()

    const { value, isError } = await runTool(ctx, 'meta_invoke', { id: 'skill:sql-analytics' })
    expect(isError).toBe(false)
    const result = value as { ok: boolean; kind: string; detail: { name: string; content: string; provider: string } }
    expect(result.ok).toBe(true)
    expect(result.kind).toBe('skill')
    expect(result.detail.name).toBe('sql-analytics')
    expect(result.detail.content).toContain('aggregation query templates')
  })

  it('rejects a blocked capability', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-meta-invoke-'))
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
    await ctx.plugin(toolMetaInvoke, {})
    const issue = registerMcpTool(ctx, 'gongfeng', 'create_issue', 'Create an issue')
    await ctx.meta.refresh()

    const { isError } = await runTool(ctx, 'meta_invoke', { id: issue, args: { title: 'x' } })
    expect(isError).toBe(true)
  })

  it('dedups already-loaded skills and returns a short reminder on repeat', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-meta-invoke-'))
    await writeSkill(`${home}/.agents/skills`, 'frontend-design', 'Design guidance', 'Full design instructions body here.')
    const ctx = await setup(home)
    await ctx.meta.refresh()

    const first = await runTool(ctx, 'meta_invoke', { id: 'skill:frontend-design' })
    expect(first.isError).toBe(false)
    const firstDetail = (first.value as { detail: { content: string } }).detail
    expect(firstDetail.content).toContain('Full design instructions')

    const second = await runTool(ctx, 'meta_invoke', { id: 'skill:frontend-design' })
    expect(second.isError).toBe(false)
    const secondDetail = (second.value as { detail: { content: string } }).detail
    expect(secondDetail.content).not.toContain('Full design instructions')
    expect(secondDetail.content).toContain('already loaded')
  })
})
