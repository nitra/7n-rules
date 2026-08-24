/**
 * Спільний шар еталонів wasm-parity-гейтів (`goldenJs`) — винесений з
 * `wasm-plugin-parity.test.mjs` (lang-js, задача #471,
 * `git show 55a4d0715`), використовується ОБОМА wasm-parity-гейтами:
 * `wasm-plugin-parity.test.mjs` (lang-js) і `wasm-plugin-parity-python.test.mjs`
 * (lang-python). Обидва гейти звіряють `runWasmConcern` napi-мосту
 * (`crates/rules-napi` → відповідний `plugin-lang-*`) із ЗНЯТИМ раніше
 * виводом транзитивного JS-канону (`plugins/<lang>/rules/**\/main.mjs`),
 * не з живим викликом `lint()`.
 *
 * У звичайному режимі `compute` (переданий у [`createGoldenJs`]-хелпер
 * `goldenJs`) НЕ виконується взагалі — JS-канон не запускається, результат
 * читається з диска (з підстановкою ПОТОЧНОГО `dir` замість
 * [`TMP_DIR_PLACEHOLDER`]); відсутній еталон — це ПАДІННЯ тесту з проханням
 * перезняти, а не мовчазний пропуск (сенс гейта саме в тому, щоб зникнення
 * канону не пройшло непомітно). У режимі зняття (`N_WASM_PARITY_CAPTURE=1`,
 * канон іще на диску) `compute()` виконує ЖИВИЙ канон на цьому `dir`, і
 * результат одразу дописується у файл bucket-а (з `dir` заміненим на
 * плейсхолдер) — фільтрований повторний прогін (`vitest run -t …`)
 * домальовує лише свої ключі, не затираючи вже зняті. Той самий прийом
 * застосовано для k8s-parity-гейта (`N_K8S_PARITY_CAPTURE`,
 * `crates/rules-core/tests/common/mod.rs`) — форма тут навмисно дзеркальна.
 *
 * Кожен виклик-сайт (`main.mjs`-шлях канону і сама виклик `lint()`) лишається
 * в тесті ГЕЙТА — тут лише сам механізм зберігання/підстановки еталона, він
 * не знає нічого про конкретний lang-плагін чи концерн.
 */
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { env } from 'node:process'

import { expect } from 'vitest'

import { realRepoRoot } from '../../../utils/test-helpers.mjs'

const REPO_ROOT = realRepoRoot()

/**
 * Каталог еталонів wasm-parity: СПІЛЬНИЙ для обох гейтів (lang-js і
 * lang-python) — один JSON-файл на bucket (`ruleId/concernId`), значення —
 * мапа «ключ тесту → нормалізований `violations` JS-канону» ([`goldenJs`]).
 * Один файл на bucket, а не спільний моноліт: коли переснімається канон
 * ОДНОГО концерну, diff торкається лише його файлу (`join` сприймає `/` у
 * bucket-і як роздільник шляху, тож файли самі лягають у піддерева —
 * `vue/tfm-translations.json`, `style/gap.json`, `python/tooling.json` —
 * дзеркало `plugins/<lang>/rules/<ruleId>/<concernId>`; префікс bucket-а
 * (`js`/`python`/…) розводить гейти без колізій імен файлів).
 */
const GOLDEN_DIR = join(REPO_ROOT, 'npm', 'scripts', 'lib', 'lint-surface', 'tests', 'fixtures', 'wasm-parity')

/**
 * Прапорець режиму зняття еталонів — та сама форма, що
 * `N_K8S_PARITY_CAPTURE` (прецедент цього прийому для k8s-parity-гейта,
 * `crates/rules-core/tests/common/mod.rs`). Спільний для обох гейтів: один
 * прогін з `N_WASM_PARITY_CAPTURE=1` знімає еталони того файлу, який
 * викликається (`vitest run <шлях-до-гейта>`).
 */
const CAPTURE_ENV = 'N_WASM_PARITY_CAPTURE'

