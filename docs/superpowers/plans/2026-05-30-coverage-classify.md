# Coverage-Classify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Додати LLM-класифікацію survived мутантів у `n-cursor coverage`: для кожного survived вираховуємо `verdict ∈ {worth-testing, equivalent, defensive, glue, wrapper}` через Claude Sonnet 4.6 і виключаємо «Allowed gaps» зі знаменника mutation score.

**Architecture:** Новий модуль `npm/scripts/coverage-classify/` (verdict-schema → cache → prompt → apply → index). Інтеграція точкова: 1 import + 3 виклики у `npm/rules/test/coverage/coverage.mjs`. Cache по `git hash-object` ключу — інвалідація автоматична при зміні source. Без API key / SDK — graceful skip, coverage не падає.

**Tech Stack:** Node.js ESM, Vitest (TDD), `@anthropic-ai/sdk` (raw API), `zod` (runtime validation), `node:crypto` + `node:child_process` (`git hash-object` fallback).

---

## File Structure

**Створюємо:**
- `npm/scripts/coverage-classify/verdict-schema.mjs` — zod-схема + `parseVerdict(rawText)`
- `npm/scripts/coverage-classify/cache.mjs` — `deriveBlobHash`, `deriveCacheKey`, `readCache`, `writeCache`
- `npm/scripts/coverage-classify/prompt.mjs` — `SYSTEM_PROMPT` const + `buildUserPrompt(mutant, cwd)`
- `npm/scripts/coverage-classify/apply.mjs` — `applyVerdicts(rows, verdicts, threshold)` + `isAllowedGap(verdict, threshold)`
- `npm/scripts/coverage-classify/index.mjs` — public `classify(survived, cwd, opts)`
- `npm/scripts/coverage-classify/tests/verdict-schema.test.mjs`
- `npm/scripts/coverage-classify/tests/cache.test.mjs`
- `npm/scripts/coverage-classify/tests/prompt.test.mjs`
- `npm/scripts/coverage-classify/tests/apply.test.mjs`
- `npm/scripts/coverage-classify/tests/index.test.mjs`

**Модифікуємо:**
- `npm/package.json` — додати `@anthropic-ai/sdk` і `zod` у `dependencies`
- `.gitignore` (root) — додати `npm/reports/coverage-classify.cache.json`
- `npm/rules/test/coverage/coverage.mjs` — додати classify-крок між `rows.push(buildTotalsRow(...))` і `renderMarkdown(...)`; розширити `renderMarkdown` сигнатуру для `allowedGaps`
- `npm/rules/test/coverage/tests/coverage.test.mjs` — оновити тести `renderMarkdown` для нового параметра `allowedGaps`

---

## Task 1: Setup — dependencies та .gitignore

**Files:**
- Modify: `/Users/vitaliytv/www/nitra/cursor/npm/package.json`
- Modify: `/Users/vitaliytv/www/nitra/cursor/.gitignore`

- [ ] **Step 1: Додати `@anthropic-ai/sdk` і `zod` у `npm/package.json`**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bun add @anthropic-ai/sdk zod
```

Очікувано: `bun add` оновлює `dependencies` у `npm/package.json` і встановлює пакети.

- [ ] **Step 2: Перевірити, що пакети додані**

```bash
grep -E '"@anthropic-ai/sdk"|"zod"' /Users/vitaliytv/www/nitra/cursor/npm/package.json
```

Очікувано: дві лінії з версіями.

- [ ] **Step 3: Додати cache file у root `.gitignore`**

Додати рядок у кінець `/Users/vitaliytv/www/nitra/cursor/.gitignore`:
```
npm/reports/coverage-classify.cache.json
```

- [ ] **Step 4: Commit**

```bash
cd /Users/vitaliytv/www/nitra/cursor && git add npm/package.json npm/bun.lock .gitignore && git commit -m "chore(npm): add @anthropic-ai/sdk + zod deps for coverage-classify

Підготовка до coverage-classify (LLM-класифікатор survived мутантів).
Кеш файл — у .gitignore (per-machine).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `verdict-schema.mjs` — zod-схема Verdict

**Files:**
- Create: `/Users/vitaliytv/www/nitra/cursor/npm/scripts/coverage-classify/verdict-schema.mjs`
- Test: `/Users/vitaliytv/www/nitra/cursor/npm/scripts/coverage-classify/tests/verdict-schema.test.mjs`

- [ ] **Step 1: Створити failing test**

Створити файл `/Users/vitaliytv/www/nitra/cursor/npm/scripts/coverage-classify/tests/verdict-schema.test.mjs`:

```js
/**
 * Тести для verdict-schema.mjs: zod-валідація відповіді LLM-класифікатора
 * і parseVerdict — витяг JSON з raw-text відповіді з retry-friendly помилкою.
 */
import { describe, expect, test } from 'vitest'

import { parseVerdict, VerdictSchema } from '../verdict-schema.mjs'

const MIN_REASON = 'Branch is covered by integration test runStandardRule'

describe('VerdictSchema', () => {
  test('валідний worth-testing verdict', () => {
    const v = {
      verdict: 'worth-testing',
      confidence: 0.85,
      reason: MIN_REASON,
      suggestedTest: 'Test branch with condition x === 1'
    }
    expect(VerdictSchema.parse(v)).toEqual(v)
  })

  test('валідний equivalent verdict без suggestedTest', () => {
    const v = { verdict: 'equivalent', confidence: 0.92, reason: MIN_REASON }
    expect(VerdictSchema.parse(v)).toEqual(v)
  })

  test('reject: невідомий verdict-enum', () => {
    expect(() => VerdictSchema.parse({ verdict: 'unknown', confidence: 0.5, reason: MIN_REASON })).toThrow()
  })

  test('reject: confidence > 1', () => {
    expect(() => VerdictSchema.parse({ verdict: 'glue', confidence: 1.5, reason: MIN_REASON })).toThrow()
  })

  test('reject: confidence < 0', () => {
    expect(() => VerdictSchema.parse({ verdict: 'glue', confidence: -0.1, reason: MIN_REASON })).toThrow()
  })

  test('reject: reason < 20 символів', () => {
    expect(() => VerdictSchema.parse({ verdict: 'glue', confidence: 0.5, reason: 'short' })).toThrow()
  })

  test('reject: reason > 500 символів', () => {
    expect(() =>
      VerdictSchema.parse({ verdict: 'glue', confidence: 0.5, reason: 'x'.repeat(501) })
    ).toThrow()
  })

  test('reject: suggestedTest > 300 символів', () => {
    expect(() =>
      VerdictSchema.parse({
        verdict: 'worth-testing',
        confidence: 0.5,
        reason: MIN_REASON,
        suggestedTest: 'x'.repeat(301)
      })
    ).toThrow()
  })
})

describe('parseVerdict', () => {
  test('видобуває JSON з чистого тексту', () => {
    const raw = `{"verdict":"glue","confidence":0.8,"reason":"${MIN_REASON}"}`
    expect(parseVerdict(raw)).toEqual({ verdict: 'glue', confidence: 0.8, reason: MIN_REASON })
  })

  test('видобуває JSON з тексту з prefix/suffix', () => {
    const raw = `Here is my classification:\n{"verdict":"glue","confidence":0.8,"reason":"${MIN_REASON}"}\n\nDone.`
    expect(parseVerdict(raw).verdict).toBe('glue')
  })

  test('throw коли немає JSON-об\'єкта у тексті', () => {
    expect(() => parseVerdict('No JSON here')).toThrow(/No JSON/u)
  })

  test('throw на невалідному JSON', () => {
    expect(() => parseVerdict('{ broken json')).toThrow()
  })

  test('throw коли JSON не відповідає схемі', () => {
    expect(() => parseVerdict('{"verdict":"x","confidence":0.5,"reason":"short"}')).toThrow()
  })
})
```

- [ ] **Step 2: Запустити тест — переконатися, що падає**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bunx vitest run scripts/coverage-classify/tests/verdict-schema.test.mjs
```

Очікувано: FAIL з помилкою `Cannot find module '../verdict-schema.mjs'`.

- [ ] **Step 3: Створити implementation**

Створити файл `/Users/vitaliytv/www/nitra/cursor/npm/scripts/coverage-classify/verdict-schema.mjs`:

```js
/**
 * Zod-схема для verdict-відповіді LLM-класифікатора (coverage-classify).
 * parseVerdict — витяг JSON з raw-text LLM-відповіді + validate.
 *
 * Категорії:
 *   - worth-testing: pure logic, real branches — пиши тест
 *   - equivalent:    мутант поведінково еквівалентний (не killable)
 *   - defensive:     гілка для impossible state (не killable)
 *   - glue:          CLI entry / runStandardRule wrapper (integration covers)
 *   - wrapper:       тонкий spawn/fetch wrapper (integration covers)
 */
