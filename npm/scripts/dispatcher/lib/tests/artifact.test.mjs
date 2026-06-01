/**
 * Тести спільних утиліт артефактів (`lib/artifact.mjs`). FS — на тимчасовому
 * каталозі; `verifyTrace` runner ін'єктується (без реального trace).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { withTmpDir } from '../../../utils/test-helpers.mjs'
import { extractSteps, resolveArtifact, verifyTrace } from '../artifact.mjs'

describe('resolveArtifact', () => {
  test('найсвіжіший .md у docs/<kind>', async () => {
    await withTmpDir(async dir => {
      const d = join(dir, 'docs', 'specs')
      mkdirSync(d, { recursive: true })
      writeFileSync(join(d, '2026-01-01-a.md'), 'x')
      writeFileSync(join(d, '2026-02-01-b.md'), 'y')
      expect(resolveArtifact(dir, 'specs')).toBe(join(d, '2026-02-01-b.md'))
    })
  })

  test('каталог відсутній → null', async () => {
    await withTmpDir(async dir => {
      expect(resolveArtifact(dir, 'plans')).toBe(null)
    })
  })
})

describe('extractSteps', () => {
  test('нумерований список ## Кроки', () => {
    expect(extractSteps('## Кроки\n1. A — acceptance: ok\n2. B\nтекст\n')).toEqual([
      { task: 'A', acceptance: 'ok' },
      { task: 'B' }
    ])
  })
  test('нема нумерованих рядків → []', () => {
    expect(extractSteps('# Заголовок\nабзац')).toEqual([])
  })
})

describe('verifyTrace', () => {
  test('код 0 → true', () => {
    expect(verifyTrace('/wt', () => 0)).toBe(true)
  })
  test('код 1 (розрив) → false (не кидає)', () => {
    expect(verifyTrace('/wt', () => 1)).toBe(false)
  })
})
