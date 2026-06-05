# Skill `meta.json` + `worktree` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Замінити `npm/skills/<id>/auto.md` на структурований `meta.json` (поля `auto` + `worktree`), вшивати worktree-інструкцію в синкнутий `SKILL.md`, і валідувати все через `check`.

**Architecture:** Спільний хелпер `skill-meta.mjs` парсить `meta.json`; `auto-skills.mjs` читає через нього умову автоактивації; `n-cursor.js syncSkills` пропускає `meta.json` при копіюванні і через `worktree-notice.mjs` вшиває markdown-блок у `SKILL.md`; новий JS-концерн `npm-module/js/skill_meta.mjs` валідує наявність/форму `meta.json` і відсутність `auto.md`.

**Tech Stack:** Node ESM (`.mjs`), vitest, oxc-parser (вже є), JSON Schema (draft-07). Rego-first не застосовний (per-file FS-перевірка → JS-концерн).

**Канон проєкту (обовʼязково):**

- Кожен новий `.mjs` починається з багаторядкового верхнього JSDoc українською (що робить файл) — `scripts.mdc`.
- Тести співрозташовані з джерелом: `scripts/lib/<f>.mjs` ↔ `scripts/lib/tests/<f>.test.mjs`.
- Команда тестів: `cd npm && npx vitest run <шлях>`.
- **Коміти часті** — після кожної задачі (це тримає `checkDirtyNpmRequiresVersionBump` зеленим: після коміту `git diff HEAD` порожній).
- **Версію/CHANGELOG руками НЕ чіпати** — лише change-файл наприкінці (n-changelog); bump робить CI.
- Літерал автоактивації — **`завжди`** (українською), збігається з `ALWAYS_LITERAL` у `auto-skills.mjs`.

**Поточний стан (зафіксовано перед стартом):**

- `npm/scripts/auto-skills.mjs` — `parseSkillAutoSpec(text)` парсить markdown-рядок `auto.md`; `discoverSkillAutoActivation(skillsDir=SKILLS_DIR)` сканує `<id>/auto.md`; module-load кеш `SKILL_AUTO_ACTIVATION`; експортує `detectAutoSkills`, `AUTO_SKILL_ORDER`, `AUTO_SKILL_RULE_DEPENDENCIES`.
- `npm/bin/n-cursor.js:767` — `if (file === 'auto.md') continue` у `syncSkills` (рядки ~744-786).
- 9 скілів мають `auto.md`: `завжди` (fix, lint, llm-patch, publish-telegram, start-check), `[adr]` (adr-normalize), `[bun]` (taze), `[js-lint]` (coverage-fix, fix-tests).
- JS-концерн правила викликається як `mod.check()` без аргументів (`run-rule.mjs:120`) → `check(cwd=process.cwd())`.
- `createCheckReporter()` → `{ pass, fail, getExitCode }`.
- test-helpers (`npm/scripts/utils/test-helpers.mjs`): `withTmpDir(fn)`, `writeJson(path,data)`, `ensureDir(path)`.
- npm-module правило застосовується лише коли в репо є каталог `npm/` (auto-rule `npmDirExists`) — тож концерн валідації скілів коректно гейтиться там.

---

## Task 1: Хелпер `skill-meta.mjs` (парсинг `meta.json`)

**Files:**

- Create: `npm/scripts/lib/skill-meta.mjs`
- Test: `npm/scripts/lib/tests/skill-meta.test.mjs`

- [ ] **Step 1: Написати падаючі тести**

Файл `npm/scripts/lib/tests/skill-meta.test.mjs`:

```js
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { SKILL_ALWAYS, parseSkillAutoSpec, readSkillMetaRaw } from '../skill-meta.mjs'
import { withTmpDir, writeJson } from '../../utils/test-helpers.mjs'

describe('parseSkillAutoSpec', () => {
  test('"завжди" → { always: true }', () => {
    expect(parseSkillAutoSpec(SKILL_ALWAYS)).toEqual({ always: true })
  })

  test('масив правил → { rules }', () => {
    expect(parseSkillAutoSpec(['adr'])).toEqual({ rules: ['adr'] })
    expect(parseSkillAutoSpec(['vue', 'image-compress'])).toEqual({ rules: ['vue', 'image-compress'] })
  })

  test('trim і відсів порожніх у масиві', () => {
    expect(parseSkillAutoSpec([' bun ', ''])).toEqual({ rules: ['bun'] })
  })

  test('порожній масив → null', () => {
    expect(parseSkillAutoSpec([])).toBeNull()
  })

  test('undefined / невідоме значення → null', () => {
    expect(parseSkillAutoSpec(undefined)).toBeNull()
    expect(parseSkillAutoSpec('always')).toBeNull()
    expect(parseSkillAutoSpec(42)).toBeNull()
  })
})

describe('readSkillMetaRaw', () => {
  test('валідний meta.json → обʼєкт', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'meta.json'), { auto: 'завжди', worktree: true })
      expect(readSkillMetaRaw(dir)).toEqual({ auto: 'завжди', worktree: true })
    })
  })

  test('відсутній meta.json → null', async () => {
    await withTmpDir(async dir => {
      expect(readSkillMetaRaw(dir)).toBeNull()
    })
  })

  test('невалідний JSON → null (не кидає)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'meta.json'), 'NOT JSON{{{', 'utf8')
      expect(readSkillMetaRaw(dir)).toBeNull()
    })
  })

  test('масив на верхньому рівні → null', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'meta.json'), '[1,2]', 'utf8')
      expect(readSkillMetaRaw(dir)).toBeNull()
    })
  })
})
```

