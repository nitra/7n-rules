# Worktree CLI (`n-cursor worktree`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Додати кросплатформну CLI-підкоманду `npx @nitra/cursor worktree add/remove/list/prune` (виконавець конвенції `.worktrees/`), тонкий skill `worktree`, і нормалізувати pure-doc правило `worktree`.

**Architecture:** Чиста логіка (санітизація гілки, шляхи, текст `.md`, виявлення осиротілих) — у `npm/scripts/lib/worktree.mjs` (юніт-тести без git). Оркестрація (парсинг argv, виклики `git`, запис файлів, звіт) — у `npm/scripts/worktree-cli.mjs` (інтеграційні тести на тимчасовому git-репо). Підключення — новий `case 'worktree'` у `npm/bin/n-cursor.js`.

**Tech Stack:** Node ESM (`.mjs`), vitest, `node:child_process` (`spawnSync` git), `node:fs`.

**Канон проєкту (обовʼязково):**

- Кожен новий `.mjs` — багаторядковий верхній JSDoc українською (що робить файл) — `scripts.mdc`.
- Тести співрозташовані: `scripts/lib/<f>.mjs` ↔ `scripts/lib/tests/<f>.test.mjs`; CLI-тест — `scripts/tests/<f>.test.mjs`.
- Команда тестів: `cd npm && npx vitest run <шлях>`.
- **Коміти часті** (після кожної задачі) — тримає `checkDirtyNpmRequiresVersionBump` зеленим (після коміту `git diff HEAD` порожній).
- **Версію/CHANGELOG руками НЕ чіпати** — лише change-файл наприкінці; bump робить CI (n-changelog).
- У тестах **НЕ** використовувати `process.chdir` (канон `n-test.mdc`, `no-process-chdir`) — передавати `cwd` параметром / у `spawnSync`.
- `new Date()` дозволено в продакшн-CLI (заборона лише в workflow-скриптах і тестах); у тестах дата `buildDescription` подається параметром.

**Поточний стан (зафіксовано):**

- Диспетчер `npm/bin/n-cursor.js`: `const command = process.argv[2]`, `const commandArgs = process.argv.slice(3)`; підкоманди — `case '<name>': { process.exitCode = await runXxxCli(commandArgs); break }`. Імпорти підкоманд — рядки ~95-105. `default` друкує перелік відомих команд (рядок ~1535).
- Патерн підкоманди — `npm/scripts/skills-cli.mjs`: `export function runSkillsCli(argv, options = {})` з ін'єкцією `log`/`logError`/`projectDir` для тестів; повертає exit code.
- test-helpers (`npm/scripts/utils/test-helpers.mjs`): `withTmpDir(fn)`, `writeJson(path,data)`, `ensureDir(path)`. **Git-init helper відсутній** — у тестах робити `spawnSync('git', ['init'], { cwd })` напряму.
- Правило-сирота: `.cursor/rules/n-worktrees.mdc` існує **без** джерела `npm/rules/`. `CLAUDE.md:10` має `@.cursor/rules/n-worktrees.mdc`.
- `.worktrees/` уже в `.gitignore`.

---

## Task 1: Чиста логіка `worktree.mjs`

**Files:**

- Create: `npm/scripts/lib/worktree.mjs`
- Test: `npm/scripts/lib/tests/worktree.test.mjs`

- [ ] **Step 1: Написати падаючі тести**

Файл `npm/scripts/lib/tests/worktree.test.mjs`:

```js
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'

import {
  buildDescription,
  findOrphanDescFiles,
  sanitizeBranch,
  worktreePaths
} from '../worktree.mjs'

describe('sanitizeBranch', () => {
  test('слеш → дефіс', () => {
    expect(sanitizeBranch('feat/skill-meta')).toBe('feat-skill-meta')
  })
  test('кілька слешів', () => {
    expect(sanitizeBranch('a/b/c')).toBe('a-b-c')
  })
  test('без слеша — без змін', () => {
    expect(sanitizeBranch('hotfix')).toBe('hotfix')
  })
  test('небезпечні для шляху символи → дефіс', () => {
    expect(sanitizeBranch('feat\\x')).toBe('feat-x')
    expect(sanitizeBranch('a b')).toBe('a-b')
  })
  test('порожній/невалідний → кидає', () => {
    expect(() => sanitizeBranch('')).toThrow()
    expect(() => sanitizeBranch('/')).toThrow()
  })
})

describe('worktreePaths', () => {
  test('детерміновані шляхи від кореня репо', () => {
    const p = worktreePaths('/repo', 'feat/x')
    expect(p.checkout).toBe(join('/repo', '.worktrees', 'feat-x'))
    expect(p.descFile).toBe(join('/repo', '.worktrees', 'feat-x.md'))
  })
})

describe('buildDescription', () => {
  test('містить усі поля за шаблоном', () => {
    const md = buildDescription({
      branch: 'feat/x',
      task: 'зробити Y',
      baseCommit: 'abc1234',
      date: '2026-05-31'
    })
    expect(md).toContain('# feat/x')
    expect(md).toContain('зробити Y')
    expect(md).toContain('2026-05-31')
    expect(md).toContain('abc1234')
    expect(md).toContain('npx @nitra/cursor worktree remove feat/x')
  })
})

describe('findOrphanDescFiles', () => {
  test('повертає .md без відповідного checkout', () => {
    const descFiles = ['/repo/.worktrees/a.md', '/repo/.worktrees/b.md']
    const registeredCheckouts = ['/repo/.worktrees/a']
    expect(findOrphanDescFiles(descFiles, registeredCheckouts)).toEqual(['/repo/.worktrees/b.md'])
  })
  test('усі мають checkout → порожньо', () => {
    expect(findOrphanDescFiles(['/repo/.worktrees/a.md'], ['/repo/.worktrees/a'])).toEqual([])
  })
})
```

- [ ] **Step 2: Запустити — переконатися, що падає**

Run: `cd npm && npx vitest run scripts/lib/tests/worktree.test.mjs`
Expected: FAIL — `Cannot find module '../worktree.mjs'`.

- [ ] **Step 3: Реалізувати `worktree.mjs`**

Файл `npm/scripts/lib/worktree.mjs`:

```js
/**
 * Чиста логіка worktree-tool `n-cursor worktree` (без git/fs side-effects).
 *
 * Тут — детерміновані, тестовані без git функції:
 *  - `sanitizeBranch` — імʼя гілки → безпечне імʼя каталогу/файла (слеш та інші
 *    небезпечні для шляху символи → дефіс), щоб структура `.worktrees/` лишалась пласкою;
 *  - `worktreePaths` — шляхи checkout і файла-опису поруч;
 *  - `buildDescription` — текст інвентарного `.worktrees/<name>.md` за конвенцією worktree.mdc;
 *  - `findOrphanDescFiles` — `.md`-описи без зареєстрованого worktree (для `prune`).
 *
 * Оркестрація (виклики git, запис файлів, argv) — у `npm/scripts/worktree-cli.mjs`.
 */
import { basename, join } from 'node:path'

/** Символи, безпечні для імені каталогу/файла; решта → дефіс. */
const UNSAFE_PATH_CHARS_RE = /[^a-zA-Z0-9._-]+/gu

/**
 * Перетворює імʼя git-гілки на безпечне імʼя каталогу/файла для `.worktrees/`.
 * @param {string} branch імʼя git-гілки (наприклад `feat/skill-meta`)
 * @returns {string} пласке імʼя (наприклад `feat-skill-meta`)
 */
export function sanitizeBranch(branch) {
  if (typeof branch !== 'string' || branch.trim() === '') {
    throw new Error('worktree: імʼя гілки обовʼязкове')
  }
  const sanitized = branch.trim().replace(UNSAFE_PATH_CHARS_RE, '-').replace(/^-+|-+$/gu, '')
  if (sanitized === '') {
    throw new Error(`worktree: імʼя гілки "${branch}" не містить допустимих символів`)
  }
  return sanitized
}

/**
 * Детерміновані шляхи checkout і файла-опису для гілки.
 * @param {string} repoRoot абсолютний корінь репозиторію
 * @param {string} branch імʼя git-гілки
 * @returns {{ checkout: string, descFile: string }} абсолютні шляхи
 */
export function worktreePaths(repoRoot, branch) {
  const name = sanitizeBranch(branch)
  const dir = join(repoRoot, '.worktrees')
  return { checkout: join(dir, name), descFile: join(dir, `${name}.md`) }
}

/**
 * Текст інвентарного файла-опису worktree.
 * @param {{ branch: string, task: string, baseCommit: string, date: string }} params поля опису
 * @returns {string} markdown-вміст `.worktrees/<name>.md`
 */
export function buildDescription({ branch, task, baseCommit, date }) {
  return [
    `# ${branch}`,
    '',
    `**Задача:** ${task}`,
    `**Дата:** ${date}`,
    `**База (коміт):** ${baseCommit}`,
    '',
    'Прибрати: ' + '`' + `npx @nitra/cursor worktree remove ${branch}` + '`',
    ''
  ].join('\n')
}