import { z } from 'zod'

export const VerdictSchema = z.object({
  verdict: z.enum(['worth-testing', 'equivalent', 'defensive', 'glue', 'wrapper']),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(20).max(500),
  suggestedTest: z.string().max(300).optional()
})

/**
 * Витягує JSON-об'єкт з raw-text LLM-відповіді і валідує через VerdictSchema.
 * @param {string} rawText raw-text відповідь LLM
 * @returns {{verdict: string, confidence: number, reason: string, suggestedTest?: string}} verdict
 * @throws якщо JSON не знайдено, не парситься, або не відповідає схемі
 */
export function parseVerdict(rawText) {
  const jsonStart = rawText.indexOf('{')
  const jsonEnd = rawText.lastIndexOf('}')
  if (jsonStart < 0 || jsonEnd < 0) {
    throw new Error('No JSON object found in LLM response')
  }
  const json = JSON.parse(rawText.slice(jsonStart, jsonEnd + 1))
  return VerdictSchema.parse(json)
}
```

- [ ] **Step 4: Запустити тест — переконатися, що проходить**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bunx vitest run scripts/coverage-classify/tests/verdict-schema.test.mjs
```

Очікувано: PASS, 13/13 tests passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/vitaliytv/www/nitra/cursor && git add npm/scripts/coverage-classify/verdict-schema.mjs npm/scripts/coverage-classify/tests/verdict-schema.test.mjs && git commit -m "feat(coverage-classify): VerdictSchema + parseVerdict (TDD)

Zod-схема для відповіді LLM-класифікатора (worth-testing/equivalent/
defensive/glue/wrapper) + парсер raw-text LLM-відповіді.

Reason ≥20 символів змушує модель пояснити, а не \"здається\".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `cache.mjs` — file-hash-keyed cache

**Files:**
- Create: `/Users/vitaliytv/www/nitra/cursor/npm/scripts/coverage-classify/cache.mjs`
- Test: `/Users/vitaliytv/www/nitra/cursor/npm/scripts/coverage-classify/tests/cache.test.mjs`

- [ ] **Step 1: Створити failing test**

Створити `/Users/vitaliytv/www/nitra/cursor/npm/scripts/coverage-classify/tests/cache.test.mjs`:

```js
/**
 * Тести cache.mjs: file-hash-keyed cache для verdicts.
 *   - deriveBlobHash: git hash-object для існуючого файла, sha1 fallback;
 *   - deriveCacheKey: blobHash:line:col:base64url(replacement);
 *   - readCache/writeCache: round-trip, схема, інвалідація.
 */
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

import { deriveBlobHash, deriveCacheKey, readCache, writeCache } from '../cache.mjs'
import { withTmpDir } from '../../utils/test-helpers.mjs'

describe('deriveBlobHash', () => {
  test('повертає sha1 для існуючого файла (через git hash-object або fallback)', async () => {
    await withTmpDir(async dir => {
      const f = join(dir, 'a.txt')
      await writeFile(f, 'hello world\n', 'utf8')
      const hash = deriveBlobHash(f)
      expect(hash).toMatch(/^[a-f0-9]{40}$/u)
    })
  })

  test('повертає null для неіснуючого файла', () => {
    expect(deriveBlobHash('/no/such/file/12345')).toBeNull()
  })

  test('стабільний хеш — той самий контент → той самий хеш', async () => {
    await withTmpDir(async dir => {
      const a = join(dir, 'a.txt')
      const b = join(dir, 'b.txt')
      await writeFile(a, 'same content\n', 'utf8')
      await writeFile(b, 'same content\n', 'utf8')
      expect(deriveBlobHash(a)).toBe(deriveBlobHash(b))
    })
  })

  test('різний контент → різний хеш', async () => {
    await withTmpDir(async dir => {
      const a = join(dir, 'a.txt')
      const b = join(dir, 'b.txt')
      await writeFile(a, 'content A\n', 'utf8')
      await writeFile(b, 'content B\n', 'utf8')
      expect(deriveBlobHash(a)).not.toBe(deriveBlobHash(b))
    })
  })
})

describe('deriveCacheKey', () => {
  test('повертає null коли файл недоступний', () => {
    const mutant = { line: 1, col: 1, replacement: 'true' }
    expect(deriveCacheKey('/no/such/file', mutant)).toBeNull()
  })

  test('формат: <blobHash>:<line>:<col>:<base64url(replacement)>', async () => {
    await withTmpDir(async dir => {
      const f = join(dir, 'a.mjs')
      await writeFile(f, 'export const x = 1\n', 'utf8')
      const mutant = { line: 1, col: 17, replacement: '2' }
      const key = deriveCacheKey(f, mutant)
      expect(key).toMatch(/^[a-f0-9]{40}:1:17:[A-Za-z0-9_-]+$/u)
    })
  })

  test('replacement з спецсимволами (:, /) кодується безпечно', async () => {
    await withTmpDir(async dir => {
      const f = join(dir, 'a.mjs')
      await writeFile(f, 'x\n', 'utf8')
      const mutant = { line: 1, col: 1, replacement: 'a:b/c\n' }
      const key = deriveCacheKey(f, mutant)
      // base64url не містить +, /, =, тільки A-Z a-z 0-9 - _
      const parts = key.split(':')
      expect(parts).toHaveLength(4)
      expect(parts[3]).toMatch(/^[A-Za-z0-9_-]+$/u)
    })
  })
})

describe('readCache / writeCache', () => {
  test('пустий cache при відсутньому файлі', async () => {
    await withTmpDir(async dir => {
      const cachePath = join(dir, 'cache.json')
      const c = readCache(cachePath)
      expect(c).toEqual({ version: 1, model: null, entries: {} })
    })
  })

  test('round-trip: write → read той самий вміст', async () => {
    await withTmpDir(async dir => {
      const cachePath = join(dir, 'cache.json')
      const entry = {
        verdict: 'glue',
        confidence: 0.8,
        reason: 'Branch covered by integration',
        classifiedAt: '2026-05-30T12:00:00Z'
      }
      const c = { version: 1, model: 'claude-sonnet-4-6', entries: { abc: entry } }
      writeCache(cachePath, c)
      expect(readCache(cachePath)).toEqual(c)
    })
  })

  test('corrupted JSON → empty cache (recover)', async () => {
    await withTmpDir(async dir => {
      const cachePath = join(dir, 'cache.json')
      await writeFile(cachePath, '{ broken json', 'utf8')
      expect(readCache(cachePath)).toEqual({ version: 1, model: null, entries: {} })
    })
  })

  test('version mismatch → empty cache (invalidate)', async () => {
    await withTmpDir(async dir => {
      const cachePath = join(dir, 'cache.json')
      await writeFile(cachePath, JSON.stringify({ version: 99, entries: { x: {} } }), 'utf8')
      expect(readCache(cachePath)).toEqual({ version: 1, model: null, entries: {} })
    })
  })

  test('writeCache створює батьківські директорії', async () => {
    await withTmpDir(async dir => {
      const cachePath = join(dir, 'nested/deep/cache.json')
      writeCache(cachePath, { version: 1, model: 'x', entries: {} })
      expect(existsSync(cachePath)).toBe(true)
    })
  })

  test('entries не object → empty cache', async () => {
    await withTmpDir(async dir => {
      const cachePath = join(dir, 'cache.json')
      await writeFile(cachePath, JSON.stringify({ version: 1, entries: 'not an object' }), 'utf8')
      expect(readCache(cachePath).entries).toEqual({})
    })
  })
})
```

- [ ] **Step 2: Запустити — переконатися, що падає**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bunx vitest run scripts/coverage-classify/tests/cache.test.mjs
```

Очікувано: FAIL з `Cannot find module '../cache.mjs'`.

- [ ] **Step 3: Створити implementation**

Створити `/Users/vitaliytv/www/nitra/cursor/npm/scripts/coverage-classify/cache.mjs`:

```js
/**
 * File-hash-keyed cache для coverage-classify verdicts.
 *
 * Cache key = `<blob-hash>:<line>:<col>:<base64url(replacement)>`.
 * Blob hash рахуємо через `git hash-object <file>` (детерміновано на working tree)
 * з fallback на sha1(readFile) якщо git недоступний.
 *
 * Cache schema:
 *   { version: 1, model: string|null, entries: Record<key, { verdict, confidence, reason, suggestedTest?, classifiedAt }> }
 *
 * Інвалідація: будь-яка зміна source → новий blob-hash → cache miss → re-classify.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const CACHE_VERSION = 1

/**
 * Хеш контенту файла (sha1, 40 hex chars). Спочатку `git hash-object`,
 * інакше sha1 контенту.
 * @param {string} filePath абсолютний шлях до файла
 * @returns {string | null} 40-char hex hash або null якщо файл недоступний
 */
