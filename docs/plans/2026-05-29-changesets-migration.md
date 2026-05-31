# Changesets Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Замінити ручний bump `version` + CHANGELOG у кожному PR на `@changesets/cli`: кожен PR додає `.changeset/<slug>.md`, CI-реліз агрегує та автоматично генерує CHANGELOG+version.

**Architecture:** Feature PR → `bunx changeset add` → `.changeset/<slug>.md` (per-PR, без конфліктів). CI на `push main`: якщо є `.changeset/*.md` — `changeset version` (bump + CHANGELOG) → commit + push → `npm publish`. Нова перевірка `check changeset` замінює `check changelog`: перевіряє, що для кожного published workspace із релізно-релевантними змінами є `.changeset/*.md`, що посилається на цей пакет. Private/local-only workspace (`private: true` або без `files`) — перевірка пропускається. Кореневий `CHANGELOG.md` лишається ручним. Стара `npm/rules/changelog/` видаляється після міграції.

**Tech Stack:** `@changesets/cli`, `changesets/action` (GitHub), bun workspaces, `yaml` (вже є в deps `@nitra/cursor`), `vitest`

---

## Файли, які змінюються

| Операція | Шлях                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Create   | `.changeset/config.json`                                                                                                        |
| Create   | `.gitattributes`                                                                                                                |
| Create   | `npm/rules/changeset/changeset.mdc`                                                                                             |
| Create   | `npm/rules/changeset/auto.md`                                                                                                   |
| Create   | `npm/rules/changeset/fix.mjs`                                                                                                   |
| Create   | `npm/rules/changeset/utils/package-manifest.mjs` ← з `changelog/lib/`                                                           |
| Create   | `npm/rules/changeset/js/consistency.mjs`                                                                                        |
| Create   | `npm/rules/changeset/js/tests/consistency/tests/check.test.mjs`                                                                 |
| Modify   | `.github/workflows/npm-publish.yml`                                                                                             |
| Modify   | `.n-cursor.json` (changelog → changeset у rules)                                                                                |
| Modify   | `.cursor/rules/scripts.mdc` (STOP-блок: check changelog → check changeset)                                                      |
| Modify   | `npm/rules/npm-module/npm-module.mdc` (рядок 66: прибрати `/ check changelog`)                                                  |
| Modify   | `npm/rules/changelog/js/consistency.mjs` (оновити import path якщо package-manifest буде перенесено; робиться перед видаленням) |
| Delete   | `npm/rules/changelog/` (усе дерево, Task 11)                                                                                    |
| Auto     | `.cursor/rules/n-changelog.mdc` → видаляється синком                                                                            |
| Auto     | `.cursor/rules/n-changeset.mdc` → створюється синком                                                                            |

---

## Task 1: Встановити `@changesets/cli` та ініціалізувати

**Files:**

- Modify: `package.json` (root)
- Create: `.changeset/config.json`

- [ ] **Step 1: Додати `@changesets/cli` до devDependencies кореневого `package.json`**

```bash
bun add -D @changesets/cli -w
```

Переконайся, що `@changesets/cli` з'явився у `devDependencies` кореневого `package.json`.

- [ ] **Step 2: Ініціалізувати changeset**

```bash
bunx changeset init
```

Це створює `.changeset/config.json` і `.changeset/README.md`.

- [ ] **Step 3: Оновити `.changeset/config.json`**

Замінити згенерований `.changeset/config.json` на:

