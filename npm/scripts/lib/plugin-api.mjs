/**
 * Публічний API для плагінів `@7n/rules` (експорт `@7n/rules/plugin-api`).
 *
 * Фаза 1 (spec 2026-07-18-lang-plugins-extraction): один порт — `EcosystemProvider`
 * для taze. Плагін реєструє провайдера через маніфест package.json:
 * `"n-rules": { "contributes": { "handlers": { "taze": "./taze/provider.mjs" } } }`;
 * модуль-обробник експортує обʼєкт провайдера як `default`. Наступні порти
 * (doc-files, lint) додаються окремими фазами — не проєктуються наперед.
 *
 * Semver-утиліти (caret-класифікація major/minor) живуть саме тут — єдине
 * джерело правила для всіх мовних плагінів, без імпорту внутрішніх шляхів
 * `@7n/rules` і без циклу plugin-api ↔ плагін.
 */
// Заякорено на початок (після можливих range-операторів `^~>=<`, пробілів, `v`),
// щоб НЕ ловити версію всередині protocol-specifier-ів (`workspace:1.0.0`, `npm:x@1.2.3`).
const SEMVER_RE = /^[\s~^>=<v]*(\d+)\.(\d+)\.(\d+)/

/**
 * Парсить semver-ядро зі specifier-а (ігнорує range-префікси `^`/`~`/`>=` тощо).
 * @param {string} spec версійний specifier із package.json
 * @returns {{major:number, minor:number, patch:number}|null} ядро або null для не-semver (`workspace:*`, git-url, `*`)
 */
