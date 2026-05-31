# Vitest Runner Spike — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Емпірично перевірити, чи `@stryker-mutator/vitest-runner` з `coverageAnalysis: 'perTest'` дає реальний виграш проти поточного canonical baseline (`command` runner + `bun test` + `concurrency: 1` + `inPlace: true`) — до того, як чіпати rules у `@nitra/cursor`.

**Architecture:** Standalone benchmark під `benchmarks/runner-comparison/` (поза `npm/`, поза monorepo workspaces). Sample-проєкт — 5 pure-функцій (`slugify`, `url-parse`, `retry`, `promise-pool`, `currency`) із власними `tests/`. Два паралельні Stryker-конфіги (`stryker.bun.config.mjs` дзеркалить поточний канон, `stryker.vitest.config.mjs` — пропонований). `run.mjs` оркеструє 3 сценарії (`full-bun`, `full-vitest`, `incremental-vitest-noop`), пише per-run JSON у `results/` і агрегує `SPIKE.md` із таблицею speedup. **Жодних змін у `npm/rules/...`** — це чистий verify-first спайк.

**Tech Stack:** Bun (runtime + test для baseline), Vitest (для proposed), `@stryker-mutator/core`, `@stryker-mutator/vitest-runner`, `@vitest/coverage-v8`.

**Decision gate (після Task 14):**

- **Strong win** (`full-vitest ≤ 0.5 × full-bun` AND `incremental-noop ≤ 0.1 × full-vitest`) → user-команда «йдемо в міграцію» → перехід до окремого плану.
- **Marginal/no win** → СТОП, презентую числа, на цьому спайк закривається.

---

### Task 1: Scaffold каталог benchmarks/runner-comparison/

**Files:**

- Create: `benchmarks/runner-comparison/demo/src/.gitkeep`
- Create: `benchmarks/runner-comparison/demo/tests/.gitkeep`
- Create: `benchmarks/runner-comparison/results/.gitkeep`

- [ ] **Step 1: Створити каталоги**

```bash
mkdir -p benchmarks/runner-comparison/demo/src benchmarks/runner-comparison/demo/tests benchmarks/runner-comparison/results
touch benchmarks/runner-comparison/demo/src/.gitkeep benchmarks/runner-comparison/demo/tests/.gitkeep benchmarks/runner-comparison/results/.gitkeep
```

- [ ] **Step 2: Перевірити structure**

```bash
ls -R benchmarks/runner-comparison/
```

Expected: `demo/src/`, `demo/tests/`, `results/` із `.gitkeep`.

- [ ] **Step 3: Commit**

```bash
git add benchmarks/runner-comparison/
git commit -m "feat(benchmarks): scaffold runner-comparison spike directory"
```

---

### Task 2: demo/package.json + .gitignore

**Files:**

- Create: `benchmarks/runner-comparison/demo/package.json`
- Create: `benchmarks/runner-comparison/.gitignore`

- [ ] **Step 1: Написати `demo/package.json`**

```json
{
  "name": "runner-comparison-demo",
  "version": "0.0.0",
  "private": true,
  "description": "Sample-проєкт для бенчмарку Stryker runner-ів (bun command vs vitest perTest). Не публікується.",
  "type": "module",
  "scripts": {
    "test": "bun test"
  },
  "devDependencies": {
    "@stryker-mutator/core": "^8.7.1",
    "@stryker-mutator/vitest-runner": "^8.7.1",
    "@vitest/coverage-v8": "^2.1.9",
    "vitest": "^2.1.9"
  },
  "engines": {
    "bun": ">=1.3",
    "node": ">=25"
  }
}
```

- [ ] **Step 2: `.gitignore` для бенчмарку**

```
node_modules/
demo/reports/
demo/node_modules/
results/*.json
results/*.log
!results/.gitkeep
```

- [ ] **Step 3: Встановити залежності**

```bash
cd benchmarks/runner-comparison/demo && bun install
```

Expected: створено `demo/node_modules/` без помилок.

- [ ] **Step 4: Commit**

```bash
git add benchmarks/runner-comparison/demo/package.json benchmarks/runner-comparison/.gitignore benchmarks/runner-comparison/demo/bun.lock
git commit -m "feat(benchmarks): demo package.json + devDeps (stryker, vitest)"
```

---

### Task 3: src/slugify.mjs + tests

**Files:**

- Create: `benchmarks/runner-comparison/demo/src/slugify.mjs`
- Create: `benchmarks/runner-comparison/demo/tests/slugify.test.mjs`

- [ ] **Step 1: Написати source**