```json
{
  "$schema": "https://unpkg.com/@changesets/config/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

- [ ] **Step 4: Видалити `.changeset/README.md`**

```bash
rm .changeset/README.md
```

Цей файл — boilerplate, у репо не потрібен.

- [ ] **Step 5: Commit**

```bash
git add .changeset/config.json package.json bun.lockb
git commit -m "chore: init @changesets/cli"
```

---

## Task 2: Додати `.gitattributes` (Рівень 1 — anti-conflict для CHANGELOG)

**Files:**

- Create: `.gitattributes`

- [ ] **Step 1: Створити `.gitattributes`**

```
# Prevent CHANGELOG.md merge conflicts by using union strategy
**/CHANGELOG.md merge=union
CHANGELOG.md merge=union
```

- [ ] **Step 2: Commit**

```bash
git add .gitattributes
git commit -m "chore: add .gitattributes with CHANGELOG union merge"
```

---

## Task 3: Написати failing tests для `check changeset` (TDD крок 1)

**Files:**

- Create: `npm/rules/changeset/js/tests/consistency/tests/check.test.mjs`

Перед реалізацією напиши тести, переконайся, що вони FAIL (правило ще не існує).

- [ ] **Step 1: Створити директорію тестів**

```bash
mkdir -p npm/rules/changeset/js/tests/consistency/tests
```

- [ ] **Step 2: Написати тестовий файл**

Створи `npm/rules/changeset/js/tests/consistency/tests/check.test.mjs`:

```js
/**
 * Тести для rules/changeset/js/consistency.mjs.
 *
 * Перевіряє наявність .changeset/*.md для published-workspace'ів із релізно-релевантними змінами.
 * Private (local-only) workspace — перевірка пропускається.
 * Логіка бази порівняння (feature/main/dev) аналогічна check-changelog.
 */
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, test } from 'vitest'

import { check } from '../../../consistency.mjs'
import { withTmpDir, writeJson } from '../../../../../../scripts/utils/test-helpers.mjs'

const execFileAsync = promisify(execFile)

async function git(args, cwd) {
  await execFileAsync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@test', '-c', 'commit.gpgsign=false', ...args],
    { cwd }
  )
}

/** Мінімальний published package.json для workspace `ws` у `dir`. */
async function writePublishedPkg(dir, ws, { name = '@test/pkg', version = '1.0.0' } = {}) {
  const wsDir = join(dir, ws)
  await mkdir(wsDir, { recursive: true })
  await writeJson(join(wsDir, 'package.json'), {
    name,
    version,
    files: ['dist']
  })
}

/** Мінімальний private package.json для workspace `ws` у `dir`. */
async function writePrivatePkg(dir, ws, { version = '1.0.0' } = {}) {
  const wsDir = join(dir, ws)
  await mkdir(wsDir, { recursive: true })
  await writeJson(join(wsDir, 'package.json'), {
    name: 'private-pkg',
    version,
    private: true
  })
}

/** Створює .changeset/<slug>.md з YAML frontmatter для переданих пакетів. */
async function writeChangeset(dir, slug, packages) {
  const changesetDir = join(dir, '.changeset')
  await mkdir(changesetDir, { recursive: true })
  const frontmatter = Object.entries(packages)
    .map(([pkg, bump]) => `"${pkg}": ${bump}`)
    .join('\n')
  await writeFile(join(changesetDir, `${slug}.md`), `---\n${frontmatter}\n---\n\nОпис змін.\n`, 'utf8')
}

/** Ініціалізує git repo з initial commit та переключає на гілку `branch`. */
async function initRepo(dir, branch = 'main') {
  await git(['init', '--initial-branch', branch], dir)
  await git(['commit', '--allow-empty', '-m', 'init'], dir)
}

describe('check-changeset: no changes', () => {
  test('published workspace без git-змін → pass', async () => {
    await withTmpDir(async dir => {
      await initRepo(dir)
      await writePublishedPkg(dir, 'pkg')
      await git(['add', '.'], dir)
      await git(['commit', '-m', 'add pkg'], dir)

      const code = await check({ cwd: dir })
      expect(code).toBe(0)
    })
  })
})

describe('check-changeset: changeset present', () => {
  test('published workspace має зміни та .changeset/*.md → pass', async () => {
    await withTmpDir(async dir => {
      await initRepo(dir)
      await writePublishedPkg(dir, 'pkg', { name: '@test/pkg' })
      await git(['add', '.'], dir)
      await git(['commit', '-m', 'add pkg'], dir)
      // Нова гілка feature з нефіксованими змінами
      await git(['checkout', '-b', 'feature/foo'], dir)
      await writeFile(join(dir, 'pkg', 'index.js'), 'export const x = 1\n', 'utf8')
      // changeset є
      await writeChangeset(dir, 'blue-dogs-shout', { '@test/pkg': 'patch' })

      const code = await check({ cwd: dir })
      expect(code).toBe(0)
    })
  })
})