/**
 * `.md`-описи без відповідного зареєстрованого worktree-checkout.
 * @param {string[]} descFiles абсолютні шляхи `.worktrees/*.md`
 * @param {string[]} registeredCheckouts абсолютні шляхи зареєстрованих worktree-checkout
 * @returns {string[]} осиротілі `.md` (підмножина `descFiles`)
 */
export function findOrphanDescFiles(descFiles, registeredCheckouts) {
  const checkoutBasenames = new Set(registeredCheckouts.map(c => basename(c)))
  return descFiles.filter(md => !checkoutBasenames.has(basename(md).replace(/\.md$/u, '')))
}
```

- [ ] **Step 4: Запустити — переконатися, що проходить**

Run: `cd npm && npx vitest run scripts/lib/tests/worktree.test.mjs`
Expected: PASS (всі кейси).

- [ ] **Step 5: Коміт**

```bash
git add npm/scripts/lib/worktree.mjs npm/scripts/lib/tests/worktree.test.mjs
git commit -m "feat(worktree): чиста логіка sanitizeBranch/worktreePaths/buildDescription/findOrphanDescFiles

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: CLI-оркестратор `worktree-cli.mjs`

**Files:**

- Create: `npm/scripts/worktree-cli.mjs`
- Test: `npm/scripts/tests/worktree-cli.test.mjs`

`runWorktreeCli(argv, options)` — `options` дозволяє ін'єкцію `cwd`/`log`/`logError`/`now` для тестів (патерн `skills-cli.mjs`).

- [ ] **Step 1: Написати падаючі інтеграційні тести**

Файл `npm/scripts/tests/worktree-cli.test.mjs`:

```js
import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { runWorktreeCli } from '../worktree-cli.mjs'
import { withTmpDir } from '../utils/test-helpers.mjs'

/** Ініціалізує git-репо з одним комітом у dir; повертає dir. */
function initRepo(dir) {
  spawnSync('git', ['init', '-q'], { cwd: dir })
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir })
  writeFileSync(join(dir, 'f.txt'), 'x', 'utf8')
  spawnSync('git', ['add', '.'], { cwd: dir })
  spawnSync('git', ['commit', '-qm', 'init'], { cwd: dir })
  return dir
}

const silent = { log: () => {}, logError: () => {} }

describe('runWorktreeCli add', () => {
  test('створює checkout + .md від HEAD', async () => {
    await withTmpDir(async dir => {
      initRepo(dir)
      const code = await runWorktreeCli(['add', 'feat/x', 'зробити Y'], { cwd: dir, ...silent })
      expect(code).toBe(0)
      expect(existsSync(join(dir, '.worktrees', 'feat-x'))).toBe(true)
      const md = readFileSync(join(dir, '.worktrees', 'feat-x.md'), 'utf8')
      expect(md).toContain('# feat/x')
      expect(md).toContain('зробити Y')
    })
  })

  test('без опису → exit 1, нічого не створює', async () => {
    await withTmpDir(async dir => {
      initRepo(dir)
      const code = await runWorktreeCli(['add', 'feat/x'], { cwd: dir, ...silent })
      expect(code).toBe(1)
      expect(existsSync(join(dir, '.worktrees', 'feat-x'))).toBe(false)
    })
  })
})

describe('runWorktreeCli remove', () => {
  test('прибирає checkout + .md, лишає гілку', async () => {
    await withTmpDir(async dir => {
      initRepo(dir)
      await runWorktreeCli(['add', 'feat/x', 'опис'], { cwd: dir, ...silent })
      const code = await runWorktreeCli(['remove', 'feat/x'], { cwd: dir, ...silent })
      expect(code).toBe(0)
      expect(existsSync(join(dir, '.worktrees', 'feat-x'))).toBe(false)
      expect(existsSync(join(dir, '.worktrees', 'feat-x.md'))).toBe(false)
      const branches = spawnSync('git', ['branch'], { cwd: dir, encoding: 'utf8' }).stdout
      expect(branches).toContain('feat/x')
    })
  })
})

describe('runWorktreeCli prune', () => {
  test('видаляє осиротілий .md', async () => {
    await withTmpDir(async dir => {
      initRepo(dir)
      writeFileSync(join(dir, '.worktrees-make'), '', 'utf8') // no-op guard
      // створюємо осиротілий опис вручну
      spawnSync('git', ['worktree', 'prune'], { cwd: dir })
      const wtDir = join(dir, '.worktrees')
      spawnSync('mkdir', ['-p', wtDir])
      writeFileSync(join(wtDir, 'ghost.md'), '# ghost', 'utf8')
      const code = await runWorktreeCli(['prune'], { cwd: dir, ...silent })
      expect(code).toBe(0)
      expect(existsSync(join(wtDir, 'ghost.md'))).toBe(false)
    })
  })
})

describe('runWorktreeCli list', () => {
  test('повертає 0 і не падає на репо без worktree', async () => {
    await withTmpDir(async dir => {
      initRepo(dir)
      const code = await runWorktreeCli(['list'], { cwd: dir, ...silent })
      expect(code).toBe(0)
    })
  })
})

describe('runWorktreeCli usage', () => {
  test('невідома підкоманда → exit 1', async () => {
    await withTmpDir(async dir => {
      initRepo(dir)
      expect(await runWorktreeCli(['bogus'], { cwd: dir, ...silent })).toBe(1)
    })
  })
})
```

