/**
 * @see ./docs/stryker_config.md
 *
 * Read-only detector: планує (НЕ виконує) копіювання stryker/vitest baseline-ів,
 * vue-plugin-файла, augment існуючого Vue-config-а та `.gitignore`-entries.
 * Кожна потрібна зміна стає violation із `data` (опис дії для T0). Запис робить
 * окремий T0-fix (`fix-stryker_config.mjs`) — `lint --no-fix` не мутує дерево.
 * Планувальник (`planStrykerActions`) і константи шляхів спільні для detector/T0.
 */
import { existsSync } from 'node:fs'
import { glob, readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseSync } from 'oxc-parser'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { readNCursorConfigLite } from '../../../scripts/lib/read-n-cursor-config-lite.mjs'
import { resolveAllJsRoots } from '../../../scripts/utils/resolve-js-root.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const STRYKER_BASELINE_PATH = join(HERE, 'data', 'stryker_config', 'stryker.config.baseline.mjs')
export const STRYKER_VUE_BASELINE_PATH = join(HERE, 'data', 'stryker_config', 'stryker.config.vue.baseline.mjs')
export const STRYKER_VUE_PLUGIN_PATH = join(HERE, 'data', 'stryker_config', 'stryker-vue-macros-ignorer.mjs')
const STRYKER_VUE_PLUGIN_FILENAME = 'stryker-vue-macros-ignorer.mjs'
export const VITEST_BASELINE_PATH = join(HERE, 'data', 'vitest_config', 'vitest.config.baseline.js')

/** Стабільні reasons. */
export const STRYKER_CONFIG_MISSING = 'stryker-config-missing'
export const STRYKER_VUE_AUGMENT = 'stryker-vue-augment'
export const STRYKER_VUE_AUGMENT_FAIL = 'stryker-vue-augment-fail'
export const GITIGNORE_MISSING = 'gitignore-missing'

// Канонічна назва vitest-конфіга — `.mjs` (нові файли, js.mdc); legacy
// `.js` лишається валідним. Перший знайдений виграє (.mjs пріоритетніший).
const VITEST_CONFIG_NAMES = ['vitest.config.mjs', 'vitest.config.js']
// Заміна literal `configFile` у скопійованому stryker-baseline на фактичне
// ім'я vitest-конфіга jsRoot-а (узгодження Stryker ↔ vitest).
const STRYKER_CONFIG_FILE_RE = /configFile: 'vitest\.config\.[cm]?js'/u

/**
 * Визначає ім'я vitest-конфіга для jsRoot: існуючий `.mjs`/`.js` (якщо є),
 * інакше дефолт `vitest.config.mjs` (нові файли — `.mjs`). Існуючий
 * `vitest.config.js` лишається валідним (backward-compat), новий не плодиться.
 * @param {string} jsRoot абсолютний шлях до workspace-каталогу
 * @returns {string} ім'я vitest-конфіга
 */
function resolveVitestConfigName(jsRoot) {
  return VITEST_CONFIG_NAMES.find(name => existsSync(join(jsRoot, name))) ?? 'vitest.config.mjs'
}

// Канонічні entries, які vue-варіант baseline тримає у `plugins`/`ignorers`.
// Augment-крок (augmentVueStrykerConfig) дбає, щоб саме вони були присутні в
// уже-існуючому `stryker.config.mjs` Vue-root-а. Нову property пишемо у
// canonical-порядку; у наявний масив лише дописуємо відсутні entries в кінець
// (Stryker нечутливий до порядку plugins/ignorers).
const VITEST_RUNNER_PLUGIN = '@stryker-mutator/vitest-runner'
const VUE_MACROS_PLUGIN = './stryker-vue-macros-ignorer.mjs'
const VUE_MACROS_IGNORER = 'vue-macros'

// Module-scope (prefer-static-regex): рядок-відступ цілком whitespace; leading
// кома (можливо з whitespace) після останньої property об'єкта.
const INDENT_WS_RE = /^\s*$/u
const LEADING_COMMA_RE = /^\s*,/u

// Тест-артефакти для .gitignore (подвійний-зірочка-префікс — для monorepo workspaces):
// - `**/reports/stryker/` — увесь каталог Stryker-output-у (`tempDirName` backup'и,
//   mutation.json, HTML/dashboard-репорти якщо користувач додасть інші reporter-и).
// - `**/coverage/` — весь output vitest v8 coverage (`lcov.info` + HTML `lcov-report/`).
//   Ефемерний: регенерується кожним прогоном; фінальні метрики живуть у `COVERAGE.md`.
//   Gitignore не заважає `n-cursor coverage` читати `lcov.info` у тому ж прогоні.
// Покриваємо каталогами замість перелічування під-патернів.
const TEST_GITIGNORE_ENTRIES = ['**/reports/stryker/', '**/coverage/']

