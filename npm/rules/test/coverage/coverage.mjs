/**
 * Канонічна команда `n-cursor coverage`: збирає метрики покриття + мутаційного
 * тестування з усіх провайдерів, чиє правило активне в `.n-cursor.json#rules`,
 * агрегує та записує COVERAGE.md у корінь проєкту.
 *
 * Discovery провайдерів — за `.n-cursor.json#rules`: для кожного `ruleId` зі
 * списку шукаємо `npm/rules/<ruleId>/coverage/coverage.mjs` і динамічно
 * імпортуємо. Якщо файлу немає — провайдер для цього правила відсутній (skip
 * silently, не помилка).
 *
 * Лок — прямий виклик `withLock('coverage', steps)`. Один CLI-консумер, один
 * callsite — спільна точка входу не виноситься (YAGNI, див. C4 у
 * specs/2026-05-24-coverage-rule-design.md).
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { applyVerdicts } from '../../../scripts/coverage-classify/apply.mjs'
import { classify } from '../../../scripts/coverage-classify/index.mjs'
import { collectChangedFilesSince, resolveChangedBase } from '../../../scripts/lib/changed-files.mjs'
import { readNCursorConfigLite } from '../../../scripts/lib/read-n-cursor-config-lite.mjs'
import { withLock } from '../../../scripts/utils/with-lock.mjs'

/** Корінь `npm/rules/` — `<rules>/test/coverage` → `<rules>` */
const RULES_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

/**
 * Сума двох coverage-totals.
 * @param {{lines:{covered:number,total:number}, functions:{covered:number,total:number}}} a перший subtotal
 * @param {{lines:{covered:number,total:number}, functions:{covered:number,total:number}}} b другий subtotal
 * @returns {{lines:{covered:number,total:number}, functions:{covered:number,total:number}}} сумарні lines/functions
 */
export function addCoverage(a, b) {
  return {
    lines: { covered: a.lines.covered + b.lines.covered, total: a.lines.total + b.lines.total },
    functions: {
      covered: a.functions.covered + b.functions.covered,
      total: a.functions.total + b.functions.total
    }
  }
}

/**
 * Сума двох mutation-counts.
 * @param {{caught:number,total:number}} a перший subtotal
 * @param {{caught:number,total:number}} b другий subtotal
 * @returns {{caught:number,total:number}} сумарні caught/total
 */
export function addMutation(a, b) {
  return { caught: a.caught + b.caught, total: a.total + b.total }
}

/**
 * Форматує covered/total як `XX.XX% (covered/total)`.
 * @param {{covered:number,total:number}} metric метрика lines або functions
 * @returns {string} відформатований рядок для таблиці COVERAGE.md
 */
export function formatCoverage({ covered, total }) {
  const percent = total === 0 ? '—' : `${((covered / total) * 100).toFixed(2)}%`
  return `${percent} (${covered}/${total})`
}

/**
 * Форматує мутаційний score як `XX.XX%`.
 * @param {{caught:number,total:number}} metric агрегований mutation score
 * @returns {string} відформатований score або прочерк
 */
export function formatScore({ caught, total }) {
  return total === 0 ? '—' : `${((caught / total) * 100).toFixed(2)}%`
}

/**
 * Рендерить таблицю покриття + мутаційного тестування як Markdown.
 * Якщо будь-який рядок містить непустий `survived`, додає секцію
 * `## Вцілілі мутанти` з JSON-блоком для `/n-coverage-fix`.
 * Якщо `allowedGaps` непустий, додає секцію `## Allowed gaps` з таблицею
 * verdict/confidence/reason для кожного LLM-класифікованого мутанта.
 * Без timestamp, щоб git diff рухався лише при зміні метрик.
 * @param {Array<{area:string, coverage:{lines:{covered:number,total:number},functions:{covered:number,total:number}}, mutation:{caught:number,total:number}, survived?: Array<{file:string,line:number,col:number,mutantType:string,original:string,replacement:string}>}>} rows рядки провайдерів
 * @param {Array<{file:string, mutant:{line:number,col:number,mutantType:string,original:string,replacement:string}, verdict:{verdict:string,confidence:number,reason:string}}>} [allowedGaps] мутанти виключені класифікатором
 * @returns {string} Markdown з заголовком `# Coverage`
 */
