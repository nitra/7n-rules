# Skill meta.json + worktree-прапорець Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Замінити `auto.md` у `npm/skills/<id>/` на `meta.json` з полями `auto` та `worktree`; під час `syncSkills` вшивати worktree-блок у копію `SKILL.md`; валідувати `meta.json` через новий check-concern `skill_meta.mjs`.

**Architecture:** Новий утиліт `read-skill-meta.mjs` читає `meta.json` з fallback на `auto.md`; утиліт `inject-worktree-block.mjs` — чиста функція ін'єкції/видалення markdown-блоку. `auto-skills.mjs` перемикається на `readSkillMeta`. `syncSkills` у `n-cursor.js` пропускає `meta.json` (замість `auto.md`) і ін'єктує блок у `SKILL.md`. Новий JS-concern `skill_meta.mjs` у правилі `npm-module` перевіряє наявність і валідність `meta.json` у кожному `npm/skills/<id>/`.

**Tech Stack:** Node.js ESM, vitest, `node:fs/promises`, `node:path`, `withTmpDir`/`writeJson` з `test-helpers.mjs`.

---

## File Map

| Дія | Файл |
|---|---|
| **Create** | `npm/scripts/utils/read-skill-meta.mjs` |
| **Create** | `npm/scripts/utils/tests/read-skill-meta.test.mjs` |
| **Create** | `npm/scripts/utils/inject-worktree-block.mjs` |
| **Create** | `npm/scripts/utils/tests/inject-worktree-block.test.mjs` |
| **Create** | `npm/schemas/skill-meta.schema.json` |
| **Create** | `npm/skills/*/meta.json` (9 файлів) |
| **Delete** | `npm/skills/*/auto.md` (9 файлів) |
| **Modify** | `npm/scripts/auto-skills.mjs` |
| **Modify** | `npm/scripts/tests/auto-skills.test.mjs` |
| **Modify** | `npm/bin/n-cursor.js` |
| **Create** | `npm/rules/npm-module/js/skill_meta.mjs` |
| **Create** | `npm/rules/npm-module/js/tests/skill_meta.test.mjs` |
| **Modify** | `npm/tests/integration-repo-checks.test.mjs` |

---

## Task 1: `read-skill-meta.mjs` — читач meta.json з fallback на auto.md

**Files:**
- Create: `npm/scripts/utils/read-skill-meta.mjs`
- Create: `npm/scripts/utils/tests/read-skill-meta.test.mjs`

- [ ] **Крок 1.1: Написати тести (red)**

```js
// npm/scripts/utils/tests/read-skill-meta.test.mjs
import { describe, expect, it } from 'vitest'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { readSkillMeta } from '../read-skill-meta.mjs'
import { withTmpDir } from '../../test-helpers.mjs'

describe('readSkillMeta', () => {
  it('читає meta.json і повертає spec + worktree', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'meta.json'), JSON.stringify({ auto: 'завжди', worktree: true }))
      const result = readSkillMeta(dir)
      expect(result).toEqual({ spec: { always: true }, worktree: true })
    })
  })

  it('масив у auto → spec.rules', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'meta.json'), JSON.stringify({ auto: ['bun', 'adr'], worktree: false }))
      const result = readSkillMeta(dir)
      expect(result).toEqual({ spec: { rules: ['bun', 'adr'] }, worktree: false })
    })
  })

  it('відсутній meta.json і auto.md → spec null, worktree false', async () => {
    await withTmpDir(async dir => {
      const result = readSkillMeta(dir)
      expect(result).toEqual({ spec: null, worktree: false })
    })
  })

  it('лише auto.md (deprecated) → spec розпізнається, worktree false', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'auto.md'), '[bun]\n')
      const stderrLines = []
      const result = readSkillMeta(dir, { onWarn: msg => stderrLines.push(msg) })
      expect(result).toEqual({ spec: { rules: ['bun'] }, worktree: false })
      expect(stderrLines.length).toBeGreaterThan(0)
    })
  })

  it('обидва є → meta.json має пріоритет, варнінг', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'meta.json'), JSON.stringify({ auto: 'завжди', worktree: false }))
      await writeFile(join(dir, 'auto.md'), '[bun]\n')
      const warns = []
      const result = readSkillMeta(dir, { onWarn: msg => warns.push(msg) })
      expect(result.spec).toEqual({ always: true })
      expect(warns.some(w => w.includes('auto.md'))).toBe(true)
    })
  })

  it('порожній масив auto → spec null (нерозпізнаний)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'meta.json'), JSON.stringify({ auto: [], worktree: false }))
      const result = readSkillMeta(dir)
      expect(result.spec).toBeNull()
    })
  })
})
```

- [ ] **Крок 1.2: Запустити тести, переконатися що падають**

```bash
cd npm && npx vitest run scripts/utils/tests/read-skill-meta.test.mjs
```
Очікується: FAIL (модуль не існує).

- [ ] **Крок 1.3: Написати `read-skill-meta.mjs`**

