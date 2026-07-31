/**
 * Parity-тест wasm-плагіна `plugin-lang-js` (задача N2, спека
 * `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.5.5):
 * ганяє ОДНІ фікстури через чинні JS-детектори (`plugins/lang-js/rules/vue/
 * tfm-translations/main.mjs`, `plugins/lang-js/rules/style/gap/main.mjs` —
 * канонічні реалізації, Plugin API v2, НЕ видаляються) і через
 * `runWasmConcern` napi-мосту (`crates/rules-napi` → `crates/plugin-lang-js`),
 * звіряючи, що `violations` ідентичні (reason/message/file/severity
 * біт-у-біт). Це доводить конвеєр «wasm-компонент → napi-міст →
 * JS-diagnostics-форма», не замінює JS-канон.
 *
 * `vue/tfm-translations` фікстури дзеркалять
 * `plugins/lang-js/rules/vue/tfm-translations/tests/tfm-translations.test.mjs`.
 * `style/gap` фікстури дзеркалять `plugins/lang-js/rules/style/gap/tests/main.test.mjs`
 * — виклик БЕЗ `files` (`null`, доккомент `detect.mjs`) на обох боках:
 * JS-оригінал ігнорує `ctx.files` і сам ганяє `walkDir(cwd)` (full-scope,
 * `main.mjs`), `runWasmConcern` теж отримує `files: null` — саме це
 * доводить full-scope міст (задача N2 п.2): host (`crates/rules-napi
 * ::run_wasm_concern`) сам будує batch за `ConcernContribution::glob`
 * задекларованого `style/gap`, не JS-оркестрація.
 */
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, test } from 'vitest'

import { loadNative } from '../../native.mjs'
import { realRepoRoot, withTmpDir } from '../../../utils/test-helpers.mjs'

const REPO_ROOT = realRepoRoot()
const WASM_PATH = join(REPO_ROOT, 'target', 'wasm32-wasip2', 'release', 'plugin_lang_js.wasm')

if (!existsSync(WASM_PATH)) {
  throw new Error(
    `wasm-plugin-parity.test.mjs: wasm-компонент plugin-lang-js не зібраний: ${WASM_PATH} відсутній.\n` +
      'Зберіть його командою: bash crates/plugin-lang-js/build.sh'
  )
}

const TFM_MAIN_MJS_PATH = join(REPO_ROOT, 'plugins', 'lang-js', 'rules', 'vue', 'tfm-translations', 'main.mjs')
const GAP_MAIN_MJS_PATH = join(REPO_ROOT, 'plugins', 'lang-js', 'rules', 'style', 'gap', 'main.mjs')
const TFM_CONCERN_KEY = 'vue/tfm-translations'
const GAP_CONCERN_KEY = 'style/gap'

/**
 * Виставляє дефолт `severity: 'error'`, якщо ключ відсутній — точне дзеркало
 * severity-гілки `normalizeViolation` (`detect.mjs`): raw-вихід JS `lint()`
 * ОПУСКАЄ дефолтне поле (`createViolationReporter.fail` не виставляє ключ,
 * якщо `opts.severity` не передано), тоді як WIT `record diagnostic.severity`
 * не опційне — `rules_contract::Diagnostic` завжди серіалізує його. Обидві
 * форми валідні (та сама семантика «дефолт — error»), тому порівняння
 * `violations` тут — після приведення обох через ЦЕЙ САМИЙ normalize-крок,
 * що застосовує `runConcernDetector` у продакшн-диспетчеризації.
 * @param {unknown[]} violations сирі violations (JS чи wasm)
 * @returns {unknown[]} ті самі violations із заповненим `severity`
 */
function withDefaultSeverity(violations) {
  return violations.map(v => ({ severity: 'error', ...v }))
}

