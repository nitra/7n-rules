/**
 * Дзеркальний тест версій `oxc-parser` (npm) ⇄ `oxc_*` (Rust, crates.io) —
 * задача Q3, `docs/specs/2026-08-01-wasm-ast-strategy.md`, розділ «Рішення»
 * п.1: спайк S1 підтвердив, що `oxc-parser` на npm і `oxc_parser` на
 * crates.io — той самий репозиторій `oxc-project/oxc`, той самий тег
 * релізу (`cargo info oxc_parser@0.137.0` збігається з
 * `npm/package.json:dependencies.oxc-parser`), але синхронізація версій НЕ
 * автоматична (npm-пін оновлюється через `taze`, Rust-пін — вручну через
 * `Cargo.lock`) — цей тест ламає дельта-лінт, якщо піни розійдуться, за
 * зразком прецеденту такого роду перевірок (`wasm-plugin-parity.test.mjs`,
 * поруч).
 *
 * Byte-exact parity `js/utils_imports`/`test/no-relative-fs-path`
 * (`crates/plugin-lang-js/src/lib.rs`) залежить від ТОГО САМОГО движка
 * (`oxc_parser`) з обох боків — тихий дрейф версій міг би дати непомітну
 * розбіжність AST-обходу на реальних (не лише синтетичних) фікстурах.
 *
 * Парсинг тут навмисно БЕЗ regex (просте розбиття рядків/лапок) — і
 * `Cargo.toml`, і `dependencies["oxc-parser"]` мають тривіальну, наперед
 * відому форму, regex тут був би over-engineering (і, як з'ясувалось,
 * лінтер `sonarjs/super-linear-regex` не в захваті від навіть простих
 * `\d+\.\d+\.\d+`-патернів на цю тему).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { realRepoRoot } from '../../../utils/test-helpers.mjs'

const REPO_ROOT = realRepoRoot()
const NPM_PACKAGE_JSON_PATH = join(REPO_ROOT, 'npm', 'package.json')
const PLUGIN_LANG_JS_CARGO_TOML_PATH = join(REPO_ROOT, 'crates', 'plugin-lang-js', 'Cargo.toml')

/**
 * Прибирає з `range` (напр. `^0.137.0`, `~0.137.0`, `0.137.0`) усе до першої
 * цифри — простий range-префікс, який використовує `npm/package.json`.
 * @param {string} range сира декларація версії з `package.json`
 * @returns {string | null} `X.Y.Z...` або `null`, якщо цифр немає взагалі
 */
function stripRangePrefix(range) {
  const chars = [...range]
  const start = chars.findIndex(ch => ch >= '0' && ch <= '9')
  return start === -1 ? null : chars.slice(start).join('')
}

/**
 * Чи `s` — валідний `X.Y.Z` (три числові компоненти, кожен непорожній,
 * лише цифри) — без regex, посимвольна перевірка.
 * @param {string} s кандидат
 * @returns {boolean} true, якщо форма коректна
 */
function isSemver(s) {
  const parts = s.split('.')
  if (parts.length !== 3) return false
  return parts.every(part => part.length > 0 && [...part].every(ch => ch >= '0' && ch <= '9'))
}

/**
 * Чи `name` — валідне ім'я Rust-крейта родини `oxc_*` (snake_case).
 * @param {string} name кандидат
 * @returns {boolean} true, якщо це `oxc_`-крейт
 */
