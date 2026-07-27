/**
 * Generic consumer слоту `ci.artifact@1` для `@7n/rules-ci-github` (spec
 * `2026-07-27-universal-plugin-slots-lang-php-extraction`, §7.2, Фаза 3).
 *
 * `mergeStrategy: "deep-subset"` — GitHub Actions workflow YAML — рекурсивний structural
 * merge: об'єкти мерджаться по ключах (природно покриває "jobs за key" — `jobs` вже keyed
 * object у GH workflow YAML, окремої identity-логіки не треба); scalar-масиви (напр.
 * `on.push.paths`) — ordered set-union без видалення consumer-specific записів; масиви
 * обʼєктів (напр. `steps`) — identity-based: кожен canonical елемент шукається в actual-масиві
 * за першим наявним полем з `id` → `uses` → `name` (spec §7.2), і лише ЙОГО поля мерджаться —
 * решта полів actual-елемента (і сусідні елементи) не чіпаються.
 *
 * Default export сумісний з `loadSlotConsumer` (`plugin-slots.mjs`, spec §3.3): стабільний
 * `id` + `validate(payload)`. Generic rule (`plugins/ci-github/rules/ci_artifact/consume/`)
 * імпортує цей модуль напряму (той самий package) для `diagnose`/`computeFix` — surface-specific
 * методи, не частина universal broker-контракту.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { resolveArtifactTemplatePath, validateCiArtifactPayload } from '@7n/rules/plugin-api'

/** Пріоритет полів-ідентичності для елементів масиву обʼєктів (`steps`), spec §7.2. */
const ARRAY_IDENTITY_KEYS = ['id', 'uses', 'name']

/**
 * Поле-ідентичність canonical-елемента масиву (перше наявне з {@link ARRAY_IDENTITY_KEYS}).
 * @param {unknown} el елемент canonical-масиву
 * @returns {string | null} назва поля або `null`, якщо жодного немає (fallback — позиційний індекс)
 */
function identityKeyOf(el) {
  if (el === null || typeof el !== 'object' || Array.isArray(el)) return null
  for (const k of ARRAY_IDENTITY_KEYS) {
    if (typeof el[k] === 'string') return k
  }
  return null
}

/**
 * Індекс елемента `actual`-масиву з тією самою identity, що й `canonEl` — `null` identity
 * (жодного з id/uses/name) шукає точний structural збіг (JSON-рівність) як fallback.
 * @param {unknown[]} actualArray наявний масив
 * @param {unknown} canonEl canonical-елемент
 * @returns {number} індекс або `-1`
 */
function findIdentityIndex(actualArray, canonEl) {
  const idKey = identityKeyOf(canonEl)
  if (idKey !== null) {
    return actualArray.findIndex(a => a !== null && typeof a === 'object' && a[idKey] === canonEl[idKey])
  }
  return actualArray.findIndex(a => JSON.stringify(a) === JSON.stringify(canonEl))
}

/**
 * Людинозрозумілий опис елемента масиву для тексту порушення.
 * @param {unknown} el елемент canonical-масиву
 * @returns {string} опис
 */
function describeElement(el) {
  const idKey = identityKeyOf(el)
  if (idKey !== null) return `${idKey}: ${JSON.stringify(el[idKey])}`
  return JSON.stringify(el)
}

/**
 * Чи `canon`-масив — масив plain-обʼєктів (identity-branch) на відміну від scalar-масиву
 * (set-union branch). Порожній масив трактуємо як scalar (немає що ідентифікувати).
 * @param {unknown[]} canon canonical-масив
 * @returns {boolean} true — identity-branch
 */
function isObjectArray(canon) {
  return canon.length > 0 && canon.every(e => e !== null && typeof e === 'object' && !Array.isArray(e))
}

/**
 * Diff-гілка масиву обʼєктів (`steps`): identity-match кожного canonical-елемента + рекурсія в
 * знайдений елемент. Винесена окремо — інакше {@link diffDeepSubset} перевищує поріг когнітивної
 * складності лінтера.
 * @param {unknown[]} actual фактичний масив
 * @param {unknown[]} canon canonical-масив обʼєктів
 * @param {string[]} path поточний шлях (для повідомлень)
 * @param {string} here відформатований `path` (кеш — уникає повторного `join`)
 * @param {string[]} out акумулятор повідомлень (мутується)
 * @returns {void}
 */
function diffObjectArrayBranch(actual, canon, path, here, out) {
  for (const c of canon) {
    const idx = findIdentityIndex(actual, c)
    if (idx === -1) {
      out.push(`${here}: відсутній елемент (${describeElement(c)})`)
      continue
    }
    diffDeepSubset(actual[idx], c, [...path, `[${describeElement(c)}]`], out)
  }
}

