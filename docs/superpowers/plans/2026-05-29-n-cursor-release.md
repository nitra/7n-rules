# `n-cursor release` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Замінити ручний bump `version` + ручне редагування `CHANGELOG.md` на per-workspace change-файли (`<ws>/.changes/*.md`), які агрегує `n-cursor release` у CI, — щоб паралельні агенти/worktree не давали merge-конфліктів.

**Architecture:** Новий rule-каталог `npm/rules/release/` із чистими бібліотечними модулями (`change-file`, `aggregate`, `fallback`) і двома оркестраторами-CLI (`change`, `release`). `release` переюзає наявну детекцію workspace (`npm/rules/changelog/lib/package-manifest.mjs`), обчислює per-workspace bump (`max(bump)`), генерує секцію у форматі Keep a Changelog, комітить, ставить тег `<name>@<version>` і видаляє use-up change-файли. Перевірка `consistency.mjs` стає м'якою (приймає change-файл **або** піднятий version). CI-крок і правило оновлюються; `npm-publish.yml` виноситься template-ом для scope B.

**Tech Stack:** Node.js ESM (`.mjs`), vitest, `node:child_process` execFile для git, `smol-toml` (вже є) для pyproject, без нових залежностей (frontmatter парситься мінімальним власним парсером — лише два ключі).

**Спека:** `docs/superpowers/specs/2026-05-29-n-cursor-release-design.md`

---

## File Structure

**Створюються:**
- `npm/rules/release/lib/change-file.mjs` — парс/серіалізація/валідація одного `.changes/*.md`; генерація імені; зчитування всіх change-файлів workspace.
- `npm/rules/release/lib/aggregate.mjs` — semver-bump, `max(bump)`, рендер секції CHANGELOG, агрегація одного workspace.
- `npm/rules/release/lib/fallback.mjs` — синтез change-запису з git commit-range, коли change-файлів нема.
- `npm/rules/release/release.mjs` — оркестрація release (aggregate → запис маніфесту → prepend CHANGELOG → commit → tag → cleanup) + `runReleaseCli`.
- `npm/rules/release/change.mjs` — `runChangeCli`: запис одного change-файлу з прапорців/CWD.
- `npm/rules/release/release.mdc` — людинозрозуміле правило (auto-doc-меню для синку, опційно).
- `npm/rules/release/js/tests/change-file.test.mjs`
- `npm/rules/release/js/tests/aggregate.test.mjs`
- `npm/rules/release/js/tests/fallback.test.mjs`
- `npm/rules/release/js/tests/release.test.mjs`
- `npm/rules/release/js/tests/change.test.mjs`
- `npm/github-actions/release/action.yml` — composite action template для scope B.

**Модифікуються:**
- `npm/bin/n-cursor.js:1427` — додати `case 'change'` і `case 'release'` у switch (патерн динамічного імпорту, як `coverage`).
- `npm/rules/changelog/js/consistency.mjs` — додати «change-файл задовольняє вимогу» у feature/main-перевірки (м'яка семантика).
- `.cursor/rules/n-changelog.mdc` **та** `npm/rules/changelog/changelog.mdc` — оновити STOP-блок (v2.6 → v3.0).
- `.github/workflows/npm-publish.yml` — `release` + `publish` в одному job'і.
- `npm/CHANGELOG.md` + `npm/package.json` — bump за власним правилом перед фінішем.

**Порядок:** Task 1→2 (change-file) → 3 (aggregate) → 4 (change CLI) → 5 (fallback) → 6 (release CLI) → 7 (check) → 8 (rule) → 9 (CI/dist) → 10 (self-release bump).

---

## Task 1: `change-file.mjs` — парс і серіалізація

**Files:**
- Create: `npm/rules/release/lib/change-file.mjs`
- Test: `npm/rules/release/js/tests/change-file.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// npm/rules/release/js/tests/change-file.test.mjs
import { describe, expect, test } from 'vitest'

import { parseChangeFile, serializeChangeFile, VALID_BUMPS, VALID_SECTIONS } from '../../lib/change-file.mjs'

describe('parseChangeFile', () => {
  test('парсить валідний frontmatter + опис', () => {
    const text = '---\nbump: minor\nsection: Added\n---\nДодав підтримку X\n'
    expect(parseChangeFile(text)).toEqual({ bump: 'minor', section: 'Added', description: 'Додав підтримку X' })
  })

  test('обрізає зайві пробіли в описі та кидає на порожньому описі', () => {
    const text = '---\nbump: patch\nsection: Fixed\n---\n\n  Виправив Y  \n\n'
    expect(parseChangeFile(text).description).toBe('Виправив Y')
    expect(() => parseChangeFile('---\nbump: patch\nsection: Fixed\n---\n   \n')).toThrow(/опис/)
  })

  test('кидає на невалідному bump/section та без frontmatter', () => {
    expect(() => parseChangeFile('---\nbump: huge\nsection: Added\n---\nx')).toThrow(/bump/)
    expect(() => parseChangeFile('---\nbump: patch\nsection: Nope\n---\nx')).toThrow(/section/)
    expect(() => parseChangeFile('просто текст')).toThrow(/frontmatter/)
  })

  test('VALID_* — очікувані множини', () => {
    expect(VALID_BUMPS).toEqual(['major', 'minor', 'patch'])
    expect(VALID_SECTIONS).toEqual(['Added', 'Changed', 'Fixed', 'Removed'])
  })
})

describe('serializeChangeFile', () => {
  test('round-trip із parseChangeFile', () => {
    const entry = { bump: 'major', section: 'Removed', description: 'Прибрав Z' }
    expect(parseChangeFile(serializeChangeFile(entry))).toEqual(entry)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd npm && bun run vitest run rules/release/js/tests/change-file.test.mjs`
Expected: FAIL — `Cannot find module '../../lib/change-file.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// npm/rules/release/lib/change-file.mjs
/**
 * Один change-файл `<ws>/.changes/<timestamp>-<rand>.md`: YAML-подібний frontmatter
 * із двома ключами (`bump`, `section`) + текст опису. Парсер мінімальний — лише ці два
 * ключі, без зовнішніх залежностей.
 */

/** Дозволені semver-бампи, від найбільшого до найменшого (порядок використовується для max). */
export const VALID_BUMPS = Object.freeze(['major', 'minor', 'patch'])

/** Дозволені Keep a Changelog секції (заголовок `### {section}`). */
export const VALID_SECTIONS = Object.freeze(['Added', 'Changed', 'Fixed', 'Removed'])

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/

/**
 * @param {string} block тіло frontmatter (між `---`)
 * @returns {Record<string, string>} пари ключ→значення
 */
function parseFrontmatterBlock(block) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const line of block.split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return out
}

