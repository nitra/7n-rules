# Pi.dev ADR hooks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Згенерувати pi.dev TS-extension у `.pi/extensions/n-cursor-adr/index.ts` під час `npx @nitra/cursor` синку, яка на pi `agent_end` event спавнить існуючі bash-скрипти `.claude/hooks/{capture,normalize}-decisions.sh` без дублювання їхньої логіки.

**Architecture:** Thin TS-wrapper (~50 LOC) серіалізує `ctx.sessionManager.getEntries()` у Claude-сумісний JSONL у `tmpdir()`, формує stdin JSON (`transcript_path`, `session_id`), виставляє `CLAUDE_PROJECT_DIR=ctx.cwd`, спавнить обидва bash-скрипти через `pi.exec` (async, `signal: ctx.signal`). Bundle через нову bundled-директорію `npm/.pi-template/extensions/`. Sync — нова функція `syncPiExtensions` у `sync-claude-config.mjs`, gated на `adr` ∈ `.n-cursor.json#rules` (симетрично до `syncAdrHookScript`).

**Tech Stack:** TypeScript (jiti loader у pi — без компіляції), Node `fs`/`fs/promises`, bun test, picomatch (не потрібен — лише вже існуючі deps).

**Spec:** [docs/superpowers/specs/2026-05-25-pi-extensions-adr-hooks-design.md](../specs/2026-05-25-pi-extensions-adr-hooks-design.md)

---

## File Structure

**Create:**

- `npm/.pi-template/extensions/n-cursor-adr/index.ts` — bundled TS-extension (single file)
- `npm/scripts/tests/sync-pi-extensions.test.mjs` — unit-тести для `syncPiExtensions` + cleanup

**Modify:**

- `npm/scripts/sync-claude-config.mjs` — додати константи (`PI_DIR`, `PI_EXTENSIONS_DIR`, `PI_TEMPLATE_DIR_NAME`, `PI_EXTENSION_NAME`), функції (`syncPiExtensions`, `removeOrphanPiExtension`), інтегрувати у `syncClaudeConfig`-відповідь (`piExtension: boolean`)
- `npm/bin/n-cursor.js` — додати `piExtension` у звіт `result.parts`-логі після `syncClaudeConfig`
- `npm/package.json` — додати `".pi-template"` у `files` array; bump version 1.22.0 → 1.23.0 (minor: нова фіча, без breaking)
- `npm/CHANGELOG.md` — entry `## [1.23.0] - 2026-05-25`
- `package.json` (root) — bump `@nitra/cursor` dep `^1.22.0` → `^1.23.0`

---

## Task 1: Bundled TS-extension template

**Files:**

- Create: `npm/.pi-template/extensions/n-cursor-adr/index.ts`
- Test: `npm/scripts/tests/sync-pi-extensions.test.mjs` (новий, наповнюватиметься у наступних тасках)

- [ ] **Step 1: Створити failing-тест на існування та формат темплейту**

```js
// npm/scripts/tests/sync-pi-extensions.test.mjs
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const PI_TEMPLATE_PATH = join(import.meta.dir, '..', '..', '.pi-template', 'extensions', 'n-cursor-adr', 'index.ts')

describe('.pi-template/extensions/n-cursor-adr/index.ts (bundled)', () => {
  test('файл існує у пакеті', () => {
    expect(existsSync(PI_TEMPLATE_PATH)).toBe(true)
  })

  test('має default export factory function', async () => {
    const src = await readFile(PI_TEMPLATE_PATH, 'utf8')
    expect(src).toMatch(/export default function/)
    expect(src).toMatch(/pi\.on\(['"]agent_end['"]/)
  })

  test('спавнить обидва bash-скрипти capture/normalize', async () => {
    const src = await readFile(PI_TEMPLATE_PATH, 'utf8')
    expect(src).toMatch(/capture-decisions\.sh/)
    expect(src).toMatch(/normalize-decisions\.sh/)
  })

  test('виставляє CLAUDE_PROJECT_DIR у env', async () => {
    const src = await readFile(PI_TEMPLATE_PATH, 'utf8')
    expect(src).toMatch(/CLAUDE_PROJECT_DIR/)
  })

  test('має recursion guard через CAPTURE_DECISIONS_RUNNING / ADR_NORMALIZE_RUNNING', async () => {
    const src = await readFile(PI_TEMPLATE_PATH, 'utf8')
    expect(src).toMatch(/CAPTURE_DECISIONS_RUNNING/)
    expect(src).toMatch(/ADR_NORMALIZE_RUNNING/)
  })
})
```