export function renderMarkdown(rows, allowedGaps = []) {
  const lines = [
    '# Coverage',
    '',
    '| Область | Рядки | Функції | Вбито мутацій | Score |',
    '| --- | --- | --- | --- | --- |'
  ]
  for (const row of rows) {
    lines.push(
      `| ${row.area} | ${formatCoverage(row.coverage.lines)} | ${formatCoverage(row.coverage.functions)} | ` +
        `${row.mutation.caught}/${row.mutation.total} | ${formatScore(row.mutation)} |`
    )
  }

  const allSurvived = rows.flatMap(r => r.survived ?? [])
  if (allSurvived.length > 0) {
    lines.push('', '## Вцілілі мутанти', '', '```json', JSON.stringify(allSurvived, null, 2), '```')
    // Зрозуміла для людини таблиця
    for (const group of allSurvived) {
      lines.push('', `### ${group.file}`, '', '| Рядок | Оригінал | Заміна | Тип |', '| --- | --- | --- | --- |')
      for (const m of group.mutants) {
        lines.push(`| ${m.line} | \`${m.original}\` | \`${m.replacement}\` | ${m.mutantType} |`)
      }
      if (group.exampleTest) {
        lines.push(
          '',
          `**Приклад тесту** (\`${group.exampleTest.testFile}\`):`,
          '',
          '```js',
          group.exampleTest.code ?? '',
          '```'
        )
      }
      if (group.recommendationText) {
        lines.push('', '**Що треба протестувати:**', '', group.recommendationText)
      }
    }
  }

  if (allowedGaps.length > 0) {
    // Group allowed gaps by file
    const gapsByFile = new Map()
    for (const gap of allowedGaps) {
      if (!gapsByFile.has(gap.file)) gapsByFile.set(gap.file, [])
      gapsByFile.get(gap.file).push(gap)
    }

    lines.push(
      '',
      '## Allowed gaps',
      '',
      `> LLM-класифікатор виключив ${allowedGaps.length} survived мутант(ів) зі знаменника mutation score.`,
      '> Категорії: equivalent (поведінково еквівалентний), defensive (impossible state), glue/wrapper (integration test покриває).'
    )

    for (const [file, gaps] of gapsByFile) {
      lines.push(
        '',
        `### ${file}`,
        '',
        '| Line | Mutant | Verdict | Confidence | Reason |',
        '| --- | --- | --- | --- | --- |'
      )
      for (const { mutant, verdict } of gaps) {
        const sanitizedReason = verdict.reason.replaceAll('|', String.raw`\|`).replaceAll('\n', ' ')
        lines.push(
          `| ${mutant.line} | \`${mutant.original}\` → \`${mutant.replacement}\` | ${verdict.verdict} | ${verdict.confidence.toFixed(2)} | ${sanitizedReason} |`
        )
      }
    }
  }

  return `${lines.join('\n')}\n`
}

/**
 * Завантажує provider-модуль з `<rulesDir>/<ruleId>/coverage/coverage.mjs`.
 * Повертає null коли:
 *   - файлу немає (rule без coverage-провайдера),
 *   - файл існує, але не експортує `detect` + `collect` як функції (наприклад,
 *     `rules/test/coverage/coverage.mjs` — сам оркестратор, не провайдер).
 * @param {string} rulesDir корінь `npm/rules/`
 * @param {string} ruleId id правила з `.n-cursor.json#rules`
 * @returns {Promise<{detect:(cwd:string)=>Promise<boolean>, collect:(cwd:string)=>Promise<Array<object>>}|null>} provider-модуль або null
 */
async function loadProvider(rulesDir, ruleId) {
  const providerPath = join(rulesDir, ruleId, 'coverage', 'coverage.mjs')
  if (!existsSync(providerPath)) return null
  // eslint-disable-next-line no-unsanitized/method -- providerPath з join(rulesDir, ruleId, …), ruleId з конфігу
  const mod = await import(pathToFileURL(providerPath).href)
  if (typeof mod.detect !== 'function' || typeof mod.collect !== 'function') return null
  return mod
}

/**
 * Будує підсумковий рядок «Разом» через сумування всіх coverage/mutation.
 * @param {Array<{area:string, coverage:object, mutation:object}>} rows рядки провайдерів без totals
 * @returns {{area:string, coverage:object, mutation:{caught:number,total:number}}} агрегований рядок «Разом»
 */
function buildTotalsRow(rows) {
  let totalCoverage = { lines: { covered: 0, total: 0 }, functions: { covered: 0, total: 0 } }
  let totalMutation = { caught: 0, total: 0 }
  for (const row of rows) {
    totalCoverage = addCoverage(totalCoverage, row.coverage)
    totalMutation = addMutation(totalMutation, row.mutation)
  }
  return { area: '**Разом**', coverage: totalCoverage, mutation: totalMutation }
}

/**
 * Читає `.n-cursor.json#coverage.classifyConfidenceThreshold` (default 1.1 — rollout mode).
 * @param {string} cwd корінь проєкту
 * @returns {Promise<number>} threshold у [0, 1.1]
 */
async function readClassifyThreshold(cwd) {
  try {
    const raw = await readFile(join(cwd, '.n-cursor.json'), 'utf8')
    const parsed = JSON.parse(raw)
    const t = parsed?.coverage?.classifyConfidenceThreshold
    return typeof t === 'number' && Number.isFinite(t) ? t : 1.1
  } catch {
    return 1.1
  }
}

/**
 * Резолвить scope змінених файлів для `--changed`-режиму.
 *
 * Base — git merge-base поточної гілки з `main` або `origin/main`.
 * `git diff <base>` проти робочого дерева ловить committed і uncommitted однаково,
 * тож scope не залежить від того, чи крок уже закомічено.
 * @param {string} cwd корінь проєкту
 * @returns {{base: string|null, files: string[]}} base-ref і relative-posix список змінених файлів
 */
