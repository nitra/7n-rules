/** @see ./docs/stryker_config.md */
import { existsSync } from 'node:fs'
import { copyFile, glob, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseSync } from 'oxc-parser'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { readNCursorConfigLite } from '../../../scripts/lib/read-n-cursor-config-lite.mjs'
import { ensureGitignoreEntries } from '../../../scripts/utils/ensure-gitignore-entries.mjs'
import { resolveAllJsRoots } from '../../../scripts/utils/resolve-js-root.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const STRYKER_BASELINE_PATH = join(HERE, 'data', 'stryker_config', 'stryker.config.baseline.mjs')
const STRYKER_VUE_BASELINE_PATH = join(HERE, 'data', 'stryker_config', 'stryker.config.vue.baseline.mjs')
const STRYKER_VUE_PLUGIN_PATH = join(HERE, 'data', 'stryker_config', 'stryker-vue-macros-ignorer.mjs')
const STRYKER_VUE_PLUGIN_FILENAME = 'stryker-vue-macros-ignorer.mjs'
const VITEST_BASELINE_PATH = join(HERE, 'data', 'vitest_config', 'vitest.config.baseline.js')

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
 * Копіює baseline у target, якщо target ще не існує. Idempotent.
 * @param {ReturnType<typeof createCheckReporter>} reporter check-reporter для логу pass/fail
 * @param {string} cwd корінь проєкту (для relative-шляхів у логах)
 * @param {string} baselinePath абсолютний шлях до canonical baseline
 * @param {string} target абсолютний шлях, куди копіювати
 * @param {string} label зрозуміла для людини мітка ("stryker.config.mjs" / "vitest.config.mjs")
 * @param {(content: string) => string} [transform] опційне перетворення тексту baseline перед записом
 * @returns {Promise<void>}
 */