- [ ] **Step 2: Запустити — переконатися, що падає**

Run: `cd npm && npx vitest run scripts/tests/worktree-cli.test.mjs`
Expected: FAIL — `Cannot find module '../worktree-cli.mjs'`.

- [ ] **Step 3: Реалізувати `worktree-cli.mjs`**

Файл `npm/scripts/worktree-cli.mjs`:

```js
/**
 * CLI-оркестратор worktree-tool `n-cursor worktree` (виконавець конвенції `.worktrees/`).
 *
 * Підкоманди:
 *   add <branch> "<опис>"   — git worktree add .worktrees/<sanit> -b <branch> (від HEAD) + .md-опис
 *   remove <branch> [--force] — прибрати checkout + .md (гілку лишає)
 *   list                    — git worktree list + вміст .md-описів
 *   prune                   — git worktree prune + видалити осиротілі .md
 *
 * Чисті функції (санітизація, шляхи, текст опису, осиротілі) — у `lib/worktree.mjs`.
 * Тут лише git-виклики, запис файлів, парсинг argv і звіт.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { buildDescription, findOrphanDescFiles, sanitizeBranch, worktreePaths } from './lib/worktree.mjs'

const USAGE = [
  'Usage:',
  '  npx @nitra/cursor worktree add <branch> "<опис>"',
  '  npx @nitra/cursor worktree remove <branch> [--force]',
  '  npx @nitra/cursor worktree list',
  '  npx @nitra/cursor worktree prune'
].join('\n')

/**
 * Запускає git, повертає { status, stdout, stderr }.
 * @param {string[]} args аргументи git
 * @param {string} cwd робочий каталог
 * @returns {{ status: number, stdout: string, stderr: string }} результат
 */
function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/**
 * Поточна дата YYYY-MM-DD (ін'єкція через opts.now для тестів).
 * @param {() => Date} now фабрика дати
 * @returns {string} дата у форматі YYYY-MM-DD
 */
function today(now) {
  return now().toISOString().slice(0, 10)
}

/**
 * Реєстровані worktree-checkout під `.worktrees/` (абсолютні шляхи) з `git worktree list`.
 * @param {string} cwd корінь репо
 * @returns {string[]} абсолютні шляхи checkout
 */
function listRegisteredCheckouts(cwd) {
  const out = git(['worktree', 'list', '--porcelain'], cwd).stdout
  return out
    .split('\n')
    .filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length).trim())
}

/**
 * @param {string} cwd корінь репо
 * @returns {string[]} абсолютні шляхи `.worktrees/*.md`
 */
function listDescFiles(cwd) {
  const dir = join(cwd, '.worktrees')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(n => n.endsWith('.md'))
    .map(n => join(dir, n))
}

/**
 * add: створити worktree від HEAD + .md-опис.
 * @param {string[]} rest [branch, ...descParts]
 * @param {{ cwd: string, log: Function, logError: Function, now: () => Date }} ctx контекст
 * @returns {number} exit code
 */