```js
// npm/scripts/utils/read-skill-meta.mjs
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ALWAYS_LITERAL = 'завжди'
const BRACKET_LIST_RE = /^\[([^\]]+)\]$/u

/**
 * @typedef {{ always: true } | { rules: readonly string[] }} SkillAutoSpec
 * @typedef {{ spec: SkillAutoSpec | null, worktree: boolean }} SkillMeta
 */

/**
 * Парсить legacy-рядок з `auto.md` у `SkillAutoSpec`.
 * @param {string} text
 * @returns {SkillAutoSpec | null}
 */
function parseLegacyAutoMd(text) {
  const trimmed = text.trim()
  if (trimmed === ALWAYS_LITERAL) return { always: true }
  const m = trimmed.match(BRACKET_LIST_RE)
  if (m) {
    const rules = m[1].split(',').map(s => s.trim()).filter(s => s.length > 0)
    if (rules.length === 0) return null
    return { rules: Object.freeze(rules) }
  }
  return null
}

/**
 * Перетворює поле `auto` з meta.json у `SkillAutoSpec`.
 * @param {unknown} auto
 * @returns {SkillAutoSpec | null}
 */
function parseAutoField(auto) {
  if (auto === ALWAYS_LITERAL) return { always: true }
  if (Array.isArray(auto) && auto.length > 0 && auto.every(s => typeof s === 'string')) {
    return { rules: Object.freeze(auto) }
  }
  return null
}

/**
 * Читає налаштування скіла: спочатку `meta.json`, потім fallback на `auto.md`.
 * @param {string} skillDir абсолютний шлях до каталогу скіла
 * @param {{ onWarn?: (msg: string) => void }} [opts] ін'єкція для тестів
 * @returns {SkillMeta}
 */
export function readSkillMeta(skillDir, opts = {}) {
  const warn = opts.onWarn ?? (msg => process.stderr.write(`${msg}\n`))

  const metaPath = join(skillDir, 'meta.json')
  const autoMdPath = join(skillDir, 'auto.md')

  if (existsSync(metaPath)) {
    if (existsSync(autoMdPath)) {
      warn(`WARN: ${skillDir}: meta.json і auto.md присутні — видали auto.md (meta.json має пріоритет)`)
    }
    const raw = JSON.parse(readFileSync(metaPath, 'utf8'))
    return { spec: parseAutoField(raw.auto), worktree: raw.worktree === true }
  }

  if (existsSync(autoMdPath)) {
    warn(`WARN: ${autoMdPath}: auto.md застарілий — мігруй на meta.json (schemas/skill-meta.schema.json)`)
    const spec = parseLegacyAutoMd(readFileSync(autoMdPath, 'utf8'))
    return { spec, worktree: false }
  }

  return { spec: null, worktree: false }
}
```

- [ ] **Крок 1.4: Запустити тести, переконатися що проходять**

```bash
cd npm && npx vitest run scripts/utils/tests/read-skill-meta.test.mjs
```
Очікується: 6 passed.

- [ ] **Крок 1.5: Commit**

```bash
git add npm/scripts/utils/read-skill-meta.mjs npm/scripts/utils/tests/read-skill-meta.test.mjs
git commit -m "feat(skill-meta): read-skill-meta.mjs — парсер meta.json з fallback на auto.md"
```

---

## Task 2: `inject-worktree-block.mjs` — ін'єкція worktree-блоку в SKILL.md

**Files:**
- Create: `npm/scripts/utils/inject-worktree-block.mjs`
- Create: `npm/scripts/utils/tests/inject-worktree-block.test.mjs`

- [ ] **Крок 2.1: Написати тести (red)**

```js
// npm/scripts/utils/tests/inject-worktree-block.test.mjs
import { describe, expect, it } from 'vitest'
import { injectWorktreeBlock, WORKTREE_START, WORKTREE_END } from '../inject-worktree-block.mjs'

const SKILL_WITH_FRONTMATTER = `---
name: fix
description: >-
  Виправити проєкт
---

# n-fix — автоматичне виправлення

Тіло.
`

const SKILL_NO_FRONTMATTER = `# n-fix — автоматичне виправлення