function isOxcCrateName(name) {
  if (!name.startsWith('oxc_')) return false
  return [...name].every(ch => (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch === '_')
}

/**
 * Один `oxc_*`-рядок `[dependencies]` у `Cargo.toml`: `oxc_parser = "=0.137.0"`.
 * @typedef {{ crate: string, exact: boolean, version: string }} CargoOxcPin
 */

/**
 * Читає всі `oxc_*`-піни з `[dependencies]` `Cargo.toml` (рядковий розбір,
 * без TOML-парсера — той самий формат, що вже парсить `build.sh` цього
 * плагіна для `PKG_NAME` через `grep`).
 * @param {string} path абсолютний шлях до `Cargo.toml`
 * @returns {CargoOxcPin[]} усі знайдені `oxc_*`-піни
 */
function readCargoOxcPins(path) {
  const text = readFileSync(path, 'utf8')
  /** @type {CargoOxcPin[]} */
  const pins = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    const eqIdx = line.indexOf('=')
    if (eqIdx === -1) continue
    const crate = line.slice(0, eqIdx).trim()
    if (!isOxcCrateName(crate)) continue

    const afterEq = line.slice(eqIdx + 1).trim()
    if (!afterEq.startsWith('"')) continue
    const closeIdx = afterEq.indexOf('"', 1)
    if (closeIdx === -1) continue
    const rawValue = afterEq.slice(1, closeIdx)

    const exact = rawValue.startsWith('=')
    const version = exact ? rawValue.slice(1) : rawValue
    if (!isSemver(version)) continue
    pins.push({ crate, exact, version })
  }
  return pins
}

describe('oxc-version-pin — npm oxc-parser ⇄ Rust oxc_* (задача Q3, byte-exact parity AST-концернів)', () => {
  test('npm/package.json:dependencies.oxc-parser — валідний semver', () => {
    const pkg = JSON.parse(readFileSync(NPM_PACKAGE_JSON_PATH, 'utf8'))
    expect(pkg.dependencies).toHaveProperty('oxc-parser')
    const npmVersion = stripRangePrefix(pkg.dependencies['oxc-parser'])
    expect(npmVersion).not.toBeNull()
    expect(isSemver(npmVersion ?? '')).toBe(true)
  })

  test('crates/plugin-lang-js/Cargo.toml декларує ХОЧА Б ОДИН oxc_*-пін (не порожній список — інакше парсер розійшовся з реальним форматом файлу)', () => {
    const pins = readCargoOxcPins(PLUGIN_LANG_JS_CARGO_TOML_PATH)
    expect(pins.length).toBeGreaterThan(0)
    // Мінімум — чотири крейти з розділу «Рішення» п.1 спеки.
    const names = pins.map(pin => pin.crate)
    for (const expected of ['oxc_parser', 'oxc_ast', 'oxc_allocator', 'oxc_span']) {
      expect(names).toContain(expected)
    }
  })

  test('усі oxc_*-піни в Cargo.toml — ТОЧНА версія (=X.Y.Z), не caret-діапазон', () => {
    const pins = readCargoOxcPins(PLUGIN_LANG_JS_CARGO_TOML_PATH)
    for (const pin of pins) {
      expect(pin.exact, `${pin.crate}: пін має бути точний ("=${pin.version}"), не caret-діапазон`).toBe(true)
    }
  })

  test('усі oxc_*-піни в Cargo.toml збігаються версією з npm oxc-parser (дрейф — фейл із зрозумілим повідомленням)', () => {
    const pkg = JSON.parse(readFileSync(NPM_PACKAGE_JSON_PATH, 'utf8'))
    const npmRaw = pkg.dependencies['oxc-parser']
    const npmVersion = stripRangePrefix(npmRaw)
    expect(npmVersion, 'npm/package.json:dependencies.oxc-parser не містить валідного semver').toBeTruthy()

    const pins = readCargoOxcPins(PLUGIN_LANG_JS_CARGO_TOML_PATH)
    for (const pin of pins) {
      expect(
        pin.version,
        `crates/plugin-lang-js/Cargo.toml: ${pin.crate} = "=${pin.version}" розійшовся з ` +
          `npm/package.json:dependencies.oxc-parser = "${npmRaw}" (очікувалось ${npmVersion}) — ` +
          'byte-exact parity AST-концернів (js/utils_imports, test/no-relative-fs-path) вимагає ' +
          'ТОГО САМОГО движка з обох боків, синхронізуй піни разом ' +
          '(docs/specs/2026-08-01-wasm-ast-strategy.md, розділ «Рішення» п.1)'
      ).toBe(npmVersion)
    }
  })
})
