/**
 * Перевірка для проєктів, що залежать від нативного `.node`-аддона, який вантажиться через
 * **динамічний `require`** (передусім **sharp**; той самий клас — `@img/*`, `argon2`).
 *
 * Такі аддони **не можна** пакувати через `bun build --compile`: компілятор не трейсить
 * динамічний `require(\`@img/sharp-${platform}/sharp.node\`)` і не вшиває нативний біндинг, тож
 * компільований бінарник падає в рантаймі (`Could not load the "sharp" module using the
 * linuxmusl-arm64 runtime`). Доведено реальними docker-збірками (bun 1.3.14, sharp 0.34.5),
 * відтворюється і на darwin-arm64 — тобто не musl/glibc-залежне. `apk add vips` НЕ лікує: він
 * дає системний libvips, а бракує саме `sharp.node`.
 *
 * Канон для таких проєктів — НЕ компілювати, а ship `node_modules` і запускати через
 * `bun <entry>` на базі `mirror.gcr.io/oven/bun:alpine` (див. docker.mdc: компіляція). Це
 * легітимний виняток до правила «лише alpine/scratch у фінальному stage» — тут потрібен
 * саме bun-рантайм.
 *
 * Це окрема гілка від генеричного compile-правила (`getBunCompileHint` у `../js/lint.mjs`):
 * для проєктів БЕЗ нативних аддонів standalone-бінарник на alpine лишається каноном.
 *
 * Взірець структури dep-специфічного чек-модуля — сусідній `./docker-mirror.mjs`.
 */

/**
 * Розширюваний список нативних `.node`-аддонів із динамічним завантаженням біндингу.
 * Точні імена пакетів.
 */
export const NATIVE_ADDON_PACKAGES = /** @type {const} */ (['sharp', 'argon2'])

/**
 * Scope-префікси нативних аддонів (будь-який пакет у scope трактуємо як нативний).
 * `@img/*` — платформо-специфічні біндинги sharp (`@img/sharp-linuxmusl-arm64` тощо).
 */
export const NATIVE_ADDON_SCOPES = /** @type {const} */ (['@img/'])

const BUN_BUILD_COMPILE_RE = /\bbun\s+build\b[^\n]*\s--compile\b/iu
const APK_ADD_VIPS_RE = /\bapk\s+add\b[^\n]*\bvips\b/iu

/**
 * Чи ім'я пакета — нативний `.node`-аддон зі списку (точне ім'я або scope-префікс).
 * @param {string} name — ім'я npm-пакета
 * @returns {boolean} true, якщо це знаний нативний аддон
 */
export function isNativeAddonPackage(name) {
  if (NATIVE_ADDON_PACKAGES.includes(/** @type {never} */ (name))) return true
  return NATIVE_ADDON_SCOPES.some(scope => name.startsWith(scope))
}

/**
 * Повертає імена нативних аддонів, наявних у `dependencies` пакета.
 * @param {unknown} dependencies — об'єкт `package.json#dependencies`
 * @returns {string[]} відсортовані імена знайдених нативних аддонів (порожній — якщо немає)
 */
export function getNativeAddonDeps(dependencies) {
  if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) return []
  return Object.keys(dependencies)
    .filter(name => isNativeAddonPackage(name))
    .toSorted((a, b) => a.localeCompare(b))
}

/**
 * Перевіряє антипатерн «нативний аддон + `bun build --compile`».
 *
 * Тригер:
 * - у `package.json#dependencies` є нативний аддон (`getNativeAddonDeps` непорожній);
 * - **і** Dockerfile містить `bun build --compile`.
 *
 * Прапорцює compile-крок як помилку; додатково — зайвий `apk add ... vips`, доданий для
 * компенсації (системний vips не рятує). Канон описано в docker.mdc.
 * @param {string} fileContent — вміст Dockerfile/Containerfile
 * @param {string[]} nativeAddons — знайдені нативні аддони (з `getNativeAddonDeps`)
 * @returns {string | null} повідомлення помилки або null
 */
export function getNativeAddonNoCompileHint(fileContent, nativeAddons) {
  if (!Array.isArray(nativeAddons) || nativeAddons.length === 0) return null
  if (!BUN_BUILD_COMPILE_RE.test(fileContent)) return null

  /** @type {string[]} */
  const problems = [
    `проєкт залежить від нативного .node-аддона (${nativeAddons.join(', ')}) з динамічним require — ` +
      '`bun build --compile` не вшиває нативний біндинг, тож бінарник падає в рантаймі. ' +
      'Прибери compile-крок: ship node_modules + `bun <entry>` на базі mirror.gcr.io/oven/bun:alpine ' +
      '(docker.mdc: компіляція). Entry бери з наявного --outfile-таргета / package.json#main / ' +
      'scripts.start; якщо не визначити — лиши TODO-маркер, не вгадуй'
  ]

  if (APK_ADD_VIPS_RE.test(fileContent)) {
    problems.push(
      'зайвий `apk add ... vips` — системний libvips не лікує брак `sharp.node`; прибери разом із compile-кроком'
    )
  }

  return problems.join('\n     - ')
}
