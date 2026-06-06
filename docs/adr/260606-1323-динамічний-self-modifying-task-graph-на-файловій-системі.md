---
session: d0294f80-5a1c-42f7-98bb-df26b88de1e5
captured: 2026-06-06T13:23:29+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d0294f80-5a1c-42f7-98bb-df26b88de1e5.jsonl
---

Фіксуємо один файл `task.md`?
[user]
Фіксуємо один файл `task.md` і якщо інженер хоче змінити inputs це patch
[assistant]
[thinking]
The user confirms:
1. One file `task.md` that contains both the task and inputs
2. If the engineer wants to change inputs → that's a patch (follows the patches/patch-plan-<ts>.md / patches/patch-fact-<ts>.md protocol)

This is clean. Let me also note that the patch would be recorded in `patches/patch-plan-<ts>.md` → action → `patches/patch-fact-<ts>.md`, and the actual patched content would create a new version like `task-v2.md` while the original `task.md` stays immutable.

Or wait... if `task.md` is append-only, how does the engineer change its content? Options:
1. Create `task-v2.md` with new content
2. The patch document describes the change and takes precedence over task.md
3. The patch creates a new task directory (re-spawn)

Actually, since `task.md` is a document in the filesystem and we're in a worktree context, the engineer would:
1. Write `patches/patch-plan-<ts>.md` with the intent
2. Kill dependent worktrees
3. Create `task-v2.md` OR `task.md` is still in git and gets modified through a new commit in the engineer's worktree (which then merges)

