# Pi.dev extensions for ADR capture / normalize hooks

**Status:** draft (brainstorming)
**Date:** 2026-05-25
**Touches:** `npm/bin/n-cursor.js`, `npm/scripts/sync-claude-config.mjs`, `npm/.pi-template/extensions/` (new), `.pi/extensions/n-cursor-adr/` (sync output)

## Context

`@nitra/cursor` зараз шарить ADR-pipeline між Claude Code і Cursor Agent через bash-скрипти у `.claude/hooks/`:

- [.claude-template/hooks/capture-decisions.sh](../../../npm/.claude-template/hooks/capture-decisions.sh) — на Stop event витягає role+content+thinking+tool_use із JSONL транскрипту, спавнить LLM CLI (`claude -p` або `cursor-agent -p`) для генерації ADR-чернетки у `docs/adr/<timestamp>-<slug>.md`.
- [.claude-template/hooks/normalize-decisions.sh](../../../npm/.claude-template/hooks/normalize-decisions.sh) — на Stop event консолідує накопичені чернетки у канонічний MADR-формат за порогом.

Обидва вже multi-platform (Claude `.type=user/assistant`, Cursor `.role=user/assistant` + `workspace_roots[]`). Pi.dev — третя платформа, яка не запускає bash-хуки нативно: pi використовує TS-extensions як єдиний механізм lifecycle-перехоплення (event `agent_end` — аналог Claude `Stop`).

Pi-skills вже згенеровано (1.19.0 → `.pi/skills/<id>/SKILL.md`). Залишається hook-частина для ADR.

## Non-goals

- **Не порт PostToolUse fix-routing** (`post-tool-use-fix.mjs`, 1.21.0). Pi `tool_result` event — інший дизайн, окремий spec.
- **Не переписувати bash-логіку у TS.** 825 LOC bash (capture + normalize) лишаються source of truth.
- **Не змінювати `.claude/hooks/` location.** Шаринг між Claude+pi через одну директорію.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ pi.dev session                                          │
│                                                          │
│   agent_end event                                       │
│        │                                                 │
│        ▼                                                 │
│  ┌───────────────────────────────────────┐              │
│  │ .pi/extensions/n-cursor-adr/index.ts │              │
│  │                                       │              │
│  │  1. read sessionManager.getEntries() │              │
│  │  2. serialize → tmp JSONL (Claude    │              │
│  │     compatible format)               │              │
│  │  3. build stdin JSON:                │              │
│  │     { transcript_path, session_id,   │              │
│  │       CLAUDE_PROJECT_DIR: ctx.cwd }  │              │
│  │  4. pi.exec('bash', [                │              │
│  │       '.claude/hooks/capture-...sh'  │              │
│  │     ], { input: jsonStdin })         │              │
│  │  5. pi.exec(...) for normalize       │              │
│  │     (async, не блокує agent_end)     │              │
│  └───────────────────────────────────────┘              │
│                                                          │
└─────────────────────────────────────────────────────────┘
            │
            ▼
   .claude/hooks/capture-decisions.sh
   .claude/hooks/normalize-decisions.sh
            │
            ▼
   docs/adr/<timestamp>-<slug>.md (drafts → MADR)