- [ ] **Step 2: Прогнати тест — має fail**

Run: `cd npm && bun test scripts/tests/sync-pi-extensions.test.mjs`
Expected: 5 fail (файл не існує)

- [ ] **Step 3: Створити темплейт**

```typescript
// npm/.pi-template/extensions/n-cursor-adr/index.ts

/**
 * Pi.dev extension: ADR capture + normalize.
 *
 * На pi `agent_end` event серіалізує `ctx.sessionManager.getEntries()` у
 * Claude-сумісний JSONL у tmpdir, формує stdin JSON і спавнить існуючі
 * `.claude/hooks/{capture,normalize}-decisions.sh` через `pi.exec`.
 *
 * Логіка skip/throttle/LLM-CLI-selection лишається у bash — TS лише
 * адаптер pi → bash. Recursion guard через env vars, що їх bash виставляє
 * перед спавном LLM CLI.
 */

interface PiContext {
  cwd: string
  sessionId?: string
  signal?: AbortSignal
  sessionManager: { getEntries(): Array<{ message?: { role?: string; content?: unknown } }> }
  ui?: { notify?: (msg: string, level?: 'info' | 'warning' | 'error') => void }
}

interface PiExec {
  exec: (
    cmd: string,
    args: string[],
    opts?: { cwd?: string; env?: Record<string, string>; input?: string; signal?: AbortSignal; timeout?: number }
  ) => Promise<{ code: number; stdout: string; stderr: string }>
  on: (event: string, handler: (event: unknown, ctx: PiContext) => Promise<void> | void) => void
}

import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const CAPTURE_HOOK = '.claude/hooks/capture-decisions.sh'
const NORMALIZE_HOOK = '.claude/hooks/normalize-decisions.sh'

/**
 * Pi extension entry point.
 * @param {PiExec} pi pi.dev extension API
 */
export default function (pi: PiExec): void {
  pi.on('agent_end', async (_event, ctx) => {
    // Recursion guard: bash спавнить LLM CLI (claude/cursor-agent), той може
    // стартувати pi-сесію. Bash виставляє ці env-vars перед спавном — child
    // inheritance ловить рекурсивний trigger тут.
    if (process.env.CAPTURE_DECISIONS_RUNNING || process.env.ADR_NORMALIZE_RUNNING) {
      return
    }

    let jsonlPath: string
    try {
      const entries = ctx.sessionManager.getEntries()
      const lines = entries
        .filter(e => e.message?.role === 'user' || e.message?.role === 'assistant')
        .map(e => JSON.stringify({ type: e.message?.role, message: e.message }))
        .join('\n')
      jsonlPath = join(tmpdir(), `n-cursor-pi-transcript-${Date.now()}-${randomUUID()}.jsonl`)
      writeFileSync(jsonlPath, lines + '\n', 'utf8')
    } catch (err) {
      ctx.ui?.notify?.(`@nitra/cursor: transcript serialization failed — ${(err as Error).message}`, 'error')
      return
    }

    const stdinPayload = JSON.stringify({
      transcript_path: jsonlPath,
      session_id: ctx.sessionId ?? randomUUID()
    })

    const envOverride = { ...process.env, CLAUDE_PROJECT_DIR: ctx.cwd } as Record<string, string>

    // Async, не блокує agent_end. Якщо bash-скриптів немає (pi-only консьюмер
    // із claude-config: false) — pi.exec поверне ENOENT, ловимо у allSettled.
    await Promise.allSettled([
      pi.exec('bash', [CAPTURE_HOOK], {
        cwd: ctx.cwd,
        env: envOverride,
        input: stdinPayload,
        signal: ctx.signal,
        timeout: 180_000
      }),
      pi.exec('bash', [NORMALIZE_HOOK], {
        cwd: ctx.cwd,
        env: envOverride,
        input: stdinPayload,
        signal: ctx.signal,
        timeout: 600_000
      })
    ])
  })
}
```

- [ ] **Step 4: Прогнати тест — має pass**

Run: `cd npm && bun test scripts/tests/sync-pi-extensions.test.mjs`
Expected: 5 pass

- [ ] **Step 5: Commit**

```bash
git add npm/.pi-template/extensions/n-cursor-adr/index.ts npm/scripts/tests/sync-pi-extensions.test.mjs
git commit -m "feat(pi): bundle .pi-template/extensions/n-cursor-adr template

TS-wrapper на pi agent_end: серіалізує sessionManager.getEntries() у
Claude JSONL у tmpdir, спавнить .claude/hooks/{capture,normalize}-decisions.sh
через pi.exec. Recursion guard через CAPTURE_DECISIONS_RUNNING /
ADR_NORMALIZE_RUNNING env-vars (bash виставляє).
"
```

