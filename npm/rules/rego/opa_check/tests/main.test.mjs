import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { lint } from '../main.mjs'
import { withBinRemovedFromPath } from '../../../../scripts/utils/test-helpers.mjs'

/**
 * @template T
 * @param {(cwd: string) => void} prep підготовка фікстур у тимчасовій директорії
 * @param {(cwd: string) => T} body тіло тесту
 * @returns {T} результат body
 */
function withTmpRepo(prep, body) {
  const root = mkdtempSync(join(tmpdir(), 'lint-rego-opa-check-'))
  try {
    prep(root)
    return body(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const NO_PREP = (/** @type {string} */ _cwd) => null

/**
 * Викликає detector rego/opa_check для заданого кореня (full-режим, `files: undefined`).
 * @param {string} cwd корінь репозиторію
 * @returns {import('../../../../scripts/lib/lint-surface/types.mjs').LintResult} результат detector-а
 */
const runLintOpaCheck = cwd => lint({ cwd, ruleId: 'rego', concernId: 'opa_check', files: undefined })

const OPA_RE = /opa/

describe('lint rego/opa_check', () => {
  test('returns no violations (skip) when no rego targets exist in cwd', () => {
    const { violations } = withTmpRepo(NO_PREP, runLintOpaCheck)
    expect(violations).toEqual([])
  })

  test('detects rego files under npm/rules/* and fails on broken syntax', () => {
    const { violations } = withTmpRepo(cwd => {
      mkdirSync(join(cwd, 'npm/rules/sample/policy/concern'), { recursive: true })
      writeFileSync(
        join(cwd, 'npm/rules/sample/policy/concern/concern.rego'),
        'package sample.concern\n\nthis is not valid rego syntax\n'
      )
    }, runLintOpaCheck)
    expect(violations.length).toBeGreaterThan(0)
  })

  test('кидає коли opa відсутній у PATH і авто-install відключено (ensureTool hard-fail)', async () => {
    await withBinRemovedFromPath('opa', () => {
      expect(() =>
        withTmpRepo(cwd => {
          mkdirSync(join(cwd, 'npm/rules/sample/policy/concern'), { recursive: true })
          writeFileSync(
            join(cwd, 'npm/rules/sample/policy/concern/concern.rego'),
            'package sample.concern\n\nimport rego.v1\n'
          )
        }, runLintOpaCheck)
      ).toThrow(OPA_RE)
    })
  })

  test('passes on a well-formed rego under npm/rules/*/policy/', () => {
    const { violations } = withTmpRepo(cwd => {
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
    }, runLintOpaCheck)
    expect(violations).toEqual([])
  })
})