```

## Components

### 1. Pi-extension source: `npm/.pi-template/extensions/n-cursor-adr/index.ts`

Single-file TS extension у `npm`-пакеті (bundled з релізом). Шлях симетричний до `npm/.claude-template/hooks/` (директорія `.pi-template/` — нова).

**Default export — pi factory:**

```typescript
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export default function (pi: ExtensionAPI) {
  pi.on('agent_end', async (event, ctx) => {
    // Recursion guard: коли bash спавнить LLM CLI (claude/cursor-agent),
    // той може ініціювати свою pi-сесію. CAPTURE_DECISIONS_RUNNING + ADR_NORMALIZE_RUNNING
    // env-vars вже інспектуються bash-скриптами на старті; pi-extension лише пробрасує їх.
    if (process.env.CAPTURE_DECISIONS_RUNNING || process.env.ADR_NORMALIZE_RUNNING) {
      return
    }

    const entries = ctx.sessionManager.getEntries()
    const jsonlPath = join(tmpdir(), `n-cursor-pi-transcript-${Date.now()}.jsonl`)
    const lines = entries
      .filter(e => e.message?.role === 'user' || e.message?.role === 'assistant')
      .map(e => JSON.stringify({
        type: e.message.role,          // bash: .type == "user"|"assistant"
        message: e.message               // .role / .content[]
      }))
      .join('\n')
    writeFileSync(jsonlPath, lines + '\n', 'utf8')

    const stdinPayload = JSON.stringify({
      transcript_path: jsonlPath,
      session_id: ctx.sessionId ?? 'pi-unknown',
      // CLAUDE_PROJECT_DIR — bash дефолтить на $CURSOR_WORKSPACE_ROOT або $PWD;
      // передаємо ctx.cwd як CLAUDE_PROJECT_DIR через env (нижче).
    })

    const envOverride = { ...process.env, CLAUDE_PROJECT_DIR: ctx.cwd }

    // Spawn обидва скрипти async — порядок не критичний (normalize має власну
    // throttle-логіку через ADR_NORMALIZE_MIN_INTERVAL_HOURS).
    await Promise.allSettled([
      pi.exec('bash', ['.claude/hooks/capture-decisions.sh'], {
        cwd: ctx.cwd,
        env: envOverride,
        input: stdinPayload,
        signal: ctx.signal,
        timeout: 180_000
      }),
      pi.exec('bash', ['.claude/hooks/normalize-decisions.sh'], {
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

**Розмір:** ~50 LOC. Жодного дублювання логіки bash; вся skip/throttle/LLM-CLI-selection логіка лишається у bash.

### 2. CLI sync: `npm/bin/n-cursor.js` + `npm/scripts/sync-claude-config.mjs`

Нова константа і функція синхронізації, симетричні до існуючих:

```js
// npm/bin/n-cursor.js
const PI_EXTENSIONS_DIR = '.pi/extensions'
const PI_TEMPLATE_DIR = '.pi-template'
const BUNDLED_PI_TEMPLATE_DIR = join(binDir, '..', PI_TEMPLATE_DIR)
```

**`syncPiExtensions(rules)` у `sync-claude-config.mjs`:**

- Запускається коли `adr` ∈ `rules` (gating симетричне до Claude hook copy: див. `syncAdrHook`/`syncAdrNormalizeHook`).
- Копіює `npm/.pi-template/extensions/n-cursor-adr/index.ts` → `.pi/extensions/n-cursor-adr/index.ts`.
- Cleanup: якщо `adr` ∉ rules, видаляє `.pi/extensions/n-cursor-adr/` (similar to existing managed hook cleanup).
- Always-on, без `pi-config: false` опт-аута (симетрично до always-on `.pi/skills/`).

**Інтеграція у головний потік `n-cursor.js`:**

Усередині існуючого `await runSyncStep('❌ Не вдалося синхронізувати Claude-конфіг: ', …)`-блоку додається паралельний крок:

```js
const piResult = await syncPiExtensions({
  projectRoot: cwd(),
  bundledPackageRoot: effectivePackageRoot,
  rules
})
if (piResult.extensionsCopied.length > 0) {
  console.log(`🥧 Pi extensions: ${piResult.extensionsCopied.join(', ')}`)
}
```

### 3. Transcript serialization

Pi `sessionManager.getEntries()` повертає масив із полями `.message.{role, content}`. Bash-jq фільтр у `capture-decisions.sh:102-132` приймає обидва формати:

- Claude JSONL: `.type == "user" or "assistant"` + `.message.{role, content[]}`
- Cursor JSONL: `.role == "user" or "assistant"` + `.content[]`

Pi-extension пише у Claude-format:

```jsonl
{"type":"user","message":{"role":"user","content":"…"}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"…"},{"type":"tool_use","name":"Edit","input":{"file_path":"…"}}]}}
```

**Open question:** як саме pi entries мапляться у tool_use поля? `Edit/Write/MultiEdit` назви тулів у pi можуть відрізнятись (e.g., `bash`, `editor`). Це впливає на tooling-only skip (bash jq:148-157 шукає саме `Edit|Write|MultiEdit`). Якщо pi використовує інші назви — skip ніколи не спрацює і кожна pi-сесія генеруватиме ADR-чернетку. **Mitigation:** перший прогон через pi покаже actual tool names; розширимо bash allowlist (опц., minor change у jq filter).

### 4. Recursion guard

Bash вже має recursion guards через env vars:
- `CAPTURE_DECISIONS_RUNNING=1` у `capture-decisions.sh:19-22`
- `ADR_NORMALIZE_RUNNING=1` у `normalize-decisions.sh:25-28`

Pi-extension перевіряє ці env vars на старті `agent_end` handler — це ловить випадок, коли bash spawn'ить LLM CLI, який стартує НОВУ pi-сесію (рекурсивний trigger). Bash вже виставляє ці env-vars перед spawn, тож inheritance в child process працює.

### 5. Gating

Pi extension створюється тільки коли `adr` ∈ `.n-cursor.json#rules` — точна копія current Claude flow:
- `syncClaudeConfig` уже має `if (rules.includes('adr'))` checks для `syncAdrHook` / `syncAdrNormalizeHook`.
- `syncPiExtensions` додається з тим самим check.

Якщо проєкт прибирає `adr` з `rules`:
- Claude hooks: `removeOrphanAdrHook` видаляє `.claude/hooks/{capture,normalize}-decisions.sh`.
- Pi extension: симетричний cleanup видаляє `.pi/extensions/n-cursor-adr/`.

## Data flow

```
1. Pi user submits prompt → agent processes → agent_end fires
2. Extension handler:
   a. Check recursion env vars → bail if set
   b. sessionManager.getEntries() → in-memory message list
   c. Serialize to /tmp/n-cursor-pi-transcript-<ts>.jsonl
   d. Build stdin JSON {transcript_path, session_id}
   e. Set CLAUDE_PROJECT_DIR=ctx.cwd in spawned env
   f. pi.exec bash capture-decisions.sh — async, 180s timeout
   g. pi.exec bash normalize-decisions.sh — async, 600s timeout
3. Bash scripts:
   - Read stdin JSON
   - jq на transcript_path → extract role/content/thinking/tool_use
   - Tooling-only skip via git diff (якщо $ADR_NORMALIZE_SKIP_TOOLING_ONLY=1)
   - Spawn LLM CLI (claude || cursor-agent) → write ADR draft
4. ADR drafts накопичуються у docs/adr/ → normalize.sh консолідує у MADR
```

## Error handling

- **Bash скрипт не існує** (`.claude/hooks/capture-decisions.sh` відсутній — pi-only проєкт із `claude-config: false`): `pi.exec` поверне ENOENT, extension робить `ctx.ui.notify('@nitra/cursor: ADR hooks не встановлені, увімкни claude-config у .n-cursor.json', 'warning')` і return.
- **Bash тайм-аут** (180s/600s): pi-extension ловить, логує `ctx.ui.notify` warning, не throw.
- **LLM CLI не знайдено**: bash сам мовчки `exit 0` (див. `capture-decisions.sh:6-10`). Extension отримує exit 0 — ОК.
- **Transcript серіалізація fail** (write tmp file): catch, `ctx.ui.notify` error, return.

## Testing strategy

**Unit (npm/scripts/tests/):**
- `pi-extension-template.test.mjs` — fixture-based, перевіряє що bundled `.pi-template/extensions/n-cursor-adr/index.ts` валідний TS і експортує default factory.

**Integration:**
- `sync-claude-config.test.mjs` — нові тести: `syncPiExtensions copies bundled template when adr enabled`, `removes .pi/extensions/n-cursor-adr/ when adr disabled`.

**Manual smoke:**
- `pi -e .pi/extensions/n-cursor-adr/index.ts` із test session, перевірити що `.claude/hooks/capture-decisions.sh` спавниться і пише у `.claude/hooks/capture-decisions.log`.

Жодних змін у bash-тестах (`rules/adr/js/tests/`): bash unchanged.

## CHANGELOG line

```markdown
## [1.22.x] - 2026-05-XX

### Added

- **Pi.dev ADR hooks** — bundled TS-extension `.pi/extensions/n-cursor-adr/index.ts`, синкається симетрично до `.claude/hooks/`. На pi `agent_end` event серіалізує `sessionManager.getEntries()` у Claude-сумісний JSONL у `/tmp/` і спавнить існуючі `.claude/hooks/{capture,normalize}-decisions.sh` через `pi.exec`. Жодного дублювання bash-логіки; pi-only проєкти отримують той самий ADR-pipeline. Gating: створюється коли `adr` ∈ `.n-cursor.json#rules`.
```

## Open questions / risks

1. **Pi message format ↔ Claude JSONL gap.** Якщо pi tool_use entries не мають `name: "Edit"|"Write"|"MultiEdit"`, tooling-only skip не спрацьовує — потенційно багато false-positive ADR-чернеток. **Action:** після першого прогону переглянути transcript, розширити bash jq filter якщо треба.

2. **`ctx.sessionId` доступний?** pi.dev docs згадують `ctx.sessionManager` але не явний `ctx.sessionId`. **Action:** при імплементації — fallback на `crypto.randomUUID()`, бо bash приймає будь-який string.

3. **Pi extension API stability.** `@earendil-works/pi-coding-agent` package може еволюціонувати. **Action:** version-pin у bundled `npm/.pi-template/package.json` при потребі.

4. **TS compilation.** Pi docs: «extensions loaded with jiti, TypeScript без compilation». Тобто bundled `.ts` файл копіюється as-is — без `tsc` крок у CLI sync. **Action:** перевірити при імплементації, що jiti підтримує наш TS-syntax (import types, async/await).

## Scope estimate

- Pi-extension TS: ~50 LOC
- `syncPiExtensions` у sync-claude-config.mjs: ~80 LOC (copy + cleanup, шаблонує існуючий `syncAdrHook`)
- Wiring у n-cursor.js: ~15 LOC
- Tests: ~100 LOC (template validity + sync integration)
- CHANGELOG + version bump

**Total: ~250 LOC, 1 нова directory у bundle (`npm/.pi-template/`).**
