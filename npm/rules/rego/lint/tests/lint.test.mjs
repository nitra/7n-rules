import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runLintRegoSteps as runLintRego } from '../lint.mjs'
import { withBinRemovedFromPath } from '../../../../scripts/utils/test-helpers.mjs'

/**
 * @param {(cwd: string) => void} prep підготовка фікстур у тимчасовій директорії
 * @param {(cwd: string) => number} body тіло тесту
 * @returns {number} результат body
 */
function withTmpRepo(prep, body) {
  const root = mkdtempSync(join(tmpdir(), 'lint-rego-'))
  try {
    prep(root)
    return body(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const NO_PREP = (/** @type {string} */ _cwd) => null

describe('runLintRego', () => {
  test('returns 0 (skip) when no rego targets exist in cwd', () => {
    const exit = withTmpRepo(NO_PREP, cwd => runLintRego(cwd))
    expect(exit).toBe(0)
  })

  test('detects rego files under npm/rules/* and fails on broken syntax', () => {
    const exit = withTmpRepo(
      cwd => {
        mkdirSync(join(cwd, 'npm/rules/sample/policy/concern'), { recursive: true })
        writeFileSync(
          join(cwd, 'npm/rules/sample/policy/concern/concern.rego'),
          'package sample.concern\n\nthis is not valid rego syntax\n'
        )
      },
      cwd => runLintRego(cwd)
    )
    expect(exit).not.toBe(0)
  })

  test('повертає 1 коли opa відсутній у PATH (printOpaInstallHints)', async () => {
    let exit
    await withBinRemovedFromPath('opa', () => {
      exit = withTmpRepo(
        cwd => {
          mkdirSync(join(cwd, 'npm/rules/sample/policy/concern'), { recursive: true })
          writeFileSync(
            join(cwd, 'npm/rules/sample/policy/concern/concern.rego'),
            'package sample.concern\n\nimport rego.v1\n'
          )
        },
        cwd => runLintRego(cwd)
      )
    })
    expect(exit).toBe(1)
  })

  test('passes on a well-formed rego under npm/rules/*/policy/', () => {
    const exit = withTmpRepo(
      cwd => {
        mkdirSync(join(cwd, 'npm/rules/sample/policy/concern'), { recursive: true })
        writeFileSync(
          join(cwd, 'npm/rules/sample/policy/concern/concern.rego'),
          'package sample.concern\n\nimport rego.v1\n\ndeny contains msg if {\n\tinput.broken == true\n\tmsg := "broken"\n}\n'
        )
        // Mirror project regal config so the test fixture isn't flagged for
        // intentional conventions (directory-package-mismatch, unresolved-reference).
        mkdirSync(join(cwd, '.regal'), { recursive: true })
        writeFileSync(
          join(cwd, '.regal/config.yaml'),
          'rules:\n  idiomatic:\n    directory-package-mismatch:\n      level: ignore\n  imports:\n    unresolved-reference:\n      level: ignore\n'
        )
      },
      cwd => runLintRego(cwd)
    )
    expect(exit).toBe(0)
  })
})
