# Lint Quick/All split via meta.json — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `n-cursor lint-quick` and `n-cursor lint-all` CLI commands that orchestrate lint steps declared in each rule's `meta.json` via `lint`, `lintCmd`, `lintScoped`, `lintAlways`, `lintCiCmd` fields. Existing scripts (`lint`, `lint-ga`, `lint-js`, etc.) are untouched (backward-compat).

**Architecture:** A new `run-lint-orchestrator.mjs` reads `rules/*/meta.json` (from the installed package's own rules dir via `import.meta.url`), collects steps with a `lint` field, and executes them sequentially (fail-fast). `lint-quick` passes changed files (from `git diff --name-only HEAD`) to `lintScoped: true` steps; `lint-all` runs every step + each step's `lintCiCmd` on the full repo. All execution is strictly sequential — no parallelism.

**Tech Stack:** Node.js ESM, `spawnSync` (node:child_process), `import.meta.url` for package-relative paths, vitest for tests.

**CRITICAL:** Never run multiple lint steps in parallel. Every loop is sequential. No `Promise.all` for lint steps.

---

## File Map

| Path                                                   | Action | Purpose                                                                                                                              |
| ------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `npm/schemas/rule-meta.json`                           | Modify | Add `lint`, `lintCmd`, `lintScoped`, `lintAlways`, `lintCiCmd` fields                                                                |
| `npm/rules/lint/lint.mdc`                              | Create | Convention doc for lint-quick/lint-all                                                                                               |
| `npm/rules/lint/meta.json`                             | Create | `{ "auto": "завжди" }` (auto-activates the doc)                                                                                      |
| `npm/rules/lint/check-lint.mjs`                        | Create | Validates lint fields in all rules                                                                                                   |
| `npm/rules/lint/tests/check-lint.test.mjs`             | Create | Tests for check-lint.mjs                                                                                                             |
| `npm/rules/oxfmt/oxfmt.mdc`                            | Create | Convention doc for oxfmt formatter                                                                                                   |
| `npm/rules/oxfmt/meta.json`                            | Create | `{ "lint": "quick", "lintCmd": "oxfmt .", "lintScoped": true }`                                                                      |
| `npm/rules/ga/meta.json`                               | Modify | Add `"lint": "quick", "lintCmd": "n-cursor lint-ga"`                                                                                 |
| `npm/rules/js-lint/meta.json`                          | Modify | Add `"lint": "quick", "lintCmd": "n-cursor lint-js", "lintScoped": true, "lintCiCmd": "bunx jscpd . && bunx knip --no-config-hints"` |
| `npm/rules/rego/meta.json`                             | Modify | Add `"lint": "quick", "lintCmd": "n-cursor lint-rego"`                                                                               |
| `npm/rules/style-lint/meta.json`                       | Modify | Add `"lint": "quick", "lintCmd": "npx stylelint '**/*.{css,scss,vue}' --fix"`                                                        |
| `npm/rules/text/meta.json`                             | Modify | Add `"lint": "quick", "lintCmd": "n-cursor lint-text"`                                                                               |
| `npm/rules/js-lint/lint/lint-js.mjs`                   | Create | CLI wrapper: `n-cursor lint-js [files...]` → oxlint+eslint                                                                           |
| `npm/rules/js-lint/lint/tests/lint-js.test.mjs`        | Create | Tests for lint-js wrapper                                                                                                            |
| `npm/scripts/lib/run-lint-orchestrator.mjs`            | Create | `readLintSteps()`, `runLintQuick()`, `runLintAll()`                                                                                  |
| `npm/scripts/lib/tests/run-lint-orchestrator.test.mjs` | Create | Tests for orchestrator                                                                                                               |
| `npm/bin/n-cursor.js`                                  | Modify | Add `case 'lint-quick':`, `case 'lint-all':`, `case 'lint-js':` + imports                                                            |
| `package.json` (root)                                  | Modify | Add `"lint-quick": "n-cursor lint-quick"`, `"lint-all": "n-cursor lint-all"`                                                         |
| `npm/rules/js-lint/js-lint.mdc`                        | Modify | Reference lint-quick/lint-all, remove lint-js from canonical                                                                         |

---

## Task 1: Extend `rule-meta.json` schema

**Files:**

- Modify: `npm/schemas/rule-meta.json`

- [ ] **Step 1: Write failing test (v8r validates new fields)**

Create `npm/schemas/tests/rule-meta-lint-fields.test.mjs`:

```javascript
import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv'

const SCHEMA = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../schemas/rule-meta.json'), 'utf8')
)
const ajv = new Ajv({ strict: false, allowUnionTypes: true })
const validate = ajv.compile(SCHEMA)

describe('rule-meta.json lint fields', () => {
  test('accepts meta with lint + lintCmd', () => {
    expect(validate({ lint: 'quick', lintCmd: 'n-cursor lint-ga' })).toBe(true)
  })
  test('accepts meta with all lint fields', () => {
    expect(
      validate({
        lint: 'quick',
        lintCmd: 'n-cursor lint-ga',
        lintScoped: false,
        lintAlways: false,
        lintCiCmd: 'bunx jscpd .'
      })
    ).toBe(true)
  })
  test('rejects lint without lintCmd (dependentRequired)', () => {
    expect(validate({ lint: 'quick' })).toBe(false)
  })
  test('rejects unknown lint value', () => {
    expect(validate({ lint: 'fast', lintCmd: 'echo' })).toBe(false)
  })
  test('rejects extra property', () => {
    expect(validate({ lint: 'quick', lintCmd: 'echo', extra: true })).toBe(false)
  })
})
```

- [ ] **Step 2: Run to confirm fail**

```bash
cd npm && npx vitest run schemas/tests/rule-meta-lint-fields.test.mjs 2>&1 | tail -5
```

Expected: FAIL (fields not in schema yet)

- [ ] **Step 3: Add fields to schema**

In `npm/schemas/rule-meta.json`, add after the `"auto"` property block and update `dependentRequired`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://unpkg.com/@nitra/cursor/schemas/rule-meta.json",
  "title": "n-cursor rule meta",
  "description": "Метадані правила @nitra/cursor: умова автоактивації (auto) та lint-фаза (lint*). Файл npm/rules/<id>/meta.json.",
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
    },
    "lint": {
      "type": "string",
      "enum": ["quick", "ci"],
      "description": "Фаза lint-прогону: quick (в lint-quick і lint-all) або ci (лише в lint-all)"
    },
    "lintCmd": {
      "type": "string",
      "minLength": 1,
      "description": "Команда для виконання lint-кроку (для scoped кроків — без glob/файлів)"
    },
    "lintScoped": {
      "type": "boolean",
      "description": "true → в lint-quick передавати список змінених файлів як positional args"
    },
    "lintAlways": {
      "type": "boolean",
      "description": "true → виконувати навіть якщо нема змінених файлів (для lintScoped: true кроків)"
    },
    "lintCiCmd": {
      "type": "string",
      "minLength": 1,
      "description": "Додаткова ci-only команда; виконується лише в lint-all після lintCmd"
    }
  },
  "dependentRequired": {
    "lintCmd": ["lint"],
    "lintScoped": ["lint"],
    "lintAlways": ["lint"],
    "lintCiCmd": ["lint"]
  }
}
```

> Note: `dependentRequired` is JSON Schema draft 2019-09+. For draft-07 compatibility, use `dependencies` instead. If `Ajv` raises an error during validation, replace `dependentRequired` with:
>
> ```json
> "dependencies": {
>   "lintCmd":    ["lint"],
>   "lintScoped": ["lint"],
>   "lintAlways": ["lint"],
>   "lintCiCmd":  ["lint"]
> }
> ```

- [ ] **Step 4: Run test to confirm pass**

```bash
cd npm && npx vitest run schemas/tests/rule-meta-lint-fields.test.mjs 2>&1 | tail -5
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add npm/schemas/rule-meta.json npm/schemas/tests/rule-meta-lint-fields.test.mjs
git commit -m "feat(schema): додати lint-поля до rule-meta.json (lint, lintCmd, lintScoped, lintAlways, lintCiCmd)"
```

---

## Task 2: Create lint convention rule

**Files:**

- Create: `npm/rules/lint/lint.mdc`
- Create: `npm/rules/lint/meta.json`
- Create: `npm/rules/lint/check-lint.mjs`
- Create: `npm/rules/lint/tests/check-lint.test.mjs`

- [ ] **Step 1: Write failing test for check-lint.mjs**

Create `npm/rules/lint/tests/check-lint.test.mjs`:

```javascript
import { describe, test, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { check } from '../check-lint.mjs'

function makeRulesDir(rules) {
  const root = mkdtempSync(join(tmpdir(), 'check-lint-'))
  for (const [id, meta] of Object.entries(rules)) {
    const dir = join(root, id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta), 'utf8')
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

describe('check-lint', () => {
  test('no violations for valid lint-step meta', () => {
    const { root, cleanup } = makeRulesDir({
      ga: { auto: 'завжди', lint: 'quick', lintCmd: 'n-cursor lint-ga' }
    })
    try {
      expect(check(root)).toEqual([])
    } finally {
      cleanup()
    }
  })

  test('violation: lint without lintCmd', () => {
    const { root, cleanup } = makeRulesDir({
      broken: { lint: 'quick' }
    })
    try {
      const result = check(root)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toContain('lintCmd')
    } finally {
      cleanup()
    }
  })

  test('violation: invalid lint value', () => {
    const { root, cleanup } = makeRulesDir({
      broken: { lint: 'fast', lintCmd: 'echo' }
    })
    try {
      const result = check(root)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toContain('lint')
    } finally {
      cleanup()
    }
  })

  test('no violation for rule without lint field', () => {
    const { root, cleanup } = makeRulesDir({
      adr: { auto: 'завжди' }
    })
    try {
      expect(check(root)).toEqual([])
    } finally {
      cleanup()
    }
  })

  test('no violation for rule without meta.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'check-lint-'))
    mkdirSync(join(root, 'empty-rule'), { recursive: true })
    try {
      expect(check(root)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run to confirm fail**

```bash
cd npm && npx vitest run rules/lint/tests/check-lint.test.mjs 2>&1 | tail -5
```

Expected: FAIL (check-lint.mjs does not exist yet)

- [ ] **Step 3: Create check-lint.mjs**

Create `npm/rules/lint/check-lint.mjs`:

```javascript
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const VALID_LINT_VALUES = new Set(['quick', 'ci'])

/**
 * Validate lint-fields in all rules' meta.json.
 * @param {string} rulesDir absolute path to the rules directory
 * @returns {string[]} array of violation messages; empty = ok
 */
export function check(rulesDir) {
  const violations = []

  let entries
  try {
    entries = readdirSync(rulesDir, { withFileTypes: true })
  } catch {
    return violations
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const id = entry.name
    const metaPath = join(rulesDir, id, 'meta.json')
    if (!existsSync(metaPath)) continue

    let meta
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf8'))
    } catch {
      continue
    }

    if (!('lint' in meta)) continue

    if (!VALID_LINT_VALUES.has(meta.lint)) {
      violations.push(`rules/${id}/meta.json: \`lint\` має бути "quick" або "ci", отримано "${meta.lint}"`)
    }

    if (!meta.lintCmd) {
      violations.push(`rules/${id}/meta.json: поле \`lintCmd\` обовʼязкове коли є \`lint\``)
    }
  }

  return violations
}
```

- [ ] **Step 4: Run test to confirm pass**

```bash
cd npm && npx vitest run rules/lint/tests/check-lint.test.mjs 2>&1 | tail -5
```

Expected: PASS (5 tests)

- [ ] **Step 5: Create lint.mdc**

Create `npm/rules/lint/lint.mdc`:

````markdown
---
description: Конвенція lint-quick/lint-all — два рівні lint-перевірок для розробки та CI.
globs:
alwaysApply: true
---

# Lint-конвенція: quick і all

## Скрипти

| Скрипт               | Команда               | Призначення                         |
| -------------------- | --------------------- | ----------------------------------- |
| `bun run lint-quick` | `n-cursor lint-quick` | Швидкий прогін по змінених файлах   |
| `bun run lint-all`   | `n-cursor lint-all`   | Повний прогін (всі кроки + ci-only) |

## Як це працює

`n-cursor lint-quick` і `n-cursor lint-all` читають `meta.json` кожного правила і збирають lint-кроки за полем `lint: "quick"|"ci"`. Кроки виконуються **строго послідовно** — жодної паралелізації.

## Поля `meta.json` для lint-кроків

```json
{
  "lint": "quick", // "quick" або "ci" (quick ⊆ all)
  "lintCmd": "n-cursor lint-ga", // команда для виконання (обовʼязкова якщо є lint)
  "lintScoped": false, // true → у lint-quick передавати змінені файли як аргументи
  "lintAlways": false, // true → виконувати навіть якщо нема змінених файлів
  "lintCiCmd": "..." // ci-only команда; виконується лише у lint-all
}
```
````

## Заборона паралельного запуску

`eslint`, `oxlint`, `lint-quick`, `lint-all` **не можна** запускати в кількох процесах/субагентах одночасно. Один послідовний прогін на сесію.

## Додавання нового lint-кроку

1. У `meta.json` правила — додати `lint`, `lintCmd` (і опційно `lintScoped`, `lintAlways`, `lintCiCmd`).
2. Запустити `npx @nitra/cursor fix lint` — check-lint.mjs перевірить коректність.

````

- [ ] **Step 6: Create lint/meta.json**

Create `npm/rules/lint/meta.json`:

```json
{ "auto": "завжди" }
````

- [ ] **Step 7: Commit**

```bash
git add npm/rules/lint/
git commit -m "feat(lint-rule): конвенційне правило lint — lint.mdc + check-lint.mjs"
```

---

## Task 3: Add lint fields to existing rule meta.json files

**Files:**

- Modify: `npm/rules/ga/meta.json`
- Modify: `npm/rules/js-lint/meta.json`
- Modify: `npm/rules/rego/meta.json`
- Modify: `npm/rules/style-lint/meta.json`
- Modify: `npm/rules/text/meta.json`

- [ ] **Step 1: Update each meta.json**

`npm/rules/ga/meta.json`:

```json
{ "auto": { "glob": ".github/workflows/**" }, "lint": "quick", "lintCmd": "n-cursor lint-ga" }
```

`npm/rules/js-lint/meta.json`:

```json
{
  "auto": { "glob": ["**/*.mjs", "**/*.cjs", "**/*.js", "**/*.jsx", "**/*.ts", "**/*.tsx"] },
  "lint": "quick",
  "lintCmd": "n-cursor lint-js",
  "lintScoped": true,
  "lintCiCmd": "bunx jscpd . && bunx knip --no-config-hints"
}
```

`npm/rules/rego/meta.json`:

```json
{ "auto": { "glob": "**/*.rego" }, "lint": "quick", "lintCmd": "n-cursor lint-rego" }
```

`npm/rules/style-lint/meta.json`:

```json
{
  "auto": { "glob": ["**/*.css", "**/*.vue"] },
  "lint": "quick",
  "lintCmd": "npx stylelint '**/*.{css,scss,vue}' --fix"
}
```

`npm/rules/text/meta.json`:

```json
{ "auto": "завжди", "lint": "quick", "lintCmd": "n-cursor lint-text" }
```

- [ ] **Step 2: Verify v8r validates all meta.json against new schema**

```bash
cd npm && bunx v8r 'rules/*/meta.json' -c npm-v8r-catalog.json 2>&1 | tail -10
```

Expected: 0 failures

- [ ] **Step 3: Verify check-lint reports no violations**

```javascript
// Quick inline check — run in Node
import { check } from './rules/lint/check-lint.mjs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
const rulesDir = join(dirname(fileURLToPath(import.meta.url)), 'rules')
console.log(check(rulesDir))
```

```bash
cd npm && node --input-type=module <<'EOF'
import { check } from './rules/lint/check-lint.mjs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const d = join(dirname(fileURLToPath(import.meta.url)), 'rules')
const v = check(d)
console.log(v.length === 0 ? 'OK' : v)
EOF
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add npm/rules/ga/meta.json npm/rules/js-lint/meta.json npm/rules/rego/meta.json npm/rules/style-lint/meta.json npm/rules/text/meta.json
git commit -m "feat(rules): lint-поля у meta.json для ga/js-lint/rego/style-lint/text"
```

---

## Task 4: Create `oxfmt` rule

**Files:**

- Create: `npm/rules/oxfmt/oxfmt.mdc`
- Create: `npm/rules/oxfmt/meta.json`

- [ ] **Step 1: Create oxfmt/meta.json**

```json
{ "lint": "quick", "lintCmd": "oxfmt .", "lintScoped": true }
```

> `lintScoped: true` — у lint-quick oxfmt отримає список файлів замість `.`

- [ ] **Step 2: Create oxfmt/oxfmt.mdc**

````markdown
---
description: Форматер oxfmt для JS/TS/Vue файлів.
globs: '**/*.{js,mjs,cjs,ts,tsx,vue}'
alwaysApply: false
---

# oxfmt — форматер

`oxfmt` форматує JS/TS/Vue файли. Запускається автоматично через `bun run lint-quick` / `bun run lint-all`.

Встановлення (вже є у `devDependencies` проєктів з `@nitra/cursor`):

```bash
bun add -D oxfmt
```
````

````

- [ ] **Step 3: Verify check-lint still passes**

```bash
cd npm && node --input-type=module <<'EOF'
import { check } from './rules/lint/check-lint.mjs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const d = join(dirname(fileURLToPath(import.meta.url)), 'rules')
const v = check(d)
console.log(v.length === 0 ? 'OK' : v)
EOF
````

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add npm/rules/oxfmt/
git commit -m "feat(oxfmt-rule): нове правило oxfmt (lint: quick, lintScoped)"
```

---

## Task 5: Create `n-cursor lint-js [files...]` CLI wrapper

**Files:**

- Create: `npm/rules/js-lint/lint/lint-js.mjs`
- Create: `npm/rules/js-lint/lint/tests/lint-js.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `npm/rules/js-lint/lint/tests/lint-js.test.mjs`:

```javascript
import { describe, test, expect } from 'vitest'
import { runLintJs } from '../lint-js.mjs'

const noop = String

function makeSpawn(responses) {
  let i = 0
  /** @type {{ cmd: string, args: string[] }[]} */
  const calls = []
  const spawnSyncFn = (cmd, args, _opts) => {
    const r = responses[i] ?? { status: 0 }
    i++
    calls.push({ cmd, args: [...args] })
    return { status: r.status, signal: null, stdout: '', stderr: '' }
  }
  return { spawnSyncFn, calls }
}

describe('runLintJs', () => {
  test('no files → runs oxlint and eslint with "."', () => {
    const { spawnSyncFn, calls } = makeSpawn([{ status: 0 }, { status: 0 }])
    const code = runLintJs([], { spawnSyncFn, cwd: '/tmp', log: noop })
    expect(code).toBe(0)
    expect(calls[0]).toMatchObject({ cmd: 'bunx', args: expect.arrayContaining(['oxlint', '--fix', '.']) })
    expect(calls[1]).toMatchObject({ cmd: 'bunx', args: expect.arrayContaining(['eslint', '--fix', '.']) })
  })

  test('with files → passes files to oxlint and eslint', () => {
    const { spawnSyncFn, calls } = makeSpawn([{ status: 0 }, { status: 0 }])
    const code = runLintJs(['src/a.mjs', 'src/b.ts'], { spawnSyncFn, cwd: '/tmp', log: noop })
    expect(code).toBe(0)
    expect(calls[0].args).toContain('src/a.mjs')
    expect(calls[0].args).toContain('src/b.ts')
    expect(calls[1].args).toContain('src/a.mjs')
    expect(calls[1].args).toContain('src/b.ts')
  })

  test('oxlint fail → returns non-zero, eslint not called', () => {
    const { spawnSyncFn, calls } = makeSpawn([{ status: 1 }, { status: 0 }])
    const code = runLintJs([], { spawnSyncFn, cwd: '/tmp', log: noop })
    expect(code).toBe(1)
    expect(calls.length).toBe(1)
  })

  test('oxlint pass, eslint fail → returns eslint code', () => {
    const { spawnSyncFn, calls } = makeSpawn([{ status: 0 }, { status: 2 }])
    const code = runLintJs([], { spawnSyncFn, cwd: '/tmp', log: noop })
    expect(code).toBe(2)
    expect(calls.length).toBe(2)
  })
})
```

- [ ] **Step 2: Run to confirm fail**

```bash
cd npm && npx vitest run rules/js-lint/lint/tests/lint-js.test.mjs 2>&1 | tail -5
```

Expected: FAIL (lint-js.mjs does not exist)

- [ ] **Step 3: Create lint-js.mjs**

Create `npm/rules/js-lint/lint/lint-js.mjs`:

```javascript
import { spawnSync as defaultSpawnSync } from 'node:child_process'

/**
 * Run oxlint + eslint on given files.
 * If files is empty, runs on '.' (whole project).
 * Used by n-cursor lint-js CLI command and lint-quick orchestrator.
 * @param {string[]} files
 * @param {{
 *   spawnSyncFn?: typeof defaultSpawnSync,
 *   cwd?: string,
 *   log?: (t: string) => void
 * }} [options]
 * @returns {number}
 */
export function runLintJs(files = [], options = {}) {
  const cwd = options.cwd ?? process.cwd()
  const spawnSync = options.spawnSyncFn ?? defaultSpawnSync
  const log = options.log ?? (t => process.stdout.write(t))
  const targets = files.length > 0 ? files : ['.']

  log(`▶ bunx oxlint --fix ${targets.join(' ')}\n`)
  const ox = spawnSync('bunx', ['oxlint', '--fix', ...targets], { stdio: 'inherit', cwd })
  const oxCode = typeof ox.status === 'number' ? ox.status : 1
  if (oxCode !== 0) return oxCode

  log(`▶ bunx eslint --fix ${targets.join(' ')}\n`)
  const es = spawnSync('bunx', ['eslint', '--fix', ...targets], { stdio: 'inherit', cwd })
  return typeof es.status === 'number' ? es.status : 1
}
```

- [ ] **Step 4: Run test to confirm pass**

```bash
cd npm && npx vitest run rules/js-lint/lint/tests/lint-js.test.mjs 2>&1 | tail -5
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add npm/rules/js-lint/lint/lint-js.mjs npm/rules/js-lint/lint/tests/lint-js.test.mjs
git commit -m "feat(js-lint): n-cursor lint-js wrapper — oxlint+eslint з підтримкою file args"
```

---

## Task 6: Create lint orchestrator (`run-lint-orchestrator.mjs`)

**Files:**

- Create: `npm/scripts/lib/run-lint-orchestrator.mjs`
- Create: `npm/scripts/lib/tests/run-lint-orchestrator.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `npm/scripts/lib/tests/run-lint-orchestrator.test.mjs`:

```javascript
import { describe, test, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readLintSteps, runLintQuick, runLintAll } from '../run-lint-orchestrator.mjs'

const noop = String

function makeRulesDir(rules) {
  const root = mkdtempSync(join(tmpdir(), 'lint-orch-'))
  for (const [id, meta] of Object.entries(rules)) {
    mkdirSync(join(root, id), { recursive: true })
    writeFileSync(join(root, id, 'meta.json'), JSON.stringify(meta), 'utf8')
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

function makeSpawn(responses) {
  let i = 0
  const calls = []
  const spawnSyncFn = (cmd, args, opts) => {
    const r = responses[i] ?? { status: 0 }
    i++
    calls.push({ cmd, args: [...(args ?? [])], cwd: opts?.cwd })
    return { status: r.status, signal: null, stdout: r.stdout ?? '', stderr: '' }
  }
  return { spawnSyncFn, calls }
}

describe('readLintSteps', () => {
  test('returns steps with lint field, sorted by id', () => {
    const { root, cleanup } = makeRulesDir({
      text: { lint: 'quick', lintCmd: 'n-cursor lint-text' },
      ga: { lint: 'quick', lintCmd: 'n-cursor lint-ga' },
      adr: { auto: 'завжди' }
    })
    try {
      const steps = readLintSteps(root)
      expect(steps.map(s => s.id)).toEqual(['ga', 'text'])
    } finally {
      cleanup()
    }
  })

  test('includes lintScoped, lintAlways, lintCiCmd defaults', () => {
    const { root, cleanup } = makeRulesDir({
      ga: { lint: 'quick', lintCmd: 'n-cursor lint-ga' }
    })
    try {
      const [step] = readLintSteps(root)
      expect(step.lintScoped).toBe(false)
      expect(step.lintAlways).toBe(false)
      expect(step.lintCiCmd).toBeUndefined()
    } finally {
      cleanup()
    }
  })
})

describe('runLintQuick', () => {
  test('runs quick steps only, passes changed files to scoped steps', () => {
    const { root, cleanup } = makeRulesDir({
      ga: { lint: 'quick', lintCmd: 'n-cursor lint-ga' },
      jslint: { lint: 'quick', lintCmd: 'n-cursor lint-js', lintScoped: true }
    })
    try {
      const { spawnSyncFn, calls } = makeSpawn([
        // git diff
        { status: 0, stdout: 'src/a.mjs\nsrc/b.ts\n' },
        { status: 0 }, // ga
        { status: 0 } // lint-js with files
      ])
      const code = runLintQuick({
        cwd: '/proj',
        spawnSyncFn,
        log: noop,
        logError: noop,
        rulesDir: root
      })
      expect(code).toBe(0)
      // git diff called
      expect(calls[0]).toMatchObject({ cmd: 'git', args: ['diff', '--name-only', 'HEAD'] })
      // ga: no file args
      expect(calls[1].args).not.toContain('src/a.mjs')
      // lint-js: file args appended
      expect(calls[2].args).toContain('src/a.mjs')
      expect(calls[2].args).toContain('src/b.ts')
    } finally {
      cleanup()
    }
  })

  test('skips lintScoped steps when no changed files and lintAlways=false', () => {
    const { root, cleanup } = makeRulesDir({
      jslint: { lint: 'quick', lintCmd: 'n-cursor lint-js', lintScoped: true, lintAlways: false }
    })
    try {
      const { spawnSyncFn, calls } = makeSpawn([
        { status: 0, stdout: '' } // git diff → no files
      ])
      const code = runLintQuick({ cwd: '/proj', spawnSyncFn, log: noop, logError: noop, rulesDir: root })
      expect(code).toBe(0)
      expect(calls.length).toBe(1) // only git diff, lint-js skipped
    } finally {
      cleanup()
    }
  })

  test('does NOT skip scoped step when lintAlways=true', () => {
    const { root, cleanup } = makeRulesDir({
      ga: { lint: 'quick', lintCmd: 'n-cursor lint-ga', lintScoped: true, lintAlways: true }
    })
    try {
      const { spawnSyncFn, calls } = makeSpawn([
        { status: 0, stdout: '' }, // git diff → no files
        { status: 0 } // ga (runs anyway, no file args)
      ])
      runLintQuick({ cwd: '/proj', spawnSyncFn, log: noop, logError: noop, rulesDir: root })
      expect(calls.length).toBe(2)
    } finally {
      cleanup()
    }
  })

  test('fail-fast: stops on first non-zero exit', () => {
    const { root, cleanup } = makeRulesDir({
      ga: { lint: 'quick', lintCmd: 'n-cursor lint-ga' },
      text: { lint: 'quick', lintCmd: 'n-cursor lint-text' }
    })
    try {
      const { spawnSyncFn, calls } = makeSpawn([
        { status: 0, stdout: '' }, // git diff
        { status: 1 } // ga fails
      ])
      const code = runLintQuick({ cwd: '/proj', spawnSyncFn, log: noop, logError: noop, rulesDir: root })
      expect(code).toBe(1)
      expect(calls.length).toBe(2) // text not called
    } finally {
      cleanup()
    }
  })

  test('does NOT run lintCiCmd in quick mode', () => {
    const { root, cleanup } = makeRulesDir({
      jslint: {
        lint: 'quick',
        lintCmd: 'n-cursor lint-js',
        lintCiCmd: 'bunx jscpd .',
        lintScoped: true,
        lintAlways: true
      }
    })
    try {
      const { spawnSyncFn, calls } = makeSpawn([
        { status: 0, stdout: '' }, // git diff
        { status: 0 } // lint-js
      ])
      runLintQuick({ cwd: '/proj', spawnSyncFn, log: noop, logError: noop, rulesDir: root })
      // no call with 'jscpd' args
      expect(calls.some(c => c.args?.join(' ').includes('jscpd'))).toBe(false)
    } finally {
      cleanup()
    }
  })
})

describe('runLintAll', () => {
  test('runs all steps without scoping, then lintCiCmd', () => {
    const { root, cleanup } = makeRulesDir({
      ga: { lint: 'quick', lintCmd: 'n-cursor lint-ga' },
      jslint: { lint: 'quick', lintCmd: 'n-cursor lint-js', lintScoped: true, lintCiCmd: 'bunx jscpd .' }
    })
    try {
      const { spawnSyncFn, calls } = makeSpawn([
        { status: 0 }, // ga
        { status: 0 }, // lint-js (no file args)
        { status: 0 } // lintCiCmd: sh -c "bunx jscpd ."
      ])
      const code = runLintAll({ cwd: '/proj', spawnSyncFn, log: noop, logError: noop, rulesDir: root })
      expect(code).toBe(0)
      expect(calls.length).toBe(3)
      // lintCiCmd runs via sh -c
      expect(calls[2]).toMatchObject({ cmd: 'sh', args: ['-c', 'bunx jscpd .'] })
    } finally {
      cleanup()
    }
  })

  test('lint-js in all mode: no file args', () => {
    const { root, cleanup } = makeRulesDir({
      jslint: { lint: 'quick', lintCmd: 'n-cursor lint-js', lintScoped: true }
    })
    try {
      const { spawnSyncFn, calls } = makeSpawn([{ status: 0 }])
      runLintAll({ cwd: '/proj', spawnSyncFn, log: noop, logError: noop, rulesDir: root })
      // no src/*.mjs etc in args (no file args appended)
      const lintJsCall = calls[0]
      expect(lintJsCall.args.filter(a => a.endsWith('.mjs') || a.endsWith('.ts'))).toEqual([])
    } finally {
      cleanup()
    }
  })
})
```

- [ ] **Step 2: Run to confirm fail**

```bash
cd npm && npx vitest run scripts/lib/tests/run-lint-orchestrator.test.mjs 2>&1 | tail -5
```

Expected: FAIL (run-lint-orchestrator.mjs does not exist)

- [ ] **Step 3: Create run-lint-orchestrator.mjs**

Create `npm/scripts/lib/run-lint-orchestrator.mjs`:

```javascript
/**
 * Orchestrator for `n-cursor lint-quick` and `n-cursor lint-all`.
 *
 * Reads lint-step declarations from rules/*/meta.json (fields: lint, lintCmd,
 * lintScoped, lintAlways, lintCiCmd) and runs them sequentially — never in parallel.
 *
 * lint-quick: quick steps only; scoped steps receive changed files from git diff.
 * lint-all:   all steps (quick + ci), no file scoping; also runs each step's lintCiCmd.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync as defaultSpawnSync } from 'node:child_process'

/** Default location of the package's own rules directory. */
const DEFAULT_RULES_DIR = fileURLToPath(new URL('../../rules', import.meta.url))

/**
 * @typedef {{
 *   id: string,
 *   lint: 'quick' | 'ci',
 *   lintCmd: string,
 *   lintScoped: boolean,
 *   lintAlways: boolean,
 *   lintCiCmd?: string,
 * }} LintStep
 */

/**
 * Read all lint steps from rules directory. Sorted alphabetically by rule id.
 * @param {string} [rulesDir]
 * @returns {LintStep[]}
 */
export function readLintSteps(rulesDir = DEFAULT_RULES_DIR) {
  /** @type {LintStep[]} */
  const steps = []

  let entries
  try {
    entries = readdirSync(rulesDir, { withFileTypes: true })
  } catch {
    return steps
  }

  const sorted = entries.filter(e => e.isDirectory()).map(e => e.name).sort()

  for (const id of sorted) {
    const metaPath = join(rulesDir, id, 'meta.json')
    if (!existsSync(metaPath)) continue
    let meta
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf8'))
    } catch {
      continue
    }
    if (!meta.lint || !meta.lintCmd) continue
    steps.push({
      id,
      lint: meta.lint,
      lintCmd: meta.lintCmd,
      lintScoped: meta.lintScoped ?? false,
      lintAlways: meta.lintAlways ?? false,
      lintCiCmd: meta.lintCiCmd,
    })
  }
  return steps
}

/**
 * Get changed files via `git diff --name-only HEAD`.
 * Returns [] if no changes or not a git repo.
 * @param {string} cwd
 * @param {typeof defaultSpawnSync} spawnSyncFn
 * @returns {string[]}
 */
export function getChangedFiles(cwd, spawnSyncFn) {
  const r = spawnSyncFn('git', ['diff', '--name-only', 'HEAD'], { cwd, encoding: 'utf8' })
  if (r.status !== 0 || !r.stdout) return []
  return r.stdout.trim().split('\n').filter(Boolean)
}

/**
 * Parse a simple command string into [program, ...args].
 * Does not handle shell operators (&&, |); use sh -c for compound commands.
 * @param {string} cmd
 * @returns {string[]}
 */
export function parseSimpleCmd(cmd) {
  // Handle single-quoted args (e.g. stylelint '**/*.{css,vue}' --fix)
  const tokens = []
  let current = ''
  let inSingle = false
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]
    if (ch === "'" && !inSingle) { inSingle = true; continue }
    if (ch === "'" && inSingle)  { inSingle = false; continue }
    if (ch === ' ' && !inSingle) {
      if (current.length > 0) { tokens.push(current); current = '' }
      continue
    }
    current += ch
  }
  if (current.length > 0) tokens.push(current)
  return tokens
}

/**
 * @typedef {{
 *   cwd?: string,
 *   rulesDir?: string,
 *   spawnSyncFn?: typeof defaultSpawnSync,
 *   log?: (text: string) => void,
 *   logError?: (text: string) => void,
 * }} OrchestratorOptions
 */

function runStep(cmdStr, extraArgs, cwd, spawnSyncFn, log) {
  const [prog, ...base] = parseSimpleCmd(cmdStr)
  const allArgs = [...base, ...extraArgs]
  log(`▶ ${[prog, ...allArgs].join(' ')}\n`)
  const r = spawnSyncFn(prog, allArgs, { stdio: 'inherit', cwd })
  return typeof r.status === 'number' ? r.status : 1
}

/**
 * n-cursor lint-quick: quick steps only, scoped to changed files.
 * Strictly sequential — never parallel.
 * @param {OrchestratorOptions} [options]
 * @returns {number} exit code
 */
export function runLintQuick(options = {}) {
  const cwd = options.cwd ?? process.cwd()
  const spawnSyncFn = options.spawnSyncFn ?? defaultSpawnSync
  const log = options.log ?? (t => process.stdout.write(t))
  const logError = options.logError ?? (t => process.stderr.write(t))
  const steps = readLintSteps(options.rulesDir).filter(s => s.lint === 'quick')

  if (steps.length === 0) {
    log('ℹ️  lint-quick: немає quick lint-кроків\n')
    return 0
  }

  const changedFiles = getChangedFiles(cwd, spawnSyncFn)

  for (const step of steps) {
    let fileArgs = []
    if (step.lintScoped) {
      if (changedFiles.length === 0 && !step.lintAlways) {
        log(`⏭  ${step.id}: немає змінених файлів — пропускаємо\n`)
        continue
      }
      fileArgs = changedFiles.length > 0 ? changedFiles : []
    }

    const code = runStep(step.lintCmd, fileArgs, cwd, spawnSyncFn, log)
    if (code !== 0) {
      logError(`❌ ${step.id} завершився з кодом ${code}\n`)
      return code
    }
    log(`✅ ${step.id}\n`)
  }
  return 0
}

/**
 * n-cursor lint-all: all steps (quick + ci), not scoped, with lintCiCmd.
 * Strictly sequential — never parallel.
 * @param {OrchestratorOptions} [options]
 * @returns {number} exit code
 */
export function runLintAll(options = {}) {
  const cwd = options.cwd ?? process.cwd()
  const spawnSyncFn = options.spawnSyncFn ?? defaultSpawnSync
  const log = options.log ?? (t => process.stdout.write(t))
  const logError = options.logError ?? (t => process.stderr.write(t))
  const steps = readLintSteps(options.rulesDir)

  if (steps.length === 0) {
    log('ℹ️  lint-all: немає lint-кроків\n')
    return 0
  }

  for (const step of steps) {
    const code = runStep(step.lintCmd, [], cwd, spawnSyncFn, log)
    if (code !== 0) {
      logError(`❌ ${step.id} (lintCmd) завершився з кодом ${code}\n`)
      return code
    }

    if (step.lintCiCmd) {
      log(`▶ ${step.lintCiCmd} (ci-only)\n`)
      const ci = spawnSyncFn('sh', ['-c', step.lintCiCmd], { stdio: 'inherit', cwd })
      const ciCode = typeof ci.status === 'number' ? ci.status : 1
      if (ciCode !== 0) {
        logError(`❌ ${step.id} (lintCiCmd) завершився з кодом ${ciCode}\n`)
        return ciCode
      }
    }
    log(`✅ ${step.id}\n`)
  }
  return 0
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
cd npm && npx vitest run scripts/lib/tests/run-lint-orchestrator.test.mjs 2>&1 | tail -5
```

Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add npm/scripts/lib/run-lint-orchestrator.mjs npm/scripts/lib/tests/run-lint-orchestrator.test.mjs
git commit -m "feat(orchestrator): runLintQuick + runLintAll via meta.json lint-кроків"
```

---

## Task 7: Add CLI commands `lint-quick`, `lint-all`, `lint-js` to n-cursor.js

**Files:**

- Modify: `npm/bin/n-cursor.js`

- [ ] **Step 1: Add imports**

In `npm/bin/n-cursor.js`, find the block with existing lint imports (around line 108):

```javascript
import { runLintCli } from '../scripts/lib/run-lint-cli.mjs'
```

Add after it:

```javascript
import { runLintQuick, runLintAll } from '../scripts/lib/run-lint-orchestrator.mjs'
import { runLintJs } from '../rules/js-lint/lint/lint-js.mjs'
```

- [ ] **Step 2: Add cases in the switch statement**

Find `case 'lint':` (around line 1466) and add the new cases BEFORE it:

```javascript
    case 'lint-quick': {
      // Швидкий lint-прогін: quick-кроки з meta.json, scoped до змінених файлів.
      // Суворо послідовно — не ділити на паралельні субагенти.
      process.exitCode = runLintQuick()
      break
    }
    case 'lint-all': {
      // Повний lint-прогін: всі кроки з meta.json + lintCiCmd, весь репо.
      // Суворо послідовно — не ділити на паралельні субагенти.
      process.exitCode = runLintAll()
      break
    }
    case 'lint-js': {
      // Wrapper: n-cursor lint-js [files...] — oxlint+eslint на переданих файлах або '.'.
      // Викликається оркестратором lint-quick (scoped) і lint-all (full).
      const files = args.filter(a => !a.startsWith('-'))
      process.exitCode = runLintJs(files)
      break
    }
```

- [ ] **Step 3: Update the CLI help text**

Find the help text string (around line 1543) that lists expected commands:

```javascript
;`   Очікується: (без аргументів) синхронізація правил, check, rename-yaml-extensions, post-tool-use-fix, lint, lint-ga, lint-rego, lint-k8s, lint-docker, lint-text, coverage, change, release, skill, worktree`
```

Update to include new commands:

```javascript
;`   Очікується: (без аргументів) синхронізація правил, check, rename-yaml-extensions, post-tool-use-fix, lint, lint-quick, lint-all, lint-js, lint-ga, lint-rego, lint-k8s, lint-docker, lint-text, coverage, change, release, skill, worktree`
```

- [ ] **Step 4: Update the top JSDoc comment**

Find the block starting with `*   \`npx \@nitra/cursor lint\`` and add after the existing lint-text line:

```javascript
 *   `npx \@nitra/cursor lint-quick` — швидкий lint-прогін: quick-кроки з meta.json, scoped до змінених файлів (git diff).
 *   `npx \@nitra/cursor lint-all`   — повний lint-прогін: всі кроки з meta.json + lintCiCmd, весь репо.
 *   `npx \@nitra/cursor lint-js [files...]` — wrapper: oxlint+eslint на переданих файлах або '.'.
```

- [ ] **Step 5: Smoke-test CLI commands exist (dry run)**

```bash
cd /Users/vitaliytv/www/nitra/cursor && node npm/bin/n-cursor.js lint-quick --help 2>&1 | head -3 || true
node npm/bin/n-cursor.js lint-all --help 2>&1 | head -3 || true
node npm/bin/n-cursor.js lint-js --help 2>&1 | head -3 || true
```

Expected: no "unknown command" errors (commands are recognized, even if they produce output)

- [ ] **Step 6: Commit**

```bash
git add npm/bin/n-cursor.js
git commit -m "feat(cli): додати lint-quick, lint-all, lint-js команди до n-cursor"
```

---

## Task 8: Add `lint-quick` and `lint-all` to root `package.json`

**Files:**

- Modify: `package.json` (root, `/Users/vitaliytv/www/nitra/cursor/package.json`)

- [ ] **Step 1: Add scripts**

In the root `package.json`, find the `"scripts"` section. Add `"lint-quick"` and `"lint-all"` scripts alongside existing `"lint"`:

Before:

```json
"lint": "bun run lint-ga && bun run lint-js && ...",
```

After (add the two new lines; do NOT remove or change existing `lint` script):

```json
"lint-quick": "n-cursor lint-quick",
"lint-all": "n-cursor lint-all",
"lint": "bun run lint-ga && bun run lint-js && bun run lint-rego && bun run lint-security && bun run lint-style && bun run lint-text && oxfmt .",
```

- [ ] **Step 2: Verify scripts are present**

```bash
node -e "const s=require('./package.json').scripts; ['lint-quick','lint-all'].forEach(k=>console.log(k,'=',s[k]))"
```

Expected:

```
lint-quick = n-cursor lint-quick
lint-all = n-cursor lint-all
```

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat(scripts): додати lint-quick і lint-all до кореневого package.json"
```

---

## Task 9: Update `n-js-lint` rule

**Files:**

- Modify: `npm/rules/js-lint/js-lint.mdc`

- [ ] **Step 1: Update js-lint.mdc**

In `npm/rules/js-lint/js-lint.mdc`, find the section that shows the canonical `package.json` snippet with `lint-js` script. Add a reference to the new orchestrator:

Find the existing snippet showing `"lint-js": "bunx oxlint --fix && ..."` and add a note after:

````markdown
### Нові lint-оркестратор скрипти

Починаючи з `@nitra/cursor ^1.40.0`, для розробки використовується `lint-quick`/`lint-all` замість прямого `lint-js`:

```json
{
  "scripts": {
    "lint-quick": "n-cursor lint-quick",
    "lint-all": "n-cursor lint-all"
  }
}
```
````

- `lint-quick` — передає змінені файли (git diff) в oxlint+eslint; пропускає jscpd/knip.
- `lint-all` — повний прогін включно з jscpd і knip.
- Існуючий `lint-js` лишається для зворотної сумісності.

````

- [ ] **Step 2: Commit**

```bash
git add npm/rules/js-lint/js-lint.mdc
git commit -m "docs(js-lint): посилання на lint-quick/lint-all в js-lint.mdc"
````

---

## Task 10: Regression + change file

**Files:**

- Run: `npm/` test suite
- Run: `n-cursor lint-quick` dry verify
- Create: change file via `n-cursor change`

- [ ] **Step 1: Run full test suite**

```bash
cd npm && npx vitest run 2>&1 | tail -8
```

Expected: all tests pass (new + existing), 0 failures.

- [ ] **Step 2: Smoke-test lint-quick in project root**

```bash
cd /Users/vitaliytv/www/nitra/cursor && node npm/bin/n-cursor.js lint-quick 2>&1 | head -20
```

Expected: runs lint steps for changed files (or logs "немає змінених файлів" for scoped steps), exits 0.

- [ ] **Step 3: Smoke-test lint-all --dry-run (capture step list without running tools)**

```javascript
// Verify orchestrator reads correct steps from real rules dir
node --input-type=module <<'EOF'
import { readLintSteps } from './npm/scripts/lib/run-lint-orchestrator.mjs'
const steps = readLintSteps()
console.log('Steps:', steps.map(s => `${s.id}(${s.lint})`).join(', '))
EOF
```

```bash
cd /Users/vitaliytv/www/nitra/cursor && node --input-type=module <<'EOF'
import { readLintSteps } from './npm/scripts/lib/run-lint-orchestrator.mjs'
const steps = readLintSteps()
console.log('Steps:', steps.map(s => `${s.id}(${s.lint}${s.lintScoped ? ',scoped' : ''})`).join(', '))
EOF
```

Expected: lists `ga(quick)`, `js-lint(quick,scoped)`, `lint(quick)` (if check-lint is in lint), `oxfmt(quick,scoped)`, `rego(quick)`, `style-lint(quick,scoped)`, `text(quick)` (alphabetical).

> Note: `lint` rule has no `lintCmd` so it won't appear. Only rules with both `lint` AND `lintCmd` fields are included.

- [ ] **Step 4: Create change file**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && node ../npm/bin/n-cursor.js change --bump minor --section Added \
  --message "n-cursor lint-quick і lint-all — оркестратори lint-кроків через meta.json (lintCmd, lintScoped, lintCiCmd)"
```

- [ ] **Step 5: Final commit**

```bash
cd /Users/vitaliytv/www/nitra/cursor
git add npm/.changes/
git commit -m "chore: change-файл для lint-quick/lint-all feature (minor)"
```
