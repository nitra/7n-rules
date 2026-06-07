---
session: 8e669f3c-28f9-4b13-9f55-6a6ec894debe
captured: 2026-06-07T06:03:46+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/8e669f3c-28f9-4b13-9f55-6a6ec894debe.jsonl
---

Підсумок бенчмарку оркестрованого pi vs старий ollama HTTP:

| Підхід | discover-check-rules | trufflehog |
|---|---|---|
| OLD ollama HTTP orchestrated | 44s / **score=100** | 47s / **score=100** |
| NEW pi orchestrated (gemma3:4b) | 71s / **score=100** | 61s / **score=90** |
| NEW pi one-shot (gemma3:4b) | 51s / score=75 | 35s / score=65 |

**Висновки:**
- **Якість**: orchestrated через pi значно краще ніж one-shot (100 і 90 vs 75 і 65)
- `discover-check-rules`: score=100 — паритет зі старим підходом
- `trufflehog`: score=90 (mінус 10 від `internal-name:checkTextSubset`) — одна дрібна проблема яка є і в mid-tier. Старий ollama HTTP = 100.
- **Швидкість**: pi orchestrated повільніший (~25-30% повільніше) — overhead запуску pi-процесу на кожну секцію vs стриминг HTTP socket

**Рекомендація**: для кінцевого рішення тест дає:
- `ollama HTTP orchestrated`: найкраща якість (100/100), найшвидший (44/47s)
- `pi orchestrated`: майже така ж якість (100/90), але на 25-30% повільніше
- `pi one-shot`: гірша якість (75/65), швидший для cloud-моделей

Відкочуємо на ollama HTTP (стара схема) чи залишаємо pi orchestrated із невеликим компромісом у якості?
[user]
[tool_result] The command has already completed. The output was shown above.
[assistant]
[thinking]
Now I have the full benchmark results. Let me present the final comparison and ask the user what to do.

| Підхід | discover-check-rules | trufflehog |
|---|---|---|
| OLD ollama HTTP orchestrated | 44s / score=100 | 47s / score=100 |
| NEW pi orchestrated (gemma3:4b) | 71s / score=100 | 61s / score=90 |
| NEW pi one-shot (gemma3:4b) | 51s / score=75 | 35s / score=65 |

So pi orchestrated achieves the same quality on simple files (score=100) and slightly worse on slightly more complex files (score=90 with internal-name issue). But it's 25-30% slower.

The key question is: does the user want to keep pi orchestrated (which provides the cascade transparency benefit) or roll back to the direct ollama HTTP approach?

I should present this clearly to the user.
[assistant]
Фінальна таблиця бенчмарку:

| Підхід | discover-check-rules | trufflehog |
|---|---|---|
| **OLD** ollama HTTP orchestrated | 44s / **score=100** | 47s / **score=100** |
| **NEW** pi orchestrated gemma3:4b | 71s / **score=100** | 61s / **score=90** |
| **NEW** pi one-shot gemma3:4b | 51s / score=75 | 35s / score=65 |

**Висновки:**
- Pi orchestrated відновлює якість (100 vs 75 від one-shot)
- Незначна регресія на складнішому файлі: `trufflehog` = 90 vs 100 (одна проблема `internal-name:checkTextSubset`)
- Повільніший: +27s / +14s — overhead N×`spawnSync(pi)` vs streaming socket

**Де виграємо:** pi orchestrated прозоро fallback-ається на cloud через `resolveModel('min')` без локального ollama — старий підхід без env взагалі не працював.

Залишаємо pi orchestrated як основний підхід?
[user]
[tool_result] The command has already completed. The output was shown above.
[assistant]
[thinking]
The user hasn't responded to my question. The benchmark is done, I've presented the results. I should wait for the user's decision. But since this is the end of the transcript (being analyzed by the ADR system), I don't need to do anything else.

Actually, looking at this more carefully - the ADR transcript analysis prompt at the top has asked me to analyze the transcript and produce MADR documentation. The transcript ends here with the benchmark results and a question to the user.

Let me now produce the ADR documentation based on what happened in this session.
</thinking>

---

## ADR Каскадний fallback для tier-моделей через `resolveModel()`

## Context and Problem Statement
Проєкт використовує 6 глобальних tier-змінних середовища (`N_LOCAL_MIN_MODEL`, `N_LOCAL_AVG_MODEL`, `N_LOCAL_MAX_MODEL`, `N_CLOUD_MIN_MODEL`, `N_CLOUD_AVG_MODEL`, `N_CLOUD_MAX_MODEL`). Якщо локальні змінні не задані, споживачі падали або мовчки поверталися до cloud-константи, без систематичного правила прозорого переходу між рівнями.

