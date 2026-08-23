/**
 * Тести T0-патерну `js-check-knip` з `fix-check.mjs`: копіює `knip.json` з
 * канону пакета `@7n/rules` і ідемпотентний на вже виправленому дереві.
 *
 * Витягнуто з колишнього `check.test.mjs` (видаленого разом з JS-детектором
 * `js/check/main.mjs` — Rust/wasm-порт `detect_js_check` у
 * `crates/plugin-lang-js/src/lib.rs` тепер канонічний). Тут лишається лише
 * fix-половина (T0-фіксер — свідома JS-прогалина host-мосту, §2.3 реєстру
 * `docs/plans/2026-08-05-open-questions-register.md`): детект-частина
 * («знайдений knip.json → без knip-missing», «дерево НЕ мутоване до фіксу»)
 * тепер покрита Rust-тестом
 * `detect_js_check_reports_knip_missing_without_writing_anything`.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { patterns } from '../fix-check.mjs'
import { KNIP_MISSING } from '../../tooling/main.mjs'
import { withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'

describe('fix-check T0 — js-check-knip', () => {
  test('T0 `js-check-knip` створює knip.json з канону й ідемпотентний', async () => {
    await withTmpDir(async dir => {
      const knipPattern = patterns.find(p => p.id === 'js-check-knip')
      const violations = [{ reason: KNIP_MISSING, message: 'knip.json відсутній' }]
      expect(knipPattern.test(violations)).toBe(true)

      const first = await knipPattern.apply(violations, { cwd: dir })
      expect(existsSync(join(dir, 'knip.json'))).toBe(true)
      expect(first.touchedFiles).toHaveLength(1)

      // Повторний прогін на вже виправленому дереві нічого не чіпає.
      const second = await knipPattern.apply(violations, { cwd: dir })
      expect(second.touchedFiles).toEqual([])
    })
  })
})
