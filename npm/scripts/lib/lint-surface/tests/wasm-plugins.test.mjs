/**
 * Тести резолвера `wasm-plugins.mjs` (задача K фази 6, спека
 * `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.3/§3.4) —
 * читання секції `wasmPlugins` `.n-rules.json`, skip-not-crash поведінка на
 * відсутньому/битому `.wasm` (dev-форма `path`), CI-гейт `path`-форми і
 * retrieval-контур канонічного піна (`url`+`sha256`: кеш-хіт/кеш-промах/
 * mismatch/пошкоджений кеш). Реальна інтеграція (без моків native-аддона —
 * той самий канон, що й `wasm-plugin-parity.test.mjs`), тому потребує зібраний
 * wasm-компонент plugin-lang-js (`bash crates/plugin-lang-js/build.sh`).
 *
 * Усі виклики резолвера тут йдуть через [`resolveMap`], НЕ напряму
 * `resolveWasmConcernMap` — ізоляція від builtin-таблиці (задача O1, рішення
 * Н): `resolveMap` завжди підставляє `builtinPinsDir` на неіснуючий каталог,
 * тож наявність/відсутність РЕАЛЬНОГО `npm/wasm-plugins/builtin-pins.json`
 * (артефакт локальної `node npm/scripts/build-wasm-plugins.mjs`, який
 * розробник міг лишити в робочому дереві) не впливає на детерміновані
 * сценарії цього файлу (`.n-rules.json`-контур). Сама builtin-таблиця — окремі
 * describe-блоки нижче (з явним `builtinPinsDir`) і mirror-тест
 * `wasm-builtin-pins.test.mjs`.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { beforeEach, describe, expect, test, vi } from 'vitest'

import { realRepoRoot, withTmpDir } from '../../../utils/test-helpers.mjs'
import { loadNative } from '../../native.mjs'
import { resetWasmConcernMapForTests, resolveWasmConcernMap } from '../wasm-plugins.mjs'

const REPO_ROOT = realRepoRoot()
const WASM_PATH = join(REPO_ROOT, 'target', 'wasm32-wasip2', 'release', 'plugin_lang_js.wasm')

if (!existsSync(WASM_PATH)) {
  throw new Error(
    `wasm-plugins.test.mjs: wasm-компонент plugin-lang-js не зібраний: ${WASM_PATH} відсутній.\n` +
      'Зберіть його командою: bash crates/plugin-lang-js/build.sh'
  )
}

/** Неіснуючий каталог — ізолює [`resolveMap`] від реального `npm/wasm-plugins/` (доккомент вище). */
const NO_BUILTIN_DIR = join(REPO_ROOT, 'npm', '__wasm-plugins-test-no-builtin__')

/**
 * Обгортка над `resolveWasmConcernMap`, яка за замовчуванням ІЗОЛЮЄ виклик
 * від реальної builtin-таблиці (`builtinPinsDir: NO_BUILTIN_DIR`) — усі
 * тести файлу перевіряють `.n-rules.json`-контур, не builtin-дефолти.
 * `opts` мержиться ПОВЕРХ ізоляції — describe-блоки, що явно тестують
 * builtin-таблицю, підставляють свій `builtinPinsDir`.
 * @param {string} dir абсолютний cwd
 * @param {Parameters<typeof resolveWasmConcernMap>[1]} [opts] додаткові опції
 * @returns {ReturnType<typeof resolveWasmConcernMap>} резолвлена мапа концернів
 */
function resolveMap(dir, opts = {}) {
  return resolveWasmConcernMap(dir, { builtinPinsDir: NO_BUILTIN_DIR, ...opts })
}

/** Реальні байти зібраного plugin-lang-js — джерело і для happy-path retrieval, і для sha256 у конфігах тестів. */
const WASM_BYTES = readFileSync(WASM_PATH)
/** sha256-hex реального компонента plugin-lang-js (кожен happy-path тест звіряється саме з ним). */
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
  return vi.fn(() => Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(bytes) }))
}

