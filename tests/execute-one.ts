import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ResolvedToolSet } from '@deepseek-ai/dsh-tools'

/** Exercise one tool through the host's 0.2.2 batch executor. */
export async function executeOne(ctx: Context, input: {
  callId: ToolCallId
  name: string
  arguments: unknown
  signal: AbortSignal
  agent?: Parameters<Context['tools']['execute']>[0]['agent']
  toolSet?: ResolvedToolSet
}) {
  const batch = await ctx.tools.execute({
    calls: [{ type: 'tool-call', id: input.callId, name: input.name, arguments: JSON.stringify(input.arguments) }],
    signal: input.signal,
    ...input.agent === undefined ? {} : { agent: input.agent },
    ...input.toolSet === undefined ? {} : { toolSet: input.toolSet },
  })
  const result = batch.results[0]?.result
  if (result === undefined) throw new Error(`No result for ${input.name}`)
  return result
}

/** Assemble through the 0.2.2 host path used before each model step. */
export async function assembleForStep(ctx: Context, agent: Agent = { id: 'test-agent' } as Agent) {
  const toolSet = await ctx.tools.resolve({
    agent,
    modelSelection: { provider: 'test', model: 'test' } as never,
    signal: new AbortController().signal,
  })
  try {
    return await ctx.systemPrompt.assemble({ scope: agent, toolSet })
  } finally {
    toolSet.dispose()
  }
}
