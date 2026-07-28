/**
 * Тести `hook.mjs`: витяг шляхів файлів зі stdin PostToolUse-payload — Claude Code
 * (`tool_input.file_path`) і Codex CLI (`tool_name: "apply_patch"`, V4A-патч у
 * `tool_input.command`).
 */
import { describe, expect, test } from 'vitest'

import { extractCodexPatchPaths, extractFilePaths } from '../hook.mjs'

describe('extractCodexPatchPaths', () => {
  test('Add File — повертає шлях нового файлу', () => {
    const patch = ['*** Begin Patch', '*** Add File: hello.txt', '+Hello world', '*** End Patch'].join('\n')
    expect(extractCodexPatchPaths(patch)).toEqual(['hello.txt'])
  })

  test('Update File — повертає шлях без Move to', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/app.py',
      '@@ def greet(): @@',
      '-print("Hi")',
      '+print("Hello, world!")',
      '*** End Patch'
    ].join('\n')
    expect(extractCodexPatchPaths(patch)).toEqual(['src/app.py'])
  })

  test('Update File + Move to — рахує лише фінальний (перейменований) шлях', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/app.py',
      '*** Move to: src/main.py',
      '@@ def greet(): @@',
      '-print("Hi")',
      '+print("Hello, world!")',
      '*** End Patch'
    ].join('\n')
    expect(extractCodexPatchPaths(patch)).toEqual(['src/main.py'])
  })

  test('Delete File — пропускається (нема що лінтити)', () => {
    const patch = ['*** Begin Patch', '*** Delete File: obsolete.txt', '*** End Patch'].join('\n')
    expect(extractCodexPatchPaths(patch)).toEqual([])
  })

  test('декілька файлових секцій в одному патчі', () => {
    const patch = [
      '*** Begin Patch',
      '*** Add File: hello.txt',
      '+Hello world',
      '*** Update File: src/app.py',
      '*** Move to: src/main.py',
      '@@ def greet(): @@',
      '-print("Hi")',
      '+print("Hello, world!")',
      '*** Delete File: obsolete.txt',
      '*** End Patch'
    ].join('\n')
    expect(extractCodexPatchPaths(patch)).toEqual(['hello.txt', 'src/main.py'])
  })
})

describe('extractFilePaths', () => {
  test('порожній stdin → []', () => {
    expect(extractFilePaths('')).toEqual([])
  })

  test('невалідний JSON → []', () => {
    expect(extractFilePaths('NOT JSON')).toEqual([])
  })

  test('Claude Code Edit/Write — tool_input.file_path', () => {
    const json = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: '/repo/src/foo.ts' } })
    expect(extractFilePaths(json)).toEqual(['/repo/src/foo.ts'])
  })

  test('Claude Code Bash (без file_path) → []', () => {
    const json = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls -la' } })
    expect(extractFilePaths(json)).toEqual([])
  })

  test('Codex apply_patch — витягує шлях(и) з V4A-патча в tool_input.command', () => {
    const command = ['*** Begin Patch', '*** Add File: src/foo.ts', '+export const x = 1', '*** End Patch'].join('\n')
    const json = JSON.stringify({ tool_name: 'apply_patch', tool_input: { command } })
    expect(extractFilePaths(json)).toEqual(['src/foo.ts'])
  })

  test('Codex apply_patch — лише видалення → []', () => {
    const command = ['*** Begin Patch', '*** Delete File: src/foo.ts', '*** End Patch'].join('\n')
    const json = JSON.stringify({ tool_name: 'apply_patch', tool_input: { command } })
    expect(extractFilePaths(json)).toEqual([])
  })

  test('tool_name apply_patch, але command не рядок → []', () => {
    const json = JSON.stringify({ tool_name: 'apply_patch', tool_input: { command: 42 } })
    expect(extractFilePaths(json)).toEqual([])
  })
})