/**
 * Фейковий napi-addon: `wasmPluginManifest` повертає заданий маніфест без
 * реального завантаження wasm-компонента (`resolveEntryPath` для `path`-форми
 * робить лише `existsSync`, не парсить вміст) — ізолює ensure-tool
 * wiring-тести (задача N1) від живого wasmtime-виклику.
 * @param {{ concerns: { key: string, scope: string, glob: string[] }[], tools: string[] }} manifest фейковий маніфест
 * @returns {{ wasmPluginManifest: (path: string) => object }} фейковий addon
 */
function fakeNative(manifest) {
  return { wasmPluginManifest: () => manifest }
}

beforeEach(() => {
  resetWasmConcernMapForTests()
})

describe('resolveWasmConcernMap — читання конфігу', () => {
  test('немає .n-rules.json → порожня мапа', async () => {
    await withTmpDir(async dir => {
      const map = await resolveMap(dir)
      expect(map.size).toBe(0)
    })
  })

  test('невалідний JSON у .n-rules.json → порожня мапа (skip-not-crash)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.n-rules.json'), '{ не json', 'utf8')
      const map = await resolveMap(dir)
      expect(map.size).toBe(0)
    })
  })

  test('wasmPlugins не масив → порожня мапа', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.n-rules.json'), JSON.stringify({ wasmPlugins: 'not-array' }), 'utf8')
      const map = await resolveMap(dir)
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
      const map = await resolveMap(dir)
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
      const map = await resolveMap(dir, { env: {} })
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
      const map = await resolveMap(dir, { env: {} })
      expect(map.size).toBe(0)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('broken'))
      warnSpy.mockRestore()
    })
  })

  test('валідний запис (path) → мапа містить ключ concern-а з абсолютним шляхом до .wasm', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({ wasmPlugins: [{ name: 'lang-js', path: WASM_PATH }] }),
        'utf8'
      )
      const map = await resolveMap(dir, { env: {} })
      // plugin-lang-js не декларує `tools` — `toolPaths` порожній (задача N1, доккомент модуля).
      expect(map.get('vue/tfm-translations')).toEqual({ wasmPath: WASM_PATH, toolPaths: {} })
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
      const map = await resolveMap(dir, { env: {} })
      expect(map.get('vue/tfm-translations')).toEqual({ wasmPath: WASM_PATH, toolPaths: {} })
    })
  })

  test('результат кешується на процес — повторний виклик не перечитує .n-rules.json', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({ wasmPlugins: [{ name: 'lang-js', path: WASM_PATH }] }),
        'utf8'
      )
      const first = await resolveMap(dir, { env: {} })
      // plugin-lang-js декларує тридцять шість контрибуцій
      // (vue/tfm-translations, style/gap, задача N2 + пʼять концернів задачі
      // Q1 батч 1 + два концерни задачі Q2 батч 2 + два AST-концерни задачі
      // Q3 + три AST-концерни задачі Q4 батч 4, де-скоуп батчу 2 знято +
      // пʼять концернів storybook-сімейства батчу 5 +
      // `test/storybook-vitest-config` і три rego-порти `*/package_json`
      // батчу 6 + чотири `npm-module/*` і `js/dep-policy` батчу 7 +
      // `bun/layout`, `style/tooling`, `test/sandbox-aware-test`,
      // `test/vitest-api-conventions` батчу 8 + `vue/packages` батчу 9 +
      // `test/stryker_config` зрізу 1, `js/check` зрізу 2 і `js/doc_comments`
      // зрізу 4 контракту v3.1) — мапа концернів індексується за кожним
      // ключем окремо.
      expect(first.size).toBe(36)
      // Видаляємо .n-rules.json — якби кеш не працював, другий виклик повернув би порожню мапу.
      await writeFile(join(dir, '.n-rules.json'), JSON.stringify({}), 'utf8')
      const second = await resolveMap(dir)
      expect(second).toBe(first)
      expect(second.size).toBe(36)
    })
  })

  test('конкурентні виклики до завершення першого резолву переюзають той самий in-flight Promise', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({ wasmPlugins: [{ name: 'lang-js', path: WASM_PATH }] }),
        'utf8'
      )
      const [a, b] = await Promise.all([resolveMap(dir, { env: {} }), resolveMap(dir, { env: {} })])
      expect(a).toBe(b)
    })
  })
})

