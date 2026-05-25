/**
 * Тести pi.dev-extension синку: bundled TS-template у `.pi-template/extensions/n-cursor-adr/`,
 * `syncPiExtensions` (copy), `removeOrphanPiExtension` (cleanup), інтеграція у `syncClaudeConfig`.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const PI_TEMPLATE_PATH = join(import.meta.dir, '..', '..', '.pi-template', 'extensions', 'n-cursor-adr', 'index.ts')

describe('.pi-template/extensions/n-cursor-adr/index.ts (bundled)', () => {
  test('файл існує у пакеті', () => {
    expect(existsSync(PI_TEMPLATE_PATH)).toBe(true)
  })

  test('має default export factory function', async () => {
    const src = await readFile(PI_TEMPLATE_PATH, 'utf8')
    expect(src).toMatch(/export default function/)
    expect(src).toMatch(/pi\.on\(['"]agent_end['"]/)
  })

  test('спавнить обидва bash-скрипти capture/normalize', async () => {
    const src = await readFile(PI_TEMPLATE_PATH, 'utf8')
    expect(src).toMatch(/capture-decisions\.sh/)
    expect(src).toMatch(/normalize-decisions\.sh/)
  })

  test('виставляє CLAUDE_PROJECT_DIR у env', async () => {
    const src = await readFile(PI_TEMPLATE_PATH, 'utf8')
    expect(src).toMatch(/CLAUDE_PROJECT_DIR/)
  })

  test('має recursion guard через CAPTURE_DECISIONS_RUNNING / ADR_NORMALIZE_RUNNING', async () => {
    const src = await readFile(PI_TEMPLATE_PATH, 'utf8')
    expect(src).toMatch(/CAPTURE_DECISIONS_RUNNING/)
    expect(src).toMatch(/ADR_NORMALIZE_RUNNING/)
  })
})