/**
 * Diff-гілка scalar-масиву (напр. `on.push.paths`): ordered set-subset — кожен canonical
 * елемент має бути присутній десь в `actual` (порядок і зайві consumer-specific записи не
 * порушення).
 * @param {unknown[]} actual фактичний масив
 * @param {unknown[]} canon canonical-масив скалярів
 * @param {string} here відформатований шлях (для повідомлень)
 * @param {string[]} out акумулятор повідомлень (мутується)
 * @returns {void}
 */
function diffScalarArrayBranch(actual, canon, here, out) {
  for (const needle of canon) {
    const present = actual.some(a => JSON.stringify(a) === JSON.stringify(needle))
    if (!present) out.push(`${here}: має містити ${JSON.stringify(needle)}`)
  }
}

/**
 * Рекурсивний deep-subset diff (`mergeStrategy: "deep-subset"`, spec §7.2): кожен шлях
 * canonical-дерева має бути присутній в `actual` з тим самим значенням (об'єкти — рекурсія по
 * ключах canon; scalar-масиви — set-subset; масиви обʼєктів — identity-match + рекурсія в
 * знайдений елемент). Не мутує вхід.
 * @param {unknown} actual фактичне значення з документа
 * @param {unknown} canon canonical-фрагмент
 * @param {string[]} path поточний шлях (для повідомлень)
 * @param {string[]} out акумулятор повідомлень (мутується)
 * @returns {void}
 */
function diffDeepSubset(actual, canon, path, out) {
  if (canon === null || canon === undefined) return
  const here = path.join('.') || '(root)'
  if (Array.isArray(canon)) {
    if (!Array.isArray(actual)) {
      out.push(`${here}: має бути масивом`)
      return
    }
    if (isObjectArray(canon)) diffObjectArrayBranch(actual, canon, path, here, out)
    else diffScalarArrayBranch(actual, canon, here, out)
    return
  }
  if (typeof canon === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) {
      out.push(`${here}: має бути обʼєктом`)
      return
    }
    for (const [k, v] of Object.entries(canon)) diffDeepSubset(actual[k], v, [...path, k], out)
    return
  }
  if (actual !== canon) out.push(`${here}: має бути ${JSON.stringify(canon)} (отримано ${JSON.stringify(actual)})`)
}

/**
 * Merge-гілка масиву обʼєктів (`steps`) у YAML `Document`: identity-match + рекурсія у поля
 * знайденого елемента, або додавання нового елемента, якщо identity не знайдено. Винесена
 * окремо — інакше {@link mergeYamlDocIdentity} перевищує поріг когнітивної складності лінтера.
 * @param {import('yaml').Document} doc YAML-документ (мутується)
 * @param {unknown[]} canon canonical-масив обʼєктів
 * @param {Array<string|number>} path шлях масиву в документі
 * @returns {void}
 */
function mergeObjectArrayBranch(doc, canon, path) {
  for (const c of canon) {
    const existingJs = doc.getIn(path)?.toJS(doc) ?? []
    const idx = findIdentityIndex(existingJs, c)
    if (idx === -1) {
      doc.addIn(path, c)
      continue
    }
    for (const [k, v] of Object.entries(c)) mergeYamlDocIdentity(doc, v, [...path, idx, k])
  }
}

/**
 * Merge-гілка scalar-масиву у YAML `Document`: ordered set-union — додає лише елементи canon,
 * яких ще немає в `actual` (structural JSON-рівність), нічого не видаляє.
 * @param {import('yaml').Document} doc YAML-документ (мутується)
 * @param {unknown[]} canon canonical-масив скалярів
 * @param {Array<string|number>} path шлях масиву в документі
 * @returns {void}
 */
function mergeScalarArrayBranch(doc, canon, path) {
  const existingJs = doc.getIn(path)?.toJS(doc) ?? []
  for (const needle of canon) {
    const present = existingJs.some(a => JSON.stringify(a) === JSON.stringify(needle))
    if (!present) doc.addIn(path, needle)
  }
}

/**
 * Deep-merge `canon` у YAML `Document` за `path` (мутує `doc`) — identity-aware варіант
 * `template-deep-merge.mjs#mergeYamlDoc`: масиви обʼєктів мерджаться за identity (лише поля
 * знайденого елемента), а не «додати ще одну копію, якщо не structurally contained».
 * @param {import('yaml').Document} doc YAML-документ (мутується)
 * @param {unknown} canon canonical-фрагмент на цьому шляху
 * @param {Array<string|number>} path шлях у документі
 * @returns {void}
 */