describe('resolveWasmConcernMap — path-форма і CI-гейт (спека §3.4)', () => {
  test('path у CI (env.CI truthy) → skip+warn, path недоступний', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({ wasmPlugins: [{ name: 'lang-js', path: WASM_PATH }] }),
        'utf8'
      )
      const warnSpy = vi.spyOn(console, 'warn').mockReturnValue()
      const map = await resolveMap(dir, { env: { CI: '1' } })
      expect(map.size).toBe(0)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('лише поза CI'))
      warnSpy.mockRestore()
    })
  })

  test('path поза CI (env без CI) → dev-петля працює як раніше', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({ wasmPlugins: [{ name: 'lang-js', path: WASM_PATH }] }),
        'utf8'
      )
      const map = await resolveMap(dir, { env: {} })
      expect(map.get('vue/tfm-translations')).toEqual({ wasmPath: WASM_PATH, toolPaths: {} })
    })
  })
})

describe('resolveWasmConcernMap — url+sha256 retrieval (канонічний пін, спека §3.4 рішення Ж)', () => {
  test('happy-path: fetch + sha256-звірка + атомарний кеш → мапа містить ключ концерну', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({
          wasmPlugins: [{ name: 'lang-js', url: 'https://example.test/plugin.wasm', sha256: WASM_SHA256 }]
        }),
        'utf8'
      )
      const cacheDir = join(dir, 'cache')
      const fetchFn = fakeFetch(WASM_BYTES)
      const map = await resolveMap(dir, { fetchFn, cacheDir, env: {} })
      const cachePath = join(cacheDir, `${WASM_SHA256}.wasm`)
      expect(map.get('vue/tfm-translations')).toEqual({ wasmPath: cachePath, toolPaths: {} })
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
      const map = await resolveMap(dir, { fetchFn, cacheDir, env: {} })
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
          wasmPlugins: [{ name: 'lang-js', url: 'https://example.test/plugin.wasm', sha256: WASM_SHA256 }]
        }),
        'utf8'
      )
      const cacheDir = join(dir, 'cache')

      const firstFetch = fakeFetch(WASM_BYTES)
      await resolveMap(dir, { fetchFn: firstFetch, cacheDir, env: {} })
      expect(firstFetch).toHaveBeenCalledTimes(1)

      resetWasmConcernMapForTests()
      const secondFetch = fakeFetch(WASM_BYTES)
      const map = await resolveMap(dir, { fetchFn: secondFetch, cacheDir, env: {} })
      expect(map.get('vue/tfm-translations')).toEqual({
        wasmPath: join(cacheDir, `${WASM_SHA256}.wasm`),
        toolPaths: {}
      })
      expect(secondFetch).not.toHaveBeenCalled()
    })
  })

  test("пошкоджений кеш-файл (підмінений вміст під правильним ім'ям) → повторне завантаження", async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({
          wasmPlugins: [{ name: 'lang-js', url: 'https://example.test/plugin.wasm', sha256: WASM_SHA256 }]
        }),
        'utf8'
      )
      const cacheDir = join(dir, 'cache')
      await mkdir(cacheDir, { recursive: true })
      // Файл лежить під очікуваним ім'ям (<sha256>.wasm), але вміст підмінено — ім'я саме по
      // собі не має бути довірою, кеш має визнати це промахом і піти по мережу.
      await writeFile(join(cacheDir, `${WASM_SHA256}.wasm`), 'підмінений вміст, не справжній wasm', 'utf8')

      const fetchFn = fakeFetch(WASM_BYTES)
      const map = await resolveMap(dir, { fetchFn, cacheDir, env: {} })
      expect(fetchFn).toHaveBeenCalledTimes(1)
      const cachePath = join(cacheDir, `${WASM_SHA256}.wasm`)
      expect(map.get('vue/tfm-translations')).toEqual({ wasmPath: cachePath, toolPaths: {} })
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
      const fetchFn = vi.fn(() => Promise.reject(new Error('network unreachable')))
      const warnSpy = vi.spyOn(console, 'warn').mockReturnValue()
      const map = await resolveMap(dir, { fetchFn, cacheDir, env: {} })
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
      const fetchFn = vi.fn(() =>
        Promise.resolve({ ok: false, status: 404, arrayBuffer: () => Promise.resolve(WASM_BYTES) })
      )
      const warnSpy = vi.spyOn(console, 'warn').mockReturnValue()
      const map = await resolveMap(dir, { fetchFn, cacheDir, env: {} })
      expect(map.size).toBe(0)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('HTTP 404'))
      warnSpy.mockRestore()
    })
  })
})