/**
 * @param {string} text вміст change-файлу
 * @returns {{ bump: string, section: string, description: string }} розпарсений запис
 */
export function parseChangeFile(text) {
  const m = FRONTMATTER_RE.exec(text)
  if (!m) throw new Error('change-файл: відсутній frontmatter `---`')
  const fm = parseFrontmatterBlock(m[1])
  const description = m[2].trim()
  if (!VALID_BUMPS.includes(fm.bump)) {
    throw new Error(`change-файл: bump має бути одним із ${VALID_BUMPS.join('|')} (отримано «${fm.bump ?? ''}»)`)
  }
  if (!VALID_SECTIONS.includes(fm.section)) {
    throw new Error(`change-файл: section має бути одним із ${VALID_SECTIONS.join('|')} (отримано «${fm.section ?? ''}»)`)
  }
  if (!description) throw new Error('change-файл: порожній опис')
  return { bump: fm.bump, section: fm.section, description }
}

/**
 * @param {{ bump: string, section: string, description: string }} entry запис
 * @returns {string} вміст change-файлу
 */
export function serializeChangeFile(entry) {
  return `---\nbump: ${entry.bump}\nsection: ${entry.section}\n---\n${entry.description}\n`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd npm && bun run vitest run rules/release/js/tests/change-file.test.mjs`
Expected: PASS (4 + 1 tests).

- [ ] **Step 5: Commit**

```bash
git add npm/rules/release/lib/change-file.mjs npm/rules/release/js/tests/change-file.test.mjs
git commit -m "feat(release): parse/serialize change files"
```

---

## Task 2: `change-file.mjs` — ім'я файлу та зчитування workspace

**Files:**
- Modify: `npm/rules/release/lib/change-file.mjs`
- Test: `npm/rules/release/js/tests/change-file.test.mjs`

- [ ] **Step 1: Write the failing test (append to existing file)**

```js
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { changeFileName, readChangeFiles } from '../../lib/change-file.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

describe('changeFileName', () => {
  test('формат <timestamp>-<rand>.md, детермінований за входами', () => {
    expect(changeFileName(1748505600000, 'a1b2c3')).toBe('1748505600000-a1b2c3.md')
  })
})

describe('readChangeFiles', () => {
  test('зчитує всі .md з <ws>/.changes, ігнорує не-.md, повертає {file, entry}', async () => {
    await withTmpDir(async dir => {
      const changesDir = join(dir, 'pkg', '.changes')
      await mkdir(changesDir, { recursive: true })
      await writeFile(join(changesDir, '1-aaa.md'), '---\nbump: patch\nsection: Fixed\n---\nA\n')
      await writeFile(join(changesDir, '2-bbb.md'), '---\nbump: minor\nsection: Added\n---\nB\n')
      await writeFile(join(changesDir, 'README.txt'), 'ignore me')

      const result = await readChangeFiles('pkg', dir)
      expect(result.map(r => r.entry.description).sort()).toEqual(['A', 'B'])
      expect(result.every(r => r.file.endsWith('.md'))).toBe(true)
    })
  })

  test('відсутній .changes → порожній масив', async () => {
    await withTmpDir(async dir => {
      expect(await readChangeFiles('pkg', dir)).toEqual([])
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd npm && bun run vitest run rules/release/js/tests/change-file.test.mjs`
Expected: FAIL — `changeFileName`/`readChangeFiles` is not a function.

- [ ] **Step 3: Write minimal implementation (append to `change-file.mjs`)**

```js
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Підкаталог зі change-файлами всередині workspace. */
export const CHANGES_DIR = '.changes'

/**
 * @param {number} timestamp `Date.now()`
 * @param {string} suffix короткий випадковий суфікс (hex)
 * @returns {string} `<timestamp>-<suffix>.md`
 */
export function changeFileName(timestamp, suffix) {
  return `${timestamp}-${suffix}.md`
}

/**
 * Унікальне ім'я для нового change-файлу: timestamp (порядок) + rand (анти-колізія
 * для паралельних агентів у різних worktree, що пишуть у ту саму мілісекунду).
 * @returns {string} результат
 */
export function newChangeFileName() {
  return changeFileName(Date.now(), randomBytes(3).toString('hex'))
}

/**
 * @param {string} ws шлях workspace (відносно `cwd`)
 * @param {string} [cwd] корінь репозиторію
 * @returns {Promise<Array<{ file: string, entry: { bump: string, section: string, description: string } }>>} розпарсені change-файли
 */
export async function readChangeFiles(ws, cwd = process.cwd()) {
  const dir = join(cwd, ws, CHANGES_DIR)
  if (!existsSync(dir)) return []
  const names = (await readdir(dir)).filter(n => n.endsWith('.md')).sort()
  const result = []
  for (const file of names) {
    const text = await readFile(join(dir, file), 'utf8')
    result.push({ file, entry: parseChangeFile(text) })
  }
  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd npm && bun run vitest run rules/release/js/tests/change-file.test.mjs`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add npm/rules/release/lib/change-file.mjs npm/rules/release/js/tests/change-file.test.mjs
git commit -m "feat(release): change file name + workspace reader"
```

---

## Task 3: `aggregate.mjs` — bump + рендер секції + агрегація workspace

**Files:**
- Create: `npm/rules/release/lib/aggregate.mjs`
- Test: `npm/rules/release/js/tests/aggregate.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// npm/rules/release/js/tests/aggregate.test.mjs
import { describe, expect, test } from 'vitest'

import { bumpVersion, maxBump, renderChangelogSection, prependChangelogSection } from '../../lib/aggregate.mjs'

describe('bumpVersion', () => {
  test('major/minor/patch обнуляють молодші розряди', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4')
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0')
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0')
  })
  test('кидає на невалідній версії', () => {
    expect(() => bumpVersion('1.2', 'patch')).toThrow(/semver/)
  })
})

describe('maxBump', () => {
  test('обирає найвищий', () => {
    expect(maxBump(['patch', 'minor', 'patch'])).toBe('minor')
    expect(maxBump(['patch', 'major', 'minor'])).toBe('major')
    expect(maxBump(['patch'])).toBe('patch')
  })
})

describe('renderChangelogSection', () => {
  test('групує bullets по секціях у канонічному порядку', () => {
    const block = renderChangelogSection('1.3.0', '2026-05-29', [
      { section: 'Fixed', description: 'Виправив B' },
      { section: 'Added', description: 'Додав A' },
      { section: 'Added', description: 'Додав A2' }
    ])
    expect(block).toBe(
      '## [1.3.0] - 2026-05-29\n\n### Added\n\n- Додав A\n- Додав A2\n\n### Fixed\n\n- Виправив B\n'
    )
  })
})

describe('prependChangelogSection', () => {
  test('вставляє секцію зверху, зберігаючи заголовок Keep a Changelog', () => {
    const existing = '# Changelog\n\nПреамбула.\n\n## [1.2.0] - 2026-01-01\n\n### Added\n\n- old\n'
    const out = prependChangelogSection(existing, '## [1.3.0] - 2026-05-29\n\n### Added\n\n- new\n')
    expect(out).toContain('# Changelog')
    expect(out.indexOf('## [1.3.0]')).toBeLessThan(out.indexOf('## [1.2.0]'))
    expect(out).toContain('Преамбула.')
  })
  test('файл без заголовка # — секція просто зверху', () => {
    expect(prependChangelogSection('', '## [1.0.0] - 2026-05-29\n\n### Added\n\n- x\n')).toBe(
      '# Changelog\n\n## [1.0.0] - 2026-05-29\n\n### Added\n\n- x\n'
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd npm && bun run vitest run rules/release/js/tests/aggregate.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// npm/rules/release/lib/aggregate.mjs
/**
 * Агрегація change-файлів одного workspace у version-bump + секцію CHANGELOG
 * (Keep a Changelog 1.1.0, новіше зверху). Без побічних ефектів — лише обчислення/рендер;
 * запис на диск і git — у release.mjs.
 */
import { VALID_BUMPS, VALID_SECTIONS } from './change-file.mjs'

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/
const CHANGELOG_HEADER = '# Changelog'

/**
 * @param {string} version `x.y.z`
 * @param {string} bump `major|minor|patch`
 * @returns {string} нова версія
 */
export function bumpVersion(version, bump) {
  const m = SEMVER_RE.exec(version)
  if (!m) throw new Error(`aggregate: невалідний semver «${version}»`)
  let [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

/**
 * @param {string[]} bumps непорожній список
 * @returns {string} найвищий bump (major > minor > patch)
 */
export function maxBump(bumps) {
  return VALID_BUMPS.find(level => bumps.includes(level)) ?? 'patch'
}

/**
 * @param {string} version нова версія
 * @param {string} date `YYYY-MM-DD`
 * @param {Array<{ section: string, description: string }>} entries записи change-файлів
 * @returns {string} markdown-блок секції (без хвостового подвійного \n)
 */
export function renderChangelogSection(version, date, entries) {
  let out = `## [${version}] - ${date}\n`
  for (const section of VALID_SECTIONS) {
    const bullets = entries.filter(e => e.section === section)
    if (bullets.length === 0) continue
    out += `\n### ${section}\n\n${bullets.map(b => `- ${b.description}`).join('\n')}\n`
  }
  return out
}

/**
 * @param {string} existingText наявний CHANGELOG.md (може бути порожнім)
 * @param {string} sectionBlock новий блок версії
 * @returns {string} CHANGELOG із секцією зверху
 */
export function prependChangelogSection(existingText, sectionBlock) {
  const text = existingText.trimStart()
  if (!text.startsWith(CHANGELOG_HEADER)) {
    return `${CHANGELOG_HEADER}\n\n${sectionBlock}`
  }
  const nl = text.indexOf('\n')
  const head = text.slice(0, nl === -1 ? text.length : nl)
  const rest = nl === -1 ? '' : text.slice(nl + 1).trimStart()
  return `${head}\n\n${sectionBlock}\n${rest}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd npm && bun run vitest run rules/release/js/tests/aggregate.test.mjs`
Expected: PASS.

- [ ] **Step 5: Add `aggregateWorkspace` test (append)**

```js
import { aggregateWorkspace } from '../../lib/aggregate.mjs'

describe('aggregateWorkspace', () => {
  test('обчислює нову версію (max bump) і блок секції, перелічує consumed-файли', () => {
    const changeFiles = [
      { file: '1-a.md', entry: { bump: 'patch', section: 'Fixed', description: 'fix' } },
      { file: '2-b.md', entry: { bump: 'minor', section: 'Added', description: 'feat' } }
    ]
    const r = aggregateWorkspace({ currentVersion: '1.2.3', changeFiles, date: '2026-05-29' })
    expect(r.newVersion).toBe('1.3.0')
    expect(r.sectionBlock).toContain('## [1.3.0] - 2026-05-29')
    expect(r.consumedFiles).toEqual(['1-a.md', '2-b.md'])
  })

  test('порожній список change-файлів → null', () => {
    expect(aggregateWorkspace({ currentVersion: '1.0.0', changeFiles: [], date: '2026-05-29' })).toBeNull()
  })
})
```

- [ ] **Step 6: Implement `aggregateWorkspace` (append to `aggregate.mjs`)**

```js
/**
 * @param {object} params параметри
 * @param {string} params.currentVersion поточна version маніфесту
 * @param {Array<{ file: string, entry: { bump: string, section: string, description: string } }>} params.changeFiles change-файли workspace
 * @param {string} params.date `YYYY-MM-DD`
 * @returns {{ newVersion: string, sectionBlock: string, consumedFiles: string[] } | null} результат або null, якщо змін нема
 */
export function aggregateWorkspace({ currentVersion, changeFiles, date }) {
  if (changeFiles.length === 0) return null
  const newVersion = bumpVersion(currentVersion, maxBump(changeFiles.map(c => c.entry.bump)))
  const sectionBlock = renderChangelogSection(
    newVersion,
    date,
    changeFiles.map(c => c.entry)
  )
  return { newVersion, sectionBlock, consumedFiles: changeFiles.map(c => c.file) }
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd npm && bun run vitest run rules/release/js/tests/aggregate.test.mjs`
Expected: PASS (all).

- [ ] **Step 8: Commit**

```bash
git add npm/rules/release/lib/aggregate.mjs npm/rules/release/js/tests/aggregate.test.mjs
git commit -m "feat(release): version bump + changelog section aggregation"
```

---

## Task 4: `n-cursor change` — запис change-файлу

**Files:**
- Create: `npm/rules/release/change.mjs`
- Modify: `npm/bin/n-cursor.js:1503` (після `case 'coverage'`)
- Test: `npm/rules/release/js/tests/change.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// npm/rules/release/js/tests/change.test.mjs
import { describe, expect, test } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { writeChange } from '../../change.mjs'
import { withTmpDir, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

describe('writeChange', () => {
  test('пише <ws>/.changes/<name>.md з валідним вмістом і повертає шлях', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'p', version: '1.0.0', files: ['x'] })
      const rel = await writeChange({ bump: 'minor', section: 'Added', message: 'Нова фіча', ws: '.', cwd: dir })
      expect(rel.startsWith('.changes/')).toBe(true)
      const names = await readdir(join(dir, '.changes'))
      expect(names).toHaveLength(1)
      const text = await readFile(join(dir, '.changes', names[0]), 'utf8')
      expect(text).toBe('---\nbump: minor\nsection: Added\n---\nНова фіча\n')
    })
  })

  test('кидає на невалідному bump/section/порожньому message', async () => {
    await withTmpDir(async dir => {
      await expect(writeChange({ bump: 'huge', section: 'Added', message: 'x', ws: '.', cwd: dir })).rejects.toThrow()
      await expect(writeChange({ bump: 'patch', section: 'Added', message: '', ws: '.', cwd: dir })).rejects.toThrow()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd npm && bun run vitest run rules/release/js/tests/change.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `change.mjs`**

```js
// npm/rules/release/change.mjs
/**
 * `n-cursor change` — пише один change-файл `<ws>/.changes/<timestamp>-<rand>.md`.
 * Замінює ручне редагування CHANGELOG у feature-флоу (n-changelog.mdc v3.0).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { CHANGES_DIR, newChangeFileName, serializeChangeFile } from './lib/change-file.mjs'

/**
 * @param {object} params параметри
 * @param {string} params.bump `major|minor|patch`
 * @param {string} params.section `Added|Changed|Fixed|Removed`
 * @param {string} params.message опис
 * @param {string} [params.ws] workspace (за замовчуванням `.`)
 * @param {string} [params.cwd] корінь
 * @returns {Promise<string>} відносний шлях створеного файлу (від ws)
 */
export async function writeChange({ bump, section, message, ws = '.', cwd = process.cwd() }) {
  const description = (message ?? '').trim()
  // Валідація через serialize→parse-контракт: serializeChangeFile сам не валідує,
  // тому переюзаємо валідатор parseChangeFile через побудову й розбір.
  const content = serializeChangeFile({ bump, section, description })
  // Перевіримо коректність полів, кинувши зрозумілу помилку, якщо щось не так:
  const { parseChangeFile } = await import('./lib/change-file.mjs')
  parseChangeFile(content)

  const dir = join(cwd, ws, CHANGES_DIR)
  await mkdir(dir, { recursive: true })
  const name = newChangeFileName()
  await writeFile(join(dir, name), content)
  return join(CHANGES_DIR, name)
}

/**
 * @param {string[]} args аргументи CLI (`--bump`, `--section`, `--message`, `--ws`)
 * @returns {Promise<number>} exit-код
 */
export async function runChangeCli(args) {
  const get = flag => {
    const i = args.indexOf(flag)
    return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined
  }
  const bump = get('--bump')
  const section = get('--section')
  const message = get('--message')
  const ws = get('--ws') ?? '.'
  if (!bump || !section || !message) {
    console.error('❌ Використання: n-cursor change --bump <major|minor|patch> --section <Added|Changed|Fixed|Removed> --message "<опис>" [--ws <шлях>]')
    return 1
  }
  try {
    const rel = await writeChange({ bump, section, message, ws })
    console.log(`✅ ${join(ws, rel)}`)
    return 0
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd npm && bun run vitest run rules/release/js/tests/change.test.mjs`
Expected: PASS.

- [ ] **Step 5: Wire CLI command in `npm/bin/n-cursor.js`**

After the `case 'coverage': { … break }` block (ends near line 1503), add:

```js
    case 'change': {
      const { runChangeCli } = await import('../rules/release/change.mjs')
      process.exitCode = await runChangeCli(args)

      break
    }
    case 'release': {
      const { runReleaseCli } = await import('../rules/release/release.mjs')
      process.exitCode = await runReleaseCli(args)

      break
    }
```

Also extend the `default:` help string (line ~1518) to include `change, release`.

> Note: `release.mjs` не існує до Task 6 — `case 'release'` тимчасово кидатиме при виклику, але це не ламає інші команди (динамічний import всередині case). Тест-suite не викликає CLI-switch напряму.

- [ ] **Step 6: Manual smoke + commit**

Run: `cd npm && node bin/n-cursor.js change --bump patch --section Fixed --message "smoke" --ws . && ls .changes && git checkout -- . && git clean -fd .changes 2>/dev/null; true`
Expected: друкує `✅ .changes/<name>.md`, файл існує (потім прибраний).

```bash
git add npm/rules/release/change.mjs npm/rules/release/js/tests/change.test.mjs npm/bin/n-cursor.js
git commit -m "feat(release): n-cursor change command"
```

---

## Task 5: `fallback.mjs` — синтез change-запису з git-комітів

**Files:**
- Create: `npm/rules/release/lib/fallback.mjs`
- Test: `npm/rules/release/js/tests/fallback.test.mjs`

Контекст: коли в workspace є релевантні зміни, але **немає** change-файлів, `release` синтезує один запис (`bump: patch`, `section: Changed`) з тем комітів від останнього тегу `<name>@*`. Git-виклики ін'єктуються через параметр `runGit` для тестованості.

- [ ] **Step 1: Write the failing test**

```js
// npm/rules/release/js/tests/fallback.test.mjs
import { describe, expect, test } from 'vitest'

import { synthesizeChangeFromCommits } from '../../lib/fallback.mjs'

/**
 * Стаб git: мапить ключ-команду на stdout (або кидає → null-гілка).
 * @param {Record<string, string>} map мапа `args.join(' ')` → stdout
 * @returns {(args: string[]) => Promise<string | null>} стаб
 */
function gitStub(map) {
  return args => Promise.resolve(Object.hasOwn(map, args.join(' ')) ? map[args.join(' ')] : null)
}

describe('synthesizeChangeFromCommits', () => {
  test('бере commit-subjects від останнього тегу пакета', async () => {
    const runGit = gitStub({
      'describe --tags --abbrev=0 --match p@* HEAD': 'p@1.2.0\n',
      'log --no-merges --format=%s p@1.2.0..HEAD -- pkg/': 'feat: A\nfix: B\n'
    })
    const r = await synthesizeChangeFromCommits('p', 'pkg', { runGit })
    expect(r).toEqual({ bump: 'patch', section: 'Changed', description: 'feat: A; fix: B' })
  })

  test('без тегу пакета — лог від кореня історії', async () => {
    const runGit = gitStub({
      'describe --tags --abbrev=0 --match p@* HEAD': null,
      'log --no-merges --format=%s HEAD -- pkg/': 'init\n'
    })
    const r = await synthesizeChangeFromCommits('p', 'pkg', { runGit })
    expect(r?.description).toBe('init')
  })

  test('нуль комітів → null', async () => {
    const runGit = gitStub({
      'describe --tags --abbrev=0 --match p@* HEAD': 'p@1.0.0\n',
      'log --no-merges --format=%s p@1.0.0..HEAD -- pkg/': '\n'
    })
    expect(await synthesizeChangeFromCommits('p', 'pkg', { runGit })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd npm && bun run vitest run rules/release/js/tests/fallback.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `fallback.mjs`**

```js
// npm/rules/release/lib/fallback.mjs
/**
 * Fallback (n-cursor-release-design рішення 3): коли в workspace є релевантні зміни,
 * але жодного change-файлу — синтезуємо один запис із commit-subjects від останнього
 * релізного тегу `<name>@*`. Усі git-виклики через `runGit` (ін'єкція для тестів).
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * @param {string} cwd робочий каталог
 * @returns {(args: string[]) => Promise<string | null>} тихий git-раннер (null при помилці)
 */
export function defaultRunGit(cwd) {
  return async args => {
    try {
      const { stdout } = await execFileAsync('git', args, { cwd })
      return stdout
    } catch {
      return null
    }
  }
}

/**
 * @param {string} name ім'я пакета (для тегу `<name>@*`)
 * @param {string} ws workspace (pathspec для `git log`; `.` → без обмеження шляху)
 * @param {object} [opts] опції
 * @param {(args: string[]) => Promise<string | null>} [opts.runGit] git-раннер
 * @returns {Promise<{ bump: string, section: string, description: string } | null>} синтезований запис або null
 */
export async function synthesizeChangeFromCommits(name, ws, opts = {}) {
  const runGit = opts.runGit ?? defaultRunGit(process.cwd())
  const lastTagRaw = await runGit(['describe', '--tags', '--abbrev=0', '--match', `${name}@*`, 'HEAD'])
  const lastTag = lastTagRaw?.trim()
  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD'
  const pathspec = ws === '.' ? [] : ['--', `${ws}/`]
  const logRaw = await runGit(['log', '--no-merges', '--format=%s', range, ...pathspec])
  const subjects = (logRaw ?? '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
  if (subjects.length === 0) return null
  return { bump: 'patch', section: 'Changed', description: subjects.join('; ') }
}
```

> Note: тест передає pathspec як `-- pkg/` навіть для ws `pkg`; реалізація формує `['--', 'pkg/']`, що при `args.join(' ')` дає `... -- pkg/` — збігається зі стаб-ключем.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd npm && bun run vitest run rules/release/js/tests/fallback.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add npm/rules/release/lib/fallback.mjs npm/rules/release/js/tests/fallback.test.mjs
git commit -m "feat(release): synthesize changelog entry from commits (fallback)"
```

---

## Task 6: `release.mjs` — оркестрація release у CI

**Files:**
- Create: `npm/rules/release/release.mjs`
- Test: `npm/rules/release/js/tests/release.test.mjs`

Контекст: `release` проходить по всіх workspace (`getMonorepoProjectRootDirs`), для кожного з change-файлами: bump маніфесту, prepend CHANGELOG, видалення consumed change-файлів. Збирає список `{ ws, name, newVersion }`. Git-операції (`commit`, `tag`, `push`) виконує наприкінці одним кроком, через ін'єктований `runGit`, щоб тест їх перевірив без реального ремоуту.

- [ ] **Step 1: Write the failing test (npm-workspace, із change-файлом)**

```js
// npm/rules/release/js/tests/release.test.mjs
import { describe, expect, test } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { release } from '../../release.mjs'
import { withTmpDir, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

describe('release', () => {
  test('бампить version, дописує CHANGELOG, видаляє change-файли, планує тег', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'p', version: '1.2.3', files: ['CHANGELOG.md'] })
      await writeFile(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [1.2.3] - 2026-01-01\n\n### Added\n\n- old\n')
      await mkdir(join(dir, '.changes'), { recursive: true })
      await writeFile(join(dir, '.changes', '1-a.md'), '---\nbump: minor\nsection: Added\n---\nНова фіча\n')

      const gitCalls = []
      const runGit = args => {
        gitCalls.push(args.join(' '))
        return Promise.resolve('')
      }
      const released = await release({ cwd: dir, date: '2026-05-29', runGit })

      expect(released).toEqual([{ ws: '.', name: 'p', newVersion: '1.3.0' }])
      expect(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).version).toBe('1.3.0')
      const cl = await readFile(join(dir, 'CHANGELOG.md'), 'utf8')
      expect(cl.indexOf('## [1.3.0]')).toBeLessThan(cl.indexOf('## [1.2.3]'))
      expect(cl).toContain('Нова фіча')
      expect(existsSync(join(dir, '.changes', '1-a.md'))).toBe(false)
      expect(gitCalls.some(c => c.startsWith('tag p@1.3.0'))).toBe(true)
      expect(gitCalls.some(c => c.startsWith('commit'))).toBe(true)
    })
  })

  test('нуль change-файлів і нуль fallback-комітів → нічого не релізить', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'p', version: '1.0.0', files: ['CHANGELOG.md'] })
      await writeFile(join(dir, 'CHANGELOG.md'), '# Changelog\n')
      const released = await release({ cwd: dir, date: '2026-05-29', runGit: () => Promise.resolve('') })
      expect(released).toEqual([])
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd npm && bun run vitest run rules/release/js/tests/release.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `release.mjs`**

```js
// npm/rules/release/release.mjs
/**
 * `n-cursor release` — агрегує per-workspace change-файли у version-bump + CHANGELOG,
 * комітить, ставить тег `<name>@<version>`, видаляє use-up change-файли. Запускається
 * у CI на `main` (n-cursor-release-design, варіант A). Сам нічого не публікує.
 */
import { rm, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { getMonorepoProjectRootDirs, readPackageManifest } from '../changelog/lib/package-manifest.mjs'
import { aggregateWorkspace } from './lib/aggregate.mjs'
import { CHANGES_DIR, readChangeFiles, serializeChangeFile } from './lib/change-file.mjs'
import { defaultRunGit, synthesizeChangeFromCommits } from './lib/fallback.mjs'

const SEMVER_LINE_RE = /("version"\s*:\s*")[^"]*(")/
const PY_VERSION_LINE_RE = /^(version\s*=\s*")[^"]*(")/m

/**
 * Записує нову version у маніфест, зберігаючи форматування.
 * @param {string} cwd корінь
 * @param {import('../changelog/lib/package-manifest.mjs').PackageManifest} manifest маніфест
 * @param {string} newVersion нова версія
 * @returns {Promise<void>} результат
 */
async function writeManifestVersion(cwd, manifest, newVersion) {
  const path = join(cwd, manifest.ws === '.' ? manifest.manifestRel : `${manifest.ws}/${manifest.manifestRel}`)
  const text = await readFile(path, 'utf8')
  const re = manifest.kind === 'npm' ? SEMVER_LINE_RE : PY_VERSION_LINE_RE
  await writeFile(path, text.replace(re, `$1${newVersion}$2`))
}

/**
 * @param {string} cwd корінь
 * @param {string} ws workspace
 * @param {string} sectionBlock новий блок CHANGELOG
 * @returns {Promise<void>} результат
 */
async function prependWorkspaceChangelog(cwd, ws, sectionBlock) {
  const { prependChangelogSection } = await import('./lib/aggregate.mjs')
  const path = join(cwd, ws, 'CHANGELOG.md')
  const existing = existsSync(path) ? await readFile(path, 'utf8') : ''
  await writeFile(path, prependChangelogSection(existing, sectionBlock))
}

/**
 * Зібрати change-файли workspace (явні + fallback-синтез, якщо явних нема, але є коміти).
 * @param {string} cwd корінь
 * @param {import('../changelog/lib/package-manifest.mjs').PackageManifest} manifest маніфест
 * @param {(args: string[]) => Promise<string | null>} runGit git-раннер
 * @returns {Promise<Array<{ file: string | null, entry: { bump: string, section: string, description: string } }>>} change-файли
 */
async function collectChangeFiles(cwd, manifest, runGit) {
  const explicit = await readChangeFiles(manifest.ws, cwd)
  if (explicit.length > 0) return explicit
  if (!manifest.name) return []
  const synthesized = await synthesizeChangeFromCommits(manifest.name, manifest.ws, { runGit })
  if (!synthesized) return []
  console.warn(`⚠️  ${manifest.ws}: немає change-файлів — синтезовано запис із комітів (fallback)`)
  return [{ file: null, entry: synthesized }]
}

/**
 * @param {object} [opts] опції
 * @param {string} [opts.cwd] корінь
 * @param {string} [opts.date] `YYYY-MM-DD` (за замовчуванням сьогодні)
 * @param {(args: string[]) => Promise<string | null>} [opts.runGit] git-раннер
 * @returns {Promise<Array<{ ws: string, name: string | null, newVersion: string }>>} зрелізовані пакети
 */
export async function release(opts = {}) {
  const cwd = opts.cwd ?? process.cwd()
  const date = opts.date ?? new Date().toISOString().slice(0, 10)
  const runGit = opts.runGit ?? defaultRunGit(cwd)

  const workspaces = await getMonorepoProjectRootDirs(cwd)
  const subWorkspaces = workspaces.filter(w => w !== '.')
  const isMonorepoRoot = subWorkspaces.length > 0

  /** @type {Array<{ ws: string, name: string | null, newVersion: string }>} */
  const released = []
  const tags = []

  for (const ws of workspaces) {
    if (ws === '.' && isMonorepoRoot) continue
    const manifest = await readPackageManifest(ws, cwd)
    if (!manifest || !manifest.version) continue

    const changeFiles = await collectChangeFiles(cwd, manifest, runGit)
    const agg = aggregateWorkspace({ currentVersion: manifest.version, changeFiles, date })
    if (!agg) continue

    await writeManifestVersion(cwd, manifest, agg.newVersion)
    await prependWorkspaceChangelog(cwd, ws, agg.sectionBlock)
    for (const file of agg.consumedFiles.filter(Boolean)) {
      await rm(join(cwd, ws, CHANGES_DIR, file))
    }
    released.push({ ws, name: manifest.name, newVersion: agg.newVersion })
    if (manifest.name) tags.push(`${manifest.name}@${agg.newVersion}`)
  }

  if (released.length > 0) {
    await runGit(['add', '-A'])
    await runGit(['commit', '-m', `release: ${tags.join(', ') || released.map(r => `${r.ws}@${r.newVersion}`).join(', ')}`])
    for (const tag of tags) {
      await runGit(['tag', tag])
    }
    await runGit(['push', '--follow-tags'])
  }
  return released
}

/**
 * @param {string[]} _args аргументи CLI (наразі без опцій)
 * @returns {Promise<number>} exit-код
 */
export async function runReleaseCli(_args) {
  try {
    const released = await release()
    if (released.length === 0) {
      console.log('release: немає змін для релізу')
    } else {
      for (const r of released) console.log(`✅ ${r.name ?? r.ws}@${r.newVersion}`)
    }
    return 0
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}
```

> Примітка: `serializeChangeFile` імпортовано для майбутнього використання у Task 7 не потрібне тут — прибери з import у release.mjs, якщо knip/lint поскаржиться на невикористаний symbol. (Перевір крок lint у Task 10.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd npm && bun run vitest run rules/release/js/tests/release.test.mjs`
Expected: PASS (обидва).

- [ ] **Step 5: Add Python-workspace test (append)**

```js
import { parse as parseToml } from 'smol-toml'

test('python workspace: бампить [project].version у pyproject.toml', async () => {
  await withTmpDir(async dir => {
    await mkdir(join(dir, 'svc'), { recursive: true })
    await writeFile(join(dir, 'svc', 'pyproject.toml'), '[project]\nname = "svc"\nversion = "0.1.0"\n')
    await writeFile(join(dir, 'svc', 'CHANGELOG.md'), '# Changelog\n')
    await mkdir(join(dir, 'svc', '.changes'), { recursive: true })
    await writeFile(join(dir, 'svc', '.changes', '1.md'), '---\nbump: patch\nsection: Fixed\n---\nfix py\n')

    await release({ cwd: dir, date: '2026-05-29', runGit: () => Promise.resolve('') })

    const doc = parseToml(await readFile(join(dir, 'svc', 'pyproject.toml'), 'utf8'))
    expect(doc.project.version).toBe('0.1.1')
  })
})
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd npm && bun run vitest run rules/release/js/tests/release.test.mjs`
Expected: PASS (Python-кейс теж).

- [ ] **Step 7: Commit**

```bash
git add npm/rules/release/release.mjs npm/rules/release/js/tests/release.test.mjs
git commit -m "feat(release): n-cursor release orchestration (bump + changelog + tag)"
```

---

## Task 7: М'яка семантика `consistency.mjs` — change-файл задовольняє вимогу

**Files:**
- Modify: `npm/rules/changelog/js/consistency.mjs`
- Test: `npm/rules/changelog/js/tests/consistency/tests/check.test.mjs`

Контекст: зараз `check` (через `fix changelog`) **fail**-ить, якщо є релевантні зміни без bump. Нова семантика: наявність хоча б одного change-файлу в `<ws>/.changes/` робить це **pass** (намір зафіксовано; bump зробить CI). Ручний bump лишається валідним.

- [ ] **Step 1: Write the failing test (append to check.test.mjs)**

```js
import { mkdir, writeFile as writeFileFs } from 'node:fs/promises'

test('наявність change-файлу задовольняє вимогу замість bump (local-only feature-гілка)', async () => {
  await withTmpDir(async dir => {
    await git(['init', '-b', 'main'], dir)
    await writeJson(join(dir, 'package.json'), { name: 'p', version: '1.0.0', private: true })
    await writeFileFs(join(dir, 'CHANGELOG.md'), '# Changelog\n')
    await git(['add', '-A'], dir)
    await git(['commit', '-m', 'init'], dir)
    await git(['checkout', '-b', 'feat'], dir)
    await writeFileFs(join(dir, 'src.mjs'), 'export const x = 1\n') // релевантна зміна
    await mkdir(join(dir, '.changes'), { recursive: true })
    await writeFileFs(join(dir, '.changes', '1-a.md'), '---\nbump: patch\nsection: Added\n---\nx\n')

    const code = await checkChangelog({ cwd: dir })
    expect(code).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd npm && bun run vitest run rules/changelog/js/tests/consistency/tests/check.test.mjs -t 'change-файлу'`
Expected: FAIL — code === 1 (bump відсутній, change-файл наразі ігнорується).

- [ ] **Step 3: Implement — add change-file short-circuit**

In `npm/rules/changelog/js/consistency.mjs`, add an import at top:

```js
import { readChangeFiles } from '../../release/lib/change-file.mjs'
```

Add a helper near `workspaceLabel` (~line 397):

```js
/**
 * Чи має workspace незрелізні change-файли (намір зафіксовано — bump зробить CI).
 * @param {string} ws workspace
 * @param {string} cwd корінь
 * @returns {Promise<boolean>} результат
 */
async function hasPendingChangeFiles(ws, cwd) {
  return (await readChangeFiles(ws, cwd)).length > 0
}
```

In `checkLocalOnlyChangedWorkspace` (~line 502), at the very start after computing `label`/`mf`, short-circuit:

```js
  if (await hasPendingChangeFiles(manifest.ws, cwd)) {
    pass(`${label}: є change-файл(и) у .changes/ — bump зробить CI (n-changelog.mdc)`)
    return
  }
```

In `checkPublishedWorkspacePendingGitChanges` (~line 407), at the start after `mf`, add the same guard returning early before the git comparison:

```js
  if (await hasPendingChangeFiles(manifest.ws, cwd)) {
    pass(`${label}: є change-файл(и) у .changes/ — bump зробить CI (n-changelog.mdc)`)
    return
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd npm && bun run vitest run rules/changelog/js/tests/consistency/tests/check.test.mjs`
Expected: PASS (новий тест + усі наявні — регресій нема).

- [ ] **Step 5: Commit**

```bash
git add npm/rules/changelog/js/consistency.mjs npm/rules/changelog/js/tests/consistency/tests/check.test.mjs
git commit -m "feat(changelog): accept .changes/ files in lieu of manual bump"
```

---

## Task 8: Оновити правило `n-changelog.mdc` (v2.6 → v3.0)

**Files:**
- Modify: `npm/rules/changelog/changelog.mdc` (джерело в пакеті)
- Modify: `.cursor/rules/n-changelog.mdc` (синхронізована копія в цьому репо)

> Обидва треба правити вручну в межах цього PR: `.cursor/` синхронізується з пакета, але до релізу пакета локальна копія має відповідати джерелу, інакше агенти бачитимуть стару семантику.

- [ ] **Step 1: Update STOP block in `npm/rules/changelog/changelog.mdc`**

Замінити нумерований список у STOP-блоці (кроки 1–3) на:

```md
1. **Поклади change-файл** `<ws>/.changes/<timestamp>-<rand>.md` з frontmatter `bump:` (`major|minor|patch`) + `section:` (`Added|Changed|Fixed|Removed`) і описом. Команда: `npx @nitra/cursor change --bump <…> --section <…> --message "<…>" [--ws <шлях>]`.
2. **Не** редагуй `version` і `CHANGELOG.md` вручну — це робить `n-cursor release` у CI на `main` (агрегує change-файли, ставить тег `<name>@<version>`).
3. `npx @nitra/cursor fix changelog` → exit `0` (м'яка перевірка: наявність change-файлу **або** піднятого version).

**Legacy/hotfix:** ручний bump version + запис у CHANGELOG усе ще приймається перевіркою (альтернатива change-файлу).
```

Підняти `version:` у frontmatter правила `2.6` → `3.0`.

- [ ] **Step 2: Mirror the same edits into `.cursor/rules/n-changelog.mdc`**

Застосувати ідентичні зміни тексту STOP-блоку та `version: '3.0'` у локальній копії.

- [ ] **Step 3: Verify text consistency**

Run: `cd /Users/vitaliytv/www/nitra/cursor && diff <(sed -n '/## STOP/,/^---/p' npm/rules/changelog/changelog.mdc) <(sed -n '/## STOP/,/^---/p' .cursor/rules/n-changelog.mdc)`
Expected: порожній diff (STOP-блоки ідентичні).

- [ ] **Step 4: Commit**

```bash
git add npm/rules/changelog/changelog.mdc .cursor/rules/n-changelog.mdc
git commit -m "docs(changelog): v3.0 — change files replace manual bump in feature flow"
```

---

## Task 9: CI — `release` + `publish` в одному job'і та template для scope B

**Files:**
- Modify: `.github/workflows/npm-publish.yml`
- Create: `npm/github-actions/release/action.yml` (composite template для споживачів)

- [ ] **Step 1: Update `.github/workflows/npm-publish.yml`**

```yaml
name: npm-publish

on:
  push:
    paths:
      - 'npm/**'
      - '**/.changes/**'
    branches:
      - main

concurrency:
  group: ${{ github.ref }}-${{ github.workflow }}
  cancel-in-progress: false

jobs:
  release-publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write # КРИТИЧНО для OIDC!

    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: true
          fetch-depth: 0

      - uses: actions/setup-node@v6
        with:
          node-version: '24'
          registry-url: 'https://registry.npmjs.org'

      - name: Release (bump + CHANGELOG + tag)
        run: npx @nitra/cursor release

      - name: Publish package
        uses: JS-DevTools/npm-publish@v4.1.5
        with:
          package: npm/package.json
```

- [ ] **Step 2: Create composite action template `npm/github-actions/release/action.yml`**

```yaml
name: n-cursor release
description: Aggregate .changes/* into version bump + CHANGELOG, tag <name>@<version>, commit back

runs:
  using: composite
  steps:
    - name: Release (bump + CHANGELOG + tag)
      shell: bash
      run: npx @nitra/cursor release
```

> Споживчий sync копіює `github-actions/` у `.github/actions/` (як наявний `setup-bun-deps`). Споживач підключає крок `uses: ./.github/actions/release` перед своїм publish-кроком.

- [ ] **Step 3: Lint the workflow**

Run: `cd /Users/vitaliytv/www/nitra/cursor && npx @nitra/cursor lint-ga`
Expected: exit `0` (actionlint + zizmor чисті).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/npm-publish.yml npm/github-actions/release/action.yml
git commit -m "ci(release): run n-cursor release before publish; ship composite template"
```

---

## Task 10: Self-release bump + повна верифікація

**Files:**
- Modify: `npm/CHANGELOG.md`, `npm/package.json`

За власним правилом `n-changelog.mdc` (registry-published пакет `@nitra/cursor`) реліз цієї фічі потребує bump. Оскільки сам `release` ще не крутиться в CI на момент мерджу цього PR, робимо bump вручну (legacy-шлях, який ми ж лишили дозволеним).

- [ ] **Step 1: Run full release-rule test suite**

Run: `cd npm && bun run vitest run rules/release/`
Expected: PASS — усі 5 файлів тестів.

- [ ] **Step 2: Run changelog rule tests (регресія)**

Run: `cd npm && bun run vitest run rules/changelog/`
Expected: PASS.

- [ ] **Step 3: Bump version + CHANGELOG**

Bump `npm/package.json` `version` `1.30.0` → `1.31.0` (minor — нова фіча).

Prepend to `npm/CHANGELOG.md`:

```md
## [1.31.0] - 2026-05-29

### Added

- `n-cursor change` / `n-cursor release` — change-файли `<ws>/.changes/*.md` замість ручного bump/CHANGELOG; реліз агрегує їх у CI, ставить тег `<name>@<version>`. Підтримка npm і Python workspace.

### Changed

- `n-changelog.mdc` v3.0: feature-флоу кладе change-файл; `fix changelog` приймає change-файл або ручний bump.
```

- [ ] **Step 4: Run the changelog self-check**

Run: `cd /Users/vitaliytv/www/nitra/cursor && bun ./npm/bin/n-cursor.js fix changelog`
Expected: exit `0`.

- [ ] **Step 5: Run repo lint (single sequential pass — див. CLAUDE.md)**

Run: `cd /Users/vitaliytv/www/nitra/cursor && bun run lint`
Expected: exit `0`. Якщо knip скаржиться на невикористаний import у `release.mjs` — прибери його й перезапусти.

- [ ] **Step 6: Commit**

```bash
git add npm/package.json npm/CHANGELOG.md
git commit -m "release: @nitra/cursor@1.31.0"
```

---

## Self-Review

**Spec coverage:**
- Scope B (фіча для споживачів) → Task 9 (composite template) + Task 8 (правило синкається). ✔
- Свій скрипт, не changesets/Beachball → Tasks 1–6 власні модулі. ✔
- npm + Python → `aggregateWorkspace`/`writeManifestVersion` обробляють обидва; Task 6 Step 5 — Python-тест. ✔
- Per-workspace `.changes/` → `readChangeFiles(ws)`, `CHANGES_DIR`. ✔
- Формат `bump`+`section` → Task 1. ✔
- Ім'я `<timestamp>-<short-rand>` → Task 2 `newChangeFileName`. ✔
- `release` у CI (варіант A) → Task 6 + Task 9. ✔
- Fallback (рішення 3) → Task 5 + `collectChangeFiles`. ✔
- Тег `<name>@<version>` (Варіант 1) → Task 6 `tags`. ✔
- М'який `check` → Task 7. ✔
- Правило v3.0 → Task 8. ✔
- `npm-publish.yml` як template у цій ітерації → Task 9. ✔

**Placeholder scan:** Кожен крок має повний код/команду й Expected. Немає «TODO/handle edge cases». ✔

**Type consistency:** `parseChangeFile`/`serializeChangeFile`/`readChangeFiles`/`newChangeFileName`/`CHANGES_DIR` (change-file.mjs); `bumpVersion`/`maxBump`/`renderChangelogSection`/`prependChangelogSection`/`aggregateWorkspace` (aggregate.mjs); `synthesizeChangeFromCommits`/`defaultRunGit` (fallback.mjs); `release`/`runReleaseCli` (release.mjs); `writeChange`/`runChangeCli` (change.mjs) — імена збігаються між визначенням і використанням у всіх тасках. ✔

**Known follow-ups (поза скоупом, зафіксовано у спеці):** dependent-bump graph, prerelease-канали, інтерактивний вибір пакета, Python-publish у CI.
