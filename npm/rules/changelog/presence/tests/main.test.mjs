/**
 * Тести detector-а `changelog/presence`: дешевий per-file гейт "чи є change-файл під
 * змінений workspace" (spec docs/specs/2026-07-02-text-check-per-file-split-design.md §7).
 */
import { describe, expect, test, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { lint } from '../main.mjs'

/**
 * @param {(root: string) => Promise<void>} prep підготовка фікстур
 * @param {(root: string) => Promise<import('../../../../scripts/lib/lint-surface/types.mjs').LintResult>} body тіло тесту
 * @returns {Promise<import('../../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат body
 */
async function withTmpRepo(prep, body) {
  const root = await mkdtemp(join(tmpdir(), 'changelog-presence-'))
  try {
    await prep(root)
    return await body(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('changelog/presence lint(ctx)', () => {
  test('full-режим (files: undefined) — нічого не перевіряє', async () => {
    const { violations } = await withTmpRepo(vi.fn(), cwd =>
      lint({ cwd, ruleId: 'changelog', concernId: 'presence', files: undefined })
    )
    expect(violations).toEqual([])
  })

  test('single-package repo (без workspaces) без change-файлу → violation на корінь', async () => {
    const { violations } = await withTmpRepo(
      async root => {
        await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }))
      },
      cwd => lint({ cwd, ruleId: 'changelog', concernId: 'presence', files: ['src/index.mjs'] })
    )
    expect(violations).toHaveLength(1)
    expect(violations[0].reason).toBe('changeset-missing')
  })

  test('single-package repo з наявним change-файлом → чисто', async () => {
    const { violations } = await withTmpRepo(
      async root => {
        await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }))
        await mkdir(join(root, '.changes'), { recursive: true })
        await writeFile(join(root, '.changes/260702-1200.md'), '---\nbump: patch\nsection: Changed\n---\nоновлення\n')
      },
      cwd => lint({ cwd, ruleId: 'changelog', concernId: 'presence', files: ['src/index.mjs'] })
    )
    expect(violations).toEqual([])
  })

  test('зміни лише в docs/ ігноруються (не тригерять гейт)', async () => {
    const { violations } = await withTmpRepo(
      async root => {
        await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }))
      },
      cwd => lint({ cwd, ruleId: 'changelog', concernId: 'presence', files: ['docs/readme.md'] })
    )
    expect(violations).toEqual([])
  })
})
