/**
 * Анти-дрейф-гейт: Go-верб `%q` у `.rego`-політиках, які виконує `regorus`
 * (реєстр `docs/plans/2026-08-05-open-questions-register.md` §2.76; знахідка —
 * §2.22, повтори — §2.66/§2.68/§2.69).
 *
 * Суть пастки. `sprintf("%q", s)` — легальний вербатив Go-шного `conftest`
 * (він же OPA), але `regorus` (Rust) його НЕ підтримує: політика падає HARD
 * RUNTIME ERROR у момент, коли концерн переїжджає з субпроцесу `conftest` на
 * host-import `rego-engine`. Тобто `%q` тихо живе роками і стає червоним рівно
 * в день порту — його вже ловили вручну ЧОТИРИ рази (§2.22 пʼять місць,
 * §2.66, §2.68 шість файлів, §2.69 одне). Ручний grep щоразу — вада процесу,
 * а не людей; цей гейт замінює його.
 *
 * Точна заміна — `%q` → `\"%v\"`: для звичайного рядка Go's `sprintf("%q", s)`
 * дає рівно `"` + s + `"`, тож видимий текст повідомлення не змінюється ані під
 * `conftest`, ані під `regorus` (доведено прогоном обох форм на одному вході,
 * §2.76).
 *
 * Чому гейт НЕ глобальна заборона `%q` по всьому репо. Під `conftest` верб
 * цілком легальний, і політики, які `regorus` ніколи не бачить
 * (`npm/rules/**` ядра, `plugins/lang-php`, `plugins/lang-python`,
 * `plugins/lang-rust`), мають повне право його вживати. Глобальна заборона
 * червонила б їх на рівному місці — і її б вимкнули. Тому джерело істини —
 * ЯВНИЙ перелік [`REGORUS_POLICY_PLUGINS`] нижче.
 *
 * Три властивості, без яких гейт створював би хибну впевненість замість гарантії
 * (мовчазний skip = вада, `push_rego_engine_error`-мотив реєстру):
 *
 *  1. кожен запис переліку МУСИТЬ вказувати на існуючу теку з ≥1 `.rego` —
 *     інакше одруківка в імені плагіна перетворює гейт на no-op, який
 *     «зелений» і нічого не сканує;
 *  2. будь-який крейт, що заявляє залежність `rules-rego-engine` і НЕ
 *     перелічений як відомий консюмер, валить гейт — так наступний плагін
 *     (чи `rules-core`), який перейде на `regorus`, не проскочить повз перелік
 *     мовчки;
 *  3. рядки-коментарі (`#`) зі скану виключені свідомо — `%q` у ci-azure й
 *     ci-github живе саме в доккоментах, що ПОЯСНЮЮТЬ цю заміну, і гейт, який
 *     червонить власну документацію, теж довго не проживе.
 *
 * Цей гейт ловить ОДНУ конкретну несумісність (`%q`), а не всі. Другий,
 * взаємодоповнювальний, живе на боці гостя: `cargo test -p plugin-lang-js`
 * (`vsi_shist_rego_polityk_evaliuiutsia_pid_regorus`) реально КОМПІЛЮЄ І
 * ЕВАЛЮЄ кожну вшиту політику через `rules-rego-engine` in-process. Саме він
 * знайшов третю пастку класу (§2.78): безтілий факт `f("літерал")` —
 * легальний для Go-шного OPA/conftest, HARD-помилка компіляції в `regorus`.
 * Формулювати її як текстовий скан безглуздо, а прогін двигуна ловить
 * КОЖНУ таку несумісність, включно з ще не відомими.
 */
import { describe, expect, test } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { realRepoRoot } from '../scripts/utils/test-helpers.mjs'

/**
 * Плагіни, чиї `.rego`-політики виконуються (або ось-ось виконуватимуться)
 * через `regorus` — ЄДИНЕ джерело істини скоупу гейта. Ключ — тека в
 * `plugins/`, значення — підстава, чому саме цей плагін тут.
 *
 * Плагін попадає сюди в один із двох моментів: коли його гість реально
 * підключив `rego-engine`, АБО коли зачистку `%q` зроблено наперед як
 * передумову порту (тоді запис фіксує вимогу до того, як вона стане
 * рантайм-помилкою). Вихід звідси не передбачений: назад на `conftest`
 * концерни не їдуть.
 */
const REGORUS_POLICY_PLUGINS = {
  'ci-github': 'wasm-гість `crates/plugin-ci-github` рахує rego через host-import `rego-engine` (§2.66/§2.68)',
  'ci-azure': 'wasm-гість `crates/plugin-ci-azure` — той самий host-import із самого початку (§2.69)',
  'lang-js':
    'wasm-гість `crates/plugin-lang-js` рахує rego через host-import `rego-engine` — шість політик родини `vscode_extensions`/`package_json` (§2.78; `%q` прибрано наперед, §2.76)'
}

