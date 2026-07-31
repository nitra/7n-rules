/**
 * Тести резолвера `wasm-plugins.mjs` (задача K фази 6, спека
 * `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.3/§3.4) —
 * читання секції `wasmPlugins` `.n-rules.json`, skip-not-crash поведінка на
 * відсутньому/битому `.wasm` (dev-форма `path`), CI-гейт `path`-форми і
 * retrieval-контур канонічного піна (`url`+`sha256`: кеш-хіт/кеш-промах/
 * mismatch/пошкоджений кеш). Реальна інтеграція (без моків native-аддона —
 * той самий канон, що й `wasm-plugin-parity.test.mjs`), тому потребує зібраний
 * пілотний компонент (`bash crates/plugin-lang-js-pilot/build.sh`).
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
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

/** Реальні байти зібраного пілота — джерело і для happy-path retrieval, і для sha256 у конфігах тестів. */
const WASM_BYTES = readFileSync(WASM_PATH)
/** sha256-hex реального пілотного компонента (кожен happy-path тест звіряється саме з ним). */
const WASM_SHA256 = createHash('sha256').update(WASM_BYTES).digest('hex')
/** Синтаксично валідний, але завідомо неправильний sha256 — для mismatch-сценарію. */
const WRONG_SHA256 = '0'.repeat(64)

/**
 * Fetch-стаб: повертає задані байти як успішну 2xx-відповідь. `vi.fn()` — щоб тест міг
 * рахувати виклики (кеш-хіт не має бити мережу).
 * @param {Buffer} bytes вміст, який "завантажує" стаб
 * @returns {import('vitest').Mock} fetchFn-заглушка
 */
function fakeFetch(bytes) {
  return vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes }))
}

beforeEach(() => {
  resetWasmConcernMapForTests()
})

describe('resolveWasmConcernMap — читання конфігу', () => {
  test('немає .n-rules.json → порожня мапа', async () => {
    await withTmpDir(async dir => {
      const map = await resolveWasmConcernMap(dir)
      expect(map.size).toBe(0)
    })
  })

  test('невалідний JSON у .n-rules.json → порожня мапа (skip-not-crash)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.n-rules.json'), '{ не json', 'utf8')
      const map = await resolveWasmConcernMap(dir)
      expect(map.size).toBe(0)
    })
  })

  test('wasmPlugins не масив → порожня мапа', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.n-rules.json'), JSON.stringify({ wasmPlugins: 'not-array' }), 'utf8')
      const map = await resolveWasmConcernMap(dir)
      expect(map.size).toBe(0)
    })
  })

  test('невалідні записи (без name/path, без url+sha256, битий sha256) відфільтровуються', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({
          wasmPlugins: [
            { name: 'no-path' },
            { path: 'no-name' },
            'string-entry',
            42,
            { name: 'url-without-sha256', url: 'https://example.test/p.wasm' },
            { name: 'sha256-not-hex', url: 'https://example.test/p.wasm', sha256: 'not-a-valid-hash' },
            { name: 'sha256-wrong-length', url: 'https://example.test/p.wasm', sha256: 'ab'.repeat(30) }
          ]
        }),
        'utf8'
      )
      const map = await resolveWasmConcernMap(dir)
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
      const map = await resolveWasmConcernMap(dir, { env: {} })
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
      const map = await resolveWasmConcernMap(dir, { env: {} })
      expect(map.size).toBe(0)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('broken'))
      warnSpy.mockRestore()
    })
  })

  test('валідний запис (path) → мапа містить ключ concern-а з абсолютним шляхом до .wasm', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({ wasmPlugins: [{ name: 'lang-js-pilot', path: WASM_PATH }] }),
        'utf8'
      )
      const map = await resolveWasmConcernMap(dir, { env: {} })
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
      const map = await resolveWasmConcernMap(dir, { env: {} })
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
      const first = await resolveWasmConcernMap(dir, { env: {} })
      expect(first.size).toBe(1)
      // Видаляємо .n-rules.json — якби кеш не працював, другий виклик повернув би порожню мапу.
      await writeFile(join(dir, '.n-rules.json'), JSON.stringify({}), 'utf8')
      const second = await resolveWasmConcernMap(dir)
      expect(second).toBe(first)
      expect(second.size).toBe(1)
    })
  })

  test('конкурентні виклики до завершення першого резолву переюзають той самий in-flight Promise', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({ wasmPlugins: [{ name: 'lang-js-pilot', path: WASM_PATH }] }),
        'utf8'
      )
      const [a, b] = await Promise.all([
        resolveWasmConcernMap(dir, { env: {} }),
        resolveWasmConcernMap(dir, { env: {} })
      ])
      expect(a).toBe(b)
    })
  })
})

describe('resolveWasmConcernMap — path-форма і CI-гейт (спека §3.4)', () => {
  test('path у CI (env.CI truthy) → skip+warn, path недоступний', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({ wasmPlugins: [{ name: 'lang-js-pilot', path: WASM_PATH }] }),
        'utf8'
      )
      const warnSpy = vi.spyOn(console, 'warn').mockReturnValue()
      const map = await resolveWasmConcernMap(dir, { env: { CI: '1' } })
      expect(map.size).toBe(0)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('лише поза CI'))
      warnSpy.mockRestore()
    })
  })

  test('path поза CI (env без CI) → dev-петля працює як раніше', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({ wasmPlugins: [{ name: 'lang-js-pilot', path: WASM_PATH }] }),
        'utf8'
      )
      const map = await resolveWasmConcernMap(dir, { env: {} })
      expect(map.get('vue/tfm-translations')).toBe(WASM_PATH)
    })
  })
})

