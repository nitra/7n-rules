/**
 * Mirror-тест вбудованої таблиці first-party wasm-пінів `npm/wasm-plugins/
 * builtin-pins.json` (задача O1 фази 6 v2, рішення Н спеки
 * `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.4) — за
 * зразком `native-packages.test.mjs`: звіряє, що таблиця, яку
 * `build-wasm-plugins.mjs` генерує локально/в CI, узгоджена сама з собою
 * (sha256 файлу поряд) і з рантайм-маніфестом плагіна (`wasmPluginManifest()`,
 * `crates/rules-napi`) — контрибуції (`manifest.concerns[].key`) саме ті, що
 * очікує dispatch-shadowing доккомент `wasm-plugins.mjs` (`lang-js` →
 * `vue/tfm-translations` + `style/gap`, ⊆ `plugin.toml` цього ж плагіна).
 * Форма самих `violations` (biт-у-біт консистентність wasm ⇄ JS-канон
 * `plugins/lang-js`) — окремий `wasm-plugin-parity.test.mjs`, тут не
 * дублюється.
 *
 * Потребує локальної збірки (`node npm/scripts/build-wasm-plugins.mjs`) —
 * дозволений виняток (як `wasm-plugins.test.mjs`/`wasm-plugin-parity.test.mjs`):
 * без неї весь набір пропускається (`describe.skip`) з `console.warn`, не
 * падає.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { realRepoRoot } from '../../utils/test-helpers.mjs'
import { loadNative } from '../native.mjs'

const REPO_ROOT = realRepoRoot()
const WASM_PLUGINS_DIR = join(REPO_ROOT, 'npm', 'wasm-plugins')
const PINS_PATH = join(WASM_PLUGINS_DIR, 'builtin-pins.json')
const hasBuild = existsSync(PINS_PATH)

/**
 * Контрибуції, які `plugin-lang-js` (`crates/plugin-lang-js/plugin.toml`)
 * декларує сьогодні — дзеркало для звірки з рантайм-маніфестом нижче.
 * Задача Q1 батч 1 додала пʼять концернів понад початкові
 * `vue/tfm-translations`/`style/gap` (задача N2); задача Q2 батч 2 додала ще
 * два (`test/no-console-store-restore`, `test/no-bun-test-import` —
 * справжній 1:1 порт); задача Q3 додала ще два (`js/utils_imports`,
 * `test/no-relative-fs-path` — справжні AST-концерни через `oxc_parser`,
 * `docs/specs/2026-08-01-wasm-ast-strategy.md`); задача Q4 батч 4 додала
 * останні три (`js-bun-redis/imports`, `js-mssql/deps`, `js-bun-db/safety` —
 * теж справжні AST-концерни: де-скоуп батчу 2 знято, regex-groundwork
 * замінено AST-портом, доккомент `crates/plugin-lang-js/src/lib.rs` секція
 * «Батч 4»).
 * @type {string[]}
 */
const EXPECTED_LANG_JS_CONCERNS = [
  'vue/tfm-translations',
  'style/gap',
  'test/vitest-config-pool-forks',
  'test/no-process-chdir',
  'style/admin_table',
  'style/quasar_fixes',
  'test/location',
  'test/no-console-store-restore',
  'test/no-bun-test-import',
  'js/utils_imports',
  'test/no-relative-fs-path',
  'js-bun-redis/imports',
  'js-mssql/deps',
  'js-bun-db/safety'
]

/** Валідний sha256-hex — той самий канон, що `SHA256_HEX_RE` у `wasm-plugins.mjs` (module-scope, без пере-компіляції на кожен виклик). */
const SHA256_HEX_RE = /^[0-9a-f]{64}$/

if (!hasBuild) {
  console.warn(
    `⚠️ wasm-builtin-pins.test.mjs: набір пропущено — ${PINS_PATH} відсутній.\n` +
      'Зберіть локально: node npm/scripts/build-wasm-plugins.mjs'
  )
}

;(hasBuild ? describe : describe.skip)('builtin-pins.json — консистентність вбудованої таблиці (задача O1)', () => {
  /** @type {Record<string, { file: string, sha256: string }>} */
  const pins = hasBuild ? JSON.parse(readFileSync(PINS_PATH, 'utf8')) : {}

  test('таблиця непорожня і містить запис "lang-js"', () => {
    expect(Object.keys(pins).length).toBeGreaterThan(0)
    expect(pins).toHaveProperty('lang-js')
  })

  for (const [name, entry] of Object.entries(pins)) {
    describe(`плагін "${name}"`, () => {
      test('запис має валідну форму {file, sha256 (64 hex)}', () => {
        expect(typeof entry.file).toBe('string')
        expect(entry.sha256).toMatch(SHA256_HEX_RE)
      })

      test('файл існує поряд з builtin-pins.json', () => {
        expect(existsSync(join(WASM_PLUGINS_DIR, entry.file))).toBe(true)
      })

      test('sha256 у таблиці збігається з реальним вмістом файлу (захист від пошкодженої інсталяції)', () => {
        const bytes = readFileSync(join(WASM_PLUGINS_DIR, entry.file))
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256)
      })

      test('манифест плагіна читається napi-мостом; контрибуції — ті, що очікує dispatch-shadowing', () => {
        const wasmPath = join(WASM_PLUGINS_DIR, entry.file)
        const manifest = loadNative().wasmPluginManifest(wasmPath)
        const keys = (manifest.concerns ?? []).map(c => c.key).toSorted()
        if (name === 'lang-js') {
          // Точний збіг (не лише ⊆): якщо `plugin.toml` додасть/забере контрибуцію
          // без оновлення цього тесту, розсинхрон має впасти тут, а не мовчки
          // пройти повз dispatch-shadowing доккомент `wasm-plugins.mjs`.
          expect(keys).toEqual(EXPECTED_LANG_JS_CONCERNS.toSorted())
        } else {
          expect(keys.length).toBeGreaterThan(0)
        }
      })
    })
  }
})
