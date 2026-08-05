/**
 * Декларативний rule-level gate `main.json:applies` — міні-DSL, що замінив
 * виконуваний `<rule>/applies/main.mjs` (зріз 3 контракту v3.1,
 * `docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`, рішення Д).
 *
 * Навіщо дані, а не код: гейт відповідає на питання «чи це правило взагалі
 * активне», і його читає ДИСКАВЕРІ — `ci plan`, `hook`, `lint`. Поки гейт
 * був JS-модулем, дискавері мусило мати JS-рантайм, тож `rules-cli` делегував
 * усю команду в node. Як дані гейт читається однаково з JS і з Rust
 * (`crates/rules-core/src/rule_applies.rs` — дзеркало цього модуля).
 *
 * Словник виведено з інвентаризації ВСІХ трьох гейтів репо, не вигаданий
 * наперед; кожен оператор має живого споживача:
 *
 * | Оператор | Форма | Хто потребує |
 * |---|---|---|
 * | `pathExists` | `{ pathExists: "npm" }` | `python`, `npm-module` |
 * | `globMatches` | `{ globMatches: { glob, ignoreDirs } }` | `rust` |
 * | `jsonFieldContains` | `{ jsonFieldContains: { file, field, value } }` | `npm-module` |
 * | `any` | `{ any: [<node>, …] }` | `npm-module` |
 *
 * Комбінатора `all` НЕМАЄ свідомо: жоден чинний гейт кон'юнкції не потребує,
 * а DSL росте лише за фактом споживача (додати `all` — additive-зміна на
 * кілька рядків, коли такий гейт з'явиться).
 *
 * Аварійний клапан — `"applies": "dynamic"`: правило лишається на JS-модулі
 * `<rule>/applies/main.mjs`, і native-шлях чесно делегує в JS САМЕ ЦЕ
 * ПРАВИЛО, а не всю команду.
 * @typedef {{ pathExists: string }} PathExistsNode
 * @typedef {{ globMatches: { glob: string[], ignoreDirs: string[] } }} GlobMatchesNode
 * @typedef {{ jsonFieldContains: { file: string, field: string, value: string } }} JsonFieldContainsNode
 * @typedef {{ any: AppliesNode[] }} AnyNode
 * @typedef {PathExistsNode | GlobMatchesNode | JsonFieldContainsNode | AnyNode} AppliesNode
 * @typedef {{ kind: 'declarative', node: AppliesNode } | { kind: 'dynamic' } | { kind: 'always' }} AppliesSpec
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { globToRegex } from './glob-to-regex.mjs'
import { readRuleMetaRaw } from './rule-meta.mjs'

/** Літерал аварійного клапана: гейт лишається виконуваним JS-модулем правила. */
export const APPLIES_DYNAMIC = 'dynamic'

/** Імена операторів словника — єдине джерело правди для валідатора й помилок. */
export const APPLIES_OPERATORS = ['pathExists', 'globMatches', 'jsonFieldContains', 'any']

/**
 * Помилка формату предиката. Кидається на ПАРСИНГУ, не на обчисленні: битий
 * гейт має падати гучно в дискавері, а не мовчки вимикати правило.
 */
export class AppliesSpecError extends Error {
  /**
   * @param {string} message опис розбіжності зі схемою
   */
  constructor(message) {
    super(message)
    this.name = 'AppliesSpecError'
  }
}

/**
 * Нормалізує `glob` (рядок або масив) у непорожній масив патернів.
 * @param {unknown} raw значення поля `glob`
 * @param {string} where контекст для тексту помилки
 * @returns {string[]} патерни
 */
function normalizeGlobs(raw, where) {
  const list = Array.isArray(raw) ? raw : [raw]
  const globs = list.filter(g => typeof g === 'string' && g.length > 0)
  if (globs.length === 0) throw new AppliesSpecError(`${where}: glob має бути непорожнім рядком або масивом рядків`)
  return /** @type {string[]} */ (globs)
}

/**
 * Парсери окремих операторів — по функції на оператор. Таблиця замість
 * ланцюга `if`, бо валідація кожного оператора самодостатня: так додавання
 * оператора не підвищує складність спільної функції, а сам словник
 * (`APPLIES_OPERATORS`) лишається єдиним переліком.
 * @type {Record<string, (arg: unknown, where: string) => AppliesNode>}
 */
