/**
 * Спільний T0-autofix writer для policy-концернів "один target-файл + один канонічний
 * `template/*.snippet.{json,jsonc,yml,yaml}`" (`engine:"template"` і `engine:"rego"`
 * з тим самим snippet-шаблоном). Deep-merge snippet → target: об'єкти мерджаться по
 * ключах, масиви — union за структурним підмножинним збігом (`checkSnippet`-семантика,
 * як у детекторі — жодного окремого визначення "збігу"), листя — перезаписується
 * канонічним значенням. Файл відсутній → копіюється сам snippet (без merge).
 *
 * JSON/JSONC — plain-object merge + `JSON.stringify`. YAML — `yaml` Document API
 * (`setIn`/`addIn`/`hasIn`), щоб зберегти коментарі й форматування наявного файлу;
 * створюється лише те, чого бракує.
 *
 * Кожен викличний concern передає лише `{ id, targetPath }` — сам writer резолвить
 * snippet-файл у `template/` свого concern-а через `ctx.concernDir` (той самий
 * механізм, що й `vscode-ext-add.mjs`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'

import { checkSnippet } from '../template.mjs'

const SNIPPET_EXTS = ['yml', 'yaml', 'json', 'jsonc']

/**
 * Чи `needle` структурно вже присутній у якомусь елементі `actualArray`
 * (та сама subset-семантика, що й у детекторі — жодного окремого визначення "збігу").
 * @param {unknown[]} actualArray наявний масив
 * @param {unknown} needle елемент snippet-а, наявність якого перевіряємо
 * @returns {boolean} true — вже присутній структурно
 */
function containedIn(actualArray, needle) {
  return actualArray.some(a => checkSnippet(a, needle, { targetPath: '', source: '' }).length === 0)
}

/**
 * Шукає `<basename>.snippet.<ext>` у `template/` concern-а (перебір відомих розширень).
 * @param {string} templateDir абсолютний шлях до `template/` concern-а
 * @param {string} targetBasename basename цільового файлу (напр. `npm-publish.yml`)
 * @returns {string|null} абсолютний шлях до snippet-файлу або null
 */
function findSnippetFile(templateDir, targetBasename) {
  if (!existsSync(templateDir)) return null
  for (const ext of SNIPPET_EXTS) {
    const p = join(templateDir, `${targetBasename}.snippet.${ext}`)
    if (existsSync(p)) return p
  }
  return null
}

/**
 * Рекурсивний deep-merge snippet у plain JS-значення (JSON/JSONC-гілка).
 * @param {unknown} actual наявне значення (або undefined)
 * @param {unknown} snippet канонічний фрагмент
 * @returns {unknown} злите значення
 */
function mergeJsonValue(actual, snippet) {
  if (Array.isArray(snippet)) {
    const arr = Array.isArray(actual) ? [...actual] : []
    for (const needle of snippet) {
      if (!containedIn(arr, needle)) arr.push(needle)
    }
    return arr
  }
  if (snippet !== null && typeof snippet === 'object') {
    const obj = actual !== null && typeof actual === 'object' && !Array.isArray(actual) ? { ...actual } : {}
    for (const [k, v] of Object.entries(snippet)) obj[k] = mergeJsonValue(obj[k], v)
    return obj
  }
  return snippet // leaf — перезаписуємо канонічним значенням
}

/**
 * Deep-merge snippet у YAML `Document` за шляхом (мутує `doc`). Масиви — `addIn` лише
 * відсутніх (структурно) елементів; об'єкти — рекурсія по ключах (`setIn` створює
 * проміжні мапи автоматично); листя — `setIn`.
 * @param {import('yaml').Document} doc YAML-документ (мутується)
 * @param {unknown} snippet канонічний фрагмент на цьому шляху
 * @param {Array<string|number>} path шлях у документі
 * @returns {void}
 */
function mergeYamlDoc(doc, snippet, path) {
  if (Array.isArray(snippet)) {
    // `doc.createNode([])` — примусово YAMLSeq-вузол; голий `setIn(path, [])` іноді
    // лишає сирий JS-масив (коли батьківська мапа вже існує), і подальший `addIn` кидає
    // `Expected YAML collection at …` — createNode гарантує коректний тип вузла завжди.
    if (!doc.hasIn(path)) doc.setIn(path, doc.createNode([]))
    const existing = doc.getIn(path)
    const existingJs = existing && typeof existing.toJS === 'function' ? existing.toJS(doc) : []
    for (const needle of snippet) {
      if (!containedIn(existingJs, needle)) doc.addIn(path, needle)
    }
    return
  }
  if (snippet !== null && typeof snippet === 'object') {
    for (const [k, v] of Object.entries(snippet)) mergeYamlDoc(doc, v, [...path, k])
    return
  }
  doc.setIn(path, snippet) // leaf — перезаписуємо канонічним значенням
}

