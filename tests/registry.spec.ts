import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import * as registry from '../src/registry.ts'
import * as policy from '../src/policy.ts'
import yaml from 'js-yaml'

const testSignal = new AbortController().signal

/** Minimal agent stub used by scope-sensitive lookups. */
function agentStub(name: string) {
  return {
    id: name,
    options: {},
    session: { header: { cwd: process.cwd() } },
    ctx: new Context(),
    status: 'idle',
  } as never
}

async function setup(home: string, config: registry.Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, {
    dshHome: `${home}/.dsh`,
    agentsHome: `${home}/.agents`,
    watch: false,
  })
  await ctx.plugin(registry, config)
  return ctx
}

async function writeSkill(root: string, name: string, description: string, body: string): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`)
}

function registerMcpTool(ctx: Context, server: string, raw: string, description: string): string {
  const name = `mcp__${server}__${raw}`
  ctx.tools.register(defineTool({
    name,
    description,
    parameters: {
      title: { type: 'string', required: true, description: 'Title' },
    },
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

describe('meta-registry', () => {
  it('indexes harness-native tools under the built-in pseudo-server and keeps the control plane out', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-registry-'))
    const ctx = await setup(home)
    registerMcpTool(ctx, 'gongfeng', 'create_issue', 'Create a new issue/ticket/bug report in a Gongfeng project')
    const bash = registerNativeTool(ctx, 'bash', 'Run commands in a bash shell')
    const grep = registerNativeTool(ctx, 'grep', 'Search file contents with regular expressions')
    // The plugin's own control plane and the reserved transport never enter the catalog.
    registerNativeTool(ctx, 'meta_search', 'Search capabilities')
    registerNativeTool(ctx, 'meta_invoke', 'Execute a capability')
    await ctx.capability.refresh()

    // Natives are discoverable and grouped under the reserved built-in server.
    const byBuiltIn = ctx.capability.search({ server: 'built-in' })
    const builtInIds = byBuiltIn.map(summary => summary.id)
    expect(builtInIds).toContain(bash)
    expect(builtInIds).toContain(grep)
    expect(byBuiltIn.every(summary => summary.server === 'built-in')).toBe(true)

    // Control-plane tools stay out of list/detail.
    const allTools = ctx.capability.search({ kind: 'tool', maxResults: 100 })
    const toolIds = allTools.map(summary => summary.id)
    expect(toolIds).not.toContain('meta_search')
    expect(toolIds).not.toContain('meta_invoke')
    expect(ctx.capability.get('meta_search')).toBeUndefined()

    // Detail for a native resolves through the tool registry.
    const detail = await ctx.capability.getDetail(bash)
    expect(detail?.kind).toBe('tool')
    expect(detail?.origin.serverName).toBe('built-in')
  })


  it('indexes MCP tools and model-invocable skills, and searches them', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-registry-'))
    // Skills must exist before the skill provider/registry load: the skill
    // registry caches discovery by revision, and watch:false means a later
    // write is not re-discovered until an explicit invalidation.
    await writeSkill(`${home}/.agents/skills`, 'frontend-design', 'Guidance for distinctive visual design', 'Follow the design guide.')
    const ctx = await setup(home)
    const issue = registerMcpTool(ctx, 'gongfeng', 'create_issue', 'Create a new issue/ticket/bug report in a Gongfeng project')

    // Rebuild triggers are async for skills; await the explicit refresh.
    await ctx.capability.refresh()

    expect(ctx.capability.size()).toBeGreaterThanOrEqual(2)
    const byIssue = ctx.capability.search({ query: 'create_issue' })
    expect(byIssue.some(summary => summary.id === issue)).toBe(true)

    const byKeyword = ctx.capability.search({ query: 'issue' })
    expect(byKeyword.some(summary => summary.id === issue)).toBe(true)

    const byServer = ctx.capability.search({ server: 'gongfeng' })
    expect(byServer.every(summary => summary.server === 'gongfeng')).toBe(true)

    const skill = ctx.capability.search({ kind: 'skill' })
    expect(skill.some(summary => summary.id === 'frontend-design')).toBe(true)
    // Skills carry their filesystem source root so the 能力管理 can group them
    // into project vs global sections (user-agents = a global user dir here).
    expect(skill.find(summary => summary.id === 'frontend-design')?.source).toBe('user-agents')

    // Detail for the MCP tool exposes parameters + output.
    const detail = await ctx.capability.getDetail(issue, { scope: agentStub('agent') })
    expect(detail?.kind).toBe('tool')
    expect(detail?.parameters).toBeDefined()
    expect((detail?.parameters as { properties?: unknown }).properties).toHaveProperty('title')

    // Detail for the skill does not include the body by default.
    const skillDetail = await ctx.capability.getDetail('frontend-design')
    expect(skillDetail?.kind).toBe('skill')
    expect(skillDetail?.output).toBeUndefined()
  })

  it('service search tolerates a fuzzy query (the detail:true rule lives in the tool layer)', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-registry-'))
    const ctx = await setup(home)
    registerMcpTool(ctx, 'iwiki', 'get_document', 'Get a wiki document')
    await ctx.capability.refresh()
    // The service allows any query; the meta_search tool wrapper enforces the detail/fuzzy rule.
    const results = ctx.capability.search({ query: 'wiki' })
    expect(results.length).toBeGreaterThan(0)
  })

  it('writes objective stats back from tools/result for MCP names', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-registry-'))
    const ctx = await setup(home)
    const issue = registerMcpTool(ctx, 'gongfeng', 'create_issue', 'Create an issue')
    await ctx.capability.refresh()
    const before = ctx.capability.get(issue)?.stats.uses ?? 0

    const exec = {
      callId: ToolCallId('call-1'),
      name: issue,
      arguments: { title: 'x' },
      signal: testSignal,
    }
    const result = await ctx.tools.execute(exec)
    expect(result.isError).toBe(false)
    const after = ctx.capability.get(issue)?.stats.uses ?? 0
    expect(after).toBe(before + 1)
  })

  it('lists a skill directory and reads its text files with containment', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-registry-'))
    const { mkdir, writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const skillDir = `${home}/.agents/skills/browse-me`
    await mkdir(skillDir, { recursive: true })
    await mkdir(join(skillDir, 'templates'), { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: browse-me\ndescription: A skill for directory browsing\n---\n\nBody.\n')
    await writeFile(join(skillDir, 'notes.txt'), 'plain text\n')
    await writeFile(join(skillDir, 'templates', 'a.tmpl'), 'template body\n')
    const ctx = await setup(home)
    await ctx.capability.refresh()

    const listing = await ctx.capability.listSkillDir('browse-me')
    const names = listing?.map(entry => `${entry.type}:${entry.name}`)
    expect(names).toContain('directory:templates')
    expect(names).toContain('file:notes.txt')

    expect(await ctx.capability.readSkillFile('browse-me', 'notes.txt')).toBe('plain text\n')
    expect(await ctx.capability.readSkillFile('browse-me', 'templates/a.tmpl')).toBe('template body\n')
    // Directory escape is rejected.
    expect(await ctx.capability.readSkillFile('browse-me', '../outside.txt')).toBeUndefined()
    // A directory addressed as a file is rejected.
    expect(await ctx.capability.readSkillFile('browse-me', 'templates')).toBeUndefined()
  })

  it('enumerates skills across agent-preset standing scopes when agentPresets exists', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-registry-'))
    await writeSkill(`${home}/.agents/skills`, 'global-skill', 'A global-layer skill', 'Global body.')
    const ctx = await setup(home)

    // Fake agent-presets service: one preset with a standing scope that hosts
    // its own scoped skill provider. The registry must enumerate that scope,
    // not just the global layer.
    const scopes = new Map<string, { provider: { name: string; source: string }[] }>()
    const agentPresets = {
      async list(): Promise<Array<{ id: string; broken?: string }>> {
        return [{ id: 'coding-plus' }, { id: 'broken-preset', broken: 'unparsable' }]
      },
      async standingKeyFor(id?: string): Promise<unknown> {
        const key = { agentPreset: id }
        scopes.set(String(id), { provider: [] })
        return key
      },
    }
    ctx.provide('agentPresets', agentPresets)
    await ctx.capability.refresh()

    // Global-layer skill indexed as before.
    const globalSkill = ctx.capability.search({ kind: 'skill' })
    expect(globalSkill.some(summary => summary.id === 'global-skill')).toBe(true)
    // Broken presets are skipped; the mountable preset's scope was enumerated.
    expect(scopes.has('coding-plus')).toBe(true)
    expect(scopes.has('broken-preset')).toBe(false)
  })

  it('enumerates agent-preset standing scopes for tools as well as skills', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-registry-'))
    const ctx = await setup(home)
    registerNativeTool(ctx, 'bash', 'Run commands in a bash shell')

    // Both the tool pass (rebuildTools) and the skill pass (refreshSkills)
    // request each preset's standing scope; count the requests to prove the
    // tool side consumes preset scopes, not only the global view. The preset
    // list starts empty so the registry's eager mount-time passes see nothing;
    // only the explicit refresh() below enumerates the preset.
    const requested = new Map<string, number>()
    let presets: Array<{ id: string; broken?: string }> = []
    const agentPresets = {
      async list(): Promise<Array<{ id: string; broken?: string }>> {
        return presets
      },
      async standingKeyFor(id?: string): Promise<unknown> {
        const name = String(id)
        requested.set(name, (requested.get(name) ?? 0) + 1)
        return { agentPreset: id }
      },
    }
    ctx.provide('agentPresets', agentPresets)
    // Let the mount-time eager tool/skill refresh settle against the empty list.
    await new Promise(resolve => setTimeout(resolve, 10))
    presets = [{ id: 'coding-plus' }]
    await ctx.capability.refresh()

    // One request from the tools pass + one from the skills pass.
    expect(requested.get('coding-plus')).toBe(2)
    // Native tools stay cataloged under the built-in pseudo-server.
    const builtIn = ctx.capability.search({ server: 'built-in', maxResults: 100 })
    expect(builtIn.map(summary => summary.id)).toContain('bash')
  })

  it('emits the on-demand catalog YAML with only On-demand capabilities', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-registry-'))
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const catalogFile = join(home, 'capability-catalog.yaml')
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, {
      dshHome: `${home}/.dsh`,
      agentsHome: `${home}/.agents`,
      watch: false,
    })
    await ctx.plugin(registry, { catalogFile })
    await ctx.plugin(policy, {
      tools: {
        resident: ['mcp__gongfeng__create_issue'],
        'on-demand': ['mcp__km__search'],
        disabled: ['mcp__secret__read'],
      },
    })
    registerMcpTool(ctx, 'gongfeng', 'create_issue', 'Create an issue')
    // Deliberately long description: the catalog must carry the trimmed
    // summary (≤ 160 chars), not the full body, to bound file size.
    registerMcpTool(ctx, 'km', 'search', 'Search the knowledge base and return relevant documents and snippets. '.repeat(6))
    registerMcpTool(ctx, 'secret', 'read', 'Read a secret')
    await ctx.capability.refresh()

    expect(ctx.capability.catalogPath()).toBe(catalogFile)
    const raw = await readFile(catalogFile, 'utf8')
    const doc = yaml.load(raw) as { capabilities: Array<{ id: string; description: string }> }
    const ids = doc.capabilities.map(entry => entry.id)
    expect(ids).toContain('mcp__km__search')
    expect(ids).not.toContain('mcp__gongfeng__create_issue')
    expect(ids).not.toContain('mcp__secret__read')
    expect(doc.capabilities.find(entry => entry.id === 'mcp__km__search')?.description.length).toBeLessThanOrEqual(160)
    // The emitted YAML uses block sequences (`- id: ...`), not flow arrays.
    expect(raw).toContain('- id: mcp__km__search')
    expect(raw).not.toMatch(/capabilities:\s*\[/)

    // C2: reclassifying the On-demand capability to disabled must remove it
    // from the disk catalog — the grep-able file must not keep exposing it
    // after the in-memory classification changed. updateConfig is awaited, so
    // the disk rewrite is complete by the time it returns.
    await ctx.capabilityPolicy.updateConfig({ tools: { disabled: ['mcp__km__search'] } })
    const doc2 = yaml.load(await readFile(catalogFile, 'utf8')) as { capabilities: Array<{ id: string }> }
    expect(doc2.capabilities.map(entry => entry.id)).not.toContain('mcp__km__search')
  })
})