- [ ] **Step 2: Запустити — переконатися, що падає**

Run: `cd npm && npx vitest run scripts/lib/tests/skill-meta.test.mjs`
Expected: FAIL — `Cannot find module '../skill-meta.mjs'`.

- [ ] **Step 3: Реалізувати `skill-meta.mjs`**

Файл `npm/scripts/lib/skill-meta.mjs`:

```js
/**
 * Спільний парсер метаданих скіла з `npm/skills/<id>/meta.json`.
 *
 * `meta.json` — єдине джерело правди для скіла замість колишнього `auto.md`:
 *  - `auto` — умова автоактивації (`"завжди"` | масив id правил), опційне;
 *  - `worktree` — boolean: чи виконувати скіл в окремому git-worktree (один інстанс).
 *
 * Цим хелпером користуються `auto-skills.mjs` (автоактивація), `n-cursor.js`
 * (sync + вшивання worktree-блоку) і check-концерн `npm-module/js/skill_meta.mjs`,
 * щоб не дублювати парсинг і форму валідації.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Літерал безумовної автоактивації (українською, як у `auto-skills.mjs`). */
export const SKILL_ALWAYS = 'завжди'

/**
 * @typedef {{ always: true } | { rules: string[] }} SkillAutoSpec
 */

/**
 * Перетворює значення поля `auto` з `meta.json` у `SkillAutoSpec`.
 * @param {unknown} value значення `meta.json.auto`
 * @returns {SkillAutoSpec | null} `null` — формат не розпізнано (= opt-in)
 */
export function parseSkillAutoSpec(value) {
  if (value === SKILL_ALWAYS) {
    return { always: true }
  }
  if (Array.isArray(value)) {
    const rules = value.map(s => String(s).trim()).filter(s => s.length > 0)
    if (rules.length === 0) return null
    return { rules }
  }
  return null
}

/**
 * Читає й парсить `meta.json` одного скіла.
 * @param {string} skillDir абсолютний шлях до каталогу скіла
 * @returns {Record<string, unknown> | null} розпарсений обʼєкт або `null` (немає файлу / невалідний JSON / не-обʼєкт)
 */
export function readSkillMetaRaw(skillDir) {
  const metaPath = join(skillDir, 'meta.json')
  if (!existsSync(metaPath)) return null
  try {
    const parsed = JSON.parse(readFileSync(metaPath, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return /** @type {Record<string, unknown>} */ (parsed)
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Запустити — переконатися, що проходить**

Run: `cd npm && npx vitest run scripts/lib/tests/skill-meta.test.mjs`
Expected: PASS (всі кейси).

- [ ] **Step 5: Коміт**

```bash
git add npm/scripts/lib/skill-meta.mjs npm/scripts/lib/tests/skill-meta.test.mjs
git commit -m "feat(skill-meta): хелпер парсингу skills/<id>/meta.json

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Хелпер `worktree-notice.mjs` (D2-блок у `SKILL.md`)

**Files:**

- Create: `npm/scripts/lib/worktree-notice.mjs`
- Test: `npm/scripts/lib/tests/worktree-notice.test.mjs`

- [ ] **Step 1: Написати падаючі тести**

Файл `npm/scripts/lib/tests/worktree-notice.test.mjs`:

```js
import { describe, expect, test } from 'vitest'

import { WORKTREE_END, WORKTREE_START, injectWorktreeNotice } from '../worktree-notice.mjs'

const SKILL = `---
name: fix
description: щось
---

# n-fix

тіло
`

describe('injectWorktreeNotice', () => {
  test('worktree=true → вставляє блок після frontmatter, перед H1', () => {
    const out = injectWorktreeNotice(SKILL, true)
    expect(out).toContain(WORKTREE_START)
    expect(out).toContain(WORKTREE_END)
    expect(out.indexOf(WORKTREE_START)).toBeLessThan(out.indexOf('# n-fix'))
    expect(out.startsWith('---\nname: fix')).toBe(true)
  })

  test('ідемпотентність: повторний виклик не дублює блок', () => {
    const once = injectWorktreeNotice(SKILL, true)
    const twice = injectWorktreeNotice(once, true)
    expect(twice).toBe(once)
    expect(twice.split(WORKTREE_START)).toHaveLength(2)
  })

  test('worktree=false → блоку немає, контент незмінний', () => {
    const out = injectWorktreeNotice(SKILL, false)
    expect(out).not.toContain(WORKTREE_START)
    expect(out).toBe(SKILL)
  })

  test('worktree=false прибирає наявний блок', () => {
    const withBlock = injectWorktreeNotice(SKILL, true)
    const stripped = injectWorktreeNotice(withBlock, false)
    expect(stripped).not.toContain(WORKTREE_START)
    expect(stripped).toContain('# n-fix')
    expect(stripped).toContain('name: fix')
  })

  test('зміна тексту всередині маркерів не ламає ре-синк', () => {
    const withBlock = injectWorktreeNotice(SKILL, true)
    const tampered = withBlock.replace(
      /<!-- n-cursor:worktree:start -->[\s\S]*?<!-- n-cursor:worktree:end -->/u,
      `${WORKTREE_START}\n> змінений текст\n${WORKTREE_END}`
    )
    const resynced = injectWorktreeNotice(tampered, true)
    expect(resynced.split(WORKTREE_START)).toHaveLength(2)
    expect(resynced).toContain('один інстанс за раз')
  })
})
```