// .vue detection: scope — `<jsRoot>/src/**/*.vue` (як і Stryker mutate defaults для src/);
// skip build-артефактів і чужих node_modules, щоб не вмикати vue-варіант через transitive deps.
const VUE_GLOB_PATTERN = 'src/**/*.vue'
const VUE_GLOB_IGNORE = ['**/node_modules/**', '**/dist/**', '**/reports/**']

/**
 * Чи містить jsRoot хоч один `.vue` файл під `src/` (skipping node_modules/dist/reports).
 * @param {string} jsRoot абсолютний шлях до workspace-каталогу
 * @returns {Promise<boolean>} true якщо знайдено хоча б один `.vue`
 */
async function hasVueFiles(jsRoot) {
  for await (const _rel of glob(VUE_GLOB_PATTERN, { cwd: jsRoot, exclude: VUE_GLOB_IGNORE })) {
    return true
  }
  return false
}

/**
 * Опис однієї дії-запису baseline-файла (для T0). Читання baseline і запис робить
 * T0; detector лише планує. `transformKey` — необов'язковий маркер, який трансформ
 * застосувати до тексту baseline (T0 мапить ключ на функцію); `null` = copy as-is.
 * @typedef {object} BaselineAction
 * @property {'baseline'} kind
 * @property {string} baselinePath абсолютний шлях canonical baseline
 * @property {string} target абсолютний шлях, куди писати
 * @property {string} label людиночитна мітка
 * @property {{ re: string, replacement: string }} [transform] string-replace над текстом baseline
 */

/**
 * Будує BaselineAction, якщо target ще не існує (idempotent). Read-only.
 * @param {string} baselinePath абсолютний шлях до canonical baseline
 * @param {string} target абсолютний шлях, куди копіювати
 * @param {string} label мітка ("stryker.config.mjs" / "vitest.config.mjs")
 * @param {{ re: string, replacement: string }} [transform] опційний string-replace baseline-тексту
 * @returns {BaselineAction | null} дія або null, якщо файл уже є
 */
function planBaselineFile(baselinePath, target, label, transform) {
  if (existsSync(target)) return null
  /** @type {BaselineAction} */
  const action = { kind: 'baseline', baselinePath, target, label }
  if (transform) action.transform = transform
  return action
}

/**
 * Огортає рядкове значення в single-quotes для вставки у JS-масив. Канонічні
 * entries (`@stryker-mutator/...`, `vue-macros`, `./stryker-...`) не містять
 * лапок, тож escaping не потрібен.
 * @param {string} s рядкове значення
 * @returns {string} `'<s>'`
 */
function quote(s) {
  return `'${s}'`
}

/**
 * Знаходить `export default { … }` як ObjectExpression. Повертає null, якщо
 * default-export відсутній або не є object-literal (factory/функція/змінна) —
 * augment у такому разі не чіпає файл.
 * @param {{body: Array<{type: string, declaration?: {type: string}}>}} program oxc Program node
 * @returns {object | null} ObjectExpression node або null
 */
function findDefaultExportObject(program) {
  const exp = program.body.find(n => n.type === 'ExportDefaultDeclaration')
  const decl = exp?.declaration
  return decl && decl.type === 'ObjectExpression' ? decl : null
}

/**
 * Аналізує property `name` об'єкта: чи присутній, чи це чистий масив рядкових
 * літералів і які значення вже містить. `dynamic: true` сигналить, що масив —
 * computed (spread / non-string element / не ArrayExpression), і зливати його
 * небезпечно.
 * @param {object} obj ObjectExpression node
 * @param {string} name ім'я property ('plugins' | 'ignorers')
 * @returns {{prop: object|null, array: object|null, values: string[], dynamic: boolean}} стан property
 */
function analyzeArrayProperty(obj, name) {
  const prop = obj.properties.find(
    p => p.type === 'Property' && !p.computed && p.key && (p.key.name === name || p.key.value === name)
  )
  if (!prop) return { prop: null, array: null, values: [], dynamic: false }
  const value = prop.value
  if (!value || value.type !== 'ArrayExpression') return { prop, array: null, values: [], dynamic: true }
  const values = []
  for (const el of value.elements) {
    if (!el || el.type !== 'Literal' || typeof el.value !== 'string') {
      return { prop, array: value, values: [], dynamic: true }
    }
    values.push(el.value)
  }
  return { prop, array: value, values, dynamic: false }
}

