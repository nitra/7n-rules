# Rule `meta.json` (data-driven auto-detect) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перенести автодетект правил із захардкодженого `auto-rules.mjs` + мертвих `auto.md` на data-driven `npm/rules/<id>/meta.json` (G1), зберігши поведінку детекту 1:1 (+ увімкнути tauri).

**Architecture:** `meta.json.auto` має 4 форми (`"завжди"` / `["rule"]` / `{glob}` / `{predicate,arg}`). Парсер `rule-meta.mjs` нормалізує їх; реєстр `rule-predicates.mjs` тримає реалізацію 6 незводимих предикатів; `auto-rules.mjs` стає інтерпретатором meta (порядок і залежності — з даних, не хардкод). Валідація — концерн `rule_meta.mjs` (дзеркало `skill_meta.mjs`) + схема.

**Tech Stack:** Node ESM (`.mjs`), vitest, `globToRegex` (вже є в `npm/rules/npm-module/js/package_structure.mjs`).

**Канон проєкту (обовʼязково):**

- Кожен новий `.mjs` — багаторядковий верхній JSDoc українською — `scripts.mdc`.
- Тести: `scripts/lib/<f>.mjs` ↔ `scripts/lib/tests/<f>.test.mjs`. Команда: `cd npm && npx vitest run <шлях>`.
- Коміти часті (після кожної задачі); версію/CHANGELOG руками НЕ чіпати — change-файл наприкінці.
- У тестах НЕ `process.chdir`; `withTmpDir(dir => …)`, `cwd: dir` усім child-процесам.
- Літерал always — `завжди` (укр.).

**Ключові факти поточного стану (зафіксовано):**

- `npm/scripts/auto-rules.mjs` експортує: `AUTO_RULE_ORDER` (28, хардкод), `AUTO_RULE_DEPENDENCIES`, `RULE_MIGRATIONS`, `migrateRuleIds`, `detectLegacyRuleIds`, `normalizeIdList`, `getRepositoryUrl`, `isMonorepoPackage`, `collectAutoRuleFacts`, `detectAutoRules`, `mergeConfigWithAutoDetected`.
- `detectAutoRules({root, availableRules, packageJsonParsed, disableRules})` — публічний контракт, **зберегти незмінним**.
- `globToRegex(glob)` експортується з `npm/rules/npm-module/js/package_structure.mjs:374` — повертає `RegExp` проти posix-шляху; підтримує `**`, `*`, `?`, `{a,b}`? (перевірити в Task 2 Step 1).
- `auto-rules.test.mjs` — 45 тестів, головний регресійний контракт. `ALL_RULES` (26 правил, без tauri/opt-in).
- Предикатна логіка зараз у `auto-rules.mjs`: `ABIE_REPOSITORY_URL_MARKER`/`EFES_...`, `HASURA_CONFIG_MARKER`, `collectDependencyKeysPresentInPackageJsonTree`, `hasNestedPackageJsonWithoutViteDevDependency`, `sourceContentHasBunSqlImport`, `updateGqlFactFromFile`.
- 29 `auto.md`; 4 правила без auto (`ci4`, `feedback`, `release`, `worktree` — останнє має лише `worktree.mdc`).
- `skill_meta.mjs` — точний шаблон для `rule_meta.mjs`.

---

## Task 1: Парсер `rule-meta.mjs`

**Files:**

- Create: `npm/scripts/lib/rule-meta.mjs`
- Test: `npm/scripts/lib/tests/rule-meta.test.mjs`

- [ ] **Step 1: Написати падаючі тести**

Файл `npm/scripts/lib/tests/rule-meta.test.mjs`:

```js
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parseRuleAutoSpec, readRuleMetaRaw } from '../rule-meta.mjs'
import { withTmpDir, writeJson } from '../../utils/test-helpers.mjs'

describe('parseRuleAutoSpec', () => {
  test('"завжди" → { always: true }', () => {
    expect(parseRuleAutoSpec('завжди')).toEqual({ always: true })
  })
  test('масив правил → { rules }', () => {
    expect(parseRuleAutoSpec(['bun'])).toEqual({ rules: ['bun'] })
    expect(parseRuleAutoSpec(['vue', 'image-compress'])).toEqual({ rules: ['vue', 'image-compress'] })
  })
  test('порожній масив → null', () => {
    expect(parseRuleAutoSpec([])).toBeNull()
  })
  test('glob рядок → { glob: [рядок] }', () => {
    expect(parseRuleAutoSpec({ glob: '**/*.vue' })).toEqual({ glob: ['**/*.vue'] })
  })
  test('glob масив → { glob }', () => {
    expect(parseRuleAutoSpec({ glob: ['**/Dockerfile', '**/Dockerfile.*'] })).toEqual({
      glob: ['**/Dockerfile', '**/Dockerfile.*']
    })
  })
  test('predicate без arg → { predicate }', () => {
    expect(parseRuleAutoSpec({ predicate: 'gqlTaggedTemplate' })).toEqual({
      predicate: 'gqlTaggedTemplate',
      arg: undefined
    })
  })
  test('predicate з arg → { predicate, arg }', () => {
    expect(parseRuleAutoSpec({ predicate: 'depInAnyPackageJson', arg: ['mssql'] })).toEqual({
      predicate: 'depInAnyPackageJson',
      arg: ['mssql']
    })
  })
  test('невалідне → null', () => {
    expect(parseRuleAutoSpec(undefined)).toBeNull()
    expect(parseRuleAutoSpec('always')).toBeNull()
    expect(parseRuleAutoSpec({ glob: 42 })).toBeNull()
    expect(parseRuleAutoSpec({ predicate: 42 })).toBeNull()
    expect(parseRuleAutoSpec({})).toBeNull()
  })
})

describe('readRuleMetaRaw', () => {
  test('валідний meta.json → обʼєкт', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'meta.json'), { auto: 'завжди' })
      expect(readRuleMetaRaw(dir)).toEqual({ auto: 'завжди' })
    })
  })
  test('відсутній → null', async () => {
    await withTmpDir(async dir => {
      expect(readRuleMetaRaw(dir)).toBeNull()
    })
  })
  test('невалідний JSON → null', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'meta.json'), '{{{', 'utf8')
      expect(readRuleMetaRaw(dir)).toBeNull()
    })
  })
})
```

- [ ] **Step 2: Запустити — переконатися, що падає**

Run: `cd npm && npx vitest run scripts/lib/tests/rule-meta.test.mjs`
Expected: FAIL — `Cannot find module '../rule-meta.mjs'`.

