/**
 * Тести спільних утиліт артефактів (`lib/artifact.mjs`). FS — на тимчасовому
 * каталозі; `verifyTrace` runner ін'єктується (без реального trace).
 */
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { withTmpDir } from '../../../utils/test-helpers.mjs'
import { extractSteps, resolveArtifact, verifyTrace } from '../artifact.mjs'

/**
 * Створює .md із явним mtime (детермінованість тестів незалежно від ФС).
 * @param {string} path абсолютний шлях
 * @param {number} mtimeSec mtime у секундах
 * @returns {void}
 */
function mdWithMtime(path, mtimeSec) {
  writeFileSync(path, 'x')
  utimesSync(path, mtimeSec, mtimeSec)
}

describe('resolveArtifact', () => {
  test('найсвіжіший за mtime (а не лексикографічно)', async () => {
    await withTmpDir(async dir => {
      const d = join(dir, 'docs', 'specs')
      mkdirSync(d, { recursive: true })
      // "a" лексикографічно перший, але новіший за mtime → має виграти
      mdWithMtime(join(d, '2026-01-01-z.md'), 1000)
      mdWithMtime(join(d, '2026-01-01-a.md'), 2000)
      expect(resolveArtifact(dir, 'specs')).toBe(join(d, '2026-01-01-a.md'))
    })
  })

  test('пріоритет slug гілки над mtime', async () => {
    await withTmpDir(async dir => {
      const d = join(dir, 'docs', 'specs')
      mkdirSync(d, { recursive: true })
      mdWithMtime(join(d, '2026-06-01-flow-gate-verdict.md'), 1000) // старіший, але збіг slug
      mdWithMtime(join(d, '2026-06-01-flow-review-level.md'), 9000) // новіший, без збігу
      expect(resolveArtifact(dir, 'specs', 'claude/flow-gate')).toBe(join(d, '2026-06-01-flow-gate-verdict.md'))
    })
  })

  test('нема збігу slug → fallback на найсвіжіший mtime', async () => {
    await withTmpDir(async dir => {
      const d = join(dir, 'docs', 'plans')
      mkdirSync(d, { recursive: true })
      mdWithMtime(join(d, 'old.md'), 1000)
      mdWithMtime(join(d, 'new.md'), 2000)
      expect(resolveArtifact(dir, 'plans', 'claude/unrelated')).toBe(join(d, 'new.md'))
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