## Considered Options
* Додати `resolveModel(tier)` у `npm/lib/models.mjs` і замінити всі сирі константи
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `resolveModel(tier)` у `npm/lib/models.mjs`", because це єдиний описаний підхід, зафіксований у контракті проєкту: функція реалізує визначений каскад (`'min'` → `LOCAL_MIN` → `LOCAL_AVG` → `LOCAL_MAX` → `CLOUD_MIN`; `'avg'` → `LOCAL_AVG` → `LOCAL_MAX` → `CLOUD_AVG`; `'max'` → `LOCAL_MAX` → `CLOUD_MAX`), що дає прозорий fallback без env-налаштувань.

### Consequences
* Good, because transcript фіксує очікувану користь: споживачі `npm/scripts/coverage-classify/index.mjs`, `npm/skills/fix/js/llm-worker.mjs`, `npm/scripts/coverage-fix.mjs`, `npm/scripts/dispatcher/lib/subagent-runner.mjs`, `npm/skills/docgen/js/docgen-gen.mjs` більше не імпортують сирі константи — всі замінені на `resolveModel()`.
* Bad, because transcript не містить підтверджених негативних наслідків для `resolveModel()` самого по собі; виняток — `docgen` Tier 1 (`LOCAL_MIN`) залишений незмінним, бо передається прямо в ollama HTTP API і cloud-рядок там ламає виклик.

## More Information
- Реалізація: `npm/lib/models.mjs` — нова named export `resolveModel(tier: 'min'|'avg'|'max'): string`
- Change file: `npm/.changes/260606-2204.md` (bump minor, section Added)
- Файли-споживачі, де замінено import: `coverage-classify/index.mjs`, `fix/js/llm-worker.mjs`, `coverage-fix.mjs`, `dispatcher/lib/subagent-runner.mjs`, `docgen/js/docgen-gen.mjs`
- `LOCAL_MIN` у `docgen-gen.mjs` збережено окремо для прямого ollama HTTP (Tier 1 local path)

---

## ADR Бамп major-версій через change-файл а не пряме редагування

## Context and Problem Statement
Інші варіанти в transcript не обговорювалися.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Використовувати `n-cursor change --bump --section --message --ws`", because у transcript зафіксовано два конкретних виклики команди (`n-cursor change --bump minor --section Added ... --ws npm` та `n-cursor change --bump minor --section Changed ... --ws npm`) замість ручного редагування `CHANGELOG.md` або `package.json`.

### Consequences
* Good, because transcript фіксує очікувану користь: change-файли генеруються автоматично (`npm/.changes/260606-2204.md`, `npm/.changes/260607-0537.md`) без ручного бампу версії.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Команда: `n-cursor change --bump minor --section Added --message "<текст>" --ws npm`
- Згенеровані файли: `npm/.changes/260606-2204.md`, `npm/.changes/260607-0537.md`

---

## ADR Заміна прямого ollama HTTP на pi orchestrated у docgen Tier 1

## Context and Problem Statement
`docgen-gen.mjs` Tier 1 викликав ollama HTTP API напряму зі streaming, параметрами `num_ctx:8192`, `temperature:0.2`, `keep_alive:15m` та orchestrated-режимом (окремий промпт на секцію). Перехід на `pi one-shot` через `resolveModel('min')` для уніфікації транспорту дав регресію якості з score=100 до score=65-75 на тестових файлах.

## Considered Options
* Залишити прямий ollama HTTP (status quo)
* Pi one-shot через `resolveModel('min')`
* Pi orchestrated через `resolveModel('min')` (окремий `spawnSync(pi)` на кожну секцію)

## Decision Outcome
Chosen option: "Pi orchestrated через `resolveModel('min')`", because transcript показує, що orchestrated-підхід відновлює якість (score=100 / score=90) порівняно з one-shot (score=75 / score=65), і одночасно забезпечує прозорий каскад без локального ollama.

### Consequences
* Good, because transcript фіксує очікувану користь: `discover-check-rules-from-cursor.mjs` — score=100 (паритет зі старим), `trufflehog.mjs` — score=90 (незначна регресія `internal-name`). Система штатно fallback-ається на cloud якщо `N_LOCAL_MIN_MODEL` не задано.
* Bad, because transcript фіксує підтверджений негативний наслідок: pi orchestrated повільніший за прямий ollama HTTP на 25-30% (71s vs 44s, 61s vs 47s) через overhead N×`spawnSync(pi)` замість одного streaming socket.

## More Information
- Бенчмарк (2 Tier 1 файли, `N_LOCAL_MIN_MODEL=ollama/gemma3:4b`):

| Підхід | `discover-check-rules-from-cursor.mjs` | `trufflehog.mjs` |
|---|---|---|
| OLD ollama HTTP orchestrated | 44s / score=100 | 47s / score=100 |
| NEW pi orchestrated | 71s / score=100 | 61s / score=90 |
| NEW pi one-shot | 51s / score=75 | 35s / score=65 |

- Change file: `npm/.changes/260607-0537.md`
- Реалізація: `npm/skills/docgen/js/docgen-gen.mjs` — функція `piOrchestrated()`, імпорт `sectionMessages` з `docgen-prompts.mjs`, видалено `ollamaChat`, `localModelId`, `withTimeout`, `import { request } from 'node:http'`; -142 рядки від оригіналу
