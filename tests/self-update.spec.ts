import { describe, expect, it } from 'vitest'
import { windowsCommand } from '../src/server/self-update.ts'

describe('windowsCommand', () => {
  it('quotes every argument and wraps the line for cmd.exe /s', () => {
    const line = windowsCommand('pnpm', [
      '--dir',
      'C:\\Users\\me\\.dsh\\profiles\\desktop with space',
      'add',
      '@daweifu/capability-menu@0.1.7',
      '--save-exact',
    ])
    expect(line).toBe(
      '"pnpm "--dir" "C:\\Users\\me\\.dsh\\profiles\\desktop with space" "add" "@daweifu/capability-menu@0.1.7" "--save-exact""',
    )
  })

  it('keeps a bare command line to one pair of outer quotes', () => {
    expect(windowsCommand('pnpm', ['-v'])).toBe('"pnpm "-v""')
  })

  it('refuses arguments cmd.exe cannot carry', () => {
    expect(() => windowsCommand('pnpm', ['a"b'])).toThrow(/unsupported character/)
    expect(() => windowsCommand('pnpm', ['a\nb'])).toThrow(/unsupported character/)
  })
})
