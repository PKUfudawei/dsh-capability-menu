/** Separate a readable summary from transport/git diagnostics. */
export function skillUpdateError(error: unknown): { message: string; detail?: string } {
  const raw = error instanceof Error ? error.message : String(error)
  const cleaned = raw.replace(/^Error:\s*/, '').replace(/^capabilityPolicy\.\w+ failed:\s*/, '').replace(/^gateway\/\w+:\s*/, '')
  const [message = cleaned, ...details] = cleaned.split('\n\n[details]\n')
  const detail = details.join('\n\n') || (cleaned !== raw ? raw : undefined)
  return { message, ...(detail ? { detail } : {}) }
}

export function summarizeSkillChecks(rows: readonly { status?: { status: string }; error?: unknown }[]) {
  return {
    available: rows.filter(row => !row.error && row.status?.status === 'available').length,
    unmanaged: rows.filter(row => !row.error && row.status?.status === 'unmanaged').length,
    failed: rows.filter(row => row.error).length,
  }
}