- [ ] **Step 3: Реалізувати `rule-meta.mjs`**

Файл `npm/scripts/lib/rule-meta.mjs`:

```js
/**
 * Парсер метаданих правила з `npm/rules/<id>/meta.json` (data-driven автодетект).
 *
 * `meta.json.auto` має один із чотирьох видів:
 *  - `"завжди"`                       → always-on;
 *  - `["rule", …]`                    → активується, коли всі правила-залежності виявлені;
 *  - `{ "glob": "<pat>" | [<pat>] }`  → наявність файлів/каталогів за glob (OR);
 *  - `{ "predicate": "<name>", "arg"? }` → незводимий предикат із реєстру `rule-predicates.mjs`.
 *
 * Поля `worktree` правила НЕ мають (це скілова вісь). Дзеркало `skill-meta.mjs`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Літерал безумовної активації (українською, як у скілах). */
export const RULE_ALWAYS = 'завжди'

/**
 * @typedef {{ always: true } | { rules: string[] } | { glob: string[] } | { predicate: string, arg: unknown }} RuleAutoSpec
 */

/**
 * Нормалізує значення `meta.json.auto` у дискриміновану форму.
 * @param {unknown} value значення поля `auto`
 * @returns {RuleAutoSpec | null} `null` — формат не розпізнано (= opt-in)
 */
export function parseRuleAutoSpec(value) {
  if (value === RULE_ALWAYS) return { always: true }

  if (Array.isArray(value)) {
    const rules = value.map(s => String(s).trim()).filter(s => s.length > 0)
    return rules.length > 0 ? { rules } : null
  }

  if (value !== null && typeof value === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (value)
    if ('glob' in obj) {
      const raw = obj.glob
      const globs = (Array.isArray(raw) ? raw : [raw]).filter(g => typeof g === 'string' && g.length > 0)
      return globs.length > 0 ? { glob: /** @type {string[]} */ (globs) } : null
    }
    if ('predicate' in obj) {
      return typeof obj.predicate === 'string' && obj.predicate.length > 0
        ? { predicate: obj.predicate, arg: obj.arg }
        : null
    }
  }
  return null
}

/**
 * Читає й парсить `meta.json` одного правила.
 * @param {string} ruleDir абсолютний шлях до каталогу правила
 * @returns {Record<string, unknown> | null} обʼєкт або `null` (немає файлу / невалідний JSON / не-обʼєкт)
 */
export function readRuleMetaRaw(ruleDir) {
  const metaPath = join(ruleDir, 'meta.json')
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

Run: `cd npm && npx vitest run scripts/lib/tests/rule-meta.test.mjs`
Expected: PASS (всі кейси).

- [ ] **Step 5: Коміт**

```bash
git add npm/scripts/lib/rule-meta.mjs npm/scripts/lib/tests/rule-meta.test.mjs
git commit -m "feat(rule-meta): парсер 4-форм auto для rules/<id>/meta.json

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Реєстр предикатів `rule-predicates.mjs`

**Files:**

- Create: `npm/scripts/lib/rule-predicates.mjs`
- Test: `npm/scripts/lib/tests/rule-predicates.test.mjs`

Переносить наявну предикатну логіку з `auto-rules.mjs` у іменований реєстр. Сигнатура: `predicate(cwd, facts, arg) → Promise<boolean>`. `facts` — результат `collectAutoRuleFacts` (вже містить content-скани).

- [ ] **Step 1: Перевірити, що `globToRegex` доступний і покриває потрібні патерни**

Run: `cd npm && node -e "import('./rules/npm-module/js/package_structure.mjs').then(m=>{const re=g=>m.globToRegex(g); console.log('vue', re('**/*.vue').test('src/a.vue')); console.log('root pkg', re('package.json').test('package.json'), re('package.json').test('npm/package.json')); console.log('brace', re('**/*.{css,vue}').test('a.css')); console.log('dir', re('**/k8s/**').test('k8s/x.yaml'))})"`
Expected: `vue true`, `root pkg true false`, `brace true`, `dir true`. **Якщо `{a,b}` не підтримується** (`brace false`) — у Task 4 розгортати масив globів замість brace-expr (для `js-lint`/`style-lint`/`nginx`/`vue` використати масив розширень). Зафіксуй результат тут.

- [ ] **Step 2: Написати падаючі тести**

Файл `npm/scripts/lib/tests/rule-predicates.test.mjs`:

```js
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { RULE_PREDICATES } from '../rule-predicates.mjs'
import { collectAutoRuleFacts } from '../../auto-rules.mjs'
import { ensureDir, withTmpDir, writeJson } from '../../utils/test-helpers.mjs'

describe('repoUrlMarker', () => {
  test('matches abie repo url', () => {
    expect(
      RULE_PREDICATES.repoUrlMarker(
        { repository: { url: 'https://github.com/abinbevefes/x' } },
        'https://github.com/abinbevefes/'
      )
    ).toBe(true)
  })
  test('no match', () => {
    expect(
      RULE_PREDICATES.repoUrlMarker({ repository: 'https://github.com/other/x' }, 'https://github.com/abinbevefes/')
    ).toBe(false)
  })
})

describe('depInAnyPackageJson', () => {
  test('знаходить пакет у вкладеному package.json', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'root' })
      await ensureDir(join(dir, 'sub'))
      await writeJson(join(dir, 'sub', 'package.json'), { dependencies: { mssql: '^1' } })
      expect(await RULE_PREDICATES.depInAnyPackageJson(dir, ['mssql'])).toBe(true)
      expect(await RULE_PREDICATES.depInAnyPackageJson(dir, ['pg'])).toBe(false)
    })
  })
})

describe('nestedPackageWithoutVite', () => {
  test('вкладений package.json без vite → true', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'root' })
      await ensureDir(join(dir, 'app'))
      await writeJson(join(dir, 'app', 'package.json'), { devDependencies: {} })
      expect(await RULE_PREDICATES.nestedPackageWithoutVite(dir)).toBe(true)
    })
  })
  test('вкладений з vite → false', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'root' })
      await ensureDir(join(dir, 'app'))
      await writeJson(join(dir, 'app', 'package.json'), { devDependencies: { vite: '^5' } })
      expect(await RULE_PREDICATES.nestedPackageWithoutVite(dir)).toBe(false)
    })
  })
})

describe('content-предикати через facts', () => {
  test('gqlTaggedTemplate бачить gql-літерал', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'a.js'), 'const q = gql`{ x }`', 'utf8')
      const facts = await collectAutoRuleFacts(dir)
      expect(RULE_PREDICATES.gqlTaggedTemplate(facts)).toBe(true)
    })
  })
  test('hasuraConfigMarker бачить config.yaml', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'config.yaml'), 'metadata_directory: metadata\n', 'utf8')
      const facts = await collectAutoRuleFacts(dir)
      expect(RULE_PREDICATES.hasuraConfigMarker(facts)).toBe(true)
    })
  })
  test('jsBunDbSignal: import sql з bun', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'db.js'), 'import { sql } from "bun"', 'utf8')
      const facts = await collectAutoRuleFacts(dir)
      expect(await RULE_PREDICATES.jsBunDbSignal(dir, facts)).toBe(true)
    })
  })
})
```