---

## Task 2: Константи + `syncPiExtensions` функція

**Files:**

- Modify: `npm/scripts/sync-claude-config.mjs` (додати ~60 LOC біля існуючих `syncAdrHookScript`)
- Modify: `npm/scripts/tests/sync-pi-extensions.test.mjs` (додати тести)

- [ ] **Step 1: Failing-тест на `syncPiExtensions` copy**

```js
// npm/scripts/tests/sync-pi-extensions.test.mjs — додати в кінець файлу:

import { mkdir } from 'node:fs/promises'
import { withTmpCwd } from '../utils/test-helpers.mjs'
import { PI_EXTENSIONS_DIR, PI_EXTENSION_NAME, PI_TEMPLATE_DIR_NAME, syncPiExtensions } from '../sync-claude-config.mjs'

const PI_TEMPLATE_REL = 'pkg/.pi-template'

/**
 * Створює мінімальний bundled-пакет із `.pi-template/extensions/n-cursor-adr/index.ts`.
 * @param {string} cwdAbs корінь тимчасового проєкту
 * @returns {Promise<string>} абсолютний шлях до bundledPackageRoot
 */
async function setupPiTemplate(cwdAbs) {
  const pkgRoot = join(cwdAbs, 'pkg')
  const extDir = join(cwdAbs, PI_TEMPLATE_REL, 'extensions', 'n-cursor-adr')
  await mkdir(extDir, { recursive: true })
  await writeFile(join(extDir, 'index.ts'), '// bundled pi extension stub\nexport default function (pi) {}\n', 'utf8')
  return pkgRoot
}

import { writeFile } from 'node:fs/promises'

describe('syncPiExtensions', () => {
  test('копіює bundled extension у .pi/extensions/<name>/index.ts', async () => {
    await withTmpCwd(async cwd => {
      const pkgRoot = await setupPiTemplate(cwd)
      const result = await syncPiExtensions(cwd, pkgRoot)
      expect(result.written).toBe(true)
      expect(result.path).toBe(`${PI_EXTENSIONS_DIR}/${PI_EXTENSION_NAME}/index.ts`)
      const dest = join(cwd, PI_EXTENSIONS_DIR, PI_EXTENSION_NAME, 'index.ts')
      const content = await readFile(dest, 'utf8')
      expect(content).toContain('bundled pi extension stub')
    })
  })

  test('повертає {written:false} якщо bundled template відсутній', async () => {
    await withTmpCwd(async cwd => {
      const pkgRoot = join(cwd, 'empty-pkg')
      await mkdir(pkgRoot, { recursive: true })
      const result = await syncPiExtensions(cwd, pkgRoot)
      expect(result.written).toBe(false)
      expect(result.path).toBe('')
    })
  })

  test('перезаписує існуючий index.ts (fully-owned)', async () => {
    await withTmpCwd(async cwd => {
      const pkgRoot = await setupPiTemplate(cwd)
      const dest = join(cwd, PI_EXTENSIONS_DIR, PI_EXTENSION_NAME, 'index.ts')
      await mkdir(join(cwd, PI_EXTENSIONS_DIR, PI_EXTENSION_NAME), { recursive: true })
      await writeFile(dest, '// stale content\n', 'utf8')
      await syncPiExtensions(cwd, pkgRoot)
      const content = await readFile(dest, 'utf8')
      expect(content).toContain('bundled pi extension stub')
      expect(content).not.toContain('stale content')
    })
  })
})
```

- [ ] **Step 2: Прогнати — fail**