Тіло.
`

describe('injectWorktreeBlock', () => {
  it('вставляє блок між frontmatter і заголовком (worktree: true)', () => {
    const result = injectWorktreeBlock(SKILL_WITH_FRONTMATTER, true)
    const startIdx = result.indexOf(WORKTREE_START)
    const endIdx = result.indexOf(WORKTREE_END)
    const headIdx = result.indexOf('\n# ')
    expect(startIdx).toBeGreaterThan(0)
    expect(endIdx).toBeGreaterThan(startIdx)
    expect(headIdx).toBeGreaterThan(endIdx)
  })

  it('вставляє блок перед заголовком коли немає frontmatter (worktree: true)', () => {
    const result = injectWorktreeBlock(SKILL_NO_FRONTMATTER, true)
    expect(result.includes(WORKTREE_START)).toBe(true)
    expect(result.indexOf(WORKTREE_START)).toBeLessThan(result.indexOf('\n# '))
  })

  it('worktree: false — не вставляє блок', () => {
    const result = injectWorktreeBlock(SKILL_WITH_FRONTMATTER, false)
    expect(result.includes(WORKTREE_START)).toBe(false)
    expect(result).toBe(SKILL_WITH_FRONTMATTER)
  })

  it('worktree: false — видаляє існуючий блок', () => {
    const withBlock = injectWorktreeBlock(SKILL_WITH_FRONTMATTER, true)
    const cleaned = injectWorktreeBlock(withBlock, false)
    expect(cleaned.includes(WORKTREE_START)).toBe(false)
    expect(cleaned.includes('# n-fix')).toBe(true)
  })

  it('ідемпотентність — повторний виклик з true не дублює блок', () => {
    const once = injectWorktreeBlock(SKILL_WITH_FRONTMATTER, true)
    const twice = injectWorktreeBlock(once, true)
    const count = (twice.match(new RegExp(WORKTREE_START.replace(/</g, '\\<').replace(/>/g, '\\>'), 'g')) ?? []).length
    expect(count).toBe(1)
  })

  it('блок містить очікуваний текст інструкції', () => {
    const result = injectWorktreeBlock(SKILL_WITH_FRONTMATTER, true)
    expect(result).toMatch(/git worktree/)
    expect(result).toMatch(/не запускати більше одного/i)
  })
})
```

- [ ] **Крок 2.2: Запустити тести, переконатися що падають**

```bash
cd npm && npx vitest run scripts/utils/tests/inject-worktree-block.test.mjs
```
Очікується: FAIL.

- [ ] **Крок 2.3: Написати `inject-worktree-block.mjs`**

```js
// npm/scripts/utils/inject-worktree-block.mjs

export const WORKTREE_START = '<!-- n-cursor:worktree:start -->'
export const WORKTREE_END = '<!-- n-cursor:worktree:end -->'

const WORKTREE_BLOCK = `${WORKTREE_START}
> **Worktree:** цей скіл виконується в окремому \`git worktree\`.
> Не запускати більше одного інстансу одночасно.
${WORKTREE_END}`

/**
 * Знаходить кінець YAML frontmatter (`---\n...\n---`) у вмісті SKILL.md.
 * @param {string} content
 * @returns {number} індекс символу одразу після другого `---\n`, або -1
 */
function findFrontmatterEnd(content) {
  if (!content.startsWith('---')) return -1
  const secondDash = content.indexOf('\n---', 3)
  if (secondDash === -1) return -1
  const afterDash = secondDash + '\n---'.length
  // пропустити '\n' після закриваючого ---
  return content[afterDash] === '\n' ? afterDash + 1 : afterDash
}

/**
 * Вставляє або видаляє worktree-блок у вмісті `SKILL.md`.
 * Якщо `worktree: true` — вставляє між frontmatter і першим `#`. Ідемпотентно.
 * Якщо `worktree: false` — видаляє блок (якщо є).
 * @param {string} content вміст SKILL.md
 * @param {boolean} worktree
 * @returns {string} оновлений вміст
 */
export function injectWorktreeBlock(content, worktree) {
  // Видалити наявний блок
  const startIdx = content.indexOf(WORKTREE_START)
  if (startIdx !== -1) {
    const endIdx = content.indexOf(WORKTREE_END, startIdx)
    if (endIdx !== -1) {
      const before = content.slice(0, startIdx).trimEnd()
      const after = content.slice(endIdx + WORKTREE_END.length).trimStart()
      content = `${before}\n\n${after}`
    }
  }

  if (!worktree) return content

  const fmEnd = findFrontmatterEnd(content)
  if (fmEnd !== -1) {
    return `${content.slice(0, fmEnd).trimEnd()}\n\n${WORKTREE_BLOCK}\n\n${content.slice(fmEnd).trimStart()}`
  }

  // Немає frontmatter — вставити перед першим заголовком
  const headMatch = content.match(/^#\s/m)
  if (headMatch?.index !== undefined) {
    return `${content.slice(0, headMatch.index).trimEnd()}\n\n${WORKTREE_BLOCK}\n\n${content.slice(headMatch.index)}`
  }

  return `${WORKTREE_BLOCK}\n\n${content}`
}
```

- [ ] **Крок 2.4: Запустити тести, переконатися що проходять**

```bash
cd npm && npx vitest run scripts/utils/tests/inject-worktree-block.test.mjs
```
Очікується: 6 passed.

- [ ] **Крок 2.5: Commit**

```bash
git add npm/scripts/utils/inject-worktree-block.mjs npm/scripts/utils/tests/inject-worktree-block.test.mjs
git commit -m "feat(skill-meta): inject-worktree-block.mjs — ін'єкція worktree-блоку в SKILL.md"
```

---

## Task 3: Оновити `auto-skills.mjs` і його тести

**Files:**
- Modify: `npm/scripts/auto-skills.mjs`
- Modify: `npm/scripts/tests/auto-skills.test.mjs`

- [ ] **Крок 3.1: Замінити `auto-skills.mjs`**

```js
// npm/scripts/auto-skills.mjs
/**
 * Автовизначення skills для `.n-cursor.json` за умовами з `npm/skills/<skill>/meta.json`.
 *
 * `meta.json` — джерело правди (а не hardcoded мапа). Підтримуються три варіанти:
 *  - `{ "auto": "завжди" }` — скіл активується незалежно від правил
 *  - `{ "auto": ["rule1", ...] }` — скіл активується, якщо всі правила виявлені
 *  - файл відсутній або `auto` не розпізнано — скіл opt-in лише через `.n-cursor.json:skills`
 *
 * Fallback: якщо `meta.json` відсутній але є `auto.md` — читається з попередженням у stderr.
 */
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSkillMeta } from './utils/read-skill-meta.mjs'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SKILLS_DIR = join(PACKAGE_ROOT, 'skills')