describe('resolveWasmConcernMap — builtin-таблиця first-party пінів (задача O1, спека §3.4 рішення Н)', () => {
  test('немає builtin-pins.json (repo-дерево без збірки) → тиша, порожня мапа', async () => {
    await withTmpDir(async dir => {
      const warnSpy = vi.spyOn(console, 'warn').mockReturnValue()
      const map = await resolveWasmConcernMap(dir, { env: {}, builtinPinsDir: join(dir, 'no-such-dir') })
      expect(map.size).toBe(0)
      expect(warnSpy).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })
  })

  test('невалідний JSON у builtin-pins.json → warn і порожня мапа (skip-not-crash)', async () => {
    await withTmpDir(async dir => {
      const builtinDir = join(dir, 'wasm-plugins')
      await mkdir(builtinDir, { recursive: true })
      await writeFile(join(builtinDir, 'builtin-pins.json'), '{ не json', 'utf8')
      const warnSpy = vi.spyOn(console, 'warn').mockReturnValue()
      const map = await resolveWasmConcernMap(dir, { env: {}, builtinPinsDir: builtinDir })
      expect(map.size).toBe(0)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('builtin-pins.json'))
      warnSpy.mockRestore()
    })
  })

  test('записи з невалідним file/sha256 тихо відфільтровуються', async () => {
    await withTmpDir(async dir => {
      const builtinDir = join(dir, 'wasm-plugins')
      await mkdir(builtinDir, { recursive: true })
      await writeFile(
        join(builtinDir, 'builtin-pins.json'),
        JSON.stringify({
          'no-file': { sha256: WASM_SHA256 },
          'bad-sha256': { file: 'x.wasm', sha256: 'not-hex' },
          'not-an-object': 'oops'
        }),
        'utf8'
      )
      const map = await resolveWasmConcernMap(dir, { env: {}, builtinPinsDir: builtinDir })
      expect(map.size).toBe(0)
    })
  })

  test('файл із builtin-pins.json відсутній у теці → warn ("пошкоджена інсталяція") і пропуск', async () => {
    await withTmpDir(async dir => {
      const builtinDir = join(dir, 'wasm-plugins')
      await mkdir(builtinDir, { recursive: true })
      await writeFile(
        join(builtinDir, 'builtin-pins.json'),
        JSON.stringify({ 'lang-js': { file: 'ghost.wasm', sha256: WASM_SHA256 } }),
        'utf8'
      )
      const warnSpy = vi.spyOn(console, 'warn').mockReturnValue()
      const map = await resolveWasmConcernMap(dir, { env: {}, builtinPinsDir: builtinDir })
      expect(map.size).toBe(0)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('пошкоджена інсталяція'))
      warnSpy.mockRestore()
    })
  })

  test('sha256 файлу не збігається з таблицею → warn ("пошкоджена інсталяція") і пропуск', async () => {
    await withTmpDir(async dir => {
      const builtinDir = join(dir, 'wasm-plugins')
      await mkdir(builtinDir, { recursive: true })
      await writeFile(join(builtinDir, 'plugin-lang-js.wasm'), 'НЕ той вміст, що очікує sha256', 'utf8')
      await writeFile(
        join(builtinDir, 'builtin-pins.json'),
        JSON.stringify({ 'lang-js': { file: 'plugin-lang-js.wasm', sha256: WRONG_SHA256 } }),
        'utf8'
      )
      const warnSpy = vi.spyOn(console, 'warn').mockReturnValue()
      const map = await resolveWasmConcernMap(dir, { env: {}, builtinPinsDir: builtinDir })
      expect(map.size).toBe(0)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('sha256 не збігається'))
      warnSpy.mockRestore()
    })
  })

  test('happy-path: builtin-запис резолвиться БЕЗ .n-rules.json консюмера', async () => {
    await withTmpDir(async dir => {
      const builtinDir = join(dir, 'wasm-plugins')
      await mkdir(builtinDir, { recursive: true })
      await writeFile(join(builtinDir, 'plugin-lang-js.wasm'), WASM_BYTES)
      await writeFile(
        join(builtinDir, 'builtin-pins.json'),
        JSON.stringify({ 'lang-js': { file: 'plugin-lang-js.wasm', sha256: WASM_SHA256 } }),
        'utf8'
      )
      // Немає .n-rules.json у dir — контрибуції прийшли ВИКЛЮЧНО з builtin-таблиці.
      const map = await resolveWasmConcernMap(dir, { env: {}, builtinPinsDir: builtinDir })
      expect(map.get('vue/tfm-translations')).toEqual({
        wasmPath: join(builtinDir, 'plugin-lang-js.wasm'),
        toolPaths: {}
      })
      expect(map.get('style/gap')).toEqual({ wasmPath: join(builtinDir, 'plugin-lang-js.wasm'), toolPaths: {} })
    })
  })

  test('запис .n-rules.json з тим самим "name" ПОВНІСТЮ перекриває builtin-запис (рішення Н)', async () => {
    await withTmpDir(async dir => {
      const builtinDir = join(dir, 'wasm-plugins')
      await mkdir(builtinDir, { recursive: true })
      // Builtin-копія — навмисно ІНШИЙ (зіпсований) вміст: якби вона резолвилась,
      // sha256-звірка впала б і/чи manifest.concerns був би "builtin"-значенням,
      // не тим, що нижче встановлює консюмерський override.
      await writeFile(join(builtinDir, 'plugin-lang-js.wasm'), 'зіпсована builtin-копія')
      await writeFile(
        join(builtinDir, 'builtin-pins.json'),
        JSON.stringify({ 'lang-js': { file: 'plugin-lang-js.wasm', sha256: WASM_SHA256 } }),
        'utf8'
      )
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({ wasmPlugins: [{ name: 'lang-js', path: WASM_PATH }] }),
        'utf8'
      )
      const map = await resolveWasmConcernMap(dir, { env: {}, builtinPinsDir: builtinDir })
      // Override консюмера виграв — резолвлений шлях це РЕАЛЬНИЙ зібраний .wasm (WASM_PATH), не builtin-копія.
      expect(map.get('vue/tfm-translations')).toEqual({ wasmPath: WASM_PATH, toolPaths: {} })
    })
  })

  test('builtin-запис з ІНШИМ "name" (не перекритий) співіснує із записом консюмера', async () => {
    await withTmpDir(async dir => {
      const builtinDir = join(dir, 'wasm-plugins')
      await mkdir(builtinDir, { recursive: true })
      await writeFile(join(builtinDir, 'plugin-lang-js.wasm'), WASM_BYTES)
      await writeFile(
        join(builtinDir, 'builtin-pins.json'),
        JSON.stringify({ 'lang-js': { file: 'plugin-lang-js.wasm', sha256: WASM_SHA256 } }),
        'utf8'
      )
      const ensureToolFn = vi.fn(toolId => `/fake/bin/${toolId}`)
      // Окремий фіктивний .wasm-шлях для запису консюмера — `nativeFn` тут
      // path-aware (за шляхом): реальний `loadNative()` для builtin-копії
      // (`plugin-lang-js.wasm`), фейковий один-концерн-манифест для ІНШОГО шляху,
      // щоб довести, що записи РІЗНИХ `name` не перезаписують один одного в мапі
      // (на відміну від попереднього тесту override-у, де `name` збігається).
      const otherWasmPath = join(dir, 'other-plugin.wasm')
      await writeFile(otherWasmPath, 'фіктивний контент іншого плагіна консюмера', 'utf8')
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({ wasmPlugins: [{ name: 'other-plugin', path: otherWasmPath }] }),
        'utf8'
      )
      const map = await resolveWasmConcernMap(dir, {
        env: {},
        builtinPinsDir: builtinDir,
        ensureToolFn,
        nativeFn: () => ({
          wasmPluginManifest: path =>
            path === otherWasmPath
              ? { concerns: [{ key: 'other/concern', scope: 'per-file', glob: [] }], tools: [] }
              : loadNative().wasmPluginManifest(path)
        })
      })
      // Builtin lang-js (реальний manifest — дві контрибуції) + консюмерський other-plugin
      // (фейковий manifest — 'other/concern') — обидва в мапі одночасно.
      expect(map.get('vue/tfm-translations')).toEqual({
        wasmPath: join(builtinDir, 'plugin-lang-js.wasm'),
        toolPaths: {}
      })
      expect(map.get('style/gap')).toEqual({ wasmPath: join(builtinDir, 'plugin-lang-js.wasm'), toolPaths: {} })
      expect(map.get('other/concern')).toEqual({ wasmPath: otherWasmPath, toolPaths: {} })
    })
  })
})