- [ ] **Step 2: Запустити — переконатися, що падає**

Run: `cd npm && npx vitest run scripts/lib/tests/worktree-notice.test.mjs`
Expected: FAIL — `Cannot find module '../worktree-notice.mjs'`.

- [ ] **Step 3: Реалізувати `worktree-notice.mjs`**

Файл `npm/scripts/lib/worktree-notice.mjs`:

```js
/**
 * Вшивання worktree-інструкції у синкнутий `SKILL.md` (рішення D2 зі spec).
 *
 * Коли `meta.json.worktree === true`, скіл має виконуватись в окремому git-worktree
 * і не паралелитись. Підказка адресована агенту, який читає `SKILL.md`, тож
 * вставляється в текст між стабільними маркерами — ре-синк ідемпотентний:
 * наявний блок замінюється, при `worktree:false` — видаляється.
 */

/** Маркер початку worktree-блоку (стабільний, не залежить від тексту всередині). */
export const WORKTREE_START = '<!-- n-cursor:worktree:start -->'
/** Маркер кінця worktree-блоку. */
export const WORKTREE_END = '<!-- n-cursor:worktree:end -->'

const NOTICE_BODY =
  '> **Worktree:** виконуй цей скіл в окремому git-worktree (`git worktree add`); ' +
  '**не** запускай паралельно — один інстанс за раз.'

/** Наявний блок разом із сусідніми порожніми рядками (для чистого видалення). */
const BLOCK_RE = /\n*<!-- n-cursor:worktree:start -->[\s\S]*?<!-- n-cursor:worktree:end -->\n*/u

/** Закриття YAML-frontmatter на початку файла. */
const FRONTMATTER_RE = /^(---\n[\s\S]*?\n---\n)/u

/**
 * Канонічний блок worktree-інструкції.
 * @returns {string} текст блоку від START до END
 */
function buildBlock() {
  return `${WORKTREE_START}\n${NOTICE_BODY}\n${WORKTREE_END}`
}

/**
 * Вставляє / оновлює / видаляє worktree-блок у вмісті `SKILL.md`.
 * @param {string} content вміст `SKILL.md`
 * @param {boolean} enabled чи має бути блок (значення `meta.json.worktree`)
 * @returns {string} оновлений вміст (ідемпотентно)
 */
export function injectWorktreeNotice(content, enabled) {
  const hadBlock = content.includes(WORKTREE_START)
  const withoutBlock = content.replace(BLOCK_RE, '\n\n')

  if (!enabled) {
    return hadBlock ? withoutBlock : content
  }

  const block = buildBlock()
  const fm = withoutBlock.match(FRONTMATTER_RE)
  if (fm) {
    const head = fm[1]
    const rest = withoutBlock.slice(head.length).replace(/^\n+/u, '')
    return `${head}\n${block}\n\n${rest}`
  }
  return `${block}\n\n${withoutBlock.replace(/^\n+/u, '')}`
}
```

- [ ] **Step 4: Запустити — переконатися, що проходить**

Run: `cd npm && npx vitest run scripts/lib/tests/worktree-notice.test.mjs`
Expected: PASS (всі 5 кейсів).

- [ ] **Step 5: Коміт**

```bash
git add npm/scripts/lib/worktree-notice.mjs npm/scripts/lib/tests/worktree-notice.test.mjs
git commit -m "feat(worktree-notice): ідемпотентний D2-блок для SKILL.md

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Створити 9 `meta.json`, видалити 9 `auto.md`

**Files (create):** `npm/skills/<id>/meta.json` × 9.
**Files (delete):** `npm/skills/<id>/auto.md` × 9.

- [ ] **Step 1: Створити всі `meta.json`** (точний вміст, один рядок + перенос)

`npm/skills/adr-normalize/meta.json`: `{ "auto": ["adr"], "worktree": true }`
`npm/skills/coverage-fix/meta.json`: `{ "auto": ["js-lint"], "worktree": true }`
`npm/skills/fix/meta.json`: `{ "auto": "завжди", "worktree": true }`
`npm/skills/fix-tests/meta.json`: `{ "auto": ["js-lint"], "worktree": true }`
`npm/skills/taze/meta.json`: `{ "auto": ["bun"], "worktree": true }`
`npm/skills/lint/meta.json`: `{ "auto": "завжди", "worktree": false }`
`npm/skills/llm-patch/meta.json`: `{ "auto": "завжди", "worktree": false }`
`npm/skills/publish-telegram/meta.json`: `{ "auto": "завжди", "worktree": false }`
`npm/skills/start-check/meta.json`: `{ "auto": "завжди", "worktree": false }`

- [ ] **Step 2: Видалити всі `auto.md`**

```bash
git rm npm/skills/adr-normalize/auto.md npm/skills/coverage-fix/auto.md \
       npm/skills/fix/auto.md npm/skills/fix-tests/auto.md npm/skills/taze/auto.md \
       npm/skills/lint/auto.md npm/skills/llm-patch/auto.md \
       npm/skills/publish-telegram/auto.md npm/skills/start-check/auto.md
```

- [ ] **Step 3: Перевірити стан**

Run: `ls npm/skills/*/meta.json | wc -l` → Expected: `9`
Run: `ls npm/skills/*/auto.md 2>&1` → Expected: «No such file or directory».
Run: `for f in npm/skills/*/meta.json; do node -e "JSON.parse(require('fs').readFileSync('$f'))" || echo "BAD: $f"; done` → Expected: жодного `BAD`.

- [ ] **Step 4: Коміт**

```bash
git add npm/skills/*/meta.json
git commit -m "feat(skills): meta.json замість auto.md (9 скілів) + worktree-прапорець

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Перевести `auto-skills.mjs` на `meta.json`

