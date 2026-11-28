import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { installSkillCatalog } from '../src/skill-catalog.ts'

it('blocks disabled native slash injections without blocking on-demand user invocations', async () => {
  const ctx = new Context()
  installSkillCatalog(ctx, () => false, name => name === 'disabled')
  const messages = ['disabled', 'lazy'].map(name => createUserMessage({ source: { kind: 'skill-invocation', name } as never, content: [{ type: 'text', text: name }] }))
  const decision = await ctx.waterfall('agent/pre-step', { agent: {} } as never, async () => ({ kind: 'enter', messages }))
  expect(decision.kind).toBe('enter')
  if (decision.kind === 'enter') expect(decision.messages).toEqual([messages[1]])
})

for (const nativeFirst of [true, false]) it(`reconciles catalog history and policy changes (native first: ${nativeFirst})`, async () => {
  const ctx = new Context()
  const entries = [{ name: 'resident', description: 'Resident' }, { name: 'lazy', description: 'On demand' }]
  const hidden = new Set(['lazy'])
  const history: any[] = []
  const agent = { session: { get seq() { return history.length }, surface: { nodes: [] as number[] }, eventAt: (i: number) => history[i] } } as any
  const registerPolicy = () => installSkillCatalog(ctx, name => !hidden.has(name), name => name === 'disabled')
  const native = () => ctx.on('agent/pre-step', async (_, next) => {
    const decision = await next()
    const previous = history.at(-1)?.data.source.entries
    // Mirrors the rc.5 producer: digest the unprojected entries, then compare history.
    if (JSON.stringify(previous) === JSON.stringify(entries)) return decision
    return { ...decision, messages: [...(decision as any).messages, createUserMessage({ source: { kind: 'skill-catalog', entries } as never, content: [{ type: 'text', text: 'native' }] })] } as any
  })
  if (nativeFirst) native()
  registerPolicy()
  if (!nativeFirst) native()
  const step = async () => {
    const result = await ctx.waterfall('agent/pre-step', { agent, messages: [], turn: 1, step: 1, signal: new AbortController().signal } as never, async () => ({ kind: 'enter', messages: [] }))
    if (result.kind !== 'enter') throw new Error('Rejected')
    for (const message of result.messages) {
      const seq = history.length
      history.push({ seq, type: 'user/message', data: message }); agent.session.surface.nodes.push(seq)
    }
    return result.messages.map(m => (m.source as any).entries.map((e: any) => e.name))
  }
  expect(await step()).toEqual([['resident']])
  expect(await step()).toEqual([])
  hidden.clear()
  expect(await step()).toEqual([['resident','lazy']])
  expect(await step()).toEqual([])
  hidden.add('lazy')
  expect(await step()).toEqual([['resident']])
  hidden.add('resident')
  expect(await step()).toEqual([[]])
  expect(await step()).toEqual([])
})
