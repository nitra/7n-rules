/**
 * Тести T0-фіксера `text/oxfmt` (`fix-oxfmt.mjs`) на temp-fixtures.
 *
 * Детектор (`lint()`) портовано в native (F2 фази 5): `main.mjs` видалено,
 * логіка й тести детектора живуть у
 * `crates/rules-core/src/concerns/text_oxfmt.rs` +
 * `crates/rules-core/tests/text_oxfmt.rs`. `fix-oxfmt.mjs` НЕ залежить від
 * `main.mjs` (власний `resolveCmd('oxfmt')` + `spawnAsync`), тож лишається
 * в JS і зберігає власне тестове покриття тут — той самий поділ, що й у
 * `text/cspell-fix` (`fix-worker.mjs` тестується окремо від видаленого
 * `main.mjs`).
 *
 * oxfmt стабільно доступний у PATH (homebrew/node_modules) — інтеграційний прогін.
 */
import { describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { patterns } from '../fix-oxfmt.mjs'
import { resolveCmd } from '../../../../scripts/utils/resolve-cmd.mjs'
import { spawnAsync } from '../../../../scripts/utils/spawn-async.mjs'

/**
 * Виконує `fn(dir)` у свіжому temp-каталозі й гарантовано прибирає його (await — fn асинхронний).
 * @param {(dir: string) => Promise<unknown>} fn тіло тесту
 * @returns {Promise<unknown>} результат `fn`
 */
async function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'oxfmt-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const ctxFor = dir => ({ cwd: dir, ruleId: 'text', concernId: 'oxfmt', files: undefined })

describe('text/oxfmt T0 fixer', () => {
  test('T0 write форматує файл і повторний --list-different нічого не знаходить', () =>
    withTmp(async dir => {
      writeFileSync(join(dir, 'bad.mjs'), 'export  const   x=1\nexport const y= 2\n')
      // Синтетична violation у формі, яку видає native-детектор
      // (reason/file/data.kind — `crates/rules-core/src/concerns/text_oxfmt.rs`).
      const before = [
        {
          reason: 'oxfmt-unformatted',
          message: 'bad.mjs: не відформатовано',
          file: 'bad.mjs',
          data: { kind: 'oxfmt-unformatted' }
        }
      ]
      const res = await patterns[0].apply(before, ctxFor(dir))
      expect(res.touchedFiles).toHaveLength(1)

      const oxfmt = resolveCmd('oxfmt')
      const r = await spawnAsync(oxfmt, ['--list-different', 'bad.mjs'], { cwd: dir })
      expect((r.stdout ?? '').trim()).toBe('')
    }))

  test('test=false без oxfmt-unformatted', () => {
    expect(patterns[0].test([{ reason: 'other', message: 'm', file: 'a.mjs' }])).toBe(false)
  })
})