export function deriveBlobHash(filePath) {
  if (!existsSync(filePath)) return null
  try {
    return execFileSync('git', ['hash-object', filePath], { encoding: 'utf8' }).trim()
  } catch {
    const content = readFileSync(filePath)
    return createHash('sha1').update(content).digest('hex')
  }
}

/**
 * Cache-ключ для конкретного мутанта в конкретному стані файла.
 * @param {string} filePath абсолютний шлях до source файла
 * @param {{line: number, col: number, replacement: string}} mutant параметри мутанта
 * @returns {string | null} ключ або null якщо файл недоступний
 */
export function deriveCacheKey(filePath, mutant) {
  const blobHash = deriveBlobHash(filePath)
  if (!blobHash) return null
  const replacement = Buffer.from(mutant.replacement, 'utf8').toString('base64url')
  return `${blobHash}:${mutant.line}:${mutant.col}:${replacement}`
}

/**
 * Читає cache з диска. При будь-якій проблемі (file absent, corrupt JSON,
 * schema/version mismatch, entries не object) — повертає empty cache.
 * @param {string} cachePath абсолютний шлях до cache.json
 * @returns {{version: number, model: string|null, entries: Record<string, object>}} cache
 */
export function readCache(cachePath) {
  const empty = { version: CACHE_VERSION, model: null, entries: {} }
  if (!existsSync(cachePath)) return empty
  try {
    const data = JSON.parse(readFileSync(cachePath, 'utf8'))
    if (data?.version !== CACHE_VERSION) return empty
    if (!data.entries || typeof data.entries !== 'object' || Array.isArray(data.entries)) return empty
    return data
  } catch {
    return empty
  }
}

/**
 * Записує cache на диск. Створює батьківські директорії.
 * @param {string} cachePath абсолютний шлях
 * @param {{version: number, model: string|null, entries: Record<string, object>}} cache cache-об'єкт
 * @returns {void}
 */
export function writeCache(cachePath, cache) {
  mkdirSync(dirname(cachePath), { recursive: true })
  writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
}
```

- [ ] **Step 4: Запустити — переконатися, що проходить**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bunx vitest run scripts/coverage-classify/tests/cache.test.mjs
```

Очікувано: PASS, 12/12 tests passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/vitaliytv/www/nitra/cursor && git add npm/scripts/coverage-classify/cache.mjs npm/scripts/coverage-classify/tests/cache.test.mjs && git commit -m "feat(coverage-classify): cache.mjs з git-blob-hash key

deriveBlobHash через git hash-object з sha1 fallback. Cache формат
v1: { version, model, entries }, інвалідується schema-mismatch чи
corrupt JSON. Round-trip + creates parent dirs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `prompt.mjs` — system/user prompts

**Files:**
- Create: `/Users/vitaliytv/www/nitra/cursor/npm/scripts/coverage-classify/prompt.mjs`
- Test: `/Users/vitaliytv/www/nitra/cursor/npm/scripts/coverage-classify/tests/prompt.test.mjs`

- [ ] **Step 1: Створити failing test**

Створити `/Users/vitaliytv/www/nitra/cursor/npm/scripts/coverage-classify/tests/prompt.test.mjs`:

```js
/**
 * Тести prompt.mjs: SYSTEM_PROMPT (статика) + buildUserPrompt (assembly).
 */
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { buildUserPrompt, SYSTEM_PROMPT } from '../prompt.mjs'
import { ensureDir, withTmpDir } from '../../utils/test-helpers.mjs'

const SAMPLE_SOURCE = `import { foo } from './foo.mjs'

export function bar() {
  if (x === 1) return 'one'
  if (x === 2) return 'two'
  return 'other'
}
`

describe('SYSTEM_PROMPT', () => {
  test('містить опис усіх 5 категорій verdict', () => {
    expect(SYSTEM_PROMPT).toContain('worth-testing')
    expect(SYSTEM_PROMPT).toContain('equivalent')
    expect(SYSTEM_PROMPT).toContain('defensive')
    expect(SYSTEM_PROMPT).toContain('glue')
    expect(SYSTEM_PROMPT).toContain('wrapper')
  })

  test('вимагає JSON-only output', () => {
    expect(SYSTEM_PROMPT).toMatch(/JSON/u)
  })

  test('містить schema constraints (reason min length, confidence range)', () => {
    expect(SYSTEM_PROMPT).toMatch(/reason/u)
    expect(SYSTEM_PROMPT).toMatch(/confidence/u)
  })
})

describe('buildUserPrompt', () => {
  test('містить mutant location, original→replacement, type', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(join(dir, 'pkg/foo.mjs'), SAMPLE_SOURCE, 'utf8')
      const mutant = {
        file: 'pkg/foo.mjs',
        line: 4,
        col: 7,
        mutantType: 'EqualityOperator',
        original: '===',
        replacement: '!=='
      }
      const prompt = buildUserPrompt(mutant, dir)
      expect(prompt).toContain('pkg/foo.mjs')
      expect(prompt).toContain('Line: 4:7')
      expect(prompt).toContain('Type: EqualityOperator')
      expect(prompt).toContain('Original code: `===`')
      expect(prompt).toContain('Mutated to: `!==`')
    })
  })

  test('додає source context ±10 рядків з номерами', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(join(dir, 'pkg/foo.mjs'), SAMPLE_SOURCE, 'utf8')
      const mutant = { file: 'pkg/foo.mjs', line: 4, col: 7, mutantType: 'X', original: 'a', replacement: 'b' }
      const prompt = buildUserPrompt(mutant, dir)
      expect(prompt).toContain('4: ')
      expect(prompt).toContain("if (x === 1) return 'one'")
    })
  })

  test('відсутній source файл → context-placeholder', async () => {
    await withTmpDir(async dir => {
      const mutant = { file: 'no/such.mjs', line: 1, col: 1, mutantType: 'X', original: 'a', replacement: 'b' }
      const prompt = buildUserPrompt(mutant, dir)
      expect(prompt).toContain('source file unavailable')
    })
  })

  test('наявний test-файл → секція "Existing tests"', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg/tests'))
      await writeFile(join(dir, 'pkg/foo.mjs'), SAMPLE_SOURCE, 'utf8')
      await writeFile(join(dir, 'pkg/tests/foo.test.mjs'), 'test("bar", () => {})\n', 'utf8')
      const mutant = { file: 'pkg/foo.mjs', line: 4, col: 7, mutantType: 'X', original: 'a', replacement: 'b' }
      const prompt = buildUserPrompt(mutant, dir)
      expect(prompt).toContain('# Existing tests')
      expect(prompt).toContain('test("bar"')
    })
  })

  test('відсутній test-файл → placeholder', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(join(dir, 'pkg/foo.mjs'), SAMPLE_SOURCE, 'utf8')
      const mutant = { file: 'pkg/foo.mjs', line: 1, col: 1, mutantType: 'X', original: 'a', replacement: 'b' }
      const prompt = buildUserPrompt(mutant, dir)
      expect(prompt).toContain('# Existing tests')
      expect(prompt).toContain('(no test file)')
    })
  })

  test('великий test-файл (>2000 рядків) → list of describe/test titles, не повний text', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg/tests'))
      await writeFile(join(dir, 'pkg/foo.mjs'), SAMPLE_SOURCE, 'utf8')
      const lines = []
      for (let i = 0; i < 2001; i++) lines.push(`// line ${i}`)
      lines.push("describe('outer', () => {")
      lines.push("  test('inner', () => {})")
      lines.push('})')
      await writeFile(join(dir, 'pkg/tests/foo.test.mjs'), lines.join('\n'), 'utf8')
      const mutant = { file: 'pkg/foo.mjs', line: 1, col: 1, mutantType: 'X', original: 'a', replacement: 'b' }
      const prompt = buildUserPrompt(mutant, dir)
      expect(prompt).toContain('describe: outer')
      expect(prompt).toContain('test: inner')
      // Повний текст НЕ повинен бути включений
      expect(prompt).not.toContain('// line 1500')
    })
  })

  test('має секцію Recent activity (git або placeholder)', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(join(dir, 'pkg/foo.mjs'), SAMPLE_SOURCE, 'utf8')
      const mutant = { file: 'pkg/foo.mjs', line: 1, col: 1, mutantType: 'X', original: 'a', replacement: 'b' }
      const prompt = buildUserPrompt(mutant, dir)
      expect(prompt).toContain('# Recent activity')
    })
  })
})
```

- [ ] **Step 2: Запустити — переконатися, що падає**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bunx vitest run scripts/coverage-classify/tests/prompt.test.mjs
```

Очікувано: FAIL з `Cannot find module '../prompt.mjs'`.

- [ ] **Step 3: Створити implementation**