**Files:**

- Modify: `npm/scripts/auto-skills.mjs`
- Modify: `npm/scripts/tests/auto-skills.test.mjs`

- [ ] **Step 1: Додати тести `discoverSkillAutoActivation` під `meta.json`**

Додати наприкінці `npm/scripts/tests/auto-skills.test.mjs` (імпорти — до наявних зверху):

```js
import { join } from 'node:path'

import { discoverSkillAutoActivation } from '../auto-skills.mjs'
import { ensureDir, withTmpDir, writeJson } from '../utils/test-helpers.mjs'

describe('discoverSkillAutoActivation (meta.json)', () => {
  test('читає auto: завжди / масив / пропуск', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'fix'))
      await writeJson(join(dir, 'fix', 'meta.json'), { auto: 'завжди', worktree: true })
      await ensureDir(join(dir, 'taze'))
      await writeJson(join(dir, 'taze', 'meta.json'), { auto: ['bun'], worktree: true })
      await ensureDir(join(dir, 'opt-in'))
      await writeJson(join(dir, 'opt-in', 'meta.json'), { worktree: false })

      const map = discoverSkillAutoActivation(dir)
      expect(map.fix).toEqual({ always: true })
      expect(map.taze).toEqual({ rules: ['bun'] })
      expect(map['opt-in']).toBeUndefined()
    })
  })

  test('скіл без meta.json не потрапляє в автоактивацію', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'bare'))
      expect(discoverSkillAutoActivation(dir).bare).toBeUndefined()
    })
  })
})
```

> Якщо `describe`/`test`/`expect` уже імпортовані у файлі — не дублювати імпорт, лише додати `discoverSkillAutoActivation` та `ensureDir, withTmpDir, writeJson`.

- [ ] **Step 2: Запустити — переконатися, що падає**

Run: `cd npm && npx vitest run scripts/tests/auto-skills.test.mjs`
Expected: FAIL — новий блок (старий код читає `auto.md`).

- [ ] **Step 3: Переписати парсинг у `auto-skills.mjs`**

1. Замінити імпорт `node:fs` на лише потрібне і додати імпорт хелпера. Було:

```js
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
```

стало:

```js
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseSkillAutoSpec, readSkillMetaRaw } from './lib/skill-meta.mjs'
```

2. Видалити локальні `const ALWAYS_LITERAL = 'завжди'`, `const BRACKET_LIST_RE = …` і всю функцію `parseSkillAutoSpec` (тепер у `skill-meta.mjs`). `@typedef SkillAutoSpec` лишити (його використовують експортовані view).

3. Замінити `discoverSkillAutoActivation` на:

```js
/**
 * Сканує `npm/skills/<id>/meta.json`. Скіли без `meta.json` або без розпізнаного
 * `auto` не потрапляють у результат — їх вмикають лише вручну в конфізі.
 * @param {string} [skillsDir] override для тестів
 * @returns {Record<string, SkillAutoSpec>} мапа `skillId → spec`
 */
export function discoverSkillAutoActivation(skillsDir = SKILLS_DIR) {
  if (!existsSync(skillsDir)) return {}
  /** @type {Record<string, SkillAutoSpec>} */
  const out = {}
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const raw = readSkillMetaRaw(join(skillsDir, entry.name))
    if (!raw) continue
    const spec = parseSkillAutoSpec(raw.auto)
    if (spec) out[entry.name] = spec
  }
  return out
}
```

4. Оновити верхній JSDoc модуля: згадки `auto.md` → `meta.json`.

- [ ] **Step 4: Запустити — переконатися, що проходить**

Run: `cd npm && npx vitest run scripts/tests/auto-skills.test.mjs`
Expected: PASS (старі кейси `detectAutoSkills` + нові).

- [ ] **Step 5: Регресія на реальному пакеті**

Run: `cd npm && node -e "import('./scripts/auto-skills.mjs').then(m=>console.log(JSON.stringify(m.detectAutoSkills({availableSkills:['fix','lint','llm-patch','publish-telegram','taze','adr-normalize','coverage-fix','fix-tests','start-check'],detectedRules:['adr','bun','js-lint']}).skills)))"`
Expected: містить `adr-normalize, coverage-fix, fix, fix-tests, lint, llm-patch, publish-telegram, taze`; **НЕ** містить `start-check` (opt-in).

- [ ] **Step 6: Коміт**