/**
 * Лічильники повторних викликів `goldenJs` у межах ОДНОГО `test()` (цикл по
 * кількох фікстурних файлах у тілі одного тесту): без лічильника другий
 * виклик з тим самим `currentTestName` затер би еталон першого. Ключ мапи —
 * сама пара bucket+testName, значення — скільки разів вона вже зустрілась.
 */
const GOLDEN_CALL_COUNTS = new Map()

/** Лінивий кеш прочитаних/записаних bucket-файлів (bucket → мапа ключ→еталон). */
const GOLDEN_CACHE = new Map()

/**
 * Абсолютний шлях до JSON-файлу еталонів одного bucket-а.
 * @param {string} bucket `ruleId/concernId`
 * @returns {string} шлях у [`GOLDEN_DIR`]
 */
function goldenFilePath(bucket) {
  return join(GOLDEN_DIR, `${bucket}.json`)
}

/**
 * Стабільний читабельний ключ одного знятого сценарію: імʼя поточного тесту
 * (`expect.getState().currentTestName` — так не треба правити кожен виклик
 * `goldenJs` вручну під новий ключ) плюс `#N`-суфікс, якщо той самий тест
 * звертається до ЦЬОГО bucket-а більше одного разу.
 * @param {string} bucket `ruleId/concernId`
 * @returns {string} ключ усередині файлу bucket-а
 */
function goldenKey(bucket) {
  const testName = expect.getState().currentTestName ?? '(поза test())'
  const countKey = `${bucket} ${testName}`
  const count = (GOLDEN_CALL_COUNTS.get(countKey) ?? 0) + 1
  GOLDEN_CALL_COUNTS.set(countKey, count)
  return count === 1 ? testName : `${testName} #${count}`
}

/**
 * Читає (і кешує) мапу еталонів одного bucket-а з диска; відсутній файл —
 * порожня мапа (перший запис у режимі зняття створить його разом із
 * батьківськими каталогами).
 * @param {string} bucket `ruleId/concernId`
 * @returns {Promise<Record<string, unknown>>} мапа ключ тесту → еталон
 */
async function loadGoldenBucket(bucket) {
  if (GOLDEN_CACHE.has(bucket)) return GOLDEN_CACHE.get(bucket)
  const path = goldenFilePath(bucket)
  let data = {}
  if (existsSync(path)) {
    const { readFile } = await import('node:fs/promises')
    data = JSON.parse(await readFile(path, 'utf8'))
  }
  GOLDEN_CACHE.set(bucket, data)
  return data
}

/**
 * Плейсхолдер, яким `goldenJs` ховає в еталоні шлях ЕФЕМЕРНОГО tmp-каталогу
 * (`dir` — `withTmpDir` генерує його наново щопрогону, значення відрізняється
 * між зняттям і звичайним прогоном). Більшість концернів кладуть у
 * `violation` лише ВІДНОСНІ шляхи (заміна тоді — no-op), але щонайменше один
 * (`test/storybook-vitest-config`, `data.vitestConfigPath`, доккомент «слот
 * repo-root@1» біля відповідного тесту) кладе АБСОЛЮТНИЙ шлях, зібраний із
 * `dir`, — без цієї заміни еталон, знятий на ОДНОМУ tmp-каталозі, ніколи не
 * збігся б із live-обчисленим wasm-результатом на ІНШОМУ (недетермінізм
 * самого шляху, не розбіжність порту). Друкований, а не керівний символ —
 * заради читабельності самого JSON-еталона; зіткнення з реальним вмістом
 * практично неможливе (це не валідний фрагмент файлової системи).
 */
const TMP_DIR_PLACEHOLDER = '<<WASM_PARITY_TMPDIR>>'

/**
 * Рекурсивно заміняє в JSON-сумісному значенні (violations і подібне) кожне
 * входження підрядка `from` на `to` — той самий обхід використовує
 * `goldenJs` в обидва боки (dir → плейсхолдер при записі еталона,
 * плейсхолдер → поточний dir при читанні).
 * @param {unknown} value довільне JSON-сумісне значення
 * @param {string} from підрядок, який шукаємо
 * @param {string} to підрядок, яким заміняємо
 * @returns {unknown} значення тієї самої форми з заміненими рядками
 */