function cmdAdd(rest, ctx) {
  const [branch, ...descParts] = rest
  const task = descParts.join(' ').trim()
  if (!branch) {
    ctx.logError('worktree add: потрібне імʼя гілки')
    ctx.logError(USAGE)
    return 1
  }
  if (!task) {
    ctx.logError('worktree add: опис обовʼязковий — `worktree add <branch> "<опис>"`')
    return 1
  }
  let paths
  try {
    paths = worktreePaths(ctx.cwd, branch)
  } catch (error) {
    ctx.logError(error.message)
    return 1
  }
  const added = git(['worktree', 'add', paths.checkout, '-b', branch], ctx.cwd)
  if (added.status !== 0) {
    ctx.logError(`worktree add не вдався: ${added.stderr.trim()}`)
    return 1
  }
  const baseCommit = git(['rev-parse', '--short', 'HEAD'], ctx.cwd).stdout.trim()
  const md = buildDescription({ branch, task, baseCommit, date: today(ctx.now) })
  writeFileSync(paths.descFile, md, 'utf8')
  ctx.log(`✅ worktree: ${paths.checkout}`)
  ctx.log(`   опис:    ${paths.descFile}`)
  return 0
}

/**
 * remove: прибрати checkout + .md.
 * @param {string[]} rest [branch, ...flags]
 * @param {{ cwd: string, log: Function, logError: Function }} ctx контекст
 * @returns {number} exit code
 */
function cmdRemove(rest, ctx) {
  const branch = rest.find(a => !a.startsWith('--'))
  const force = rest.includes('--force')
  if (!branch) {
    ctx.logError('worktree remove: потрібне імʼя гілки')
    return 1
  }
  let paths
  try {
    paths = worktreePaths(ctx.cwd, branch)
  } catch (error) {
    ctx.logError(error.message)
    return 1
  }
  const args = ['worktree', 'remove', paths.checkout]
  if (force) args.push('--force')
  const removed = git(args, ctx.cwd)
  if (removed.status !== 0) {
    ctx.logError(`worktree remove не вдався: ${removed.stderr.trim()} (спробуй --force, якщо дерево брудне)`)
    return 1
  }
  if (existsSync(paths.descFile)) rmSync(paths.descFile, { force: true })
  ctx.log(`✅ прибрано: ${paths.checkout} (гілку ${branch} лишено)`)
  return 0
}

/**
 * list: git worktree list + вміст .md-описів.
 * @param {{ cwd: string, log: Function }} ctx контекст
 * @returns {number} exit code
 */
function cmdList(ctx) {
  ctx.log(git(['worktree', 'list'], ctx.cwd).stdout.trimEnd())
  for (const md of listDescFiles(ctx.cwd)) {
    ctx.log(`\n--- ${md} ---`)
    ctx.log(readFileSync(md, 'utf8').trimEnd())
  }
  return 0
}

/**
 * prune: git worktree prune + видалити осиротілі .md.
 * @param {{ cwd: string, log: Function }} ctx контекст
 * @returns {number} exit code
 */
function cmdPrune(ctx) {
  git(['worktree', 'prune'], ctx.cwd)
  const orphans = findOrphanDescFiles(listDescFiles(ctx.cwd), listRegisteredCheckouts(ctx.cwd))
  for (const md of orphans) {
    rmSync(md, { force: true })
    ctx.log(`🧹 видалено осиротілий опис: ${md}`)
  }
  ctx.log(`prune завершено (осиротілих описів: ${orphans.length})`)
  return 0
}

/**
 * Точка входу підкоманди worktree.
 * @param {string[]} argv аргументи після `worktree`
 * @param {{ cwd?: string, log?: Function, logError?: Function, now?: () => Date }} [options] ін'єкція для тестів
 * @returns {Promise<number>} exit code
 */