Actually I think the cleanest approach in the context of git-worktrees: the engineer creates a worktree, modifies `task.md` in that worktree (since the file isn't being read by anyone), merges the change. The original is preserved in git history. The "append-only" was about not overwriting in-flight work, not about git history being immutable.

But the user said "append-only" — files only created, never modified. If the engineer patches task.md, it must create a new version. I think the cleanest design is:
- Original `task.md` preserved forever (immutable)
- If engineer wants to change inputs, they create `task.md` with new content in a new worktree representing the patch, and the orchestrator reads the LATEST version

Or simpler: `task-patch-<ts>.md` that contains ONLY the changed sections. The orchestrator merges task.md + latest task-patch-*.md to get the effective task.

For now, let me not over-engineer this and just confirm the user's decision: inputs change = patch. I'll let the specific mechanism of how a patch modifies task.md come up as a later question.

Let me update the document with the finalized task.md schema.
[assistant]
Зафіксовано. Оновлюю `думка.MD` з фінальною схемою `task.md` (об'єднаний файл).
[assistant]
[tool: Edit] {"replace_all":false,"file_path":"/Users/vitaliytv/www/nitra/cursor/docs/думка.MD","old_string":"### `task.md` (місія вузла)\n```markdown\n---\ncreated_at: 2026-06-06T10:00:00Z\nparent: research              # відсутній у кореневого вузла, відносно tasks/\ndeps:                          # відсутній якщо немає попередників\n  - collect-data\n  - fetch-sources\n---\n## Task\n(опис що саме має виконати цей вузол)\n\n## Done when\n(чіткий критерій: що означає \"вирішено\")\n\n# Опціональні секції\n## Контекст           ← довільна секція, будь-яка мова\n```","new_string":"### `task.md` (місія + вхідні дані вузла)\n```markdown\n---\ncreated_at: 2026-06-06T10:00:00Z\nparent: research              # відсутній у кореневого вузла, відносно tasks/\ndeps:                          # відсутній якщо немає попередників\n  - collect-data\n  - fetch-sources\n---\n## Task\n(опис що саме має виконати цей вузол)\n\n## Done when\n(чіткий критерій: що означає \"вирішено\")\n\n## Inputs\n\n### source-urls\nref: tasks/research/subgraph/collect-data/outputs.md#urls\n\n### project-context\nref: tasks/research/inputs.md#context\n\n### Додаткова інструкція\n(inline-текст довільною мовою)\n```\n\n**Правила `task.md`:**\n- `## Task`, `## Done when`, `## Inputs` — обов'язкові, англійські заголовки\n- Підсекції `## Inputs` — довільні назви, рекомендовано англійські\n- Зміна inputs = patch (новий файл `patches/patch-plan-<ts>.md`)\n- `inputs.md` як окремий файл **не використовується** — дані тільки в `task.md`"}
[user]
[tool_result] The file /Users/vitaliytv/www/nitra/cursor/docs/думка.MD has been updated successfully. (file state is current in your context — no need to Read it back)
[assistant]
Зафіксовано. `inputs.md` прибрано — всі вхідні дані тепер у `task.md`.

Переходимо до `outputs.md`?
[user]
так
[assistant]
Пропозиція схеми `outputs.md`:

```markdown
---
created_at: 2026-06-06T10:05:00Z
---
## report
Аналіз показав три основні закономірності...

## summary
ref: tasks/research/subgraph/analyze/outputs.md#conclusions
```

Питання:

**Зміст секцій** — тут може бути і inline-текст і `ref:` (на відміну від `task.md/Inputs` де тільки refs). Агент сам вирішує де писати безпосередньо, де посилатись. Підходить?

**Назви секцій** — довільні (агент сам вигадує назви портів). Нащадки посилаються на ці секції через `ref: .../outputs.md#report`. Тому назви повинні бути стабільними після запису. Оскільки файл append-only — це автоматично гарантовано.

**Стан вузла** — наявність `outputs.md` = вузол `resolved`. Більше нічого не потрібно. Погоджуєшся?
[user]
погоджуюсь
[assistant]
[thinking]
The user agrees with the outputs.md schema. I need to update the document and then move on to the next file.
[assistant]
Фіксую і оновлюю документ.
[assistant]
[tool: Edit] {"replace_all":false,"file_path":"/Users/vitaliytv/www/nitra/cursor/docs/думка.MD","old_string":"### `outputs.md` / `error.md`\n```markdown\n---\ncreated_at: 2026-06-06T10:05:00Z\n---\n## <port-name>\n(inline дані або ref на інший файл)\n```\n\n`помилка.md` / `error.md`:\n```markdown\n---\noccurred_at: 2026-06-06T10:05:00Z\ntype: execution-error | timeout | unresolvable\n---\n## Що пішло не так\n## Трасування  (опціонально)\n```","new_string":"### `outputs.md`\n```markdown\n---\ncreated_at: 2026-06-06T10:05:00Z\n---\n## report\nАналіз показав три основні закономірності...\n\n## summary\nref: tasks/research/subgraph/analyze/outputs.md#conclusions\n```\n\n**Правила `outputs.md`:**\n- Секції довільні — агент сам вигадує назви портів\n- Зміст: inline-текст або `ref:` — на розсуд агента\n- Наявність файлу = вузол `resolved`\n- Append-only гарантує стабільність назв секцій після запису\n\n### `error.md`\n```markdown\n---\ncreated_at: 2026-06-06T10:05:00Z\ntype: execution-error | timeout | unresolvable\n---\n## What went wrong\n\n## Trace\n(опціонально)\n```\n\n**Правила `error.md`:**\n- Наявність файлу = вузол `failed`\n- `type` — один з трьох значень\n- `## What went wrong`, `## Trace` — англійські заголовки (парсяться скриптом)\n- Деталі помилки — довільна мова"}
[user]
[tool_result] The file /Users/vitaliytv/www/nitra/cursor/docs/думка.MD has been updated successfully. (file state is current in your context — no need to Read it back)
[assistant]
`outputs.md` і `error.md` зафіксовані.

Наступний — `repair_history.md`. Пропозиція:

```markdown
---
created_at: 2026-06-06T10:00:00Z
budget_sec: 600
deadline: 2026-06-06T10:10:00Z
---
## Attempt 1 — 2026-06-06T10:01:00Z

**Reasoning:** схоже проблема в параметрі X...
**Patch:** змінив ref у task.md — нове джерело даних
**Result:** failed — Y все ще виникає

## Attempt 2 — 2026-06-06T10:03:00Z

**Reasoning:** спроба 1 не вийшла, тепер спробую Z
**Result:** escalated — вичерпав ідеї, час ще є
```

Питання:

**Append-only спосіб запису** — файл існує одразу при старті ремонту, кожна спроба дописується в кінець як нова секція `## Attempt N`. Чи краще кожна спроба = окремий файл (`repair-attempt-001.md`)?

**`budget_sec` і `deadline`** — у фронтматері `repair_history.md` чи краще в окремому `repair_context.md`?

**`## Attempt N` → LLM читає весь файл** і бачить всю історію в порядку. Це ключова перевага над JSON. Погоджуєшся?
[user]
перший варіант він простіший
budget_sec окремий файл  repair_context.md з часовим бюджетом  і очікуванням - дедлайном
[assistant]
[thinking]
The user confirms:
1. `repair_history.md` as a single append-only file (not separate files per attempt)
2. `budget_sec` and `deadline` in a separate `repair_context.md` file

So the files are:
- `repair_context.md` — time budget and deadline (written once at start of repair)
- `repair_history.md` — append-only log of all attempts

Let me finalize these schemas.
[assistant]
Зафіксовано:

```markdown
# repair_context.md
---
created_at: 2026-06-06T10:00:00Z
budget_sec: 600
deadline: 2026-06-06T10:10:00Z
---
```

```markdown
# repair_history.md
---
created_at: 2026-06-06T10:00:00Z
---
## Attempt 1 — 2026-06-06T10:01:00Z

**Reasoning:** ...
**Patch:** ...
**Result:** failed — ...

## Attempt 2 — 2026-06-06T10:03:00Z
...
```

**Правила:**
- `repair_context.md` — пишеться один раз, не змінюється
- `repair_history.md` — append-only, нова секція `## Attempt N` при кожній спробі
- Наявність `repair_context.md` = вузол під ремонтом
- Наявність `repair_history.md` без `outputs.md` = ремонт в процесі

Оновлюю документ і переходимо до `ops/` і `patches/`?
[user]
так
[assistant]
[tool: Edit] {"replace_all":false,"file_path":"/Users/vitaliytv/www/nitra/cursor/docs/думка.MD","old_string":"### `repair_history.md`\n```markdown\n---\ncreated_at: 2026-06-06T10:00:00Z\n---\n\n## Спроба 1 — 2026-06-06T10:01:00Z\n**Міркування:** схоже проблема в параметрі X...\n**Патч:** змінив вхідні дані\n**Результат:** помилка — Y все ще виникає\n\n## Спроба 2 — 2026-06-06T10:03:00Z\n**Міркування:** спроба 1 не вийшла, тепер...\n```","new_string":"### `repair_context.md`\n```markdown\n---\ncreated_at: 2026-06-06T10:00:00Z\nbudget_sec: 600\ndeadline: 2026-06-06T10:10:00Z\n---\n```\n\n**Правила `repair_context.md`:**\n- Пишеться один раз при старті ремонту, незмінний\n- Наявність файлу = вузол під ремонтом\n\n### `repair_history.md`\n```markdown\n---\ncreated_at: 2026-06-06T10:00:00Z\n---\n\n## Attempt 1 — 2026-06-06T10:01:00Z\n**Reasoning:** схоже проблема в параметрі X...\n**Patch:** змінив ref у task.md\n**Result:** failed — Y все ще виникає\n\n## Attempt 2 — 2026-06-06T10:03:00Z\n**Reasoning:** спроба 1 не вийшла, тепер спробую Z\n**Result:** escalated — вичерпав ідеї\n```\n\n**Правила `repair_history.md`:**\n- Append-only: нова секція `## Attempt N` при кожній спробі\n- LLM читає весь файл — повна історія в одному документі\n- Наявність без `outputs.md` = ремонт в процесі\n- `## Attempt N`, `**Reasoning:**`, `**Patch:**`, `**Result:**` — фіксовані англійські мітки (парсяться скриптом)"}
[user]
[tool_result] The file /Users/vitaliytv/www/nitra/cursor/docs/думка.MD has been updated successfully. (file state is current in your context — no need to Read it back)
[assistant]
Тепер `ops/` і `patches/`.

**`ops/spawn-plan-<ts>.md`:**

```markdown
---
created_at: 2026-06-06T10:00:00Z
nodes:
- id: collect-data
deps: []
- id: analyze
deps: [collect-data]
- id: synthesize
deps: [analyze]
---
## Reason
Задача занадто складна для атомарного виконання — потребує збору даних, аналізу і синтезу.
```

**`ops/spawn-fact-<ts>.md`:**
```markdown
---
created_at: 2026-06-06T10:00:05Z
nodes_created: [collect-data, analyze, synthesize]
---
```

**`ops/kill-plan-<ts>.md`:**
```markdown
---
created_at: 2026-06-06T10:05:00Z
kill_order: [synthesize, analyze]
reason: patch target collect-data
---
```

**`ops/kill-fact-<ts>.md`:**
```markdown
---
created_at: 2026-06-06T10:05:03Z
nodes_killed: [synthesize, analyze]
---
```

**`patches/patch-plan-<ts>.md`:**
```markdown
---
created_at: 2026-06-06T10:06:00Z
target_node: collect-data
---
## Reason
Джерело даних повертало неповні результати.

## Changes
Оновити `## Inputs / source-urls` — нове посилання на повне джерело.
```

**`patches/patch-fact-<ts>.md`:**
```markdown
---
created_at: 2026-06-06T10:06:10Z
result: success | failure
---
## Applied changes
```

Питання: `<ts>` у назвах файлів — ISO timestamp (`2026-06-06T10:00:00Z`) чи простіший формат (`20260606-100000`)?
[user]
простіший
[assistant]
[thinking]
The user prefers a simpler timestamp format: `20260606-100000` instead of ISO timestamp in file names.

Let me now update the document with all the ops/ and patches/ schemas and the simplified timestamp format.
[assistant]
Зафіксовано: `<ts>` = `YYYYMMDD-HHMMSS`, наприклад `ops/spawn-plan-20260606-100000.md`.

Оновлюю документ.
[assistant]
[tool: Edit] {"replace_all":false,"file_path":"/Users/vitaliytv/www/nitra/cursor/docs/думка.MD","old_string":"### ops/, patches/\n```markdown\n# ops/spawn-plan-<ts>.md\n---\ncreated_at: ...\nnodes:\n  - id: collect-data\n    deps: []\n  - id: analyze\n    deps:\n      - node: collect-data\n        port: results\n  - id: synthesize\n    deps:\n      - node: analyze\n        port: conclusions\n---\n## Причина декомпозиції\n```\n```markdown\n# ops/spawn-fact-<ts>.md\n---\ncreated_at: ...\nnodes_created: [collect-data, analyze, synthesize]\n---\n```\n```markdown\n# ops/kill-plan-<ts>.md / kill-fact-<ts>.md\n---\ncreated_at: ...\nkill_order: [synthesize, analyze]\nreason: patch target collect-data\n---\n```\n```markdown\n# patches/patch-plan-<ts>.md / patch-fact-<ts>.md\n---\ncreated_at: ...\ntarget_node: collect-data\n---\n## Reason\n## Changes that will be applied\n```\n```markdown\n---\ncreated_at: ...\nresult: success | failure\n---\n## Applied changes\n```","new_string":"### ops/, patches/\n\nФормат `<ts>` у назвах файлів: `YYYYMMDD-HHMMSS` (наприклад `20260606-100000`).\n\n```markdown\n# ops/spawn-plan-20260606-100000.md\n---\ncreated_at: 2026-06-06T10:00:00Z\nnodes:\n  - id: collect-data\n    deps: []\n  - id: analyze\n    deps: [collect-data]\n  - id: synthesize\n    deps: [analyze]\n---\n## Reason\nЗадача потребує збору даних, аналізу і синтезу.\n```\n\n```markdown\n# ops/spawn-fact-20260606-100005.md\n---\ncreated_at: 2026-06-06T10:00:05Z\nnodes_created: [collect-data, analyze, synthesize]\n---\n```\n\n```markdown\n# ops/kill-plan-20260606-100500.md\n---\ncreated_at: 2026-06-06T10:05:00Z\nkill_order: [synthesize, analyze]\nreason: patch target collect-data\n---\n```\n\n```markdown\n# ops/kill-fact-20260606-100503.md\n---\ncreated_at: 2026-06-06T10:05:03Z\nnodes_killed: [synthesize, analyze]\n---\n```\n\n```markdown\n# patches/patch-plan-20260606-100600.md\n---\ncreated_at: 2026-06-06T10:06:00Z\ntarget_node: collect-data\n---\n## Reason\nДжерело даних повертало неповні результати.\n\n## Changes\nОновити `## Inputs / source-urls` — нове посилання.\n```\n\n```markdown\n# patches/patch-fact-20260606-100610.md\n---\ncreated_at: 2026-06-06T10:06:10Z\nresult: success | failure\n---\n## Applied changes\n```"}
[user]
[tool_result] The file /Users/vitaliytv/www/nitra/cursor/docs/думка.MD has been updated successfully. (file state is current in your context — no need to Read it back)
[assistant]
Всі схеми файлів зафіксовані. Повний список:

| Файл | Призначення |
|---|---|
| `task.md` | місія + вхідні дані, незмінний |
| `outputs.md` | результати, наявність = resolved |
| `error.md` | помилка, наявність = failed |
| `repair_context.md` | часовий бюджет ремонту |
| `repair_history.md` | append-only лог спроб інженера |
| `ops/spawn-plan/fact-<ts>.md` | план і факт розкладання |
| `ops/kill-plan/fact-<ts>.md` | план і факт кілу залежних |
| `patches/patch-plan/fact-<ts>.md` | план і факт патчу |

Переходимо до **CLI контракту** (`n-cursor graph ...`)?
[user]
[react:👍]
почекай
ти написав є 10 кроків перед реалізацією ?
де ми знаходимось ?
[assistant]
[thinking]
The user is asking where we are in the 10-step plan before implementation. Let me recall the levels I laid out:

**Рівень 1 — без цього нічого не будується**
1. ✅ **Повна схема кожного файлу** — зроблено (task.md, outputs.md, error.md, repair_context.md, repair_history.md, ops/, patches/)
2. ✅ **Синтаксис посилань** — зафіксовано (`ref: path/to/file.md#section` і `ref: path/to/file.md lines 1-50`)
3. ✅ **Naming convention вузлів** — зафіксовано (kebab-case, унікальність в межах батька, id = назва директорії)
4. ❌ **CLI контракт** — не розпочато

**Рівень 2 — після рівня 1**
5. ❌ **Wrapper-скрипт специфікація**
6. ❌ **Ліміти ресурсів** — частково (MacBook, жорсткі ліміти, але конкретних чисел немає)
7. ❌ **Bootstrap протокол**

**Рівень 3 — після рівня 2**
8. ❌ **Observability контракт**
9. ❌ **Протокол відновлення після збою**
10. ❌ **Протокол агента-інженера**

So we're done with items 1-3 from Level 1, and item 4 (CLI contract) is the next step.
[assistant]
З 10 кроків:

**Рівень 1 (блокуючий):**
- ✅ 1. Повна схема кожного файлу
- ✅ 2. Синтаксис посилань (`ref:`)
- ✅ 3. Naming convention вузлів
- ⬜ 4. CLI контракт

**Рівень 2:**
- ⬜ 5. Wrapper-скрипт специфікація
- ⬜ 6. Ліміти ресурсів (числа є приблизні — MacBook)
- ⬜ 7. Bootstrap протокол

**Рівень 3:**
- ⬜ 8. Observability контракт
- ⬜ 9. Протокол відновлення після збою
- ⬜ 10. Протокол агента-інженера

Рівень 1 майже завершено — залишився CLI контракт. Продовжуємо?
[user]
так
[assistant]
CLI контракт — `n-cursor graph <команда>`.

Пропозиція базових команд:

```
n-cursor graph init <task-id>          # створити кореневий вузол tasks/<task-id>/task.md
n-cursor graph spawn <node-path>       # агент розклав вузол — зареєструвати дочірніх
n-cursor graph start <node-path>       # людина/оркестратор запускає агента у ворктрі
n-cursor graph done <node-path>        # агент завершив — outputs.md вже є, merge ворктрі
n-cursor graph fail <node-path>        # агент завершив з помилкою — error.md вже є
n-cursor graph kill <node-path>        # кілнути ворктрі вузла (з ops/kill-plan/fact)
n-cursor graph patch <node-path>       # інженер патчує вузол (з patches/plan/fact)
n-cursor graph status [node-path]      # показати стан вузла або всього дерева
```

Питання:

**`spawn`** — хто викликає? Агент сам через скрипт зсередини ворктрі, чи оркестратор (людина) після читання `ops/spawn-plan-*.md`?

**`start`** — це запускає wrapper-скрипт з агентом всередині? Тобто `start` = `git worktree add ... && claude --timeout ...`?

**`done` / `fail`** — викликає wrapper-скрипт автоматично після завершення агента, чи агент сам в кінці свого виконання?

**`status`** — виводить дерево в термінал чи пише у файл для observability?
[user]
spawn` — агент сам через скрипт зсередини ворктрі
start` — так
done` / `fail — wrapper-скрипт автоматично після завершення агента
status — виводить дерево в термінал
[assistant]
[thinking]
Now I have the CLI contract answers. Let me finalize the CLI contract:

- `spawn` — called by the agent itself from within the worktree
- `start` — launches wrapper script = git worktree add + claude with timeout
- `done`/`fail` — called automatically by wrapper script after agent finishes
- `status` — outputs tree to terminal

Let me also think about what other commands might be needed and what the full contract looks like with exit codes.

For the wrapper script, the flow would be:
1. `n-cursor graph start <node-path>` is called by human/orchestrator
2. Wrapper creates git worktree
3. Wrapper runs claude with system prompt + context files
4. On claude exit with code 0 → wrapper checks for `outputs.md` → calls `n-cursor graph done <node-path>`
5. On claude exit with non-zero or timeout → wrapper calls `n-cursor graph fail <node-path>`
6. On timeout → wrapper kills claude process → calls `n-cursor graph fail <node-path>` with type=timeout

Exit codes:
- 0 = success
- 1 = error
- 2 = already in that state (idempotent)

I should also think about `n-cursor graph repair <node-path>` for starting the engineer agent on a failed node.

And `n-cursor graph status` should show a tree like:
```
research [running]
├── collect-data [resolved ✓]
├── analyze [running ⟳]
│   └── fetch-page-1 [resolved ✓]
│   └── fetch-page-2 [pending ○]
└── synthesize [pending ○]
```
</s>
[assistant]
Чисто. Фінальний CLI контракт:

```
# Ініціалізація
n-cursor graph init <task-id>
→ створює tasks/<task-id>/task.md (порожній шаблон)
→ виходить: 0 успіх, 1 вже існує

# Запуск агента (wrapper-скрипт)
n-cursor graph start <node-path>
→ git worktree add .worktrees/<node-id>-<ts>
→ claude --timeout <budget_sec> [context files]
→ по завершенню: автоматично викликає done або fail

# Викликається агентом зсередині ворктрі
n-cursor graph spawn <node-path> --plan <plan-file>
→ валідує ops/spawn-plan-<ts>.md
→ створює subgraph/<child>/{task.md} для кожного вузла
→ пише ops/spawn-fact-<ts>.md

# Викликається wrapper-скриптом автоматично
n-cursor graph done <node-path>
→ перевіряє наявність outputs.md
→ merge ворктрі до main
→ виходить: 0 успіх, 1 outputs.md відсутній

n-cursor graph fail <node-path> --type <execution-error|timeout|unresolvable>
→ перевіряє наявність error.md
→ merge ворктрі до main
→ виходить: 0 успіх

# Керування
n-cursor graph kill <node-path>
→ читає ops/kill-plan-*.md
→ git worktree remove --force
→ пише ops/kill-fact-<ts>.md

n-cursor graph repair <node-path>
→ пише repair_context.md (budget_sec, deadline)
→ запускає engineer-wrapper з контекстом вузла

# Observability
n-cursor graph status [node-path]
→ виводить дерево в термінал:

research [running ⟳]
├── collect-data [resolved ✓]
├── analyze [running ⟳]
│     └── fetch-page-1 [resolved ✓]
│     └── fetch-page-2 [pending ○]
└── synthesize [pending ○]
```

**Exit codes (всі команди):** `0` = успіх, `1` = помилка, `2` = невалідний стан (idempotent guard).

Оновити `думка.MD` і переходимо до рівня 2?
[user]
так
[assistant]
[tool: Edit] {"replace_all":false,"file_path":"/Users/vitaliytv/www/nitra/cursor/docs/думка.MD","old_string":"## Відкриті питання\n\n**Критичні (рівень 1):**","new_string":"## CLI контракт\n\n```\nn-cursor graph init <task-id>\n  → створює tasks/<task-id>/task.md (порожній шаблон)\n  → exit: 0 успіх, 1 вже існує\n\nn-cursor graph start <node-path>\n  → git worktree add .worktrees/<node-id>-<ts>\n  → claude --timeout <budget_sec> [context files]\n  → по завершенню: автоматично викликає done або fail\n\nn-cursor graph spawn <node-path> --plan <plan-file>\n  → (агент викликає зсередині ворктрі)\n  → валідує ops/spawn-plan-<ts>.md\n  → створює subgraph/<child>/task.md для кожного вузла\n  → пише ops/spawn-fact-<ts>.md\n\nn-cursor graph done <node-path>\n  → (wrapper-скрипт автоматично після успіху агента)\n  → перевіряє наявність outputs.md\n  → merge ворктрі до main\n  → exit: 0 успіх, 1 outputs.md відсутній\n\nn-cursor graph fail <node-path> --type <execution-error|timeout|unresolvable>\n  → (wrapper-скрипт автоматично після збою агента)\n  → перевіряє наявність error.md\n  → merge ворктрі до main\n  → exit: 0 успіх\n\nn-cursor graph kill <node-path>\n  → читає ops/kill-plan-*.md\n  → git worktree remove --force\n  → пише ops/kill-fact-<ts>.md\n  → exit: 0 успіх, 1 ворктрі не існує\n\nn-cursor graph repair <node-path>\n  → пише repair_context.md (budget_sec, deadline)\n  → запускає engineer-wrapper з контекстом вузла\n\nn-cursor graph status [node-path]\n  → виводить дерево станів у термінал\n  → приклад виводу:\n      research [running ⟳]\n        ├── collect-data [resolved ✓]\n        ├── analyze [running ⟳]\n        │     └── fetch-page-1 [resolved ✓]\n        │     └── fetch-page-2 [pending ○]\n        └── synthesize [pending ○]\n```\n\n**Exit codes (всі команди):** `0` = успіх, `1` = помилка, `2` = невалідний стан.\n\n---\n\n## Відкриті питання\n\n**Критичні (рівень 1):**"}
[user]
[tool_result] The file /Users/vitaliytv/www/nitra/cursor/docs/думка.MD has been updated successfully. (file state is current in your context — no need to Read it back)
[assistant]
Рівень 1 завершено. Переходимо до **рівня 2**.

**Пункт 5 — Wrapper-скрипт специфікація:**

```bash
# n-cursor graph start <node-path> розгортається у:
1. git worktree add .worktrees/<node-id>-<ts> <branch>
2. claude \
--system-prompt <generated> \
--context task.md \
--context repair_history.md (якщо існує) \
--timeout <budget_sec від repair_context.md або дефолт>
3. exit 0 → n-cursor graph done <node-path>
exit ≠ 0 → n-cursor graph fail <node-path> --type execution-error
timeout → kill claude PID → n-cursor graph fail ... --type timeout
```

Питання:

**System prompt** — генерується wrapper-скриптом динамічно (містить шлях вузла, роль агента) чи статичний файл в репо?

**Context files** — які саме файли передаються агенту? `task.md` завжди, `repair_history.md` якщо є. Що ще: `task.md` батька? `outputs.md` попередників?

**`budget_sec` дефолт** — яке значення для першого запуску (не repair)? Для звичайного агента теж є timeout?
[user]
System prompt` — генерується динамічно
Context files**  — task.md завжди, `repair_history.md` якщо є, task.md батька, outputs.md попередників (наприклад якщо є deps)
budget_sec дефолт` — 10 хвилин і для звичайного агента теж є timeout
[assistant]
[thinking]
The user answered the wrapper-script questions:
- System prompt: generated dynamically
- Context files: task.md (always), repair_history.md (if exists), parent's task.md, deps' outputs.md
- budget_sec default: 10 minutes (600 sec) for all agents including regular ones

Let me update the doc and move to point 6 (resource limits).
[assistant]
Зафіксовано. Wrapper-скрипт:

```
context = [
task.md                          # завжди
parent/task.md                   # завжди (крім root)
<dep>/outputs.md per deps[]      # якщо є залежності
repair_history.md                # якщо файл існує
]
timeout = repair_context.deadline або 600s (дефолт)
```

Оновлюю документ і переходимо до **пункту 6 — ліміти ресурсів**.

Які конкретні числа для MacBook?

**Паралельні ворктрі** — скільки одночасно? Пропоную: max 3-5.

**Глибина графу** — max вкладеність subgraph/? Пропоную: max 5.

**Розмір файлу** — max розмір одного `.md`? Пропоную: 500KB.

**`budget_sec` max** — максимальний timeout для одного агента? Пропоную: 3600s (1 година).
[user]
3 паралельних ворктрі
глибина 10
розмір файлу 1мб
budget_sec max - 3600
[assistant]
[tool: Edit] {"replace_all":false,"file_path":"/Users/vitaliytv/www/nitra/cursor/docs/думка.MD","old_string":"**1 (оркестратор):** людина вручну на поточному етапі\n**2 (агент-wrapper):** скрипт відловлює timeout і завислі процеси\n**5 (freeze-сигнал):** скрипт може kill процес агента\n**6 (ліміти):** жорсткі мінімальні ліміти через MacBook\n**7 (назви):** людиночитабельні, унікальні в межах батька\n**8 (rollback):** кожен патч — окремий ворктрі, видаляється після завершення\n**10 (ізоляція):** агент може читати будь-які файли без обмежень","new_string":"**1 (оркестратор):** людина вручну на поточному етапі\n**2 (агент-wrapper):** скрипт відловлює timeout і завислі процеси\n**5 (freeze-сигнал):** скрипт може kill процес агента\n**6 (ліміти):** жорсткі мінімальні ліміти через MacBook\n**7 (назви):** людиночитабельні, унікальні в межах батька\n**8 (rollback):** кожен патч — окремий ворктрі, видаляється після завершення\n**10 (ізоляція):** агент може читати будь-які файли без обмежень\n\n## Wrapper-скрипт\n\n```\nn-cursor graph start <node-path>:\n\n1. git worktree add .worktrees/<node-id>-<ts> <branch>\n2. system_prompt = generate(<node-path>)   ← динамічно\n   context = [\n     task.md                               # завжди\n     ../task.md                            # task.md батька (крім root)\n     <dep>/outputs.md per deps[]           # outputs попередників\n     repair_history.md                     # якщо файл існує\n   ]\n   timeout = repair_context.deadline або 600s\n3. claude --system-prompt ... --timeout <timeout> [context files]\n4. exit 0   → n-cursor graph done <node-path>\n   exit ≠ 0 → n-cursor graph fail <node-path> --type execution-error\n   timeout  → kill PID → n-cursor graph fail ... --type timeout\n```\n\n## Ліміти ресурсів (MacBook)\n\n| Параметр | Ліміт |\n|---|---|\n| Паралельні ворктрі | 3 |\n| Глибина графу | 10 рівнів |\n| Розмір одного файлу | 1 MB |\n| budget_sec max | 3600s (1 год) |\n| budget_sec дефолт | 600s (10 хв) |"}
[user]
[tool_result] The file /Users/vitaliytv/www/nitra/cursor/docs/думка.MD has been updated successfully. (file state is current in your context — no need to Read it back)
[assistant]
**Пункт 7 — Bootstrap протокол:**

```
n-cursor graph init research
→ tasks/research/task.md    ← людина редагує вручну
→ людина запускає: n-cursor graph start tasks/research
```

Питання:

**`task.md` для root** — людина пише `## Task`, `## Done when` і `## Inputs` вручну перед стартом. `parent:` і `deps:` відсутні. Підходить?

**Де живе `tasks/`** — корінь репо чи окрема тека? Пропоную: `tasks/` відносно `cwd` де виконується CLI.

**Що якщо `tasks/` вже існує** — `init` повертає помилку чи просто додає новий вузол?
[user]
1 так
2 tasks/ відносно cwd
3 добавляє новий вузол
[assistant]
[thinking]
The user answered:
1. task.md for root - parent: and deps: absent, human writes manually - yes, ok
2. tasks/ relative to cwd
3. init adds a new node (doesn't error if tasks/ exists)

Now I need to update the document and move to Level 3.
[assistant]
Зафіксовано. Bootstrap протокол:

```
n-cursor graph init <task-id>
→ якщо tasks/ не існує → створює
→ якщо tasks/<task-id>/ вже є → exit 1
→ інакше → створює tasks/<task-id>/task.md (шаблон без parent/deps)
→ людина редагує task.md вручну
→ n-cursor graph start tasks/<task-id>
```

Оновлюю і переходимо до **рівня 3** — починаємо з **пункту 8 (Observability контракт)**.

`n-cursor graph status` повинен реконструювати повний граф зі сканування файлів. Алгоритм:

```
scan tasks/**/task.md → знаємо вузли і залежності
для кожного вузла визначаємо стан:
outputs.md існує  → resolved ✓
error.md існує    → failed ✗
worktree існує    → running ⟳
repair_context.md → repair ⚠
інакше            → pending ○
```

Питання:

**Формат виводу** — дерево в термінал (вже є). Чи потрібен також машинозчитуваний вивід, наприклад `--json`?

**Прогрес** — показувати кількість resolved/total? Наприклад `research [3/7 resolved]`?

**Час** — показувати `created_at` і скільки часу вузол виконується?
[user]
json так
прогрес так
час так
[assistant]
[tool: Edit] {"replace_all":false,"file_path":"/Users/vitaliytv/www/nitra/cursor/docs/думка.MD","old_string":"## Відкриті питання\n\n**Критичні (рівень 1):**","new_string":"## Bootstrap протокол\n\n```\nn-cursor graph init <task-id>\n  → tasks/ відносно cwd (створює якщо не існує)\n  → tasks/<task-id>/ вже є → exit 1\n  → інакше → creates tasks/<task-id>/task.md (шаблон без parent/deps)\n  → людина редагує task.md вручну\n  → n-cursor graph start tasks/<task-id>\n```\n\n`task.md` кореневого вузла:\n```markdown\n---\ncreated_at: 2026-06-06T10:00:00Z\n# parent: відсутній\n# deps: відсутній\n---\n## Task\n## Done when\n## Inputs\n```\n\n## Observability контракт\n\n`n-cursor graph status [node-path]` реконструює граф зі сканування файлів.\n\n**Визначення стану вузла:**\n```\noutputs.md існує    → resolved ✓\nerror.md існує      → failed ✗\nworktree існує      → running ⟳\nrepair_context.md   → repair ⚠\nінакше              → pending ○\n```\n\n**Термінальний вивід:**\n```\nresearch [running ⟳] [3/7 resolved] started 10хв тому\n  ├── collect-data [resolved ✓] 2хв\n  ├── analyze [running ⟳] 5хв\n  │     ├── fetch-page-1 [resolved ✓] 1хв\n  │     └── fetch-page-2 [pending ○]\n  └── synthesize [pending ○]\n```\n\n**JSON вивід (`--json`):**\n```json\n{\n  \"id\": \"research\",\n  \"state\": \"running\",\n  \"progress\": { \"resolved\": 3, \"total\": 7 },\n  \"started_at\": \"2026-06-06T10:00:00Z\",\n  \"elapsed_sec\": 600,\n  \"children\": [...]\n}\n```\n\n---\n\n## Відкриті питання\n\n**Критичні (рівень 1):**"}
[user]
[tool_result] The file /Users/vitaliytv/www/nitra/cursor/docs/думка.MD has been updated successfully. (file state is current in your context — no need to Read it back)
[assistant]
**Пункт 9 — Протокол відновлення після збою:**

Оркестратор при старті сканує:

```
tasks/**/ops/*-plan-*.md → шукає без відповідного *-fact-*.md
→ незавершена операція → відновити
```

Питання:

**Порядок відновлення** — від кореня вниз чи від листів вгору? Пропоную: від листів — спочатку завершити найглибші незавершені операції.

**Незавершений spawn** (plan є, fact немає) — перестворити дочірні вузли що відсутні, написати fact. Підходить?

**Незавершений kill** (plan є, fact немає) — повторити kill для вузлів у `kill_order` що ще мають ворктрі, написати fact. Підходить?

**Незавершений patch** (plan є, fact немає) — складніше: патч міг бути частково застосований. Чи є safe спосіб повторити?
[user]
листів
spawn так
kill так
patch  — якщо є факт частковий то тільки застосувати решту, якщо нема то всі зміни
[assistant]
[thinking]
The user answered:
1. Recovery order: from leaves (deepest first)
2. Incomplete spawn: re-create missing child nodes, write fact
3. Incomplete kill: re-kill remaining worktrees in kill_order, write fact
4. Incomplete patch: if there's a partial fact → apply remaining changes; if no fact → apply all changes

This is essentially idempotent operations: spawn-fact and kill-fact track what was done, so recovery can continue from where it left off. For patches, patch-fact could track which changes were applied successfully.

But patch-fact needs to track partial progress. Let me think about this:
- If patch-fact doesn't exist at all → apply all changes from patch-plan
- If patch-fact exists but `result: partial` → read what was applied → apply remaining

So patch-fact might need a new state: `result: success | failure | partial` + a list of applied changes.

Actually this means the patch-plan needs to list changes atomically — and patch-fact tracks which items from that list were completed. This is more granular than what we designed.

Let me propose adding `result: partial` to patch-fact with a `completed_changes` field.
[assistant]
Для patch-відновлення потрібно, щоб `patch-fact` фіксував часткове виконання. Оновлюємо схему:

```markdown
# patches/patch-fact-<ts>.md
---
created_at: ...
result: success | failure | partial
completed_changes:           # присутній якщо result: partial
- update-source-urls       # назви виконаних змін
---
## Applied changes
```

`patch-plan` відповідно нумерує зміни:

```markdown
## Changes
### update-source-urls
Оновити ref у ## Inputs / source-urls

### add-fallback-source
Додати новий ## Inputs / fallback-source
```

При відновленні: читаємо `patch-plan`, виключаємо `completed_changes` з `patch-fact` → застосовуємо решту.

Підходить?
[user]
так
[assistant]
[tool: Edit] {"replace_all":false,"file_path":"/Users/vitaliytv/www/nitra/cursor/docs/думка.MD","old_string":"---\n\n## Відкриті питання\n\n**Критичні (рівень 1):**","new_string":"## Протокол відновлення після збою\n\nПри старті оркестратор сканує:\n```\ntasks/**/ops/*-plan-*.md → без відповідного *-fact-*.md → незавершена операція\n```\n\nПорядок відновлення: **від листів вгору** (від найглибших спочатку).\n\n| Незавершена операція | Дія відновлення |\n|---|---|\n| spawn-plan без spawn-fact | Перестворити відсутні дочірні вузли, написати fact |\n| kill-plan без kill-fact | Повторити kill для вузлів що ще мають ворктрі, написати fact |\n| patch-plan без patch-fact | Застосувати всі зміни, написати fact |\n| patch-plan + patch-fact (partial) | Застосувати лише зміни відсутні в `completed_changes` |\n\n**Оновлена схема `patch-fact`:**\n```markdown\n---\ncreated_at: ...\nresult: success | failure | partial\ncompleted_changes:          # присутній якщо result: partial\n  - update-source-urls\n---\n## Applied changes\n```\n\n**`patch-plan` нумерує зміни:**\n```markdown\n## Changes\n### update-source-urls\nОновити ref у ## Inputs / source-urls\n\n### add-fallback-source\nДодати новий ## Inputs / fallback-source\n```\n\n---\n\n## Відкриті питання\n\n**Критичні (рівень 1):**"}
[user]
[tool_result] The file /Users/vitaliytv/www/nitra/cursor/docs/думка.MD has been updated successfully. (file state is current in your context — no need to Read it back)
[assistant]
**Пункт 10 — Протокол агента-інженера:**

Інженер запускається командою `n-cursor graph repair <node-path>`.

**Контекст що отримує інженер:**

```
task.md                    # місія вузла
error.md                   # що пішло не так
repair_context.md          # бюджет і дедлайн
repair_history.md          # попередні спроби (якщо є)
parent/task.md             # місія батька
<dep>/outputs.md           # outputs залежностей
```

**Що може зробити інженер:**

1. Дописати спробу в `repair_history.md`
2. Викликати `n-cursor graph kill` + `n-cursor graph patch` (якщо треба змінити task.md)
3. Створити нові дочірні вузли через `n-cursor graph spawn`
4. Оголосити `unresolvable` — викликати `n-cursor graph fail --type unresolvable`
5. При таймауті — wrapper автоматично пише в history і ескалує до батька

Питання:

**Ескалація** — `fail --type unresolvable` на поточному вузлі автоматично тригерить `repair` на батьківському, чи людина вирішує вручну?

**Інженер = той самий Claude** що й звичайний агент, але з іншим system prompt? Чи окрема модель/конфіг?
[user]
автоматично тригерить `repair` на батьківському
інженер = той самий Claude але з іншим system prompt
[assistant]
[thinking]
The user answered:
1. `fail --type unresolvable` automatically triggers `repair` on the parent
2. Engineer = same Claude with different system prompt

This completes level 3. Let me now update the document and then we'll have covered all 10 steps before implementation.
[assistant]
[tool: Edit] {"replace_all":false,"file_path":"/Users/vitaliytv/www/nitra/cursor/docs/думка.MD","old_string":"---\n\n## Відкриті питання\n\n**Критичні (рівень 1):**","new_string":"## Протокол агента-інженера\n\nЗапускається через `n-cursor graph repair <node-path>` (той самий Claude, інший system prompt).\n\n**Контекст що отримує інженер:**\n```\ntask.md                    # місія вузла\nerror.md                   # що пішло не так\nrepair_context.md          # бюджет і дедлайн\nrepair_history.md          # попередні спроби (якщо є)\n../task.md                 # місія батька\n<dep>/outputs.md           # outputs залежностей\n```\n\n**Дії інженера:**\n1. Дописати спробу в `repair_history.md` (`## Attempt N`)\n2. `n-cursor graph kill` + `n-cursor graph patch` — змінити task.md вузла\n3. `n-cursor graph spawn` — додати нові дочірні вузли\n4. `n-cursor graph fail --type unresolvable` → автоматично тригерить `repair` на батьківському вузлі\n\n**Ескалаційний ланцюг:**\n```\nvузол fail → repair (600s) → unresolvable\n  → батько repair (600s) → unresolvable\n    → ... → root unresolvable\n      → SeniorEngineer notification (senior_report.md у root)\n```\n\n**Таймаут інженера:** wrapper автоматично дописує в `repair_history.md` останній запис `**Result:** timeout` і викликає ескалацію.\n\n---\n\n## Відкриті питання\n\n**Критичні (рівень 1):**"}
[user]
[tool_result] /Users/vitaliytv/www/nitra/cursor/docs/думка.MD has been updated successfully. (file state is current in your context — no need to Read it back)
[assistant]
Всі 10 кроків пропрацьовані. Підсумок:

| # | Крок | Статус |
|---|---|---|
| 1 | Схеми файлів | ✅ |
| 2 | Синтаксис посилань | ✅ |
| 3 | Naming convention | ✅ |
| 4 | CLI контракт | ✅ |
| 5 | Wrapper-скрипт | ✅ |
| 6 | Ліміти ресурсів | ✅ |
| 7 | Bootstrap протокол | ✅ |
| 8 | Observability контракт | ✅ |
| 9 | Відновлення після збою | ✅ |
| 10 | Протокол інженера | ✅ |

`думка.MD` тепер повний контракт для реалізації. Що далі — починаємо писати CLI?
[user]
[react:👍]
скажи що задокументовано
[assistant]

---

Ось що зафіксовано в `docs/думка.MD`:

**Архітектура:**
- Recursive Compound DAG — вузли атомарні або складені, рекурсивно
- Файлова система як state store — стан вузла визначається наявністю файлів
- Append-only інваріант — файли тільки створюються, не змінюються (після ворктрі)
- Динамічний spawn — агент сам вирішує чи розкладатись на підграф
- Topology в `task.md` кожного вузла через `deps:`, не в центральному файлі
- Ворктрі = межа атомарності виконання

**Контракт файлів:**
- `task.md` — місія + вхідні дані (refs, не копії)
- `outputs.md` — результати, наявність = resolved
- `error.md` — помилка, наявність = failed
- `repair_context.md` — часовий бюджет (600s дефолт, 3600s max)
- `repair_history.md` — append-only лог спроб інженера
- `ops/spawn-plan/fact`, `ops/kill-plan/fact`, `patches/patch-plan/fact` — план → факт для кожної операції

**Правила контракту:**
- `created_at` — перше поле у всіх файлах
- Назви файлів і директорій — англійська
- Заголовки секцій що парсяться скриптом — англійська; довільний вміст — будь-яка мова
- `id` вузла = назва директорії (без поля у фронтматері)

**CLI:** 8 команд — `init`, `start`, `spawn`, `done`, `fail`, `kill`, `repair`, `status`

**Wrapper-скрипт:** context = task.md + parent task.md + deps outputs.md + repair_history.md; timeout = budget_sec

**Ліміти:** 3 паралельних ворктрі, глибина 10, файл 1MB

**Протоколи:** bootstrap, відновлення після збою (від листів, idempotent), агент-інженер, ескалаційний ланцюг до SeniorEngineer

---

**TRANSCRIPT END**

---

## ADR Динамічний Self-Modifying Task Graph на файловій системі

## Context and Problem Statement

Потрібна архітектура виконання задач агентами, яка підтримує рекурсивне розкладання, паралельне виконання у git-worktree, самовідновлення через агента-інженера й повну відтворюваність стану зі сканування файлової системи.

## Considered Options

* Recursive Compound DAG з файловою системою як state store (append-only, worktree-ізоляція)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Recursive Compound DAG з файловою системою як state store", because стан вузла визначається лише наявністю файлів (`outputs.md` = resolved, `error.md` = failed), що дає безкоштовну персистентність, атомарність через ворктрі та природній аудит-трейл через git-історію.

### Consequences

* Good, because transcript фіксує очікувану користь: merge ворктрі як єдина точка рішення усуває гонки запису; append-only інваріант робить `git merge` завжди чистим між паралельними вузлами; repair_history.md дає LLM повний контекст попередніх спроб в одному документі.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- `docs/думка.MD` — повний контракт (схеми файлів, CLI, протоколи)
- Файлова структура: `tasks/<node-id>/{task.md, outputs.md, error.md, repair_context.md, repair_history.md, ops/, patches/, subgraph/}`
- CLI: `n-cursor graph {init,start,spawn,done,fail,kill,repair,status}`
- Append-only інваріант діє з моменту `git worktree add`; до цього файли вільно редагуються
- Ліміти: 3 паралельних ворктрі, глибина 10, 1 MB/файл, budget_sec max 3600

---

## ADR Topology у `task.md` кожного вузла (без центрального файлу графу)

## Context and Problem Statement

При динамічному spawn агент-батько породжує дочірні вузли і має зберігати топологію підграфу так, щоб оркестратор міг відновити повний граф і динамічно додані вузли підхоплювались без оновлення центрального файлу.

## Considered Options

* Центральний файл `graph.md` у батьківському вузлі зі списком вузлів і ребер
* Топологія розподілена — кожен дочірній у своєму `task.md` знає своїх попередників (`deps:`)

## Decision Outcome

Chosen option: "Топологія розподілена — кожен дочірній у своєму `task.md` знає своїх попередників (`deps:`)", because це забезпечує universальність: динамічний spawn = просто новий дочірній з `task.md`, жодного центрального файлу оновлювати не потрібно; оркестратор відновлює повний граф скануванням усіх `task.md`.

### Consequences

* Good, because transcript фіксує очікувану користь: динамічний spawn не вимагає оновлення спільного файлу → паралельні ворктрі не конфліктують; оркестратор підхоплює нові вузли при наступному скануванні.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Поле `deps: [node-id, ...]` у фронтматері `task.md`; deps завжди siblings у межах того ж `subgraph/`
- Скрипт резолвить шляхи як `../<dep-id>/` відносно поточного вузла
- `port` у deps прибрано — конкретне посилання на секцію виноситься в `## Inputs` через `ref:`

---

## ADR Один файл `task.md` замість окремих `task.md` + `inputs.md`

## Context and Problem Statement

Агент при старті потребує одночасно місію вузла і посилання на вхідні дані. Розглядалось чи зберігати їх в одному файлі або в двох окремих.

## Considered Options

* Два файли: `task.md` (місія) + `inputs.md` (вхідні дані)
* Один файл `task.md` з секцією `## Inputs`

## Decision Outcome

Chosen option: "Один файл `task.md` з секцією `## Inputs`", because агент читає один файл замість двох; місія і дані завжди разом — контекст цілісний; при зміні inputs інженер створює patch, що відповідає наявному протоколу plan→fact.

### Consequences

* Good, because transcript фіксує очікувану користь: менше файлів при spawn, простіший контекст для LLM.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- `task.md` містить обов'язкові секції `## Task`, `## Done when`, `## Inputs`
- Секції `## Inputs` містять `ref: path/to/file.md#section` або `ref: path lines N-M`
- Зміна inputs після старту ворктрі = patch (`patches/patch-plan-<ts>.md` / `patch-fact-<ts>.md`)

---

## ADR Append-only інваріант і ворктрі як межа атомарності

## Context and Problem Statement

Потрібна гарантія атомарності запису і відсутності гонок між паралельними агентами, що записують у різні вузли.

## Considered Options

* Файли тільки створюються, ніколи не змінюються (append-only) + ворктрі як межа
* Mutable файли з механізмами блокування

## Decision Outcome

Chosen option: "Append-only + ворктрі як межа атомарності", because `git merge` між паралельними ворктрі завжди чистий, якщо кожен вузол пише лише в свою директорію; ворктрі-merge є єдиною точкою рішення оркестратора — до merge стан ізольований.

### Consequences

* Good, because transcript фіксує очікувану користь: гонки запису між агентами архітектурно виключені; повна аудит-трейл через git-историю.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Інваріант діє з моменту `git worktree add`; до цього файли вузла вільно редагуються або видаляються
- Стан вузла визначається наявністю файлів: `outputs.md` → resolved, `error.md` → failed, worktree існує → running
- Формат `<ts>` у назвах файлів операцій: `YYYYMMDD-HHMMSS`

---

## ADR Часовий бюджет (budget_sec) замість лічильника спроб

## Context and Problem Statement

Потрібен механізм convergence guard для агента-інженера, щоб запобігти нескінченним циклам ремонту.

## Considered Options

* Ліміт кількості спроб (`max_attempts: N`)
* Часовий бюджет (`budget_sec`) з необмеженою кількістю спроб у межах часу

## Decision Outcome

Chosen option: "Часовий бюджет (`budget_sec`)", because реалістичне обмеження; інженер може адаптувати стратегію — складна спроба при великому залишку часу, швидкий fix при малому; кожен рівень ескалації отримує свіжий budget.

### Consequences

* Good, because transcript фіксує очікувану користь: максимальний час до SeniorEngineer передбачуваний = `depth × budget_sec`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- `repair_context.md` містить `budget_sec` і `deadline` (ISO 8601)
- Дефолт: 600s; максимум: 3600s
- Wrapper-скрипт відповідає за kill процесу по дедлайну і автоматичну ескалацію

---

## ADR Plan → Action → Fact як universal write-ahead log

## Context and Problem Statement

Після збою системи потрібно визначити які операції завершились, а які ні, і коректно відновити виконання.

## Considered Options

* Universal write-ahead log через пари `*-plan.md` / `*-fact.md` для кожної операції
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Universal write-ahead log через пари `*-plan.md` / `*-fact.md`", because наявність plan без fact однозначно ідентифікує незавершену операцію; операції idempotent — відновлення повторює лише відсутні кроки; patch-fact підтримує `result: partial` з `completed_changes` для гранулярного відновлення.

### Consequences

* Good, because transcript фіксує очікувану користь: відновлення після збою детерміноване — сканування `tasks/**/ops/*-plan-*.md` без відповідного `*-fact-*.md` дає повний список незавершених операцій.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Порядок відновлення: від листів вгору (від найглибших вузлів)
- `patch-fact.md` поля: `result: success | failure | partial`; `completed_changes: [...]` при partial
- Команди CLI: `n-cursor graph {spawn,kill,patch}` автоматично пишуть plan і fact