describe('check-changeset: missing changeset', () => {
  test('published workspace має зміни, .changeset/ відсутній → fail', async () => {
    await withTmpDir(async dir => {
      await initRepo(dir)
      await writePublishedPkg(dir, 'pkg', { name: '@test/pkg' })
      await git(['add', '.'], dir)
      await git(['commit', '-m', 'add pkg'], dir)
      await git(['checkout', '-b', 'feature/bar'], dir)
      await writeFile(join(dir, 'pkg', 'index.js'), 'export const x = 1\n', 'utf8')
      // Без жодного .changeset/*.md

      const code = await check({ cwd: dir })
      expect(code).toBe(1)
    })
  })

  test('published workspace має зміни, .changeset/*.md не містить пакет → fail', async () => {
    await withTmpDir(async dir => {
      await initRepo(dir)
      await writePublishedPkg(dir, 'pkg', { name: '@test/pkg' })
      await git(['add', '.'], dir)
      await git(['commit', '-m', 'add pkg'], dir)
      await git(['checkout', '-b', 'feature/baz'], dir)
      await writeFile(join(dir, 'pkg', 'index.js'), 'export const x = 1\n', 'utf8')
      // changeset є, але для іншого пакета
      await writeChangeset(dir, 'some-slug', { '@test/other': 'patch' })

      const code = await check({ cwd: dir })
      expect(code).toBe(1)
    })
  })
})

describe('check-changeset: private workspace', () => {
  test('private workspace має зміни, без changeset → pass (не перевіряється)', async () => {
    await withTmpDir(async dir => {
      await initRepo(dir)
      await writePrivatePkg(dir, 'private-ws')
      await git(['add', '.'], dir)
      await git(['commit', '-m', 'add private'], dir)
      await git(['checkout', '-b', 'feature/private'], dir)
      await writeFile(join(dir, 'private-ws', 'app.js'), 'const x = 1\n', 'utf8')

      const code = await check({ cwd: dir })
      expect(code).toBe(0)
    })
  })
})

describe('check-changeset: ignored paths', () => {
  test('лише docs/ змінено → pass (no changeset needed)', async () => {
    await withTmpDir(async dir => {
      await initRepo(dir)
      await writePublishedPkg(dir, 'pkg', { name: '@test/pkg' })
      await git(['add', '.'], dir)
      await git(['commit', '-m', 'add pkg'], dir)
      await git(['checkout', '-b', 'feature/docs'], dir)
      await mkdir(join(dir, 'docs'), { recursive: true })
      await writeFile(join(dir, 'docs', 'guide.md'), '# Guide\n', 'utf8')

      const code = await check({ cwd: dir })
      expect(code).toBe(0)
    })
  })
})

describe('check-changeset: dev branch', () => {
  test('гілка dev → pass (local-only перевірку пропущено)', async () => {
    await withTmpDir(async dir => {
      await git(['init', '--initial-branch', 'dev'], dir)
      await git(['commit', '--allow-empty', '-m', 'init'], dir)
      await writePublishedPkg(dir, 'pkg', { name: '@test/pkg' })
      await writeFile(join(dir, 'pkg', 'index.js'), 'export const x = 1\n', 'utf8')

      const code = await check({ cwd: dir })
      expect(code).toBe(0)
    })
  })
})
```

- [ ] **Step 3: Переконайся, що тести FAIL (правило ще не існує)**

```bash
cd npm && bun test rules/changeset/js/tests/ 2>&1 | tail -20
```

Очікувано: `Cannot find module '../../../consistency.mjs'` або подібна помилка імпорту.

---

## Task 4: Перенести `utils/package-manifest.mjs`

**Files:**

- Create: `npm/rules/changeset/utils/package-manifest.mjs`

- [ ] **Step 1: Створити директорію**

```bash
mkdir -p npm/rules/changeset/utils
```

- [ ] **Step 2: Скопіювати та адаптувати `package-manifest.mjs`**

Читай `npm/rules/changelog/lib/package-manifest.mjs` повністю, потім створи `npm/rules/changeset/utils/package-manifest.mjs` з такою ж логікою, але з оновленим верхнім JSDoc (замінити "changelog" → "changeset" у description) та виправленим import path:

```js
// СТАРА: import { getMonorepoPackageRootDirs, ... } from '../../../scripts/lib/workspaces.mjs'
// НОВА:  import { getMonorepoPackageRootDirs, ... } from '../../../scripts/lib/workspaces.mjs'
```

(Шлях від `npm/rules/changeset/utils/` до `npm/scripts/lib/` той самий — `../../../scripts/lib/`.)

Фактично це ідентична копія, тільки JSDoc оновлений.

---

## Task 5: Реалізувати `js/consistency.mjs` (TDD крок 2)

**Files:**

- Create: `npm/rules/changeset/js/consistency.mjs`

- [ ] **Step 1: Створити директорію**

```bash
mkdir -p npm/rules/changeset/js
```

- [ ] **Step 2: Написати `consistency.mjs`**

Створи `npm/rules/changeset/js/consistency.mjs`:

```js
/**
 * Перевіряє, що для кожного published workspace із релізно-релевантними змінами
 * існує принаймні один файл `.changeset/*.md` із YAML-frontmatter, що містить
 * назву пакета як ключ.
 *
 * Private (local-only) workspace (`private: true` або відсутній масив `files`) — пропускається:
 * changesets не відстежує unpublished packages.
 *
 * Логіка порівняльної бази ідентична `changelog/js/consistency.mjs`:
 * - feature-гілка: `merge-base` з `dev`, інакше з `main`
 * - `main`: diff від `origin/main` або `HEAD~1`
 * - `dev`: перевірку пропущено
 */