export function runWorktreeCli(argv, options = {}) {
  const ctx = {
    cwd: options.cwd ?? processCwd(),
    log: options.log ?? (line => console.log(line)),
    logError: options.logError ?? (line => console.error(line)),
    now: options.now ?? (() => new Date())
  }
  const [sub, ...rest] = argv
  switch (sub) {
    case 'add':
      return Promise.resolve(cmdAdd(rest, ctx))
    case 'remove':
      return Promise.resolve(cmdRemove(rest, ctx))
    case 'list':
      return Promise.resolve(cmdList(ctx))
    case 'prune':
      return Promise.resolve(cmdPrune(ctx))
    default:
      ctx.logError(USAGE)
      return Promise.resolve(1)
  }
}
```

> `mkdirSync` імпортовано на випадок, якщо `git worktree add` не створив `.worktrees/` (він створює; але якщо знадобиться для prune-тесту вручну — використовується в тесті, не в коді). Якщо oxlint/knip позначить `mkdirSync` як невикористаний у коді — прибрати з імпорту.

- [ ] **Step 4: Запустити — переконатися, що проходить**

Run: `cd npm && npx vitest run scripts/tests/worktree-cli.test.mjs`
Expected: PASS (add, remove, prune, list, usage).

- [ ] **Step 5: Коміт**

```bash
git add npm/scripts/worktree-cli.mjs npm/scripts/tests/worktree-cli.test.mjs
git commit -m "feat(worktree): CLI-оркестратор add/remove/list/prune

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Підключити `case 'worktree'` у диспетчер

**Files:**

- Modify: `npm/bin/n-cursor.js` (імпорт ~104; новий `case`; рядок переліку команд у `default` ~1537)

- [ ] **Step 1: Додати імпорт**

Після рядка `import { runSkillsCli } from '../scripts/skills-cli.mjs'` (рядок ~104):

```js
import { runWorktreeCli } from '../scripts/worktree-cli.mjs'
```

- [ ] **Step 2: Додати case**

Перед `case 'skill':` додати:

```js
    case 'worktree': {
      process.exitCode = await runWorktreeCli(commandArgs)

      break
    }
```

- [ ] **Step 3: Додати команду в перелік `default`**

У рядку переліку відомих команд (`console.error('   Очікується: …, change, release, skill')`) додати `worktree`:

```js
      console.error(
        `   Очікується: (без аргументів) синхронізація правил, check, rename-yaml-extensions, post-tool-use-fix, lint, lint-ga, lint-rego, lint-k8s, lint-docker, lint-text, coverage, change, release, skill, worktree`
      )
```

- [ ] **Step 4: Перевірити вручну на реальному репо (sibling tmp)**

```bash
cd /tmp && rm -rf wt-smoke && mkdir wt-smoke && cd wt-smoke && git init -q
git config user.email t@t && git config user.name t
echo x > f && git add . && git commit -qm init
node /Users/vitaliytv/www/nitra/cursor/npm/bin/n-cursor.js worktree add feat/demo "перевірка"
echo "exists: $(ls -d .worktrees/feat-demo 2>/dev/null)"
cat .worktrees/feat-demo.md
node /Users/vitaliytv/www/nitra/cursor/npm/bin/n-cursor.js worktree list
node /Users/vitaliytv/www/nitra/cursor/npm/bin/n-cursor.js worktree remove feat/demo
echo "after remove: $(ls -d .worktrees/feat-demo 2>/dev/null || echo gone)"
cd /Users/vitaliytv/www/nitra/cursor
```

Expected: `add` створює `.worktrees/feat-demo` + `.md`; `list` показує; `remove` прибирає (`gone`).

- [ ] **Step 5: Коміт**

```bash
git add npm/bin/n-cursor.js
git commit -m "feat(worktree): підключити case 'worktree' у n-cursor CLI

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Тонкий skill `worktree`

**Files:**

- Create: `npm/skills/worktree/SKILL.md`
- Create: `npm/skills/worktree/meta.json`

- [ ] **Step 1: Створити `meta.json`**

`npm/skills/worktree/meta.json`:

```json
{ "worktree": false }
```

> `auto` відсутнє = opt-in. Skill керування worktree не запускається сам в ізольованому worktree (уникаємо рекурсії).

- [ ] **Step 2: Створити `SKILL.md`**

`npm/skills/worktree/SKILL.md`:

```markdown
---
name: worktree
description: >-
  Створення та керування git-worktree через n-cursor worktree CLI: ізольований
  workspace у .worktrees/<branch>/ з інвентарним файлом-описом
---

# worktree — ізольований workspace через CLI

Для роботи в окремому git-worktree використовуй CLI `n-cursor worktree` — він
однаковий у Claude і Cursor, кладе worktree у `.worktrees/` (gitignored) і сам
створює інвентарний файл-опис поруч.

## Команди

