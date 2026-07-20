/** @see ./docs/auto-worktree.md */
import { existsSync, statSync } from 'node:fs'
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { createInterface } from 'node:readline/promises'

const YES_RE = /^y(es)?$/i
const TRAILING_SLASH_RE = /\/$/

/**
 * Питає y/N у терміналі. Поза TTY (CI, неінтерактивний виклик) — одразу `false`,
 * той самий безпечний дефолт, що й раніше (throw), без зависання на порожньому stdin.
 * @param {string} message текст питання (без "[y/N]" — додається тут)
 * @returns {Promise<boolean>} `true` лише на явне "y"/"yes"
 */
async function defaultConfirm(message) {
  if (!process.stdin.isTTY) return false
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(`${message} [y/N] `)
    return YES_RE.test(answer.trim())
  } finally {
    rl.close()
  }
}

/**
 * Гарантує, що подальші кроки виконуються в ізольованому worktree
 * (`main.json.worktree: true`-контракт), навіть коли викликач — детермінований
 * JS-код, що не годує SKILL.md жодному LLM-агенту (тож агентський preflight-блок
 * з `worktree-notice.mjs` нікому виконувати). Якщо `cwd` вже під `.worktrees/` —
 * повертає його без змін. Інакше сам створює `.worktrees/<branch>-<suffix>`
 * (`npx \@7n/mt worktree create`) і ставить залежності (`bun install`).
 *
 * **Гейт на чисте дерево.** Auto-create читає стан і потім переносить зміни
 * назад копіюванням файлів (`bringChangesBackToOriginal`) — а не git merge.
 * Якщо у вихідному `cwd` вже є незакомічені зміни, вони НЕ потраплять у щойно
 * створений worktree (той — checkout HEAD), і перенесення назад мовчки
 * затерло б їх версією з worktree. Тому за замовчуванням (`requireCleanTree:
 * true`) на брудному дереві auto-create питає в терміналі (`deps.confirm`,
 * дефолт — y/N через stdin; поза TTY одразу "ні") дозвіл закомить і
 * запушити зараз через `npx \@7n/n push` (сквош усього робочого дерева в один
 * коміт + push у origin — сама команда підтвердження не питає, тому питаємо
 * ми, ДО виклику). На "ні"/поза TTY — кидає, як і раніше. Викликач, що
 * гарантує чистоту дерева сам (наприклад taze — SKILL.md вимагає цього як
 * передумову ще ДО виклику), може передати `requireCleanTree: false`, щоб не
 * платити за зайву git-команду і не питати підтвердження.
 * @param {string} cwd каталог для перевірки
 * @param {typeof import('node:child_process').spawnSync} spawnFn інжект для тестів
 * @param {(line: string) => void} log колбек прогресу
 * @param {{ suffix: string, description: string, requireCleanTree?: boolean }} opts `suffix` — коротка (до 10 символів) назва задачі для `<branch>-<suffix>`; `description` — текст для `npx \@7n/mt worktree create`
 * @param {{ confirm?: (message: string) => Promise<boolean> }} [deps] `confirm` — інжект для тестів/альтернативного UX (дефолт — `defaultConfirm`, readline y/N)
 * @returns {Promise<{ cwd: string, autoCreated: boolean, branchArg: string|null }>} `autoCreated: false` — `cwd` без змін
 *   (вже worktree); `autoCreated: true` — `cwd` щойно створеного worktree і `branchArg`, з яким його створено
 */
