/**
 * fix-worker для `js/eslint`: окрема агентна сесія НА ФАЙЛ замість одного великого промпту
 * на всі файли concern-а одразу. Дефолтний worker (`default-worker.mjs`) шле ВСІ порушення
 * з УСІХ файлів в один `runAgentFix`-виклик — на реальних lint-прогонах (tauri-components)
 * це давало 100% timeout на всіх 4 rung-ах драбини (local-min→cloud-avg), навіть коли
 * порушень було лише 20-90 у 1-3 файлах: одна сесія жонглює кількома файлами одразу і не
 * встигає в rung-таймаут.
 *
 * Файли обробляються ПАРАЛЕЛЬНО (обмежений пул, `MAX_PARALLEL_FILES`), не послідовно —
 * ADR docs/adr/260718-0754-js-eslint-fix-worker-per-session-overhead.md. Профайлінг
 * реального прогону (2026-07-18, trace `runAgentFix`) спростував гіпотезу про фіксовані
 * bootstrap-витрати сесії: `dispatch.test.js` (2 порушення) — 9 раундів моделі, 29.4с;
 * тривіальний фікс так само вимагав багато tool-раундів, а не одноразової плати за bootstrap.
 * Оскільки домінує саме кількість/довжина turn-раундів, а не старт сесії, паралелізм
 * (кілька файлів одночасно замість черги) дає пряме пришвидшення незалежно від причини —
 * секвенційна версія витрачала весь бюджет rung-а на 1 файл, лишаючи іншим 0 шансів
 * навіть стартувати.
 *
 * Rollback-контракт незмінний: `recordWrite` (не durable) на кожен файл — правки наявного
 * стороннього коду. Якщо після worker-а `runRung`-ів canonical re-detect (whole-concern)
 * знайде хоч одне порушення будь-де, увесь rung однаково відкотиться (S1) — той самий
 * контракт, що й у дефолтного worker-а; паралелізм підвищує ймовірність, що ЦЕЙ rung
 * дійде до 0 порушень, а не замінює rollback-семантику. `snapshot.record`/`recordWrite` —
 * синхронні Map-операції без `await` усередині, тож конкурентні виклики безпечні (Node
 * event loop не перериває синхронний блок).
 *
 * Дедлайн (`DEADLINE_FRACTION` від `ctx.timeoutMs`, той самий підхід, що й
 * `doc-files/check/fix-worker.mjs`) гейтить лише СТАРТ нового файлу з черги — не
 * скасовує вже запущені. При files.length ≤ MAX_PARALLEL_FILES усі стартують майже
 * одночасно й отримують практично весь бюджет незалежно один від одного (справжній
 * паралелізм); при більшій кількості — черга природно звужує бюджет пізніших хвиль
 * (`callTimeoutMs` рахується в момент старту, не наперед), не даючи перевищити
 * backstop ×1.25 runner-а.
 * @typedef {import('@7n/rules/scripts/lib/lint-surface/types.mjs').FixWorkerFn} FixWorkerFn
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { anchoredEnabled } from '@7n/rules/scripts/lib/lint-surface/default-worker.mjs'
import { renderViolations } from '@7n/rules/scripts/lib/lint-surface/render.mjs'
import { parseProgramOrNull, walkAstWithAncestors } from '@7n/rules/scripts/utils/ast-scan-utils.mjs'
import { lint } from './main.mjs'

/** Частка ctx.timeoutMs, після якої черга не стартує новий файл (запас до backstop ×1.25). */
const DEADLINE_FRACTION = 0.8

/** Максимум файлів, що обробляються одночасно (без необмеженого burst на великих concern-ах). */
const MAX_PARALLEL_FILES = 4

/**
 * Identity tagged-template теги, що існують ЛИШЕ для editor tooling чи прямої runtime-семантики
 * (`gql` — GraphQL syntax highlighting/`.graphqlrc.yml`, npm/rules/graphql/lib/graphql-gql-scan.mjs;
 * `sql`/`graphql` — реальні runtime tagged templates, `rules/js-bun-db`/`rules/js-mssql`; `html`/`css` —
 * той самий editor-tooling конвенція). LLM-fix регулярно "спрощує" такі identity-функції на
 * `String.raw`/plain template, коли конкретне eslint-порушення поруч технічно цього не потребує —
 * runtime-поведінка ідентична, але ламає tooling/семантику, що спирається саме на тег. Захищено
 * структурним verify-гейтом (`verifyFile` нижче), не лише промптом.
 * @type {Set<string>}
 */