Run: `cd npm && bun test scripts/tests/sync-pi-extensions.test.mjs`
Expected: 3 fail (import не resolve'иться, `syncPiExtensions` / `PI_EXTENSIONS_DIR` не експортовано)

- [ ] **Step 3: Імплементувати константи + функцію у `sync-claude-config.mjs`**

Знайти блок `const CLAUDE_HOOKS_DIR = …` (line ~59) і додати ПІД ним:

```js
const PI_DIR = '.pi'
const PI_EXTENSIONS_DIR = `${PI_DIR}/extensions`
const PI_TEMPLATE_DIR_NAME = '.pi-template'
const PI_EXTENSION_NAME = 'n-cursor-adr'

export { PI_DIR, PI_EXTENSIONS_DIR, PI_TEMPLATE_DIR_NAME, PI_EXTENSION_NAME }
```

Знайти `syncAdrNormalizeHookScript` (line ~404) і додати ПІД ним:

```js
/**
 * Копіює bundled pi.dev TS-extension `npm/.pi-template/extensions/n-cursor-adr/index.ts`
 * у `.pi/extensions/n-cursor-adr/index.ts` проєкту-споживача. Файл fully-owned: при кожному
 * sync-у перезаписується. Якщо bundled template відсутній (наприклад, у legacy-версіях
 * пакета без `.pi-template/`) — повертаємо `{written: false}` без помилки.
 *
 * @param {string} projectRoot корінь проєкту-споживача
 * @param {string} bundledPackageRoot корінь установленого `@nitra/cursor` (із `.pi-template/`)
 * @returns {Promise<{ written: boolean, path: string }>} чи писали файл, та його відносний шлях
 */
export async function syncPiExtensions(projectRoot, bundledPackageRoot) {
  const srcPath = join(bundledPackageRoot, PI_TEMPLATE_DIR_NAME, 'extensions', PI_EXTENSION_NAME, 'index.ts')
  if (!existsSync(srcPath)) {
    return { written: false, path: '' }
  }
  const content = await readFile(srcPath, 'utf8')
  const destDir = join(projectRoot, PI_EXTENSIONS_DIR, PI_EXTENSION_NAME)
  await mkdir(destDir, { recursive: true })
  const destPath = join(destDir, 'index.ts')
  await writeFile(destPath, content, 'utf8')
  return { written: true, path: `${PI_EXTENSIONS_DIR}/${PI_EXTENSION_NAME}/index.ts` }
}
```

- [ ] **Step 4: Прогнати тест — pass**

Run: `cd npm && bun test scripts/tests/sync-pi-extensions.test.mjs`
Expected: 3 нові pass (загалом 8 із Task 1 + 3 = pass на цьому файлі)

- [ ] **Step 5: Commit**

```bash
git add npm/scripts/sync-claude-config.mjs npm/scripts/tests/sync-pi-extensions.test.mjs
git commit -m "feat(pi): add syncPiExtensions function

Копіює bundled .pi-template/extensions/n-cursor-adr/index.ts у
.pi/extensions/n-cursor-adr/index.ts проєкту. Fully-owned, перезаписується
на кожному sync-у. Якщо bundled template відсутній — no-op.
"
```

---

## Task 3: Orphan-cleanup для `.pi/extensions/n-cursor-adr/`

**Files:**

- Modify: `npm/scripts/sync-claude-config.mjs` (~25 LOC)
- Modify: `npm/scripts/tests/sync-pi-extensions.test.mjs` (тести cleanup)

- [ ] **Step 1: Failing-тест на cleanup**

Додати у `sync-pi-extensions.test.mjs`:

```js
import { rm } from 'node:fs/promises'
import { removeOrphanPiExtension } from '../sync-claude-config.mjs'

describe('removeOrphanPiExtension', () => {
  test('видаляє .pi/extensions/n-cursor-adr/ якщо існує', async () => {
    await withTmpCwd(async cwd => {
      const extDir = join(cwd, PI_EXTENSIONS_DIR, PI_EXTENSION_NAME)
      await mkdir(extDir, { recursive: true })
      await writeFile(join(extDir, 'index.ts'), '// stale\n', 'utf8')
      const result = await removeOrphanPiExtension(cwd)
      expect(result.removed).toBe(true)
      expect(result.path).toBe(`${PI_EXTENSIONS_DIR}/${PI_EXTENSION_NAME}`)
      expect(existsSync(extDir)).toBe(false)
    })
  })

  test('no-op якщо директорії немає', async () => {
    await withTmpCwd(async cwd => {
      const result = await removeOrphanPiExtension(cwd)
      expect(result.removed).toBe(false)
      expect(result.path).toBe('')
    })
  })

  test('не чіпає інші extensions у .pi/extensions/', async () => {
    await withTmpCwd(async cwd => {
      const ours = join(cwd, PI_EXTENSIONS_DIR, PI_EXTENSION_NAME)
      const userOwn = join(cwd, PI_EXTENSIONS_DIR, 'user-custom')
      await mkdir(ours, { recursive: true })
      await mkdir(userOwn, { recursive: true })
      await writeFile(join(ours, 'index.ts'), '', 'utf8')
      await writeFile(join(userOwn, 'index.ts'), '// user\n', 'utf8')
      await removeOrphanPiExtension(cwd)
      expect(existsSync(ours)).toBe(false)
      expect(existsSync(userOwn)).toBe(true)
    })
  })
})
```

- [ ] **Step 2: Прогнати — fail**

Run: `cd npm && bun test scripts/tests/sync-pi-extensions.test.mjs`
Expected: 3 нові fail (`removeOrphanPiExtension` не існує)

- [ ] **Step 3: Імплементувати `removeOrphanPiExtension`**

У `sync-claude-config.mjs`, ПІД `syncPiExtensions` додати:

```js
import { rm } from 'node:fs/promises' // якщо `rm` ще не імпортований — перевірити поточний import-блок

/**
 * Видаляє `.pi/extensions/n-cursor-adr/` директорію з проєкту-споживача.
 * Викликається коли правило `adr` вимкнено у `.n-cursor.json` (симетрично до
 * cleanup-у `.claude/hooks/{capture,normalize}-decisions.sh`).
 *
 * @param {string} projectRoot корінь проєкту-споживача
 * @returns {Promise<{ removed: boolean, path: string }>} чи було щось видалено та відносний шлях
 */
export async function removeOrphanPiExtension(projectRoot) {
  const extDir = join(projectRoot, PI_EXTENSIONS_DIR, PI_EXTENSION_NAME)
  if (!existsSync(extDir)) {
    return { removed: false, path: '' }
  }
  await rm(extDir, { recursive: true, force: true })
  return { removed: true, path: `${PI_EXTENSIONS_DIR}/${PI_EXTENSION_NAME}` }
}
```

**Verify import-блоку** на початку файла:

```js
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
```

→ додати `rm` якщо відсутній:

```js
import { chmod, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
```

- [ ] **Step 4: Прогнати — pass**

Run: `cd npm && bun test scripts/tests/sync-pi-extensions.test.mjs`
Expected: всі pass

- [ ] **Step 5: Commit**

```bash
git add npm/scripts/sync-claude-config.mjs npm/scripts/tests/sync-pi-extensions.test.mjs
git commit -m "feat(pi): add removeOrphanPiExtension cleanup

Видаляє .pi/extensions/n-cursor-adr/ коли правило adr вимкнено
(симетрично до cleanup-у .claude/hooks/{capture,normalize}-decisions.sh).
"
```

---

## Task 4: Інтеграція у `syncClaudeConfig` головний потік

**Files:**

- Modify: `npm/scripts/sync-claude-config.mjs` (`syncClaudeConfig` — додати `piExtension` поле у return)
- Modify: `npm/scripts/tests/sync-pi-extensions.test.mjs` (інтеграційний тест на gating)

- [ ] **Step 1: Failing-тест на інтеграцію**

Додати у `sync-pi-extensions.test.mjs`:

```js
import { syncClaudeConfig } from '../sync-claude-config.mjs'

describe('syncClaudeConfig + pi extension gating', () => {
  test('коли adr ∈ rules — створює .pi/extensions/n-cursor-adr/index.ts', async () => {
    await withTmpCwd(async cwd => {
      const pkgRoot = await setupPiTemplate(cwd)
      // Також треба .claude-template/ для повного syncClaudeConfig:
      await mkdir(join(cwd, 'pkg/.claude-template/hooks'), { recursive: true })
      await mkdir(join(cwd, 'pkg/.claude-template/commands'), { recursive: true })
      await writeFile(join(cwd, 'pkg/.claude-template/settings.template.json'), '{}', 'utf8')
      await writeFile(join(cwd, 'pkg/.claude-template/hooks/capture-decisions.sh'), '#!/usr/bin/env bash\n', 'utf8')
      await writeFile(join(cwd, 'pkg/.claude-template/hooks/normalize-decisions.sh'), '#!/usr/bin/env bash\n', 'utf8')

      const result = await syncClaudeConfig({
        projectRoot: cwd,
        bundledPackageRoot: pkgRoot,
        enabled: true,
        rules: ['adr']
      })

      expect(result.piExtension).toBe(true)
      expect(existsSync(join(cwd, PI_EXTENSIONS_DIR, PI_EXTENSION_NAME, 'index.ts'))).toBe(true)
    })
  })

  test('коли adr ∉ rules — видаляє існуючий .pi/extensions/n-cursor-adr/', async () => {
    await withTmpCwd(async cwd => {
      const pkgRoot = await setupPiTemplate(cwd)
      await mkdir(join(cwd, 'pkg/.claude-template/hooks'), { recursive: true })
      await mkdir(join(cwd, 'pkg/.claude-template/commands'), { recursive: true })
      await writeFile(join(cwd, 'pkg/.claude-template/settings.template.json'), '{}', 'utf8')

      const existing = join(cwd, PI_EXTENSIONS_DIR, PI_EXTENSION_NAME)
      await mkdir(existing, { recursive: true })
      await writeFile(join(existing, 'index.ts'), '// stale\n', 'utf8')

      const result = await syncClaudeConfig({
        projectRoot: cwd,
        bundledPackageRoot: pkgRoot,
        enabled: true,
        rules: [] // adr відсутній
      })

      expect(result.piExtension).toBe(false)
      expect(existsSync(existing)).toBe(false)
    })
  })

  test('коли claude-config: false (enabled=false) — pi extension не створюється', async () => {
    await withTmpCwd(async cwd => {
      const pkgRoot = await setupPiTemplate(cwd)
      const result = await syncClaudeConfig({
        projectRoot: cwd,
        bundledPackageRoot: pkgRoot,
        enabled: false,
        rules: ['adr']
      })
      expect(result.piExtension).toBe(false)
      expect(existsSync(join(cwd, PI_EXTENSIONS_DIR, PI_EXTENSION_NAME, 'index.ts'))).toBe(false)
    })
  })
})
```

- [ ] **Step 2: Прогнати — fail**

Run: `cd npm && bun test scripts/tests/sync-pi-extensions.test.mjs`
Expected: 3 нові fail (`result.piExtension` undefined)

- [ ] **Step 3: Інтегрувати у `syncClaudeConfig`**

У `sync-claude-config.mjs` знайти `syncClaudeConfig` (line ~499). У `return`-об'єктах і в gated-секції додати `piExtension` поле.

Замінити early-return `if (!enabled)`-блок:

```js
if (!enabled) {
  return {
    settings: false,
    cursorHooks: false,
    commands: [],
    adrHook: false,
    adrNormalizeHook: false,
    gitignoreAdr: false,
    piExtension: false
  }
}
```

Замінити early-return `!existsSync(templateDir)`-блок:

```js
if (!existsSync(templateDir)) {
  return {
    settings: false,
    cursorHooks: false,
    commands: [],
    adrHook: false,
    adrNormalizeHook: false,
    gitignoreAdr: false,
    piExtension: false
  }
}
```

ПІСЛЯ блоку gitignoreAdr (line ~528), ДО `syncClaudeSettings`:

```js
const piExtension = includeAdrHook
  ? await syncPiExtensions(projectRoot, bundledPackageRoot)
  : await removeOrphanPiExtension(projectRoot).then(r => ({ written: false, path: r.path }))
```

У фінальному `return`-об'єкті додати:

```js
return {
  settings: settings.written,
  cursorHooks: cursorHooks.written,
  commands,
  adrHook: adrHook.written,
  adrNormalizeHook: adrNormalizeHook.written,
  gitignoreAdr: gitignoreAdr.written,
  piExtension: piExtension.written
}
```

Оновити JSDoc `@returns`-рядок (line 497):

```js
 * @returns {Promise<{ settings: boolean, cursorHooks: boolean, commands: string[], adrHook: boolean, adrNormalizeHook: boolean, gitignoreAdr: boolean, piExtension: boolean }>} прапорці записів settings/Cursor hooks/ADR-hook(s)/`.gitignore`/pi-extension та список slash-команд
```

- [ ] **Step 4: Прогнати — pass**

Run: `cd npm && bun test scripts/tests/sync-pi-extensions.test.mjs`
Expected: всі pass

- [ ] **Step 5: Запустити повний test suite перевірити, що нічого не зламали**

Run: `cd npm && bun test --parallel`
Expected: 0 fail

- [ ] **Step 6: Commit**

```bash
git add npm/scripts/sync-claude-config.mjs npm/scripts/tests/sync-pi-extensions.test.mjs
git commit -m "feat(pi): integrate syncPiExtensions into syncClaudeConfig

Gating: adr ∈ rules → copy bundled template до .pi/extensions/n-cursor-adr/index.ts;
adr ∉ rules → cleanup існуючої директорії. Опт-аут через claude-config: false
(симетрично до bash-хуків, які теж шаряться через .claude/hooks/).
Поле piExtension у syncClaudeConfig-відповіді.
"
```

---

## Task 5: Wire reporting у `n-cursor.js`

**Files:**

- Modify: `npm/bin/n-cursor.js` (`runSyncStep` після `syncClaudeConfig` — додати рядок до `parts`)

- [ ] **Step 1: Прочитати поточний reporting-блок**

Run: `grep -n "result.adrHook\|result.adrNormalizeHook\|result.gitignoreAdr\|parts.push" npm/bin/n-cursor.js | head`

Знайти секцію, де формується `parts = []` після `syncClaudeConfig` (line ~1390-ish).

- [ ] **Step 2: Додати рядок для pi-extension**

Біля існуючих `if (result.adrHook) parts.push('.claude/hooks/capture-decisions.sh')`, додати:

```js
if (result.piExtension) parts.push('.pi/extensions/n-cursor-adr/index.ts')
```

(Точне місце — після `if (result.gitignoreAdr) …`, перед закриваючою фігурною дужкою runSyncStep.)

- [ ] **Step 3: Smoke-тест ручний у самому репо**

Run: `cd /Users/vitaliytv/www/nitra/cursor && bun npm/bin/n-cursor.js 2>&1 | tail -25`
Expected:

- У виводі є рядок `🤖 Claude-конфіг: …, .pi/extensions/n-cursor-adr/index.ts`
- Файл `.pi/extensions/n-cursor-adr/index.ts` існує і містить `export default function`

- [ ] **Step 4: Перевірити syntax extension'у через jiti (sanity)**

Run: `cd /Users/vitaliytv/www/nitra/cursor && bun -e "import('./.pi/extensions/n-cursor-adr/index.ts').then(m => console.log(typeof m.default))"`
Expected: `function` (default export — функція)

Якщо bun reject'ить TS-сyntax: упевнитись, що файл валідний; pi грузить через jiti (TS-permissive), bun може бути строжчий. Це не блокує — у pi runtime jiti обходить.

- [ ] **Step 5: Commit**

```bash
git add npm/bin/n-cursor.js
git commit -m "feat(pi): report .pi/extensions/n-cursor-adr/index.ts у sync-summary

Після syncClaudeConfig n-cursor.js друкує згенеровані шляхи; додано
pi-extension у список (паралельно до .claude/hooks/capture-decisions.sh).
"
```

---

## Task 6: Bundle pi-template у npm-пакет

**Files:**

- Modify: `npm/package.json` (`files` array додати `".pi-template"`, bump version)

- [ ] **Step 1: Перевірити поточний `files`-блок**

Run: `grep -A 12 '"files"' npm/package.json`
Expected: побачити список `["types", "rules", "bin", ..., ".claude-template", "AGENTS.template.md", ...]`

- [ ] **Step 2: Додати `.pi-template`**

У `npm/package.json` після `".claude-template"` додати рядок:

```json
    ".pi-template",
```

Так, щоб блок виглядав:

```json
  "files": [
    "types",
    "rules",
    "bin",
    "github-actions",
    "schemas",
    "scripts",
    "skills",
    ".claude-template",
    ".pi-template",
    "AGENTS.template.md",
    "CHANGELOG.md",
    "!**/*.test.mjs",
    ...
  ],
```

- [ ] **Step 3: Bump version**

У `npm/package.json` замінити `"version": "1.22.0"` на `"version": "1.23.0"`.

(Якщо користувач уже бампнув на щось інше — використати поточне значення +0.1.0, minor bump.)

- [ ] **Step 4: Sync root `package.json` dep**

У кореневому `package.json` замінити `"@nitra/cursor": "^1.22.0"` на `"@nitra/cursor": "^1.23.0"`.

- [ ] **Step 5: Перевірити, що npm pack включає .pi-template**

Run: `cd npm && npm pack --dry-run 2>&1 | grep -E "\.pi-template|\.claude-template" | head -5`
Expected: бачимо `.pi-template/extensions/n-cursor-adr/index.ts` і `.claude-template/...`

- [ ] **Step 6: Commit**

```bash
git add npm/package.json package.json
git commit -m "chore(release): bump @nitra/cursor 1.22.0 → 1.23.0 + bundle .pi-template

Додано .pi-template/ у npm files array — bundled TS-extension
n-cursor-adr/index.ts шипиться разом із пакетом.
"
```

---

## Task 7: CHANGELOG entry

**Files:**

- Modify: `npm/CHANGELOG.md` (новий запис `[1.23.0]`)

- [ ] **Step 1: Прочитати існуючу шапку CHANGELOG**

Run: `head -15 npm/CHANGELOG.md`
Expected: побачити останній запис `## [1.22.0]` (або яка зараз поточна).

- [ ] **Step 2: Додати запис ВИЩЕ останнього**

У `npm/CHANGELOG.md` ПЕРЕД першим `## [1.22.0]` (або поточним latest) вставити:

```markdown
## [1.23.0] - 2026-05-25

### Added

- **Pi.dev ADR hooks** — bundled TS-extension `npm/.pi-template/extensions/n-cursor-adr/index.ts` копіюється у `.pi/extensions/n-cursor-adr/index.ts` проєкту-споживача коли `adr` ∈ `.n-cursor.json#rules`. На pi `agent_end` event серіалізує `ctx.sessionManager.getEntries()` у Claude-сумісний JSONL у `tmpdir()`, спавнить існуючі `.claude/hooks/{capture,normalize}-decisions.sh` через `pi.exec` (async, `signal: ctx.signal`, timeouts 180s/600s). Жодного дублювання bash-логіки: skip/throttle/LLM-CLI-selection лишається у bash. Recursion guard через env-vars `CAPTURE_DECISIONS_RUNNING` / `ADR_NORMALIZE_RUNNING`, які bash виставляє перед спавном LLM CLI.
- `npm/scripts/sync-claude-config.mjs`: експорт `PI_DIR`, `PI_EXTENSIONS_DIR`, `PI_TEMPLATE_DIR_NAME`, `PI_EXTENSION_NAME`; нова функція `syncPiExtensions(projectRoot, bundledPackageRoot)` (copy) і `removeOrphanPiExtension(projectRoot)` (cleanup); поле `piExtension: boolean` у відповіді `syncClaudeConfig`.
- `npm/package.json` `files` array: додано `.pi-template` — bundled-директорія шипиться разом із пакетом.
```

- [ ] **Step 3: Перевірити changelog-rule pass**

Run: `cd /Users/vitaliytv/www/nitra/cursor && npx --no @nitra/cursor fix changelog`
Expected: exit 0, без помилок

- [ ] **Step 4: Прогнати повний test suite фінально**

Run: `cd npm && bun test --parallel 2>&1 | tail -8`
Expected:

- `XXXX pass`
- `0 fail`

- [ ] **Step 5: Прогнати `npx @nitra/cursor fix` повністю (всі rule checks)**

Run: `cd /Users/vitaliytv/www/nitra/cursor && npx --no @nitra/cursor fix 2>&1 | grep -E "❌|✨ Результат" | tail -25`
Expected: усі рядки виду `✨ Результат: 1/1 правил без зауважень`

- [ ] **Step 6: Final commit**

```bash
git add npm/CHANGELOG.md
git commit -m "docs(changelog): add 1.23.0 entry — pi.dev ADR hooks

CHANGELOG-запис про bundled TS-extension n-cursor-adr та
syncPiExtensions/removeOrphanPiExtension у sync-claude-config.mjs.
"
```

---

## Self-review checklist (виконано перед хендофом)

**Spec coverage:**

| Spec section                                      | Implementing task             |
| ------------------------------------------------- | ----------------------------- |
| Pi-extension TS source (Component 1)              | Task 1                        |
| `syncPiExtensions` + constants (Component 2)      | Task 2                        |
| Orphan cleanup (Component 2 cleanup)              | Task 3                        |
| Wire `syncClaudeConfig` (Component 2 integration) | Task 4                        |
| Reporting у n-cursor.js                           | Task 5                        |
| Bundle через `files` array                        | Task 6                        |
| CHANGELOG + version bump                          | Task 6 + Task 7               |
| Transcript serialization                          | Task 1 (inline у TS template) |
| Recursion guard                                   | Task 1 (inline у TS template) |
| Gating на `adr` ∈ rules                           | Task 4                        |

**Placeholder scan:** жодних "TBD", "TODO", "implement later". Усі код-блоки повні.

**Type consistency:**

- `syncPiExtensions(projectRoot, bundledPackageRoot)` — same signature у тестах і у sync-claude-config.mjs
- `removeOrphanPiExtension(projectRoot)` — same
- `PI_EXTENSIONS_DIR = '.pi/extensions'`, `PI_EXTENSION_NAME = 'n-cursor-adr'` — використовуються консистентно
- `result.piExtension: boolean` — same name у return-об'єкті і у тесті

**Risks acknowledged (з spec):**

1. Pi tool names можуть не збігатися з `Edit|Write|MultiEdit` → tooling-only skip не спрацює. **Action:** не блокує MVP; перший прогон покаже, expand bash jq filter якщо треба.
2. `ctx.sessionId` може не існувати → fallback на `randomUUID()` (вже у Task 1 step 3).
3. Pi extension API stability → version-pin не робимо (Task 1 поки без `package.json` у `.pi-template/extensions/n-cursor-adr/`).
4. jiti TS-syntax → Task 5 step 4 sanity-перевірка через bun import.