```bash
git add npm/scripts/auto-skills.mjs npm/scripts/tests/auto-skills.test.mjs
git commit -m "refactor(auto-skills): читати meta.json замість auto.md

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `syncSkills` — пропускати `meta.json`, вшивати worktree-блок

**Files:**

- Modify: `npm/bin/n-cursor.js` (функція `syncSkills`, рядки ~744-786; імпорти ~зверху)

- [ ] **Step 1: Додати імпорти у `n-cursor.js`**

Поряд з іншими `import { … } from '../scripts/...'`:

```js
import { readSkillMetaRaw } from '../scripts/lib/skill-meta.mjs'
import { injectWorktreeNotice } from '../scripts/lib/worktree-notice.mjs'
```

- [ ] **Step 2: Змінити цикл копіювання**

Замінити (рядки ~764-770):

```js
await mkdir(destDir, { recursive: true })
const files = await readdir(srcDir)
for (const file of files) {
  if (file === 'auto.md') continue
  const content = await readFile(join(srcDir, file), 'utf8')
  await writeFile(join(destDir, file), content, 'utf8')
}
```

на:

```js
await mkdir(destDir, { recursive: true })
const meta = readSkillMetaRaw(srcDir)
const worktree = meta?.worktree === true
const files = await readdir(srcDir)
for (const file of files) {
  if (file === 'meta.json') continue
  let content = await readFile(join(srcDir, file), 'utf8')
  if (file === 'SKILL.md') {
    content = injectWorktreeNotice(content, worktree)
  }
  await writeFile(join(destDir, file), content, 'utf8')
}
```

> `auto.md` більше не пропускаємо явно — джерела вже без нього (Task 3); якщо колись зʼявиться, він просто скопіюється, що нешкідливо. Лишати мертву умову `=== 'auto.md'` не варто (knip/oxlint).

- [ ] **Step 3: Перевірити синк руками на тимчасовому проєкті**

```bash
cd /tmp && rm -rf nctest && mkdir nctest && cd nctest && git init -q
printf '{"$schema":"https://unpkg.com/@nitra/cursor/schemas/n-cursor.json","rules":["bun"],"skills":["fix","lint"]}' > .n-cursor.json
node /Users/vitaliytv/www/nitra/cursor/npm/bin/n-cursor.js >/tmp/nc.log 2>&1 || true
echo "fix(true) має блок:"  && grep -c 'n-cursor:worktree:start' .cursor/skills/n-fix/SKILL.md
echo "lint(false) без блоку:" && grep -c 'n-cursor:worktree:start' .cursor/skills/n-lint/SKILL.md
echo "meta.json НЕ скопійовано:" && ls .cursor/skills/n-fix/meta.json 2>&1
cd /Users/vitaliytv/www/nitra/cursor
```

Expected: `fix` → `1`; `lint` → `0`; `meta.json` → «No such file or directory».

- [ ] **Step 4: Коміт**

```bash
git add npm/bin/n-cursor.js
git commit -m "feat(sync): пропускати meta.json, вшивати worktree-блок у SKILL.md

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: JSON-схема `skill-meta.json` + реєстрація у v8r-каталозі

**Files:**

- Create: `npm/schemas/skill-meta.json`
- Modify: `npm/schemas/v8r-catalog.json` (зіставлення `skills/*/meta.json` → схема)

- [ ] **Step 1: Створити схему**

Файл `npm/schemas/skill-meta.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://unpkg.com/@nitra/cursor/schemas/skill-meta.json",
  "title": "n-cursor skill meta",
  "description": "Метадані скіла @nitra/cursor: умова автоактивації (auto) і чи виконувати в окремому git-worktree (worktree). Файл npm/skills/<id>/meta.json.",
  "type": "object",
  "additionalProperties": false,
  "required": ["worktree"],
  "properties": {
    "auto": {
      "description": "Умова автоактивації: \"завжди\" або непорожній масив id правил, від яких залежить скіл.",
      "oneOf": [
        { "const": "завжди" },
        { "type": "array", "items": { "type": "string", "minLength": 1 }, "minItems": 1 }
      ]
    },
    "worktree": {
      "type": "boolean",
      "description": "true — виконувати скіл в окремому git-worktree, один інстанс за раз (без паралельного запуску); false — у worktree не виконується."
    }
  }
}
```

- [ ] **Step 2: Зареєструвати у v8r-каталозі**

Прочитати `npm/schemas/v8r-catalog.json`, знайти масив записів `{ "name", "fileMatch", "url"|"location" }` (формат SchemaStore-подібний — звірити з наявними записами) і додати запис за тим самим форматом, що вже використовується у файлі:

```json
{
  "name": "n-cursor skill meta",
  "fileMatch": ["npm/skills/*/meta.json"],
  "location": "./schemas/skill-meta.json"
}
```

> Ключі (`location` vs `url`) і відносний шлях — **точно як у сусідніх записах** цього файла; не вгадувати, взяти з існуючого зразка.

- [ ] **Step 3: Перевірити, що схема валідна JSON і ловить помилку**

Run: `cd npm && node -e "const A=require('ajv'); const a=new (A.default||A)({allErrors:true}); const v=a.compile(require('./schemas/skill-meta.json')); console.log('ok valid:', v({auto:'завжди',worktree:true})); console.log('bad worktree string:', v({auto:'завжди',worktree:'yes'})); console.log('bad always en:', v({auto:'always',worktree:true})); console.log('missing worktree:', v({auto:'завжди'}))"`
Expected: `ok valid: true`, `bad worktree string: false`, `bad always en: false`, `missing worktree: false`.

- [ ] **Step 4: Коміт**

