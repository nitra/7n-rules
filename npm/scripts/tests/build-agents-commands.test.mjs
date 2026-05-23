/**
 * Тести генерації секції команд для AGENTS.md (`buildAgentsCommandBulletItems`).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

import { buildAgentsCommandBulletItems } from '../build-agents-commands.mjs'

describe('buildAgentsCommandBulletItems', () => {
  test('без package.json — мінімум (bun i + CLI)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agents-cmd-'))
    try {
      const items = await buildAgentsCommandBulletItems(dir)
      const text = items.map(i => i.name).join('\n')
      expect(text).toContain('bun i')
      expect(text).toContain('npx @nitra/cursor')
      expect(text).toContain('npx @nitra/cursor check')
      expect(text).toContain('bunx knip')
      expect(items.length).toBe(4)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('з scripts — рядки bun run у стабільному порядку', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agents-cmd-'))
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({
          scripts: {
            lint: 'bunx oxlint',
            test: 'bun test',
            'lint-custom': 'echo x',
            'lint-js': 'eslint .'
          }
        }),
        'utf8'
      )
      const items = await buildAgentsCommandBulletItems(dir)
      const lines = items.map(i => i.name)
      const testIdx = lines.findIndex(l => l.includes('**test**'))
      const lintIdx = lines.findIndex(l => l.includes('**lint**:') && l.includes('bun run lint`'))
      expect(testIdx).toBeLessThan(lintIdx)
      expect(lines.some(l => l.includes('**lint-js**'))).toBe(true)
      expect(lines.some(l => l.includes('**lint-custom**'))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