/**
 * Вставка відсутніх рядкових елементів у вже існуючий масив (append перед `]`).
 * Порожній масив → елементи між `[` `]`; непорожній → `, '<item>'` після
 * останнього елемента (trailing comma, якщо вже є, лишається валідною).
 * @param {object} arr ArrayExpression node
 * @param {string[]} values поточні значення масиву
 * @param {string[]} missing значення, яких бракує (вже у потрібному порядку)
 * @returns {{pos: number, text: string}} одна точкова вставка
 */
function arrayAppendEdit(arr, values, missing) {
  if (values.length === 0) {
    return { pos: arr.end - 1, text: missing.map(v => quote(v)).join(', ') }
  }
  const lastEl = arr.elements.at(-1)
  return { pos: lastEl.end, text: missing.map(v => `, ${quote(v)}`).join('') }
}

/**
 * Визначає відступ properties об'єкта за рядком останньої property (для нових
 * рядків `plugins`/`ignorers`). Дефолт — 2 пробіли.
 * @param {string} src вихідний текст конфіга
 * @param {object} obj ObjectExpression node
 * @returns {string} рядок-відступ (whitespace)
 */
function detectIndent(src, obj) {
  const props = obj.properties
  if (props.length > 0) {
    const start = props.at(-1).start
    const lineStart = src.lastIndexOf('\n', start - 1) + 1
    const ws = src.slice(lineStart, start)
    if (INDENT_WS_RE.test(ws)) return ws
  }
  return '  '
}

/**
 * Вставка нових properties (`plugins`/`ignorers`) у object-literal перед його
 * закривальною `}`. Поважає trailing comma останньої property й коректно
 * обробляє порожній об'єкт `{}`.
 * @param {string} src вихідний текст конфіга
 * @param {object} obj ObjectExpression node
 * @param {string} indent відступ properties
 * @param {string[]} lines рядки нових properties (без відступу й коми), напр. `plugins: [...]`
 * @returns {{pos: number, text: string}} одна точкова вставка
 */
function newPropertyEdit(src, obj, indent, lines) {
  const block = lines.join(`,\n${indent}`)
  const props = obj.properties
  if (props.length === 0) {
    return { pos: obj.start + 1, text: `\n${indent}${block}\n` }
  }
  const lastProp = props.at(-1)
  const tail = src.slice(lastProp.end, obj.end - 1)
  const commaMatch = tail.match(LEADING_COMMA_RE)
  if (commaMatch) {
    return { pos: lastProp.end + commaMatch[0].length, text: `\n${indent}${block}` }
  }
  return { pos: lastProp.end, text: `,\n${indent}${block}` }
}

/**
 * Застосовує точкові вставки до тексту. Сортує за спаданням `pos`, щоб ранні
 * offsets лишались валідними після вставок справа.
 * @param {string} src вихідний текст
 * @param {Array<{pos: number, text: string}>} edits вставки
 * @returns {string} новий текст
 */
function applyEdits(src, edits) {
  let out = src
  for (const e of edits.toSorted((a, b) => b.pos - a.pos)) {
    out = out.slice(0, e.pos) + e.text + out.slice(e.pos)
  }
  return out
}

/**
 * Augment-крок для вже-існуючого `stryker.config.mjs` у Vue JS-root:
 * реєструє локальний `vue-macros` ignorer-плагін (`plugins`/`ignorers`), якщо
 * його ще немає. Закриває drift-hole для проєктів, які мали non-vue config ще
 * до 3.x Vue-підтримки — `ensureBaselineFile` такий файл idempotent-skip-ить,
 * тож baseline-секцій `plugins`/`ignorers` він мовчки не отримує, і Stryker
 * падає у dry-run з `defineProps()` error.
 *
 * Стратегія: oxc-parser — лише для **аналізу** (де у source-тексті
 * default-export object, які properties/offsets уже є). Зміни — точкові
 * string-splice-и у вихідному тексті (insert items), щоб НЕ переписати
 * форматування й коментарі користувача (oxc serializer їх не зберігає). Після
 * splice — повторний parse: якщо результат не компілюється → відкат і fail.
 * @param {string} cwd корінь проєкту (для relative-шляхів у логах)
 * @param {string} jsRoot абсолютний шлях до Vue workspace-каталогу
 * @returns {Promise<{ ok: false, message: string } | { ok: true, target: string, content: string | null }>}
 *   `ok:false` — augment неможливий (fail-violation); `ok:true, content:null` — no-op;
 *   `ok:true, content:string` — обчислений новий вміст для запису T0-ом
 */
