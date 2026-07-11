/**
 * T0-autofix для policy-concern-а `bun/package_json`: видаляє заборонені top-level поля
 * (канон — `template/package.json.deny.json`, той самий `data.template.deny`, що бачить rego)
 * і `scripts.lint` / `scripts.lint-*` (bun.mdc — лінт лише через `n-cursor lint`, не npm-скрипти).
 *
 * Просте видалення `scripts.lint*` небезпечне: якщо десь у репо (workflow yml, інший
 * npm-скрипт) є виклик `bun run lint-js` тощо, видалення ключа зламає цей виклик.
 * Тому перед видаленням шукаємо всі виклики кожного lint-скрипта репо-вайд і переписуємо
 * їх на прямий `bunx n-cursor lint <surface>` (canonical — той самий, що вимагають
 * lint_js_yml/lint_style_yml). Скрипт видаляється лише якщо ВСІ його виклики вдалось
 * переписати (файли, де виклик не розпізнано — залишаємо як є, скрипт теж лишається,
 * щоб не зламати консьюмера мовчки).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { walkDir } from '../../../scripts/utils/walkDir.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'

const LINT_SCRIPT_RE = /^lint(-.*)?$/u
const WORKFLOW_YML_RE = /^\.github\/workflows\/.*\.ya?ml$/u
const LOCKFILE_RE = /(^|\/)(bun\.lockb?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/u
const PACKAGE_MANAGER_SCRIPT_PREFIX_RE = /\b(?:(?:bun|yarn|pnpm)(?:\s+run)?|npm\s+run)\s+/gu
const SCRIPT_NAME_CONTINUATION_RE = /[\w-]/u

// `lint-<suffix>` → rule-id канонічного `n-cursor lint <rule-id>`; bare `lint` → без rule-id.
const SURFACE_MAP = { image: 'image-compress' }

/**
 * @param {string} scriptName напр. `lint-js`, `lint`
 * @returns {string} суфікс аргументу для `n-cursor lint` (порожній рядок для bare `lint`)
 */
function surfaceArgFor(scriptName) {
  const suffix = scriptName.slice('lint'.length)
  if (suffix.length === 0) return ''
  const normalized = suffix.startsWith('-') ? suffix.slice(1) : suffix
  return ` ${SURFACE_MAP[normalized] ?? normalized}`
}

/**
 * Знаходить діапазони виклику package-manager-ом заданого npm-скрипта: `bun[ run] X`,
 * `yarn[ run] X`, `pnpm[ run] X`, `npm run X` (голий `npm X` — не валідний npm-синтаксис,
 * окрім start/test). Right-boundary — НЕ `\b` (hyphen — non-word char, тож `lint\b`
 * матчить всередині `lint-js`), а перевірка проти `[\w-]`, щоб `lint` не «зжирав»
 * префікс `lint-js`.
 * @param {string} content вміст для пошуку
 * @param {string} scriptName ім'я npm-скрипта
 * @returns {Array<[number, number]>} діапазони повного виклику в content
 */
function invocationRanges(content, scriptName) {
  /** @type {Array<[number, number]>} */
  const ranges = []
  PACKAGE_MANAGER_SCRIPT_PREFIX_RE.lastIndex = 0
  let match
  while ((match = PACKAGE_MANAGER_SCRIPT_PREFIX_RE.exec(content))) {
    const scriptStart = PACKAGE_MANAGER_SCRIPT_PREFIX_RE.lastIndex
    if (!content.startsWith(scriptName, scriptStart)) continue
    const scriptEnd = scriptStart + scriptName.length
    if (SCRIPT_NAME_CONTINUATION_RE.test(content[scriptEnd] ?? '')) continue
    ranges.push([match.index, scriptEnd])
  }
  return ranges
}

/**
 * Читає JSON-файл template-а з deny-полями концерну; відсутній/невалідний → {}.
 * @param {string} path абсолютний шлях
 * @returns {Record<string, string>} мапа `field -> reason`
 */
