import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
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

describe('meta-registry', () => {
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
    expect(skill.some(summary => summary.id === 'skill:frontend-design')).toBe(true)

    // Detail for the MCP tool exposes parameters + output.
    const detail = await ctx.capability.getDetail(issue, { scope: agentStub('agent') })
    expect(detail?.kind).toBe('tool')
    expect(detail?.parameters).toBeDefined()
    expect((detail?.parameters as { properties?: unknown }).properties).toHaveProperty('title')

    // Detail for the skill does not include the body by default.
    const skillDetail = await ctx.capability.getDetail('skill:frontend-design')
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
      callId: CallId('call-1'),
      name: issue,
      arguments: { title: 'x' },
      signal: testSignal,
    }
    const result = await ctx.tools.execute(exec)
    expect(result.isError).toBe(false)
    const after = ctx.capability.get(issue)?.stats.uses ?? 0
    expect(after).toBe(before + 1)
  })

  it('indexes Progressive skills from the independent YAML catalog (§7.2)', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-registry-'))
    const { writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const catalog = join(home, 'progressive-skills.yaml')
    await writeFile(catalog, [
      'skills:',
      '  - name: sql-analytics',
      '    description: SQL analytics query templates and methods',
      '    whenToUse: aggregate queries or reporting',
      '    path: /srv/skills/sql-analytics',
      '  - name: incident-runbook',
      '    description: Incident runbook and triage flow',
      '    path: /srv/skills/incident-runbook',
      '',
    ].join('\n'))
    const ctx = await setup(home, { progressiveSkillCatalog: catalog })
    await ctx.capability.refresh()

    const found = ctx.capability.search({ kind: 'skill', query: 'sql' })
    const sql = found.find(summary => summary.id === 'skill:sql-analytics')
    expect(sql).toBeDefined()
    expect(sql?.kind).toBe('skill')
    expect(sql?.summary).toContain('SQL analytics')

    const detail = await ctx.capability.getDetail('skill:incident-runbook')
    expect(detail?.kind).toBe('skill')
    expect(detail?.origin.path).toBe('/srv/skills/incident-runbook')
    expect(detail?.tags).toContain('progressive-catalog')
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

    const listing = await ctx.capability.listSkillDir('skill:browse-me')
    const names = listing?.map(entry => `${entry.type}:${entry.name}`)
    expect(names).toContain('directory:templates')
    expect(names).toContain('file:notes.txt')

    expect(await ctx.capability.readSkillFile('skill:browse-me', 'notes.txt')).toBe('plain text\n')
    expect(await ctx.capability.readSkillFile('skill:browse-me', 'templates/a.tmpl')).toBe('template body\n')
    // Directory escape is rejected.
    expect(await ctx.capability.readSkillFile('skill:browse-me', '../outside.txt')).toBeUndefined()
    // A directory addressed as a file is rejected.
    expect(await ctx.capability.readSkillFile('skill:browse-me', 'templates')).toBeUndefined()
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
    expect(globalSkill.some(summary => summary.id === 'skill:global-skill')).toBe(true)
    // Broken presets are skipped; the mountable preset's scope was enumerated.
    expect(scopes.has('coding-plus')).toBe(true)
    expect(scopes.has('broken-preset')).toBe(false)
  })

  it('emits the on-demand catalog YAML with only Progressive capabilities', async () => {
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
        exposed: ['mcp__gongfeng__create_issue'],
        progressive: ['mcp__km__search'],
        blocked: ['mcp__secret__read'],
      },
    })
    registerMcpTool(ctx, 'gongfeng', 'create_issue', 'Create an issue')
    // Deliberately long description: the catalog must carry the trimmed
    // summary (≤ 160 chars), not the full body, to bound file size.
    registerMcpTool(ctx, 'km', 'search', 'Search the knowledge base and return relevant documents and snippets. '.repeat(6))
    registerMcpTool(ctx, 'secret', 'read', 'Read a secret')
    await ctx.capability.refresh()

    expect(ctx.capability.catalogPath()).toBe(catalogFile)
    const doc = yaml.load(await readFile(catalogFile, 'utf8')) as { capabilities: Array<{ id: string; description: string }> }
    const ids = doc.capabilities.map(entry => entry.id)
    expect(ids).toContain('mcp__km__search')
    expect(ids).not.toContain('mcp__gongfeng__create_issue')
    expect(ids).not.toContain('mcp__secret__read')
    expect(doc.capabilities.find(entry => entry.id === 'mcp__km__search')?.description.length).toBeLessThanOrEqual(160)

    // C2: reclassifying the Progressive capability to blocked must remove it
    // from the disk catalog — the grep-able file must not keep exposing it
    // after the in-memory classification changed. updateConfig is awaited, so
    // the disk rewrite is complete by the time it returns.
    await ctx.capabilityPolicy.updateConfig({ tools: { blocked: ['mcp__km__search'] } })
    const doc2 = yaml.load(await readFile(catalogFile, 'utf8')) as { capabilities: Array<{ id: string }> }
    expect(doc2.capabilities.map(entry => entry.id)).not.toContain('mcp__km__search')
  })
})