export async function planVueAugment(cwd, jsRoot) {
  const target = join(jsRoot, 'stryker.config.mjs')
  const rel = relative(cwd, target)
  const src = await readFile(target, 'utf8')

  let result
  try {
    result = parseSync(target, src, { lang: 'js', sourceType: 'module' })
  } catch (error) {
    return { ok: false, message: `stryker.config.mjs не парситься (${rel}): ${error.message} — augment скіпнуто` }
  }
  if (result.errors?.length) {
    const msg = result.errors[0]?.message ?? 'syntax error'
    return { ok: false, message: `stryker.config.mjs має syntax error (${rel}): ${msg} — augment скіпнуто` }
  }

  const obj = findDefaultExportObject(result.program)
  if (!obj) {
    return {
      ok: false,
      message:
        `stryker.config.mjs has non-literal default export (${rel}) — augment скіпнуто, ` +
        'додай вручну plugins/ignorers згідно stryker.config.vue.baseline.mjs'
    }
  }

  const plugins = analyzeArrayProperty(obj, 'plugins')
  const ignorers = analyzeArrayProperty(obj, 'ignorers')
  if (plugins.dynamic || ignorers.dynamic) {
    return {
      ok: false,
      message:
        `stryker.config.mjs: plugins/ignorers — динамічний вираз (spread/computed) (${rel}) — ` +
        'augment скіпнуто, додай vue-macros ignorer вручну згідно stryker.config.vue.baseline.mjs'
    }
  }

  const edits = []
  const newPropLines = []
  for (const [name, state, required] of [
    ['plugins', plugins, [VITEST_RUNNER_PLUGIN, VUE_MACROS_PLUGIN]],
    ['ignorers', ignorers, [VUE_MACROS_IGNORER]]
  ]) {
    const missing = required.filter(v => !state.values.includes(v))
    if (state.array) {
      if (missing.length > 0) edits.push(arrayAppendEdit(state.array, state.values, missing))
    } else {
      newPropLines.push(`${name}: [${required.map(v => quote(v)).join(', ')}]`)
    }
  }
  if (newPropLines.length > 0) {
    edits.push(newPropertyEdit(src, obj, detectIndent(src, obj), newPropLines))
  }

  if (edits.length === 0) return { ok: true, target, content: null }

  const next = applyEdits(src, edits)

  // Safety: результат має компілюватися. Якщо string-splice дав невалідний JS
  // (errors або виняток парсера на патологічному вводі) — fail (не пишемо), щоб
  // користувач не лишився зі зламаним конфігом.
  let recheck
  try {
    recheck = parseSync(target, next, { lang: 'js', sourceType: 'module' })
  } catch (error) {
    return {
      ok: false,
      message: `stryker.config.mjs: augment дав некоректний результат (${rel}): ${error.message} — відкат, додай вручну`
    }
  }
  if (recheck.errors?.length) {
    return {
      ok: false,
      message: `stryker.config.mjs: augment дав некоректний результат (${rel}) — відкат, додай вручну`
    }
  }

  return { ok: true, target, content: next }
}

/** Header-коментар для секції тест-артефактів у `.gitignore`. */
export const GITIGNORE_SECTION_LABEL = 'Test artifacts: Stryker + coverage (test.mdc)'

/**
 * Read-only: чи відсутні якісь із `TEST_GITIGNORE_ENTRIES` у кореневому `.gitignore`.
 * Дублює дешеву перевірку `ensureGitignoreEntries` без запису.
 * @param {string} cwd корінь репо
 * @returns {Promise<string[]>} відсутні entries (порожній — нічого додавати)
 */
async function missingGitignoreEntries(cwd) {
  const gitignorePath = join(cwd, '.gitignore')
  const existing = existsSync(gitignorePath) ? await readFile(gitignorePath, 'utf8') : ''
  const lines = new Set(existing.split('\n').map(l => l.trim()))
  return TEST_GITIGNORE_ENTRIES.filter(e => !lines.has(e))
}

/**
 * @typedef {object} StrykerPlan
 * @property {string | null} fatal fail-message, що зупиняє план (missing baseline / no root)
 * @property {BaselineAction[]} baselineActions copy-baseline дії (stryker/vitest/vue-plugin)
 * @property {Array<{ target: string, content: string }>} augmentWrites augment-записи (computed content)
 * @property {string[]} augmentFails augment-fail повідомлення (read-only diagnostics)
 * @property {string[]} gitignoreMissing відсутні `.gitignore`-entries
 */