```js
// src/slugify.mjs
const NON_WORD = /[^\w\s-]/g
const SPACES = /\s+/g
const DASHES = /-+/g

export function slugify(input) {
  if (typeof input !== 'string') return ''
  let s = input.trim().toLowerCase()
  s = s.replace(NON_WORD, '')
  s = s.replace(SPACES, '-')
  s = s.replace(DASHES, '-')
  return s.length > 64 ? s.slice(0, 64) : s
}
```

- [ ] **Step 2: Написати тести**

```js
// tests/slugify.test.mjs
import { describe, it, expect } from 'vitest'
import { slugify } from '../src/slugify.mjs'

describe('slugify', () => {
  it('lowercases', () => {
    expect(slugify('Hello')).toBe('hello')
  })
  it('trims', () => {
    expect(slugify('  hi  ')).toBe('hi')
  })
  it('replaces spaces with single dash', () => {
    expect(slugify('a  b  c')).toBe('a-b-c')
  })
  it('strips non-word chars', () => {
    expect(slugify('hi!@#')).toBe('hi')
  })
  it('collapses multiple dashes', () => {
    expect(slugify('a---b')).toBe('a-b')
  })
  it('keeps underscores', () => {
    expect(slugify('a_b')).toBe('a_b')
  })
  it('returns empty for non-string', () => {
    expect(slugify(null)).toBe('')
  })
  it('returns empty for number', () => {
    expect(slugify(42)).toBe('')
  })
  it('truncates to 64', () => {
    expect(slugify('x'.repeat(100)).length).toBe(64)
  })
  it('preserves exact 64-char string', () => {
    expect(slugify('x'.repeat(64)).length).toBe(64)
  })
  it('handles digits', () => {
    expect(slugify('hello 123')).toBe('hello-123')
  })
  it('handles tab/newline as space', () => {
    expect(slugify('a\tb\nc')).toBe('a-b-c')
  })
})
```

- [ ] **Step 3: Перевірити, що Vitest бачить тест**

```bash
cd benchmarks/runner-comparison/demo && bunx vitest run tests/slugify.test.mjs
```

Expected: усі тести PASS.

- [ ] **Step 4: Перевірити, що Bun test теж проходить**

```bash
cd benchmarks/runner-comparison/demo && bun test tests/slugify.test.mjs
```

Expected: усі тести PASS (bun test сумісний із vitest API через describe/it/expect).

- [ ] **Step 5: Commit**

```bash
git add benchmarks/runner-comparison/demo/src/slugify.mjs benchmarks/runner-comparison/demo/tests/slugify.test.mjs
git commit -m "feat(benchmarks): slugify + tests"
```

---

### Task 4: src/url-parse.mjs + tests

**Files:**

- Create: `benchmarks/runner-comparison/demo/src/url-parse.mjs`
- Create: `benchmarks/runner-comparison/demo/tests/url-parse.test.mjs`

- [ ] **Step 1: Source**

```js
// src/url-parse.mjs
export function parseQuery(qs) {
  if (typeof qs !== 'string' || qs.length === 0) return {}
  const out = {}
  const clean = qs.startsWith('?') ? qs.slice(1) : qs
  for (const pair of clean.split('&')) {
    if (pair.length === 0) continue
    const eq = pair.indexOf('=')
    if (eq === -1) {
      out[decodeURIComponent(pair)] = ''
    } else {
      const k = decodeURIComponent(pair.slice(0, eq))
      const v = decodeURIComponent(pair.slice(eq + 1))
      out[k] = v
    }
  }
  return out
}

export function buildQuery(params) {
  if (!params || typeof params !== 'object') return ''
  const parts = []
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  }
  return parts.join('&')
}
```

- [ ] **Step 2: Tests**

```js
// tests/url-parse.test.mjs
import { describe, it, expect } from 'vitest'
import { parseQuery, buildQuery } from '../src/url-parse.mjs'

describe('parseQuery', () => {
  it('empty string → {}', () => {
    expect(parseQuery('')).toEqual({})
  })
  it('non-string → {}', () => {
    expect(parseQuery(null)).toEqual({})
  })
  it('strips leading ?', () => {
    expect(parseQuery('?a=1')).toEqual({ a: '1' })
  })
  it('two pairs', () => {
    expect(parseQuery('a=1&b=2')).toEqual({ a: '1', b: '2' })
  })
  it('key without =', () => {
    expect(parseQuery('flag')).toEqual({ flag: '' })
  })
  it('decodes percent-encoding', () => {
    expect(parseQuery('q=hello%20world')).toEqual({ q: 'hello world' })
  })
  it('empty pair skipped', () => {
    expect(parseQuery('a=1&&b=2')).toEqual({ a: '1', b: '2' })
  })
  it('value with =', () => {
    expect(parseQuery('eq=a=b')).toEqual({ eq: 'a=b' })
  })
})

describe('buildQuery', () => {
  it('null → empty', () => {
    expect(buildQuery(null)).toBe('')
  })
  it('one pair', () => {
    expect(buildQuery({ a: 1 })).toBe('a=1')
  })
  it('skips undefined', () => {
    expect(buildQuery({ a: 1, b: undefined })).toBe('a=1')
  })
  it('skips null', () => {
    expect(buildQuery({ a: 1, b: null })).toBe('a=1')
  })
  it('encodes', () => {
    expect(buildQuery({ q: 'hello world' })).toBe('q=hello%20world')
  })
  it('multiple', () => {
    expect(buildQuery({ a: 1, b: 2 })).toBe('a=1&b=2')
  })
})
```

