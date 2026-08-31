/**
 * E2E- і dispatch-тести fix-контуру wasm-плагінів (contract v3, `export fix`
 * → napi `runWasmConcernFix` → синтетичний T0Pattern `wasm-fix:*` у
 * `run-fix.mjs`) на пілоті `test/no-bun-test-import` (`crates/plugin-lang-js`
 * — Rust-порт видаленого `fix-no-bun-test-import.mjs`; кейси того JS-тесту
 * збережено тут на dispatch-рівні, unit-рівень — `#[cfg(test)]`
 * `crates/plugin-lang-js/src/lib.rs`, host-рівень —
 * `crates/rules-plugin-host/tests/plugin_lang_js.rs`).
 *
 * Резолв ключа концерну йде через вбудовану таблицю first-party пінів
 * (`npm/wasm-plugins/builtin-pins.json`, задача O1) — той самий guard-мотив,
 * що `wasm-plugin-e2e.test.mjs`: без локальної збірки
 * (`node npm/scripts/build-wasm-plugins.mjs`) describe-блоки пропускаються
 * з warn (шлях-піни `.n-rules.json` тут не використовуються — вони
 * недоступні в CI, спека §3.4).
 *
 * Рівні покриття:
 * - `loadT0Patterns` повертає синтетичний `wasm-fix:*` патерн (дзеркало
 *   тестів native-обгортки, `npm/rules/hasura/migrations/tests/fix-migrations.test.mjs`);
 * - rollback-контракт: `ctx.recordWrite` ДО мутації, реальний
 *   `snapshot.rollback()` відновлює оригінальний вміст;
 * - живий смок: tempdir → порушення → `runFixPipeline` чинить через
 *   wasm-план → exit 0, вміст звірено.
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { beforeEach, describe, expect, test } from 'vitest'

import { loadT0Patterns, runFixPipeline } from '../run-fix.mjs'
import { createSnapshot } from '../snapshot.mjs'
import { resetWasmConcernMapForTests } from '../wasm-plugins.mjs'
import { realRepoRoot, withTmpDir, writeJson } from '../../../utils/test-helpers.mjs'

const REPO_ROOT = realRepoRoot()
const WASM_PATH = join(REPO_ROOT, 'target', 'wasm32-wasip3', 'release', 'plugin_lang_js.wasm')
const BUILTIN_PINS_PATH = join(REPO_ROOT, 'npm', 'wasm-plugins', 'builtin-pins.json')
const hasBuiltinPins = existsSync(BUILTIN_PINS_PATH)

if (!existsSync(WASM_PATH)) {
  throw new Error(
    `wasm-fix-e2e.test.mjs: wasm-компонент plugin-lang-js не зібраний: ${WASM_PATH} відсутній.\n` +
      'Зберіть його командою: bash crates/plugin-lang-js/build.sh'
  )
}

if (!hasBuiltinPins) {
  console.warn(
    `⚠️ wasm-fix-e2e.test.mjs: describe-блоки пропущено — ${BUILTIN_PINS_PATH} відсутній.\n` +
      'Зберіть локально: node npm/scripts/build-wasm-plugins.mjs'
  )
}

const ruleId = 'test'
const concernId = 'no-bun-test-import'

/** Джерело bun:test збирається динамічно, щоб не тригерити детектор на цьому файлі. */
const BUN_TEST = ['bun', 'test'].join(':')

/**
 * Сіє в tempdir мінімальний rulesDir з РЕАЛЬНИМ `concern.json` пілотного
 * концерну (без `main.mjs` — і detect, і fix ідуть через wasm-диспатч).
 * @param {string} dir Корінь tempdir.
 * @returns {Promise<{ rulesDir: string, concernDir: string }>} Шляхи rulesDir/concernDir.
 */
async function seedWasmConcern(dir) {
  const concernDir = join(dir, 'rules', ruleId, concernId)
  await mkdir(concernDir, { recursive: true })
  await writeJson(join(concernDir, 'concern.json'), {
    lint: { scope: 'full', glob: ['**/*.test.mjs', '**/*.test.js'] }
  })
  await writeJson(join(dir, '.n-rules.json'), { rules: [ruleId] })
  return { rulesDir: join(dir, 'rules'), concernDir }
}

/**
 * Формує normalized violation для `test/no-bun-test-import`.
 * @param {string} file Шлях файлу.
 * @returns {{
 *   ruleId: string,
 *   concernId: string,
 *   reason: string,
 *   message: string,
 *   severity: 'error',
 *   file: string,
 *   data: { fixable: boolean, specifiers: string[] }
 * }} Нормалізований violation для wasm-detect.
 */
function fixableViolation(file) {
  return {
    ruleId,
    concernId,
    reason: 'bun-test-import',
    message: `${file}:1: import з 'bun:test'`,
    severity: 'error',
    file,
    data: { fixable: true, specifiers: ['test'] }
  }
}

beforeEach(() => {
  resetWasmConcernMapForTests()
})