```bash
git add npm/schemas/skill-meta.json npm/schemas/v8r-catalog.json
git commit -m "feat(schemas): skill-meta.json + реєстрація у v8r-каталозі

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Check-концерн `skill_meta.mjs` (валідація скілів пакета)

**Files:**

- Create: `npm/rules/npm-module/js/skill_meta.mjs`
- Test: `npm/rules/npm-module/js/tests/skill_meta.test.mjs`

Концерн живе під правилом `npm-module` (воно вже гейтиться наявністю `npm/`, а `npm/skills/` є лише в репо пакета). Сканує `<cwd>/npm/skills/<id>/`: вимагає валідний `meta.json`, забороняє залишковий `auto.md`.

- [ ] **Step 1: Написати падаючі тести**

Файл `npm/rules/npm-module/js/tests/skill_meta.test.mjs`:

```js
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { check } from '../skill_meta.mjs'
import { ensureDir, withTmpDir, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

describe('skill_meta check', () => {
  test('усі скіли з валідним meta.json → 0', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm', 'skills', 'fix'))
      await writeJson(join(dir, 'npm', 'skills', 'fix', 'meta.json'), { auto: 'завжди', worktree: true })
      await ensureDir(join(dir, 'npm', 'skills', 'lint'))
      await writeJson(join(dir, 'npm', 'skills', 'lint', 'meta.json'), { auto: 'завжди', worktree: false })
      expect(await check(dir)).toBe(0)
    })
  })

  test('відсутній meta.json → 1', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm', 'skills', 'fix'))
      expect(await check(dir)).toBe(1)
    })
  })

  test('залишковий auto.md → 1', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm', 'skills', 'fix'))
      await writeJson(join(dir, 'npm', 'skills', 'fix', 'meta.json'), { auto: 'завжди', worktree: true })
      await writeFile(join(dir, 'npm', 'skills', 'fix', 'auto.md'), 'завжди\n', 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('worktree не boolean → 1', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm', 'skills', 'fix'))
      await writeJson(join(dir, 'npm', 'skills', 'fix', 'meta.json'), { auto: 'завжди', worktree: 'yes' })
      expect(await check(dir)).toBe(1)
    })
  })

  test('auto присутнє, але нерозпізнане → 1', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm', 'skills', 'fix'))
      await writeJson(join(dir, 'npm', 'skills', 'fix', 'meta.json'), { auto: 'always', worktree: true })
      expect(await check(dir)).toBe(1)
    })
  })

  test('немає npm/skills взагалі → 0 (нема чого валідувати)', async () => {
    await withTmpDir(async dir => {
      expect(await check(dir)).toBe(0)
    })
  })
})
```

- [ ] **Step 2: Запустити — переконатися, що падає**

Run: `cd npm && npx vitest run rules/npm-module/js/tests/skill_meta.test.mjs`
Expected: FAIL — `Cannot find module '../skill_meta.mjs'`.

- [ ] **Step 3: Реалізувати концерн**

Файл `npm/rules/npm-module/js/skill_meta.mjs`:

```js
/**
 * Перевірка метаданих скілів пакета `@nitra/cursor` (концерн правила npm-module).
 *
 * Кожен `npm/skills/<id>/` має містити валідний `meta.json`:
 *  - `worktree` присутнє і boolean;
 *  - `auto` (якщо присутнє) — розпізнане (`"завжди"` або непорожній масив рядків);
 *  - залишковий `auto.md` заборонено (міграція на meta.json завершена).
 *
 * Концерн застосовний лише в репо самого пакета (де є `npm/skills/`); у споживача
 * каталогу `npm/skills/` нема, тож перевірка мовчки проходить.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { parseSkillAutoSpec, readSkillMetaRaw } from '../../../scripts/lib/skill-meta.mjs'

/**
 * Валідує всі `npm/skills/<id>/meta.json`.
 * @param {string} [cwd] корінь репозиторію
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export function check(cwd = process.cwd()) {
  const reporter = createCheckReporter()
  const skillsDir = join(cwd, 'npm', 'skills')
  if (!existsSync(skillsDir)) {
    reporter.pass('npm/skills/ відсутній — немає скілів для валідації')
    return Promise.resolve(reporter.getExitCode())
  }

  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const id = entry.name
    const skillDir = join(skillsDir, id)

    if (existsSync(join(skillDir, 'auto.md'))) {
      reporter.fail(`skills/${id}: залишковий auto.md — видали (метадані тепер у meta.json)`)
    }

    const raw = readSkillMetaRaw(skillDir)
    if (!raw) {
      reporter.fail(`skills/${id}: відсутній або невалідний meta.json (очікується {"auto"?, "worktree": bool})`)
      continue
    }
    if (typeof raw.worktree !== 'boolean') {
      reporter.fail(`skills/${id}: meta.json.worktree має бути boolean`)
    }
    if (raw.auto !== undefined && parseSkillAutoSpec(raw.auto) === null) {
      reporter.fail(`skills/${id}: meta.json.auto нерозпізнане — очікується "завжди" або непорожній масив правил`)
    }
    if (reporter.getExitCode() === 0) {
      reporter.pass(`skills/${id}: meta.json валідний`)
    }
  }

  return Promise.resolve(reporter.getExitCode())
}
```

- [ ] **Step 4: Запустити — переконатися, що проходить**

Run: `cd npm && npx vitest run rules/npm-module/js/tests/skill_meta.test.mjs`
Expected: PASS (всі 6 кейсів).

- [ ] **Step 5: Прогнати правило на реальному репо**

Run: `npx @nitra/cursor fix npm-module 2>&1 | grep -i skill`
Expected: рядки `skills/<id>: meta.json валідний` для всіх 9; без `❌`.

> Якщо правило падає на `checkDirtyNpmRequiresVersionBump` (незакомічені зміни без bump) — це очікувано до коміту; після коміту цього кроку `git diff HEAD` порожній і перевірка зелена.

- [ ] **Step 6: Коміт**

```bash
git add npm/rules/npm-module/js/skill_meta.mjs npm/rules/npm-module/js/tests/skill_meta.test.mjs
git commit -m "feat(npm-module): концерн валідації skills/<id>/meta.json

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Документація, change-файл, фінальна верифікація

**Files:**

- Modify: `.cursor/rules/scripts.mdc` (рядки ~14, ~51)
- Modify: `npm/README.md` (рядок ~117)
- Create: `npm/.changes/<timestamp>-<rand>.md` (через CLI)

- [ ] **Step 1: Оновити `scripts.mdc`**

Рядок ~14 (дерево структури правила) лишити як є (це про rules). Рядок ~51 — про структуру скілів — замінити:

було:

```
Скіли мають дзеркальну структуру в `npm/skills/{skill}/`: `SKILL.md` (конвенція Cursor), `auto.md` (опційно).
```

стало:

```
Скіли мають дзеркальну структуру в `npm/skills/{skill}/`: `SKILL.md` (конвенція Cursor) і `meta.json` (метадані скіла). `meta.json` тримає `auto` (умова автоактивації: `"завжди"` або масив id правил; опційне) і `worktree` (boolean: чи виконувати скіл в окремому git-worktree — один інстанс, без паралелі). У проєкт `meta.json` **не** копіюється; під час синку при `worktree:true` у синкнутий `.cursor/skills/n-<id>/SKILL.md` вшивається worktree-блок між маркерами `n-cursor:worktree:start/end` (ідемпотентно). Валідація — концерн `npm-module/js/skill_meta.mjs`.
```

- [ ] **Step 2: Оновити `npm/README.md`**

Знайти рядок ~117 з `├── auto.md ...` у дереві структури скілу і замінити на `meta.json`:

було:

```
├── auto.md               # умова автоактивації скілу (опційно)
```

стало:

```
├── meta.json             # метадані скілу: auto (автоактивація) + worktree
```

> Якщо в README є й інші згадки `auto.md` у контексті скілів — оновити аналогічно. Згадки `rules/*/auto.md` НЕ чіпати (rules — у Spec B).

- [ ] **Step 3: Створити change-файл**

```bash
cd npm && npx @nitra/cursor change --bump minor --section Changed \
  --message "skills: meta.json замість auto.md (+ worktree-прапорець з вшиванням у SKILL.md і забороною паралелі)" \
  && cd ..
