/**
 * Регресія на дефект «повідомлення про помилку вказує не туди» (сесія
 * 2026-08-26, `docs/plans/2026-08-05-open-questions-register.md` §2.38):
 * коли `npm/wasm-plugins/builtin-pins.json` відсутній (repo-дерево без
 * локальної wasm-збірки, `.gitignore`), `resolveWasmConcernMap` мовчки
 * повертає порожню мапу, і для concern-ів, ПОРТОВАНИХ у wasm (яким
 * `main.mjs` видалено під час міграції), диспатч (`detect.mjs`) провалюється
 * до фінального `DetectorError('немає main.mjs')` — повідомлення називало
 * наслідок, а не причину.
 *
 * `hasBuiltinPinsArtifact` (`wasm-plugins.mjs`) мокнуто — не існує способу
 * детерміновано контролювати наявність РЕАЛЬНОГО `npm/wasm-plugins/
 * builtin-pins.json` з тесту без побічного ефекту на робоче дерево (файл
 * генерує лише `build-wasm-plugins.mjs`, чіпати його з тесту небезпечно для
 * паралельних прогонів). Решта модуля (`resolveWasmConcernMap`) лишається
 * РЕАЛЬНОЮ (`importOriginal`) — фейковий `ruleId/concernId` цього файлу
 * (`scratch/no_impl`) свідомо не збігається НІ З ОДНИМ реальним
 * контрибуційним ключем жодного first-party плагіна, тож реальний резолв
 * завжди повертає для нього порожній запис незалежно від того, зібраний
 * wasm локально в цьому робочому дереві чи ні — тест детермінований в обох
 * середовищах.
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test, vi } from 'vitest'

import { withTmpDir } from '../../../utils/test-helpers.mjs'

/** Керує поверненням мокнутого [`hasBuiltinPinsArtifact`] окремо в кожному тесті. */
const hasBuiltinPinsArtifactMock = vi.fn()

vi.mock('../wasm-plugins.mjs', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, hasBuiltinPinsArtifact: hasBuiltinPinsArtifactMock }
})

const { runConcernDetector } = await import('../detect.mjs')

/**
 * Concern без будь-якої реалізації (немає ні `main.mjs`, ні `policy`) — та сама
 * форма, що й другий тест `detect.test.mjs` («policy без резолвних files і без
 * main.mjs»), але з `ruleId/concernId`, гарантовано відсутнім у будь-якій
 * реальній wasm-мапі (доккомент файлу).
 * @param {string} dir tmp-корінь
 * @returns {Promise<{name: string, dir: string}>} `concern` для `runConcernDetector`
 */
async function makeConcernWithoutMain(dir) {
  const concernDir = join(dir, 'rules', 'scratch', 'no_impl')
  await mkdir(concernDir, { recursive: true })
  return { name: 'no_impl', dir: concernDir }
}

describe('runConcernDetector — підказка про builtin-pins.json у "немає main.mjs"', () => {
  test('builtin-pins.json відсутній → повідомлення згадує файл і команду генерації', async () => {
    hasBuiltinPinsArtifactMock.mockReturnValue(false)
    await withTmpDir(async dir => {
      const concern = await makeConcernWithoutMain(dir)
      await expect(runConcernDetector(concern, { cwd: dir, ruleId: 'scratch', concernId: 'no_impl' })).rejects.toThrow(
        /npm\/wasm-plugins\/builtin-pins\.json.*node npm\/scripts\/build-wasm-plugins\.mjs/
      )
    })
  })

  test('builtin-pins.json присутній → зворотний випадок: коротка помилка без хибної підказки', async () => {
    hasBuiltinPinsArtifactMock.mockReturnValue(true)
    await withTmpDir(async dir => {
      const concern = await makeConcernWithoutMain(dir)
      const error = await runConcernDetector(concern, { cwd: dir, ruleId: 'scratch', concernId: 'no_impl' }).catch(
        e => e
      )
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain('немає main.mjs')
      expect(error.message).not.toContain('builtin-pins.json')
    })
  })
})