/**
 * @typedef {{ always: true } | { rules: readonly string[] }} SkillAutoSpec
 */

/**
 * Сканує `npm/skills/<id>/meta.json`. Скіли без `meta.json`/`auto.md` або з нерозпізнаним
 * вмістом не потрапляють у результат — їх можна вмикати лише вручну в конфізі.
 * @param {string} [skillsDir] override для тестів
 * @returns {Record<string, SkillAutoSpec>} мапа `skillId → spec`
 */
export function discoverSkillAutoActivation(skillsDir = SKILLS_DIR) {
  if (!existsSync(skillsDir)) return {}
  /** @type {Record<string, SkillAutoSpec>} */
  const out = {}
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const { spec } = readSkillMeta(join(skillsDir, entry.name))
    if (spec) out[entry.name] = spec
  }
  return out
}

/** Cache на час процесу: один скан `npm/skills/` дає всю автоактивацію. */
const SKILL_AUTO_ACTIVATION = discoverSkillAutoActivation()

/**
 * Стабільний алфавітний порядок скілів з автоактивацією.
 */
export const AUTO_SKILL_ORDER = Object.freeze(Object.keys(SKILL_AUTO_ACTIVATION).toSorted((a, b) => a.localeCompare(b)))

/**
 * Похідна view на `SKILL_AUTO_ACTIVATION`: лише скіли з rule-залежностями.
 */
export const AUTO_SKILL_RULE_DEPENDENCIES = Object.freeze(
  Object.fromEntries(
    Object.entries(SKILL_AUTO_ACTIVATION)
      .filter(([, spec]) => 'rules' in spec)
      .map(([id, spec]) => [id, /** @type {{ rules: readonly string[] }} */ (spec).rules])
  )
)

const DEFAULT_DISABLED_LIST = Object.freeze([])

/**
 * Визначає авто-skills згідно з вмістом `skills/<skill>/meta.json`.
 * @param {object} params параметри
 * @param {string[]} params.availableSkills перелік доступних skills із пакету (id без префікса n-)
 * @param {string[]} params.detectedRules id правил, виявлених auto-rules
 * @param {string[]} [params.disableSkills] список `disable-skills` з конфігу
 * @returns {{ skills: string[] }} список id у стабільному алфавітному порядку
 */
export function detectAutoSkills({ availableSkills, detectedRules, disableSkills = DEFAULT_DISABLED_LIST }) {
  const normalizedSkills = new Set(availableSkills.map(s => s.trim().toLowerCase()))
  const disableSkillsSet = new Set(disableSkills)
  const detectedRulesSet = new Set(detectedRules)

  /** @type {Set<string>} */
  const detected = new Set()

  for (const [skillId, spec] of Object.entries(SKILL_AUTO_ACTIVATION)) {
    if (!normalizedSkills.has(skillId) || disableSkillsSet.has(skillId)) continue
    if ('always' in spec || spec.rules.every(d => detectedRulesSet.has(d))) {
      detected.add(skillId)
    }
  }

  return { skills: AUTO_SKILL_ORDER.filter(id => detected.has(id)) }
}
```

- [ ] **Крок 3.2: Запустити існуючі тести, переконатися що проходять**

```bash
cd npm && npx vitest run scripts/tests/auto-skills.test.mjs
```
Очікується: 7 passed (тести залежать від реального `npm/skills/` — ще до видалення `auto.md`, тому вони читають `auto.md` через fallback. Після Task 5 вони читатимуть `meta.json`).

- [ ] **Крок 3.3: Додати тести для нових скілів (`coverage-fix`, `fix-tests`, `start-check`)**

Відкрий `npm/scripts/tests/auto-skills.test.mjs` і додай в кінці перед закриваючою дужкою `describe`:

```js
  // --- Нові скіли з meta.json ---
  const EXTENDED_SKILLS = [
    'adr-normalize', 'coverage-fix', 'fix', 'fix-tests', 'lint',
    'llm-patch', 'publish-telegram', 'start-check', 'taze'
  ]

  test('coverage-fix і fix-tests додаються при js-lint', () => {
    const actual = detectAutoSkills({
      availableSkills: EXTENDED_SKILLS,
      detectedRules: ['js-lint']
    })
    expect(actual.skills.includes('coverage-fix')).toBe(true)
    expect(actual.skills.includes('fix-tests')).toBe(true)
  })

  test('start-check додається при bun', () => {
    const actual = detectAutoSkills({
      availableSkills: EXTENDED_SKILLS,
      detectedRules: ['bun']
    })
    expect(actual.skills.includes('start-check')).toBe(true)
  })

  test('coverage-fix і fix-tests НЕ додаються без js-lint', () => {
    const actual = detectAutoSkills({
      availableSkills: EXTENDED_SKILLS,
      detectedRules: ['bun']
    })
    expect(actual.skills.includes('coverage-fix')).toBe(false)
    expect(actual.skills.includes('fix-tests')).toBe(false)
  })