- [ ] **Step 3: Запустити — переконатися, що падає**

Run: `cd npm && npx vitest run scripts/lib/tests/rule-predicates.test.mjs`
Expected: FAIL — `Cannot find module '../rule-predicates.mjs'`.

- [ ] **Step 4: Реалізувати `rule-predicates.mjs`**

Перенести логіку з `auto-rules.mjs`. Залежності `collectDependencyKeysPresentInPackageJsonTree` і `hasNestedPackageJsonWithoutViteDevDependency` — **експортувати** з `auto-rules.mjs` (додати `export` перед їх оголошеннями в Task 4) АБО перенести в цей файл. Щоб уникнути циклу (rule-predicates ↔ auto-rules), перенести обидві walk-функції СЮДИ; `auto-rules.mjs` потім імпортує їх звідси.

Файл `npm/scripts/lib/rule-predicates.mjs`:

```js
/**
 * Реєстр незводимих до даних предикатів автодетекту правил.
 *
 * Прості умови (наявність файлів) живуть як `glob` у `meta.json`; ці предикати —
 * для умов, що вимагають парсингу залежностей, сканування вмісту source чи URL repo.
 * Декларація «який предикат + аргумент» — у `meta.json.auto.predicate`; тут — реалізація.
 *
 * Сигнатури неоднорідні (одні беруть `facts`, інші — `cwd`/`packageJson`), бо предикати
 * читають різні джерела; виклик диспетчиться в `auto-rules.mjs` за іменем предиката.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getRepositoryUrl } from './rule-meta-helpers.mjs'

const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', '.next', '.turbo'])

/**
 * Чи package.json дерева містить будь-який із зазначених пакетів у dependencies.
 * @param {string} root корінь репо
 * @param {string[]} keys імена пакетів
 * @returns {Promise<boolean>} true, якщо знайдено хоч один
 */
async function anyDepInTree(root, keys) {
  const wanted = new Set(keys)
  let found = false
  /** @param {string} dir каталог обходу @returns {Promise<void>} */
  async function walk(dir) {
    if (found) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (found) return
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIR_NAMES.has(entry.name)) await walk(abs)
      } else if (entry.isFile() && entry.name === 'package.json') {
        try {
          const deps = JSON.parse(await readFile(abs, 'utf8'))?.dependencies
          if (deps && typeof deps === 'object' && !Array.isArray(deps)) {
            for (const k of wanted) if (Object.hasOwn(deps, k)) found = true
          }
        } catch {
          /* ігноруємо пошкоджені package.json */
        }
      }
    }
  }
  await walk(root)
  return found
}

/**
 * Чи існує вкладений (не кореневий) package.json без `vite` у devDependencies.
 * @param {string} root корінь репо
 * @returns {Promise<boolean>} true, якщо знайдено
 */
async function nestedWithoutVite(root) {
  const rootPkg = join(root, 'package.json')
  let result = false
  /** @param {string} dir каталог @returns {Promise<void>} */
  async function walk(dir) {
    if (result) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (result) return
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIR_NAMES.has(entry.name)) await walk(abs)
      } else if (entry.isFile() && entry.name === 'package.json' && abs !== rootPkg) {
        try {
          const dev = JSON.parse(await readFile(abs, 'utf8'))?.devDependencies
          const hasVite = dev && typeof dev === 'object' && !Array.isArray(dev) && Object.hasOwn(dev, 'vite')
          if (!hasVite) result = true
        } catch {
          /* пошкоджений package.json не вважаємо vite-проєктом */
        }
      }
    }
  }
  await walk(root)
  return result
}

/** Реєстр предикатів: імʼя → реалізація. Виклик за `meta.json.auto.predicate`. */
export const RULE_PREDICATES = {
  /**
   * @param {unknown} packageJson кореневий package.json
   * @param {string} arg підрядок-маркер URL
   * @returns {boolean} true, якщо repository.url містить маркер
   */
  repoUrlMarker(packageJson, arg) {
    const url = getRepositoryUrl(
      packageJson && typeof packageJson === 'object' && !Array.isArray(packageJson)
        ? /** @type {Record<string, unknown>} */ (packageJson).repository
        : null
    )
    return typeof url === 'string' && url.toLowerCase().includes(String(arg).toLowerCase())
  },
  /**
   * @param {string} cwd корінь репо
   * @param {string[]} arg імена пакетів
   * @returns {Promise<boolean>} true, якщо будь-який пакет у dependencies дерева
   */
  depInAnyPackageJson(cwd, arg) {
    return anyDepInTree(cwd, Array.isArray(arg) ? arg : [])
  },
  /**
   * @param {{ hasGqlTaggedTemplates: boolean }} facts факти
   * @returns {boolean} true, якщо є gql-літерал
   */
  gqlTaggedTemplate(facts) {
    return facts.hasGqlTaggedTemplates === true
  },
  /**
   * @param {{ hasHasuraConfig: boolean }} facts факти
   * @returns {boolean} true, якщо config.yaml із маркером
   */
  hasuraConfigMarker(facts) {
    return facts.hasHasuraConfig === true
  },
  /**
   * @param {string} cwd корінь репо
   * @param {{ hasBunSqlImport: boolean }} facts факти
   * @returns {Promise<boolean>} true, якщо deps pg/pg-format/mysql2 або import sql з bun
   */
  async jsBunDbSignal(cwd, facts) {
    if (facts.hasBunSqlImport === true) return true
    return anyDepInTree(cwd, ['pg', 'pg-format', 'mysql2'])
  },
  /**
   * @param {string} cwd корінь репо
   * @returns {Promise<boolean>} true, якщо вкладений package.json без vite
   */
  nestedPackageWithoutVite(cwd) {
    return nestedWithoutVite(cwd)
  }
}
```