/**
 * Крейти, яким залежність `rules-rego-engine` дозволена без запису в
 * [`REGORUS_POLICY_PLUGINS`]. Не «виняток заради зручності», а два різні
 * випадки: хост САМ реалізує імпорт (політик не має), а сам двигун — це він і є.
 */
const NON_POLICY_REGO_ENGINE_CRATES = new Set(['rules-plugin-host', 'rules-rego-engine'])

/** Крейти-гості, чия залежність `rules-rego-engine` вже покрита переліком вище. */
const KNOWN_POLICY_REGO_ENGINE_CRATES = new Set(['plugin-ci-github', 'plugin-ci-azure', 'plugin-lang-js'])

/**
 * Рекурсивно збирає `.rego`-файли теки.
 * @param {string} dir абсолютний шлях теки
 * @returns {string[]} абсолютні шляхи знайдених `.rego`
 */
function collectRegoFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectRegoFiles(full))
    else if (entry.isFile() && entry.name.endsWith('.rego')) out.push(full)
  }
  return out
}

/**
 * Знаходить `%q` у некоментарних рядках файлу.
 * @param {string} file абсолютний шлях `.rego`
 * @param {string} root корінь монорепо (для читабельних шляхів у помилці)
 * @returns {string[]} рядки вигляду `шлях:номер: текст`
 */
function findForbiddenVerb(file, root) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line, index) => ({ line, no: index + 1 }))
    .filter(({ line }) => !line.trimStart().startsWith('#') && line.includes('%q'))
    .map(({ line, no }) => `${relative(root, file)}:${no}: ${line.trim()}`)
}

describe('гейт `%q` у rego-політиках під regorus', () => {
  const root = realRepoRoot()
  const plugins = Object.keys(REGORUS_POLICY_PLUGINS)

  test.each(plugins)('%s: тека політик існує і містить .rego (гейт справді щось сканує)', name => {
    const dir = join(root, 'plugins', name, 'rules')
    expect(existsSync(dir) && statSync(dir).isDirectory(), `немає теки ${dir}`).toBe(true)
    expect(collectRegoFiles(dir).length, `у ${dir} немає жодного .rego`).toBeGreaterThan(0)
  })

  // Звичайний цикл, а НЕ `test.each`: його printf-шаблон рендерив `%%q` як
  // «% undefinedq» — гейт, чия власна назва зіпсована рівно тим символом,
  // який він шукає, підриває саму мету «сигналити яскраво».
  for (const name of plugins) {
    test(`${name}: жодного \`%q\` — regorus такого не вміє`, () => {
      const dir = join(root, 'plugins', name, 'rules')
      const hits = collectRegoFiles(dir).flatMap(file => findForbiddenVerb(file, root))
      expect(
        hits,
        [
          `\`%q\` у політиках плагіна \`${name}\`, які виконує regorus (${REGORUS_POLICY_PLUGINS[name]}).`,
          'regorus не підтримує цей Go-верб — це помилка РАНТАЙМУ, не попередження.',
          'Заміна, еквівалентна біт-у-біт для рядкового аргументу: `%q` → `\\"%v\\"`.',
          ...hits
        ].join('\n')
      ).toEqual([])
    })
  }

  test('новий консюмер `rules-rego-engine` не проскакує повз перелік', () => {
    const cratesDir = join(root, 'crates')
    const unlisted = readdirSync(cratesDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .filter(entry => {
        const manifest = join(cratesDir, entry.name, 'Cargo.toml')
        if (!existsSync(manifest)) return false
        return /^\s*rules-rego-engine\s*=/mu.test(readFileSync(manifest, 'utf8'))
      })
      .map(entry => entry.name)
      .filter(name => !NON_POLICY_REGO_ENGINE_CRATES.has(name) && !KNOWN_POLICY_REGO_ENGINE_CRATES.has(name))

    expect(
      unlisted,
      [
        'Крейт оголосив залежність `rules-rego-engine`, але не значиться серед відомих консюмерів.',
        'Це означає, що його rego тепер рахує regorus — додай відповідний плагін у',
        '`REGORUS_POLICY_PLUGINS` (і крейт у `KNOWN_POLICY_REGO_ENGINE_CRATES`), або,',
        'якщо крейт політик не має, — у `NON_POLICY_REGO_ENGINE_CRATES`.',
        ...unlisted
      ].join('\n')
    ).toEqual([])
  })

  test('відомі консюмери двигуна не зникли (перелік не протух у зворотний бік)', () => {
    const cratesDir = join(root, 'crates')
    for (const name of KNOWN_POLICY_REGO_ENGINE_CRATES) {
      const manifest = join(cratesDir, name, 'Cargo.toml')
      expect(existsSync(manifest), `немає ${manifest}`).toBe(true)
      expect(/^\s*rules-rego-engine\s*=/mu.test(readFileSync(manifest, 'utf8')), `${name} більше не залежить від rules-rego-engine`).toBe(true)
    }
  })
})