function readDenyTemplate(path) {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

/**
 * `workflow`/`package-json` — відомий, безпечно переписуваний формат; `other` — будь-який
 * інший текстовий файл (Makefile, README, shell-скрипт…), де ми ЛИШЕ детектуємо виклик,
 * але не переписуємо (немає надійного canonical-заміщення для довільного формату).
 * @typedef {'workflow'|'package-json'|'other'} FileKind
 */

/**
 * @param {string} rel posix-відносний шлях від кореня репо
 * @param {string} abs абсолютний шлях
 * @param {string} rootPkgAbs абсолютний шлях кореневого package.json (сам він — не кандидат)
 * @returns {FileKind|null} категорія файлу, або null якщо файл взагалі не кандидат (лок-файли)
 */
function classifyCandidate(rel, abs, rootPkgAbs) {
  if (LOCKFILE_RE.test(rel)) return null
  if (WORKFLOW_YML_RE.test(rel)) return 'workflow'
  if (rel.endsWith('package.json')) return abs === rootPkgAbs ? null : 'package-json'
  return 'other'
}

/**
 * Знаходить УСІ файли репозиторію (крім кореневого package.json і лок-файлів) як кандидатів
 * на пошук викликів npm-скриптів — виклик може бути де завгодно (Makefile, README, CI,
 * інший package.json), не лише у відомих форматах.
 * @param {string} cwd абсолютний корінь репозиторію
 * @param {string} rootPkgAbs абсолютний шлях кореневого package.json (виключити)
 * @returns {Promise<Array<{ abs: string, kind: FileKind }>>} кандидати з категорією
 */
async function findUsageCandidateFiles(cwd, rootPkgAbs) {
  const ignorePaths = await loadCursorIgnorePaths(cwd)
  /** @type {Array<{ abs: string, kind: FileKind }>} */
  const out = []
  await walkDir(
    cwd,
    abs => {
      const rel = abs
        .slice(cwd.length + 1)
        .split('\\')
        .join('/')
      const kind = classifyCandidate(rel, abs, rootPkgAbs)
      if (kind) out.push({ abs, kind })
    },
    ignorePaths
  )
  return out
}

/**
 * Переписує один файл-кандидат: кожен знайдений виклик `scriptName` замінюється на
 * канонічний `bunx n-cursor lint<surface>` (workflow yml — з `--no-fix`, package.json
 * scripts-чейни — без, дев-контекст хоче autofix).
 * @param {string} content вміст файлу
 * @param {string} scriptName ім'я lint-скрипта
 * @param {boolean} isWorkflow чи це workflow yml (інакше — package.json)
 * @returns {{ content: string, matched: boolean }} новий вміст і чи був матч
 */
function rewriteUsages(content, scriptName, isWorkflow) {
  const ranges = invocationRanges(content, scriptName)
  if (ranges.length === 0) return { content, matched: false }
  const canonical = `bunx n-cursor lint${surfaceArgFor(scriptName)}${isWorkflow ? ' --no-fix' : ''}`
  let next = ''
  let lastIndex = 0
  for (const [start, end] of ranges) {
    next += content.slice(lastIndex, start) + canonical
    lastIndex = end
  }
  next += content.slice(lastIndex)
  return { content: next, matched: true }
}

/**
 * Для кожного lint-скрипта шукає й переписує його виклики по всіх кандидатах.
 * `workflow`/`package-json` — переписуємо на канонічний `bunx n-cursor lint`; `other`
 * (Makefile, README, довільний shell) — лише детектуємо, без canonical-заміщення для
 * довільного формату скрипт НЕ видаляємо (блокуючий, а не мовчки проігнорований, збіг).
 * @param {string[]} scriptNames кандидати на видалення (`lint`, `lint-js`, …)
 * @param {Array<{ abs: string, kind: FileKind }>} candidateFiles файли-кандидати з категорією
 * @param {(absPath: string) => void} recordWrite реєстрація запису для rollback
 * @returns {{ safeToRemove: Set<string>, touchedFiles: string[] }} скрипти без залишкових
 *   викликів (безпечно видалити) і список фактично змінених файлів
 */
function adaptUsages(scriptNames, candidateFiles, recordWrite) {
  const unresolved = new Set()
  const touchedFiles = []
  const sortedNames = scriptNames.toSorted((a, b) => b.length - a.length)

  for (const { abs, kind } of candidateFiles) {
    if (kind === 'other') continue
    const isWorkflow = kind === 'workflow'
    let content
    try {
      content = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    let next = content
    // Найдовші імена першими (defense-in-depth поряд із right-boundary lookahead) —
    // `lint-js` перепишеться до того, як коротший `lint` встигне зачепити його префікс.
    for (const name of sortedNames) next = rewriteUsages(next, name, isWorkflow).content
    if (next === content) continue
    recordWrite?.(abs)
    writeFileSync(abs, next)
    touchedFiles.push(abs)
  }

  // Другий прохід (після переписів) — чи лишився десь виклик, який ми не розпізнали
  // (`other`-формат або невідомий package-manager-синтаксис); такий скрипт НЕ видаляємо.
  for (const { abs } of candidateFiles) {
    let content
    try {
      content = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    for (const name of scriptNames) {
      if (invocationRanges(content, name).length > 0) unresolved.add(name)
    }
  }

  return { safeToRemove: new Set(scriptNames.filter(n => !unresolved.has(n))), touchedFiles }
}

/**
 * Адаптує виклики lint-скриптів в ІНШИХ скриптах ТОГО Ж package.json (напр. `precommit`:
 * `bun run lint-js && bun test`) — цей файл не потрапляє у зовнішній `findUsageCandidateFiles`,
 * бо він же ціль видалення. Мутує `pkg.scripts` на місці.
 * @param {object} pkg розпарсений package.json (мутується)
 * @param {string[]} scriptNames кандидати на видалення
 * @returns {Set<string>} імена, для яких лишився нерозпізнаний виклик у власних скриптах
 */
function adaptOwnScripts(pkg, scriptNames) {
  const unresolved = new Set()
  if (!pkg.scripts || typeof pkg.scripts !== 'object') return unresolved

  const sorted = scriptNames.toSorted((a, b) => b.length - a.length)
  const otherEntries = Object.entries(pkg.scripts).filter(
    ([key, value]) => !scriptNames.includes(key) && typeof value === 'string'
  )

  for (const [key, value] of otherEntries) {
    let next = value
    for (const name of sorted) next = rewriteUsages(next, name, false).content
    if (next !== value) pkg.scripts[key] = next
  }
  // Пере-перевірка після мутації: чи лишився десь нерозпізнаний виклик.
  for (const [key] of otherEntries) {
    const current = pkg.scripts[key]
    if (typeof current !== 'string') continue
    for (const name of scriptNames) {
      if (invocationRanges(current, name).length > 0) unresolved.add(name)
    }
  }
  return unresolved
}

/**
 * Видаляє заборонені top-level поля й `scripts.lint*` (лише ті, чиї виклики вже адаптовано)
 * з `package.json`.
 * @param {object} pkg розпарсений package.json
 * @param {Record<string, string>} denyFields канон заборонених top-level полів
 * @param {Set<string>} safeToRemove скрипти без залишкових зовнішніх викликів
 * @returns {string[]} список видалених ключів (для message)
 */
function stripDenied(pkg, denyFields, safeToRemove) {
  const removed = []
  for (const field of Object.keys(denyFields)) {
    if (!Object.hasOwn(pkg, field)) continue
    delete pkg[field]
    removed.push(field)
  }
  if (pkg.scripts && typeof pkg.scripts === 'object') {
    for (const name of Object.keys(pkg.scripts)) {
      if (!LINT_SCRIPT_RE.test(name) || !safeToRemove.has(name)) continue
      delete pkg.scripts[name]
      removed.push(`scripts.${name}`)
    }
  }
  return removed
}

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'bun-package_json-strip-denied',
    test: violations => violations.some(v => v.reason === 'policy-deny' && v.file),
    apply: async (violations, ctx) => {
      const denyFields = readDenyTemplate(join(ctx.concernDir ?? '', 'template', 'package.json.deny.json'))
      const files = [...new Set(violations.filter(v => v.file).map(v => v.file))]
      const touchedFiles = []
      const messages = []

      for (const rel of files) {
        const abs = join(ctx.cwd, rel)
        let pkg
        try {
          pkg = JSON.parse(readFileSync(abs, 'utf8'))
        } catch {
          continue
        }

        const lintScriptNames =
          pkg.scripts && typeof pkg.scripts === 'object'
            ? Object.keys(pkg.scripts).filter(n => LINT_SCRIPT_RE.test(n))
            : []

        let safeToRemove = new Set(lintScriptNames)
        if (lintScriptNames.length > 0) {
          const ownUnresolved = adaptOwnScripts(pkg, lintScriptNames)
          const candidateFiles = await findUsageCandidateFiles(ctx.cwd, abs)
          const adapted = adaptUsages(lintScriptNames, candidateFiles, ctx.recordWrite)
          safeToRemove = new Set([...adapted.safeToRemove].filter(n => !ownUnresolved.has(n)))
          touchedFiles.push(...adapted.touchedFiles)
          const skipped = lintScriptNames.filter(n => !safeToRemove.has(n))
          if (skipped.length > 0) {
            messages.push(
              `${rel}: не видаляю scripts.${skipped.join(', scripts.')} — знайдено нерозпізнаний виклик деінде`
            )
          }
        }

        const removed = stripDenied(pkg, denyFields, safeToRemove)
        if (removed.length === 0) continue

        ctx.recordWrite?.(abs)
        writeFileSync(abs, `${JSON.stringify(pkg, null, 2)}\n`)
        touchedFiles.push(abs)
        messages.push(`${rel}: -${removed.join(', -')}`)
      }

      return touchedFiles.length > 0 ? { touchedFiles, message: messages.join('; ') } : { touchedFiles: [] }
    }
  }
]