> Примітка: `getRepositoryUrl` зараз у `auto-rules.mjs`. Щоб уникнути циклу імпортів, у Task 4 винеси `getRepositoryUrl`, `isMonorepoPackage`, `normalizeIdList`, `migrateRuleIds`, `detectLegacyRuleIds`, `RULE_MIGRATIONS` у новий `npm/scripts/lib/rule-meta-helpers.mjs` і ре-експортуй із `auto-rules.mjs` для зворотної сумісності. Цей файл імпортує `getRepositoryUrl` звідти.

- [ ] **Step 5: Створити `rule-meta-helpers.mjs` (винесення спільного, щоб розірвати цикл)**

Файл `npm/scripts/lib/rule-meta-helpers.mjs` — перенести з `auto-rules.mjs` БЕЗ зміни тіл: `RULE_MIGRATIONS`, `migrateRuleIds`, `detectLegacyRuleIds`, `normalizeIdList`, `getRepositoryUrl`, `isMonorepoPackage`. Кожна з повним наявним JSDoc. Верхній JSDoc модуля українською: «Чисті хелпери конфігу/репо для автодетекту правил (id-міграції, нормалізація списків, repository URL, monorepo-детект). Винесені з auto-rules.mjs, щоб rule-predicates.mjs міг їх використати без циклу.»

- [ ] **Step 6: Запустити — переконатися, що проходить**

Run: `cd npm && npx vitest run scripts/lib/tests/rule-predicates.test.mjs`
Expected: PASS.

> `collectAutoRuleFacts` усе ще в `auto-rules.mjs` (тест його імпортує) — цей імпорт коректний, бо `collectAutoRuleFacts` не залежить від `rule-predicates` (нема циклу).

- [ ] **Step 7: Коміт**

```bash
git add npm/scripts/lib/rule-predicates.mjs npm/scripts/lib/rule-meta-helpers.mjs \
        npm/scripts/lib/tests/rule-predicates.test.mjs
git commit -m "feat(rule-predicates): реєстр незводимих предикатів + винести rule-meta-helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Створити 29 `meta.json` (міграція даних), лишити `auto.md` поки що

**Files:** `npm/rules/<id>/meta.json` × 29 (+ 4 opt-in без `auto`).

Створюємо `meta.json` паралельно з наявними `auto.md` (видалимо в Task 6 після переходу `auto-rules.mjs`). Це тримає TDD-кроки атомарними.

- [ ] **Step 1: Створити `meta.json` для Type B (always) — 4 файли**

`npm/rules/adr/meta.json`, `security`, `test`, `text` — кожен:

```json
{ "auto": "завжди" }
```

- [ ] **Step 2: Type C (deps) — 3 файли**

`npm/rules/changelog/meta.json`: `{ "auto": ["bun"] }`
`npm/rules/image-compress/meta.json`: `{ "auto": ["bun"] }`
`npm/rules/image-avif/meta.json`: `{ "auto": ["vue", "image-compress"] }`

- [ ] **Step 3: Type A (glob) — 13 файлів** (точні патерни; якщо Task 2 Step 1 показав, що `{a,b}` не працює — використати масив-форму, вказану нижче)

`npm/rules/bun/meta.json`: `{ "auto": { "glob": "package.json" } }`
`npm/rules/php/meta.json`: `{ "auto": { "glob": "composer.json" } }`
`npm/rules/npm-module/meta.json`: `{ "auto": { "glob": "npm/**" } }`
`npm/rules/capacitor/meta.json`: `{ "auto": { "glob": "**/capacitor.config.json" } }`
`npm/rules/rust/meta.json`: `{ "auto": { "glob": "**/Cargo.toml" } }`
`npm/rules/rego/meta.json`: `{ "auto": { "glob": "**/*.rego" } }`
`npm/rules/vue/meta.json`: `{ "auto": { "glob": "**/*.vue" } }`
`npm/rules/ga/meta.json`: `{ "auto": { "glob": ".github/workflows/**" } }`
`npm/rules/k8s/meta.json`: `{ "auto": { "glob": "**/k8s/**" } }`
`npm/rules/docker/meta.json`: `{ "auto": { "glob": ["**/Dockerfile", "**/Dockerfile.*"] } }`
`npm/rules/js-lint/meta.json`: `{ "auto": { "glob": ["**/*.mjs", "**/*.cjs", "**/*.js", "**/*.jsx", "**/*.ts", "**/*.tsx"] } }`
`npm/rules/style-lint/meta.json`: `{ "auto": { "glob": ["**/*.css", "**/*.vue"] } }`
`npm/rules/nginx-default-tpl/meta.json`: `{ "auto": { "glob": ["**/default.conf.template", "**/default.conf", "**/nginx.conf"] } }`

> Масив-форму для multi-extension обрано навмисно (не покладаємось на `{a,b}` у `globToRegex`).

- [ ] **Step 4: Type D (predicate) — 9 файлів (включно з tauri)**

`npm/rules/abie/meta.json`: `{ "auto": { "predicate": "repoUrlMarker", "arg": "https://github.com/abinbevefes/" } }`
`npm/rules/efes/meta.json`: `{ "auto": { "predicate": "repoUrlMarker", "arg": "https://github.com/efes-cloud/" } }`
`npm/rules/graphql/meta.json`: `{ "auto": { "predicate": "gqlTaggedTemplate" } }`
`npm/rules/hasura/meta.json`: `{ "auto": { "predicate": "hasuraConfigMarker" } }`
`npm/rules/js-mssql/meta.json`: `{ "auto": { "predicate": "depInAnyPackageJson", "arg": ["mssql"] } }`
`npm/rules/js-bun-redis/meta.json`: `{ "auto": { "predicate": "depInAnyPackageJson", "arg": ["ioredis", "node-redis"] } }`
`npm/rules/js-bun-db/meta.json`: `{ "auto": { "predicate": "jsBunDbSignal" } }`
`npm/rules/js-run/meta.json`: `{ "auto": { "predicate": "nestedPackageWithoutVite" } }`
`npm/rules/tauri/meta.json`: `{ "auto": { "predicate": "depInAnyPackageJson", "arg": ["@tauri-apps/api"] } }`

- [ ] **Step 5: Opt-in — 4 файли без `auto`**

`npm/rules/ci4/meta.json`, `feedback`, `release`, `worktree` — кожен:

```json
{}
```

- [ ] **Step 6: Перевірити валідність усіх JSON + покриття**

Run: `cd npm && for f in rules/*/meta.json; do node -e "JSON.parse(require('fs').readFileSync('$f'))" || echo "BAD: $f"; done; echo "count: $(ls rules/*/meta.json | wc -l)"`
Expected: жодного `BAD`; `count: 33`.