const OPERATOR_PARSERS = {
  pathExists(arg, where) {
    if (typeof arg !== 'string' || arg.length === 0) {
      throw new AppliesSpecError(`${where}.pathExists: очікується непорожній posix-шлях відносно кореня репо`)
    }
    return { pathExists: arg }
  },

  globMatches(arg, where) {
    const spec = expectObject(arg, `${where}.globMatches`, '{ glob, ignoreDirs }')
    const glob = normalizeGlobs(spec.glob, `${where}.globMatches`)
    const rawIgnore = spec.ignoreDirs ?? []
    if (!Array.isArray(rawIgnore) || rawIgnore.some(name => typeof name !== 'string')) {
      throw new AppliesSpecError(`${where}.globMatches.ignoreDirs: очікується масив імен каталогів`)
    }
    return { globMatches: { glob, ignoreDirs: /** @type {string[]} */ ([...rawIgnore]) } }
  },

  jsonFieldContains(arg, where) {
    const spec = expectObject(arg, `${where}.jsonFieldContains`, '{ file, field, value }')
    const { file, field, value: needle } = spec
    if (typeof file !== 'string' || file.length === 0) {
      throw new AppliesSpecError(`${where}.jsonFieldContains.file: очікується непорожній posix-шлях`)
    }
    if (typeof field !== 'string' || field.length === 0) {
      throw new AppliesSpecError(`${where}.jsonFieldContains.field: очікується непорожній шлях поля через крапку`)
    }
    if (typeof needle !== 'string') {
      throw new AppliesSpecError(`${where}.jsonFieldContains.value: очікується рядок`)
    }
    return { jsonFieldContains: { file, field, value: needle } }
  },

  any(arg, where) {
    if (!Array.isArray(arg) || arg.length === 0) {
      throw new AppliesSpecError(`${where}.any: очікується непорожній масив вузлів`)
    }
    return { any: arg.map((child, index) => parseAppliesNode(child, `${where}.any[${index}]`)) }
  }
}

/**
 * Обʼєкт-аргумент оператора (не null, не масив) або типізована помилка.
 * @param {unknown} arg сирий аргумент
 * @param {string} where шлях вузла для тексту помилки
 * @param {string} shape очікувана форма для підказки (напр. `{ glob, ignoreDirs }`)
 * @returns {Record<string, unknown>} аргумент як обʼєкт
 */
function expectObject(arg, where, shape) {
  if (arg === null || typeof arg !== 'object' || Array.isArray(arg)) {
    throw new AppliesSpecError(`${where}: очікується обʼєкт ${shape}`)
  }
  return /** @type {Record<string, unknown>} */ (arg)
}

/**
 * Валідує один вузол предиката, повертаючи його ж у нормалізованій формі.
 * Вузол — обʼєкт РІВНО з одним ключем-оператором: два оператори в одному
 * вузлі неоднозначні (кон'юнкція? диз'юнкція?), тож це помилка, а не здогад.
 * @param {unknown} value сирий вузол
 * @param {string} where шлях вузла для тексту помилки (напр. `applies.any[1]`)
 * @returns {AppliesNode} валідний вузол
 */
export function parseAppliesNode(value, where = 'applies') {
  const obj = expectObject(value, where, `-вузол з одним оператором (${APPLIES_OPERATORS.join(', ')})`)
  const keys = Object.keys(obj)
  if (keys.length !== 1) {
    throw new AppliesSpecError(
      `${where}: вузол має містити РІВНО один оператор, отримано: ${keys.join(', ') || '(порожньо)'}`
    )
  }
  const [op] = keys
  const parse = OPERATOR_PARSERS[op]
  if (!parse) {
    throw new AppliesSpecError(`${where}: невідомий оператор "${op}" — словник: ${APPLIES_OPERATORS.join(', ')}`)
  }
  return parse(obj[op], where)
}

