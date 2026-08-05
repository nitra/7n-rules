/**
 * lint-поверхня security/tracked_symlink: read-only detector symlink-ів, що відстежуються
 * git-ом і вказують ЗА МЕЖІ репозиторію — абсолютним шляхом (`/private/tmp/…`, `C:\…`)
 * або відносним, що виходить вгору за корінь (`../../…`).
 *
 * Навіщо. Такий symlink несе шлях, специфічний для машини автора, у всі клони: у чужому
 * checkout-і збірка пише артефакти кудись у чужу теку (або нікуди), а тести, що шукають
 * артефакти за `<repo>/<path>/…`, стають недетермінованими. Класичний випадок цього репо —
 * коміт 867ff7b3, який приніс `target -> /private/tmp/claude-501/cargo-target-…`;
 * `.gitignore` не рятує, бо ignore не покриває вже відстежені шляхи.
 *
 * Фіксу немає (авто-правка symlink-а — здогадка про намір автора): detector лише сигналить
 * і друкує готову команду прибирання з індексу.
 */
import { posix } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { spawnAsync } from '../../../scripts/utils/spawn-async.mjs'

/** Режим symlink-запису в git-індексі (`git ls-files -s`). */
const SYMLINK_MODE = '120000'

/** `<mode> <sha> <stage>\t<path>` — рядок `git ls-files -s -z` (роздільник записів `\0`). */
const LS_FILES_ENTRY_RE = /^(?<mode>\d{6}) (?<sha>[0-9a-f]+) (?<stage>\d)\t(?<path>.+)$/su

/** Windows-шлях із літерою диска (`C:\…`, `C:/…`) — теж абсолютний, хоч `isAbsolute` на POSIX так не вважає. */
const WINDOWS_DRIVE_RE = /^[a-z]:[/\\]/iu

/**
 * Чи є ціль symlink-а абсолютним шляхом у будь-якій із двох конвенцій.
 * Перевірка суто текстова (без доступу до ФС) — щоб вердикт не залежав від
 * машини, на якій виконується lint.
 * @param {string} target ціль symlink-а, як вона записана в git-індексі
 * @returns {boolean} true, якщо ціль абсолютна
 */
function isAbsoluteTarget(target) {
  return posix.isAbsolute(target) || WINDOWS_DRIVE_RE.test(target)
}

/**
 * Чи виходить відносна ціль symlink-а за корінь репозиторію.
 * Рахується арифметикою шляхів від теки самого symlink-а — без `realpath`, тож
 * результат однаковий у будь-якому checkout-і.
 * @param {string} linkPath posix-relative шлях symlink-а від кореня репо
 * @param {string} target ціль symlink-а з git-індексу (відносний шлях)
 * @returns {boolean} true, якщо ціль лежить поза деревом репо
 */
function escapesRepoRoot(linkPath, target) {
  // Корінь навмисно синтетичний: обчислення не торкається ФС, тож той самий symlink
  // дає той самий вердикт на будь-якій машині й у будь-якому checkout-і.
  const root = '/repo'
  const resolved = posix.resolve(root, posix.dirname(linkPath), target)
  return resolved !== root && !resolved.startsWith(`${root}/`)
}

/**
 * Розбирає `\0`-розділений вивід `git ls-files -s -z` у symlink-записи.
 * @param {string} stdout сирий stdout `git ls-files -s -z`
 * @returns {{ sha: string, path: string }[]} лише записи з режимом 120000
 */
function parseSymlinkEntries(stdout) {
  /** @type {{ sha: string, path: string }[]} */
  const entries = []
  for (const record of stdout.split('\0')) {
    if (record.length === 0) continue
    const groups = LS_FILES_ENTRY_RE.exec(record)?.groups
    if (!groups || groups.mode !== SYMLINK_MODE) continue
    entries.push({ sha: groups.sha, path: posix.normalize(groups.path) })
  }
  return entries
}

/**
 * Detector security/tracked_symlink: жоден відстежений symlink не має вказувати за межі репо.
 * Поза git-робочим деревом (немає `git` у PATH або каталог не є репо) перевірка пропускається —
 * її предмет, індекс git, там просто відсутній.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат detector-а
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const cwd = ctx.cwd

  const git = resolveCmd('git')
  if (!git) {
    return {
      violations: [],
      diagnostics: [
        { level: 'info', message: 'security/tracked_symlink: `git` не знайдено в PATH — перевірку пропущено' }
      ]
    }
  }

  const listed = await spawnAsync(git, ['ls-files', '-s', '-z'], { cwd, signal: ctx.signal })
  if (listed.exitCode !== 0) {
    return {
      violations: [],
      diagnostics: [{ level: 'info', message: 'security/tracked_symlink: не git-робоче дерево — перевірку пропущено' }]
    }
  }

  const entries = parseSymlinkEntries(listed.stdout)
  for (const entry of entries) {
    // Ціль читається з git-індексу, а не через readlink робочого дерева: перевіряємо
    // саме те, що поїде у чужий клон. Symlink-ів у здоровому дереві одиниці, тож
    // послідовний cat-file на запис дешевший за розбір бінарного `cat-file --batch`.
    const blob = await spawnAsync(git, ['cat-file', 'blob', entry.sha], { cwd, signal: ctx.signal })
    if (blob.exitCode !== 0) continue
    // Хвостові переводи рядка зрізаємо циклом, а не регексом: `/\n+$/`
    // позначений як super-linear (backtracking), а `trimEnd()` зʼїв би ще й
    // пробіли — а вони в цілі симлінка значущі.
    let target = blob.stdout
    while (target.endsWith('\n')) target = target.slice(0, -1)
    if (target.length === 0) continue

    const absolute = isAbsoluteTarget(target)
    if (!absolute && !escapesRepoRoot(entry.path, target)) continue

    const kind = absolute ? 'абсолютний шлях' : 'шлях за межами репо'
    fail(
      `security/tracked_symlink: відстежений symlink \`${entry.path}\` → \`${target}\` (${kind}) — ` +
        'у чужому клоні він указує в неіснуючу або чужу теку, роблячи збірку й тести недетермінованими. ' +
        `Прибери його з індексу: \`git rm --cached ${entry.path}\` і додай \`${entry.path}\` у .gitignore ` +
        '(патерн БЕЗ кінцевого слеша — git не ходить за symlink-ом і бачить його як file-entry)',
      { reason: absolute ? 'absolute-target' : 'escapes-repo', file: entry.path, data: { target } }
    )
  }

  return reporter.result()
}