- [ ] **Step 7: Коміт**

```bash
git add npm/rules/*/meta.json
git commit -m "feat(rules): meta.json для 33 правил (data-driven auto) — поряд з auto.md

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Переписати ядро `auto-rules.mjs` на meta-інтерпретатор

**Files:**

- Modify: `npm/scripts/auto-rules.mjs`

Зберегти публічний контракт `detectAutoRules({root, availableRules, packageJsonParsed, disableRules})` і всі експорти. Замінити внутрішній `autoRuleChecks[]` + хардкод `AUTO_RULE_ORDER`/`AUTO_RULE_DEPENDENCIES` на читання meta.

- [ ] **Step 1: Винести спільні хелпери (розірвати цикл — узгоджено з Task 2 Step 5)**

У `auto-rules.mjs` видалити локальні оголошення `RULE_MIGRATIONS`, `migrateRuleIds`, `detectLegacyRuleIds`, `normalizeIdList`, `getRepositoryUrl`, `isMonorepoPackage` і **ре-експортувати** з нового хелпера:

```js
export {
  RULE_MIGRATIONS,
  migrateRuleIds,
  detectLegacyRuleIds,
  normalizeIdList,
  getRepositoryUrl,
  isMonorepoPackage
} from './lib/rule-meta-helpers.mjs'
```

(зберігає зовнішній API — тести імпортують їх з `auto-rules.mjs`).

- [ ] **Step 2: Додати meta-дискавері й застосування spec**

Додати імпорти:

```js
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRuleAutoSpec, readRuleMetaRaw } from './lib/rule-meta.mjs'
import { RULE_PREDICATES } from './lib/rule-predicates.mjs'
import { globToRegex } from '../rules/npm-module/js/package_structure.mjs'
```

Додати скан правил пакета (порядок виводимо звідси):

```js
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const RULES_DIR = join(PACKAGE_ROOT, 'rules')

/**
 * Скан `npm/rules/<id>/meta.json` → мапа id → RuleAutoSpec (лише правила з розпізнаним auto).
 * @param {string} [rulesDir] override для тестів
 * @returns {Record<string, import('./lib/rule-meta.mjs').RuleAutoSpec>} мапа автоактивації
 */
export function discoverRuleAutoActivation(rulesDir = RULES_DIR) {
  /** @type {Record<string, import('./lib/rule-meta.mjs').RuleAutoSpec>} */
  const out = {}
  let entries
  try {
    entries = readdirSync(rulesDir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const raw = readRuleMetaRaw(join(rulesDir, entry.name))
    if (!raw) continue
    const spec = parseRuleAutoSpec(raw.auto)
    if (spec) out[entry.name] = spec
  }
  return out
}

const RULE_AUTO_ACTIVATION = discoverRuleAutoActivation()

/** Стабільний алфавітний порядок (замість хардкод-масиву). */
export const AUTO_RULE_ORDER = Object.freeze(Object.keys(RULE_AUTO_ACTIVATION).toSorted((a, b) => a.localeCompare(b)))

/** Граф залежностей із meta (Type C) — замість хардкод-константи. */
export const AUTO_RULE_DEPENDENCIES = Object.freeze(
  Object.fromEntries(
    Object.entries(RULE_AUTO_ACTIVATION)
      .filter(([, s]) => 'rules' in s)
      .map(([id, s]) => [id, Object.freeze(/** @type {{rules:string[]}} */ (s).rules)])
  )
)
```

> `readdirSync` додати в наявний `import { existsSync } from 'node:fs'` → `import { existsSync, readdirSync } from 'node:fs'`.

- [ ] **Step 3: Замінити тіло `detectAutoRules` на застосування spec**

Зберегти сигнатуру. Усередині: зібрати факти (`collectAutoRuleFacts`), зібрати **множину posix-шляхів** дерева (для glob), потім для кожного правила з `RULE_AUTO_ACTIVATION` обчислити активацію:

```js
export async function detectAutoRules({
  root,
  availableRules,
  packageJsonParsed,
  disableRules = DEFAULT_DISABLED_LIST
}) {
  const facts = await collectAutoRuleFacts(root)
  const paths = await collectRepoPaths(root) // новий збирач relative-posix шляхів (Step 4)
  const normalizedRules = new Set(availableRules.map(r => r.trim().toLowerCase()))
  const disableRulesSet = new Set(disableRules)

  /** @type {string[]} */
  const detectedRules = []
  /**
   * @param {string} ruleId id правила
   * @returns {void}
   */
  function addRule(ruleId) {
    if (!normalizedRules.has(ruleId) || disableRulesSet.has(ruleId) || detectedRules.includes(ruleId)) return
    detectedRules.push(ruleId)
  }

  // 1. always / glob / predicate (rules-deps відкладаємо на резолвер)
  for (const [ruleId, spec] of Object.entries(RULE_AUTO_ACTIVATION)) {
    if ('rules' in spec) continue
    if (await specMatches(spec, { root, facts, paths, packageJsonParsed })) addRule(ruleId)
  }
  // 2. транзитивні залежності (Type C)
  resolveRuleDependencies(detectedRules, addRule)

  const rules = AUTO_RULE_ORDER.filter(r => detectedRules.includes(r))
  return { rules }
}
```

Допоміжна `specMatches`:

```js
/**
 * Чи активується правило за його spec.
 * @param {import('./lib/rule-meta.mjs').RuleAutoSpec} spec нормалізований auto
 * @param {{root:string, facts:object, paths:string[], packageJsonParsed:unknown}} ctx контекст
 * @returns {Promise<boolean>} true, якщо правило активне
 */
async function specMatches(spec, ctx) {
  if ('always' in spec) return true
  if ('glob' in spec) {
    const res = spec.glob.map(g => globToRegex(g))
    return ctx.paths.some(p => res.some(re => re.test(p)))
  }
  if ('predicate' in spec) {
    const fn = RULE_PREDICATES[spec.predicate]
    if (!fn) return false
    if (spec.predicate === 'repoUrlMarker') return fn(ctx.packageJsonParsed, spec.arg)
    if (spec.predicate === 'gqlTaggedTemplate' || spec.predicate === 'hasuraConfigMarker') return fn(ctx.facts)
    if (spec.predicate === 'jsBunDbSignal') return fn(ctx.root, ctx.facts)
    return fn(ctx.root, spec.arg) // depInAnyPackageJson, nestedPackageWithoutVite (arg ignored)
  }
  return false
}
```

> `resolveRuleDependencies` уже існує в `auto-rules.mjs` — лишити як є (читає `AUTO_RULE_DEPENDENCIES`, яке тепер з meta).

- [ ] **Step 4: Додати `collectRepoPaths` (relative-posix шляхи для glob)**

```js
/**
 * Збирає relative-posix шляхи всіх файлів дерева (для glob-матчингу Type A).
 * @param {string} root корінь репо
 * @returns {Promise<string[]>} шляхи відносно root у posix-форматі
 */
async function collectRepoPaths(root) {
  /** @type {string[]} */
  const out = []
  /** @param {string} dir каталог @returns {Promise<void>} */
  async function walk(dir) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIR_NAMES.has(entry.name)) await walk(abs)
      } else if (entry.isFile()) {
        out.push(relative(root, abs).split('\\').join('/'))
      }
    }
  }
  await walk(root)
  return out
}
```

> `relative` додати в `import { basename, join, relative } from 'node:path'` (вже частково є — звірити наявні).

- [ ] **Step 5: Прибрати мертве — `tempo` fact і старий `autoRuleChecks`**

Видалити з `collectAutoRuleFacts`: `hasTempoDir` (збирався, не вживався) і відповідну гілку в `updateDirFacts`. Видалити старий масив `autoRuleChecks[]` і блоки `addRule('adr')`/`security`/`test`/`text`/`vue` (тепер усе через meta). Видалити невживані тепер константи (`ABIE_REPOSITORY_URL_MARKER` тощо — перенесені в predicates), якщо oxlint/knip позначить.

- [ ] **Step 6: Прогнати наявні auto-rules тести (головний регресійний контракт)**

Run: `cd npm && npx vitest run scripts/tests/auto-rules.test.mjs 2>&1 | tail -20`
Expected: усі наявні кейси, що НЕ створювали `auto.md`, проходять. Якщо якийсь падає — порівняти старий vs новий вивід `detectAutoRules` на тій самій фікстурі; різниця в порядку/складі = баг у meta або specMatches, виправити. **Очікувані легітимні зміни:** жодних (поведінка 1:1). tauri у цих тестах ще не перевіряється (його нема в `ALL_RULES`).

- [ ] **Step 7: Коміт**

```bash
git add npm/scripts/auto-rules.mjs
git commit -m "refactor(auto-rules): meta-інтерпретатор замість хардкод autoRuleChecks/ORDER/DEPS

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Тест tauri + регресія повного сюїту