async function ensureBaselineFile(reporter, cwd, baselinePath, target, label, transform) {
  if (existsSync(target)) {
    reporter.pass(`${label} існує (${relative(cwd, target)})`)
    return
  }
  if (transform) {
    await writeFile(target, transform(await readFile(baselinePath, 'utf8')), 'utf8')
  } else {
    await copyFile(baselinePath, target)
  }
  reporter.pass(`${label} створено з canonical baseline (${relative(cwd, target)}) (test.mdc)`)
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
 * @param {ReturnType<typeof createCheckReporter>} reporter check-reporter
 * @param {string} cwd корінь проєкту (для relative-шляхів у логах)
 * @param {string} jsRoot абсолютний шлях до Vue workspace-каталогу
 * @returns {Promise<void>}
 */
async function augmentVueStrykerConfig(reporter, cwd, jsRoot) {
  const target = join(jsRoot, 'stryker.config.mjs')
  const rel = relative(cwd, target)
  const src = await readFile(target, 'utf8')

  let result
  try {
    result = parseSync(target, src, { lang: 'js', sourceType: 'module' })
  } catch (error) {
    reporter.fail(`stryker.config.mjs не парситься (${rel}): ${error.message} — augment скіпнуто`)
    return
  }
  if (result.errors?.length) {
    const msg = result.errors[0]?.message ?? 'syntax error'
    reporter.fail(`stryker.config.mjs має syntax error (${rel}): ${msg} — augment скіпнуто`)
    return
  }

  const obj = findDefaultExportObject(result.program)
  if (!obj) {
    reporter.fail(
      `stryker.config.mjs has non-literal default export (${rel}) — augment скіпнуто, ` +
        'додай вручну plugins/ignorers згідно stryker.config.vue.baseline.mjs'
    )
    return
  }

  const plugins = analyzeArrayProperty(obj, 'plugins')
  const ignorers = analyzeArrayProperty(obj, 'ignorers')
  if (plugins.dynamic || ignorers.dynamic) {
    reporter.fail(
      `stryker.config.mjs: plugins/ignorers — динамічний вираз (spread/computed) (${rel}) — ` +
        'augment скіпнуто, додай vue-macros ignorer вручну згідно stryker.config.vue.baseline.mjs'
    )
    return
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

  if (edits.length === 0) {
    reporter.pass(`vue-macros ignorer уже зареєстровано (${rel})`)
    return
  }

  const next = applyEdits(src, edits)

  // Safety: результат має компілюватися. Якщо string-splice дав невалідний JS
  // (errors або виняток парсера на патологічному вводі) — відкат (не пишемо) і
  // fail, щоб користувач не лишився зі зламаним конфігом.
  let recheck
  try {
    recheck = parseSync(target, next, { lang: 'js', sourceType: 'module' })
  } catch (error) {
    reporter.fail(
      `stryker.config.mjs: augment дав некоректний результат (${rel}): ${error.message} — відкат, додай вручну`
    )
    return
  }
  if (recheck.errors?.length) {
    reporter.fail(`stryker.config.mjs: augment дав некоректний результат (${rel}) — відкат, додай вручну`)
    return
  }

  await writeFile(target, next, 'utf8')
  reporter.pass(`vue-macros ignorer додано у stryker.config.mjs (${rel}) (test.mdc)`)
}

/**
 * @param {string} [cwd] корінь проєкту (default: `process.cwd()` — CLI-сумісність)
 * @returns {Promise<number>} 0 — OK або silently skipped, 1 — порушення
 */
export async function main(cwd = process.cwd()) {
  const reporter = createCheckReporter()
  const config = await readNCursorConfigLite(cwd)

  // Self-gate: js має бути enabled
  if (!config.rules.includes('js') || config.disableRules.includes('js')) {
    return reporter.getExitCode()
  }

  const jsRoots = await resolveAllJsRoots(cwd)
  if (jsRoots.length === 0) {
    reporter.fail('test: js enabled, але кореневий package.json не знайдено (test.mdc)')
    return reporter.getExitCode()
  }

  for (const baselinePath of [
    STRYKER_BASELINE_PATH,
    STRYKER_VUE_BASELINE_PATH,
    STRYKER_VUE_PLUGIN_PATH,
    VITEST_BASELINE_PATH
  ]) {
    if (!existsSync(baselinePath)) {
      reporter.fail(`canonical baseline не знайдено (${baselinePath}) — перевстанови @nitra/cursor`)
      return reporter.getExitCode()
    }
  }

  for (const jsRoot of jsRoots) {
    const isVueRoot = await hasVueFiles(jsRoot)
    const strykerTarget = join(jsRoot, 'stryker.config.mjs')
    // Зчитуємо ДО ensureBaselineFile: чи файл уже існував. Якщо ні — baseline
    // (vue-варіант для Vue-root) копіюється з уже-присутніми plugins/ignorers,
    // augment не потрібен. Якщо існував — ensureBaselineFile idempotent-skip-ить,
    // і саме тут augment закриває drift-hole.
    const wasMissing = !existsSync(strykerTarget)
    const strykerBaseline = isVueRoot ? STRYKER_VUE_BASELINE_PATH : STRYKER_BASELINE_PATH
    // configFile у новоствореному baseline має вказувати на фактичний vitest-конфіг
    // jsRoot-а (existing `.js`/`.mjs` або дефолтний `.mjs`).
    const vitestName = resolveVitestConfigName(jsRoot)
    await ensureBaselineFile(reporter, cwd, strykerBaseline, strykerTarget, 'stryker.config.mjs', content =>
      content.replace(STRYKER_CONFIG_FILE_RE, `configFile: '${vitestName}'`)
    )
    if (isVueRoot) {
      if (!wasMissing) {
        await augmentVueStrykerConfig(reporter, cwd, jsRoot)
      }
      await ensureBaselineFile(
        reporter,
        cwd,
        STRYKER_VUE_PLUGIN_PATH,
        join(jsRoot, STRYKER_VUE_PLUGIN_FILENAME),
        STRYKER_VUE_PLUGIN_FILENAME
      )
    }
    await ensureBaselineFile(reporter, cwd, VITEST_BASELINE_PATH, join(jsRoot, vitestName), vitestName)
  }

  // Гарантуємо що тест-артефакти (Stryker output, lcov HTML-звіт) ніколи не
  // потрапляють у commit. Patterns покривають усі workspaces через `**/`-префікс
  // (єдиний root .gitignore).
  const { added } = await ensureGitignoreEntries(
    cwd,
    TEST_GITIGNORE_ENTRIES,
    'Test artifacts: Stryker + coverage (test.mdc)'
  )
  if (added.length > 0) {
    reporter.pass(`.gitignore: додано тест-патерни (${added.join(', ')}) (test.mdc)`)
  }
  return reporter.getExitCode()
}