const PROTECTED_TAG_NAMES = new Set(['gql', 'sql', 'graphql', 'html', 'css'])

/** Глобальний regex блоків `<script>` у `.vue` SFC — той самий підхід, що й у graphql-gql-scan.mjs. */
const VUE_SCRIPT_BLOCK_RE = /<script\b[^>]*>([\s\S]*?)<\/script>/giu

/**
 * Вміст для AST-сканування захищених тегів: для `.vue` — лише `<script>`-блоки (теги в
 * `<template>` не мають значення), інакше — весь файл.
 * @param {string} content вихідний код файлу
 * @param {string} relPath відносний шлях (визначає режим)
 * @returns {string} текст для парсингу
 */
function scriptContentForTagScan(content, relPath) {
  if (!relPath.endsWith('.vue')) return content
  VUE_SCRIPT_BLOCK_RE.lastIndex = 0
  const chunks = []
  let m
  while ((m = VUE_SCRIPT_BLOCK_RE.exec(content))) chunks.push(m[1])
  return chunks.join('\n\n')
}

/**
 * Множина захищених tagged-template тегів (`PROTECTED_TAG_NAMES`), знайдених у файлі.
 * Парсинг, що не вдався (синтаксична помилка, бінарний вміст), деградує до порожньої
 * множини — fail-open, як і `graphql-gql-scan.mjs` (консервативно: краще пропустити
 * захист, ніж хибно заблокувати легітимний фікс).
 * @param {string} content вихідний код файлу
 * @param {string} relPath відносний шлях (визначає мову й .vue-режим)
 * @returns {Set<string>} знайдені імена захищених тегів
 */
function protectedTagNamesIn(content, relPath) {
  const scan = scriptContentForTagScan(content, relPath)
  const virtualPath = relPath.endsWith('.vue') ? relPath.replace(/\.vue$/u, '.ts') : relPath
  const program = parseProgramOrNull(scan, virtualPath)
  if (!program) return new Set()
  const found = new Set()
  walkAstWithAncestors(program, [], node => {
    if (node.type === 'TaggedTemplateExpression' && node.tag?.type === 'Identifier' && PROTECTED_TAG_NAMES.has(node.tag.name)) {
      found.add(node.tag.name)
    }
  })
  return found
}

/**
 * Захищені теги файлу з диска. Файл, що не читається (видалений/недоступний), — порожня
 * множина (той самий fail-open принцип, що й `protectedTagNamesIn`).
 * @param {string} cwd абсолютний корінь проєкту
 * @param {string} file posix-relative шлях файлу
 * @returns {Set<string>} знайдені імена захищених тегів
 */
function readProtectedTagsSafe(cwd, file) {
  try {
    return protectedTagNamesIn(readFileSync(resolve(cwd, file), 'utf8'), file)
  } catch {
    return new Set()
  }
}

/**
 * Item-scoped (один файл) canonical re-detect для evidence-гейта `runAgentFix` —
 * НЕ те саме, що whole-concern `ctx.verify` з `runRung` (той перевірив би ВСІ файли
 * concern-а й дав би хибний "не готово" навіть коли саме ЦЕЙ файл уже чистий).
 *
 * Додатково гейтить collateral-видалення захищених tagged-template тегів
 * (`PROTECTED_TAG_NAMES`): якщо файл мав такий тег ДО фіксу, а після фіксу його нема —
 * не ok, навіть якщо саме порушення правила усунено. Той самий verify-feedback-цикл
 * (`runVerifyLoop` у agent-fix.mjs), що й для звичайних порушень.
 * @param {string} cwd абсолютний корінь проєкту
 * @param {string} ruleId id правила
 * @param {string} concernId id concern-а
 * @param {string} file posix-relative шлях файлу, що перевіряється
 * @param {Set<string>} protectedBefore захищені теги файлу до фіксу
 * @returns {Promise<{ ok: boolean, output: string }>} вердикт verify-петлі
 */