```

- [ ] **Крок 3.4: Запустити оновлені тести — вони мають пройти (після Task 5 завдяки meta.json)**

Ці тести проходитимуть після Task 5. Зараз вони залежать від існуючих `auto.md` файлів через fallback.

```bash
cd npm && npx vitest run scripts/tests/auto-skills.test.mjs
```
Очікується: ≥7 passed.

- [ ] **Крок 3.5: Commit**

```bash
git add npm/scripts/auto-skills.mjs npm/scripts/tests/auto-skills.test.mjs
git commit -m "feat(skill-meta): auto-skills.mjs — перемикання на readSkillMeta (meta.json)"
```

---

## Task 4: Створити `meta.json` для 9 скілів і видалити `auto.md`

**Files:**
- Create: `npm/skills/adr-normalize/meta.json`
- Create: `npm/skills/coverage-fix/meta.json`
- Create: `npm/skills/fix/meta.json`
- Create: `npm/skills/fix-tests/meta.json`
- Create: `npm/skills/lint/meta.json`
- Create: `npm/skills/llm-patch/meta.json`
- Create: `npm/skills/publish-telegram/meta.json`
- Create: `npm/skills/start-check/meta.json`
- Create: `npm/skills/taze/meta.json`
- Delete: `npm/skills/*/auto.md` (9 файлів)

- [ ] **Крок 4.1: Створити всі `meta.json` файли**

```bash
cat > npm/skills/adr-normalize/meta.json << 'EOF'
{
  "auto": ["adr"],
  "worktree": true
}
EOF

cat > npm/skills/coverage-fix/meta.json << 'EOF'
{
  "auto": ["js-lint"],
  "worktree": true
}
EOF

cat > npm/skills/fix/meta.json << 'EOF'
{
  "auto": "завжди",
  "worktree": true
}
EOF

cat > npm/skills/fix-tests/meta.json << 'EOF'
{
  "auto": ["js-lint"],
  "worktree": true
}
EOF

cat > npm/skills/lint/meta.json << 'EOF'
{
  "auto": "завжди",
  "worktree": true
}
EOF

cat > npm/skills/llm-patch/meta.json << 'EOF'
{
  "auto": "завжди",
  "worktree": false
}
EOF

cat > npm/skills/publish-telegram/meta.json << 'EOF'
{
  "auto": "завжди",
  "worktree": false
}
EOF

cat > npm/skills/start-check/meta.json << 'EOF'
{
  "auto": ["bun"],
  "worktree": false
}
EOF

cat > npm/skills/taze/meta.json << 'EOF'
{
  "auto": ["bun"],
  "worktree": true
}
EOF
```

- [ ] **Крок 4.2: Видалити всі `auto.md` файли**

```bash
rm npm/skills/adr-normalize/auto.md \
   npm/skills/coverage-fix/auto.md \
   npm/skills/fix/auto.md \
   npm/skills/fix-tests/auto.md \
   npm/skills/lint/auto.md \
   npm/skills/llm-patch/auto.md \
   npm/skills/publish-telegram/auto.md \
   npm/skills/start-check/auto.md \
   npm/skills/taze/auto.md
```

- [ ] **Крок 4.3: Перевірити що auto-skills тести ще проходять (тепер читають meta.json)**

```bash
cd npm && npx vitest run scripts/tests/auto-skills.test.mjs
```
Очікується: ≥7 passed без жодних WARN у stderr.

- [ ] **Крок 4.4: Commit**

```bash
git add npm/skills/
git commit -m "feat(skill-meta): мігрувати auto.md → meta.json для 9 скілів"
```

---

## Task 5: Створити `skill-meta.schema.json`

**Files:**
- Create: `npm/schemas/skill-meta.schema.json`

- [ ] **Крок 5.1: Створити схему**

```bash
cat > npm/schemas/skill-meta.schema.json << 'EOF'
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://unpkg.com/@nitra/cursor/schemas/skill-meta.schema.json",
  "title": "skill meta.json",
  "description": "Налаштування авто-активації та worktree-режиму для npm/skills/<id>/meta.json",
  "type": "object",
  "required": ["auto", "worktree"],
  "additionalProperties": false,
  "properties": {
    "auto": {
      "description": "Умова авто-активації скіла: 'завжди' або масив id правил (усі мають бути виявлені)",
      "oneOf": [
        { "const": "завжди" },
        {
          "type": "array",
          "items": { "type": "string", "minLength": 1 },
          "minItems": 1
        }
      ]
    },
    "worktree": {
      "type": "boolean",
      "description": "Якщо true — скіл виконується в ізольованому git worktree; не запускати паралельно"
    }
  }
}
EOF
```

- [ ] **Крок 5.2: Переконатися що схема валідна JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('npm/schemas/skill-meta.schema.json', 'utf8')); console.log('OK')"
```
Очікується: `OK`.

- [ ] **Крок 5.3: Commit**

```bash
git add npm/schemas/skill-meta.schema.json
git commit -m "feat(skill-meta): skill-meta.schema.json — JSON Schema для meta.json"
```

---

## Task 6: Оновити `syncSkills` у `n-cursor.js`

**Files:**
- Modify: `npm/bin/n-cursor.js`

- [ ] **Крок 6.1: Додати import `injectWorktreeBlock` на рядок 105 (після `runLintCli`)**

У файлі `npm/bin/n-cursor.js` знайди блок імпортів (після `import { runLintCli }`) і додай:

```js
import { injectWorktreeBlock } from '../scripts/utils/inject-worktree-block.mjs'
```

- [ ] **Крок 6.2: Оновити `syncSkills` — рядок 767**

Знайди в `syncSkills`:
```js
          if (file === 'auto.md') continue
          const content = await readFile(join(srcDir, file), 'utf8')
          await writeFile(join(destDir, file), content, 'utf8')
```

Заміни на:
```js
          if (file === 'meta.json') continue
          let content = await readFile(join(srcDir, file), 'utf8')
          if (file === 'SKILL.md') {
            const metaPath = join(srcDir, 'meta.json')
            let worktree = false
            if (existsSync(metaPath)) {
              const meta = JSON.parse(await readFile(metaPath, 'utf8'))
              worktree = meta.worktree === true
            }
            content = injectWorktreeBlock(content, worktree)
          }
          await writeFile(join(destDir, file), content, 'utf8')
```

- [ ] **Крок 6.3: Оновити коментар у JSDoc (рядок ~61-63)**

Знайди в коментарі JSDoc файлу:
```
 * Файл `auto.md` у скілі — джерело правди для auto-skills у CLI (`scripts/auto-skills.mjs`)
 * і у проєкт не копіюється; раніше синхронізовані `auto.md` у `.cursor/skills/n-<id>/` CLI
 * не чіпає — їх потрібно прибрати вручну.
```

Заміни на:
```
 * Файл `meta.json` у скілі — джерело правди для auto-skills у CLI (`scripts/auto-skills.mjs`)
 * і у проєкт не копіюється. Якщо `worktree: true` — у скопійований `SKILL.md` вставляється
 * markdown-блок між маркерами `<!-- n-cursor:worktree:start/end -->`.
```

- [ ] **Крок 6.4: Перевірити що `n-cursor.js` синтаксично правильний**

```bash
node --input-type=module < npm/bin/n-cursor.js 2>&1 | head -5
```
Якщо немає виводу — OK (команда завершиться нормально з exit 1 бо немає аргументів, але синтаксична помилка покаже SyntaxError).

Альтернатива:
```bash
node -e "import('./npm/bin/n-cursor.js').catch(e => { if(e.code==='ERR_MODULE_NOT_FOUND'||e.message?.includes('argv')) {}; else console.error(e.message) })"
```

- [ ] **Крок 6.5: Запустити skills-cli тест**

```bash
cd npm && npx vitest run scripts/tests/skills-cli.test.mjs
```
Очікується: passed.

- [ ] **Крок 6.6: Commit**

```bash
git add npm/bin/n-cursor.js
git commit -m "feat(skill-meta): syncSkills — пропускає meta.json, вшиває worktree-блок у SKILL.md"
```

---

## Task 7: Новий check-concern `skill_meta.mjs` + тести

**Files:**
- Create: `npm/rules/npm-module/js/skill_meta.mjs`
- Create: `npm/rules/npm-module/js/tests/skill_meta.test.mjs`

- [ ] **Крок 7.1: Написати тести (red)**

```js
// npm/rules/npm-module/js/tests/skill_meta.test.mjs
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { check } from '../skill_meta.mjs'
import { withTmpDir, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

async function mkSkillDir(base, id) {
  const dir = join(base, 'npm', 'skills', id)
  await mkdir(dir, { recursive: true })
  return dir
}

describe('check (skill_meta)', () => {
  test('немає npm/skills/ → pass (exit 0)', async () => {
    await withTmpDir(async dir => {
      expect(await check(dir)).toBe(0)
    })
  })

  test('валідний meta.json → exit 0', async () => {
    await withTmpDir(async dir => {
      const skillDir = await mkSkillDir(dir, 'fix')
      await writeJson(join(skillDir, 'meta.json'), { auto: 'завжди', worktree: true })
      expect(await check(dir)).toBe(0)
    })
  })

  test('невалідний meta.json (відсутній worktree) → exit 1', async () => {
    await withTmpDir(async dir => {
      const skillDir = await mkSkillDir(dir, 'fix')
      await writeJson(join(skillDir, 'meta.json'), { auto: 'завжди' })
      expect(await check(dir)).toBe(1)
    })
  })

  test('невалідний meta.json (порожній масив auto) → exit 1', async () => {
    await withTmpDir(async dir => {
      const skillDir = await mkSkillDir(dir, 'fix')
      await writeJson(join(skillDir, 'meta.json'), { auto: [], worktree: false })
      expect(await check(dir)).toBe(1)
    })
  })

  test('тільки auto.md (deprecated) → exit 0 з stderr WARN', async () => {
    await withTmpDir(async dir => {
      const skillDir = await mkSkillDir(dir, 'lint')
      await writeFile(join(skillDir, 'auto.md'), 'завжди\n')
      expect(await check(dir)).toBe(0)
    })
  })

  test('обидва meta.json і auto.md → exit 0 з stderr WARN', async () => {
    await withTmpDir(async dir => {
      const skillDir = await mkSkillDir(dir, 'lint')
      await writeJson(join(skillDir, 'meta.json'), { auto: 'завжди', worktree: false })
      await writeFile(join(skillDir, 'auto.md'), 'завжди\n')
      expect(await check(dir)).toBe(0)
    })
  })

  test('масив у auto з 1+ елементами → exit 0', async () => {
    await withTmpDir(async dir => {
      const skillDir = await mkSkillDir(dir, 'taze')
      await writeJson(join(skillDir, 'meta.json'), { auto: ['bun'], worktree: true })
      expect(await check(dir)).toBe(0)
    })
  })

  test('невідоме поле у meta.json → exit 1', async () => {
    await withTmpDir(async dir => {
      const skillDir = await mkSkillDir(dir, 'fix')
      await writeJson(join(skillDir, 'meta.json'), { auto: 'завжди', worktree: true, extra: 'forbidden' })
      expect(await check(dir)).toBe(1)
    })
  })
})
```

- [ ] **Крок 7.2: Запустити тести, переконатися що падають**

```bash
cd npm && npx vitest run rules/npm-module/js/tests/skill_meta.test.mjs
```
Очікується: FAIL (файл skill_meta.mjs не існує).

- [ ] **Крок 7.3: Написати `skill_meta.mjs`**

```js
// npm/rules/npm-module/js/skill_meta.mjs
/**
 * Перевіряє наявність і валідність `meta.json` у кожному `npm/skills/<id>/`.
 *
 * Правило: кожен скіл у `npm/skills/` повинен мати `meta.json`, що відповідає
 * `schemas/skill-meta.schema.json`. Якщо є тільки `auto.md` — це deprecation warning
 * (не fail): зворотна сумісність для зовнішніх скілів, що ще не мігрували.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'

/**
 * Валідує об'єкт meta.json вручну (мінімальна схема без зовнішніх залежностей).
 * @param {unknown} meta
 * @returns {string[]} список повідомлень про помилки (порожній = валідно)
 */