describe('resolveWasmConcernMap — url+sha256 retrieval (канонічний пін, спека §3.4 рішення Ж)', () => {
  test('happy-path: fetch + sha256-звірка + атомарний кеш → мапа містить ключ концерну', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({
          wasmPlugins: [{ name: 'lang-js-pilot', url: 'https://example.test/plugin.wasm', sha256: WASM_SHA256 }]
        }),
        'utf8'
      )
      const cacheDir = join(dir, 'cache')
      const fetchFn = fakeFetch(WASM_BYTES)
      const map = await resolveWasmConcernMap(dir, { fetchFn, cacheDir, env: {} })
      const cachePath = join(cacheDir, `${WASM_SHA256}.wasm`)
      expect(map.get('vue/tfm-translations')).toBe(cachePath)
      expect(fetchFn).toHaveBeenCalledWith('https://example.test/plugin.wasm')
      expect(existsSync(cachePath)).toBe(true)
    })
  })

  test('sha256-mismatch → skip+warn, запис НЕ кешується', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({
          wasmPlugins: [{ name: 'bad-hash', url: 'https://example.test/plugin.wasm', sha256: WRONG_SHA256 }]
        }),
        'utf8'
      )
      const cacheDir = join(dir, 'cache')
      const fetchFn = fakeFetch(WASM_BYTES)
      const warnSpy = vi.spyOn(console, 'warn').mockReturnValue()
      const map = await resolveWasmConcernMap(dir, { fetchFn, cacheDir, env: {} })
      expect(map.size).toBe(0)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('sha256 не збігається'))
      expect(existsSync(join(cacheDir, `${WRONG_SHA256}.wasm`))).toBe(false)
      warnSpy.mockRestore()
    })
  })

  test('кеш-хіт: другий резолв читає з диска, fetchFn НЕ викликається', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({
          wasmPlugins: [{ name: 'lang-js-pilot', url: 'https://example.test/plugin.wasm', sha256: WASM_SHA256 }]
        }),
        'utf8'
      )
      const cacheDir = join(dir, 'cache')

      const firstFetch = fakeFetch(WASM_BYTES)
      await resolveWasmConcernMap(dir, { fetchFn: firstFetch, cacheDir, env: {} })
      expect(firstFetch).toHaveBeenCalledTimes(1)

      resetWasmConcernMapForTests()
      const secondFetch = fakeFetch(WASM_BYTES)
      const map = await resolveWasmConcernMap(dir, { fetchFn: secondFetch, cacheDir, env: {} })
      expect(map.get('vue/tfm-translations')).toBe(join(cacheDir, `${WASM_SHA256}.wasm`))
      expect(secondFetch).not.toHaveBeenCalled()
    })
  })

  test("пошкоджений кеш-файл (підмінений вміст під правильним ім'ям) → повторне завантаження", async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({
          wasmPlugins: [{ name: 'lang-js-pilot', url: 'https://example.test/plugin.wasm', sha256: WASM_SHA256 }]
        }),
        'utf8'
      )
      const cacheDir = join(dir, 'cache')
      await mkdir(cacheDir, { recursive: true })
      // Файл лежить під очікуваним ім'ям (<sha256>.wasm), але вміст підмінено — ім'я саме по
      // собі не має бути довірою, кеш має визнати це промахом і піти по мережу.
      await writeFile(join(cacheDir, `${WASM_SHA256}.wasm`), 'підмінений вміст, не справжній wasm', 'utf8')

      const fetchFn = fakeFetch(WASM_BYTES)
      const map = await resolveWasmConcernMap(dir, { fetchFn, cacheDir, env: {} })
      expect(fetchFn).toHaveBeenCalledTimes(1)
      const cachePath = join(cacheDir, `${WASM_SHA256}.wasm`)
      expect(map.get('vue/tfm-translations')).toBe(cachePath)
      expect(readFileSync(cachePath).equals(WASM_BYTES)).toBe(true)
    })
  })

  test('fetchFn кидає (мережева помилка) → skip+warn, не валить резолв', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({
          wasmPlugins: [{ name: 'unreachable', url: 'https://example.test/plugin.wasm', sha256: WASM_SHA256 }]
        }),
        'utf8'
      )
      const cacheDir = join(dir, 'cache')
      const fetchFn = vi.fn(async () => {
        throw new Error('network unreachable')
      })
      const warnSpy = vi.spyOn(console, 'warn').mockReturnValue()
      const map = await resolveWasmConcernMap(dir, { fetchFn, cacheDir, env: {} })
      expect(map.size).toBe(0)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('завантаження не вдалось'))
      warnSpy.mockRestore()
    })
  })

  test('не-2xx відповідь → skip+warn з HTTP-статусом', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({
          wasmPlugins: [{ name: 'not-found', url: 'https://example.test/plugin.wasm', sha256: WASM_SHA256 }]
        }),
        'utf8'
      )
      const cacheDir = join(dir, 'cache')
      const fetchFn = vi.fn(async () => ({ ok: false, status: 404, arrayBuffer: async () => WASM_BYTES }))
      const warnSpy = vi.spyOn(console, 'warn').mockReturnValue()
      const map = await resolveWasmConcernMap(dir, { fetchFn, cacheDir, env: {} })
      expect(map.size).toBe(0)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('HTTP 404'))
      warnSpy.mockRestore()
    })
  })
})
