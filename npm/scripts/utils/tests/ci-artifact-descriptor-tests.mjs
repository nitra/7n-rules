/**
 * Спільний тестовий канон `ci.artifact@1` дескрипторів мовних плагінів (`@7n/rules-lang-php`,
 * `@7n/rules-lang-js`, …): кожен `slots/ci/*.json` має пройти canonical payload-контракт
 * (`validateCiArtifactPayload`) і його `template` резолвиться (`resolveArtifactTemplatePath`) у
 * реальний файл на диску — без broker/discovery, лише форма й containment, той самий контракт,
 * що читають `@7n/rules-ci-github`/`@7n/rules-ci-azure`.
 *
 * Винесено сюди (не дубльовано в кожному мовному плагіні) — обидва плагіни повторюють
 * ідентичний тестовий канон для власних дескрипторів (jscpd: `minLines: 25` фіксував
 * дослівний клон `describe.each`-блоку раніше, ніж з'явився цей спільний модуль).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { resolveArtifactTemplatePath, validateCiArtifactPayload } from '../../lib/plugin-api.mjs'

/**
 * @typedef {object} CiArtifactDescriptorCase
 * @property {string} file імʼя дескриптора у `ciDir`
 * @property {Partial<import('../../lib/plugin-api.mjs').CiArtifactDescriptor>} expected очікувана форма (`toMatchObject`)
 */

/**
 * Реєструє `describe.each`-тести canonical payload-контракту й template-резолву для списку
 * `ci.artifact@1` дескрипторів одного пакета. Викликається на верхньому рівні тестового файлу
 * (як звичайний `describe(...)`) — не всередині `test`/`beforeEach`.
 * @param {{ packageRoot: string, ciDir: string, cases: CiArtifactDescriptorCase[] }} args корінь пакета, тека дескрипторів (`slots/ci`) і список кейсів
 * @returns {void}
 */
export function describeCiArtifactDescriptors({ packageRoot, ciDir, cases }) {
  describe.each(cases)('$file', ({ file, expected }) => {
    const raw = JSON.parse(readFileSync(join(ciDir, file), 'utf8'))

    test('проходить validateCiArtifactPayload', () => {
      const result = validateCiArtifactPayload(raw)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.descriptor).toMatchObject(expected)
    })

    test('template резолвиться у реальний файл на диску (containment у packageRoot)', () => {
      const result = validateCiArtifactPayload(raw)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const contribution = { packageRoot, resourcePath: join(ciDir, file) }
      const resolved = resolveArtifactTemplatePath(contribution, result.descriptor)
      expect(resolved.ok).toBe(true)
      if (resolved.ok) expect(resolved.exists).toBe(true)
    })
  })
}
