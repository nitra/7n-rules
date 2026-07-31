/**
 * Тести резолвера `wasm-plugins.mjs` (задача K фази 6, спека
 * `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.3) —
 * читання секції `wasmPlugins` `.n-rules.json` і skip-not-crash поведінка на
 * відсутньому/битому `.wasm`. Реальна інтеграція (без моків native-аддона —
 * той самий канон, що й `wasm-plugin-parity.test.mjs`), тому потребує зібраний
 * пілотний компонент (`bash crates/plugin-lang-js-pilot/build.sh`).
 */
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { beforeEach, describe, expect, test, vi } from 'vitest'

import { realRepoRoot, withTmpDir } from '../../../utils/test-helpers.mjs'
import { resetWasmConcernMapForTests, resolveWasmConcernMap } from '../wasm-plugins.mjs'

const REPO_ROOT = realRepoRoot()
const WASM_PATH = join(REPO_ROOT, 'target', 'wasm32-wasip2', 'release', 'plugin_lang_js_pilot.wasm')

if (!existsSync(WASM_PATH)) {
  throw new Error(
    `wasm-plugins.test.mjs: пілотний компонент не зібраний: ${WASM_PATH} відсутній.\n` +
      'Зберіть його командою: bash crates/plugin-lang-js-pilot/build.sh'
  )
}

beforeEach(() => {
  resetWasmConcernMapForTests()
})

describe('resolveWasmConcernMap — читання конфігу', () => {
  test('немає .n-rules.json → порожня мапа', () => {
    return withTmpDir(dir => {
      const map = resolveWasmConcernMap(dir)
      expect(map.size).toBe(0)
    })
  })

  test('невалідний JSON у .n-rules.json → порожня мапа (skip-not-crash)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.n-rules.json'), '{ не json', 'utf8')
      const map = resolveWasmConcernMap(dir)
      expect(map.size).toBe(0)
    })
  })

  test('wasmPlugins не масив → порожня мапа', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.n-rules.json'), JSON.stringify({ wasmPlugins: 'not-array' }), 'utf8')
      const map = resolveWasmConcernMap(dir)
      expect(map.size).toBe(0)
    })
  })

  test('невалідні записи (без name/path) відфільтровуються', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({ wasmPlugins: [{ name: 'no-path' }, { path: 'no-name' }, 'string-entry', 42] }),
        'utf8'
      )
      const map = resolveWasmConcernMap(dir)
      expect(map.size).toBe(0)
    })
  })

  test('відсутній .wasm-файл за шляхом → warn і пропуск запису (skip-not-crash)', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({ wasmPlugins: [{ name: 'ghost', path: './does-not-exist.wasm' }] }),
        'utf8'
      )
      const warnSpy = vi.spyOn(console, 'warn').mockReturnValue()
      const map = resolveWasmConcernMap(dir)
      expect(map.size).toBe(0)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ghost'))
      warnSpy.mockRestore()
    })
  })

  test('битий (не-wasm) файл за шляхом → warn і пропуск запису (skip-not-crash)', async () => {
    await withTmpDir(async dir => {
      const brokenWasmPath = join(dir, 'broken.wasm')
      await writeFile(brokenWasmPath, 'це не wasm-компонент, звичайний текст', 'utf8')
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({ wasmPlugins: [{ name: 'broken', path: './broken.wasm' }] }),
        'utf8'
      )
      const warnSpy = vi.spyOn(console, 'warn').mockReturnValue()
      const map = resolveWasmConcernMap(dir)
      expect(map.size).toBe(0)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('broken'))
      warnSpy.mockRestore()
    })
  })

  test('валідний запис → мапа містить ключ concern-а з абсолютним шляхом до .wasm', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({ wasmPlugins: [{ name: 'lang-js-pilot', path: WASM_PATH }] }),
        'utf8'
      )
      const map = resolveWasmConcernMap(dir)
      expect(map.get('vue/tfm-translations')).toBe(WASM_PATH)
    })
  })

  test('relative path у конфізі резолвиться відносно cwd', async () => {
    await withTmpDir(async dir => {
      // Relative шлях від tmp-каталогу до реального зібраного .wasm (репо не в tmp).
      const relPath = relative(dir, WASM_PATH)
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({ wasmPlugins: [{ name: 'p', path: relPath }] }),
        'utf8'
      )
      const map = resolveWasmConcernMap(dir)
      expect(map.get('vue/tfm-translations')).toBe(WASM_PATH)
    })
  })

  test('результат кешується на процес — повторний виклик не перечитує .n-rules.json', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({ wasmPlugins: [{ name: 'lang-js-pilot', path: WASM_PATH }] }),
        'utf8'
      )
      const first = resolveWasmConcernMap(dir)
      expect(first.size).toBe(1)
      // Видаляємо .n-rules.json — якби кеш не працював, другий виклик повернув би порожню мапу.
      await writeFile(join(dir, '.n-rules.json'), JSON.stringify({}), 'utf8')
      const second = resolveWasmConcernMap(dir)
      expect(second).toBe(first)
      expect(second.size).toBe(1)
    })
  })
})
