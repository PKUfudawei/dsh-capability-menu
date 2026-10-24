import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { createScope } from '@deepseek-ai/dsh-scope'
import * as registry from '../src/registry.ts'
import * as policy from '../src/policy.ts'
import { readMenuState, readTierState } from '../src/policy-state.ts'

const testSignal = new AbortController().signal

/** Sleep long enough for a debounce window plus a rebuild to elapse. */
function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

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
  await ctx.plugin(registry, { stateFile: '', ...config })
  return ctx
}

async function writeSkill(
  root: string,
  name: string,
  description: string,
  body: string,
  extraFrontmatter = '',
): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n${extraFrontmatter}---\n\n${body}\n`)
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
  it('keeps migrated search settings and tier choices in one state file', async () => {
    const { mkdtemp, readdir, writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const home = await mkdtemp('/tmp/dsh-registry-state-')
    const stateFile = join(home, 'capability-menu-policy.json')
    const legacyFile = join(home, 'capability-menu-search-metadata.json')
    await writeFile(stateFile, JSON.stringify({ version: 1, tools: { bash: 'resident' }, skills: {} }))
    await writeFile(legacyFile, JSON.stringify({ _settings: { summaryMaxChars: 180 } }))
    const ctx = await setup(home, { stateFile })
    registerMcpTool(ctx, 'km', 'search', 'Search the knowledge base')
    await ctx.capability.refresh()

    expect(ctx.capability.summaryMaxChars()).toBe(180)
    await ctx.capability.updateSearchMetadata({ id: 'mcp__km__search', kind: 'tool', description: 'Find knowledge' })
    await ctx.capability.updateSummaryMaxChars(140)
    const state = await readMenuState(stateFile)
    expect(state.tiers.tool.get('bash')).toBe('resident')
    expect(state.search.summaryMaxChars).toBe(140)
    expect(state.search.descriptions.get('tool:mcp__km__search')).toBe('Find knowledge')
    expect((await readdir(home)).some(name => name.startsWith('capability-menu-search-metadata.json.migrated-'))).toBe(true)
  })

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
    // Skills carry their filesystem source root so the 能力菜单 can group them
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

  it('searches by keyword without requiring an exact id', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-registry-'))
    const ctx = await setup(home)
    registerMcpTool(ctx, 'iwiki', 'get_document', 'Get a wiki document')
    await ctx.capability.refresh()
    const results = ctx.capability.search({ query: 'wiki' })
    expect(results.length).toBeGreaterThan(0)
  })

  it('matches only the displayed description for default and custom search text', async () => {
    const { mkdtemp } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const home = await mkdtemp('/tmp/dsh-registry-summary-limit-')
    const description = `Useful guide ${'filler '.repeat(52)} deepneedle`
    await writeSkill(`${home}/.agents/skills`, 'long-guide', description, 'Guide body.')
    const ctx = await setup(home, { stateFile: join(home, 'capability-menu-policy.json') })
    const tool = registerMcpTool(ctx, 'limits', 'inspect', description)
    await ctx.capability.refresh()

    expect(ctx.capability.search({ query: 'deepneedle' })).toEqual([])
    await ctx.capability.updateSummaryMaxChars(420)
    expect(ctx.capability.search({ query: 'deepneedle' }).map(row => row.id).sort()).toEqual([tool, 'long-guide'].sort())

    await ctx.capability.updateSearchMetadata({ id: tool, kind: 'tool', description: 'customneedle only' })
    expect(ctx.capability.search({ query: 'deepneedle' }).map(row => row.id)).toEqual(['long-guide'])
    expect(ctx.capability.search({ query: 'customneedle' }).map(row => row.id)).toEqual([tool])
    expect((await ctx.capability.getDetail(tool, 'tool'))?.description).toContain('deepneedle')
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

  it('enumerates skills across agent-preset scopes when agentPresets exists', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-registry-'))
    await writeSkill(`${home}/.agents/skills`, 'global-skill', 'A global-layer skill', 'Global body.')
    const ctx = await setup(home)

    // Fake agent-presets service: one preset with a scope that hosts
    // its own scoped skill provider. The registry must enumerate that scope,
    // not just the global layer.
    const scopes = new Map<string, { provider: { name: string; source: string }[] }>()
    const agentPresets = {
      async list(): Promise<Array<{ id: string; broken?: string }>> {
        return [{ id: 'coding-plus' }, { id: 'broken-preset', broken: 'unparsable' }]
      },
      async acquireScope(id?: string) {
        const key = { agentPreset: id }
        scopes.set(String(id), { provider: [] })
        return { key }
      },
    }
    ctx.provide('agentPresets', agentPresets)
    await ctx.capability.refresh()

    // Global-layer skill indexed as before.
    const globalSkill = ctx.capability.search({ kind: 'skill' })
    expect(globalSkill.some(summary => summary.id === 'global-skill')).toBe(true)
    expect(ctx.capability.diagnostics().brokenPresets).toContainEqual({ id: 'broken-preset', reason: 'unparsable' })
    // Broken presets are skipped; the mountable preset's scope was enumerated.
    expect(scopes.has('coding-plus')).toBe(true)
    expect(scopes.has('broken-preset')).toBe(false)
  })

  it('records which agent preset a scoped skill came from, and keeps the global copy of a same-named skill', async () => {
    const { mkdtemp } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const home = await mkdtemp('/tmp/dsh-registry-')
    const presetSkills = join(home, 'presets/cordis/skills')
    await writeSkill(`${home}/.agents/skills`, 'global-skill', 'A global-layer skill', 'Global body.')
    await writeSkill(`${home}/.agents/skills`, 'shared-name', 'The global copy', 'Global body.')
    await writeSkill(presetSkills, 'preset-skill', 'Ships inside the preset', 'Preset body.')
    await writeSkill(presetSkills, 'shared-name', 'The preset copy', 'Preset body.')

    const ctx = await setup(home)
    // A preset mount is a scope of its own that hosts its own skill
    // provider; `customSkillDirs` is how dsh's shipped presets mount `skills/`.
    // Its skills are therefore labelled `custom` — the same label a user's own
    // customSkillDirs entry gets — which is why the preset id has to be
    // recorded separately.
    const key = { agentPreset: 'cordis' }
    const scoped = createScope(ctx, key)
    await scoped.ctx.plugin(SkillFileSystem, {
      dshHome: `${home}/.dsh`,
      agentsHome: `${home}/.agents`,
      customSkillDirs: [presetSkills],
      includeDefaultRoots: false,
      watch: false,
    })
    ctx.provide('agentPresets', {
      async list(): Promise<Array<{ id: string; broken?: string }>> {
        return [{ id: 'cordis' }]
      },
      async acquireScope() {
        return { key }
      },
    })
    await ctx.capability.refresh()

    const summaries = new Map(
      ctx.capability.search({ kind: 'skill', maxResults: 100 }).map(summary => [summary.id, summary]),
    )
    // A skill that exists only in the preset layer carries its preset id.
    expect(summaries.get('preset-skill')?.preset).toBe('cordis')
    expect(summaries.get('preset-skill')?.source).toBe('custom')
    expect(ctx.capability.get('preset-skill', 'skill')?.origin.preset).toBe('cordis')

    // A scoped view is the global layer plus that preset's own layer, so the
    // preset pass sees global skills too. Re-indexing them must not relabel
    // them as preset skills.
    expect(summaries.get('global-skill')?.preset).toBeUndefined()
    expect(ctx.capability.get('global-skill', 'skill')?.origin.source).toBe('user-agents')

    // Same name in both layers: the global layer wins and the preset's copy is
    // not the indexed record (a skill id is a bare name, so only one may be).
    expect(summaries.get('shared-name')?.preset).toBeUndefined()
    expect(ctx.capability.get('shared-name', 'skill')?.origin.path).toBe(join(home, '.agents/skills/shared-name'))
    expect(ctx.capability.diagnostics().shadowedSkills).toContainEqual({
      name: 'shared-name', selectedFrom: 'global', shadowedFrom: 'cordis',
    })
  })

  it('supports the DSH 0.2 lease-based preset scope API and always disposes leases', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-registry-'))
    const ctx = await setup(home)
    const disposeSymbol = (Symbol as unknown as { asyncDispose?: symbol }).asyncDispose ?? Symbol.for('nodejs.asyncDispose')
    let acquired = 0
    let disposed = 0
    ctx.provide('agentPresets', {
      async list(): Promise<Array<{ id: string }>> { return [{ id: 'lease-preset' }] },
      async acquireScope(id?: string) {
        acquired += 1
        return {
          key: { agentPreset: id },
          [disposeSymbol]: async () => { disposed += 1 },
        }
      },
    })
    await ctx.capability.refresh()
    for (let attempt = 0; attempt < 20 && disposed !== acquired; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(acquired).toBeGreaterThanOrEqual(2)
    expect(disposed).toBe(acquired)
  })

  it('paginates registry results and uses useful skill summary fallbacks', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-registry-'))
    const { mkdir, writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const skillDir = join(home, '.agents/skills/summary-fallback')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: summary-fallback\ndescription: "|||||||"\nwhenToUse: Useful fallback guidance\n---\n\nBody.\n')
    const ctx = await setup(home)
    for (let index = 0; index < 3; index += 1) registerMcpTool(ctx, 'paging', `row_${index}`, 'Page result')
    await ctx.capability.refresh()
    const first = ctx.capability.search({ kind: 'tool', query: 'Page result', maxResults: 2 })
    const second = ctx.capability.search({ kind: 'tool', query: 'Page result', maxResults: 2, offset: 2 })
    expect(first).toHaveLength(2)
    expect(second).toHaveLength(1)
    expect(ctx.capability.search({ kind: 'skill' }).find(row => row.id === 'summary-fallback')?.summary).toContain('Useful fallback guidance')
    expect(ctx.capability.diagnostics().undocumentedSkills).toContainEqual({ name: 'summary-fallback', summary: 'Useful fallback guidance' })
  })

  it('enumerates agent-preset scopes for tools as well as skills', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-registry-'))
    const ctx = await setup(home)
    registerNativeTool(ctx, 'bash', 'Run commands in a bash shell')

    // Both the tool pass (rebuildTools) and the skill pass (refreshSkills)
    // request each preset's scope; count the requests to prove the
    // tool side consumes preset scopes, not only the global view. The preset
    // list starts empty so the registry's eager mount-time passes see nothing;
    // only the explicit refresh() below enumerates the preset.
    const requested = new Map<string, number>()
    let presets: Array<{ id: string; broken?: string }> = []
    const agentPresets = {
      async list(): Promise<Array<{ id: string; broken?: string }>> {
        return presets
      },
      async acquireScope(id?: string) {
        const name = String(id)
        requested.set(name, (requested.get(name) ?? 0) + 1)
        return { key: { agentPreset: id } }
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

  it('indexes live session tools and cwd-dependent project skills', async () => {
    const { mkdir, mkdtemp } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const home = await mkdtemp('/tmp/dsh-registry-')
    const project = join(home, 'project')
    await mkdir(join(project, '.git'), { recursive: true })
    await writeSkill(join(project, '.agents/skills'), 'project-only', 'Project guidance', 'Project body.')
    const ctx = await setup(home, { refreshDebounceMs: 5 })
    const agent = agentStub('project-agent') as { ctx: Context; session: { header: { cwd: string } } }
    agent.session.header.cwd = project
    const scoped = createScope(ctx, agent as never)
    agent.ctx = scoped.ctx
    await scoped.ctx.plugin({
      name: 'session-only-tool',
      inject: ['tools'],
      apply(scope) { registerNativeTool(scope, 'session_only', 'Only this session') },
    })
    expect(ctx.tools.schemas().map(tool => tool.name)).not.toContain('session_only')
    const live: typeof agent[] = []
    ctx.provide('agents', { list: () => live })
    await ctx.capability.refresh()
    live.push(agent)
    ctx.emit('agent/created', { agent: agent as never, source: 'startup' })
    await vi.waitFor(() => expect(ctx.capability.get('project-only', 'skill')).toBeDefined())

    const rows = ctx.capability.search({ maxResults: 100 })
    expect(rows.map(row => row.id)).toContain('session_only')
    expect(rows.find(row => row.id === 'project-only')).toMatchObject({
      kind: 'skill', source: 'project-agents',
    })
    expect((await ctx.capability.listSkillDir('project-only'))?.map(entry => entry.name)).toContain('SKILL.md')
    expect(await ctx.capability.readSkillFile('project-only', 'SKILL.md')).toContain('Project body.')

    live.length = 0
    ctx.emit('agent/disposed', { agent: agent as never })
    await vi.waitFor(() => {
      expect(ctx.capability.get('session_only', 'tool')).toBeUndefined()
      expect(ctx.capability.get('project-only', 'skill')).toBeUndefined()
    })
  })

  it('keeps the catalog complete and serialises overlapping refreshes', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-registry-'))
    await writeSkill(`${home}/.agents/skills`, 'overlap-skill', 'A skill indexed while refreshes overlap', 'Body.')
    const ctx = await setup(home, { refreshDebounceMs: 5 })
    const issue = registerMcpTool(ctx, 'gongfeng', 'create_issue', 'Create an issue')
    const bash = registerNativeTool(ctx, 'bash', 'Run commands in a bash shell')

    // Gate the first preset enumeration so the initial refresh suspends
    // mid-flight and a second refresh is requested before it resumes — the
    // overlap the epoch guards exist for.
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    let listCalls = 0
    let inFlight = 0
    let maxInFlight = 0
    ctx.provide('agentPresets', {
      async list(): Promise<Array<{ id: string; broken?: string }>> {
        listCalls += 1
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        try {
          if (listCalls === 1) await gate
          return [{ id: 'coding-plus' }]
        } finally {
          inFlight -= 1
        }
      },
      async acquireScope(id?: string) {
        return { key: { agentPreset: id } }
      },
    })

    const first = ctx.capability.refresh()
    const second = ctx.capability.refresh()
    release?.()
    await Promise.all([first, second])

    const ids = ctx.capability.search({ maxResults: Number.MAX_SAFE_INTEGER }).map(summary => summary.id)
    expect(ids).toContain(issue)
    expect(ids).toContain(bash)
    expect(ids).toContain('overlap-skill')
    // Single flight: preset enumeration never ran twice concurrently.
    expect(maxInFlight).toBe(1)
  })

  it('updates the live On-demand classification without re-enumerating anything', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-registry-'))
    const ctx = await setup(home, { refreshDebounceMs: 5 })
    await ctx.plugin(policy, { stateFile: '', tools: { resident: ['mcp__gongfeng__create_issue'] } })
    registerMcpTool(ctx, 'gongfeng', 'create_issue', 'Create an issue')
    registerMcpTool(ctx, 'km', 'search', 'Search the knowledge base')

    let listCalls = 0
    ctx.provide('agentPresets', {
      async list(): Promise<Array<{ id: string; broken?: string }>> {
        listCalls += 1
        return [{ id: 'coding-plus' }]
      },
      async acquireScope(id?: string) {
        return { key: { agentPreset: id } }
      },
    })
    await ctx.capability.refresh()
    listCalls = 0

    // A tier click changes policy without scanning preset scopes again.
    await ctx.capabilityPolicy.updateConfig({
      tools: { resident: ['mcp__gongfeng__create_issue'], disabled: ['mcp__km__search'] },
    })
    await wait(80)
    expect(listCalls).toBe(0)

    await ctx.capabilityPolicy.updateConfig({ tools: { 'on-demand': ['mcp__km__search'] } })
    expect(listCalls).toBe(0)
    expect(ctx.capabilityPolicy.classifyCapability('mcp__km__search', 'tool')).toBe('on-demand')
    expect(ctx.capability.diagnostics().catalog).toMatchObject({ state: 'ready', count: 1 })
  })

  it('reports an empty On-demand set from the live index', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-registry-'))
    const ctx = await setup(home)
    await ctx.plugin(policy, { stateFile: '' })
    await ctx.capability.refresh()
    expect(ctx.capability.diagnostics().catalog).toMatchObject({ state: 'empty', count: 0 })
  })

  it('coalesces a burst of change events into a single rebuild', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-registry-'))
    const ctx = await setup(home, { refreshDebounceMs: 5 })
    let listCalls = 0
    ctx.provide('agentPresets', {
      async list(): Promise<Array<{ id: string; broken?: string }>> {
        listCalls += 1
        return [{ id: 'coding-plus' }]
      },
      async acquireScope(id?: string) {
        return { key: { agentPreset: id } }
      },
    })
    // Settle the baseline first: the eager mount-time prime also enumerates.
    await ctx.capability.refresh()
    listCalls = 0

    // 20 events in one burst; each rebuild enumerates presets twice (a tools
    // pass and a skills pass), so one rebuild == two calls.
    for (let i = 0; i < 20; i++) ctx.emit('tools/change')
    await wait(80)
    expect(listCalls).toBe(2)
  })

  it('coalesces events landing mid-run into a single follow-up rebuild', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-registry-'))
    const ctx = await setup(home, { refreshDebounceMs: 5 })

    let armed = false
    let entered: (() => void) | undefined
    const enteredGate = new Promise<void>(resolve => { entered = resolve })
    let releaseRun: (() => void) | undefined
    const runGate = new Promise<void>(resolve => { releaseRun = resolve })
    let listCalls = 0
    ctx.provide('agentPresets', {
      async list(): Promise<Array<{ id: string; broken?: string }>> {
        listCalls += 1
        if (armed) {
          armed = false
          entered?.()
          await runGate
        }
        return [{ id: 'coding-plus' }]
      },
      async acquireScope(id?: string) {
        return { key: { agentPreset: id } }
      },
    })
    await ctx.capability.refresh()
    listCalls = 0

    // Start a run that suspends inside the first preset enumeration...
    armed = true
    const run = ctx.capability.refresh()
    await enteredGate
    // ...then 10 events land while it is in flight.
    for (let i = 0; i < 10; i++) ctx.emit('tools/change')
    releaseRun?.()
    await run
    await wait(80)

    // The suspended run (2 calls) plus exactly ONE coalesced follow-up (2).
    expect(listCalls).toBe(4)
  })

  it('stops chaining when rebuilds keep reproducing the same catalog', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-registry-'))
    const ctx = await setup(home, { refreshDebounceMs: 5 })
    let listCalls = 0
    ctx.provide('agentPresets', {
      async list(): Promise<Array<{ id: string; broken?: string }>> {
        listCalls += 1
        // Simulate the self-sustaining loop this guard exists to break: every
        // scan emits a change event, so an unbounded chain would rebuild at the
        // debounce rate forever.
        ctx.emit('tools/change')
        return [{ id: 'coding-plus' }]
      },
      async acquireScope(id?: string) {
        return { key: { agentPreset: id } }
      },
    })

    await ctx.capability.refresh()
    await wait(150)
    const settled = listCalls
    await wait(300)
    // The chain stopped: no further enumeration happens while nothing changes.
    expect(listCalls).toBe(settled)
  })

  it('stops scheduling after teardown', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-registry-'))
    const ctx = await setup(home, { refreshDebounceMs: 5 })
    let listCalls = 0
    ctx.provide('agentPresets', {
      async list(): Promise<Array<{ id: string; broken?: string }>> {
        listCalls += 1
        return [{ id: 'coding-plus' }]
      },
      async acquireScope(id?: string) {
        return { key: { agentPreset: id } }
      },
    })
    await ctx.capability.refresh()

    ctx.registry.delete(registry)
    listCalls = 0
    ctx.emit('tools/change')
    ctx.emit('skills/change')
    await wait(80)

    // Teardown cancelled the scheduler: no rebuild ran after disposal.
    expect(listCalls).toBe(0)
  })

  it('keeps only On-demand capabilities in the policy-filtered search view', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-registry-'))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, {
      dshHome: `${home}/.dsh`,
      agentsHome: `${home}/.agents`,
      watch: false,
    })
    await ctx.plugin(registry, { stateFile: '' })
    await ctx.plugin(policy, {
      stateFile: '',
      tools: {
        resident: ['mcp__gongfeng__create_issue'],
        'on-demand': ['mcp__km__search'],
        disabled: ['mcp__secret__read'],
      },
    })
    registerMcpTool(ctx, 'gongfeng', 'create_issue', 'Create an issue')
    // Deliberately long description: search summaries stay bounded.
    registerMcpTool(ctx, 'km', 'search', 'Search the knowledge base and return relevant documents and snippets. '.repeat(6))
    registerMcpTool(ctx, 'secret', 'read', 'Read a secret')
    await ctx.capability.refresh()

    const onDemand = () => ctx.capability.search({ maxResults: Number.MAX_SAFE_INTEGER })
      .filter(row => ctx.capabilityPolicy.classifyCapability(row.id, row.kind) === 'on-demand')
    expect(onDemand().map(row => row.id)).toEqual(['mcp__km__search'])
    expect(onDemand()[0]?.summary.length).toBeLessThanOrEqual(320)

    await ctx.capabilityPolicy.updateConfig({ tools: { disabled: ['mcp__km__search'] } })
    expect(onDemand()).toEqual([])
  })

  it('persists tier changes outside the watched patch and skips unchanged writes', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-registry-'))
    const { readFile, writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const patchFile = join(home, 'cordis.patch.yml')
    const stateFile = join(home, 'capability-menu-policy.json')
    await writeFile(patchFile, '- insert: []\n', 'utf8')
    const ctx = await setup(home)
    // Long enough that the "not written yet" check below cannot race the timer,
    // short enough to keep this test quick.
    await ctx.plugin(policy, { patchFile, persistDebounceMs: 150 })
    registerMcpTool(ctx, 'km', 'search', 'Search the knowledge base')
    await ctx.capability.refresh()

    await ctx.capabilityPolicy.updateConfig({ tools: { 'on-demand': ['mcp__km__search'] } })
    // The click lands in memory immediately; only the separate state file is written.
    expect((await readTierState(stateFile)).tool.size).toBe(0)
    await expect.poll(async () => (await readTierState(stateFile)).tool.get('mcp__km__search'),
      { timeout: 5_000 }).toBe('on-demand')
    expect(await readFile(patchFile, 'utf8')).toBe('- insert: []\n')

    // Re-sending the same rules must leave the state file unchanged.
    const before = await readFile(stateFile, 'utf8')
    await ctx.capabilityPolicy.updateConfig({ tools: { 'on-demand': ['mcp__km__search'] } })
    await wait(250)
    expect(await readFile(stateFile, 'utf8')).toBe(before)
  })

  it('keeps a skill that disables model invocation out of the index', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-registry-'))
    await writeSkill(`${home}/.agents/skills`, 'user-only-skill', 'User-invoked only', 'Body.', 'disable-model-invocation: true\n')
    await writeSkill(`${home}/.agents/skills`, 'normal-skill', 'Model-invocable', 'Body.')
    const ctx = await setup(home)
    await ctx.plugin(policy, { stateFile: '' })
    await ctx.capability.refresh()

    // `disable-model-invocation: true` is dsh's own gate: the skill never
    // reaches the model, so `indexSkill` drops it and the panel neither lists
    // it nor offers a class for it. Pinned here because that is why the panel
    // has no row to annotate — a change to the filter would silently start
    // advertising a skill the model cannot load.
    expect(ctx.capability.get('user-only-skill', 'skill')).toBeUndefined()
    expect(ctx.capability.diagnostics().unavailableSkills).toContainEqual({ name: 'user-only-skill', source: 'filesystem' })
    expect(ctx.capabilityPolicy.classifyAll().some(row => row.id === 'user-only-skill')).toBe(false)
    expect(ctx.capability.get('normal-skill', 'skill')?.invocation.modelInvocable).toBe(true)

    // The row carries the skill's own directory, not just its source root: the
    // 纳入管理 dialog names the directory it is about to link, and `source`
    // alone (`user-agents`) only says which root it came from.
    const row = ctx.capabilityPolicy.classifyAll().find(r => r.id === 'normal-skill')
    expect(row?.source).toBe('user-agents')
    expect(row?.path).toBe(`${home}/.agents/skills/normal-skill`)
  })

  it('advances the catalog version when a rebuild lands', async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/dsh-registry-'))
    const ctx = await setup(home)
    await ctx.capability.refresh()
    const before = ctx.capability.version()
    expect(Number.isInteger(before)).toBe(true)

    // The management page polls this one number instead of the whole row list:
    // it advances only when a rebuild has finished applying, so "the number
    // moved" means "the catalog is already rebuilt, just re-read it".
    registerNativeTool(ctx, 'bash', 'Run commands in a bash shell')
    await ctx.capability.refresh()
    expect(ctx.capability.version()).toBeGreaterThan(before)
  })
})
