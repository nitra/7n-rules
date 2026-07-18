/**
 * Публічний API для плагінів `@7n/rules` (експорт `@7n/rules/plugin-api`).
 *
 * Фаза 1 (spec 2026-07-18-lang-plugins-extraction): один порт — `EcosystemProvider`
 * для taze. Плагін реєструє провайдера через маніфест package.json:
 * `"n-rules": { "contributes": { "handlers": { "taze": "./taze/provider.mjs" } } }`;
 * модуль-обробник експортує обʼєкт провайдера як `default`. Наступні порти
 * (doc-files, lint) додаються окремими фазами — не проєктуються наперед.
 *
 * Semver-утиліти ядра реекспортуються звідси, щоб плагіни класифікували
 * major/minor за тим самим правилом caret-семантики, що й ядро, без
 * дублювання коду і без імпорту внутрішніх шляхів `@7n/rules`.
 */
export { isBreaking, parseVersion } from '../../skills/taze/js/diff.mjs'

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