```

Expected: `✅ .changes/<…>.md`.

- [ ] **Step 4: Повний прогін тестів пакета**

Run: `cd npm && npx vitest run 2>&1 | tail -12`
Expected: усі нові тести зелені; падати можуть лише наперед відомі flaky (`post-tool-use-fix › readStdin` timeout, `integration-repo-checks › checkNpmModule` — лише якщо є незакомічені зміни під `npm/`). Усе інше — PASS.

- [ ] **Step 5: Програмна перевірка структури**

Run: `npx @nitra/cursor fix npm-module 2>&1 | tail -8`
Expected: `npm-module` без `❌` (після того, як попередні кроки закомічені — дерево чисте).

- [ ] **Step 6: Перевірка changelog-узгодженості**

Run: `npx @nitra/cursor fix changelog 2>&1 | tail -5`
Expected: exit 0.

- [ ] **Step 7: Коміт**

```bash
git add .cursor/rules/scripts.mdc npm/README.md npm/.changes/
git commit -m "docs: scripts.mdc + README на meta.json; change-файл (Spec A)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Конвенція `.worktrees/` та інвентарний файл-опис поруч із worktree

**Мета:** закріпити, де зберігаються worktree (`<project-root>/.worktrees/<branch>/`), де лежить їх опис (`<project-root>/.worktrees/<branch>.md` — **поруч**, не всередині checkout), і як агент дізнається про це з D2-блоку в `SKILL.md`. Ніяких `.git/info/exclude`-хаків — весь `.worktrees/` просто gitignored.

**Files:**

- Modify: `npm/scripts/lib/worktree-notice.mjs` (оновити `NOTICE_BODY` — нова конвенція `.worktrees/<branch>.md`)
- Modify: `npm/scripts/lib/tests/worktree-notice.test.mjs` (оновити перевірку тексту блоку)
- Create: `.cursor/rules/n-worktrees.mdc` (правило-конвенція worktree)
- Modify: `.gitignore` (додати `.worktrees/`)
- Modify: `CLAUDE.md` (додати `@.cursor/rules/n-worktrees.mdc`)
- Modify: `.cursor/rules/scripts.mdc` (оновити секцію — `<branch>.md` поруч, а не `.n-worktree.md` всередині)

> **Примітка для виконавця:** `.gitignore`, `CLAUDE.md` і `n-worktrees.mdc` вже додані до `main` попередньою задачею підготовки worktree. Тут потрібно лише перевірити їх наявність і оновити `worktree-notice.mjs` + `scripts.mdc`.

- [ ] **Step 1: Перевірити, що `.worktrees/` у `.gitignore` і `n-worktrees.mdc` існує**

```bash
grep '\.worktrees/' .gitignore
ls .cursor/rules/n-worktrees.mdc
```

Expected: рядок `.worktrees/` у `.gitignore`; файл `n-worktrees.mdc` існує.

- [ ] **Step 2: Оновити тест під новий текст блоку**

У `npm/scripts/lib/tests/worktree-notice.test.mjs` у кейсі `'worktree=true → вставляє блок після frontmatter, перед H1'` замінити або додати `expect`:

```js
expect(out).toContain('.worktrees/')
expect(out).toContain('<branch>.md')
```

