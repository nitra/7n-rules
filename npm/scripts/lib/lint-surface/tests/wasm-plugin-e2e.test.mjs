/**
 * E2E-тест wasm-dispatch у `runConcernDetector` (задача K фази 6, спека
 * `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.3): tmp-репо
 * з `.n-rules.json` (`wasmPlugins: [{ name, path: <зібраний .wasm> }]`) і
 * `.vue`-фікстурою з порушенням → `runConcernDetector` резолвить
 * `vue/tfm-translations` через wasm-мапу і повертає те саме violation, що й
 * JS-канон (той самий сценарій, що звіряє `wasm-plugin-parity.test.mjs`, тут
 * — крізь повний диспетчерський шлях `detect.mjs`, не напряму через napi).
 *
 * Останній describe-блок звіряє той самий шлях для канонічного `url`+`sha256`
 * піна (спека §3.4): `fetchFn`-стаб читає реальний `.wasm` plugin-lang-js через
 * `file://`-URL (node-`fetch` не вміє `file:`-схему — стаб замінює транспорт,
 * не сам retrieval-контур), sha256 — справжній хеш файлу.
 *
 * Передостанній describe-блок (задача Q1 батч 1, доповнено задачею Q3) звіряє
 * САМЕ dispatch-shadowing ЧЕРЕЗ вбудовану таблицю
 * `npm/wasm-plugins/builtin-pins.json` (`readBuiltinPinsConfig`, доккомент
 * `wasm-plugins.mjs`) — tmp-репо БЕЗ жодного `wasmPlugins` у `.n-rules.json`:
 * якщо `node npm/scripts/build-wasm-plugins.mjs` зібрав `plugin-lang-js`
 * локально, `runConcernDetector` для `style/admin_table` (regex-порт,
 * задача Q1) і `js/utils_imports` (справжній AST-концерн через `oxc_parser`,
 * задача Q3) МАЄ знайти violation через builtin-таблицю без ручного піна —
 * точна перевірка вимоги «живий shadowing-смок» для ОБОХ класів концернів.
 * Guard-описаний `existsSync(BUILTIN_PINS_PATH)` той самий skip-not-crash
 * мотив, що `wasm-builtin-pins.test.mjs`.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { runConcernDetector } from '../detect.mjs'
import { resetWasmConcernMapForTests } from '../wasm-plugins.mjs'
import { realRepoRoot, stagedWasmPath, withTmpDir } from '../../../utils/test-helpers.mjs'

const REPO_ROOT = realRepoRoot()
const WASM_PATH = stagedWasmPath('plugin-lang-js')
const BUILTIN_PINS_PATH = join(REPO_ROOT, 'npm', 'wasm-plugins', 'builtin-pins.json')
const hasBuiltinPins = existsSync(BUILTIN_PINS_PATH)


if (!hasBuiltinPins) {
  console.warn(
    `⚠️ wasm-plugin-e2e.test.mjs: builtin-shadowing describe-блок пропущено — ${BUILTIN_PINS_PATH} відсутній.\n` +
      'Зберіть локально: node npm/scripts/build-wasm-plugins.mjs'
  )
}

beforeEach(() => {
  resetWasmConcernMapForTests()
  // `path`-пін — DEV-форма: `resolveEntryPath` свідомо пропускає її під `CI`
  // (спека §3.4 — у CI дозволені лише `file`+`sha256` builtin і `url`+`sha256`).
  // Обидва describe-блоки нижче тестують САМЕ dev-форму, тож на GitHub Actions
  // вони давали `null` і падали фолбеком на неіснуючий `main.mjs`
  // (`DetectorError: немає main.mjs`, червоний гейт Test на main 2026-08-04).
  // Знімаємо `CI` на час цих тестів: сценарій «розробник із локально зібраним
  // .wasm» за визначенням поза CI, і саме його ці тести й описують. Так тест
  // однаково детермінований і локально, і на runner-і.
  vi.stubEnv('CI', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('runConcernDetector — wasm-dispatch (plugin contract v3, задача K)', () => {
  test('.n-rules.json з wasmPlugins + .vue-фікстура з порушенням → детекція йде в wasm, violation з ruleId/concernId', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({ rules: ['vue'], wasmPlugins: [{ name: 'lang-js', path: WASM_PATH }] }),
        'utf8'
      )
      await writeFile(
        join(dir, 'Page.vue'),
        "<script setup>\nimport { tf } from '@nitra/tfm'\nconst t = tf.bind({ tr: {} })\n</script>\n",
        'utf8'
      )
      const concern = { name: 'tfm-translations', dir: join(dir, 'rules', 'vue', 'tfm-translations') }
      const ctx = { cwd: dir, ruleId: 'vue', concernId: 'tfm-translations', files: ['Page.vue'] }

      const result = await runConcernDetector(concern, ctx)

      expect(result.violations).toEqual([
        {
          ruleId: 'vue',
          concernId: 'tfm-translations',
          reason: 'tfm-translations',
          message: expect.stringContaining('getTr'),
          severity: 'error',
          file: 'Page.vue'
        }
      ])
    })
  })

  test('.vue-фікстура без порушення → wasm-dispatch повертає порожні violations', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({ rules: ['vue'], wasmPlugins: [{ name: 'lang-js', path: WASM_PATH }] }),
        'utf8'
      )
      await writeFile(join(dir, 'Page.vue'), '<template><div /></template>\n<script setup></script>\n', 'utf8')
      const concern = { name: 'tfm-translations', dir: join(dir, 'rules', 'vue', 'tfm-translations') }
      const ctx = { cwd: dir, ruleId: 'vue', concernId: 'tfm-translations', files: ['Page.vue'] }

      const result = await runConcernDetector(concern, ctx)
      expect(result.violations).toEqual([])
    })
  })

  test('wasmPlugins вказує на неіснуючий .wasm → resolve-time skip-not-crash, concern падає на main.mjs', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({ rules: ['vue'], wasmPlugins: [{ name: 'ghost', path: './missing.wasm' }] }),
        'utf8'
      )
      // Concern-ключ НЕ 'vue/tfm-translations' — навмисно: builtin-таблиця first-party
      // пінів (задача O1, `wasm-plugins.mjs`) резолвиться з РЕАЛЬНОГО `npm/wasm-plugins/`
      // (`resolveWasmConcernMap(ctx.cwd)` тут викликається без `opts`, той самий контракт,
      // що продакшн `detect.mjs`), тож якщо розробник локально зібрав first-party плагіни
      // (`node npm/scripts/build-wasm-plugins.mjs`), 'vue/tfm-translations' резолвився б
      // через builtin lang-js НЕЗАЛЕЖНО від зламаного `ghost`-запису в `.n-rules.json`
      // (різні `name`, не перекриває — доккомент `mergeWithBuiltinEntries`), і тест
      // перестав би перевіряти саме fallback-гілку. Довільний ключ, якого жоден
      // first-party плагін не декларує, тримає сценарій детермінованим незалежно від
      // локального build-стану.
      const concernDir = join(dir, 'rules', 'vue', 'no-such-wasm-concern')
      const { mkdir } = await import('node:fs/promises')
      await mkdir(concernDir, { recursive: true })
      await writeFile(
        join(concernDir, 'main.mjs'),
        "export function lint() { return { violations: [{ reason: 'from-main-mjs-fallback', message: 'fallback' }] } }\n",
        'utf8'
      )
      const concern = { name: 'no-such-wasm-concern', dir: concernDir }
      const ctx = { cwd: dir, ruleId: 'vue', concernId: 'no-such-wasm-concern', files: ['Page.vue'] }

      const result = await runConcernDetector(concern, ctx)
      expect(result.violations[0].reason).toBe('from-main-mjs-fallback')
    })
  })
})

;(hasBuiltinPins ? describe : describe.skip)(
  'runConcernDetector — dispatch-shadowing через builtin-pins.json (задача Q1 батч 1, без ручного піна)',
  () => {
    test('style/admin_table: tmp-репо БЕЗ wasmPlugins у .n-rules.json → violation усе одно йде через builtin wasm-таблицю', async () => {
      await withTmpDir(async dir => {
        // Навмисно БЕЗ поля `wasmPlugins` — єдине джерело резолву тут
        // `npm/wasm-plugins/builtin-pins.json` (реальний, зібраний цим самим
        // прогоном `node npm/scripts/build-wasm-plugins.mjs`), не запис
        // консюмера.
        await writeFile(join(dir, '.n-rules.json'), JSON.stringify({ rules: ['style'] }), 'utf8')
        await writeFile(join(dir, 'Table.vue'), '<template><q-table class="n-admin-table" /></template>\n', 'utf8')
        await writeFile(join(dir, 'app.scss'), '.other { color: red; }\n', 'utf8')
        const concern = { name: 'admin_table', dir: join(dir, 'rules', 'style', 'admin_table') }
        const ctx = { cwd: dir, ruleId: 'style', concernId: 'admin_table', files: undefined }

        const result = await runConcernDetector(concern, ctx)

        expect(result.violations).toEqual([
          {
            ruleId: 'style',
            concernId: 'admin_table',
            reason: 'missing-admin-table-style',
            message: expect.stringContaining('n-admin-table'),
            severity: 'error'
          }
        ])
      })
    })

    test('test/location: tmp-репо БЕЗ wasmPlugins у .n-rules.json → violation усе одно йде через builtin wasm-таблицю', async () => {
      await withTmpDir(async dir => {
        await writeFile(join(dir, '.n-rules.json'), JSON.stringify({ rules: ['test'] }), 'utf8')
        const { mkdir } = await import('node:fs/promises')
        await mkdir(join(dir, 'rules/foo/bar'), { recursive: true })
        await writeFile(join(dir, 'rules/foo/bar/check.test.mjs'), 'import { test } from "vitest"\n', 'utf8')
        const concern = { name: 'location', dir: join(dir, 'rules', 'test', 'location') }
        const ctx = { cwd: dir, ruleId: 'test', concernId: 'location', files: undefined }

        const result = await runConcernDetector(concern, ctx)

        expect(result.violations).toEqual([
          {
            ruleId: 'test',
            concernId: 'location',
            reason: 'location',
            message: expect.stringContaining('rules/foo/bar/tests/check.test.mjs'),
            severity: 'error'
          }
        ])
      })
    })

    /**
     * Задача Q3 (`docs/specs/2026-08-01-wasm-ast-strategy.md`): перший
     * AST-концерн (справжній `oxc_parser`, не regex) через builtin-таблицю —
     * доводить, що dispatch-shadowing працює однаково для AST- і
     * regex-порту-концернів, не лише для тих, що вже покривали попередні
     * задачі.
     */
    test('js/utils_imports: tmp-репо БЕЗ wasmPlugins у .n-rules.json → AST-violation усе одно йде через builtin wasm-таблицю', async () => {
      await withTmpDir(async dir => {
        await writeFile(join(dir, '.n-rules.json'), JSON.stringify({ rules: ['js'] }), 'utf8')
        const { mkdir } = await import('node:fs/promises')
        await mkdir(join(dir, 'utils'), { recursive: true })
        await writeFile(
          join(dir, 'utils', 'bad.mjs'),
          "import { config } from '../lib/config.mjs'\nexport const x = config\n",
          'utf8'
        )
        const concern = { name: 'utils_imports', dir: join(dir, 'rules', 'js', 'utils_imports') }
        const ctx = { cwd: dir, ruleId: 'js', concernId: 'utils_imports', files: undefined }

        const result = await runConcernDetector(concern, ctx)

        expect(result.violations).toEqual([
          {
            ruleId: 'js',
            concernId: 'utils_imports',
            reason: 'utils_imports',
            message: expect.stringContaining('../lib/config.mjs'),
            severity: 'error'
          }
        ])
      })
    })
  }
)