- Створити (опис **обовʼязковий**):
  `npx @nitra/cursor worktree add <branch> "<навіщо цей worktree>"`
- Список активних з описами:
  `npx @nitra/cursor worktree list`
- Прибрати (гілку лишає; `--force` для брудного дерева):
  `npx @nitra/cursor worktree remove <branch> [--force]`
- Прибрати осиротілі описи / метадані:
  `npx @nitra/cursor worktree prune`

## Приклад

```bash
npx @nitra/cursor worktree add feat/skill-meta "реалізація Spec A: meta.json"
cd .worktrees/feat-skill-meta
# … робота в ізоляції …
cd -
npx @nitra/cursor worktree remove feat/skill-meta
```

Конвенція й заборони (де НЕ створювати worktree) — `.cursor/rules/n-worktree.mdc`.
```

- [ ] **Step 3: Перевірити, що skill валідний (Spec A check, якщо вже є)**

Run: `cd npm && node -e "import('./scripts/lib/skill-meta.mjs').then(m=>console.log(m.readSkillMetaRaw('skills/worktree')))"`
Expected: `{ worktree: false }` (хелпер зі Spec A; якщо Spec A ще не змерджено — пропустити, перевірити JSON: `node -e "JSON.parse(require('fs').readFileSync('npm/skills/worktree/meta.json'))"` без помилки).

- [ ] **Step 4: Коміт**

```bash
git add npm/skills/worktree/SKILL.md npm/skills/worktree/meta.json
git commit -m "feat(skills): тонкий skill worktree (вказівник на n-cursor worktree CLI)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Нормалізувати правило `worktree` (pure-doc)

**Files:**

- Create: `npm/rules/worktree/worktree.mdc`
- Delete: `.cursor/rules/n-worktrees.mdc`
- Modify: `CLAUDE.md` (рядок з `@.cursor/rules/n-worktrees.mdc`)

- [ ] **Step 1: Створити канонічне джерело правила**

`npm/rules/worktree/worktree.mdc`:

```markdown
---
description: Конвенція git-worktree у цьому репо — створення, інвентаризація та прибирання через n-cursor worktree CLI.
globs:
alwaysApply: true
---

# Worktree-конвенція

Усі git-worktree створюй і прибирай через CLI `n-cursor worktree` — він кладе їх у
`.worktrees/` (gitignored) і веде інвентарний файл-опис поруч.

## Розташування

```
.worktrees/
  feat-skill-meta/        ← git worktree checkout
  feat-skill-meta.md      ← інвентарний опис поруч (gitignored через .worktrees/)
```

Слеш у гілці перетворюється на дефіс: `feat/skill-meta` → `.worktrees/feat-skill-meta/`.
Git-гілка лишається з оригінальним імʼям (`feat/skill-meta`).

## Команди

- **Створити** (опис обовʼязковий): `npx @nitra/cursor worktree add <branch> "<навіщо>"`
- **Інвентаризація**: `npx @nitra/cursor worktree list`
- **Прибрати**: `npx @nitra/cursor worktree remove <branch> [--force]`
- **Прибрати осиротілі**: `npx @nitra/cursor worktree prune`

## Заборони

- Не клади worktree в `.claude/worktrees/` — це приватна директорія харнесу Claude Code.
- Не клади worktree в батьківський каталог `../cursor-<name>` — ускладнює інвентаризацію.
- Не створюй worktree вручну (`git worktree add`) повз CLI — інакше не буде інвентарного опису.
```

- [ ] **Step 2: Видалити стару сироту й оновити CLAUDE.md**

```bash
git rm .cursor/rules/n-worktrees.mdc
```

У `CLAUDE.md` замінити рядок `@.cursor/rules/n-worktrees.mdc` на `@.cursor/rules/n-worktree.mdc`:

(відредагувати файл — точна заміна одного рядка)

- [ ] **Step 3: Прогнати sync — переконатися, що правило розповсюджується**

```bash
node npm/bin/n-cursor.js >/tmp/sync.log 2>&1 || true
ls .cursor/rules/n-worktree.mdc 2>&1
grep -c "n-cursor worktree" .cursor/rules/n-worktree.mdc
```

Expected: `.cursor/rules/n-worktree.mdc` існує (sync створив із пакетного джерела), містить виклики CLI.