import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { parse as parseYaml } from 'yaml'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { getMonorepoProjectRootDirs, readPackageManifest } from '../utils/package-manifest.mjs'

const execFileAsync = promisify(execFile)

const FEATURE_BASE_BRANCH_CANDIDATES = Object.freeze(['dev', 'main'])
const LOCAL_ONLY_SKIP_BRANCH = 'dev'
const CHANGELOG_IGNORE_PATH_PREFIXES = Object.freeze(['docs/', 'doc/', '.cursor/', '.claude/'])
const LEADING_DOTSLASH_RE = /^\.\//

async function gitOrNull(args, cwd) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd })
    return stdout
  } catch {
    return null
  }
}

async function isInsideGitRepo(cwd) {
  const out = await gitOrNull(['rev-parse', '--is-inside-work-tree'], cwd)
  return typeof out === 'string' && out.trim() === 'true'
}

async function currentBranchName(cwd) {
  const out = await gitOrNull(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
  return typeof out === 'string' ? out.trim() : null
}

function baseRefLabel(ref) {
  return ref.startsWith('origin/') ? ref.slice('origin/'.length) : ref
}

async function isGitAncestor(ancestor, descendant, cwd) {
  const out = await gitOrNull(['merge-base', '--is-ancestor', ancestor, descendant], cwd)
  return typeof out === 'string' && out.trim() === 'true'
}

async function resolveBranchRef(branchName, cwd) {
  for (const ref of [branchName, `origin/${branchName}`]) {
    const out = await gitOrNull(['rev-parse', '--verify', '--quiet', ref], cwd)
    if (typeof out === 'string' && out.trim().length > 0) return ref
  }
  return null
}

async function resolveMergeBase(baseRef, cwd) {
  const out = await gitOrNull(['merge-base', baseRef, 'HEAD'], cwd)
  if (typeof out !== 'string') return null
  const sha = out.trim()
  return sha.length > 0 ? sha : null
}

async function resolveComparisonPoint(branch, cwd) {
  if (branch === LOCAL_ONLY_SKIP_BRANCH) return null

  if (branch === 'main') {
    const originMainRaw = await gitOrNull(['rev-parse', '--verify', '--quiet', 'origin/main'], cwd)
    const originMainSha = originMainRaw?.trim()
    const headRaw = await gitOrNull(['rev-parse', 'HEAD'], cwd)
    const headSha = headRaw?.trim()
    if (originMainSha && headSha && (originMainSha === headSha || (await isGitAncestor('origin/main', 'HEAD', cwd)))) {
      return { ref: 'origin/main', label: 'main' }
    }
    const parent = await gitOrNull(['rev-parse', '--verify', '--quiet', 'HEAD~1'], cwd)
    if (typeof parent === 'string' && parent.trim().length > 0) {
      return { ref: parent.trim(), label: 'main~1' }
    }
    return null
  }

  for (const name of FEATURE_BASE_BRANCH_CANDIDATES) {
    const baseRef = await resolveBranchRef(name, cwd)
    if (!baseRef) continue
    const mergeBase = await resolveMergeBase(baseRef, cwd)
    if (!mergeBase) continue
    return { ref: mergeBase, label: baseRefLabel(baseRef) }
  }
  return null
}

function isChangelogIgnoredPath(relPath) {
  const p = relPath.replaceAll('\\', '/').replace(LEADING_DOTSLASH_RE, '')
  return CHANGELOG_IGNORE_PATH_PREFIXES.some(prefix => p.startsWith(prefix))
}

async function isPathGitIgnored(relPath, cwd) {
  try {
    await execFileAsync('git', ['check-ignore', '-q', '--', relPath], { cwd })
    return true
  } catch {
    return false
  }
}

function splitNulPaths(nulSeparated) {
  if (typeof nulSeparated !== 'string') return []
  return nulSeparated.split('\0').filter(p => p.length > 0)
}

function pathspecForWorkspace(ws, subWorkspaces) {
  if (ws !== '.') return [`${ws}/`]
  return ['.', ...subWorkspaces.filter(s => s !== '.').map(s => `:(exclude)${s}/`)]
}

async function listChangedPaths(baseRef, pathspec, cwd) {
  const diffOut = await gitOrNull(['diff', '--name-only', '-z', baseRef, '--', ...pathspec], cwd)
  const untrackedOut = await gitOrNull(['ls-files', '--others', '--exclude-standard', '-z', '--', ...pathspec], cwd)
  return [...new Set([...splitNulPaths(diffOut), ...splitNulPaths(untrackedOut)])]
}

async function hasRelevantChanges(baseRef, ws, subWorkspaces, cwd) {
  const pathspec = pathspecForWorkspace(ws, subWorkspaces)
  const paths = await listChangedPaths(baseRef, pathspec, cwd)
  for (const p of paths) {
    if (isChangelogIgnoredPath(p)) continue
    if (await isPathGitIgnored(p, cwd)) continue
    return true
  }
  return false
}

/**
 * Зчитує всі .changeset/*.md файли (виключаючи config.json) і повертає масив об'єктів
 * { file, packages: string[] } де packages — ключі YAML frontmatter.
 * @param {string} cwd корінь репозиторію
 * @returns {Promise<Array<{ file: string, packages: string[] }>>}
 */
async function readChangesetFiles(cwd) {
  const changesetDir = join(cwd, '.changeset')
  let entries
  try {
    entries = await readdir(changesetDir)
  } catch {
    return []
  }
  const results = []
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    const content = await readFile(join(changesetDir, entry), 'utf8')
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!match) continue
    let parsed
    try {
      parsed = parseYaml(match[1])
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
    results.push({ file: entry, packages: Object.keys(parsed) })
  }
  return results
}