/**
 * Чистий планувальник (read-only): обчислює всі потрібні зміни для stryker_config
 * без жодного запису. Спільний для detector-а (→ violations) і T0-fix (→ writes).
 * @param {string} cwd корінь репо
 * @returns {Promise<StrykerPlan>}
 */
export async function planStrykerActions(cwd) {
  /** @type {StrykerPlan} */
  const plan = { fatal: null, baselineActions: [], augmentWrites: [], augmentFails: [], gitignoreMissing: [] }

  const jsRoots = await resolveAllJsRoots(cwd)
  if (jsRoots.length === 0) {
    plan.fatal = 'test: js enabled, але кореневий package.json не знайдено (test.mdc)'
    return plan
  }

  for (const baselinePath of [
    STRYKER_BASELINE_PATH,
    STRYKER_VUE_BASELINE_PATH,
    STRYKER_VUE_PLUGIN_PATH,
    VITEST_BASELINE_PATH
  ]) {
    if (!existsSync(baselinePath)) {
      plan.fatal = `canonical baseline не знайдено (${baselinePath}) — перевстанови @nitra/cursor`
      return plan
    }
  }

  for (const jsRoot of jsRoots) {
    const isVueRoot = await hasVueFiles(jsRoot)
    const strykerTarget = join(jsRoot, 'stryker.config.mjs')
    // Чи файл уже існує (до будь-якого запису). Якщо ні — baseline (vue-варіант для
    // Vue-root) уже містить plugins/ignorers, augment не потрібен. Якщо існував —
    // baseline idempotent-skip, і augment закриває drift-hole.
    const wasMissing = !existsSync(strykerTarget)
    const strykerBaseline = isVueRoot ? STRYKER_VUE_BASELINE_PATH : STRYKER_BASELINE_PATH
    const vitestName = resolveVitestConfigName(jsRoot)
    const strykerAction = planBaselineFile(strykerBaseline, strykerTarget, 'stryker.config.mjs', {
      re: STRYKER_CONFIG_FILE_RE.source,
      replacement: `configFile: '${vitestName}'`
    })
    if (strykerAction) plan.baselineActions.push(strykerAction)

    if (isVueRoot) {
      if (!wasMissing) {
        const res = await planVueAugment(cwd, jsRoot)
        if (!res.ok) {
          plan.augmentFails.push(res.message)
        } else if (res.content !== null) {
          plan.augmentWrites.push({ target: res.target, content: res.content })
        }
      }
      const pluginAction = planBaselineFile(
        STRYKER_VUE_PLUGIN_PATH,
        join(jsRoot, STRYKER_VUE_PLUGIN_FILENAME),
        STRYKER_VUE_PLUGIN_FILENAME
      )
      if (pluginAction) plan.baselineActions.push(pluginAction)
    }
    const vitestAction = planBaselineFile(VITEST_BASELINE_PATH, join(jsRoot, vitestName), vitestName)
    if (vitestAction) plan.baselineActions.push(vitestAction)
  }

  plan.gitignoreMissing = await missingGitignoreEntries(cwd)
  return plan
}

/**
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>}
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const cwd = ctx.cwd
  const config = await readNCursorConfigLite(cwd)

  // Self-gate: js має бути enabled
  if (!config.rules.includes('js') || config.disableRules.includes('js')) {
    return reporter.result()
  }

  const plan = await planStrykerActions(cwd)
  if (plan.fatal) {
    reporter.fail(plan.fatal)
    return reporter.result()
  }

  for (const a of plan.baselineActions) {
    reporter.fail(
      `${a.label} відсутній (${relative(cwd, a.target)}) — запусти \`npx @nitra/cursor lint test\` для canonical baseline (test.mdc)`,
      { reason: STRYKER_CONFIG_MISSING, file: relative(cwd, a.target) }
    )
  }
  for (const w of plan.augmentWrites) {
    reporter.fail(
      `vue-macros ignorer не зареєстровано у stryker.config.mjs (${relative(cwd, w.target)}) — запусти \`npx @nitra/cursor lint test\` (test.mdc)`,
      { reason: STRYKER_VUE_AUGMENT, file: relative(cwd, w.target) }
    )
  }
  for (const msg of plan.augmentFails) {
    reporter.fail(msg, STRYKER_VUE_AUGMENT_FAIL)
  }
  if (plan.gitignoreMissing.length > 0) {
    reporter.fail(
      `.gitignore: бракує тест-патернів (${plan.gitignoreMissing.join(', ')}) — запусти \`npx @nitra/cursor lint test\` (test.mdc)`,
      GITIGNORE_MISSING
    )
  }

  return reporter.result()
}