> Якщо `worktree` ще не в `.n-cursor.json:rules` — sync його додасть лише якщо правило checkable або вручну. Pure-doc правило не авто-вмикається; додай `worktree` у `.n-cursor.json` `rules` вручну, якщо потрібне розповсюдження в цьому репо. Перевірити: `grep worktree .n-cursor.json`.

- [ ] **Step 4: Коміт**

```bash
git add npm/rules/worktree/worktree.mdc CLAUDE.md .cursor/rules/
git commit -m "feat(worktree): нормалізувати правило worktree (pure-doc, канонічне джерело)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: README, change-файл, фінальна верифікація

**Files:**

- Modify: `npm/README.md`
- Create: `npm/.changes/<…>.md` (через CLI)

- [ ] **Step 1: Додати секцію в `npm/README.md`**

Знайти перелік CLI-команд у `npm/README.md` і додати рядок про `worktree`:

```markdown
- `npx @nitra/cursor worktree add <branch> "<опис>"` — створити git-worktree у `.worktrees/` з інвентарним описом; `list` / `remove <branch> [--force]` / `prune`.
```

- [ ] **Step 2: Створити change-файл**

```bash
cd npm && npx @nitra/cursor change --bump minor --section Added \
  --message "worktree: кросплатформний CLI n-cursor worktree (add/remove/list/prune) + skill + pure-doc правило worktree" \
  && cd ..
```

Expected: `✅ .changes/<…>.md`.

- [ ] **Step 3: Повний прогін тестів пакета**

Run: `cd npm && npx vitest run 2>&1 | tail -12`
Expected: нові тести (`worktree`, `worktree-cli`) зелені; падати можуть лише наперед відомі flaky (`post-tool-use-fix › readStdin`, `integration-repo-checks › checkNpmModule` за наявності незакомічених змін). Решта — PASS.

- [ ] **Step 4: Перевірка changelog-узгодженості**

Run: `npx @nitra/cursor fix changelog 2>&1 | tail -5`
Expected: exit 0.

- [ ] **Step 5: Коміт**

```bash
git add npm/README.md npm/.changes/
git commit -m "docs: README + change-файл для worktree CLI

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (виконано автором плану)

**Spec coverage:**

- CLI `add/remove/list/prune` → Task 1 (логіка) + Task 2 (оркестратор) + Task 3 (підключення). ✅
- E1 + санітизація слеша → `sanitizeBranch` (Task 1). ✅
- F1 база HEAD → `git worktree add … -b <branch>` без ref (Task 2 `cmdAdd`). ✅
- G1 опис обовʼязковий + авто-поля → `cmdAdd` (exit 1 без опису), `buildDescription` (Task 1). ✅
- H2 `remove --force` → `cmdRemove` (Task 2). ✅
- H-prune-b агресивний prune → `cmdPrune` + `findOrphanDescFiles` (Task 1/2). ✅
- Інвентарний `.md` логіка в tool → `buildDescription` + `cmdAdd` пише файл. ✅
- Тонкий skill + `meta.json` worktree:false → Task 4. ✅
- Нормалізація правила (pure-doc, канонічне джерело, перейменування сироти) → Task 5. ✅
- README + change-файл → Task 6. ✅
- Out of scope (--from, рекурсивна структура, виконання скілів, видалення гілки) — не реалізуємо. ✅

**Placeholder scan:** усі кроки з кодом мають повний код; команди з очікуваним результатом.

**Type consistency:** `sanitizeBranch`, `worktreePaths`, `buildDescription`, `findOrphanDescFiles`, `runWorktreeCli(argv, options)` з `cwd/log/logError/now` — імена однакові в логіці, оркестраторі й тестах.

**Відомі ризики для виконавця:**
- `mkdirSync` у Task 2 — можливо невикористаний у коді (лише в тесті prune для ручного створення `.worktrees/`); якщо oxlint/knip скаржиться — прибрати з імпорту коду.
- Task 5 Step 3: pure-doc правило не авто-вмикається в `.n-cursor.json` — за потреби розповсюдження додати `worktree` у `rules` вручну (звірити з фактичною поведінкою sync під час виконання).
- prune-тест (Task 2): `git worktree prune` не чіпає `ghost.md` без зареєстрованого worktree — `findOrphanDescFiles` бачить його осиротілим (немає checkout `ghost`), тож видаляє. Звірити, що `listRegisteredCheckouts` повертає лише реальні worktree.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-31-worktree-cli.md`.