/**
 * @param {object} [opts]
 * @param {string} [opts.cwd] корінь репозиторію
 * @returns {Promise<number>} exit-код: 0 — OK, 1 — є порушення
 */
export async function check(opts = {}) {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter
  const cwd = opts.cwd ?? process.cwd()

  const workspaces = await getMonorepoProjectRootDirs(cwd)
  const subWorkspaces = workspaces.filter(w => w !== '.')
  const isMonorepoRoot = subWorkspaces.length > 0

  if (!(await isInsideGitRepo(cwd))) {
    pass('changeset: не git-репозиторій — перевірку пропущено')
    return reporter.getExitCode()
  }

  const branch = await currentBranchName(cwd)
  if (branch === LOCAL_ONLY_SKIP_BRANCH) {
    pass('changeset: гілка dev — перевірку пропущено')
    return reporter.getExitCode()
  }

  const comparison = await resolveComparisonPoint(branch, cwd)
  if (!comparison) {
    pass('changeset: ref dev/main (та origin/*) не знайдено — перевірку пропущено')
    return reporter.getExitCode()
  }

  const changesets = await readChangesetFiles(cwd)

  for (const ws of workspaces) {
    if (ws === '.' && isMonorepoRoot) {
      pass('<root>: корінь монорепо — перевірку changeset пропущено')
      continue
    }

    const manifest = await readPackageManifest(ws, cwd)
    if (!manifest) continue

    if (!manifest.registryPublishable) {
      pass(`${ws === '.' ? '<root>' : ws}: private/local-only workspace — changeset не потрібен`)
      continue
    }

    if (!(await hasRelevantChanges(comparison.ref, ws, subWorkspaces, cwd))) {
      pass(`${ws}: немає релізно-релевантних змін відносно ${comparison.label}`)
      continue
    }

    const packageName = manifest.name
    if (!packageName) {
      fail(`${ws}: відсутнє name у package.json (required для changeset)`)
      continue
    }

    const mentioned = changesets.some(c => c.packages.includes(packageName))
    if (mentioned) {
      pass(`${ws}: знайдено .changeset/*.md для ${packageName}`)
    } else {
      fail(
        `${ws}: є зміни в ${packageName}, але відсутній .changeset/*.md для цього пакета\n` +
          `  Виконай: bunx changeset add → вибери "${packageName}" → patch/minor/major`
      )
    }
  }

  return reporter.getExitCode()
}
```

- [ ] **Step 3: Запустити тести — переконайся, що вони PASS**

```bash
cd npm && bun test rules/changeset/js/tests/ 2>&1 | tail -30
```

Очікувано: всі тести ✓. Якщо є failures — виправ логіку в `consistency.mjs` до зеленого стану.

- [ ] **Step 4: Commit**

```bash
git add npm/rules/changeset/
git commit -m "feat(changeset): implement check rule with TDD"
```

---

## Task 6: Створити metadata-файли правила

**Files:**

- Create: `npm/rules/changeset/changeset.mdc`
- Create: `npm/rules/changeset/auto.md`
- Create: `npm/rules/changeset/fix.mjs`

- [ ] **Step 1: Створити `changeset.mdc`**

````markdown
---
description: Changeset-файли для published workspace'ів — замість ручного bump+CHANGELOG у PR
version: '1.0'
alwaysApply: true
---

## STOP — перед завершенням відповіді агента

> **Якщо в цій сесії ти змінив(ла) файли в пакетному workspace** (код, rego, правила, скіли, скрипти, конфіги, тести — **не** лише `docs/` / `doc/`) — **не завершуй задачу**, поки не виконаєш **обидва** кроки нижче в **тому ж** наборі змін.

1. **`.changeset/<slug>.md`** — виконай `bunx changeset add`, вибери відповідний workspace і bump-тип (`patch` / `minor` / `major`). Якщо CI-середовище без інтерактивного вводу — створи файл вручну:
   ```md
   ---
   '@nitra/cursor': patch
   ---

   Короткий опис зміни.
   ```
````

2. **`bun ./npm/bin/n-cursor.js check changeset`** (або `npx @nitra/cursor fix changeset`) → exit **`0`**.

**Тригер шляхів:** будь-який каталог із `package.json` (не `private: true`, має `files`), куди потрапили правки: `npm/**` тощо.

**Інверсія (changeset не потрібен):** лише `docs/` / `doc/`; `.cursor/` / `.claude/` (синхронізований tooling); лише `.gitignore`; сам релізний крок у CI (`changeset version`).

**Pre-commit (людина):** `hk` у цьому репо також запускає `check changeset` при змінах під `npm/**`.

---

У кожному **published** workspace (поле `files` у `package.json`, без `private: true`) має бути `.changeset/<slug>.md` на PR із змінами.

**Bump-семантика:**

- `patch` — виправлення помилок, документація, внутрішній рефакторинг
- `minor` — нова функціональність (зворотньо-сумісна)
- `major` — breaking changes

**Реліз:** CI (`npm-publish.yml`) на `push main` автоматично:

1. Виявляє `.changeset/*.md` → запускає `changeset version` (генерує `CHANGELOG.md`, піднімає `version`)
2. Комітить і пушить результат
3. Публікує пакет на npm

Ручний bump `version` і ручне редагування `CHANGELOG.md` у PR **більше не потрібні**.

```

- [ ] **Step 2: Створити `auto.md`**

```

[bun]

````

- [ ] **Step 3: Створити `fix.mjs`**

```js
import { isRunAsCli, runRuleCli } from '../../scripts/lib/run-rule-cli.mjs'
import { runStandardRule } from '../../scripts/lib/run-standard-rule.mjs'

/**
 * Запускає правило: applies → JS-concerns → policy → mdc-refs (через runStandardRule).
 * Library mode: викликається CLI orchestration через `import + run(ctx)`.
 * @param {import('../../scripts/lib/run-standard-rule.mjs').RuleContext} [ctx] контекст прогону
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}

if (isRunAsCli(import.meta.url)) {
  // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
  process.exit(await runRuleCli(import.meta.dirname))
}
````

- [ ] **Step 4: Commit**

```bash
git add npm/rules/changeset/
git commit -m "feat(changeset): add rule metadata (mdc, fix.mjs, auto.md)"
```

---

## Task 7: Оновити CI `npm-publish.yml`

**Files:**

- Modify: `.github/workflows/npm-publish.yml`

- [ ] **Step 1: Прочитати поточний файл**

Прочитай `.github/workflows/npm-publish.yml` повністю.

- [ ] **Step 2: Замінити вміст**

```yaml
name: npm-publish

on:
  push:
    paths:
      - 'npm/**'
      - '.changeset/*.md'
    branches:
      - main

concurrency:
  group: ${{ github.ref }}-${{ github.workflow }}
  cancel-in-progress: true

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write # потрібен для git push після changeset version
      id-token: write # КРИТИЧНО для OIDC npm publish

    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: true # потрібен для git push

      - uses: actions/setup-node@v6
        with:
          node-version: '24'
          registry-url: 'https://registry.npmjs.org'

      - uses: oven-sh/setup-bun@v2

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Check for changesets
        id: changesets
        run: |
          if find .changeset -name '*.md' -not -name 'config.json' 2>/dev/null | grep -q .; then
            echo "has_changesets=true" >> "$GITHUB_OUTPUT"
          else
            echo "has_changesets=false" >> "$GITHUB_OUTPUT"
          fi

      - name: Version packages
        if: steps.changesets.outputs.has_changesets == 'true'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          bunx changeset version
          git add -A
          git commit -m "chore: version packages [skip ci]"
          git push

      - name: Publish package
        uses: JS-DevTools/npm-publish@v4.1.5
        with:
          package: npm/package.json
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/npm-publish.yml
git commit -m "ci: use changesets/version before npm publish"
```

---

## Task 8: Оновити `.n-cursor.json` та синхронізувати правила

**Files:**

- Modify: `.n-cursor.json`
- Auto-create: `.cursor/rules/n-changeset.mdc`
- Auto-delete: `.cursor/rules/n-changelog.mdc`

- [ ] **Step 1: Замінити `"changelog"` на `"changeset"` у `.n-cursor.json`**

У масиві `rules` знайди `"changelog"` і заміни на `"changeset"`. Результат (відповідна частина):

```json
"rules": [
  "adr",
  "bun",
  "changeset",
  "ci4",
  ...
]
```

- [ ] **Step 2: Запустити sync для оновлення `.cursor/rules/`**

```bash
bun ./npm/bin/n-cursor.js
```

Очікувано: з'явиться `.cursor/rules/n-changeset.mdc`, видалиться `.cursor/rules/n-changelog.mdc`.

- [ ] **Step 3: Переконатися, що check changeset працює**

```bash
bun ./npm/bin/n-cursor.js check changeset
```

Очікувано: exit 0 (у поточному стані немає uncommitted relevant changes).

- [ ] **Step 4: Commit**

```bash
git add .n-cursor.json .cursor/rules/
git commit -m "feat(changeset): register changeset rule, remove changelog rule"
```

---

## Task 9: Оновити cross-references

**Files:**

- Modify: `.cursor/rules/scripts.mdc`
- Modify: `npm/rules/npm-module/npm-module.mdc`

- [ ] **Step 1: Оновити STOP-блок у `.cursor/rules/scripts.mdc`**

Знайди рядок:

```
> **STOP** разом із **n-changelog.mdc**: якщо редагував(ла) `npm/rules/`, ...  — **останніми кроками сесії** ...: bump `version` → нова секція `CHANGELOG.md` → `check changelog`.
```

Замінити на:

```
> **STOP** разом із **n-changeset.mdc**: якщо редагував(ла) `npm/rules/`, `npm/skills/`, `npm/scripts/`, `npm/bin/` або інші файли під workspace з `package.json` / `pyproject.toml` (крім інверсії `docs/` only) — **останніми кроками сесії** (після тестів / sync, **перед** фінальною відповіддю користувачу): додай `.changeset/*.md` (`bunx changeset add`) → `check changeset`. Не відкладати на «користувач попросить commit».
```

- [ ] **Step 2: Оновити `npm/rules/npm-module/npm-module.mdc` (рядок 66)**

Знайди рядок:

```
а `check npm-module` / `check changelog` гірше ловлять порушення.
```

Замінити на:

```
а `check npm-module` / `check changeset` гірше ловлять порушення.
```

- [ ] **Step 3: Commit**

```bash
git add .cursor/rules/scripts.mdc npm/rules/npm-module/npm-module.mdc
git commit -m "docs: update check changelog refs to check changeset"
```

---

## Task 10: Видалити артефакти старого підходу

**Files:**

- Delete: `npm/rules/changelog/` (ціле дерево)

> ⚠️ Виконувати лише після того, як Task 5 (check changeset тести green) і Task 8 (sync) завершені.

- [ ] **Step 1: Переконатися, що тести changeset зелені**

```bash
cd npm && bun test rules/changeset/ 2>&1 | tail -10
```

Очікувано: всі PASS.

- [ ] **Step 2: Переконатися, що нічого не імпортує з `rules/changelog/`**

```bash
grep -r "rules/changelog" npm/ --include="*.mjs" --include="*.js" | grep -v node_modules | grep -v ".changeset"
```

Очікувано: немає результатів (або лише `test-helpers` fixtures — перевір).

- [ ] **Step 3: Видалити**

```bash
rm -rf npm/rules/changelog/
```

- [ ] **Step 4: Запустити всі тести пакета**

```bash
cd npm && bun test 2>&1 | tail -30
```

Очікувано: всі тести PASS. Якщо є нові failures — знайди та виправ причину перед commit.

- [ ] **Step 5: Перевірити відсутність `.cursor/rules/n-changelog.mdc`**

```bash
ls .cursor/rules/ | grep changelog
```

Очікувано: порожній результат (файл видалено синком у Task 8).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(changeset): remove legacy changelog rule artifacts"
```

---

## Task 11: Фінальна верифікація та CHANGELOG

- [ ] **Step 1: Запустити повний lint**

```bash
bun run lint
```

Очікувано: exit 0.

- [ ] **Step 2: Запустити всі тести**

```bash
cd npm && bun test 2>&1 | tail -20
```

Очікувано: всі PASS.

- [ ] **Step 3: Перевірити `check changeset` на поточному репо**

```bash
bun ./npm/bin/n-cursor.js check changeset
```

Очікувано: exit 0 (якщо немає uncommitted relevant changes без changeset файлу).

- [ ] **Step 4: Зробити changeset для поточних змін у `npm/`**

```bash
bunx changeset add
```

Вибрати `@nitra/cursor`, тип `minor` (нова фіча), опис:

```
Migrate from manual version+CHANGELOG bumps to @changesets/cli: check changeset rule, CI auto-release
```

- [ ] **Step 5: Commit**

```bash
git add .changeset/
git commit -m "chore: add changeset for changesets migration"
```

---

## Додаткові нотатки

**Pre-commit hook `hk`:** у `n-changelog.mdc` є посилання на `hk`, який запускає `check changelog` при змінах у `npm/**`. Знайди конфігурацію цього хука (`.husky/pre-commit`, `lefthook.yml`, `.hk.yml` або `.claude/settings.json` → hooks) і заміни `check changelog` на `check changeset`. Якщо конфіг не знайдено — зафіксуй у CHANGELOG як known gap.

**Перший реальний PR після міграції:** щоб перевірити end-to-end потік:

1. Зроби зміну у `npm/`
2. `bunx changeset add` → вибери `@nitra/cursor` → `patch`
3. Переконайся, що `check changeset` exit 0
4. Merge у main
5. CI: крок "Version packages" виконається, `npm/CHANGELOG.md` і `npm/package.json` оновляться автоматично

**Кореневий `CHANGELOG.md`:** лишається ручним. `changeset version` не чіпає його (корінь `private: true`).
