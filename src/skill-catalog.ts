/** Project native catalogs before commit, reconciling against the visible session surface. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { escapeText } from '@deepseek-ai/dsh-skill'

interface Catalog { kind: 'skill-catalog'; entries: { name: string; description: string }[]; incomplete?: boolean; update?: boolean; form?: string }
function catalog(value: unknown): Catalog | undefined {
  const source = value as Catalog | undefined
  if (source?.kind !== 'skill-catalog' || !Array.isArray(source.entries)) return
  if (!source.entries.every(e => e && typeof e.name === 'string' && typeof e.description === 'string')) return
  return source
}
function visibleCatalog(agent: Agent): Catalog | undefined {
  const session = agent?.session
  if (!session?.surface || typeof session.eventAt !== 'function') return
  const visible = new Set(session.surface.nodes)
  for (let index = session.seq - 1; index >= 0; index--) {
    const event = session.eventAt(SessionSeq(index))
    if (event?.type !== 'user/message' || !visible.has(event.seq)) continue
    const source = catalog(event.data.source)
    if (source) return source
  }
}
function identity(source: Catalog): string {
  return JSON.stringify([source.entries.map(e => [e.name, e.description]), !!source.incomplete])
}
function render(source: Catalog): string {
  return [
    '<system-reminder>',
    'This skill catalog replaces every earlier available-skills list in this session.',
    '<available_skills>',
    ...source.entries.map(e => `- \`${escapeText(e.name)}\`: ${escapeText(e.description)}`),
    '</available_skills>',
    ...(source.incomplete ? ['Skill discovery is incomplete. Only confirmed skills are listed; discovery will be retried.'] : []),
    source.entries.length ? 'If a task names or clearly matches a listed skill, call the `skill` tool before acting. This catalog contains summaries, not instructions.' : 'No skills are currently available through the `skill` tool. Do not use names from earlier catalogs.',
    'On-demand skills can be discovered with meta_search and loaded with meta_invoke.',
    'A user may also invoke a skill directly; follow its injected <skill_content> without loading it again.',
    '</system-reminder>',
  ].join('\n')
}
export function installSkillCatalog(ctx: Context, resident: (name: string, agent: Agent) => boolean, disabled: (name: string, agent: Agent) => boolean): void {
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    // rc.5 slash invocation bypasses tools/pre-execute; enforce the same deny here.
    const messages = decision.messages.filter(message => {
      const source = message.source as { kind?: string; name?: string }
      return source.kind !== 'skill-invocation' || !source.name || !disabled(source.name, agent)
    })
    const pending = messages.find(m => catalog(m.source))
    const previous = visibleCatalog(agent)
    const candidate = catalog(pending?.source) ?? previous
    if (!candidate) return { ...decision, messages }
    const projected: Catalog = { ...candidate, entries: candidate.entries.filter(e => resident(e.name, agent)) }
    const without = messages.filter(m => !catalog(m.source))
    if (previous && identity(projected) === identity(previous)) return { ...decision, messages: without }
    if (!previous && !projected.entries.length && !projected.incomplete) return { ...decision, messages: without }
    // Preserve the native message verbatim when no projection is necessary.
    if (pending && identity(projected) === identity(candidate)) return { ...decision, messages }
    const replacement = createUserMessage({
      content: [{ type: 'text', text: render(projected) }],
      source: { ...projected, form: 'catalog', ...(previous ? { update: true } : {}) } as unknown as Parameters<typeof createUserMessage>[0]['source'],
    })
    // Catalog stays before explicit skill instructions, as in the native producer.
    const index = pending ? messages.indexOf(pending) : without.findIndex(m => m.source.kind === 'skill-invocation')
    without.splice(pending ? index : index < 0 ? without.length : index, 0, replacement)
    return { ...decision, messages: without }
  }, { prepend: true })
}
