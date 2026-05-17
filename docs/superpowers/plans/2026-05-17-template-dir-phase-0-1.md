# Template Directory for npm/rules — Phase 0 + 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `template/` infrastructure (loader + check utilities + conftest data integration + MDC-refs check) and validate it end-to-end on the `security` rule as pilot.

**Architecture:** New `template.mjs` util loads `<target>.snippet.<ext>` / `<target>.deny.<ext>` / `<target>.contains.<ext>` (or `<target>` for text-only) from a concern's `template/` dir, parses each in its native format. `runConftestBatch` gains optional `templateData` that goes to `conftest --data <tmpfile>`. JS-checks and Rego policies share one source of truth per concern. Pilot: rewrite `security/fix/gitleaks/check.mjs` and `security/policy/package_json/package_json.rego` to read canon from `template/` instead of hardcoded literals.

**Tech Stack:** Node 24, Bun ≥ 1.3, conftest (Rego v1), smol-toml for TOML parsing, yaml (built into Bun) for YAML. Existing test runner: `bun test`.

**Spec:** [docs/superpowers/specs/2026-05-17-template-dir-design.md](../specs/2026-05-17-template-dir-design.md).

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `npm/scripts/utils/template.mjs` | `loadTemplate(concernDir)` + `checkSnippet/Deny/Contains` + `checkTextSubset` |
| `npm/scripts/utils/template.test.mjs` | Unit tests for template loader and check fns |
| `npm/scripts/utils/__fixtures__/template/<scenario>/` | Fixture trees for template tests |
| `npm/scripts/utils/check-mdc-template-refs.mjs` | Central check: every `template/<file>` referenced from rule's `<id>.mdc` |
| `npm/scripts/utils/check-mdc-template-refs.test.mjs` | Unit tests |
| `npm/rules/security/policy/package_json/template/package.json.snippet.json` | Required scripts (lint-security) |
| `npm/rules/security/policy/package_json/template/package.json.deny.json` | Forbidden gitleaks in deps |
| `npm/rules/security/policy/package_json/template/package.json.contains.json` | `lint` must contain `bun run lint-security` |
| `npm/rules/security/fix/gitleaks/template/.gitleaks.toml.snippet.toml` | Full canon for `.gitleaks.toml` |
| `docs/adr/template-dir-concern-inventory.md` | Phase 0 deliverable — classification of all concerns |

### Modified files

| Path | Change |
|---|---|
| `npm/package.json` | Add `smol-toml` to `dependencies` |
| `npm/scripts/utils/run-conftest-batch.mjs` | Accept optional `templateData`, write to tmpfile, pass `--data` |
| `npm/scripts/utils/run-conftest-batch.test.mjs` | Cover new templateData path |
| `npm/rules/security/policy/package_json/package_json.rego` | Read canon from `data.template.*` |
| `npm/rules/security/policy/package_json/package_json_test.rego` | Mock `data.template.*` via `with` |
| `npm/rules/security/fix/gitleaks/check.mjs` | Call `loadTemplate` + `checkSnippet` instead of hardcoded regex |
| `npm/rules/security/fix/gitleaks/check.test.mjs` | Adapt to new `check({ template })` signature |
| `npm/rules/security/security.mdc` | Replace inline canon blocks with markdown links to `template/` |
| `npm/CHANGELOG.md` | Entry for new template infrastructure + security pilot |
| `npm/package.json` (version) | Bump (per `npm/CLAUDE.md`) |

---

## Tasks

### Task 1: Add smol-toml dependency

**Files:**
- Modify: `npm/package.json` (`dependencies` section)

- [ ] **Step 1: Add smol-toml**

Run: `cd npm && bun add smol-toml`
Expected: `npm/package.json` `dependencies` now contains `"smol-toml": "^1.x.x"`; `bun.lock` updated.

- [ ] **Step 2: Verify it imports**

Run: `cd npm && bun -e 'import { parse } from "smol-toml"; console.log(parse("foo = 1"))'`
Expected: `{ foo: 1 }` printed.

- [ ] **Step 3: Commit**

```bash
git add npm/package.json bun.lock
git commit -m "deps(npm): add smol-toml for template TOML parsing"
```

---

### Task 2: Concern inventory (Phase 0 deliverable)

**Files:**
- Create: `docs/adr/template-dir-concern-inventory.md`

- [ ] **Step 1: Enumerate every concern**

Run:
```bash
find npm/rules -name target.json | while read f; do
  rule=$(echo "$f" | cut -d/ -f3)
  kind=$(echo "$f" | cut -d/ -f4)
  concern=$(echo "$f" | cut -d/ -f5)
  files=$(jq -c .files "$f")
  echo "$rule|$kind|$concern|$files"
done | sort | column -t -s '|'
```
Save output for the next step.

- [ ] **Step 2: Write inventory ADR**

