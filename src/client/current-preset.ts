/** Narrow rc.5 sessions.list contract; mainView excludes background/subagent sessions. */
export interface SessionSource {
  getSnapshot(): { byId: Record<string, { id: string; retainedBy: { mainView?: number }; projectionValues?: Record<string, unknown> }> }
  subscribe(listener: () => void): () => void
}

/** A stable primitive snapshot for React; ambiguous/unresolved navigation is read-only. */
export function currentPresetKey(sessions: SessionSource): string | null {
  const active = Object.values(sessions.getSnapshot().byId).filter(row => (row.retainedBy.mainView ?? 0) > 0)
  if (active.length !== 1) return null
  const preset = active[0].projectionValues?.agentPreset
  return typeof preset === 'string' && preset.trim() ? JSON.stringify([active[0].id, preset]) : null
}
