/**
 * T0-autofix для policy-concern-а `bun/package_json`: видаляє заборонені top-level поля
 * (канон — `template/package.json.deny.json`, той самий `data.template.deny`, що бачить rego)
 * і `scripts.lint` / `scripts.lint-*` (bun.mdc — лінт лише через `n-rules lint`, не npm-скрипти).
 *
 * Просте видалення `scripts.lint*` небезпечне: якщо десь у репо (workflow yml, інший
 * npm-скрипт) є виклик `bun run lint-js` тощо, видалення ключа зламає цей виклик.
 * Тому перед видаленням шукаємо всі виклики кожного lint-скрипта репо-вайд і переписуємо
 * їх на прямий `bunx n-rules lint <surface>` (canonical — той самий, що вимагають
 * lint_js_yml/lint_style_yml). Скрипт видаляється лише якщо ВСІ його виклики вдалось
 * переписати (файли, де виклик не розпізнано — залишаємо як є, скрипт теж лишається,
 * щоб не зламати консьюмера мовчки).
 *
 * ## Атомарність: спершу ПЛАН, потім запис
 *
 * Цей фікс пише у ЧУЖІ файли репозиторію консюмера (workflow yml, вкладені
 * package.json), тож напівзастосований результат тут коштує дорожче за звичайний.
 * Тому весь прохід розділено на дві фази — рівно як native-фікси ядра
 * (`crates/rules-core/src/concerns/fix.rs`), що рахують план і віддають його хосту:
 *
 *   1. **План (read-only).** Скануємо репо, зʼясовуємо, ЯКІ скрипти взагалі можна
 *      видалити (жодного нерозпізнаного виклику), рахуємо повний перелік видалень і
 *      весь новий вміст кожного файлу — у памʼяті, без жодного `writeFileSync`.
 *   2. **Застосування.** Якщо видаляти нічого — не пишемо НІЧОГО (раніше чужі workflow
 *      вже були переписані, а мутація `pkg.scripts` мовчки викидалась). Інакше пишемо
 *      весь план цілком.
 *
 * Наслідок: виклики переписуються ВИКЛЮЧНО для тих скриптів, які цей самий прохід
 * реально видаляє. Заблокований скрипт лишається — і його виклики теж лишаються
 * недоторканими; про кожен такий блок повідомляємо гучно (`console.error` + message),
 * а не мовчазним успіхом.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { walkDir } from '@7n/rules/scripts/utils/walkDir.mjs'
import { loadCursorIgnorePaths } from '@7n/rules/scripts/lib/load-cursor-config.mjs'

const LINT_SCRIPT_RE = /^lint(-.*)?$/u
const WORKFLOW_YML_RE = /^\.github\/workflows\/.*\.ya?ml$/u
const LOCKFILE_RE = /(^|\/)(bun\.lockb?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/u
const PACKAGE_MANAGER_SCRIPT_PREFIX_RE = /\b(?:(?:bun|yarn|pnpm)(?:\s+run)?|npm\s+run)\s+/gu
const SCRIPT_NAME_CONTINUATION_RE = /[\w-]/u
/** Перший ключ обʼєкта з власним відступом — джерело правди про стиль файлу. */
const FIRST_KEY_INDENT_RE = /\n([ \t]+)"/u

// `lint-<suffix>` → rule-id канонічного `n-rules lint <rule-id>`; bare `lint` → без rule-id.
const SURFACE_MAP = { image: 'image-compress' }

/**
 * @param {string} scriptName напр. `lint-js`, `lint`
 * @returns {string} суфікс аргументу для `n-rules lint` (порожній рядок для bare `lint`)
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
 * Читає JSON-файл template-а з deny-полями концерну.
 *
 * Fail-loud: відсутній, нечитний чи не-обʼєктний шаблон раніше деградував у `{}` —
 * тобто фікс тихо звітував успіх, не видаливши жодного забороненого поля. Шаблон
 * їде в пакеті поруч із концерном, тож його відсутність — зламана інсталяція, а не
 * штатний стан; сигналимо помилкою (той самий контракт, що
 * `fix-storybook-vitest-config.mjs` для свого template-а).
 * @param {string|undefined} concernDir абсолютний шлях теки концерну (`ctx.concernDir`)
 * @returns {Record<string, string>} мапа `field -> reason`
 * @throws {Error} якщо `concernDir` не передано, шаблон відсутній або не парситься
 */