export async function ensureRunningInWorktree(
  cwd,
  spawnFn,
  log,
  { suffix, description, requireCleanTree = true },
  deps = {}
) {
  const toplevelResult = spawnFn('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' })
  const toplevel = toplevelResult.status === 0 ? toplevelResult.stdout.trim() : ''
  const segments = new Set(toplevel.replaceAll('\\', '/').split('/'))
  if (segments.has('.worktrees')) return { cwd, autoCreated: false, branchArg: null }

  const branchResult = spawnFn('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' })
  const currentBranch = branchResult.status === 0 ? branchResult.stdout.trim() : ''
  if (!currentBranch) {
    throw new Error(
      `"${cwd}" не в ізольованому worktree (git toplevel: "${toplevel || '?'}"), і поточну гілку визначити не вдалось ` +
        '(detached HEAD?) — автоматичне створення worktree за конвенцією `<current-branch>-<suffix>` неможливе. Перейди на гілку вручну.'
    )
  }

  if (requireCleanTree) {
    const statusResult = spawnFn('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' })
    if (statusResult.status === 0 && statusResult.stdout.trim().length > 0) {
      const dirtyTreeError = () =>
        new Error(
          `"${cwd}" не в ізольованому worktree і має незакомічені зміни — auto-create worktree тут НЕБЕЗПЕЧНИЙ: ` +
            'перенесення результату назад копіюванням файлів затерло б ці незакомічені правки версією зі свіжого ' +
            'checkout (worktree = HEAD, без твоїх правок). Закомить/застеш зміни або створи worktree вручну.'
        )

      const confirm = deps.confirm ?? defaultConfirm
      const wantsPush = await confirm(
        `"${cwd}" не в ізольованому worktree і має незакомічені зміни — auto-create worktree тут НЕБЕЗПЕЧНИЙ ` +
          '(перенесення назад копіюванням файлів затерло б їх версією зі свіжого checkout). ' +
          'Закомить і запушити зараз через `npx @7n/n push`?'
      )
      if (!wantsPush) throw dirtyTreeError()

      log(`📤 "${cwd}" брудне — запускаю \`npx @7n/n push\` перед auto-create worktree...`)
      runCommand('npx', ['@7n/n', 'push'], cwd, spawnFn)

      const recheckResult = spawnFn('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' })
      if (recheckResult.status !== 0 || recheckResult.stdout.trim().length > 0) {
        throw new Error(`\`npx @7n/n push\` відпрацював, але "${cwd}" усе ще не чисте — перевір вручну (git status).`)
      }
    }
  }

  const branchArg = `${currentBranch}-${suffix}`
  const pathSegment = branchArg.replaceAll('/', '-')
  log(`⚠️ "${cwd}" не в ізольованому worktree — створюю ".worktrees/${pathSegment}"...`)
  runCommand('npx', ['@7n/mt', 'worktree', 'create', branchArg, description], cwd, spawnFn)

  const newCwd = join(cwd, '.worktrees', pathSegment)
  log('📥 bun install (bootstrap нового дерева)...')
  runCommand('bun', ['install'], newCwd, spawnFn)
  return { cwd: newCwd, autoCreated: true, branchArg }
}

/**
 * Рекурсивно копіює вміст директорії (лише файли-листки; підкаталоги
 * створюються по дорозі через `makeDir`). `listDir` — інжектований `readdir`
 * з `{ recursive: true, withFileTypes: true }` (Node ≥20.1): кожен `Dirent`
 * несе `parentPath`/`path` — реальний каталог, у якому файл лежить.
 * @param {string} srcDir директорія-джерело (у worktree)
 * @param {string} destDir директорія-призначення (у оригінальному дереві)
 * @param {{ copy: (src: string, dest: string) => Promise<void>, makeDir: (path: string, opts?: object) => Promise<void>, listDir: (path: string, opts?: object) => Promise<Array<{ name: string, parentPath?: string, path?: string, isFile: () => boolean }>> }} io інжекти
 * @returns {Promise<string[]>} шляхи скопійованих файлів відносно `srcDir` (forward-slash)
 */
async function copyDirectoryRecursive(srcDir, destDir, { copy, makeDir, listDir }) {
  const entries = await listDir(srcDir, { recursive: true, withFileTypes: true })
  const copiedRelPaths = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const entryDir = entry.parentPath ?? entry.path ?? srcDir
    const relFromSrc = relative(srcDir, join(entryDir, entry.name)).replaceAll('\\', '/')
    const dest = join(destDir, relFromSrc)
    await makeDir(dirname(dest), { recursive: true })
    await copy(join(entryDir, entry.name), dest)
    copiedRelPaths.push(relFromSrc)
  }
  return copiedRelPaths
}

/**
 * Переносить зміни з автоствореного worktree назад у вихідне дерево як
 * **untracked/незакомічені** правки (просте копіювання файлів, без git
 * merge/cherry-pick). Джерело істини — `git status --porcelain` у worktree:
 * для кожного шляху копіює файл, якщо він існує (модифікація/додавання), або
 * видаляє його у вихідному дереві, якщо existsSync каже, що в worktree його
 * вже нема (видалення). Перейменування (`old -> new` у porcelain) переносять
 * лише нову назву — стара лишається як була, прийнятний компроміс для
 * інструментів, що самі файли не перейменовують (ефект можливий лише як
 * побічний результат LLM-рефакторингу чи форматера).
 *
 * **Untracked-директорія цілком.** Git схлопує щойно створену untracked
 * директорію в один porcelain-рядок із `/` на кінці (якщо в ній нема жодного
 * файлу, вже відомого git) — `copyFile` на такий шлях впав би (`EISDIR`/`ENOENT`)
 * і обривав би цикл, гублячи все, що йшло по порядку ітерації ДАЛІ. Такий
 * рядок (суфікс `/` або реальний каталог на диску) копіюється рекурсивно
 * (`copyDirectoryRecursive`) — весь вміст, а не один `copyFile`.
 * @param {string} worktreeCwd автостворений worktree, з якого переносимо
 * @param {string} originalCwd вихідне дерево, куди переносимо
 * @param {typeof import('node:child_process').spawnSync} spawnFn інжект для тестів
 * @param {(line: string) => void} log колбек прогресу
 * @param {{ copyFile?: (src: string, dest: string) => Promise<void>, rm?: (path: string, opts?: object) => Promise<void>, mkdir?: (path: string, opts?: object) => Promise<void>, readdir?: (path: string, opts?: object) => Promise<Array<object>> }} [deps] інжекти для тестів
 * @returns {Promise<{ brought: string[], failed: boolean }>} відносні шляхи перенесених файлів і чи стався провал (частковий чи повний)
 */
