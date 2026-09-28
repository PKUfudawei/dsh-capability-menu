/** Replace the settings shell's fallback gear with dsh's shared list glyph. */

export const NAV_ICON_MARKER = 'data-capability-menu-nav-icon'
const NAV_ROW_SELECTOR = '[role="dialog"] nav button'
const NAV_ICON_SIZE = 16

/** The geometry of dsh-client-ui-primitives' IconFlatListOutlineMedium. */
function flatListMaskUrl(): string {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-linecap="round" stroke-width="1.3">'
    + '<path d="M6 3.5h7.5M6 8h7.5M6 12.5h7.5"/>'
    + '<path d="M2.6 3.5h.01M2.6 8h.01M2.6 12.5h.01"/>'
    + '</svg>'
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function navIconCss(maskUrl: string): string {
  return [
    `[${NAV_ICON_MARKER}] > svg { display: none; }`,
    `[${NAV_ICON_MARKER}]::before {`,
    '  content: "";',
    '  flex: none;',
    `  width: ${NAV_ICON_SIZE}px;`,
    `  height: ${NAV_ICON_SIZE}px;`,
    '  background-color: currentColor;',
    `  -webkit-mask: url("${maskUrl}") center / ${NAV_ICON_SIZE}px ${NAV_ICON_SIZE}px no-repeat;`,
    `  mask: url("${maskUrl}") center / ${NAV_ICON_SIZE}px ${NAV_ICON_SIZE}px no-repeat;`,
    '}',
  ].join('\n')
}

export interface NavIconContext {
  effect(callback: () => unknown, label?: string): void
}

/**
 * The current settings.section slot has no icon option. Match this plugin's
 * localized nav label and replace only its fallback gear, as dsh-market does.
 */
export function installSettingsNavIcon(ctx: NavIconContext, resolveLabel: () => string): void {
  if (typeof document === 'undefined') return

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'capability-menu'
    style.dataset.pluginCss = 'capability-menu/settings-nav-icon'
    style.textContent = navIconCss(flatListMaskUrl())
    document.head.appendChild(style)

    let disposed = false
    let scheduled = false
    const sync = () => {
      scheduled = false
      if (disposed) return
      const wanted = resolveLabel().trim()
      for (const row of document.querySelectorAll(NAV_ROW_SELECTOR)) {
        if (wanted.length > 0 && row.textContent?.trim() === wanted) row.setAttribute(NAV_ICON_MARKER, '')
        else row.removeAttribute(NAV_ICON_MARKER)
      }
    }
    const schedule = () => {
      if (scheduled || disposed) return
      scheduled = true
      queueMicrotask(sync)
    }

    sync()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => {
      disposed = true
      observer.disconnect()
      for (const row of document.querySelectorAll(`[${NAV_ICON_MARKER}]`)) row.removeAttribute(NAV_ICON_MARKER)
      style.remove()
    }
  }, 'capability-menu: settings nav icon')
}