function replaceDirDeep(value, from, to) {
  if (typeof value === 'string') return value.split(from).join(to)
  if (Array.isArray(value)) return value.map(item => replaceDirDeep(item, from, to))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replaceDirDeep(v, from, to)]))
  }
  return value
}

/**
 * Фабрика `goldenJs` для ОДНОГО wasm-parity-гейта — єдине, що параметризує
 * виклик-сайт: текст-підказка команди перезняття у повідомленні про
 * відсутній еталон (`captureHintPath` — шлях до `.test.mjs`-файлу ЦЬОГО
 * гейта, бо `N_WASM_PARITY_CAPTURE=1 npx vitest run …` без шляху перезняв
 * би еталони ОБОХ гейтів одразу, а канон живий лише в одного з них у будь-
 * який момент транзитивного періоду). Решта поведінки (кеш, лічильники,
 * плейсхолдер tmp-шляху) — спільна, доккомент модуля.
 * @param {{ captureHintPath: string }} opts `captureHintPath` — шлях гейта
 *   (відносний від кореня репо), що йде в підказку команди перезняття
 * @returns {(bucket: string, dir: string, compute: () => Promise<unknown>) => Promise<unknown>} `goldenJs`
 */
export function createGoldenJs({ captureHintPath }) {
  /**
   * Шар еталонів wasm-parity: заміняє живий JS-канон ПІСЛЯ його видалення.
   * У звичайному режимі `compute` НЕ виконується взагалі — JS не
   * запускається, результат читається з диска (з підстановкою ПОТОЧНОГО
   * `dir` замість [`TMP_DIR_PLACEHOLDER`] — [`replaceDirDeep`]); відсутній
   * еталон — це ПАДІННЯ тесту з проханням перезняти, а не мовчазний пропуск
   * (сенс гейта саме в тому, щоб зникнення канону не пройшло непомітно). У
   * режимі зняття (`N_WASM_PARITY_CAPTURE=1`, канон іще на диску) `compute()`
   * виконує ЖИВИЙ канон на цьому `dir`, і результат одразу дописується у
   * файл bucket-а (з `dir` заміненим на плейсхолдер) — фільтрований
   * повторний прогін (`vitest run -t …`) домальовує лише свої ключі, не
   * затираючи вже зняті.
   * @param {string} bucket `ruleId/concernId` (він же bucket-файл і вхід у `runWasmConcern`)
   * @param {string} dir абсолютний шлях tmp-каталогу ЦЬОГО прогону (для підстановки [`TMP_DIR_PLACEHOLDER`])
   * @param {() => Promise<unknown>} compute живий виклик JS-канону (виконується лише в режимі зняття)
   * @returns {Promise<unknown>} еталонний (чи щойно знятий) результат, з живим `dir` на місці плейсхолдера
   */
  return async function goldenJs(bucket, dir, compute) {
    const key = goldenKey(bucket)
    const data = await loadGoldenBucket(bucket)
    if (env[CAPTURE_ENV] === '1') {
      const result = await compute()
      data[key] = replaceDirDeep(result, dir, TMP_DIR_PLACEHOLDER)
      const path = goldenFilePath(bucket)
      const { mkdir } = await import('node:fs/promises')
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
      return result
    }
    if (!Object.hasOwn(data, key)) {
      throw new Error(
        `wasm-plugin-parity: немає еталона "${key}" у ${goldenFilePath(bucket)}.\n` +
          'JS-канон видалено разом із портом — перезняти можна лише повернувши main.mjs з історії й прогнавши: ' +
          `N_WASM_PARITY_CAPTURE=1 npx vitest run ${captureHintPath}`
      )
    }
    return replaceDirDeep(data[key], TMP_DIR_PLACEHOLDER, dir)
  }
}