describe('resolveWasmConcernMap — ensure-tool wiring (задача N1, рішення Д спеки)', () => {
  test('manifest.tools непорожній → ensureToolFn викликається на кожен tool, toolPaths потрапляє в мапу', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({ wasmPlugins: [{ name: 'fake-plugin', path: WASM_PATH }] }),
        'utf8'
      )
      const ensureToolFn = vi.fn(toolId => `/fake/bin/${toolId}`)
      const map = await resolveMap(dir, {
        env: {},
        nativeFn: () =>
          fakeNative({
            concerns: [{ key: 'fake/concern', scope: 'per-file', glob: [] }],
            tools: ['shellcheck@^0.9', 'eslint@>=8']
          }),
        ensureToolFn
      })

      expect(ensureToolFn).toHaveBeenCalledTimes(2)
      // semver-суфікс декларації обрізається перед передачею в ensure-tool (доккомент модуля).
      expect(ensureToolFn).toHaveBeenNthCalledWith(1, 'shellcheck')
      expect(ensureToolFn).toHaveBeenNthCalledWith(2, 'eslint')
      expect(map.get('fake/concern')).toEqual({
        wasmPath: WASM_PATH,
        toolPaths: { shellcheck: '/fake/bin/shellcheck', eslint: '/fake/bin/eslint' }
      })
    })
  })

  test('ensureToolFn кидає для одного tool-у → warn, той tool ВІДСУТНІЙ у toolPaths, плагін і решта tools лишаються', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({ wasmPlugins: [{ name: 'fake-plugin', path: WASM_PATH }] }),
        'utf8'
      )
      const ensureToolFn = vi.fn(toolId => {
        if (toolId === 'unknown-tool') throw new Error("ensureTool: невідомий тул 'unknown-tool'")
        return `/fake/bin/${toolId}`
      })
      const warnSpy = vi.spyOn(console, 'warn').mockReturnValue()
      const map = await resolveMap(dir, {
        env: {},
        nativeFn: () =>
          fakeNative({
            concerns: [{ key: 'fake/concern', scope: 'per-file', glob: [] }],
            tools: ['unknown-tool', 'shellcheck']
          }),
        ensureToolFn
      })

      expect(ensureToolFn).toHaveBeenCalledTimes(2)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown-tool'))
      // Плагін не пропущено (skip-not-crash на рівні ОДНОГО tool-у) — концерн лишається в мапі.
      expect(map.get('fake/concern')).toEqual({
        wasmPath: WASM_PATH,
        toolPaths: { shellcheck: '/fake/bin/shellcheck' }
      })
      warnSpy.mockRestore()
    })
  })

  test('manifest.tools порожній → ensureToolFn не викликається, toolPaths — порожній обʼєкт', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({ wasmPlugins: [{ name: 'fake-plugin', path: WASM_PATH }] }),
        'utf8'
      )
      const ensureToolFn = vi.fn(toolId => `/fake/bin/${toolId}`)
      const map = await resolveMap(dir, {
        env: {},
        nativeFn: () => fakeNative({ concerns: [{ key: 'fake/concern', scope: 'per-file', glob: [] }], tools: [] }),
        ensureToolFn
      })

      expect(ensureToolFn).not.toHaveBeenCalled()
      expect(map.get('fake/concern')).toEqual({ wasmPath: WASM_PATH, toolPaths: {} })
    })
  })
})