function readDenyTemplate(concernDir) {
  if (!concernDir) {
    throw new Error('bun/package_json: ctx.concernDir не передано — deny-template концерну не резолвиться')
  }
  const path = join(concernDir, 'template', 'package.json.deny.json')
  if (!existsSync(path)) {
    throw new Error(`bun/package_json: deny-template відсутній (${path}) — канон заборонених полів недоступний`)
  }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`bun/package_json: deny-template не парситься (${path}): ${error.message}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`bun/package_json: deny-template має бути JSON-обʼєктом (${path})`)
  }
  return parsed
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
 * канонічний `bunx n-rules lint<surface>` (workflow yml — з `--no-fix`, package.json
 * scripts-чейни — без, дев-контекст хоче autofix).
 * @param {string} content вміст файлу
 * @param {string} scriptName ім'я lint-скрипта
 * @param {boolean} isWorkflow чи це workflow yml (інакше — package.json)
 * @returns {{ content: string, matched: boolean }} новий вміст і чи був матч
 */
function rewriteUsages(content, scriptName, isWorkflow) {
  const ranges = invocationRanges(content, scriptName)
  if (ranges.length === 0) return { content, matched: false }
  const canonical = `bunx n-rules lint${surfaceArgFor(scriptName)}${isWorkflow ? ' --no-fix' : ''}`
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
 * Читає файл, повертаючи `null` замість кидання (нечитний кандидат просто випадає
 * з розгляду — і з детекту викликів, і з плану переписів).
 * @param {string} abs абсолютний шлях
 * @returns {string|null} вміст або null
 */
function readTextOrNull(abs) {
  try {
    return readFileSync(abs, 'utf8')
  } catch {
    return null
  }
}

/**
 * Імена скриптів від найдовшого до найкоротшого — `lint-js` має переписатись раніше,
 * ніж коротший `lint` встигне зачепити його префікс (defense-in-depth поряд із
 * right-boundary-перевіркою в {@link invocationRanges}).
 * @param {Iterable<string>} names імена скриптів
 * @returns {string[]} відсортовані імена
 */
const byLengthDesc = names => [...names].toSorted((a, b) => b.length - a.length)

/**
 * READ-ONLY-фаза: які з lint-скриптів мають виклик у файлі формату, для якого немає
 * canonical-заміщення (`other` — Makefile, README, довільний shell). Такий скрипт
 * видаляти не можна, тож і його виклики переписувати нема за що.
 * @param {string[]} scriptNames кандидати на видалення
 * @param {Array<{ abs: string, kind: FileKind }>} candidateFiles файли-кандидати
 * @returns {Set<string>} імена, заблоковані нерозпізнаним викликом
 */
function findBlockedScripts(scriptNames, candidateFiles) {
  const blocked = new Set()
  if (scriptNames.length === 0) return blocked
  for (const { abs, kind } of candidateFiles) {
    if (kind !== 'other') continue
    const content = readTextOrNull(abs)
    if (content === null) continue
    for (const name of scriptNames) {
      if (invocationRanges(content, name).length > 0) blocked.add(name)
    }
  }
  return blocked
}

/**
 * Визначає стиль наявного JSON-файлу, щоб перезапис не переформатовував чужий файл:
 * відступ першого ключа й наявність кінцевого переводу рядка.
 * @param {string} raw вихідний текст файлу
 * @returns {{ indent: string|number, trailingNewline: string }} стиль для `JSON.stringify`
 */
function detectJsonFormat(raw) {
  const match = FIRST_KEY_INDENT_RE.exec(raw)
  let trailingNewline = ''
  if (raw.endsWith('\r\n')) trailingNewline = '\r\n'
  else if (raw.endsWith('\n')) trailingNewline = '\n'
  return { indent: match ? match[1] : 2, trailingNewline }
}

/**
 * Серіалізує package.json, зберігаючи форматування вихідного файлу.
 * @param {object} pkg обʼєкт для запису
 * @param {string} raw вихідний текст файлу (джерело стилю)
 * @returns {string} текст для запису
 */
function serializePkg(pkg, raw) {
  const { indent, trailingNewline } = detectJsonFormat(raw)
  return `${JSON.stringify(pkg, null, indent)}${trailingNewline}`
}

/**
 * @typedef {object} FixPlan
 * @property {Array<{ abs: string, content: string }>} edits повний вміст кожного файлу, який треба записати
 * @property {string[]} removed видалені ключі цільового package.json (для message)
 * @property {string[]} blocked lint-скрипти, які лишились через нерозпізнаний виклик
 * @property {string|null} note діагностика, коли план порахувати не вдалось
 */

/**
 * READ-ONLY: рахує ПОВНИЙ план фіксу одного package.json — жодного запису на диск.
 * @param {string} cwd абсолютний корінь репо
 * @param {string} rel posix-відносний шлях цільового package.json
 * @param {Record<string, string>} denyFields канон заборонених top-level полів
 * @returns {Promise<FixPlan>} план (порожні `edits` = писати нічого)
 */
async function computePlan(cwd, rel, denyFields) {
  /** @type {FixPlan} */
  const empty = { edits: [], removed: [], blocked: [], note: null }
  const abs = join(cwd, rel)
  const raw = readTextOrNull(abs)
  if (raw === null) return { ...empty, note: `${rel}: не читається — пропускаю` }
  let pkg
  try {
    pkg = JSON.parse(raw)
  } catch (error) {
    return { ...empty, note: `${rel}: не парситься як JSON (${error.message}) — пропускаю` }
  }

  const hasScripts = pkg.scripts !== null && typeof pkg.scripts === 'object'
  const lintScriptNames = hasScripts ? Object.keys(pkg.scripts).filter(n => LINT_SCRIPT_RE.test(n)) : []
  const candidateFiles = lintScriptNames.length > 0 ? await findUsageCandidateFiles(cwd, abs) : []
  const blocked = findBlockedScripts(lintScriptNames, candidateFiles)

  const removedFields = Object.keys(denyFields).filter(field => Object.hasOwn(pkg, field))
  const removedScripts = lintScriptNames.filter(name => !blocked.has(name))
  const removed = [...removedFields, ...removedScripts.map(name => `scripts.${name}`)]

  // Гейт атомарності: видаляти нічого — отже й переписувати чужі виклики нема за що.
  if (removed.length === 0) return { ...empty, blocked: [...blocked] }

  // ── План правок (усе ще в памʼяті) ──
  const removing = byLengthDesc(removedScripts)
  const nextPkg = structuredClone(pkg)
  if (removing.length > 0 && nextPkg.scripts !== null && typeof nextPkg.scripts === 'object') {
    // Виклики видаленого скрипта всередині ІНШИХ скриптів того ж файлу (напр. `precommit`:
    // `bun run lint-js && bun test`) — цей файл не потрапляє у `findUsageCandidateFiles`,
    // бо він же ціль видалення.
    for (const [key, value] of Object.entries(nextPkg.scripts)) {
      if (removedScripts.includes(key) || typeof value !== 'string') continue
      let next = value
      for (const name of removing) next = rewriteUsages(next, name, false).content
      if (next !== value) nextPkg.scripts[key] = next
    }
  }
  for (const field of removedFields) delete nextPkg[field]
  for (const name of removedScripts) delete nextPkg.scripts[name]

  const edits = [{ abs, content: serializePkg(nextPkg, raw) }]

  // Зовнішні виклики — ВИКЛЮЧНО для скриптів, які цей самий план реально видаляє.
  if (removing.length > 0) {
    for (const { abs: candidateAbs, kind } of candidateFiles) {
      if (kind === 'other') continue
      const content = readTextOrNull(candidateAbs)
      if (content === null) continue
      let next = content
      for (const name of removing) next = rewriteUsages(next, name, kind === 'workflow').content
      if (next !== content) edits.push({ abs: candidateAbs, content: next })
    }
  }

  return { edits, removed, blocked: [...blocked], note: null }
}

/** @type {import('@7n/rules/scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'bun-package_json-strip-denied',
    test: violations => violations.some(v => v.reason === 'policy-deny' && v.file),
    apply: async (violations, ctx) => {
      const denyFields = readDenyTemplate(ctx.concernDir)
      const files = [...new Set(violations.filter(v => v.file).map(v => v.file))]
      const touchedFiles = []
      const messages = []

      for (const rel of files) {
        const plan = await computePlan(ctx.cwd, rel, denyFields)

        if (plan.note) messages.push(plan.note)
        if (plan.blocked.length > 0) {
          const text =
            `${rel}: не видаляю scripts.${plan.blocked.join(', scripts.')} — знайдено нерозпізнаний ` +
            'виклик деінде; виклики цих скриптів лишились недоторканими'
          console.error(`❌ bun/package_json: ${text}`)
          messages.push(text)
        }
        if (plan.edits.length === 0) continue

        // Фаза застосування: план порахований цілком, пишемо його цілком.
        for (const edit of plan.edits) {
          ctx.recordWrite?.(edit.abs)
          writeFileSync(edit.abs, edit.content)
          touchedFiles.push(edit.abs)
        }
        messages.push(`${rel}: -${plan.removed.join(', -')}`)
      }

      const message = messages.join('; ')
      return message.length > 0 ? { touchedFiles, message } : { touchedFiles }
    }
  }
]
