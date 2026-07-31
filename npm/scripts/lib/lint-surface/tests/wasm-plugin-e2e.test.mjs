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
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { beforeEach, describe, expect, test, vi } from 'vitest'

import { runConcernDetector } from '../detect.mjs'
import { resetWasmConcernMapForTests } from '../wasm-plugins.mjs'
import { realRepoRoot, withTmpDir } from '../../../utils/test-helpers.mjs'

const REPO_ROOT = realRepoRoot()
const WASM_PATH = join(REPO_ROOT, 'target', 'wasm32-wasip2', 'release', 'plugin_lang_js.wasm')

if (!existsSync(WASM_PATH)) {
  throw new Error(
    `wasm-plugin-e2e.test.mjs: wasm-компонент plugin-lang-js не зібраний: ${WASM_PATH} відсутній.\n` +
      'Зберіть його командою: bash crates/plugin-lang-js/build.sh'
  )
}

beforeEach(() => {
  resetWasmConcernMapForTests()
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
      const concernDir = join(dir, 'rules', 'vue', 'tfm-translations')
      const { mkdir } = await import('node:fs/promises')
      await mkdir(concernDir, { recursive: true })
      await writeFile(
        join(concernDir, 'main.mjs'),
        "export function lint() { return { violations: [{ reason: 'from-main-mjs-fallback', message: 'fallback' }] } }\n",
        'utf8'
      )
      const concern = { name: 'tfm-translations', dir: concernDir }
      const ctx = { cwd: dir, ruleId: 'vue', concernId: 'tfm-translations', files: ['Page.vue'] }

      const result = await runConcernDetector(concern, ctx)
      expect(result.violations[0].reason).toBe('from-main-mjs-fallback')
    })
  })
})

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
      const fetchStub = vi.fn(async url => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => readFileSync(fileURLToPath(url))
      }))
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