export function parseVersion(spec) {
  if (typeof spec !== 'string') return null
  const m = SEMVER_RE.exec(spec)
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

/**
 * Чи є перехід `from → to` breaking за caret-семантикою (змінилась найлівіша
 * ненульова компонента).
 * @param {{major:number,minor:number,patch:number}} from стара версія
 * @param {{major:number,minor:number,patch:number}} to нова версія
 * @returns {boolean} true — major/breaking
 */
export function isBreaking(from, to) {
  if (from.major !== to.major) return true
  if (from.major > 0) return false
  if (from.minor !== to.minor) return true
  if (from.minor > 0) return false
  return from.patch !== to.patch
}

/** Версія контракту plugin-api: плагін декларує `requiresPluginApi`, несумісність → skip, не креш. */
export const PLUGIN_API_VERSION = 1

/**
 * @typedef {(cmd: string, args: string[], opts?: object) => { status: number|null, stdout: string, stderr: string }} SpawnFn
 * Сумісний зі `spawnSync` виклик зовнішньої команди (інжектовний у тестах).
 */

/**
 * @typedef {object} EcosystemAvailability
 * @property {boolean} ok чи доступний тулчейн екосистеми (напр. `uv --version` → exit 0)
 * @property {string|null} reason зрозуміла людині причина недоступності для звіту (null, якщо ok)
 */

/**
 * @typedef {object} EcosystemProvider
 * Порт однієї екосистеми залежностей для taze-оркестратора. Ядро викликає методи
 * в порядку: `detect` → (`available`) → `backup` → `bump` → `diff` → по кожному
 * major-запису `promptFor` → `cleanup`. Провал `bump`/`diff` одного провайдера
 * не зупиняє інших.
 * @property {string} id стабільний ідентифікатор (напр. `python-uv`)
 * @property {string} title заголовок секції звіту (напр. `Python-пакети (uv)`)
 * @property {string} manifestNoun назва маніфеста для звіту (напр. `pyproject.toml`)
 * @property {string} skillSection посилання на ручну гілку SKILL.md у звіті-skip (напр. `Python-гілкою SKILL.md`)
 * @property {(cwd: string, deps: { spawnFn: SpawnFn }) => string[]} detect відносні шляхи знайдених маніфестів (порожньо → екосистеми в проєкті немає, тиша у звіті)
 * @property {(spawnFn: SpawnFn) => EcosystemAvailability} available чи встановлений тулчейн; `ok:false` → graceful skip із `reason` у звіті
 * @property {(cwd: string, manifests: string[], deps: object) => Promise<void>} backup бекап маніфестів/lock-файлів (`<file>.taze-bak`)
 * @property {(cwd: string, manifests: string[], ctx: { spawnFn: SpawnFn, log: (line: string) => void, deps: object }) => Promise<void>} bump масовий bump до latest (включно з major)
 * @property {(cwd: string, manifests: string[], deps: object) => Promise<{major: Array<{manifest: string, pkg: string, from: string, to: string}>, minorPatch: number, totalChanged: number}>} diff детермінована класифікація major vs minor/patch (бекап vs поточний)
 * @property {(entry: {manifest: string, pkg: string, from: string, to: string}) => string} promptFor промпт одного ізольованого виклику раннера для одного major-запису
 * @property {(cwd: string, manifests: string[], deps: object) => Promise<void>} cleanup прибирання бекапів
 */

const REQUIRED_PROVIDER_FUNCTIONS = ['detect', 'available', 'backup', 'bump', 'diff', 'promptFor', 'cleanup']
const REQUIRED_PROVIDER_STRINGS = ['id', 'title', 'manifestNoun', 'skillSection']

/**
 * @typedef {object} CoverageRow
 * Агрегований вимір однієї області (`JS`, `Vue (Storybook)`, `Rust`, …).
 * @property {string} area назва рядка звіту
 * @property {{lines:{covered:number,total:number}, functions:{covered:number,total:number}}} coverage line/function coverage
 * @property {{caught:number, total:number}} mutation вбиті/всі мутанти (0/0 — мутаційне тестування не вимірювалось)
 * @property {Array<{file:string, mutants:Array<object>, exampleTest?:object|null, recommendationText?:string|null}>} survived вцілілі мутанти по файлах (шляхи relative до cwd)
 */

/**
 * @typedef {object} CoverageProvider
 * Порт мовної екосистеми для концерну `coverage` правила `test` (spec
 * 2026-07-22 absorb-7n-test). Ядро викликає: `detect` → повний вимір
 * `collect` (full/`lint test`) АБО делта-вимір `collectPerFile` (делта-lint,
 * без мутаційного тестування). Реєстрація — `contributes.handlers.coverage`
 * у маніфесті плагіна, default-експорт handler-модуля.
 * @property {string} id стабільний ідентифікатор екосистеми (напр. `js`)
 * @property {string} title заголовок для звітів/повідомлень
 * @property {(cwd: string) => Promise<boolean>} detect чи застосовний вимір у проєкті (false → тихий skip виміру)
 * @property {(cwd: string, opts?: {changedFiles?: string[], base?: string|null, runner?: object}) => Promise<CoverageRow[]>} collect повний вимір: coverage + мутаційне тестування по всіх workspaces
 * @property {(cwd: string, opts: {files: string[], runner?: object}) => Promise<Array<{file:string, pct:number, linesFound:number, linesCovered:number, reason?:string}>>} collectPerFile легкий делта-вимір per-file line coverage змінених файлів (без мутаційного тестування)
 */

const REQUIRED_COVERAGE_FUNCTIONS = ['detect', 'collect', 'collectPerFile']
const REQUIRED_COVERAGE_STRINGS = ['id', 'title']

/**
 * Валідує форму coverage-провайдера з модуля плагіна.
 * @param {unknown} candidate default-експорт handler-модуля плагіна
 * @param {string} source ім'я плагіна/шлях модуля для повідомлення
 * @returns {CoverageProvider} той самий обʼєкт, якщо валідний
 */
export function assertCoverageProvider(candidate, source) {
  if (!candidate || typeof candidate !== 'object') {
    throw new TypeError(`plugin-api: ${source} — default-експорт не є обʼєктом CoverageProvider`)
  }
  const missing = [
    ...REQUIRED_COVERAGE_STRINGS.filter(k => typeof candidate[k] !== 'string' || candidate[k] === ''),
    ...REQUIRED_COVERAGE_FUNCTIONS.filter(k => typeof candidate[k] !== 'function')
  ]
  if (missing.length > 0) {
    throw new TypeError(`plugin-api: ${source} — CoverageProvider без обовʼязкових полів: ${missing.join(', ')}`)
  }
  return /** @type {CoverageProvider} */ (candidate)
}

/**
 * Валідує форму провайдера з модуля плагіна — зрозуміла помилка замість
 * «undefined is not a function» глибоко в оркестраторі.
 * @param {unknown} candidate default-експорт handler-модуля плагіна
 * @param {string} source ім'я плагіна/шлях модуля для повідомлення
 * @returns {EcosystemProvider} той самий обʼєкт, якщо валідний
 */
export function assertEcosystemProvider(candidate, source) {
  if (!candidate || typeof candidate !== 'object') {
    throw new TypeError(`plugin-api: ${source} — default-експорт не є обʼєктом EcosystemProvider`)
  }
  const missing = [
    ...REQUIRED_PROVIDER_STRINGS.filter(k => typeof candidate[k] !== 'string' || candidate[k] === ''),
    ...REQUIRED_PROVIDER_FUNCTIONS.filter(k => typeof candidate[k] !== 'function')
  ]
  if (missing.length > 0) {
    throw new TypeError(`plugin-api: ${source} — EcosystemProvider без обовʼязкових полів: ${missing.join(', ')}`)
  }
  return /** @type {EcosystemProvider} */ (candidate)
}
