import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { lint } from '../main.mjs'

/**
 * @template T
 * @param {(cwd: string) => void} prep підготовка фікстур у тимчасовій директорії
 * @param {(cwd: string) => Promise<T>} body тіло тесту (async — `lint()` тепер повертає Promise)
 * @returns {Promise<T>} результат body
 */
async function withTmpRepo(prep, body) {
  const root = mkdtempSync(join(tmpdir(), 'lint-rego-regal-'))
  try {
    prep(root)
    return await body(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const NO_PREP = (/** @type {string} */ _cwd) => null

/**
 * Викликає detector rego/regal для заданого кореня (full-режим, `files: undefined`).
 * @param {string} cwd корінь репозиторію
 * @returns {Promise<import('../../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат detector-а
 */
const runLintRegal = cwd => lint({ cwd, ruleId: 'rego', concernId: 'regal', files: undefined })

describe('lint rego/regal', () => {
  test('returns no violations (skip) when no rego targets exist in cwd', async () => {
    const { violations } = await withTmpRepo(NO_PREP, runLintRegal)
    expect(violations).toEqual([])
  })

  test('passes on a well-formed rego under npm/rules/*/policy/', async () => {
    const { violations } = await withTmpRepo(cwd => {
      mkdirSync(join(cwd, 'npm/rules/sample/policy/concern'), { recursive: true })
      writeFileSync(
        join(cwd, 'npm/rules/sample/policy/concern/concern.rego'),
        'package sample.concern\n\nimport rego.v1\n\ndeny contains msg if {\n\tinput.broken == true\n\tmsg := "broken"\n}\n'
      )
      mkdirSync(join(cwd, '.regal'), { recursive: true })
      writeFileSync(
        join(cwd, '.regal/config.yaml'),
        'rules:\n  idiomatic:\n    directory-package-mismatch:\n      level: ignore\n  imports:\n    unresolved-reference:\n      level: ignore\n'
      )
    }, runLintRegal)
    expect(violations).toEqual([])
  })
})