function validateSkillMeta(meta) {
  const errors = []
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
    return ['meta.json має бути об\'єктом']
  }
  const allowedKeys = new Set(['auto', 'worktree'])
  for (const key of Object.keys(meta)) {
    if (!allowedKeys.has(key)) errors.push(`невідоме поле "${key}"`)
  }
  if (!('auto' in meta)) {
    errors.push('відсутнє обов\'язкове поле "auto"')
  } else {
    const a = meta['auto']
    const validArray = Array.isArray(a) && a.length > 0 && a.every(s => typeof s === 'string' && s.length > 0)
    if (a !== 'завжди' && !validArray) {
      errors.push(`поле "auto": очікується "завжди" або непорожній масив рядків, отримано: ${JSON.stringify(a)}`)
    }
  }
  if (!('worktree' in meta)) {
    errors.push('відсутнє обов\'язкове поле "worktree"')
  } else if (typeof meta['worktree'] !== 'boolean') {
    errors.push(`поле "worktree": очікується boolean, отримано: ${typeof meta['worktree']}`)
  }
  return errors
}

/**
 * @param {string} [cwd] корінь репозиторію
 * @returns {Promise<number>} 0 — OK, 1 — є помилки
 */
export async function check(cwd = process.cwd()) {
  const skillsDir = join(cwd, 'npm', 'skills')
  if (!existsSync(skillsDir)) return 0

  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const id = entry.name
    const skillDir = join(skillsDir, id)
    const metaPath = join(skillDir, 'meta.json')
    const autoMdPath = join(skillDir, 'auto.md')

    const hasMeta = existsSync(metaPath)
    const hasAutoMd = existsSync(autoMdPath)

    if (!hasMeta && !hasAutoMd) {
      pass(`skills/${id}: немає auto-файлу — opt-in лише через конфіг`)
      continue
    }

    if (!hasMeta && hasAutoMd) {
      process.stderr.write(`WARN: skills/${id}: auto.md застарілий — мігруй на meta.json\n`)
      pass(`skills/${id}: auto.md (deprecated, ok для зворотної сумісності)`)
      continue
    }

    if (hasAutoMd) {
      process.stderr.write(`WARN: skills/${id}: обидва meta.json і auto.md — видали auto.md\n`)
    }

    let meta
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf8'))
    } catch (e) {
      fail(`skills/${id}/meta.json: невалідний JSON — ${e.message}`)
      continue
    }

    const errors = validateSkillMeta(meta)
    if (errors.length > 0) {
      for (const err of errors) {
        fail(`skills/${id}/meta.json: ${err}`)
      }
    } else {
      pass(`skills/${id}/meta.json: валідний (auto=${JSON.stringify(meta.auto)}, worktree=${meta.worktree})`)
    }
  }

  return reporter.getExitCode()
}
```

- [ ] **Крок 7.4: Запустити тести, переконатися що проходять**

```bash
cd npm && npx vitest run rules/npm-module/js/tests/skill_meta.test.mjs
```
Очікується: 8 passed.

- [ ] **Крок 7.5: Commit**

```bash
git add npm/rules/npm-module/js/skill_meta.mjs npm/rules/npm-module/js/tests/skill_meta.test.mjs
git commit -m "feat(skill-meta): skill_meta.mjs — check-concern для npm-module (валідація meta.json)"
```

---

## Task 8: Оновити integration-repo-checks і перевірити все

**Files:**
- Modify: `npm/tests/integration-repo-checks.test.mjs`

- [ ] **Крок 8.1: Додати import і виклик `checkSkillMeta`**

У `npm/tests/integration-repo-checks.test.mjs` знайди:
```js
import { check as checkNpmModule } from '../rules/npm-module/js/package_structure.mjs'
```

Додай після нього:
```js
import { check as checkSkillMeta } from '../rules/npm-module/js/skill_meta.mjs'
```

У тілі тесту після `expect(await checkNpmModule(REPO_ROOT)).toBe(0)` додай:
```js
      expect(await checkSkillMeta(REPO_ROOT)).toBe(0)