;(hasBuiltinPins ? describe : describe.skip)('loadT0Patterns — wasm-fix dispatch (fix-контур contract v3)', () => {
  test('повертає синтетичний wasm-fix pattern для концерну плагіна', async () => {
    await withTmpDir(async dir => {
      const { concernDir } = await seedWasmConcern(dir)
      const patterns = await loadT0Patterns(concernDir, concernId, ruleId, dir)
      expect(patterns).toHaveLength(1)
      expect(patterns[0].id).toBe(`wasm-fix:${ruleId}/${concernId}`)
    })
  })

  test('test: true для fixable violation, false для не-fixable і порожніх', async () => {
    await withTmpDir(async dir => {
      const { concernDir } = await seedWasmConcern(dir)
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/foo.test.mjs'), `import { test } from '${BUN_TEST}'\ntest('x', () => {})\n`)
      await writeFile(join(dir, 'tests/bad.test.mjs'), `import { test, mock } from '${BUN_TEST}'\n`)

      const [pattern] = await loadT0Patterns(concernDir, concernId, ruleId, dir)
      expect(pattern.test([fixableViolation('tests/foo.test.mjs')])).toBe(true)
      expect(
        pattern.test([
          {
            ...fixableViolation('tests/bad.test.mjs'),
            data: { fixable: false, specifiers: ['test', 'mock'] }
          }
        ])
      ).toBe(false)
      expect(pattern.test([])).toBe(false)
    })
  })

  test('apply: переписує bun:test → vitest, recordWrite ДО мутації, rollback відновлює оригінал', async () => {
    await withTmpDir(async dir => {
      const { concernDir } = await seedWasmConcern(dir)
      await mkdir(join(dir, 'tests'), { recursive: true })
      const target = join(dir, 'tests/foo.test.mjs')
      const original = `import { test } from '${BUN_TEST}'\ntest('x', () => {})\n`
      await writeFile(target, original)

      const snapshot = createSnapshot()
      let contentAtRecordWriteTime = null
      const ctx = {
        cwd: dir,
        ruleId,
        concernId,
        recordWrite: absPath => {
          // recordWrite ДО write: pre-image ще оригінальна — інакше rollback
          // відновлював би вже зіпсований вміст.
          contentAtRecordWriteTime = readFileSync(absPath, 'utf8')
          snapshot.record(absPath)
        }
      }
      const violations = [fixableViolation('tests/foo.test.mjs')]
      const [pattern] = await loadT0Patterns(concernDir, concernId, ruleId, dir)
      expect(pattern.test(violations)).toBe(true)
      const res = await pattern.apply(violations, ctx)

      expect(res.touchedFiles).toEqual([target])
      expect(contentAtRecordWriteTime).toBe(original)
      const fixed = await readFile(target, 'utf8')
      expect(fixed).toContain("from 'vitest'")
      expect(fixed).not.toContain(BUN_TEST)

      snapshot.rollback()
      expect(await readFile(target, 'utf8')).toBe(original)
    })
  })
})

;(hasBuiltinPins ? describe : describe.skip)(
  'runFixPipeline — живий смок wasm-фікса (пілот test/no-bun-test-import)',
  () => {
    test('tempdir з порушенням → wasm-detect → wasm-fix план у T0 → exit 0, вміст переписано', async () => {
      await withTmpDir(async dir => {
        const { rulesDir } = await seedWasmConcern(dir)
        await mkdir(join(dir, 'tests'), { recursive: true })
        const target = join(dir, 'tests/foo.test.mjs')
        await writeFile(
          target,
          `import { describe, test, expect, beforeEach } from '${BUN_TEST}'\n\ndescribe('x', () => {\n  beforeEach(() => {})\n  test('ok', () => expect(1).toBe(1))\n})\n`
        )

        const code = await runFixPipeline({
          rulesDir,
          cwd: dir,
          full: true,
          log: () => {
            /* no-op logger */
          },
          deps: {
            ladder: [],
            workerFor: () => () => {
              /* wasm T0 має закрити concern ДО ladder-а */
            }
          }
        })

        expect(code).toBe(0)
        const content = await readFile(target, 'utf8')
        expect(content).toContain("from 'vitest'")
        expect(content).not.toContain(BUN_TEST)
        expect(content).toContain('import { describe, test, expect, beforeEach } from')
        expect(content).toContain("test('ok', () => expect(1).toBe(1))")
      })
    })

    test('не-fixable import (mock) → wasm-план порожній, pipeline лишає файл недоторканим і повертає 1', async () => {
      await withTmpDir(async dir => {
        const { rulesDir } = await seedWasmConcern(dir)
        await mkdir(join(dir, 'tests'), { recursive: true })
        const target = join(dir, 'tests/foo.test.mjs')
        const original = `import { test, mock } from '${BUN_TEST}'\ntest('x', () => mock(() => 1))\n`
        await writeFile(target, original)

        const code = await runFixPipeline({
          rulesDir,
          cwd: dir,
          full: true,
          log: () => {
            /* no-op logger */
          },
          deps: {
            ladder: [],
            workerFor: () => () => {
              /* ladder порожній — не викликається */
            }
          }
        })

        expect(code).toBe(1)
        expect(await readFile(target, 'utf8')).toBe(original)
      })
    })
  }
)