async function verifyFile(cwd, ruleId, concernId, file, protectedBefore) {
  const { violations: after } = await lint({ cwd, ruleId, concernId, files: [file] })
  const stamped = after.map(v => ({ ...v, ruleId, concernId }))
  if (stamped.length > 0) return { ok: false, output: renderViolations(stamped) }

  if (protectedBefore.size > 0) {
    const missing = [...protectedBefore].filter(tag => !readProtectedTagsSafe(cwd, file).has(tag))
    if (missing.length > 0) {
      return {
        ok: false,
        output:
          `Файл ${file}: захищений(і) tagged-template тег(и) "${missing.join(', ')}" зник(ли) або підмінений(і) ` +
          '(напр. на String.raw). Це editor-tooling/runtime теги (gql — GraphQL syntax highlighting, ' +
          'sql/graphql — runtime-семантика) — їх не можна видаляти чи підміняти, навіть якщо конкретне ' +
          'порушення правила технічно цього не потребує. Поверни тег(и) на місце і виправ лише реальну причину порушення.'
      }
    }
  }

  return { ok: true, output: '' }
}

/**
 * Обробляє `items` обмеженим пулом воркерів (не більше `MAX_PARALLEL_FILES` одночасно) —
 * власна черга замість `Promise.all(items.map(...))`, щоб великий concern не відкрив
 * необмежену кількість конкурентних агентних сесій одразу.
 * @param {string[]} items елементи черги (шляхи файлів)
 * @param {(item: string) => Promise<void>} worker обробник одного елемента; винятки ловить сам
 * @returns {Promise<void>}
 */
async function runPooled(items, worker) {
  const queue = [...items]
  const runnerCount = Math.min(MAX_PARALLEL_FILES, items.length)
  await Promise.all(
    Array.from({ length: runnerCount }, async () => {
      let item
      while ((item = queue.shift())) {
        await worker(item)
      }
    })
  )
}

/** @type {FixWorkerFn} */
export async function fixWorker(violations, ctx) {
  // lazy import — тримає detect-шлях вільним від pi/oxc (read-only --no-fix не вантажить їх).
  const [{ runAgentFix }, { isLocalModel }, { extractContext }] = await Promise.all([
    import('@7n/llm-lib/agent-fix'),
    import('@7n/llm-lib/model-tiers'),
    import('@7n/rules/scripts/utils/ast-extract.mjs')
  ])

  /** @type {Map<string, import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintViolation[]>} */
  const byFile = new Map()
  for (const v of violations) {
    if (!v.file) continue
    const arr = byFile.get(v.file)
    if (arr) arr.push(v)
    else byFile.set(v.file, [v])
  }
  const files = byFile.keys().toArray()
  if (files.length === 0) return { touchedFiles: [] }

  const deadlineAt = ctx.timeoutMs ? Date.now() + Math.round(ctx.timeoutMs * DEADLINE_FRACTION) : null
  const anchoredEdits = anchoredEnabled(ctx.model, isLocalModel)

  const touchedFiles = []
  await runPooled(files, async file => {
    if (deadlineAt && Date.now() >= deadlineAt) return
    const callTimeoutMs = deadlineAt ? Math.max(1000, deadlineAt - Date.now()) : ctx.timeoutMs
    const protectedBefore = readProtectedTagsSafe(ctx.cwd, file)

    let res
    try {
      res = await runAgentFix(ctx.ruleId, renderViolations(byFile.get(file)), ctx.cwd, {
        model: ctx.model,
        tier: ctx.tier,
        timeoutMs: callTimeoutMs,
        feedback: ctx.feedback ?? null,
        caller: `fix:${ctx.ruleId}/${ctx.concernId}:${ctx.tier}:${file}`,
        recordWrite: ctx.recordWrite,
        chain: ctx.chain ?? null,
        targetFiles: [file],
        ruleText:
          protectedBefore.size > 0
            ? `Файл містить захищений(і) identity tagged-template тег(и) "${[...protectedBefore].join(', ')}" ` +
              '(editor tooling — напр. gql для GraphQL syntax highlighting/.graphqlrc.yml — або runtime-семантика, ' +
              'напр. sql). НЕ видаляй і не підміняй ці теги (напр. на String.raw) і не прибирай їхній імпорт, ' +
              'навіть якщо конкретне порушення нижче технічно цього не потребує — виправляй лише реальну причину порушення.'
            : undefined,
        verify: () => verifyFile(ctx.cwd, ctx.ruleId, ctx.concernId, file, protectedBefore),
        verifyMax: ctx.verifyMax,
        anchoredEdits,
        deps: { astContext: p => extractContext(resolve(ctx.cwd, p)) }
      })
    } catch {
      // Один файл впав винятком — не валимо решту паралельних воркерів у пулі; whole-concern
      // canonical re-detect runner-а (не цей worker) визначить, чи rung закрито.
      return
    }

    if (!res.error) touchedFiles.push(...(res.touchedFiles ?? []))
  })

  return { touchedFiles }
}