/**
 * Ганяє одну `.vue`-фікстуру `vue/tfm-translations` через JS-детектор
 * (канон) і `runWasmConcern` (wasm, per-file dispatch) і повертає обидва
 * `violations`-масиви (після [`withDefaultSeverity`]) для звірки.
 * @param {string} dir абсолютний шлях tmp-каталогу (містить `fileName`)
 * @param {string} fileName ім'я файлу у `dir`
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
async function runTfmBoth(dir, fileName) {
  // file:// URL — інакше відносний шлях трактується як bare package specifier (той самий
  // мотив, що в detect.mjs runConcernDetector); TFM_MAIN_MJS_PATH — фіксований абсолютний
  // шлях цього файлу (realRepoRoot() + константні сегменти), не вхід ззовні.
  // eslint-disable-next-line no-unsanitized/method
  const { lint } = await import(pathToFileURL(TFM_MAIN_MJS_PATH).href)
  const jsResult = await lint({ cwd: dir, ruleId: 'vue', concernId: 'tfm-translations', files: [fileName] })
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, TFM_CONCERN_KEY, dir, [fileName])
  return { js: withDefaultSeverity(jsResult.violations), wasm: withDefaultSeverity(wasmResult.violations) }
}

/**
 * Ганяє `style/gap` full-scope через JS-детектор (канон, ігнорує `ctx.files`,
 * сам ходить `walkDir(cwd)`) і `runWasmConcern` з `files: null` (full-scope
 * міст, доккомент модуля) — обидва бачать УСЕ дерево `dir`, не підмножину.
 * @param {string} dir абсолютний шлях tmp-каталогу з уже записаними фікстурами
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
async function runGapBoth(dir) {
  // eslint-disable-next-line no-unsanitized/method
  const { lint } = await import(pathToFileURL(GAP_MAIN_MJS_PATH).href)
  const jsResult = await lint({ cwd: dir, ruleId: 'style', concernId: 'gap', files: undefined })
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, GAP_CONCERN_KEY, dir, null)
  return { js: withDefaultSeverity(jsResult.violations), wasm: withDefaultSeverity(wasmResult.violations) }
}

describe('wasm-plugin parity — vue/tfm-translations (JS канон vs wasm plugin-lang-js)', () => {
  test('порушення: імпортує tf, але не оголошує getTr() → однакове violation з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'Page.vue'),
        "<script setup>\nimport { tf } from '@nitra/tfm'\nconst t = tf.bind({ tr: {} })\n</script>\n"
      )
      const { js, wasm } = await runTfmBoth(dir, 'Page.vue')
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('tfm-translations')
      expect(js[0].message).toContain('getTr')
    })
  })

  test('успіх: використовує tf і оголошує getTr() → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'Page.vue'),
        `<template>{{ t\`Клиенты\` }}</template>
<script setup>
import { lang, tf as tfm } from '@nitra/tfm'
const t = tfm.bind({ tr: getTr() })

function getTr() {
  return { Клиенты: { en: 'Customers' } }
}
</script>
`
      )
      const { js, wasm } = await runTfmBoth(dir, 'Page.vue')
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('успіх: не використовує @nitra/tfm взагалі → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Page.vue'), '<template><div /></template>\n<script setup></script>\n')
      const { js, wasm } = await runTfmBoth(dir, 'Page.vue')
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('успіх: імпортує з @nitra/tfm, але не саме tf → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Page.vue'), "<script setup>\nimport { lang } from '@nitra/tfm'\n</script>\n")
      const { js, wasm } = await runTfmBoth(dir, 'Page.vue')
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('не .vue файл → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'helper.mjs'), "import { tf } from '@nitra/tfm'\n")
      const { js, wasm } = await runTfmBoth(dir, 'helper.mjs')
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin parity — style/gap (JS канон vs wasm plugin-lang-js, full-scope міст)', () => {
  test('exit 0 — n-gap-md використано і визначено → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src/Row.vue'), '<template><div class="row n-gap-md" /></template>\n')
      await writeFile(join(dir, 'src/app.scss'), '.n-gap-md {\n  gap: 16px;\n}\n')
      const { js, wasm } = await runGapBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('exit 1 — n-gap-lg використано, але не визначено → однакове violation з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src/Row.vue'), '<template><div class="row n-gap-lg" /></template>\n')
      await writeFile(join(dir, 'src/app.scss'), '.n-gap-sm {\n  gap: 8px;\n}\n')
      const { js, wasm } = await runGapBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('missing-gap-style')
      expect(js[0].message).toContain('n-gap-lg')
    })
  })

  test('exit 0 — n-gap-* взагалі не використовується → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src/Row.vue'), '<template><div class="row q-gutter-md" /></template>\n')
      const { js, wasm } = await runGapBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})