/**
 * Рахує наступний вміст JSON/JSONC-target. `null` — невалідний вхід (не чіпаємо);
 * незмінений `prevText` — уже відповідає snippet-у (idempotent, без reformat).
 * @param {string} prevText наявний вміст target-файлу
 * @param {string} snippetPath абсолютний шлях до snippet-файлу
 * @returns {string|null} новий вміст, незмінений `prevText`, або `null`
 */
function computeJsonNextText(prevText, snippetPath) {
  let snippet
  let actual
  try {
    snippet = JSON.parse(readFileSync(snippetPath, 'utf8'))
    actual = JSON.parse(prevText)
  } catch {
    return null // невалідний JSON — не чіпаємо детермінованим фіксом
  }
  // Уже відповідає snippet-у (та сама перевірка, що й детектор) → без reformat:
  // JSON.stringify інакше переформатував би вже коректний файл (напр. компактний
  // однорядковий snippet → pretty-print) без жодної реальної зміни.
  if (checkSnippet(actual, snippet, { targetPath: '', source: '' }).length === 0) return prevText
  return JSON.stringify(mergeJsonValue(actual, snippet), null, 2) + '\n'
}

/**
 * Рахує наступний вміст YAML-target через `yaml` Document API. `null` — невалідний
 * вхід; незмінений `prevText` — уже відповідає snippet-у (idempotent, без reformat).
 * @param {string} prevText наявний вміст target-файлу
 * @param {string} snippetPath абсолютний шлях до snippet-файлу
 * @returns {Promise<string|null>} новий вміст, незмінений `prevText`, або `null`
 */
async function computeYamlNextText(prevText, snippetPath) {
  const { parse, parseDocument } = await import('yaml')
  let snippet
  let actualPlain
  try {
    snippet = parse(readFileSync(snippetPath, 'utf8'))
    actualPlain = parse(prevText)
  } catch {
    return null // невалідний YAML — не чіпаємо детермінованим фіксом
  }
  // Уже відповідає snippet-у → без reformat: Document.toString() не завжди
  // byte-identical на вже коректному вмісті (напр. folded block scalars).
  if (checkSnippet(actualPlain, snippet, { targetPath: '', source: '' }).length === 0) return prevText
  const doc = parseDocument(prevText)
  if (doc.errors.length > 0) return null
  if (snippet !== null && typeof snippet === 'object' && !Array.isArray(snippet)) {
    for (const [k, v] of Object.entries(snippet)) mergeYamlDoc(doc, v, [k])
  }
  return doc.toString()
}

/**
 * Створює T0-патерн, що приводить `targetPath` у відповідність `template/*.snippet.*`
 * свого concern-а (deep-merge, idempotent). Один writer — для будь-якого single-target
 * snippet-концерну (`engine:"template"` чи `engine:"rego"` з тим самим snippet-шаблоном).
 * @param {{ id: string, targetPath: string }} opts `id` — унікальний id T0-патерну; `targetPath` — posix-relative шлях цільового файлу від cwd
 * @returns {import('../lint-surface/types.mjs').T0Pattern} T0-патерн для `fix-<concern>.mjs`
 */
export function createTemplateFixPattern({ id, targetPath }) {
  return {
    id,
    test: violations => violations.some(v => v.file === targetPath),
    apply: async (violations, ctx) => {
      if (violations.every(v => v.file !== targetPath)) return { touchedFiles: [] }
      if (!ctx.concernDir) return { touchedFiles: [] }

      const snippetPath = findSnippetFile(join(ctx.concernDir, 'template'), basename(targetPath))
      if (!snippetPath) return { touchedFiles: [] }

      const absTarget = join(ctx.cwd, targetPath)
      const prevText = existsSync(absTarget) ? readFileSync(absTarget, 'utf8') : null

      // Файл відсутній → копіюємо snippet як є (без merge — немає з чим мерджити).
      if (prevText === null) {
        const rawSnippet = readFileSync(snippetPath, 'utf8')
        ctx.recordWrite?.(absTarget)
        mkdirSync(dirname(absTarget), { recursive: true })
        writeFileSync(absTarget, rawSnippet, 'utf8')
        return { touchedFiles: [absTarget], message: `${targetPath}: створено зі snippet` }
      }

      const isJson = ['.json', '.jsonc'].includes(extname(snippetPath).toLowerCase())
      const nextText = isJson
        ? computeJsonNextText(prevText, snippetPath)
        : await computeYamlNextText(prevText, snippetPath)

      if (nextText === null || nextText === prevText) return { touchedFiles: [] }
      ctx.recordWrite?.(absTarget)
      writeFileSync(absTarget, nextText, 'utf8')
      return { touchedFiles: [absTarget], message: `${targetPath}: приведено у відповідність snippet` }
    }
  }
}