І в кейсі `'зміна тексту всередині маркерів не ламає ре-синк'` замінити `expect(resynced).toContain('один інстанс за раз')` на:

```js
expect(resynced).toContain('.worktrees/')
```

- [ ] **Step 3: Запустити — переконатися, що падає**

Run: `cd npm && npx vitest run scripts/lib/tests/worktree-notice.test.mjs`
Expected: FAIL — `NOTICE_BODY` ще не містить `.worktrees/`.

- [ ] **Step 4: Замінити `NOTICE_BODY` у `worktree-notice.mjs`**

````js
const NOTICE_BODY = [
  '> **Worktree:** виконуй цей скіл в окремому git-worktree; **не** запускай паралельно — один інстанс за раз.',
  '>',
  '> Як створити:',
  '> ```bash',
  '> git worktree add .worktrees/<branch> -b <branch>',
  '> ```',
  '> Одразу після створення поклади файл-опис `.worktrees/<branch>.md` **поруч** із worktree',
  '> (не всередині checkout). Формат: заголовок, задача, дата, база-коміт, 1–2 речення навіщо,',
  '> рядок «Прибрати: `git worktree remove .worktrees/<branch> && rm .worktrees/<branch>.md`».',
  '> Директорія `.worktrees/` у `.gitignore` — файл-опис не потрапляє в git-історію.',
  '> Інвентаризація: `cat .worktrees/*.md`'
].join('\n')
````

> `join('\n')` зберігає одну стрічку — `buildBlock()` і `BLOCK_RE` не змінюються, ідемпотентність збережена.

- [ ] **Step 5: Запустити — переконатися, що проходить**

Run: `cd npm && npx vitest run scripts/lib/tests/worktree-notice.test.mjs`
Expected: PASS.

- [ ] **Step 6: Оновити секцію про worktree у `scripts.mdc`**

У секції про скіли (та сама, що оновлюється в Task 8 Step 1) замінити/додати речення про worktree-опис:

```
Скіл із `worktree:true` під час виконання створює git-worktree у `.worktrees/<branch>/` і відразу кладе поруч файл-опис `.worktrees/<branch>.md` — заголовок, задача, дата, база-коміт, навіщо, як прибрати. Файл поруч (не всередині checkout), тому автоматично gitignored через `.worktrees/` у `.gitignore`. Інвентаризація: `cat .worktrees/*.md`.
```

- [ ] **Step 7: Перевірити повний синк-приклад**

```bash
cd /tmp && rm -rf nctest9 && mkdir nctest9 && cd nctest9 && git init -q
printf '{"$schema":"https://unpkg.com/@nitra/cursor/schemas/n-cursor.json","rules":["bun"],"skills":["fix"]}' > .n-cursor.json
node /Users/vitaliytv/www/nitra/cursor/npm/bin/n-cursor.js >/tmp/nc9.log 2>&1 || true
grep -c '\.worktrees/' .cursor/skills/n-fix/SKILL.md
cd /Users/vitaliytv/www/nitra/cursor
```

Expected: `grep -c` → `1` (нова інструкція потрапила в синкнутий `SKILL.md` для `fix`).

- [ ] **Step 8: Коміт**

```bash
git add npm/scripts/lib/worktree-notice.mjs npm/scripts/lib/tests/worktree-notice.test.mjs \
        .cursor/rules/scripts.mdc .cursor/rules/n-worktrees.mdc .gitignore CLAUDE.md
git commit -m "feat(worktree-notice): конвенція .worktrees/<branch>.md поруч із worktree

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> Change-файл: якщо Task 8 ще не закрив його — один change-файл на всю фічу. Якщо вже закрив — онови через `npx @nitra/cursor change --bump minor --section Changed --message "..."`.

---

## Self-Review (виконано автором плану)

**Spec coverage:**

- meta.json формат (auto/worktree) → Task 1 (парсер) + Task 3 (файли) + Task 6 (схема). ✅
- `worktree:true` ⇒ заборона паралелі → текст блоку D2 (Task 2) + `withLock` уже в `main`. ✅
- A2 (вшивання в SKILL.md) → Task 2 + Task 5. ✅
- D2 ідемпотентні маркери → Task 2. ✅
- auto-skills читає meta.json → Task 4. ✅
- syncSkills пропускає meta.json + вшиває блок → Task 5. ✅
- видалення auto.md → Task 3; заборона залишку → Task 7. ✅
- JSON-схема + check → Task 6 + Task 7. ✅
- міграція 9 скілів з точними значеннями → Task 3 (звірено з реальними auto.md). ✅
- docs (scripts.mdc, README) + change-файл → Task 8. ✅
- конвенція `.worktrees/` + `<branch>.md` поруч (gitignored, не `.git/info/exclude`) → Task 9. ✅
- Out of scope (rules, lint split, рантайм) — не торкаємось. ✅

**Placeholder scan:** немає TBD/«handle edge cases» без коду; усі кроки з кодом мають повний код.

**Type consistency:** `parseSkillAutoSpec`, `readSkillMetaRaw`, `SKILL_ALWAYS`, `injectWorktreeNotice`, `WORKTREE_START/END`, `check(cwd)` — імена однакові в усіх задачах і тестах.

**Відомий ризик:** один пункт потребує звірки з фактом під час виконання — формат записів `v8r-catalog.json` (Task 6 Step 2): взяти ключі (`location`/`url`, `fileMatch`) точно як у сусідніх записах, не вгадувати.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-31-skill-meta-json-worktree.md`.