export function resolveChangedScope(cwd) {
  const base = resolveChangedBase(cwd)
  return { base, files: collectChangedFilesSince(base, cwd) }
}

/**
 * Виконує coverage-pipeline: discovery провайдерів за `.n-cursor.json#rules`,
 * detect+collect для кожного, агрегація, запис COVERAGE.md.
 * При `opts.fix === true` після запису COVERAGE.md запускає агента (coverage-fix.mjs)
 * для написання тестів по вцілілих мутантах.
 * При `opts.changed === true` провайдери звужують scope до змінених від base файлів
 * для швидкого gate. Порожній scope (нема релевантних змін) — це pass (exit 0)
 * без перезапису наявного COVERAGE.md, а НЕ помилка «жодного провайдера».
 * @param {{cwd?:string, rulesDir?:string, fix?:boolean, changed?:boolean}} [opts] ін'єкція cwd/rulesDir для тестів; fix — --fix режим; changed — scope лише змінених
 * @returns {Promise<number>} exit code (0 OK, 1 коли жоден провайдер не дав даних у full-режимі)
 */
export async function runCoverageSteps(opts = {}) {
  const cwd = opts.cwd ?? process.cwd()
  const rulesDir = opts.rulesDir ?? RULES_DIR
  const config = await readNCursorConfigLite(cwd)
  const scope = opts.changed ? resolveChangedScope(cwd) : null
  const collectOpts = scope ? { changedFiles: scope.files, base: scope.base } : {}
  const rows = []

  for (const ruleId of config.rules) {
    if (config.disableRules.includes(ruleId)) continue
    const provider = await loadProvider(rulesDir, ruleId)
    if (!provider) continue
    if (!(await provider.detect(cwd))) continue
    console.log(`→ ${ruleId} coverage…`)
    rows.push(...(await provider.collect(cwd, collectOpts)))
  }

  if (rows.length === 0) {
    // --changed: порожній scope = «нема релевантних змін» → pass, не чіпаємо COVERAGE.md.
    if (opts.changed) {
      console.log('✓ coverage --changed: немає змінених файлів у scope провайдерів — пропускаю')
      return 0
    }
    console.error('✗ Жодного провайдера покриття не знайдено для активних правил у .n-cursor.json#rules')
    return 1
  }

  // --changed (турнікет): рішення гейту визначає лише exit-код — vitest/Stryker кинули б помилку
  // під час collect, якби тести/прогін упали. Тут НЕ перезаписуємо повний COVERAGE.md частковим
  // scoped-звітом і не ганяємо LLM-класифікацію (зайвий кошт у per-step циклі).
  if (opts.changed) {
    console.log('✓ coverage --changed: змінені файли перевірено')
    return 0
  }

  // LLM-класифікація survived мутантів (graceful skip без API key)
  const allSurvived = rows.flatMap(r => r.survived ?? [])
  let augmentedRows = rows
  let allowedGaps = []
  if (allSurvived.length > 0) {
    const verdicts = await classify(allSurvived, cwd)
    if (verdicts.length > 0) {
      const threshold = await readClassifyThreshold(cwd)
      const applied = applyVerdicts(rows, verdicts, threshold)
      augmentedRows = applied.rows
      allowedGaps = applied.allowedGaps
    }
  }

  // Підсумок «Разом» має сенс лише коли провайдерів ≥2; для єдиного рядка він
  // дублює його значення, тож не додаємо.
  if (augmentedRows.filter(r => r.area !== '**Разом**').length > 1) {
    augmentedRows.push(buildTotalsRow(augmentedRows.filter(r => r.area !== '**Разом**')))
  }
  const md = renderMarkdown(augmentedRows, allowedGaps)
  // Stryker disable next-line StringLiteral: equivalent – writeFile(path, str, '') behaves identically to 'utf8' in Node/Bun
  await writeFile(join(cwd, 'COVERAGE.md'), md, 'utf8')
  console.log('✓ COVERAGE.md')

  if (opts.fix) {
    // eslint-disable-next-line no-unsanitized/method -- шлях відносний до пакету, не user-input
    const { fixSurvivedMutants } = await import(new URL('../../../scripts/coverage-fix.mjs', import.meta.url).href)
    await fixSurvivedMutants(allSurvived, cwd)
  }

  return 0
}

/**
 * CLI entrypoint для `n-cursor coverage [--fix] [--changed]`.
 * Із `--fix`: збирає метрики → запускає агента → повторно збирає метрики.
 * Без `--fix`: лише збирає метрики.
 * Із `--changed`: звужує scope до змінених від git merge-base файлів.
 * Лок охоплює кожен coverage-прогін окремо.
 * @param {{fix?:boolean, changed?:boolean}} [opts] прапори --fix / --changed
 * @returns {Promise<number>} exit code
 */
export async function runCoverageCli(opts = {}) {
  const code = await withLock('coverage', () => runCoverageSteps(opts))
  if (code === 0 && opts.fix) {
    console.log('\n♻️  Повторний coverage після агента…\n')
    return withLock('coverage', () => runCoverageSteps({ fix: false, changed: opts.changed }))
  }
  return code
}