Створити `/Users/vitaliytv/www/nitra/cursor/npm/scripts/coverage-classify/prompt.mjs`:

```js
/**
 * Промпт-builder для coverage-classify.
 * SYSTEM_PROMPT — статичний, кешується через cache_control: ephemeral у API call.
 * buildUserPrompt — асемблює per-mutant контекст (location, source ±10, tests, git).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const CONTEXT_LINES = 10
const TEST_FILE_MAX_LINES = 2000

export const SYSTEM_PROMPT = `You are a mutation testing classifier.

For each survived Stryker mutant, classify it into exactly one verdict:

- **worth-testing**: pure logic with real branches that should be tested. The mutant
  exposes a missing assertion in a unit test. Recommend a test approach.
- **equivalent**: the mutated code is behaviorally indistinguishable from the original
  (e.g., both branches produce the same observable output, or the mutant lies on dead
  code). You MUST cite a concrete reason referencing input flow or output equivalence.
- **defensive**: the branch guards against an impossible state given input contracts
  or type system. You MUST identify the invariant that makes the state unreachable.
- **glue**: thin CLI entrypoint, factory, or boilerplate (e.g., runStandardRule
  wrapper, fix.mjs stubs). Integration tests via subprocess cover the behavior.
  Name the integration test or pattern.
- **wrapper**: thin shell around an external tool (spawnSync, fetch, dynamic import).
  The wrapper has no logic worth unit-testing in isolation; behavior comes from the
  wrapped tool. Name the integration test or pattern.

Output ONLY a single JSON object matching this schema:

\`\`\`
{
  "verdict": "worth-testing" | "equivalent" | "defensive" | "glue" | "wrapper",
  "confidence": number 0-1,
  "reason": string (20-500 chars; concrete code-level reference, not "seems like"),
  "suggestedTest": string (max 300 chars; required only when verdict is worth-testing)
}
\`\`\`

Confidence guidance:
- 0.9+: cite specific code fragment, identifier, or input contract proving the verdict.
- 0.7-0.9: strong inference from visible code structure.
- <0.7: ambiguity, lacking context, or unfamiliar pattern. Be honest.

Never invent integration test names. If you cannot identify a covering test, use
worth-testing with low confidence instead of glue/wrapper.
`

/**
 * Витягує describe/test/it title з рядка тексту.
 * @param {string} content повний текст test-файла
 * @returns {string} список "describe: <title>" / "test: <title>" або порожній
 */