**Files:**

- Modify: `npm/scripts/tests/auto-rules.test.mjs`

- [ ] **Step 1: Додати tauri у `ALL_RULES` і кейс автодетекту**

У `auto-rules.test.mjs` додати `'tauri'` в `ALL_RULES` (алфавітно після `style-lint`), і новий тест:

```js
test('tauri детектиться за @tauri-apps/api у dependencies', async () => {
  await withTmpDir(async dir => {
    await writeJson(join(dir, 'package.json'), { name: 'app', dependencies: { '@tauri-apps/api': '^2' } })
    const { rules } = await detectAutoRules({
      root: dir,
      availableRules: ALL_RULES,
      packageJsonParsed: { name: 'app', dependencies: { '@tauri-apps/api': '^2' } }
    })
    expect(rules).toContain('tauri')
  })
})
```

> Додавання `tauri` в `ALL_RULES` може зсунути очікувані масиви в існуючих тестах, де перевіряється повний вивід. Якщо тест порівнює точний масив і tauri туди потрапляє лише за наявності залежності — порядкові тести без `@tauri-apps/api` не зміняться (tauri не активується). Перевірити прогоном; де треба — додати tauri в expected лише там, де фікстура має залежність.

- [ ] **Step 2: Прогнати auto-rules тести**

Run: `cd npm && npx vitest run scripts/tests/auto-rules.test.mjs 2>&1 | tail -15`
Expected: PASS (усі, включно з новим tauri-кейсом).

- [ ] **Step 3: Повний сюїт пакета**

Run: `cd npm && npx vitest run 2>&1 | tail -12`
Expected: зелено; допустимі лише наперед відомі flaky (`post-tool-use-fix › readStdin`, `integration-repo-checks › checkNpmModule` за наявності незакомічених змін).

- [ ] **Step 4: Коміт**

```bash
git add npm/scripts/tests/auto-rules.test.mjs
git commit -m "test(auto-rules): tauri автодетект + tauri у ALL_RULES

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Видалити 29 `auto.md`

**Files:** delete `npm/rules/<id>/auto.md` × 29.

- [ ] **Step 1: Видалити всі auto.md**

```bash
git rm npm/rules/*/auto.md
```

- [ ] **Step 2: Переконатися, що нічого не зламалось (auto.md більше не читається)**

Run: `cd npm && npx vitest run scripts/tests/auto-rules.test.mjs 2>&1 | tail -6`
Expected: PASS (детект працює з meta.json, не з auto.md).

Run: `ls npm/rules/*/auto.md 2>&1` → Expected: «No such file or directory».

- [ ] **Step 3: Коміт**

```bash
git commit -q -m "feat(rules): видалити auto.md — джерело правди тепер meta.json

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: JSON-схема `rule-meta.json` + v8r-каталог

**Files:**

- Create: `npm/schemas/rule-meta.json`
- Modify: `npm/schemas/v8r-catalog.json`

- [ ] **Step 1: Створити схему**

Файл `npm/schemas/rule-meta.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://unpkg.com/@nitra/cursor/schemas/rule-meta.json",
  "title": "n-cursor rule meta",
  "description": "Метадані правила @nitra/cursor: умова автоактивації (auto). Файл npm/rules/<id>/meta.json.",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "auto": {
      "description": "Умова автоактивації правила: \"завжди\", масив id правил-залежностей, glob, або іменований предикат.",
      "oneOf": [
        { "const": "завжди" },
        { "type": "array", "items": { "type": "string", "minLength": 1 }, "minItems": 1 },
        {
          "type": "object",
          "required": ["glob"],
          "additionalProperties": false,
          "properties": {
            "glob": {
              "oneOf": [
                { "type": "string", "minLength": 1 },
                { "type": "array", "items": { "type": "string", "minLength": 1 }, "minItems": 1 }
              ]
            }
          }
        },
        {
          "type": "object",
          "required": ["predicate"],
          "additionalProperties": false,
          "properties": {
            "predicate": { "type": "string", "minLength": 1 },
            "arg": {}
          }
        }
      ]
    }
  }
}
```