- [ ] **Step 3: Verify Vitest**

```bash
cd benchmarks/runner-comparison/demo && bunx vitest run tests/url-parse.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Verify Bun**

```bash
cd benchmarks/runner-comparison/demo && bun test tests/url-parse.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add benchmarks/runner-comparison/demo/src/url-parse.mjs benchmarks/runner-comparison/demo/tests/url-parse.test.mjs
git commit -m "feat(benchmarks): url-parse + tests"
```

---

### Task 5: src/retry.mjs + tests

**Files:**

- Create: `benchmarks/runner-comparison/demo/src/retry.mjs`
- Create: `benchmarks/runner-comparison/demo/tests/retry.test.mjs`

- [ ] **Step 1: Source**

```js
// src/retry.mjs
export async function retry(fn, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 3
  const baseDelay = opts.baseDelay ?? 10
  const factor = opts.factor ?? 2
  let attempt = 0
  let lastErr
  while (attempt < maxAttempts) {
    try {
      return await fn(attempt)
    } catch (err) {
      lastErr = err
      attempt += 1
      if (attempt >= maxAttempts) break
      const delay = baseDelay * Math.pow(factor, attempt - 1)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastErr
}
```

- [ ] **Step 2: Tests**

```js
// tests/retry.test.mjs
import { describe, it, expect, vi } from 'vitest'
import { retry } from '../src/retry.mjs'

describe('retry', () => {
  it('success on first try', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    expect(await retry(fn)).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('retries until success', async () => {
    let i = 0
    const result = await retry(
      async () => {
        i += 1
        if (i < 3) throw new Error('boom')
        return 'ok'
      },
      { baseDelay: 1 }
    )
    expect(result).toBe('ok')
    expect(i).toBe(3)
  })
  it('throws last error after maxAttempts', async () => {
    let i = 0
    await expect(
      retry(
        async () => {
          i += 1
          throw new Error(`e${i}`)
        },
        { maxAttempts: 2, baseDelay: 1 }
      )
    ).rejects.toThrow('e2')
    expect(i).toBe(2)
  })
  it('passes attempt index to fn', async () => {
    const attempts = []
    await retry(
      async n => {
        attempts.push(n)
        if (n < 2) throw new Error('x')
        return 'ok'
      },
      { baseDelay: 1 }
    )
    expect(attempts).toEqual([0, 1, 2])
  })
  it('default maxAttempts is 3', async () => {
    let i = 0
    await expect(
      retry(
        async () => {
          i += 1
          throw new Error('x')
        },
        { baseDelay: 1 }
      )
    ).rejects.toThrow()
    expect(i).toBe(3)
  })
  it('respects baseDelay', async () => {
    const start = Date.now()
    let i = 0
    await retry(
      async () => {
        i += 1
        if (i < 2) throw new Error('x')
        return 'ok'
      },
      { baseDelay: 20, factor: 1 }
    )
    expect(Date.now() - start).toBeGreaterThanOrEqual(15)
  })
  it('exponential factor 2 → delays 10, 20', async () => {
    const start = Date.now()
    let i = 0
    await retry(
      async () => {
        i += 1
        if (i < 3) throw new Error('x')
        return 'ok'
      },
      { baseDelay: 10, factor: 2 }
    )
    expect(Date.now() - start).toBeGreaterThanOrEqual(25)
  })
})
```

- [ ] **Step 3: Verify Vitest**

```bash
cd benchmarks/runner-comparison/demo && bunx vitest run tests/retry.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Verify Bun**

```bash
cd benchmarks/runner-comparison/demo && bun test tests/retry.test.mjs
```

Expected: PASS (примітка: якщо `vi.fn` несумісний з bun test, переписати на лічильник вручну).

- [ ] **Step 5: Commit**

```bash
git add benchmarks/runner-comparison/demo/src/retry.mjs benchmarks/runner-comparison/demo/tests/retry.test.mjs
git commit -m "feat(benchmarks): retry + tests"
```

---

### Task 6: src/promise-pool.mjs + tests

**Files:**

- Create: `benchmarks/runner-comparison/demo/src/promise-pool.mjs`
- Create: `benchmarks/runner-comparison/demo/tests/promise-pool.test.mjs`

- [ ] **Step 1: Source**

```js
// src/promise-pool.mjs
export async function promisePool(items, worker, concurrency = 4) {
  if (!Array.isArray(items)) return []
  if (concurrency < 1) concurrency = 1
  const results = new Array(items.length)
  let next = 0
  async function run() {
    while (next < items.length) {
      const i = next++
      results[i] = await worker(items[i], i)
    }
  }
  const runners = []
  const limit = Math.min(concurrency, items.length)
  for (let k = 0; k < limit; k++) runners.push(run())
  await Promise.all(runners)
  return results
}
```

- [ ] **Step 2: Tests**

```js
// tests/promise-pool.test.mjs
import { describe, it, expect } from 'vitest'
import { promisePool } from '../src/promise-pool.mjs'

describe('promisePool', () => {
  it('non-array → []', async () => {
    expect(await promisePool(null, async x => x)).toEqual([])
  })
  it('empty array → []', async () => {
    expect(await promisePool([], async x => x)).toEqual([])
  })
  it('maps items', async () => {
    expect(await promisePool([1, 2, 3], async x => x * 2)).toEqual([2, 4, 6])
  })
  it('preserves order', async () => {
    const result = await promisePool(
      [5, 1, 3],
      async x => {
        await new Promise(r => setTimeout(r, x))
        return x
      },
      3
    )
    expect(result).toEqual([5, 1, 3])
  })
  it('concurrency 1 = serial', async () => {
    const order = []
    await promisePool(
      [1, 2, 3],
      async x => {
        order.push(`start-${x}`)
        await new Promise(r => setTimeout(r, 5))
        order.push(`end-${x}`)
      },
      1
    )
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3'])
  })
  it('concurrency 0 → coerced to 1', async () => {
    expect(await promisePool([1, 2], async x => x, 0)).toEqual([1, 2])
  })
  it('passes index', async () => {
    expect(await promisePool(['a', 'b'], async (_, i) => i)).toEqual([0, 1])
  })
})
```

- [ ] **Step 3: Verify Vitest**

```bash
cd benchmarks/runner-comparison/demo && bunx vitest run tests/promise-pool.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Verify Bun**

```bash
cd benchmarks/runner-comparison/demo && bun test tests/promise-pool.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add benchmarks/runner-comparison/demo/src/promise-pool.mjs benchmarks/runner-comparison/demo/tests/promise-pool.test.mjs
git commit -m "feat(benchmarks): promise-pool + tests"
```

---

### Task 7: src/currency.mjs + tests

**Files:**

- Create: `benchmarks/runner-comparison/demo/src/currency.mjs`
- Create: `benchmarks/runner-comparison/demo/tests/currency.test.mjs`

- [ ] **Step 1: Source**

```js
// src/currency.mjs
export function formatCents(cents, opts = {}) {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return ''
  const currency = opts.currency ?? 'USD'
  const negative = cents < 0
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100)
  const frac = abs % 100
  const fracStr = frac < 10 ? `0${frac}` : String(frac)
  const sign = negative ? '-' : ''
  return `${sign}${currency} ${whole}.${fracStr}`
}

export function addCents(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') return 0
  return Math.round(a) + Math.round(b)
}

export function percentOf(cents, percent) {
  if (typeof cents !== 'number' || typeof percent !== 'number') return 0
  return Math.round((cents * percent) / 100)
}
```

- [ ] **Step 2: Tests**

```js
// tests/currency.test.mjs
import { describe, it, expect } from 'vitest'
import { formatCents, addCents, percentOf } from '../src/currency.mjs'

describe('formatCents', () => {
  it('0 → "USD 0.00"', () => {
    expect(formatCents(0)).toBe('USD 0.00')
  })
  it('100 → "USD 1.00"', () => {
    expect(formatCents(100)).toBe('USD 1.00')
  })
  it('199 → "USD 1.99"', () => {
    expect(formatCents(199)).toBe('USD 1.99')
  })
  it('5 → "USD 0.05"', () => {
    expect(formatCents(5)).toBe('USD 0.05')
  })
  it('-250 → "-USD 2.50"', () => {
    expect(formatCents(-250)).toBe('-USD 2.50')
  })
  it('custom currency', () => {
    expect(formatCents(100, { currency: 'EUR' })).toBe('EUR 1.00')
  })
  it('non-number → ""', () => {
    expect(formatCents('100')).toBe('')
  })
  it('NaN → ""', () => {
    expect(formatCents(NaN)).toBe('')
  })
  it('Infinity → ""', () => {
    expect(formatCents(Infinity)).toBe('')
  })
})

describe('addCents', () => {
  it('100 + 50 = 150', () => {
    expect(addCents(100, 50)).toBe(150)
  })
  it('rounds inputs', () => {
    expect(addCents(1.4, 2.6)).toBe(4)
  })
  it('non-number → 0', () => {
    expect(addCents('a', 1)).toBe(0)
  })
  it('negative + positive', () => {
    expect(addCents(-50, 100)).toBe(50)
  })
})

describe('percentOf', () => {
  it('10% of 1000 = 100', () => {
    expect(percentOf(1000, 10)).toBe(100)
  })
  it('25% of 200 = 50', () => {
    expect(percentOf(200, 25)).toBe(50)
  })
  it('rounds', () => {
    expect(percentOf(333, 10)).toBe(33)
  })
  it('non-number → 0', () => {
    expect(percentOf('x', 10)).toBe(0)
  })
})
```

- [ ] **Step 3: Verify Vitest**

```bash
cd benchmarks/runner-comparison/demo && bunx vitest run tests/currency.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Verify Bun**

```bash
cd benchmarks/runner-comparison/demo && bun test tests/currency.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add benchmarks/runner-comparison/demo/src/currency.mjs benchmarks/runner-comparison/demo/tests/currency.test.mjs
git commit -m "feat(benchmarks): currency + tests"
```

---

### Task 8: vitest.config.js

**Files:**

- Create: `benchmarks/runner-comparison/demo/vitest.config.js`

- [ ] **Step 1: Написати config**

```js
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
    environment: 'node',
    coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] }
  }
})
```

- [ ] **Step 2: Verify повний прогін Vitest**

```bash
cd benchmarks/runner-comparison/demo && bunx vitest run
```

Expected: усі 5 файлів пройдені, без помилок.

- [ ] **Step 3: Verify повний прогін Bun**

```bash
cd benchmarks/runner-comparison/demo && bun test
```

Expected: усі тести pass (потрібно для `stryker.bun.config.mjs`).

- [ ] **Step 4: Commit**

```bash
git add benchmarks/runner-comparison/demo/vitest.config.js
git commit -m "feat(benchmarks): vitest config for demo"
```

---

### Task 9: stryker.bun.config.mjs

**Files:**

- Create: `benchmarks/runner-comparison/demo/stryker.bun.config.mjs`

- [ ] **Step 1: Написати config (дзеркало поточного canonical baseline)**

```js
/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  testRunner: 'command',
  commandRunner: { command: 'bun test' },
  inPlace: true,
  coverageAnalysis: 'off',
  concurrency: 1,
  tempDirName: 'reports/stryker/.tmp',
  reporters: ['json', 'clear-text'],
  jsonReporter: { fileName: 'reports/stryker/mutation.json' },
  incremental: true,
  incrementalFile: 'reports/stryker/incremental-bun.json',
  mutate: ['src/**/*.mjs'],
  timeoutMS: 60000
}
```

- [ ] **Step 2: Smoke-прогін (без вимірювання часу) — переконатися, що Stryker запускається**

```bash
cd benchmarks/runner-comparison/demo && bunx stryker run stryker.bun.config.mjs 2>&1 | tail -20
```

Expected: завершення з summary `X killed, Y survived, Z timeout`, `mutation.json` створено у `demo/reports/stryker/`.

- [ ] **Step 3: Перевірити, що mutation.json валідний**

```bash
cat benchmarks/runner-comparison/demo/reports/stryker/mutation.json | head -c 200
```

Expected: JSON починається з `{"$schema"...` або подібного.

- [ ] **Step 4: Очистити reports перед наступним кроком**

```bash
rm -rf benchmarks/runner-comparison/demo/reports
```

- [ ] **Step 5: Commit**

```bash
git add benchmarks/runner-comparison/demo/stryker.bun.config.mjs
git commit -m "feat(benchmarks): stryker bun config (mirror current canonical baseline)"
```

---

### Task 10: stryker.vitest.config.mjs

**Files:**

- Create: `benchmarks/runner-comparison/demo/stryker.vitest.config.mjs`

- [ ] **Step 1: Написати config**

```js
/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.js' },
  coverageAnalysis: 'perTest',
  tempDirName: 'reports/stryker/.tmp',
  reporters: ['json', 'clear-text'],
  jsonReporter: { fileName: 'reports/stryker/mutation.json' },
  incremental: true,
  incrementalFile: 'reports/stryker/incremental-vitest.json',
  mutate: ['src/**/*.mjs'],
  timeoutMS: 60000
}
```

- [ ] **Step 2: Smoke-прогін**

```bash
cd benchmarks/runner-comparison/demo && bunx stryker run stryker.vitest.config.mjs 2>&1 | tail -20
```

Expected: завершення з summary `X killed, Y survived, Z timeout`. **Якщо vitest-runner падає під bunx — спробувати `npx stryker run stryker.vitest.config.mjs`**, занотувати у Task 12 (`run.mjs` має використовувати робочий шлях).

- [ ] **Step 3: Verify mutation.json**

```bash
cat benchmarks/runner-comparison/demo/reports/stryker/mutation.json | head -c 200
```

Expected: валідний JSON.

- [ ] **Step 4: Очистити reports**

```bash
rm -rf benchmarks/runner-comparison/demo/reports
```

- [ ] **Step 5: Commit**

```bash
git add benchmarks/runner-comparison/demo/stryker.vitest.config.mjs
git commit -m "feat(benchmarks): stryker vitest config (perTest + concurrency default)"
```

---

### Task 11: run.mjs оркестратор

**Files:**

- Create: `benchmarks/runner-comparison/run.mjs`

- [ ] **Step 1: Написати скрипт**

````js
#!/usr/bin/env bun
/**
 * Spike-бенчмарк: вимірює тривалість Stryker-прогону для двох runner-конфігурацій
 * і за бажанням — incremental прогін (другий запуск без змін).
 *
 * Usage:
 *   bun run.mjs                                # усі 3 сценарії
 *   bun run.mjs --scenario=full-bun
 *   bun run.mjs --scenario=full-vitest
 *   bun run.mjs --scenario=incremental-vitest-noop
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEMO = join(HERE, 'demo')
const RESULTS = join(HERE, 'results')
const REPORTS = join(DEMO, 'reports')

const SCENARIOS = {
  'full-bun': { config: 'stryker.bun.config.mjs', cleanReports: true, incrementalFile: 'incremental-bun.json' },
  'full-vitest': {
    config: 'stryker.vitest.config.mjs',
    cleanReports: true,
    incrementalFile: 'incremental-vitest.json'
  },
  'incremental-vitest-noop': {
    config: 'stryker.vitest.config.mjs',
    cleanReports: false,
    incrementalFile: 'incremental-vitest.json'
  }
}

const argv = process.argv.slice(2)
const scenarioArg = argv.find(a => a.startsWith('--scenario='))?.split('=')[1]
const list = scenarioArg ? [scenarioArg] : ['full-bun', 'full-vitest', 'incremental-vitest-noop']

mkdirSync(RESULTS, { recursive: true })

const summary = []
for (const name of list) {
  const cfg = SCENARIOS[name]
  if (!cfg) {
    console.error(`Unknown scenario: ${name}`)
    process.exit(2)
  }

  // Setup
  if (cfg.cleanReports && existsSync(REPORTS)) rmSync(REPORTS, { recursive: true, force: true })

  // Cooldown 2с між сценаріями (OS file cache)
  if (summary.length > 0) {
    const cooldown = spawnSync('sleep', ['2'])
    if (cooldown.error) await new Promise(r => setTimeout(r, 2000))
  }

  console.log(`\n=== ${name} ===`)
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const logPath = join(RESULTS, `${name}-${ts}.log`)

  const t0 = performance.now()
  const proc = spawnSync('bunx', ['stryker', 'run', cfg.config], {
    cwd: DEMO,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' }
  })
  const durationMs = Math.round(performance.now() - t0)
  writeFileSync(logPath, (proc.stdout ?? '') + '\n---STDERR---\n' + (proc.stderr ?? ''))

  if (proc.status !== 0) {
    console.error(`✗ ${name}: stryker exit ${proc.status}, log: ${logPath}`)
    summary.push({ scenario: name, durationMs, error: `exit ${proc.status}`, logPath })
    continue
  }

  // Parse mutation.json
  const mutationPath = join(REPORTS, 'stryker', 'mutation.json')
  if (!existsSync(mutationPath)) {
    console.error(`✗ ${name}: no mutation.json at ${mutationPath}`)
    summary.push({ scenario: name, durationMs, error: 'no mutation.json', logPath })
    continue
  }
  const report = JSON.parse(readFileSync(mutationPath, 'utf8'))
  let killed = 0,
    survived = 0,
    timeout = 0,
    noCoverage = 0
  for (const file of Object.values(report.files ?? {})) {
    for (const m of file.mutants ?? []) {
      if (m.status === 'Killed') killed++
      else if (m.status === 'Survived') survived++
      else if (m.status === 'Timeout') timeout++
      else if (m.status === 'NoCoverage') noCoverage++
    }
  }
  const total = killed + survived + timeout + noCoverage
  const score = total > 0 ? Math.round((1000 * (killed + timeout)) / total) / 10 : 0

  const result = {
    scenario: name,
    durationMs,
    totalMutants: total,
    killed,
    survived,
    timeout,
    noCoverage,
    score,
    versions: {
      node: process.versions.node,
      bun: process.versions.bun ?? null
    },
    logPath
  }
  writeFileSync(join(RESULTS, `${name}-${ts}.json`), JSON.stringify(result, null, 2))
  console.log(`✓ ${name}: ${durationMs}ms, ${total} mutants, score ${score}%`)
  summary.push(result)
}

// Aggregate → SPIKE.md
const bunFull = summary.find(s => s.scenario === 'full-bun')
const vitFull = summary.find(s => s.scenario === 'full-vitest')
const vitNoop = summary.find(s => s.scenario === 'incremental-vitest-noop')
const baseline = bunFull?.durationMs ?? null

const speedup = s => (baseline && s?.durationMs ? `${(baseline / s.durationMs).toFixed(2)}×` : 'n/a')
const fmt = s =>
  s?.error
    ? `| ${s.scenario} | — | ERROR (${s.error}) | — | — |`
    : `| ${s.scenario} | ${s?.totalMutants ?? '—'} | ${((s?.durationMs ?? 0) / 1000).toFixed(1)}s | ${s?.score ?? '—'}% | ${speedup(s)} |`

const md = [
  '# Vitest Runner Spike — Results',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  '## Numbers',
  '',
  '| Сценарій | Мутантів | Час | Score | Speedup vs full-bun |',
  '| --- | --- | --- | --- | --- |',
  fmt(bunFull),
  fmt(vitFull),
  fmt(vitNoop),
  '',
  '## Environment',
  '',
  `- Node: ${process.versions.node}`,
  `- Bun: ${process.versions.bun ?? 'n/a'}`,
  '',
  '## Decision criteria',
  '',
  '- **Strong win** (рекомендую міграцію): `full-vitest ≤ 0.5 × full-bun` AND `incremental-noop ≤ 0.1 × full-vitest`',
  '- **Marginal**: 0.5×–0.8× → треба `touch-1-source` сценарій',
  '- **No win**: > 0.8× → не мігруємо',
  '',
  '## Reproduce',
  '',
  '```bash',
  'cd benchmarks/runner-comparison && bun run.mjs',
  '```',
  ''
].join('\n')
writeFileSync(join(HERE, 'SPIKE.md'), md)
console.log(`\n→ SPIKE.md updated`)
````

- [ ] **Step 2: Smoke прогін на одному сценарії**

```bash
cd benchmarks/runner-comparison && bun run.mjs --scenario=full-bun
```

Expected: вивід `✓ full-bun: <ms>, <N> mutants, score <S>%`, створено `results/full-bun-*.json` і `SPIKE.md`.

- [ ] **Step 3: Перевірити вміст SPIKE.md**

```bash
cat benchmarks/runner-comparison/SPIKE.md
```

Expected: таблиця з full-bun, інші сценарії — `n/a`.

- [ ] **Step 4: Commit**

```bash
git add benchmarks/runner-comparison/run.mjs
git commit -m "feat(benchmarks): run.mjs orchestrator (3 scenarios, JSON results, SPIKE.md aggregate)"
```

---

### Task 12: README.md

**Files:**

- Create: `benchmarks/runner-comparison/README.md`

- [ ] **Step 1: Написати README**

````markdown
# runner-comparison

Spike-бенчмарк для порівняння двох Stryker test-runner конфігурацій:

- **`stryker.bun.config.mjs`** — поточний canonical baseline `@nitra/cursor` (command runner + `bun test` + `concurrency: 1` + `inPlace: true`).
- **`stryker.vitest.config.mjs`** — пропонований (vitest-runner + `coverageAnalysis: 'perTest'`, без `inPlace`).

## Sample проєкт

`demo/` — standalone (не у workspaces), 5 pure utility-функцій із юніт-тестами:

| Файл               | Що тестується                                             |
| ------------------ | --------------------------------------------------------- |
| `slugify.mjs`      | Нормалізація рядків (regex, trim, truncate)               |
| `url-parse.mjs`    | Query-string parse/build (decodeURIComponent, edge cases) |
| `retry.mjs`        | Async retry з exponential backoff                         |
| `promise-pool.mjs` | Concurrent map зі збереженням порядку                     |
| `currency.mjs`     | Cents-format, add, percent (integer math, NaN handling)   |

## Як запустити

```bash
cd benchmarks/runner-comparison/demo && bun install
cd .. && bun run.mjs
```
````

Або один сценарій:

```bash
bun run.mjs --scenario=full-vitest
```

## Сценарії

| Сценарій                  | Опис                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `full-bun`                | Чистий прогін з `stryker.bun.config.mjs`; `demo/reports/` видаляється перед стартом.                               |
| `full-vitest`             | Чистий прогін з `stryker.vitest.config.mjs`; `demo/reports/` видаляється.                                          |
| `incremental-vitest-noop` | Другий прогін `stryker.vitest.config.mjs` БЕЗ очищення `reports/` — має бути ~миттєвим завдяки `incremental.json`. |

## Output

- `results/<scenario>-<ts>.json` — per-run метрики (durationMs, totalMutants, killed/survived/timeout/score, версії runtime).
- `results/<scenario>-<ts>.log` — повний stdout+stderr Stryker.
- `SPIKE.md` — агрегаційна таблиця, generated на кожному запуску `run.mjs`.

## Decision gate

- **Strong win**: `full-vitest ≤ 0.5 × full-bun` AND `incremental-noop ≤ 0.1 × full-vitest` → рекомендую міграцію canonical baseline у `@nitra/cursor`.
- **Marginal**: speedup 1.25×–2× → треба додатковий `touch-1-source` сценарій перед рішенням.
- **No win**: speedup < 1.25× → не мігруємо.

## NOT scope

Цей бенчмарк **не** змінює нічого у `npm/rules/test/...` чи `npm/rules/js-lint/...`. Канонічний baseline `@nitra/cursor` залишається `bun test` поки spike не підтвердить виграш.

````

- [ ] **Step 2: Commit**

```bash
git add benchmarks/runner-comparison/README.md
git commit -m "docs(benchmarks): README for runner-comparison spike"
````

---

### Task 13: Прогнати усі 3 сценарії

- [ ] **Step 1: Очистити попередні results та reports**

```bash
rm -rf benchmarks/runner-comparison/demo/reports
rm -f benchmarks/runner-comparison/results/*.json benchmarks/runner-comparison/results/*.log
```

- [ ] **Step 2: Прогнати все**

```bash
cd benchmarks/runner-comparison && bun run.mjs
```

Expected: послідовно три рядки `✓ <scenario>: <ms>, <N> mutants, score <S>%`, наприкінці `→ SPIKE.md updated`.

- [ ] **Step 3: Перевірити SPIKE.md**

```bash
cat benchmarks/runner-comparison/SPIKE.md
```

Expected: 3 рядки заповнено числами; `incremental-vitest-noop` має тривати помітно менше за `full-vitest`.

- [ ] **Step 4: Commit results**

```bash
git add benchmarks/runner-comparison/SPIKE.md
git commit -m "chore(benchmarks): record initial spike results"
```

---

### Task 14: Презентація результатів + decision gate

- [ ] **Step 1: Прочитати SPIKE.md та results/\*.json**

```bash
cat benchmarks/runner-comparison/SPIKE.md
ls benchmarks/runner-comparison/results/
```

- [ ] **Step 2: Класифікувати результат**

Порівняти числа з порогом:

- `full-vitest.durationMs / full-bun.durationMs ≤ 0.5` AND `incremental.durationMs / full-vitest.durationMs ≤ 0.1` → **Strong win**
- `full-vitest.durationMs / full-bun.durationMs ∈ (0.5, 0.8]` → **Marginal**, треба `touch-1-source`
- `> 0.8` → **No win**

- [ ] **Step 3: Презентувати користувачу**

Вивід має містити:

1. Таблицю з 3 рядками (speedup ratios).
2. Класифікацію (Strong win / Marginal / No win).
3. Рекомендацію (мігруємо / робимо touch-1-source / зупиняємось).

**STOP HERE.** Чекати на go/no-go від користувача. Не виконувати Task 15+ без явної згоди.

---

## Self-Review

- ✅ Spec coverage: spike покриває верифікаційну частину спеки користувача (`зпочатку перевірити з vitest`); фази A-E повної міграції — поза скоупом цього плану (окремий план після decision gate).
- ✅ Placeholder scan: код у кожному кроці повний; немає TBD/TODO.
- ✅ Type consistency: усі імпорти/назви функцій узгоджені між src/_ і tests/_; `stryker.bun.config.mjs` та `stryker.vitest.config.mjs` посилаються на однаковий `mutate: ['src/**/*.mjs']`; обидва `incrementalFile` різні (щоб incremental-vitest-noop не отруїлося даними з bun-прогону).
- ✅ Verify-first: Task 14 явно зупиняється; повна міграція — окремим планом.