function extractTestTitles(content) {
  const titles = []
  for (const match of content.matchAll(/^\s*(describe|test|it)\(['"`](.+?)['"`]/gmu)) {
    titles.push(`${match[1]}: ${match[2]}`)
  }
  return titles.join('\n') || '(no describe/test blocks found)'
}

/**
 * Будує користувацький промпт для класифікації одного мутанта.
 * @param {{file: string, line: number, col: number, mutantType: string, original: string, replacement: string}} mutant параметри мутанта (file — відносний до cwd)
 * @param {string} cwd корінь проєкту
 * @returns {string} user prompt
 */
export function buildUserPrompt(mutant, cwd) {
  const absPath = join(cwd, mutant.file)

  // Source context
  let srcContext = '(source file unavailable)'
  if (existsSync(absPath)) {
    const lines = readFileSync(absPath, 'utf8').split('\n')
    const start = Math.max(0, mutant.line - 1 - CONTEXT_LINES)
    const end = Math.min(lines.length, mutant.line + CONTEXT_LINES)
    srcContext = lines
      .slice(start, end)
      .map((l, i) => `${start + i + 1}: ${l}`)
      .join('\n')
  }

  // Existing tests
  const testPath = join(dirname(absPath), 'tests', `${basename(absPath, '.mjs')}.test.mjs`)
  let existingTests = '(no test file)'
  if (existsSync(testPath)) {
    const content = readFileSync(testPath, 'utf8')
    if (content.split('\n').length > TEST_FILE_MAX_LINES) {
      existingTests = extractTestTitles(content)
    } else {
      existingTests = content
    }
  }

  // Recent git activity (graceful если нет git або untracked)
  let recentActivity = '(no git history)'
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ar', '--', absPath], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    if (out) recentActivity = out
  } catch {
    // git unavailable or file untracked — keep placeholder
  }

  return `# Mutant
File: ${mutant.file}
Line: ${mutant.line}:${mutant.col}
Type: ${mutant.mutantType}
Original code: \`${mutant.original}\`
Mutated to: \`${mutant.replacement}\`

# Source context (±${CONTEXT_LINES} lines)
${srcContext}

# Existing tests
${existingTests}

# Recent activity
File last modified: ${recentActivity}
`
}
```

- [ ] **Step 4: Запустити — переконатися, що проходить**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bunx vitest run scripts/coverage-classify/tests/prompt.test.mjs
```

Очікувано: PASS, 10/10 tests passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/vitaliytv/www/nitra/cursor && git add npm/scripts/coverage-classify/prompt.mjs npm/scripts/coverage-classify/tests/prompt.test.mjs && git commit -m "feat(coverage-classify): SYSTEM_PROMPT + buildUserPrompt (TDD)

System prompt описує 5 категорій verdict з constraints на reason
(20-500 chars, concrete code-ref) і confidence (cite source-level
докази для >0.9). User prompt включає mutant location, source ±10,
existing tests (повний < 2000 LOC, інакше — titles), git recent
activity.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `apply.mjs` — фільтрація rows за verdicts

**Files:**
- Create: `/Users/vitaliytv/www/nitra/cursor/npm/scripts/coverage-classify/apply.mjs`
- Test: `/Users/vitaliytv/www/nitra/cursor/npm/scripts/coverage-classify/tests/apply.test.mjs`

- [ ] **Step 1: Створити failing test**

Створити `/Users/vitaliytv/www/nitra/cursor/npm/scripts/coverage-classify/tests/apply.test.mjs`:

```js
/**
 * Тести apply.mjs:
 *   - isAllowedGap: verdict ∈ {equivalent,defensive,glue,wrapper} AND confidence ≥ threshold
 *   - applyVerdicts: фільтрує rows.survived, повертає augmented rows + allowedGaps[]
 */
import { describe, expect, test } from 'vitest'

import { applyVerdicts, isAllowedGap } from '../apply.mjs'

const REASON = 'Branch is covered by integration test runStandardRule'

function row(survived) {
  return {
    area: 'JS',
    coverage: { lines: { covered: 10, total: 20 }, functions: { covered: 5, total: 10 } },
    mutation: { caught: 8, total: 10 },
    survived
  }
}

describe('isAllowedGap', () => {
  test('equivalent + confidence ≥ threshold → true', () => {
    const v = { verdict: 'equivalent', confidence: 0.85, reason: REASON }
    expect(isAllowedGap(v, 0.7)).toBe(true)
  })

  test('worth-testing навіть з confidence=1 → false', () => {
    const v = { verdict: 'worth-testing', confidence: 1, reason: REASON }
    expect(isAllowedGap(v, 0.7)).toBe(false)
  })

  test('defensive/glue/wrapper з достатньою confidence → true', () => {
    for (const verdict of ['defensive', 'glue', 'wrapper']) {
      expect(isAllowedGap({ verdict, confidence: 0.75, reason: REASON }, 0.7)).toBe(true)
    }
  })

  test('equivalent з confidence < threshold → false (conservative)', () => {
    const v = { verdict: 'equivalent', confidence: 0.6, reason: REASON }
    expect(isAllowedGap(v, 0.7)).toBe(false)
  })

  test('threshold = 1.1 → завжди false (rollout mode)', () => {
    const v = { verdict: 'equivalent', confidence: 1.0, reason: REASON }
    expect(isAllowedGap(v, 1.1)).toBe(false)
  })
})

describe('applyVerdicts', () => {
  const mkSurvived = file => ({
    file,
    mutants: [
      { line: 1, col: 1, mutantType: 'X', original: 'a', replacement: 'b' },
      { line: 2, col: 2, mutantType: 'Y', original: 'c', replacement: 'd' }
    ],
    exampleTest: null,
    recommendationText: null
  })

  test('всі verdicts worth-testing → нічого не фільтрується', () => {
    const rows = [row([mkSurvived('foo.mjs')])]
    const verdicts = [
      { key: 'foo.mjs:1:1:b', verdict: { verdict: 'worth-testing', confidence: 0.9, reason: REASON } },
      { key: 'foo.mjs:2:2:d', verdict: { verdict: 'worth-testing', confidence: 0.9, reason: REASON } }
    ]
    const result = applyVerdicts(rows, verdicts, 0.7)
    expect(result.allowedGaps).toEqual([])
    expect(result.rows[0].survived[0].mutants).toHaveLength(2)
    expect(result.rows[0].mutation.total).toBe(10)
  })

  test('усі verdicts equivalent → всі мутанти переходять в allowedGaps', () => {
    const rows = [row([mkSurvived('foo.mjs')])]
    const verdicts = [
      { key: 'foo.mjs:1:1:b', verdict: { verdict: 'equivalent', confidence: 0.9, reason: REASON } },
      { key: 'foo.mjs:2:2:d', verdict: { verdict: 'equivalent', confidence: 0.9, reason: REASON } }
    ]
    const result = applyVerdicts(rows, verdicts, 0.7)
    expect(result.allowedGaps).toHaveLength(2)
    expect(result.rows[0].survived).toEqual([])
    expect(result.rows[0].mutation.total).toBe(8) // 10 - 2 allowed
  })

  test('частковий — 1 equivalent, 1 worth-testing → 1 в allowedGaps, 1 залишається', () => {
    const rows = [row([mkSurvived('foo.mjs')])]
    const verdicts = [
      { key: 'foo.mjs:1:1:b', verdict: { verdict: 'equivalent', confidence: 0.9, reason: REASON } },
      { key: 'foo.mjs:2:2:d', verdict: { verdict: 'worth-testing', confidence: 0.8, reason: REASON } }
    ]
    const result = applyVerdicts(rows, verdicts, 0.7)
    expect(result.allowedGaps).toHaveLength(1)
    expect(result.allowedGaps[0].file).toBe('foo.mjs')
    expect(result.rows[0].survived).toHaveLength(1)
    expect(result.rows[0].survived[0].mutants).toHaveLength(1)
    expect(result.rows[0].survived[0].mutants[0].line).toBe(2)
    expect(result.rows[0].mutation.total).toBe(9)
  })

  test('threshold = 1.1 (rollout) → нічого не фільтрується незалежно від verdict', () => {
    const rows = [row([mkSurvived('foo.mjs')])]
    const verdicts = [
      { key: 'foo.mjs:1:1:b', verdict: { verdict: 'equivalent', confidence: 1.0, reason: REASON } }
    ]
    const result = applyVerdicts(rows, verdicts, 1.1)
    expect(result.allowedGaps).toEqual([])
    expect(result.rows[0].survived[0].mutants).toHaveLength(2)
  })

  test('verdict без відповідного key → mutant НЕ фільтрується (conservative)', () => {
    const rows = [row([mkSurvived('foo.mjs')])]
    const verdicts = [] // нема verdicts взагалі
    const result = applyVerdicts(rows, verdicts, 0.7)
    expect(result.allowedGaps).toEqual([])
    expect(result.rows[0].survived[0].mutants).toHaveLength(2)
  })

  test('rows без survived → no-op, без мутацій rows', () => {
    const rows = [{ ...row(), survived: undefined }]
    const result = applyVerdicts(rows, [], 0.7)
    expect(result.allowedGaps).toEqual([])
    expect(result.rows[0].mutation.total).toBe(10)
  })

  test('multiple rows, partial overlap у verdicts', () => {
    const rows = [row([mkSurvived('a.mjs')]), row([mkSurvived('b.mjs')])]
    const verdicts = [
      { key: 'a.mjs:1:1:b', verdict: { verdict: 'glue', confidence: 0.9, reason: REASON } },
      { key: 'b.mjs:2:2:d', verdict: { verdict: 'wrapper', confidence: 0.9, reason: REASON } }
    ]
    const result = applyVerdicts(rows, verdicts, 0.7)
    expect(result.allowedGaps).toHaveLength(2)
    expect(result.rows[0].survived[0].mutants).toHaveLength(1)
    expect(result.rows[1].survived[0].mutants).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Запустити — переконатися, що падає**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bunx vitest run scripts/coverage-classify/tests/apply.test.mjs
```

Очікувано: FAIL з `Cannot find module '../apply.mjs'`.

- [ ] **Step 3: Створити implementation**

Створити `/Users/vitaliytv/www/nitra/cursor/npm/scripts/coverage-classify/apply.mjs`:

```js
/**
 * Застосовує verdicts до coverage rows: фільтрує survived мутантів,
 * декрементує mutation.total на кількість allowed-gaps, повертає окремий
 * список allowedGaps для рендеру в COVERAGE.md.
 *
 * Skip rule: verdict ∈ {equivalent,defensive,glue,wrapper} AND confidence ≥ threshold.
 * Решта (включно з worth-testing і low-confidence skip-verdicts) залишаються в survived.
 */

const SKIP_VERDICTS = new Set(['equivalent', 'defensive', 'glue', 'wrapper'])

/**
 * Чи verdict кваліфікує мутанта як allowed-gap (виключити з Killable).
 * @param {{verdict: string, confidence: number}} verdict verdict-об'єкт
 * @param {number} threshold confidence threshold (наприклад 0.7)
 * @returns {boolean} true якщо мутант — allowed gap
 */
export function isAllowedGap(verdict, threshold) {
  return SKIP_VERDICTS.has(verdict.verdict) && verdict.confidence >= threshold
}

/**
 * Застосовує verdicts до coverage rows. Фільтрує `survived` за isAllowedGap,
 * зменшує `mutation.total` на скільки мутантів стало allowed-gap.
 * Не мутує вхідні дані.
 * @param {Array<{area: string, coverage: object, mutation: {caught: number, total: number}, survived?: Array<{file: string, mutants: Array<object>, exampleTest?: object|null, recommendationText?: string|null}>}>} rows вхідні рядки
 * @param {Array<{key: string, verdict: {verdict: string, confidence: number, reason: string}}>} verdicts класифіковані verdict-и
 * @param {number} threshold confidence threshold для allowed-gap
 * @returns {{rows: Array<object>, allowedGaps: Array<{file: string, mutant: object, verdict: object}>}} augmented rows + список allowed-gaps
 */
export function applyVerdicts(rows, verdicts, threshold) {
  const verdictByKey = new Map()
  for (const { key, verdict } of verdicts) verdictByKey.set(key, verdict)

  const allowedGaps = []

  const augmentedRows = rows.map(row => {
    const survived = row.survived ?? []
    let skippedCount = 0
    const remainingSurvived = []

    for (const group of survived) {
      const remainingMutants = []
      for (const mutant of group.mutants) {
        const key = `${group.file}:${mutant.line}:${mutant.col}:${mutant.replacement}`
        const verdict = verdictByKey.get(key)
        if (verdict && isAllowedGap(verdict, threshold)) {
          allowedGaps.push({ file: group.file, mutant, verdict })
          skippedCount += 1
        } else {
          remainingMutants.push(mutant)
        }
      }
      if (remainingMutants.length > 0) {
        remainingSurvived.push({ ...group, mutants: remainingMutants })
      }
    }

    return {
      ...row,
      survived: remainingSurvived,
      mutation: { ...row.mutation, total: row.mutation.total - skippedCount }
    }
  })

  return { rows: augmentedRows, allowedGaps }
}
```

- [ ] **Step 4: Запустити — переконатися, що проходить**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bunx vitest run scripts/coverage-classify/tests/apply.test.mjs
```

Очікувано: PASS, 12/12 tests passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/vitaliytv/www/nitra/cursor && git add npm/scripts/coverage-classify/apply.mjs npm/scripts/coverage-classify/tests/apply.test.mjs && git commit -m "feat(coverage-classify): applyVerdicts + isAllowedGap (TDD)

Skip rule: verdict ∈ {equivalent,defensive,glue,wrapper} AND
confidence ≥ threshold. Worth-testing і low-confidence skip-verdicts
залишаються в survived (conservative). mutation.total
декрементується на кількість allowed-gaps — це і дає Killable
mutation score.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `index.mjs` — orchestration + SDK integration

**Files:**
- Create: `/Users/vitaliytv/www/nitra/cursor/npm/scripts/coverage-classify/index.mjs`
- Test: `/Users/vitaliytv/www/nitra/cursor/npm/scripts/coverage-classify/tests/index.test.mjs`

- [ ] **Step 1: Створити failing test**

Створити `/Users/vitaliytv/www/nitra/cursor/npm/scripts/coverage-classify/tests/index.test.mjs`:

```js
/**
 * Тести index.mjs (classify orchestrator):
 *   - Anthropic SDK мокається через vi.mock
 *   - cache hit/miss/write
 *   - graceful skip без API key / без SDK
 *   - retry на API error → conservative fallback
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { withTmpDir } from '../../utils/test-helpers.mjs'

const REASON = 'Branch is covered by integration test runStandardRule wrapper'

let mockCreate
vi.mock('@anthropic-ai/sdk', () => {
  const fn = (...args) => mockCreate(...args)
  class Anthropic {
    constructor() {
      this.messages = { create: fn }
    }
  }
  return { default: Anthropic }
})

const { classify } = await import('../index.mjs')

const SAMPLE = `export function foo() {
  if (x === 1) return 'a'
  return 'b'
}
`

function survivedFixture(file) {
  return [
    {
      file,
      mutants: [
        { line: 2, col: 7, mutantType: 'EqualityOperator', original: '===', replacement: '!==' }
      ],
      exampleTest: null,
      recommendationText: null
    }
  ]
}

function mockResponse(verdictJson) {
  return {
    content: [{ type: 'text', text: JSON.stringify(verdictJson) }]
  }
}

describe('classify', () => {
  beforeEach(() => {
    mockCreate = vi.fn()
    process.env.ANTHROPIC_API_KEY = 'test-key'
    vi.spyOn(console, 'warn').mockReturnValue()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.ANTHROPIC_API_KEY
  })

  test('класифікує один мутант → повертає verdict з key', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'foo.mjs'), SAMPLE, 'utf8')
      const cachePath = join(dir, 'cache.json')
      mockCreate.mockResolvedValueOnce(
        mockResponse({ verdict: 'worth-testing', confidence: 0.85, reason: REASON })
      )
      const result = await classify(survivedFixture('foo.mjs'), dir, { cachePath })
      expect(result).toHaveLength(1)
      expect(result[0].key).toBe('foo.mjs:2:7:!==')
      expect(result[0].verdict.verdict).toBe('worth-testing')
    })
  })

  test('cache hit на 2-му виклику → SDK не викликається', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'foo.mjs'), SAMPLE, 'utf8')
      const cachePath = join(dir, 'cache.json')
      mockCreate.mockResolvedValueOnce(
        mockResponse({ verdict: 'equivalent', confidence: 0.9, reason: REASON })
      )
      await classify(survivedFixture('foo.mjs'), dir, { cachePath })
      expect(mockCreate).toHaveBeenCalledTimes(1)

      // другий запуск — той самий source, той самий mutant → cache hit
      const r2 = await classify(survivedFixture('foo.mjs'), dir, { cachePath })
      expect(mockCreate).toHaveBeenCalledTimes(1) // не змінилося
      expect(r2[0].verdict.verdict).toBe('equivalent')
    })
  })

  test('ANTHROPIC_API_KEY unset → warn-and-skip, повертає []', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'foo.mjs'), SAMPLE, 'utf8')
      delete process.env.ANTHROPIC_API_KEY
      const result = await classify(survivedFixture('foo.mjs'), dir, { cachePath: join(dir, 'c.json') })
      expect(result).toEqual([])
      expect(mockCreate).not.toHaveBeenCalled()
    })
  })

  test('API throws → retry → fallback verdict worth-testing (conservative)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'foo.mjs'), SAMPLE, 'utf8')
      mockCreate.mockRejectedValue(new Error('500 server error'))
      const result = await classify(survivedFixture('foo.mjs'), dir, {
        cachePath: join(dir, 'c.json'),
        retryDelayMs: 0
      })
      expect(result).toHaveLength(1)
      expect(result[0].verdict.verdict).toBe('worth-testing')
      expect(result[0].verdict.confidence).toBe(0)
      // повторено 3 рази (initial + 2 retries) перед fallback
      expect(mockCreate).toHaveBeenCalledTimes(3)
    })
  })

  test('invalid JSON у відповіді → один retry → якщо знову bad — fallback', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'foo.mjs'), SAMPLE, 'utf8')
      mockCreate
        .mockResolvedValueOnce({ content: [{ type: 'text', text: 'not json' }] })
        .mockResolvedValueOnce({ content: [{ type: 'text', text: 'still not json' }] })
        .mockResolvedValueOnce({ content: [{ type: 'text', text: 'never json' }] })
      const result = await classify(survivedFixture('foo.mjs'), dir, {
        cachePath: join(dir, 'c.json'),
        retryDelayMs: 0
      })
      expect(result[0].verdict.verdict).toBe('worth-testing')
      expect(result[0].verdict.confidence).toBe(0)
    })
  })

  test('class з кеш-міс і ще раз — записує verdict у cache', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'foo.mjs'), SAMPLE, 'utf8')
      const cachePath = join(dir, 'cache.json')
      mockCreate.mockResolvedValueOnce(
        mockResponse({ verdict: 'glue', confidence: 0.8, reason: REASON })
      )
      await classify(survivedFixture('foo.mjs'), dir, { cachePath })
      const { readFileSync } = await import('node:fs')
      const cached = JSON.parse(readFileSync(cachePath, 'utf8'))
      expect(Object.keys(cached.entries)).toHaveLength(1)
      const entry = Object.values(cached.entries)[0]
      expect(entry.verdict).toBe('glue')
      expect(entry.confidence).toBe(0.8)
      expect(entry.classifiedAt).toBeTruthy()
    })
  })

  test('cache model mismatch → entries очищаються', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'foo.mjs'), SAMPLE, 'utf8')
      const cachePath = join(dir, 'cache.json')
      const { writeFileSync } = await import('node:fs')
      writeFileSync(
        cachePath,
        JSON.stringify({
          version: 1,
          model: 'old-model',
          entries: { 'fake-key': { verdict: 'glue', confidence: 0.9, reason: REASON, classifiedAt: 'x' } }
        }),
        'utf8'
      )
      mockCreate.mockResolvedValueOnce(
        mockResponse({ verdict: 'equivalent', confidence: 0.9, reason: REASON })
      )
      await classify(survivedFixture('foo.mjs'), dir, { cachePath })
      expect(mockCreate).toHaveBeenCalledTimes(1) // не cache hit бо model змінилася
    })
  })

  test('кілька груп / мутантів — обробляються послідовно', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'a.mjs'), SAMPLE, 'utf8')
      await writeFile(join(dir, 'b.mjs'), SAMPLE, 'utf8')
      const cachePath = join(dir, 'cache.json')
      mockCreate.mockResolvedValue(
        mockResponse({ verdict: 'worth-testing', confidence: 0.8, reason: REASON })
      )
      const survived = [...survivedFixture('a.mjs'), ...survivedFixture('b.mjs')]
      const result = await classify(survived, dir, { cachePath })
      expect(result).toHaveLength(2)
      expect(result[0].key.startsWith('a.mjs:')).toBe(true)
      expect(result[1].key.startsWith('b.mjs:')).toBe(true)
    })
  })
})
```

- [ ] **Step 2: Запустити — переконатися, що падає**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bunx vitest run scripts/coverage-classify/tests/index.test.mjs
```

Очікувано: FAIL з `Cannot find module '../index.mjs'`.

- [ ] **Step 3: Створити implementation**

Створити `/Users/vitaliytv/www/nitra/cursor/npm/scripts/coverage-classify/index.mjs`:

```js
/**
 * Public API класифікатора: classify(survived, cwd, opts) → verdicts[]
 *
 * Orchestration:
 *   1. Перевірка ANTHROPIC_API_KEY + dynamic import SDK (graceful skip).
 *   2. Для кожного мутанта: cache lookup → класифікація → cache write.
 *   3. На неуспішну класифікацію після retries — conservative fallback worth-testing/confidence=0.
 *
 * Prompt caching: system-prompt передається з cache_control: ephemeral —
 * усі мутанти одного прогону reuse кешований префікс на стороні API.
 */
import { join } from 'node:path'

import { deriveCacheKey, readCache, writeCache } from './cache.mjs'
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt.mjs'
import { parseVerdict } from './verdict-schema.mjs'

const MODEL = 'claude-sonnet-4-6'
const MAX_RETRIES = 2
const DEFAULT_RETRY_DELAY_MS = 1000

const FALLBACK_VERDICT = {
  verdict: 'worth-testing',
  confidence: 0,
  reason: 'LLM-classification unavailable, conservative fallback (treat as worth-testing)'
}

/**
 * Класифікує survived мутантів через Claude API.
 * Без API key / без SDK / при критичних помилках — повертає [] (graceful skip).
 * @param {Array<{file: string, mutants: Array<object>, exampleTest?: object|null, recommendationText?: string|null}>} survived список survived груп (як у COVERAGE.md)
 * @param {string} cwd корінь проєкту
 * @param {{cachePath?: string, client?: object, retryDelayMs?: number}} [opts] ін'єкції для тестів
 * @returns {Promise<Array<{key: string, verdict: object}>>} verdicts
 */
export async function classify(survived, cwd, opts = {}) {
  const cachePath = opts.cachePath ?? join(cwd, 'npm/reports/coverage-classify.cache.json')
  const retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS

  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠ coverage classify: ANTHROPIC_API_KEY not set, classification skipped')
    return []
  }

  let SDK
  try {
    SDK = await import('@anthropic-ai/sdk')
  } catch {
    console.warn('⚠ coverage classify: @anthropic-ai/sdk not installed, classification skipped')
    return []
  }
  const Anthropic = SDK.default
  const client = opts.client ?? new Anthropic()

  const cache = readCache(cachePath)
  if (cache.model !== MODEL) {
    cache.entries = {}
    cache.model = MODEL
  }

  const verdicts = []
  for (const group of survived) {
    for (const mutant of group.mutants) {
      const lookupKey = `${group.file}:${mutant.line}:${mutant.col}:${mutant.replacement}`
      const cacheKey = deriveCacheKey(join(cwd, group.file), mutant)

      let verdict = null
      if (cacheKey && cache.entries[cacheKey]) {
        const cached = cache.entries[cacheKey]
        verdict = {
          verdict: cached.verdict,
          confidence: cached.confidence,
          reason: cached.reason,
          ...(cached.suggestedTest ? { suggestedTest: cached.suggestedTest } : {})
        }
      }
      if (!verdict) {
        verdict = await classifyOne(client, group, mutant, cwd, retryDelayMs)
        if (cacheKey) {
          cache.entries[cacheKey] = { ...verdict, classifiedAt: new Date().toISOString() }
        }
      }

      verdicts.push({ key: lookupKey, verdict })
    }
  }

  writeCache(cachePath, cache)
  return verdicts
}

/**
 * Один виклик API з retry. На фейл після MAX_RETRIES — повертає FALLBACK_VERDICT.
 * @param {{messages: {create: Function}}} client SDK client
 * @param {{file: string}} group group для контексту
 * @param {object} mutant mutant data
 * @param {string} cwd корінь
 * @param {number} retryDelayMs base delay для exp-backoff (0 у тестах)
 * @returns {Promise<object>} verdict (parsed або fallback)
 */
async function classifyOne(client, group, mutant, cwd, retryDelayMs) {
  const userPrompt = buildUserPrompt({ ...mutant, file: group.file }, cwd)
  let lastError = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userPrompt }]
      })
      const text = response?.content?.[0]?.text ?? ''
      return parseVerdict(text)
    } catch (err) {
      lastError = err
      if (attempt < MAX_RETRIES && retryDelayMs > 0) {
        await new Promise(r => setTimeout(r, retryDelayMs * Math.pow(2, attempt)))
      }
    }
  }

  console.warn(
    `⚠ coverage classify: ${group.file}:${mutant.line}:${mutant.col} failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message ?? 'unknown'}`
  )
  return { ...FALLBACK_VERDICT }
}
```

- [ ] **Step 4: Запустити — переконатися, що проходить**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bunx vitest run scripts/coverage-classify/tests/index.test.mjs
```