function mergeYamlDocIdentity(doc, canon, path) {
  if (Array.isArray(canon)) {
    if (!doc.hasIn(path)) doc.setIn(path, doc.createNode([]))
    if (isObjectArray(canon)) mergeObjectArrayBranch(doc, canon, path)
    else mergeScalarArrayBranch(doc, canon, path)
    return
  }
  if (canon !== null && typeof canon === 'object') {
    for (const [k, v] of Object.entries(canon)) mergeYamlDocIdentity(doc, v, [...path, k])
    return
  }
  doc.setIn(path, canon)
}

/**
 * Читає й парсить canonical template (YAML) contribution-у за безпечним шляхом. Не кидає —
 * повертає diagnostic-сумісний результат, узгоджено з фейл-safe стилем `plugin-slots.mjs`.
 * @param {{ packageRoot: string, resourcePath: string | null }} contribution provenance
 * @param {import('@7n/rules/plugin-api').CiArtifactDescriptor} descriptor валідований payload
 * @returns {{ ok: true, canonical: unknown, templateText: string } | { ok: false, reason: string }} результат
 */
export async function loadCanonicalTemplate(contribution, descriptor) {
  const resolved = resolveArtifactTemplatePath(contribution, descriptor)
  if (!resolved.ok) return { ok: false, reason: resolved.reason }
  if (!resolved.exists) return { ok: false, reason: `template не знайдено (${resolved.absPath})` }
  const { parse } = await import('yaml')
  const templateText = readFileSync(resolved.absPath, 'utf8')
  return { ok: true, canonical: parse(templateText), templateText }
}

/**
 * Діагностує один `ci.artifact@1` artifact (mergeStrategy `deep-subset`) проти поточного стану
 * `targetPath` у consumer-репо.
 * @param {{ cwd: string, targetPath: string, canonical: unknown }} args вхід
 * @returns {{ missing: boolean, violations: string[] }} `missing` — файл відсутній (mode-специфічна обробка — рішення викликача); `violations` — mismatch-и, коли файл існує
 */
export async function diagnoseArtifact({ cwd, targetPath, canonical }) {
  const absTarget = join(cwd, targetPath)
  if (!existsSync(absTarget)) return { missing: true, violations: [] }
  const { parse } = await import('yaml')
  let actual
  try {
    actual = parse(readFileSync(absTarget, 'utf8'))
  } catch {
    return { missing: false, violations: [`${targetPath}: не парситься як YAML`] }
  }
  const out = []
  diffDeepSubset(actual, canonical, [], out)
  return { missing: false, violations: out }
}

/**
 * Застосовує T0-фікс одного `ci.artifact@1` artifact-у до `targetPath` (deep-subset,
 * idempotent): файл відсутній → копіюється `templateText` як є; файл існує → identity-aware
 * deep-merge через YAML `Document` (зберігає коментарі/форматування наявного файлу, як
 * `template-deep-merge.mjs`).
 * @param {{ cwd: string, targetPath: string, canonical: unknown, templateText: string, recordWrite?: (absPath: string) => void }} args вхід
 * @returns {Promise<{ touchedFiles: string[] }>} torn-файли (T0Result-сумісно)
 */
export async function applyDeepSubsetFix({ cwd, targetPath, canonical, templateText, recordWrite }) {
  const absTarget = join(cwd, targetPath)
  if (!existsSync(absTarget)) {
    recordWrite?.(absTarget)
    const { mkdirSync } = await import('node:fs')
    mkdirSync(dirname(absTarget), { recursive: true })
    writeFileSync(absTarget, templateText, 'utf8')
    return { touchedFiles: [absTarget] }
  }
  const prevText = readFileSync(absTarget, 'utf8')
  const before = []
  const { parse, parseDocument } = await import('yaml')
  diffDeepSubset(parse(prevText), canonical, [], before)
  if (before.length === 0) return { touchedFiles: [] } // вже канонічний — idempotent no-op

  const doc = parseDocument(prevText)
  if (doc.errors.length > 0) return { touchedFiles: [] } // невалідний YAML — не чіпаємо детермінованим фіксом
  if (canonical !== null && typeof canonical === 'object' && !Array.isArray(canonical)) {
    for (const [k, v] of Object.entries(canonical)) mergeYamlDocIdentity(doc, v, [k])
  }
  const nextText = doc.toString()
  if (nextText === prevText) return { touchedFiles: [] }
  recordWrite?.(absTarget)
  writeFileSync(absTarget, nextText, 'utf8')
  return { touchedFiles: [absTarget] }
}

/** `loadSlotConsumer`-сумісний default export (spec §3.3): стабільний `id` + `validate(payload)`. */
export default {
  id: 'ci-github-artifact',
  /**
   * @param {unknown} payload сирий (розпарсений) `ci.artifact@1` payload
   * @returns {boolean} true — валідний payload
   */
  validate(payload) {
    return validateCiArtifactPayload(payload).ok
  }
}