export async function bringChangesBackToOriginal(worktreeCwd, originalCwd, spawnFn, log, deps = {}) {
  const copy = deps.copyFile ?? copyFile
  const removeFile = deps.rm ?? rm
  const makeDir = deps.mkdir ?? mkdir
  const listDir = deps.readdir ?? readdir

  const statusResult = spawnFn('git', ['status', '--porcelain'], { cwd: worktreeCwd, encoding: 'utf8' })
  if (statusResult.status !== 0) {
    log(
      `⚠️ Не вдалось прочитати git status у "${worktreeCwd}" — зміни НЕ перенесені назад, worktree лишиться для ручного розбору.`
    )
    return { brought: [], failed: true }
  }

  const lines = statusResult.stdout.split('\n').filter(Boolean)
  if (lines.length === 0) {
    log('ℹ️ Worktree без змін — нічого переносити назад.')
    return { brought: [], failed: false }
  }

  const brought = []
  let failed = false
  for (const line of lines) {
    const rest = line.slice(3)
    const relPath = rest.includes(' -> ') ? rest.split(' -> ', 2)[1] : rest
    const srcPath = join(worktreeCwd, relPath)
    const destPath = join(originalCwd, relPath)
    try {
      if (!existsSync(srcPath)) {
        await removeFile(destPath, { force: true, recursive: true })
        brought.push(relPath)
        continue
      }

      const isDir = relPath.endsWith('/') || statSync(srcPath).isDirectory()
      if (isDir) {
        const trimmedRelPath = relPath.replace(TRAILING_SLASH_RE, '')
        const copiedRelPaths = await copyDirectoryRecursive(srcPath, destPath, { copy, makeDir, listDir })
        for (const nestedRelPath of copiedRelPaths) {
          brought.push(`${trimmedRelPath}/${nestedRelPath}`)
        }
      } else {
        await makeDir(dirname(destPath), { recursive: true })
        await copy(srcPath, destPath)
        brought.push(relPath)
      }
    } catch (error) {
      failed = true
      log(
        `⚠️ Не вдалось перенести "${relPath}" назад у "${originalCwd}" — ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
  log(
    failed
      ? `⚠️ Перенесення назад у "${originalCwd}" частково провалилось — перенесено: ${brought.join(', ') || '(нічого)'}`
      : `📤 Перенесено назад у "${originalCwd}" як untracked: ${brought.join(', ')}`
  )
  return { brought, failed }
}

/**
 * Прибирає автостворений worktree разом з його ефемерною git-гілкою
 * (`npx \@7n/mt worktree remove <branch>`) — викликати лише ПІСЛЯ
 * `bringChangesBackToOriginal`, інакше зміни згорять разом з деревом.
 * Не кидає при провалі — це прибирання, а не крок, від якого залежить
 * результат прогону; провал лише логується, worktree лишається для
 * ручного розбору.
 * @param {string} branchArg гілка, з якою worktree був створений (з `ensureRunningInWorktree`)
 * @param {string} originalCwd вихідне дерево, звідки виконати `npx \@7n/mt worktree remove`
 * @param {typeof import('node:child_process').spawnSync} spawnFn інжект для тестів
 * @param {(line: string) => void} log колбек прогресу
 * @returns {void}
 */
export function removeAutoCreatedWorktree(branchArg, originalCwd, spawnFn, log) {
  log(`🧹 Прибираю автостворений worktree "${branchArg}"...`)
  const result = spawnFn('npx', ['@7n/mt', 'worktree', 'remove', branchArg], { cwd: originalCwd, encoding: 'utf8' })
  if (result.status !== 0) {
    log(`⚠️ Не вдалось прибрати worktree "${branchArg}" — приберіть вручну (${result.stderr || result.stdout})`)
  }
}

/**
 * Синхронно виконує детерміновану команду (bunx/bun/npx), кидає з
 * exit-кодом+stderr при провалі.
 * @param {string} cmd бінарник
 * @param {string[]} args аргументи
 * @param {string} cwd робочий каталог
 * @param {typeof import('node:child_process').spawnSync} spawnFn інжект для тестів
 * @returns {string} stdout
 */
function runCommand(cmd, args, cwd, spawnFn) {
  const result = spawnFn(cmd, args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} → exit ${result.status}: ${result.stderr || result.stdout}`)
  }
  return result.stdout
}