describe('runConcernDetector — wasm-dispatch через url+sha256 (канонічний пін, спека §3.4 рішення Ж)', () => {
  test('file://-fetchFn-стаб + правильний sha256 → retrieval-контур завантажує/кешує і диспатч знаходить те саме violation', async () => {
    await withTmpDir(async dir => {
      const wasmBytes = readFileSync(WASM_PATH)
      const wasmSha256 = createHash('sha256').update(wasmBytes).digest('hex')
      const fileUrl = pathToFileURL(WASM_PATH).href

      await writeFile(
        join(dir, '.n-rules.json'),
        JSON.stringify({ rules: ['vue'], wasmPlugins: [{ name: 'lang-js', url: fileUrl, sha256: wasmSha256 }] }),
        'utf8'
      )
      await writeFile(
        join(dir, 'Page.vue'),
        "<script setup>\nimport { tf } from '@nitra/tfm'\nconst t = tf.bind({ tr: {} })\n</script>\n",
        'utf8'
      )

      // resolveWasmConcernMap за замовчуванням читає cacheDir/fetch з env/global (виклик-сайт
      // detect.mjs не передає opts — контракт виклику не міняємо) — тут ізолюємось через
      // N_RULES_PLUGIN_CACHE_DIR і vi.stubGlobal('fetch', …), той самий мотив, що
      // N_CURSOR_TOOL_CACHE_DIR у ensure-tool.mjs.
      const cacheDir = join(dir, '.cache-wasm-plugins')
      const prevCacheDirOverride = env['N_RULES_PLUGIN_CACHE_DIR']
      env['N_RULES_PLUGIN_CACHE_DIR'] = cacheDir
      // Node fetch не підтримує схему `file:` — стаб читає файл напряму й повертає
      // Response-подібний обʼєкт (той самий duck-typing контракт, що очікує wasm-plugins.mjs).
      const fetchStub = vi.fn(url =>
        Promise.resolve({
          ok: true,
          status: 200,
          arrayBuffer: () => Promise.resolve(readFileSync(fileURLToPath(url)))
        })
      )
      vi.stubGlobal('fetch', fetchStub)

      try {
        const concern = { name: 'tfm-translations', dir: join(dir, 'rules', 'vue', 'tfm-translations') }
        const ctx = { cwd: dir, ruleId: 'vue', concernId: 'tfm-translations', files: ['Page.vue'] }

        const result = await runConcernDetector(concern, ctx)

        expect(result.violations).toEqual([
          {
            ruleId: 'vue',
            concernId: 'tfm-translations',
            reason: 'tfm-translations',
            message: expect.stringContaining('getTr'),
            severity: 'error',
            file: 'Page.vue'
          }
        ])
        expect(fetchStub).toHaveBeenCalledWith(fileUrl)
        expect(existsSync(join(cacheDir, `${wasmSha256}.wasm`))).toBe(true)
      } finally {
        vi.unstubAllGlobals()
        if (prevCacheDirOverride === undefined) delete env['N_RULES_PLUGIN_CACHE_DIR']
        else env['N_RULES_PLUGIN_CACHE_DIR'] = prevCacheDirOverride
      }
    })
  })
})