```

- [ ] **Крок 8.2: Запустити integration test**

```bash
cd npm && npx vitest run tests/integration-repo-checks.test.mjs
```
Очікується: 1 passed (тест проходить, бо всі `meta.json` валідні і `auto.md` видалені).

- [ ] **Крок 8.3: Запустити повний тест-сюїт**

```bash
cd npm && npx vitest run 2>&1 | tail -10
```
Очікується: усі тести крім pre-існуючих падінь (readStdin у `post-tool-use-fix.test.mjs` — flaky stdin-тест, не пов'язаний з нашими змінами).

- [ ] **Крок 8.4: Commit**

```bash
git add npm/tests/integration-repo-checks.test.mjs
git commit -m "test: integration-repo-checks — додати checkSkillMeta"
```

---

## Task 9: Changeset і фінальна верифікація

- [ ] **Крок 9.1: Створити changeset**

```bash
cd npm && npx @nitra/cursor change --bump minor --section Added \
  --message "skill meta.json: замінити auto.md на meta.json у npm/skills/<id>/ — поля auto + worktree; syncSkills вшиває worktree-блок у SKILL.md; новий check-concern skill_meta.mjs у правилі npm-module"
```

- [ ] **Крок 9.2: Перевірити changelog check**

```bash
cd npm && npx @nitra/cursor fix changelog 2>&1 | tail -5
```
Очікується: exit 0.

- [ ] **Крок 9.3: Фінальний запуск цільових тестів**

```bash
cd npm && npx vitest run \
  scripts/utils/tests/read-skill-meta.test.mjs \
  scripts/utils/tests/inject-worktree-block.test.mjs \
  scripts/tests/auto-skills.test.mjs \
  rules/npm-module/js/tests/skill_meta.test.mjs \
  tests/integration-repo-checks.test.mjs \
  2>&1 | tail -8
```
Очікується: усі passed, 0 failed.

- [ ] **Крок 9.4: Commit changeset**

```bash
git add npm/.changes/
git commit -m "chore: changeset для skill meta.json + worktree"
```

---

## Self-Review

Перевірив план проти spec:

**Spec coverage:**
- ✅ `meta.json` замість `auto.md` (Tasks 1, 4)
- ✅ `syncSkills` пропускає `meta.json` і вшиває worktree-блок (Task 6)
- ✅ `auto-skills.mjs` → `readSkillMeta` (Task 3)
- ✅ JSON Schema (Task 5)
- ✅ Валідація `check`-concern + backward-compat warnings (Task 7)
- ✅ Integration test (Task 8)

**Placeholder scan:** без TBD/TODO.

**Type consistency:** `SkillAutoSpec` — однакова назва типу в `read-skill-meta.mjs` і `auto-skills.mjs`. Функція `injectWorktreeBlock` — одна назва в утиліті й у `n-cursor.js`.

**Scope:** фокус — тільки skill meta.json і worktree-інтеграція в syncSkills.