- [ ] **Step 2: Зареєструвати у v8r-каталозі**

У `npm/schemas/v8r-catalog.json` додати запис **за тим самим форматом, що сусідні** (звірити ключі `fileMatch`/`location`/`url` з наявним записом для skill-meta, якщо є):

```json
{
  "name": "n-cursor rule meta",
  "fileMatch": ["npm/rules/*/meta.json"],
  "location": "./schemas/rule-meta.json"
}
```

- [ ] **Step 3: Перевірити схему ajv проти всіх 33 meta.json**

Run: `cd npm && node -e "const A=require('ajv'); const a=new (A.default||A)({allErrors:true}); const v=a.compile(require('./schemas/rule-meta.json')); const fs=require('fs'); let bad=0; for(const d of fs.readdirSync('rules')){const p='rules/'+d+'/meta.json'; if(!fs.existsSync(p))continue; const ok=v(JSON.parse(fs.readFileSync(p))); if(!ok){bad++; console.log(d, v.errors)}} console.log('invalid:', bad)"`
Expected: `invalid: 0`.

- [ ] **Step 4: Коміт**

```bash
git add npm/schemas/rule-meta.json npm/schemas/v8r-catalog.json
git commit -m "feat(schemas): rule-meta.json + реєстрація у v8r-каталозі

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Check-концерн `rule_meta.mjs` (валідація)

**Files:**

- Create: `npm/rules/npm-module/js/rule_meta.mjs`
- Test: `npm/rules/npm-module/js/tests/rule_meta.test.mjs`

Дзеркало `skill_meta.mjs`, але для `npm/rules/`: кожне правило має валідний `meta.json` (або без `auto` = opt-in), `auto.md` не лишилось, для `predicate` — імʼя в реєстрі.

- [ ] **Step 1: Написати падаючі тести**

Файл `npm/rules/npm-module/js/tests/rule_meta.test.mjs`:

```js
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { check } from '../rule_meta.mjs'
import { ensureDir, withTmpDir, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

describe('rule_meta check', () => {
  test('валідні meta.json (усі форми) → 0', async () => {
    await withTmpDir(async dir => {
      const mk = async (id, meta) => {
        await ensureDir(join(dir, 'npm', 'rules', id))
        await writeJson(join(dir, 'npm', 'rules', id, 'meta.json'), meta)
      }
      await mk('adr', { auto: 'завжди' })
      await mk('changelog', { auto: ['bun'] })
      await mk('vue', { auto: { glob: '**/*.vue' } })
      await mk('abie', { auto: { predicate: 'repoUrlMarker', arg: 'x' } })
      await mk('ci4', {})
      expect(await check(dir)).toBe(0)
    })
  })

  test('відсутній meta.json → 1', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm', 'rules', 'adr'))
      expect(await check(dir)).toBe(1)
    })
  })

  test('залишковий auto.md → 1', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm', 'rules', 'adr'))
      await writeJson(join(dir, 'npm', 'rules', 'adr', 'meta.json'), { auto: 'завжди' })
      await writeFile(join(dir, 'npm', 'rules', 'adr', 'auto.md'), 'завжди\n', 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('нерозпізнаний auto → 1', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm', 'rules', 'x'))
      await writeJson(join(dir, 'npm', 'rules', 'x', 'meta.json'), { auto: 'always' })
      expect(await check(dir)).toBe(1)
    })
  })

  test('невідомий predicate → 1', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm', 'rules', 'x'))
      await writeJson(join(dir, 'npm', 'rules', 'x', 'meta.json'), { auto: { predicate: 'bogusPredicate' } })
      expect(await check(dir)).toBe(1)
    })
  })

  test('немає npm/rules → 0', async () => {
    await withTmpDir(async dir => {
      expect(await check(dir)).toBe(0)
    })
  })
})
```

- [ ] **Step 2: Запустити — переконатися, що падає**

Run: `cd npm && npx vitest run rules/npm-module/js/tests/rule_meta.test.mjs`
Expected: FAIL — `Cannot find module '../rule_meta.mjs'`.

- [ ] **Step 3: Реалізувати концерн**

Файл `npm/rules/npm-module/js/rule_meta.mjs`:

```js
/**
 * Перевірка метаданих правил пакета `@nitra/cursor` (концерн правила npm-module).
 *
 * Кожен `npm/rules/<id>/` має містити валідний `meta.json`:
 *  - `auto` (якщо присутнє) — розпізнане `parseRuleAutoSpec` (завжди / масив / glob / predicate);
 *  - для `predicate` — імʼя є в реєстрі `RULE_PREDICATES`;
 *  - залишковий `auto.md` заборонено (міграція на meta.json завершена).
 *
 * Застосовний лише в репо пакета (де є `npm/rules/`); у споживача каталогу нема — пропуск.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { parseRuleAutoSpec, readRuleMetaRaw } from '../../../scripts/lib/rule-meta.mjs'
import { RULE_PREDICATES } from '../../../scripts/lib/rule-predicates.mjs'

/**
 * Валідує всі `npm/rules/<id>/meta.json`.
 * @param {string} [cwd] корінь репозиторію
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export function check(cwd = process.cwd()) {
  const reporter = createCheckReporter()
  const rulesDir = join(cwd, 'npm', 'rules')
  if (!existsSync(rulesDir)) {
    reporter.pass('npm/rules/ відсутній — немає правил для валідації')
    return Promise.resolve(reporter.getExitCode())
  }

  for (const entry of readdirSync(rulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const id = entry.name
    const ruleDir = join(rulesDir, id)
    let ruleOk = true

    if (existsSync(join(ruleDir, 'auto.md'))) {
      reporter.fail(`rules/${id}: залишковий auto.md — видали (метадані тепер у meta.json)`)
      ruleOk = false
    }

    const raw = readRuleMetaRaw(ruleDir)
    if (!raw) {
      reporter.fail(`rules/${id}: відсутній або невалідний meta.json`)
      continue
    }
    if (raw.auto !== undefined) {
      const spec = parseRuleAutoSpec(raw.auto)
      if (spec === null) {
        reporter.fail(`rules/${id}: meta.json.auto нерозпізнане (очікується "завжди" / масив / {glob} / {predicate})`)
        ruleOk = false
      } else if ('predicate' in spec && !Object.hasOwn(RULE_PREDICATES, spec.predicate)) {
        reporter.fail(`rules/${id}: невідомий predicate "${spec.predicate}" (немає в RULE_PREDICATES)`)
        ruleOk = false
      }
    }
    if (ruleOk) {
      reporter.pass(`rules/${id}: meta.json валідний`)
    }
  }

  return Promise.resolve(reporter.getExitCode())
}
```

- [ ] **Step 4: Запустити — переконатися, що проходить**

Run: `cd npm && npx vitest run rules/npm-module/js/tests/rule_meta.test.mjs`
Expected: PASS (всі 6 кейсів).

- [ ] **Step 5: Прогнати концерн на реальному репо**

Run: `cd /Users/vitaliytv/www/nitra/cursor && node -e "import('./npm/rules/npm-module/js/rule_meta.mjs').then(async m=>{const c=await m.check(process.cwd()); console.log('EXIT', c)})" 2>&1 | grep -E "EXIT|❌" | tail`
Expected: `EXIT 0` (усі 33 правила валідні, жодного `auto.md`).

- [ ] **Step 6: Коміт**

```bash
git add npm/rules/npm-module/js/rule_meta.mjs npm/rules/npm-module/js/tests/rule_meta.test.mjs
git commit -m "feat(npm-module): концерн валідації rules/<id>/meta.json

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Документація, change-файл, фінальна верифікація

**Files:**

- Modify: `.cursor/rules/scripts.mdc`, `npm/README.md`
- Create: change-файл

- [ ] **Step 1: Оновити `scripts.mdc`**

У дереві структури правила (рядок ~13) замінити `auto.md` на `meta.json` і додати абзац після нього:

```
├── meta.json                              ← метадані правила: auto (умова автоактивації)
```

Додати в текст про автодетект (де згадується `auto.md`): «Автоактивація правила — поле `auto` у `npm/rules/<id>/meta.json`: `"завжди"` | масив id правил-залежностей | `{glob}` (наявність файлів) | `{predicate, arg}` (незводимий предикат із реєстру `npm/scripts/lib/rule-predicates.mjs`). Інтерпретатор — `npm/scripts/auto-rules.mjs`; валідація — концерн `npm-module/js/rule_meta.mjs`.»

- [ ] **Step 2: Оновити `npm/README.md`**

У секції «### Структура одного правила» замінити рядок `auto.md` → `meta.json`:

```
├── meta.json             # метадані правила: auto (умова автоактивації)
```

- [ ] **Step 3: Створити change-файл**

```bash
cd npm && npx @nitra/cursor change --bump minor --section Changed \
  --message "rules: автодетект перенесено з хардкоду auto-rules.mjs + auto.md на data-driven meta.json (glob/predicate/deps); увімкнено автодетект tauri" \
  && cd ..
```

Expected: `✅ .changes/<…>.md`.

- [ ] **Step 4: Повний прогін тестів + перевірки**

Run: `cd npm && npx vitest run 2>&1 | tail -12`
Expected: зелено (крім відомих flaky).

Run: `cd /Users/vitaliytv/www/nitra/cursor && node npm/bin/n-cursor.js fix changelog 2>&1 | tail -5`
Expected: exit 0.

- [ ] **Step 5: Перевірити, що sync ще працює (правила розповсюджуються)**

Run: `cd /tmp && rm -rf rmt && mkdir rmt && cd rmt && git init -q && printf '{"$schema":"https://unpkg.com/@nitra/cursor/schemas/n-cursor.json","rules":["bun"]}' > .n-cursor.json && node /Users/vitaliytv/www/nitra/cursor/npm/bin/n-cursor.js >/tmp/rmt.log 2>&1; ls .cursor/rules/ | head; cd /Users/vitaliytv/www/nitra/cursor`
Expected: `.cursor/rules/` містить згенеровані `n-*.mdc` (автодетект+sync працюють з meta.json).

- [ ] **Step 6: Коміт**

```bash
git add .cursor/rules/scripts.mdc npm/README.md npm/.changes/
git commit -m "docs: scripts.mdc + README на rules meta.json; change-файл (Spec B)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (виконано автором плану)

**Spec coverage:**

- 4 форми `auto` → Task 1 (парсер) + Task 3 (дані). ✅
- glob Type A (13, масив-форма) → Task 3 Step 3 + Task 4 specMatches. ✅
- predicate Type D (6 предикатів) → Task 2 реєстр + Task 4 диспетч. ✅
- deps Type C → Task 1 (rules) + Task 4 resolveRuleDependencies. ✅
- always Type B → Task 1 + Task 3. ✅
- AUTO_RULE_ORDER/DEPS з meta (хардкод геть) → Task 4 Step 2. ✅
- tauri автодетект → Task 3 Step 4 + Task 5. ✅
- tempo fact прибрано → Task 4 Step 5. ✅
- opt-in (ci4/feedback/release/worktree) meta без auto → Task 3 Step 5. ✅
- видалення auto.md → Task 6; заборона залишку → Task 8. ✅
- схема + v8r → Task 7. ✅
- check-концерн rule_meta → Task 8. ✅
- порядок зворотної сумісності експортів (getRepositoryUrl тощо) → Task 2 Step 5 + Task 4 Step 1 (rule-meta-helpers + re-export). ✅
- ~45 регресійних тестів збережені → Task 4 Step 6 + Task 5. ✅
- docs + change → Task 9. ✅

**Placeholder scan:** усі кроки з кодом мають повний код; команди з очікуваним результатом.

**Type consistency:** `parseRuleAutoSpec`/`readRuleMetaRaw` (rule-meta), `RULE_PREDICATES` (rule-predicates), `discoverRuleAutoActivation`/`specMatches`/`collectRepoPaths` (auto-rules), `check(cwd)` (rule_meta) — імена узгоджені між задачами й тестами.

**Відомі ризики для виконавця:**

- **Цикл імпортів** rule-predicates ↔ auto-rules: розірвано винесенням спільного в `rule-meta-helpers.mjs` (Task 2 Step 5, Task 4 Step 1). Виконати саме в цьому порядку.
- **`globToRegex` і `{a,b}`**: Task 2 Step 1 перевіряє; план уже використовує масив-форму для multi-extension, тож brace-підтримка не критична.
- **`collectAutoRuleFacts` як джерело для предикатів**: лишається в `auto-rules.mjs`; rule-predicates content-предикати беруть `facts` параметром (нема циклу, бо тест імпортує `collectAutoRuleFacts` з auto-rules, а rule-predicates — ні).
- **tauri в expected-масивах** наявних тестів (Task 5 Step 1): додавати в expected лише там, де фікстура має `@tauri-apps/api`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-31-rule-meta-json.md`.