Очікувано: PASS, 8/8 tests passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/vitaliytv/www/nitra/cursor && git add npm/scripts/coverage-classify/index.mjs npm/scripts/coverage-classify/tests/index.test.mjs && git commit -m "feat(coverage-classify): index.mjs — orchestrator з retry + fallback

classify(survived, cwd) — public API. Graceful skip без API key чи
SDK. Cache lookup → класифікація → cache write. На фейл після 2
retries — conservative fallback worth-testing/confidence=0
(зберігає мутант у Killable знаменнику).

System prompt передається з cache_control ephemeral — prompt caching
на стороні API скорочує вартість.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Інтеграція у `coverage.mjs` + рендер allowed-gaps

**Files:**
- Modify: `/Users/vitaliytv/www/nitra/cursor/npm/rules/test/coverage/coverage.mjs`
- Modify: `/Users/vitaliytv/www/nitra/cursor/npm/rules/test/coverage/tests/coverage.test.mjs`

- [ ] **Step 1: Додати failing test для нового рендерінгу `renderMarkdown` з `allowedGaps`**

Додати в кінець файлу `/Users/vitaliytv/www/nitra/cursor/npm/rules/test/coverage/tests/coverage.test.mjs` (перед закриваючим `})` останнього describe):

```js
describe('renderMarkdown — allowed gaps section', () => {
  test('коли allowedGaps непустий — додається секція "## Allowed gaps"', () => {
    const rows = [
      {
        area: 'JS',
        coverage: { lines: { covered: 10, total: 20 }, functions: { covered: 5, total: 10 } },
        mutation: { caught: 3, total: 4 } // total зменшений на 1 allowed-gap
      }
    ]
    const allowedGaps = [
      {
        file: 'src/auth.js',
        mutant: { line: 12, col: 0, mutantType: 'BooleanLiteral', original: 'true', replacement: 'false' },
        verdict: { verdict: 'equivalent', confidence: 0.92, reason: 'Both branches return falsy from same upstream' }
      }
    ]
    const md = renderMarkdown(rows, allowedGaps)
    expect(md).toContain('## Allowed gaps')
    expect(md).toContain('### src/auth.js')
    expect(md).toContain('equivalent')
    expect(md).toContain('0.92')
    expect(md).toContain('Both branches return falsy')
  })

  test('коли allowedGaps пустий — секція не додається', () => {
    const rows = [
      {
        area: 'JS',
        coverage: { lines: { covered: 10, total: 20 }, functions: { covered: 5, total: 10 } },
        mutation: { caught: 5, total: 5 }
      }
    ]
    expect(renderMarkdown(rows, [])).not.toContain('## Allowed gaps')
  })

  test('коли allowedGaps undefined (legacy callers) — секція не додається', () => {
    const rows = [
      {
        area: 'JS',
        coverage: { lines: { covered: 10, total: 20 }, functions: { covered: 5, total: 10 } },
        mutation: { caught: 5, total: 5 }
      }
    ]
    expect(renderMarkdown(rows)).not.toContain('## Allowed gaps')
  })
})
```

