/**
 * Тест preflight у `runLintGaCli`: коли `shellcheck` відсутній у PATH — exit 1 з підказкою brew/apt/pacman.
 *
 * Реальний `actionlint`/`zizmor` не запускаються — ми обриваємо потік ще на preflight, не доходячи до них.
 */
import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { tmpdir } from 'node:os'
import { env } from 'node:process'

import { runLintGaCli } from '../scripts/lint-ga.mjs'

describe('runLintGaCli', () => {
  test('exit 1 + brew/apt/pacman підказки, коли shellcheck відсутній у PATH', async () => {
    const isolatedDir = await mkdtemp(join(tmpdir(), 'n-cursor-empty-path-'))
    const prevPath = env.PATH
    // Лишаємо лише isolated-каталог — гарантовано без `shellcheck`. Підставлений PATH відновимо у finally.
    env.PATH = isolatedDir
    const errs = []
    const origErr = console.error
    const origLog = console.log
    console.error = (...args) => errs.push(args.join(' '))
    console.log = () => {}
    try {
      const code = runLintGaCli()
      const blob = errs.join('\n')
      expect(code).toBe(1)
      expect(blob).toContain('shellcheck')
      expect(blob).toMatch(/brew install shellcheck/)
      expect(blob).toMatch(/apt-get install -y shellcheck/)
      expect(blob).toMatch(/pacman -S shellcheck/)
    } finally {
      console.error = origErr
      console.log = origLog
      if (prevPath === undefined) {
        delete env.PATH
      } else {
        env.PATH = prevPath
      }
    }
    // Розширювати PATH непотрібно: у тесті ми не доходимо до actionlint/zizmor.
    expect(typeof delimiter).toBe('string')
  })
})