/**
 * Нормалізує значення `main.json:applies` у дискриміновану форму.
 * @param {unknown} value значення поля `applies` (`undefined` — поля немає)
 * @returns {AppliesSpec} `always` — гейта немає, правило застосовне завжди
 */
export function parseAppliesSpec(value) {
  if (value === undefined) return { kind: 'always' }
  if (value === APPLIES_DYNAMIC) return { kind: 'dynamic' }
  return { kind: 'declarative', node: parseAppliesNode(value) }
}

/**
 * Читає гейт правила з `<ruleDir>/main.json`.
 *
 * Legacy-міст: поля немає, але поруч лежить `<ruleDir>/applies/main.mjs` —
 * трактуємо як `dynamic`. Сторонні правила, не мігровані на декларативний
 * формат, продовжують працювати; native-шлях для них чесно делегує.
 * @param {string} ruleDir абсолютний шлях каталогу правила
 * @returns {AppliesSpec} гейт правила
 */
export function readRuleApplies(ruleDir) {
  const meta = readRuleMetaRaw(ruleDir)
  const spec = parseAppliesSpec(meta?.applies)
  if (spec.kind === 'always' && existsSync(join(ruleDir, 'applies', 'main.mjs'))) return { kind: 'dynamic' }
  return spec
}

/**
 * Дістає значення поля за шляхом через крапку (`"a.b"`). Ключі з крапкою в
 * імені не адресуються — такому гейту потрібен `dynamic`.
 * @param {unknown} root корінь розібраного JSON
 * @param {string} field шлях поля
 * @returns {unknown} значення або `undefined`
 */
function readJsonField(root, field) {
  // Єдиний вихід із виразом: голий `return` не влаштовує jsdoc-гейт, а
  // `return undefined` — oxlint; тож недосяжну гілку гасимо присвоєнням.
  let current = root
  for (const segment of field.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      current = undefined
      break
    }
    current = /** @type {Record<string, unknown>} */ (current)[segment]
  }
  return current
}

/**
 * Чи є в дереві `root` хоч один ФАЙЛ, чий posix-шлях відносно `root`
 * матчиться хоч одним патерном. Каталоги з `ignoredDirNames` не відвідуються;
 * симлінки не розгортаються (`isDirectory()` для симлінка — `false`), помилка
 * читання каталогу трактується як «тут нічого немає». Ранній вихід на першій
 * знахідці — гейт на гарячому шляху `hook`.
 * @param {string} root абсолютний корінь обходу
 * @param {RegExp[]} matchers скомпільовані патерни
 * @param {Set<string>} ignoredDirNames імена каталогів, у які НЕ заходимо
 * @returns {boolean} чи знайдено збіг
 */
function walkMatches(root, matchers, ignoredDirNames) {
  /**
   * @param {string} dir абсолютний шлях каталогу
   * @param {string} prefix posix-префікс шляху відносно `root`
   * @returns {boolean} чи знайдено збіг у піддереві
   */
  function walk(dir, prefix) {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return false
    }
    for (const entry of entries) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isFile() && matchers.some(re => re.test(relative))) return true
      if (entry.isDirectory() && !ignoredDirNames.has(entry.name) && walk(join(dir, entry.name), relative)) return true
    }
    return false
  }
  return walk(root, '')
}

/**
 * Обчислює вузол предиката для конкретного кореня репо.
 * @param {AppliesNode} node валідний вузол (після `parseAppliesNode`)
 * @param {string} cwd абсолютний корінь репозиторію
 * @returns {boolean} результат предиката
 */
export function evaluateAppliesNode(node, cwd) {
  if ('pathExists' in node) return existsSync(join(cwd, node.pathExists))

  if ('globMatches' in node) {
    const { glob, ignoreDirs } = node.globMatches
    return walkMatches(
      cwd,
      glob.map(g => globToRegex(g)),
      new Set(ignoreDirs)
    )
  }

  if ('jsonFieldContains' in node) {
    const { file, field, value } = node.jsonFieldContains
    const path = join(cwd, file)
    if (!existsSync(path)) return false
    let parsed
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      return false
    }
    const found = readJsonField(parsed, field)
    return Array.isArray(found) && found.includes(value)
  }

  return node.any.some(child => evaluateAppliesNode(child, cwd))
}