- [ ] **Step 2: Запустити — переконатися, що падає**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bunx vitest run rules/test/coverage/tests/coverage.test.mjs -t "Allowed gaps"
```

Очікувано: FAIL — секція не рендериться, бо `renderMarkdown` не приймає `allowedGaps`.

- [ ] **Step 3: Розширити `renderMarkdown` у `coverage.mjs`**

Знайти у файлі `/Users/vitaliytv/www/nitra/cursor/npm/rules/test/coverage/coverage.mjs` сигнатуру `export function renderMarkdown(rows) {` і замінити функцію цілком на:

```js
export function renderMarkdown(rows, allowedGaps = []) {
  const lines = [
    '# Coverage',
    '',
    '| Область | Рядки | Функції | Вбито мутацій | Score |',
    '| --- | --- | --- | --- | --- |'
  ]
  for (const row of rows) {
    lines.push(
      `| ${row.area} | ${formatCoverage(row.coverage.lines)} | ${formatCoverage(row.coverage.functions)} | ` +
        `${row.mutation.caught}/${row.mutation.total} | ${formatScore(row.mutation)} |`
    )
  }

  const allSurvived = rows.flatMap(r => r.survived ?? [])
  if (allSurvived.length > 0) {
    lines.push('', '## Вцілілі мутанти', '', '```json', JSON.stringify(allSurvived, null, 2), '```')
    // Зрозуміла для людини таблиця
    for (const group of allSurvived) {
      lines.push('', `### ${group.file}`, '', '| Рядок | Оригінал | Заміна | Тип |', '| --- | --- | --- | --- |')
      for (const m of group.mutants) {
        lines.push(`| ${m.line} | \`${m.original}\` | \`${m.replacement}\` | ${m.mutantType} |`)
      }
      if (group.exampleTest) {
        lines.push(
          '',
          `**Приклад тесту** (\`${group.exampleTest.testFile}\`):`,
          '',
          '```js',
          group.exampleTest.code ?? '',
          '```'
        )
      }
      if (group.recommendationText) {
        lines.push('', '**Що треба протестувати:**', '', group.recommendationText)
      }
    }
  }

  if (allowedGaps.length > 0) {
    // Group allowed gaps by file
    const gapsByFile = new Map()
    for (const gap of allowedGaps) {
      if (!gapsByFile.has(gap.file)) gapsByFile.set(gap.file, [])
      gapsByFile.get(gap.file).push(gap)
    }

    lines.push('', '## Allowed gaps', '')
    lines.push(`> LLM-класифікатор виключив ${allowedGaps.length} survived мутант(ів) зі знаменника mutation score.`)
    lines.push('> Категорії: equivalent (поведінково еквівалентний), defensive (impossible state), glue/wrapper (integration test покриває).')

    for (const [file, gaps] of gapsByFile) {
      lines.push('', `### ${file}`, '', '| Line | Mutant | Verdict | Confidence | Reason |', '| --- | --- | --- | --- | --- |')
      for (const { mutant, verdict } of gaps) {
        const sanitizedReason = verdict.reason.replaceAll('|', '\\|').replaceAll('\n', ' ')
        lines.push(
          `| ${mutant.line} | \`${mutant.original}\` → \`${mutant.replacement}\` | ${verdict.verdict} | ${verdict.confidence.toFixed(2)} | ${sanitizedReason} |`
        )
      }
    }
  }

  return `${lines.join('\n')}\n`
}
```

- [ ] **Step 4: Запустити — переконатися, що нові тести проходять**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bunx vitest run rules/test/coverage/tests/coverage.test.mjs -t "Allowed gaps"
```

Очікувано: PASS, 3/3 tests passed.

- [ ] **Step 5: Перевірити, що ВСІ існуючі coverage-тести ще проходять**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bunx vitest run rules/test/coverage/tests/coverage.test.mjs
```

Очікувано: PASS, всі попередні тести + 3 нові = 60/60.

- [ ] **Step 6: Інтегрувати виклик `classify` + `applyVerdicts` у `runCoverageSteps`**

У файлі `/Users/vitaliytv/www/nitra/cursor/npm/rules/test/coverage/coverage.mjs`:

Додати імпорти у верх (після існуючих imports):

```js
import { readFile } from 'node:fs/promises'

import { classify } from '../../../scripts/coverage-classify/index.mjs'
import { applyVerdicts } from '../../../scripts/coverage-classify/apply.mjs'
```

Замість існуючого блоку (поточний від `rows.push(buildTotalsRow(rows))` до `await writeFile(...)`):

```js
  rows.push(buildTotalsRow(rows))
  const md = renderMarkdown(rows)
  // Stryker disable next-line StringLiteral: equivalent – writeFile(path, str, '') behaves identically to 'utf8' in Node/Bun
  await writeFile(join(cwd, 'COVERAGE.md'), md, 'utf8')
```

Замінити на:

```js
  // LLM-класифікація survived мутантів (graceful skip без API key)
  const allSurvived = rows.flatMap(r => r.survived ?? [])
  let augmentedRows = rows
  let allowedGaps = []
  if (allSurvived.length > 0) {
    const verdicts = await classify(allSurvived, cwd)
    if (verdicts.length > 0) {
      const threshold = await readClassifyThreshold(cwd)
      const applied = applyVerdicts(rows, verdicts, threshold)
      augmentedRows = applied.rows
      allowedGaps = applied.allowedGaps
    }
  }

  augmentedRows.push(buildTotalsRow(augmentedRows.filter(r => r.area !== '**Разом**')))
  const md = renderMarkdown(augmentedRows, allowedGaps)
  // Stryker disable next-line StringLiteral: equivalent – writeFile(path, str, '') behaves identically to 'utf8' in Node/Bun
  await writeFile(join(cwd, 'COVERAGE.md'), md, 'utf8')
```

Додати приватну допоміжну функцію перед `export async function runCoverageSteps`:

```js
/**
 * Читає `.n-cursor.json#coverage.classifyConfidenceThreshold` (default 1.1 — rollout mode).
 * @param {string} cwd корінь проєкту
 * @returns {Promise<number>} threshold у [0, 1.1]
 */
async function readClassifyThreshold(cwd) {
  try {
    const raw = await readFile(join(cwd, '.n-cursor.json'), 'utf8')
    const parsed = JSON.parse(raw)
    const t = parsed?.coverage?.classifyConfidenceThreshold
    return typeof t === 'number' && Number.isFinite(t) ? t : 1.1
  } catch {
    return 1.1
  }
}
```

- [ ] **Step 7: Запустити повний test-suite — переконатися, що нічого не зламалося**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm && bunx vitest run rules/test/coverage/tests/coverage.test.mjs scripts/coverage-classify/tests/
```

Очікувано: всі тести проходять. Якщо `coverage.test.mjs` має тести, що дзвонять `runCoverageSteps` без API key — vi.mock не активний для `@anthropic-ai/sdk` → `classify` повинен повертати `[]` (graceful skip).

- [ ] **Step 8: Commit**

```bash
cd /Users/vitaliytv/www/nitra/cursor && git add npm/rules/test/coverage/coverage.mjs npm/rules/test/coverage/tests/coverage.test.mjs && git commit -m "feat(coverage): integrate coverage-classify у runCoverageSteps

Між агрегацією rows і записом COVERAGE.md тепер виконується:
1. classify(allSurvived, cwd) — LLM-класифікація через Sonnet 4.6.
2. applyVerdicts(rows, verdicts, threshold) — фільтрує survived,
   декрементує mutation.total на allowed-gaps.
3. renderMarkdown(augmentedRows, allowedGaps) — додає секцію
   '## Allowed gaps' з verdict/confidence/reason.

Threshold читається з .n-cursor.json#coverage.classifyConfidenceThreshold
(default 1.1 — rollout mode, нічого не фільтрується). Після
1-2 тижнів спостереження знижуємо до 0.7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Manual smoke test

**Files:** (no code changes)

- [ ] **Step 1: Прогнати `n-cursor coverage` на cursor repo з API key**

```bash
cd /Users/vitaliytv/www/nitra/cursor && export ANTHROPIC_API_KEY=<key> && bun run coverage
```

Очікувано: coverage завершується успішно. Якщо є survived мутанти — кожен класифікується (видно в logs). У `COVERAGE.md` з'являється секція `## Allowed gaps` (якщо threshold ≤ 0.7) або тільки список survived (якщо threshold = 1.1).

- [ ] **Step 2: Перевірити, що cache створено**

```bash
ls -la /Users/vitaliytv/www/nitra/cursor/npm/reports/coverage-classify.cache.json
cat /Users/vitaliytv/www/nitra/cursor/npm/reports/coverage-classify.cache.json | jq '.entries | keys | length'
```

Очікувано: файл існує, > 0 entries.

- [ ] **Step 3: Прогнати coverage ще раз — переконатися, що cache hit економить виклики**

```bash
time bun run coverage 2>&1 | grep -E "coverage classify|cache"
```

Очікувано: другий прогін значно швидший (cache hit на всі мутанти, що не змінили source).

- [ ] **Step 4: Без `ANTHROPIC_API_KEY` — переконатися в graceful skip**

```bash
unset ANTHROPIC_API_KEY && bun run coverage 2>&1 | grep -i "skip\|warn"
```

Очікувано: бачимо `⚠ coverage classify: ANTHROPIC_API_KEY not set, classification skipped` у logs. Coverage завершується успішно з Raw score.

- [ ] **Step 5: Створити change-file через нову release-флоу**

```bash
cd /Users/vitaliytv/www/nitra/cursor && npx @nitra/cursor change --bump minor --section Added --message "LLM-класифікатор survived мутантів у n-cursor coverage: для кожного мутанта Claude Sonnet 4.6 виносить verdict (worth-testing/equivalent/defensive/glue/wrapper) з reasoning + confidence. Allowed gaps виключаються з знаменника mutation score. Cache по git-blob-hash. Graceful skip без API key. Threshold у .n-cursor.json#coverage.classifyConfidenceThreshold (default 1.1 — rollout mode)." --ws npm
```

- [ ] **Step 6: Final commit**

```bash
cd /Users/vitaliytv/www/nitra/cursor && git add npm/.changes/ && git commit -m "chore(npm): change-file для coverage-classify

Release-note для v2 (через n-cursor release у CI).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- ✓ Architecture (5 модулів + інтеграція в coverage.mjs) — Task 1-7.
- ✓ Cache key за git-blob-hash + base64url(replacement) — Task 3.
- ✓ Skip rule `verdict ∈ skip-set AND confidence ≥ threshold` — Task 5.
- ✓ Conservative fallback на LLM-error — Task 6.
- ✓ Graceful skip без API key / SDK — Task 6.
- ✓ COVERAGE.md з Killable score + Allowed gaps секцією — Task 7.
- ✓ Threshold через `.n-cursor.json#coverage.classifyConfidenceThreshold` — Task 7.
- ✓ Manual smoke test — Task 8.

**Placeholder scan:** немає TBD/TODO/«similar to».

**Type consistency:**
- `verdict.verdict: string`, `verdict.confidence: number`, `verdict.reason: string`, optional `verdict.suggestedTest: string` — узгоджено між verdict-schema, cache, apply, index.
- `applyVerdicts(rows, verdicts, threshold)` — той самий контракт у тестах і integration.
- `classify(survived, cwd, opts)` — сигнатура збігається в усіх викликах.
- `mutation.total` декрементується в apply.mjs, передається в `formatScore(row.mutation)` — узгоджено.

**Test coverage:**
- verdict-schema: 13 тестів (валідація + парсинг).
- cache: 12 тестів (hash, key, read, write, інвалідація).
- prompt: 10 тестів (system constants, user assembly, edge cases).
- apply: 12 тестів (isAllowedGap rules, applyVerdicts комбінації).
- index: 8 тестів (інтеграція з мокованим SDK, cache hit/miss, errors).
- coverage.mjs renderMarkdown: 3 нові тести (Allowed gaps section).
- Smoke: manual.

Загалом: **58 нових unit-тестів** + manual smoke.