Create `docs/adr/template-dir-concern-inventory.md` (one ADR-style doc, не draft). Header: `**Status: Accepted**`, `**Date:** 2026-05-17`. Body — table with columns: `rule | kind | concern | target | category | template-files-planned`. Categories from spec: `fragment`, `full-canon`, `partial`, `non-eligible`. For each concern, classify according to the spec definition and what its current check does. Reference: [spec section "Класифікація концернів"](../superpowers/specs/2026-05-17-template-dir-design.md#класифікація-концернів).

- [ ] **Step 3: Commit**

```bash
git add docs/adr/template-dir-concern-inventory.md
git commit -m "docs(adr): concern inventory for template-dir migration (Phase 0)"
```

---

### Task 3: template.mjs — `loadTemplate` (TDD)

**Files:**
- Create: `npm/scripts/utils/template.mjs`
- Create: `npm/scripts/utils/template.test.mjs`
- Create: `npm/scripts/utils/__fixtures__/template/security-pkgjson/policy/package_json/template/package.json.snippet.json`
- Create: `npm/scripts/utils/__fixtures__/template/security-pkgjson/policy/package_json/template/package.json.deny.json`
- Create: `npm/scripts/utils/__fixtures__/template/security-pkgjson/policy/package_json/template/package.json.contains.json`
- Create: `npm/scripts/utils/__fixtures__/template/empty-concern/policy/empty/.gitkeep`

- [ ] **Step 1: Create fixture files**

`npm/scripts/utils/__fixtures__/template/security-pkgjson/policy/package_json/template/package.json.snippet.json`:
```json
{ "scripts": { "lint-security": "gitleaks detect --no-banner" } }
```

`npm/scripts/utils/__fixtures__/template/security-pkgjson/policy/package_json/template/package.json.deny.json`:
```json
{
  "dependencies": { "gitleaks": "глобальний CLI — не додавай у dependencies" },
  "devDependencies": { "gitleaks": "глобальний CLI — не додавай у devDependencies" }
}
```

`npm/scripts/utils/__fixtures__/template/security-pkgjson/policy/package_json/template/package.json.contains.json`:
```json
{ "scripts": { "lint": ["bun run lint-security"] } }
```

`npm/scripts/utils/__fixtures__/template/empty-concern/policy/empty/.gitkeep`: empty file (touch).

- [ ] **Step 2: Write failing test for loadTemplate**

Create `npm/scripts/utils/template.test.mjs`:
```js
import { describe, expect, test } from 'bun:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadTemplate } from './template.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, '__fixtures__', 'template')

describe('loadTemplate', () => {
  test('reads snippet/deny/contains from policy/<concern>/template/ for package.json target', async () => {
    const concernDir = join(FIXTURES, 'security-pkgjson', 'policy', 'package_json')
    const tpl = await loadTemplate(concernDir)
    expect(tpl).toEqual({
      'package.json': {
        snippet: { scripts: { 'lint-security': 'gitleaks detect --no-banner' } },
        deny: {
          dependencies: { gitleaks: 'глобальний CLI — не додавай у dependencies' },
          devDependencies: { gitleaks: 'глобальний CLI — не додавай у devDependencies' }
        },
        contains: { scripts: { lint: ['bun run lint-security'] } }
      }
    })
  })

  test('returns empty object when template/ missing', async () => {
    const concernDir = join(FIXTURES, 'empty-concern', 'policy', 'empty')
    const tpl = await loadTemplate(concernDir)
    expect(tpl).toEqual({})
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd npm && bun test scripts/utils/template.test.mjs`
Expected: FAIL with "Cannot find module './template.mjs'" or similar.

- [ ] **Step 4: Implement loadTemplate (minimum to pass)**

Create `npm/scripts/utils/template.mjs`:
```js
/**
 * Reads template/ for a concern directory and returns a merged structure indexed
 * by target basename. For each <target>, returns whichever of snippet/deny/contains
 * exist (parsed in native format by extension).
 *
 * @param {string} concernDir absolute path to fix/<concern>/ or policy/<concern>/
 * @returns {Promise<Record<string, { snippet?: any, deny?: any, contains?: any }>>}
 */
import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

import { parse as parseToml } from 'smol-toml'

const SLOTS = ['snippet', 'deny', 'contains']

/** Parse file contents by extension; returns JS object for structured formats, string for text. */
async function parseByExt(path) {
  const raw = await readFile(path, 'utf8')
  const ext = extname(path).toLowerCase()
  if (ext === '.json' || ext === '.jsonc') return JSON.parse(stripJsonComments(raw))
  if (ext === '.toml') return parseToml(raw)
  if (ext === '.yml' || ext === '.yaml') {
    const { parse: parseYaml } = await import('yaml')
    return parseYaml(raw)
  }
  return raw // text-only
}

function stripJsonComments(s) {
  // Minimal: strip // line comments and /* */ block comments. JSON-with-comments format.
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

async function walk(dir, base = dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full, base)))
    else out.push(relative(base, full))
  }
  return out
}

/**
 * Parse "<target>.<slot>.<ext>" or "<target>" (text-only).
 * Returns { target, slot } where slot is one of snippet|deny|contains|null (null = text-only target).
 */
function classifyTemplateFile(relPath) {
  // Try ".<slot>." suffix detection
  for (const slot of SLOTS) {
    const m = relPath.match(new RegExp(`^(?<target>.+)\\.${slot}\\.[^.]+$`))
    if (m?.groups?.target) return { target: m.groups.target, slot }
  }
  // No slot suffix → text-only canon for the literal target name
  return { target: relPath, slot: null }
}

export async function loadTemplate(concernDir) {
  const tplDir = join(concernDir, 'template')
  if (!existsSync(tplDir)) return {}
  if (!(await stat(tplDir)).isDirectory()) return {}
  const files = await walk(tplDir)
  const result = {}
  for (const rel of files) {
    const { target, slot } = classifyTemplateFile(rel)
    if (!result[target]) result[target] = {}
    const value = await parseByExt(join(tplDir, rel))
    if (slot === null) result[target].snippet = value // text-only treated as snippet
    else result[target][slot] = value
  }
  return result
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd npm && bun test scripts/utils/template.test.mjs`
Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add npm/scripts/utils/template.mjs npm/scripts/utils/template.test.mjs npm/scripts/utils/__fixtures__/template/
git commit -m "feat(npm): loadTemplate util reads <target>.<slot>.<ext> from concern template/"
```

---

### Task 4: template.mjs — `checkSnippet` (TDD)

**Files:**
- Modify: `npm/scripts/utils/template.mjs` (add export)
- Modify: `npm/scripts/utils/template.test.mjs` (add tests)

- [ ] **Step 1: Add failing tests for checkSnippet**

Append to `npm/scripts/utils/template.test.mjs`:
```js
import { checkSnippet } from './template.mjs'

describe('checkSnippet', () => {
  const opts = { targetPath: 'package.json', source: 'security.mdc' }

  test('returns empty for exact match on leaves', () => {
    const actual = { scripts: { 'lint-security': 'gitleaks detect --no-banner' } }
    const snippet = { scripts: { 'lint-security': 'gitleaks detect --no-banner' } }
    expect(checkSnippet(actual, snippet, opts)).toEqual([])
  })

  test('reports missing leaf with path and expected value', () => {
    const actual = { scripts: {} }
    const snippet = { scripts: { 'lint-security': 'gitleaks detect --no-banner' } }
    expect(checkSnippet(actual, snippet, opts)).toEqual([
      'package.json: scripts."lint-security" має бути "gitleaks detect --no-banner" (security.mdc)'
    ])
  })

  test('reports mismatched leaf value', () => {
    const actual = { scripts: { 'lint-security': 'gitleaks detect' } }
    const snippet = { scripts: { 'lint-security': 'gitleaks detect --no-banner' } }
    expect(checkSnippet(actual, snippet, opts)).toEqual([
      'package.json: scripts."lint-security" має бути "gitleaks detect --no-banner" (security.mdc)'
    ])
  })

  test('arrays are subset-of: pass when all snippet elements present in actual', () => {
    const actual = { recommendations: ['a', 'b', 'c'] }
    const snippet = { recommendations: ['a', 'b'] }
    expect(checkSnippet(actual, snippet, opts)).toEqual([])
  })

  test('arrays are subset-of: fail when snippet element missing', () => {
    const actual = { recommendations: ['a'] }
    const snippet = { recommendations: ['a', 'b'] }
    expect(checkSnippet(actual, snippet, opts)).toEqual([
      'package.json: recommendations має містити "b" (security.mdc)'
    ])
  })

  test('returns empty for null snippet (no template provided)', () => {
    expect(checkSnippet({}, null, opts)).toEqual([])
    expect(checkSnippet({}, undefined, opts)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd npm && bun test scripts/utils/template.test.mjs`
Expected: 6 new tests fail with "checkSnippet is not a function".

- [ ] **Step 3: Implement checkSnippet**

Append to `npm/scripts/utils/template.mjs`:
```js
function formatPath(parts) {
  return parts
    .map(p => (typeof p === 'number' ? `[${p}]` : /^[a-zA-Z_$][\w$]*$/.test(p) ? p : JSON.stringify(p)))
    .reduce((acc, p) => (acc === '' ? p : p.startsWith('[') ? acc + p : acc + '.' + p), '')
}

function quote(v) {
  return typeof v === 'string' ? JSON.stringify(v) : String(v)
}

/**
 * Deep subset-of check. Every leaf in `snippet` must equal same path in `actual`.
 * Arrays in snippet: every element must be present in actual array.
 * Returns array of violation messages.
 */
export function checkSnippet(actual, snippet, opts, path = []) {
  if (snippet == null) return []
  const { targetPath, source } = opts
  const violations = []
  if (Array.isArray(snippet)) {
    if (!Array.isArray(actual)) {
      violations.push(`${targetPath}: ${formatPath(path)} має бути масивом (${source})`)
      return violations
    }
    for (const needle of snippet) {
      const found = actual.some(a => JSON.stringify(a) === JSON.stringify(needle))
      if (!found) {
        violations.push(`${targetPath}: ${formatPath(path)} має містити ${quote(needle)} (${source})`)
      }
    }
    return violations
  }
  if (snippet !== null && typeof snippet === 'object') {
    if (actual == null || typeof actual !== 'object' || Array.isArray(actual)) {
      violations.push(`${targetPath}: ${formatPath(path)} має бути об'єктом (${source})`)
      return violations
    }
    for (const [k, v] of Object.entries(snippet)) {
      violations.push(...checkSnippet(actual[k], v, opts, [...path, k]))
    }
    return violations
  }
  // Leaf (string/number/boolean)
  if (actual !== snippet) {
    violations.push(`${targetPath}: ${formatPath(path)} має бути ${quote(snippet)} (${source})`)
  }
  return violations
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd npm && bun test scripts/utils/template.test.mjs`
Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add npm/scripts/utils/template.mjs npm/scripts/utils/template.test.mjs
git commit -m "feat(npm): template.checkSnippet (subset-of for objects, contains for arrays)"
```

---

### Task 5: template.mjs — `checkDeny` (TDD)

**Files:**
- Modify: `npm/scripts/utils/template.mjs`
- Modify: `npm/scripts/utils/template.test.mjs`

- [ ] **Step 1: Add failing tests**

Append to `npm/scripts/utils/template.test.mjs`:
```js
import { checkDeny } from './template.mjs'

describe('checkDeny', () => {
  const opts = { targetPath: 'package.json', source: 'security.mdc' }

  test('returns empty when no forbidden path is present', () => {
    const actual = { dependencies: { lodash: '^4' } }
    const deny = { dependencies: { gitleaks: 'CLI — не додавай' } }
    expect(checkDeny(actual, deny, opts)).toEqual([])
  })

  test('reports forbidden path with reason from deny value', () => {
    const actual = { dependencies: { gitleaks: '^8.0.0', lodash: '^4' } }
    const deny = { dependencies: { gitleaks: 'CLI — не додавай у dependencies' } }
    expect(checkDeny(actual, deny, opts)).toEqual([
      'package.json: dependencies.gitleaks — CLI — не додавай у dependencies (security.mdc)'
    ])
  })

  test('handles deeply nested forbidden paths', () => {
    const actual = { a: { b: { c: 1 } } }
    const deny = { a: { b: { c: 'кореневий c заборонений' } } }
    expect(checkDeny(actual, deny, opts)).toEqual([
      'package.json: a.b.c — кореневий c заборонений (security.mdc)'
    ])
  })

  test('returns empty for null deny', () => {
    expect(checkDeny({}, null, opts)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests, see them fail**

Run: `cd npm && bun test scripts/utils/template.test.mjs`
Expected: 4 new tests fail with "checkDeny is not a function".

- [ ] **Step 3: Implement checkDeny**

Append to `npm/scripts/utils/template.mjs`:
```js
/**
 * Walks deny tree; for any leaf path that exists in actual, returns violation
 * with the deny's leaf string as reason.
 */
export function checkDeny(actual, deny, opts, path = []) {
  if (deny == null) return []
  const { targetPath, source } = opts
  if (deny !== null && typeof deny === 'object' && !Array.isArray(deny)) {
    const out = []
    for (const [k, v] of Object.entries(deny)) {
      const childActual = actual && typeof actual === 'object' ? actual[k] : undefined
      out.push(...checkDeny(childActual, v, opts, [...path, k]))
    }
    return out
  }
  // Leaf reached — if actual has this path at all (any value), it's a violation
  if (actual !== undefined) {
    const reason = typeof deny === 'string' ? deny : 'заборонено'
    return [`${targetPath}: ${formatPath(path)} — ${reason} (${source})`]
  }
  return []
}
```

- [ ] **Step 4: Run tests, see them pass**

Run: `cd npm && bun test scripts/utils/template.test.mjs`
Expected: all 12 tests pass.

- [ ] **Step 5: Commit**

```bash
git add npm/scripts/utils/template.mjs npm/scripts/utils/template.test.mjs
git commit -m "feat(npm): template.checkDeny (path-presence fails with template-provided reason)"
```

---

### Task 6: template.mjs — `checkContains` (TDD)

**Files:**
- Modify: `npm/scripts/utils/template.mjs`
- Modify: `npm/scripts/utils/template.test.mjs`

- [ ] **Step 1: Add failing tests**

Append to `npm/scripts/utils/template.test.mjs`:
```js
import { checkContains } from './template.mjs'

describe('checkContains', () => {
  const opts = { targetPath: 'package.json', source: 'security.mdc' }

  test('returns empty when leaf string contains every required substring', () => {
    const actual = { scripts: { lint: 'bun run lint-text && bun run lint-security && oxfmt .' } }
    const contains = { scripts: { lint: ['bun run lint-security'] } }
    expect(checkContains(actual, contains, opts)).toEqual([])
  })

  test('reports missing substring', () => {
    const actual = { scripts: { lint: 'bun run lint-text && oxfmt .' } }
    const contains = { scripts: { lint: ['bun run lint-security'] } }
    expect(checkContains(actual, contains, opts)).toEqual([
      'package.json: scripts.lint має містити "bun run lint-security" (security.mdc)'
    ])
  })

  test('multiple substrings — reports each missing one', () => {
    const actual = { scripts: { lint: 'bun run lint-text' } }
    const contains = { scripts: { lint: ['bun run lint-security', 'oxfmt .'] } }
    expect(checkContains(actual, contains, opts).sort()).toEqual([
      'package.json: scripts.lint має містити "bun run lint-security" (security.mdc)',
      'package.json: scripts.lint має містити "oxfmt ." (security.mdc)'
    ].sort())
  })

  test('returns empty when actual leaf missing entirely (cannot check substring of nothing)', () => {
    const actual = { scripts: {} }
    const contains = { scripts: { lint: ['bun run lint-security'] } }
    expect(checkContains(actual, contains, opts)).toEqual([
      'package.json: scripts.lint має містити "bun run lint-security" (security.mdc)'
    ])
  })

  test('returns empty for null contains', () => {
    expect(checkContains({}, null, opts)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests, see them fail**

Run: `cd npm && bun test scripts/utils/template.test.mjs`
Expected: 5 new tests fail with "checkContains is not a function".

- [ ] **Step 3: Implement checkContains**

Append to `npm/scripts/utils/template.mjs`:
```js
/**
 * For each leaf path that has an array of strings in `contains`, every string
 * must appear as substring in the same path of `actual` (string leaf).
 */
export function checkContains(actual, contains, opts, path = []) {
  if (contains == null) return []
  const { targetPath, source } = opts
  if (Array.isArray(contains)) {
    const out = []
    const haystack = typeof actual === 'string' ? actual : ''
    for (const needle of contains) {
      if (!haystack.includes(needle)) {
        out.push(`${targetPath}: ${formatPath(path)} має містити ${quote(needle)} (${source})`)
      }
    }
    return out
  }
  if (contains !== null && typeof contains === 'object') {
    const out = []
    for (const [k, v] of Object.entries(contains)) {
      const childActual = actual && typeof actual === 'object' ? actual[k] : undefined
      out.push(...checkContains(childActual, v, opts, [...path, k]))
    }
    return out
  }
  return []
}
```

- [ ] **Step 4: Run tests, see them pass**

Run: `cd npm && bun test scripts/utils/template.test.mjs`
Expected: all 17 tests pass.

- [ ] **Step 5: Commit**

```bash
git add npm/scripts/utils/template.mjs npm/scripts/utils/template.test.mjs
git commit -m "feat(npm): template.checkContains (substring presence in string leaves)"
```

---

### Task 7: template.mjs — `checkTextSubset` for text-only targets (TDD)

**Files:**
- Modify: `npm/scripts/utils/template.mjs`
- Modify: `npm/scripts/utils/template.test.mjs`

- [ ] **Step 1: Add failing tests**

Append to `npm/scripts/utils/template.test.mjs`:
```js
import { checkTextSubset } from './template.mjs'

describe('checkTextSubset', () => {
  const opts = { targetPath: '.stylelintignore', source: 'style-lint.mdc' }

  test('returns empty when actual contains every template line', () => {
    const actual = 'dist/\nnode_modules/\n'
    const template = 'dist/\n'
    expect(checkTextSubset(actual, template, opts)).toEqual([])
  })

  test('reports missing line', () => {
    const actual = 'node_modules/\n'
    const template = 'dist/\n'
    expect(checkTextSubset(actual, template, opts)).toEqual([
      '.stylelintignore: відсутній рядок "dist/" (style-lint.mdc)'
    ])
  })

  test('ignores empty lines and comments (# prefix)', () => {
    const actual = 'dist/\n'
    const template = '# comment\n\ndist/\n'
    expect(checkTextSubset(actual, template, opts)).toEqual([])
  })

  test('returns empty for null template', () => {
    expect(checkTextSubset('anything', null, opts)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests, see them fail**

Run: `cd npm && bun test scripts/utils/template.test.mjs`
Expected: 4 new tests fail with "checkTextSubset is not a function".

- [ ] **Step 3: Implement checkTextSubset**

Append to `npm/scripts/utils/template.mjs`:
```js
/**
 * For text-only targets (e.g. .stylelintignore): every non-empty, non-comment
 * line in `template` must appear (trimmed) in `actual`.
 */
export function checkTextSubset(actual, template, opts) {
  if (template == null) return []
  const { targetPath, source } = opts
  const actualLines = new Set(String(actual ?? '').split(/\r?\n/).map(l => l.trim()))
  const out = []
  for (const raw of String(template).split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    if (!actualLines.has(line)) {
      out.push(`${targetPath}: відсутній рядок ${quote(line)} (${source})`)
    }
  }
  return out
}
```

- [ ] **Step 4: Run tests, see them pass**

Run: `cd npm && bun test scripts/utils/template.test.mjs`
Expected: all 21 tests pass.

- [ ] **Step 5: Commit**

```bash
git add npm/scripts/utils/template.mjs npm/scripts/utils/template.test.mjs
git commit -m "feat(npm): template.checkTextSubset for text-only targets"
```

---

### Task 8: `run-conftest-batch.mjs` — add `templateData` (TDD)

**Files:**
- Modify: `npm/scripts/utils/run-conftest-batch.mjs`
- Modify: `npm/scripts/utils/run-conftest-batch.test.mjs`

This task extracts pure args-building into a testable helper, then uses it in `runConftestBatch`. TDD on the pure helper; integration covered by Task 15 smoke.

- [ ] **Step 1: Add failing test for `buildConftestArgs` helper**

Append to `npm/scripts/utils/run-conftest-batch.test.mjs`:
```js
import { describe, expect, test } from 'bun:test'

import { buildConftestArgs } from './run-conftest-batch.mjs'

describe('buildConftestArgs', () => {
  test('emits base args without --data when templateData missing', () => {
    const args = buildConftestArgs({
      policyAbs: '/p',
      namespace: 'demo.demo',
      files: ['/a.json'],
      extraArgs: [],
      tmpDataFile: null
    })
    expect(args).toEqual([
      'test',
      '--policy', '/p',
      '--namespace', 'demo.demo',
      '/a.json'
    ])
  })

  test('inserts --data <tmpfile> when tmpDataFile provided', () => {
    const args = buildConftestArgs({
      policyAbs: '/p',
      namespace: 'demo.demo',
      files: ['/a.json'],
      extraArgs: [],
      tmpDataFile: '/tmp/data.json'
    })
    expect(args).toEqual([
      'test',
      '--data', '/tmp/data.json',
      '--policy', '/p',
      '--namespace', 'demo.demo',
      '/a.json'
    ])
  })

  test('appends extraArgs after files', () => {
    const args = buildConftestArgs({
      policyAbs: '/p',
      namespace: 'demo.demo',
      files: ['/a.json', '/b.json'],
      extraArgs: ['--combine'],
      tmpDataFile: null
    })
    expect(args).toEqual([
      'test',
      '--policy', '/p',
      '--namespace', 'demo.demo',
      '/a.json', '/b.json',
      '--combine'
    ])
  })
})
```

- [ ] **Step 2: Run, see fail**

Run: `cd npm && bun test scripts/utils/run-conftest-batch.test.mjs`
Expected: 3 new tests fail — `buildConftestArgs is not a function`.

- [ ] **Step 3: Implement `buildConftestArgs` + integrate**

Edit `npm/scripts/utils/run-conftest-batch.mjs`.

(a) Add imports near top (after existing imports):
```js
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
```
Check existing import list and add only the missing names; keep one consolidated `node:fs` import.

(b) Update the JSDoc typedef block (replace the existing `@typedef ConftestBatchOptions`):
```js
/**
 * @typedef {object} ConftestBatchOptions
 * @property {string} policyDirRel шлях підкаталогу `<rule>/<concern>` (наприклад `security/package_json`)
 * @property {string} namespace повне імʼя rego-пакета (наприклад `security.package_json`)
 * @property {string[]} files список абсолютних шляхів файлів для перевірки (порожній — повертаємо порожньо)
 * @property {string[]} [extraArgs] додаткові аргументи для conftest (наприклад `--combine`)
 * @property {object} [templateData] опціональне merged-дерево; серіалізується у JSON `{ "template": <data> }` і передається як `--data <tmpfile>` (cleanup після завершення)
 */
```

(c) Export the pure helper. Add new export above `runConftestBatch`:
```js
/**
 * Pure args builder — extracted for unit-testability.
 * @param {{ policyAbs: string, namespace: string, files: string[], extraArgs: string[], tmpDataFile: string|null }} p
 * @returns {string[]}
 */
export function buildConftestArgs(p) {
  const args = ['test']
  if (p.tmpDataFile) args.push('--data', p.tmpDataFile)
  args.push('--policy', p.policyAbs, '--namespace', p.namespace, ...p.files, ...p.extraArgs)
  return args
}
```

(d) Refactor `runConftestBatch` body to use `buildConftestArgs` and write/cleanup tmpfile. Replace the existing args-construction + `spawnSync` block with:
```js
let tmpDataDir = null
let tmpDataFile = null
if (opts.templateData) {
  tmpDataDir = mkdtempSync(join(tmpdir(), 'n-cursor-tpl-'))
  tmpDataFile = join(tmpDataDir, 'template-data.json')
  writeFileSync(tmpDataFile, JSON.stringify({ template: opts.templateData }))
}
try {
  const args = buildConftestArgs({
    policyAbs,
    namespace: opts.namespace,
    files: opts.files,
    extraArgs: opts.extraArgs ?? [],
    tmpDataFile
  })
  const res = spawnSync(conftestBin, args, { encoding: 'utf8' })
  // ...existing parsing logic that converts res.stdout/stderr → ConftestViolation[]
  return /* parsed violations */
} finally {
  if (tmpDataDir) rmSync(tmpDataDir, { recursive: true, force: true })
}
```
(Preserve the existing stdout parsing — only the args composition and tmpfile lifecycle change.)

- [ ] **Step 4: Run tests, see them pass**

Run: `cd npm && bun test scripts/utils/run-conftest-batch.test.mjs`
Expected: 3 new tests pass; existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add npm/scripts/utils/run-conftest-batch.mjs npm/scripts/utils/run-conftest-batch.test.mjs
git commit -m "feat(npm): runConftestBatch accepts templateData; extract buildConftestArgs helper"
```

---

### Task 9: `check-mdc-template-refs.mjs` (TDD)

**Files:**
- Create: `npm/scripts/utils/check-mdc-template-refs.mjs`
- Create: `npm/scripts/utils/check-mdc-template-refs.test.mjs`
- Create: `npm/scripts/utils/__fixtures__/mdc-refs/with-refs/<id>.mdc`
- Create: `npm/scripts/utils/__fixtures__/mdc-refs/with-refs/fix/foo/template/package.json.snippet.json`
- Create: `npm/scripts/utils/__fixtures__/mdc-refs/missing-ref/<id>.mdc`
- Create: `npm/scripts/utils/__fixtures__/mdc-refs/missing-ref/policy/bar/template/.gitleaks.toml.snippet.toml`

- [ ] **Step 1: Create fixtures**

`__fixtures__/mdc-refs/with-refs/with-refs.mdc`:
```markdown
---
description: test fixture
globs: "**"
alwaysApply: false
---

Канон фрагментів:
- [package.json.snippet.json](./fix/foo/template/package.json.snippet.json)
```

`__fixtures__/mdc-refs/with-refs/fix/foo/template/package.json.snippet.json`:
```json
{}
```

`__fixtures__/mdc-refs/missing-ref/missing-ref.mdc`:
```markdown
---
description: test fixture
globs: "**"
alwaysApply: false
---

Тут немає посилань на template.
```

`__fixtures__/mdc-refs/missing-ref/policy/bar/template/.gitleaks.toml.snippet.toml`:
```toml
title = "demo"
```

- [ ] **Step 2: Add failing test**

Create `npm/scripts/utils/check-mdc-template-refs.test.mjs`:
```js
import { describe, expect, test } from 'bun:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { findMissingMdcRefs } from './check-mdc-template-refs.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, '__fixtures__', 'mdc-refs')

describe('findMissingMdcRefs', () => {
  test('returns empty when every template/ file is linked from <id>.mdc', async () => {
    const ruleDir = join(FIXTURES, 'with-refs')
    expect(await findMissingMdcRefs(ruleDir, 'with-refs')).toEqual([])
  })

  test('returns missing template files', async () => {
    const ruleDir = join(FIXTURES, 'missing-ref')
    const missing = await findMissingMdcRefs(ruleDir, 'missing-ref')
    expect(missing).toEqual([
      'policy/bar/template/.gitleaks.toml.snippet.toml'
    ])
  })

  test('returns empty for rule without template/ dirs', async () => {
    const ruleDir = join(FIXTURES, 'with-refs')
    // Reuses same fixture; just demonstrates no false positives for unrelated refs
    expect(await findMissingMdcRefs(ruleDir, 'with-refs')).toEqual([])
  })
})
```

- [ ] **Step 3: Run, see fail**

Run: `cd npm && bun test scripts/utils/check-mdc-template-refs.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `npm/scripts/utils/check-mdc-template-refs.mjs`:
```js
/**
 * Returns list of template/ files that are NOT referenced in <id>.mdc as
 * markdown link targets. Paths returned are relative to ruleDir.
 *
 * @param {string} ruleDir absolute path to npm/rules/<id>/
 * @param {string} ruleId basename (e.g. "security")
 * @returns {Promise<string[]>}
 */
import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

async function walkTemplateDirs(ruleDir) {
  const out = []
  for (const kind of ['fix', 'policy']) {
    const kindDir = join(ruleDir, kind)
    if (!existsSync(kindDir)) continue
    for (const concern of await readdir(kindDir)) {
      const tpl = join(kindDir, concern, 'template')
      if (!existsSync(tpl)) continue
      if (!(await stat(tpl)).isDirectory()) continue
      out.push(...(await collectFiles(tpl)))
    }
  }
  return out.map(p => relative(ruleDir, p))
}

async function collectFiles(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await collectFiles(full)))
    else out.push(full)
  }
  return out
}

export async function findMissingMdcRefs(ruleDir, ruleId) {
  const mdcPath = join(ruleDir, `${ruleId}.mdc`)
  if (!existsSync(mdcPath)) return []
  const mdc = await readFile(mdcPath, 'utf8')
  const allFiles = await walkTemplateDirs(ruleDir)
  return allFiles.filter(rel => {
    // Match markdown link to ./<rel> or (<rel>) anywhere in the .mdc
    return !mdc.includes(`./${rel}`) && !mdc.includes(`(${rel})`)
  })
}
```

- [ ] **Step 5: Run tests, see pass**

Run: `cd npm && bun test scripts/utils/check-mdc-template-refs.test.mjs`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add npm/scripts/utils/check-mdc-template-refs.mjs npm/scripts/utils/check-mdc-template-refs.test.mjs npm/scripts/utils/__fixtures__/mdc-refs/
git commit -m "feat(npm): findMissingMdcRefs — central check that template/ files are linked from <id>.mdc"
```

---

### Task 10: Pilot — create security template files

**Files:**
- Create: `npm/rules/security/policy/package_json/template/package.json.snippet.json`
- Create: `npm/rules/security/policy/package_json/template/package.json.deny.json`
- Create: `npm/rules/security/policy/package_json/template/package.json.contains.json`
- Create: `npm/rules/security/fix/gitleaks/template/.gitleaks.toml.snippet.toml`

- [ ] **Step 1: Create policy template files**

`npm/rules/security/policy/package_json/template/package.json.snippet.json`:
```json
{ "scripts": { "lint-security": "gitleaks detect --no-banner" } }
```

`npm/rules/security/policy/package_json/template/package.json.deny.json`:
```json
{
  "dependencies": { "gitleaks": "глобальний CLI — не додавай у dependencies" },
  "devDependencies": { "gitleaks": "глобальний CLI — не додавай у devDependencies" }
}
```

`npm/rules/security/policy/package_json/template/package.json.contains.json`:
```json
{ "scripts": { "lint": ["bun run lint-security"] } }
```

- [ ] **Step 2: Create fix template (full canon for .gitleaks.toml)**

`npm/rules/security/fix/gitleaks/template/.gitleaks.toml.snippet.toml`:
```toml
title = "Project gitleaks config"

[extend]
useDefault = true

[allowlist]
description = "Файли й шляхи, які навмисно містять test-фікстури з паттернами секретів."
paths = [
  '''(^|/)node_modules(/|$)''',
  '''(^|/)\.git(/|$)''',
  '''(^|/)dist(/|$)''',
  '''(^|/)build(/|$)''',
  '''.*\.lock$''',
  '''.*fixtures?/.*'''
]
```

- [ ] **Step 3: Verify all template files parse correctly**

Run: `cd npm && bun -e 'import { loadTemplate } from "./scripts/utils/template.mjs"; console.log(JSON.stringify(await loadTemplate("./rules/security/policy/package_json"), null, 2))'`
Expected: JSON output with `package.json` key containing snippet/deny/contains.

Run: `cd npm && bun -e 'import { loadTemplate } from "./scripts/utils/template.mjs"; console.log(JSON.stringify(await loadTemplate("./rules/security/fix/gitleaks"), null, 2))'`
Expected: JSON output with `.gitleaks.toml` key containing snippet (parsed TOML).

- [ ] **Step 4: Commit**

```bash
git add npm/rules/security/policy/package_json/template/ npm/rules/security/fix/gitleaks/template/
git commit -m "feat(security): template/ files for package_json concern and gitleaks canon"
```

---

### Task 11: Pilot — rewrite `security/fix/gitleaks/check.mjs`

**Files:**
- Modify: `npm/rules/security/fix/gitleaks/check.mjs`
- Modify: `npm/rules/security/fix/gitleaks/check.test.mjs`

- [ ] **Step 1: Update test for new template-driven behavior**

Read current `npm/rules/security/fix/gitleaks/check.test.mjs` to understand its fixture style. Then rewrite the assertions to expect template-driven messages.

Replace contents of `npm/rules/security/fix/gitleaks/check.test.mjs` with:
```js
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { check } from './check.mjs'

function withTmpCwd(prep, body) {
  const cwd = mkdtempSync(join(tmpdir(), 'gitleaks-check-'))
  const origCwd = process.cwd()
  try {
    process.chdir(cwd)
    prep(cwd)
    return body(cwd)
  } finally {
    process.chdir(origCwd)
    rmSync(cwd, { recursive: true, force: true })
  }
}

describe('security/fix/gitleaks/check', () => {
  test('fails when package.json missing', async () => {
    const exit = await withTmpCwd(() => {}, async () => await check())
    expect(exit).toBe(1)
  })

  test('fails when .gitleaks.toml missing', async () => {
    const exit = await withTmpCwd(cwd => {
      writeFileSync(join(cwd, 'package.json'), '{}')
    }, async () => await check())
    expect(exit).toBe(1)
  })

  test('fails when .gitleaks.toml lacks useDefault from template', async () => {
    const exit = await withTmpCwd(cwd => {
      writeFileSync(join(cwd, 'package.json'), '{}')
      writeFileSync(join(cwd, '.gitleaks.toml'), 'title = "x"\n')
    }, async () => await check())
    expect(exit).toBe(1)
  })

  test('passes when both files exist and .gitleaks.toml is template superset', async () => {
    const exit = await withTmpCwd(cwd => {
      writeFileSync(join(cwd, 'package.json'), '{}')
      writeFileSync(join(cwd, '.gitleaks.toml'), `title = "Project gitleaks config"

[extend]
useDefault = true

[allowlist]
description = "..."
paths = [
  '''(^|/)node_modules(/|$)''',
  '''(^|/)\\.git(/|$)''',
  '''(^|/)dist(/|$)''',
  '''(^|/)build(/|$)''',
  '''.*\\.lock$''',
  '''.*fixtures?/.*'''
]
`)
    }, async () => await check())
    expect(exit).toBe(0)
  })
})
```

- [ ] **Step 2: Run test, see fail**

Run: `cd npm && bun test rules/security/fix/gitleaks/check.test.mjs`
Expected: tests fail — current check.mjs uses regex `/useDefault\s*=\s*true/u` and won't match template structure.

- [ ] **Step 3: Rewrite `check.mjs` to use template**

Replace contents of `npm/rules/security/fix/gitleaks/check.mjs`:
```js
/**
 * FS-частина правила `security`.
 *
 * Перевіряє:
 *  - наявність `package.json` (структуру валідує Rego);
 *  - наявність `.gitleaks.toml` (без нього скан "сліпий");
 *  - вміст `.gitleaks.toml` ⊇ канону з template/.gitleaks.toml.snippet.toml
 *    (зокрема `[extend].useDefault = true`).
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as parseToml } from 'smol-toml'

import { createCheckReporter } from '../../../../scripts/utils/check-reporter.mjs'
import { checkSnippet, loadTemplate } from '../../../../scripts/utils/template.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const GITLEAKS_CONFIG = '.gitleaks.toml'

async function checkGitleaksConfig(pass, fail) {
  if (!existsSync(GITLEAKS_CONFIG)) {
    fail(`${GITLEAKS_CONFIG} не знайдено — створи за каноном template/.gitleaks.toml.snippet.toml (security.mdc)`)
    return
  }
  const target = parseToml(await readFile(GITLEAKS_CONFIG, 'utf8'))
  const tpl = await loadTemplate(HERE)
  const snippet = tpl[GITLEAKS_CONFIG]?.snippet
  if (!snippet) {
    fail(`internal: template ${GITLEAKS_CONFIG}.snippet.toml не знайдено у ${HERE}/template/`)
    return
  }
  const violations = checkSnippet(target, snippet, { targetPath: GITLEAKS_CONFIG, source: 'security.mdc' })
  if (violations.length === 0) {
    pass(`${GITLEAKS_CONFIG} відповідає канону (template/.gitleaks.toml.snippet.toml)`)
  } else {
    for (const msg of violations) fail(msg)
  }
}

export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter
  if (!existsSync('package.json')) {
    fail('package.json не знайдено в корені — додай (security.mdc)')
    return reporter.getExitCode()
  }
  pass('package.json є (структуру перевіряє Rego)')
  await checkGitleaksConfig(pass, fail)
  return reporter.getExitCode()
}
```

- [ ] **Step 4: Run test, see pass**

Run: `cd npm && bun test rules/security/fix/gitleaks/check.test.mjs`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add npm/rules/security/fix/gitleaks/check.mjs npm/rules/security/fix/gitleaks/check.test.mjs
git commit -m "refactor(security/gitleaks): drive .gitleaks.toml check from template/ (no inline regex)"
```

---

### Task 12: Pilot — rewrite `security/policy/package_json/package_json.rego`

**Files:**
- Modify: `npm/rules/security/policy/package_json/package_json.rego`
- Modify: `npm/rules/security/policy/package_json/package_json_test.rego`

- [ ] **Step 1: Adapt rego tests first (TDD for rego)**

Replace contents of `npm/rules/security/policy/package_json/package_json_test.rego`:
```rego
package security.package_json_test

import data.security.package_json
import rego.v1

# Canonical template data — mirrors template/package.json.{snippet,deny,contains}.json
template_data := {
  "snippet": {"scripts": {"lint-security": "gitleaks detect --no-banner"}},
  "deny": {
    "dependencies": {"gitleaks": "глобальний CLI — не додавай у dependencies"},
    "devDependencies": {"gitleaks": "глобальний CLI — не додавай у devDependencies"}
  },
  "contains": {"scripts": {"lint": ["bun run lint-security"]}}
}

test_required_lint_security_missing if {
  some msg in package_json.deny with input as {"scripts": {}} with data.template as template_data
  contains(msg, "scripts.lint-security")
}

test_required_lint_security_present if {
  count(package_json.deny) == 0 with input as {
    "scripts": {"lint-security": "gitleaks detect --no-banner"}
  } with data.template as template_data
}

test_forbid_gitleaks_in_dependencies if {
  some msg in package_json.deny with input as {
    "scripts": {"lint-security": "gitleaks detect --no-banner"},
    "dependencies": {"gitleaks": "^8.0.0"}
  } with data.template as template_data
  contains(msg, "dependencies.gitleaks")
}

test_contains_lint_aggregator_missing_substring if {
  some msg in package_json.deny with input as {
    "scripts": {"lint-security": "gitleaks detect --no-banner", "lint": "oxfmt ."}
  } with data.template as template_data
  contains(msg, "scripts.lint")
}

test_contains_lint_aggregator_with_substring_ok if {
  count(package_json.deny) == 0 with input as {
    "scripts": {
      "lint-security": "gitleaks detect --no-banner",
      "lint": "bun run lint-security && oxfmt ."
    }
  } with data.template as template_data
}
```

- [ ] **Step 2: Run rego tests, see fail**

Run: `cd npm && bun run lint-rego`
Expected: FAIL — current `package_json.rego` does not reference `data.template`; tests will mismatch on messages.

- [ ] **Step 3: Rewrite `package_json.rego` to read from `data.template`**

Replace contents of `npm/rules/security/policy/package_json/package_json.rego`:
```rego
# Перевірка `package.json` для правила security (security.mdc).
# Канон надходить через --data: { "template": { "snippet": ..., "deny": ..., "contains": ... } }
# Структура --data сформована з template/<target>.{snippet,deny,contains}.json концерну.
package security.package_json

import rego.v1

# ── deny: кожен snippet leaf має співпадати з input ──────────────────────────
deny contains msg if {
  some script_name, expected in data.template.snippet.scripts
  actual := object.get(object.get(input, "scripts", {}), script_name, "")
  actual != expected
  msg := sprintf("package.json: scripts.%q має бути %q (security.mdc)", [script_name, expected])
}

# ── deny: жодного ключа з deny у dependencies/devDependencies ────────────────
deny contains msg if {
  some pkg, reason in data.template.deny.dependencies
  pkg in object.keys(object.get(input, "dependencies", {}))
  msg := sprintf("package.json: dependencies.%s — %s (security.mdc)", [pkg, reason])
}

deny contains msg if {
  some pkg, reason in data.template.deny.devDependencies
  pkg in object.keys(object.get(input, "devDependencies", {}))
  msg := sprintf("package.json: devDependencies.%s — %s (security.mdc)", [pkg, reason])
}

# ── deny: рядкові поля з contains мають містити кожен substring ──────────────
deny contains msg if {
  some script_name, needles in data.template.contains.scripts
  some needle in needles
  not contains(object.get(object.get(input, "scripts", {}), script_name, ""), needle)
  msg := sprintf("package.json: scripts.%s має містити %q (security.mdc)", [script_name, needle])
}
```

- [ ] **Step 4: Run rego tests, see pass**

Run: `cd npm && bun run lint-rego`
Expected: pass (regal + opa check + tests).

- [ ] **Step 5: Commit**

```bash
git add npm/rules/security/policy/package_json/package_json.rego npm/rules/security/policy/package_json/package_json_test.rego
git commit -m "refactor(security/package_json): drive rego from data.template.* (no inline literals)"
```

---

### Task 13: Pilot — wire template into runner for security concern

**Files:**
- Modify: `npm/bin/n-cursor.js` (or whichever file dispatches concerns; locate `check-rule` / `runRule`)
- Verify: existing orchestrator picks up template automatically

- [ ] **Step 1: Locate where `runConftestBatch` is called for security/package_json**

Run: `grep -rn "runConftestBatch\|security/package_json\|security.package_json" npm/scripts npm/bin npm/rules | head -20`
Expected: discover the call site (likely in a generic orchestrator that iterates `rules/<id>/policy/<concern>/`).

- [ ] **Step 2: Update the orchestrator to load+pass template**

In the call site (likely `npm/scripts/utils/run-rule.mjs` or similar — adjust path based on Step 1 output), find the spot building options for `runConftestBatch`. Add:

```js
import { loadTemplate } from './template.mjs'

// inside the loop building options:
const tpl = await loadTemplate(concernAbsDir)
const targetBasename = /* derive from target.json: basename of .single or first .walkGlob */
const templateData = tpl[targetBasename] // may be undefined; that's fine
const opts = {
  policyDirRel,
  namespace,
  files,
  templateData,
}
```

If `target.json` has `walkGlob` with mixed basenames (rare), iterate per matched file's basename — but for security, target is `single: "package.json"`, so simple lookup works.

- [ ] **Step 3: Extract `resolveConcernTemplateData(concernAbsDir, targetJson)` as testable helper**

This pure helper centralises the lookup logic so we can TDD it without spawning the full orchestrator. Add it next to the orchestrator file (or in `npm/scripts/utils/template.mjs` if simpler — adjust based on Step 1 finding).

In the chosen location, add export:
```js
import { loadTemplate } from './template.mjs' // adjust path if helper colocated
import { basename } from 'node:path'

/**
 * Resolves which template[<target>] to pass for a concern.
 * For `single` targets — basename. For `walkGlob` — basename of first glob entry.
 * @returns {object|undefined}
 */
export async function resolveConcernTemplateData(concernAbsDir, targetJson) {
  const tpl = await loadTemplate(concernAbsDir)
  const single = targetJson?.files?.single
  if (single) return tpl[basename(single)]
  const glob = targetJson?.files?.walkGlob
  if (typeof glob === 'string') return tpl[basename(glob.replace(/^!/, ''))]
  if (Array.isArray(glob)) {
    for (const g of glob) {
      if (g.startsWith('!')) continue
      const data = tpl[basename(g)]
      if (data) return data
    }
  }
  return undefined
}
```

Add tests for this helper (file alongside its location):
```js
import { describe, expect, test } from 'bun:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveConcernTemplateData } from './<path>.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, '__fixtures__', 'template', 'security-pkgjson', 'policy', 'package_json')

describe('resolveConcernTemplateData', () => {
  test('single target — picks template by basename', async () => {
    const data = await resolveConcernTemplateData(FIXTURE, { files: { single: 'package.json' } })
    expect(data?.snippet?.scripts?.['lint-security']).toBe('gitleaks detect --no-banner')
  })

  test('walkGlob string — picks by glob basename', async () => {
    const data = await resolveConcernTemplateData(FIXTURE, { files: { walkGlob: '**/package.json' } })
    expect(data?.snippet?.scripts?.['lint-security']).toBe('gitleaks detect --no-banner')
  })

  test('walkGlob array — skips negative patterns and picks first matching template', async () => {
    const data = await resolveConcernTemplateData(FIXTURE, {
      files: { walkGlob: ['!**/dist/**', '**/package.json'] }
    })
    expect(data?.snippet?.scripts?.['lint-security']).toBe('gitleaks detect --no-banner')
  })

  test('returns undefined when no template matches', async () => {
    const data = await resolveConcernTemplateData(FIXTURE, { files: { single: 'unrelated.yml' } })
    expect(data).toBeUndefined()
  })
})
```

- [ ] **Step 4: Run tests, see helper tests fail then pass after implementing**

Run: `cd npm && bun test <path-to-test>`
Expected: tests pass after Step 3 implementation.

- [ ] **Step 5: Wire helper into orchestrator at call site**

In the orchestrator (from Step 1), where options for `runConftestBatch` are built, add:
```js
import { resolveConcernTemplateData } from './<helper-path>.mjs'

const targetJson = JSON.parse(await readFile(join(concernAbsDir, 'target.json'), 'utf8'))
const templateData = await resolveConcernTemplateData(concernAbsDir, targetJson)
const opts = {
  policyDirRel,
  namespace,
  files,
  templateData
}
```
For JS-check concerns (`fix/<concern>/check.mjs`), update the orchestrator to load template the same way and pass it as `check({ template })` argument. (Existing `check()` signature must be updated — for security pilot, check.mjs reads template via `loadTemplate(HERE)` directly per Task 11, so orchestrator change is optional for fix; do it only if orchestrator already passes options.)

- [ ] **Step 6: Run full test suite**

Run: `cd npm && bun test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add npm/scripts/utils/<modified-files>
git commit -m "feat(npm): orchestrator wires resolveConcernTemplateData → runConftestBatch.templateData"
```

---

### Task 14: Pilot — update `security/security.mdc` with template refs

**Files:**
- Modify: `npm/rules/security/security.mdc`

- [ ] **Step 1: Replace inline canon blocks with markdown links to template/**

Read current `npm/rules/security/security.mdc` (start with `Read` tool). Identify the inline canonical fragments — likely `package.json` snippet, `lint` integration, `.gitleaks.toml` canon.

Replace those blocks with reference links. Updated content should preserve all non-canon prose, but the fenced code blocks turn into:

```markdown
## Канон фрагментів

- `package.json` — required scripts: [package.json.snippet.json](./policy/package_json/template/package.json.snippet.json)
- `package.json` — forbidden in deps: [package.json.deny.json](./policy/package_json/template/package.json.deny.json)
- `package.json` — `lint` must contain: [package.json.contains.json](./policy/package_json/template/package.json.contains.json)
- `.gitleaks.toml` — full canon: [.gitleaks.toml.snippet.toml](./fix/gitleaks/template/.gitleaks.toml.snippet.toml)
```

Keep the rest of `security.mdc` (description prose, `## GitHub Actions` workflow YAML if it's parameterized, etc.).

- [ ] **Step 2: Verify findMissingMdcRefs returns empty**

Run: `cd npm && bun -e 'import { findMissingMdcRefs } from "./scripts/utils/check-mdc-template-refs.mjs"; console.log(await findMissingMdcRefs("./rules/security", "security"))'`
Expected: `[]` (empty array).

- [ ] **Step 3: Commit**

```bash
git add npm/rules/security/security.mdc
git commit -m "docs(security): replace inline canon blocks with markdown refs to template/"
```

---

### Task 15: End-to-end smoke test on security pilot

**Files:** (no changes — verification only)

- [ ] **Step 1: Run security check against the cursor repo itself**

Run: `cd /Users/vitaliytv/www/nitra/cursor && npx --no @nitra/cursor check security`
(or directly: `bun npm/bin/n-cursor.js check security`)
Expected: PASS — both `.gitleaks.toml` and `package.json` are template-conforming (cursor repo is the canonical example).

- [ ] **Step 2: Synthetic break test — temporarily remove useDefault from .gitleaks.toml**

```bash
cp .gitleaks.toml .gitleaks.toml.bak
sed -i.tmp 's/useDefault = true/useDefault = false/' .gitleaks.toml
npx --no @nitra/cursor check security
# Expected: FAIL with message referencing extend.useDefault and template
mv .gitleaks.toml.bak .gitleaks.toml
rm -f .gitleaks.toml.tmp
```

- [ ] **Step 3: Synthetic break test — temporarily add gitleaks to package.json dependencies**

```bash
cp package.json package.json.bak
# Edit package.json — add "gitleaks": "^8.0.0" to dependencies (manually, do not script JSON edit if no jq)
# Run check
npx --no @nitra/cursor check security
# Expected: FAIL with message containing "dependencies.gitleaks — глобальний CLI"
mv package.json.bak package.json
```

- [ ] **Step 4: Run full test suite to confirm nothing regressed**

Run: `cd npm && bun test`
Expected: all green.

Run: `cd npm && bun run lint-rego`
Expected: all green.

- [ ] **Step 5: No commit (verification only) — proceed to Task 16**

---

### Task 16: Bump version + CHANGELOG entry

**Files:**
- Modify: `npm/package.json` (`version`)
- Modify: `npm/CHANGELOG.md` (prepend new section)

- [ ] **Step 1: Read current version**

Run: `jq -r .version npm/package.json`
Note the value (e.g. `1.13.0`).

- [ ] **Step 2: Bump build version (+1 patch)**

Edit `npm/package.json` — increment patch (e.g. `1.13.0` → `1.13.1`). Single increment only (per [npm/CLAUDE.md](../../npm/CLAUDE.md) — no more than one step ahead of git HEAD).

- [ ] **Step 3: Prepend new CHANGELOG section**

Edit `npm/CHANGELOG.md`. After the top heading and intro, before the existing `## [<previous version>]` section, insert:

```markdown
## [<new-version>] - 2026-05-17

### Added

- `npm/scripts/utils/template.mjs` — `loadTemplate` + `checkSnippet`/`checkDeny`/`checkContains`/`checkTextSubset` для template-driven перевірок концернів.
- `npm/scripts/utils/check-mdc-template-refs.mjs` — централізована перевірка, що кожен файл `template/` згаданий у `<id>.mdc`.
- `template/` каталоги в `security` концернах: повний канон `.gitleaks.toml` і `package.json` snippet/deny/contains.
- `smol-toml` у dependencies для парсингу TOML template-файлів.

### Changed

- `runConftestBatch` приймає опціональне `templateData` — серіалізує у tmpfile і передає `conftest --data <file>`.
- `security/fix/gitleaks/check.mjs` читає канон з `template/`, не з inline regex.
- `security/policy/package_json/package_json.rego` читає очікувані значення з `data.template.*`, не з inline literals.
- `security/security.mdc` посилається на template-файли markdown-лінками замість inline fenced-блоків.
```

- [ ] **Step 4: Verify changelog check passes**

Run: `cd /Users/vitaliytv/www/nitra/cursor && npx --no @nitra/cursor check changelog`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add npm/package.json npm/CHANGELOG.md
git commit -m "release(npm): v<new-version> — template-dir infrastructure + security pilot"
```

---

## Acceptance

After all 16 tasks:

- `bun test` (in `npm/`) — green
- `bun run lint-rego` — green
- `bun run lint` (root) — green
- `npx --no @nitra/cursor check security` — green on cursor repo
- Synthetic-break test (Task 15.2, 15.3) — fails appropriately with messages referencing template/source
- `findMissingMdcRefs("./rules/security", "security")` returns `[]`
- Concern inventory ADR committed
- Version bumped, CHANGELOG entry present

After approval, Phase 2-6 each become their own plan (one per phase), reusing infrastructure from this plan.
