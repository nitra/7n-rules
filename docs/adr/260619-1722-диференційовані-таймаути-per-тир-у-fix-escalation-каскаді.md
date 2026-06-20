---
session: 91ef735b-1750-4c3d-bac1-6f0627451d63
captured: 2026-06-19T17:22:12+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/91ef735b-1750-4c3d-bac1-6f0627451d63.jsonl
---

Документ вже правильний. Тепер changelog для Фази 2:
[assistant]
[tool: Bash] {"command":"npx @nitra/cursor change --bump patch --section Fixed --message \"fix-каскад: repo-context у промпті для file-less правил (doc-files/adr/npm-module) — коли extractFilePaths не знаходить шляхів, підставляємо git ls-files + маніфести замість '(no files identified)'; export buildPrompt/buildRepoContext для тестів\" 2>&1"}
[user]
[tool_result] ✅ npm/.changes/260619-1736.md
[assistant]
[tool: Bash] {"command":"cd /Users/vitalii/www/nitra/cursor && npx @nitra/cursor fix changelog 2>&1 | tail -5"}
[user]
[tool_result] ✅ fix: 1 правил — все чисто
[assistant]
[tool: Bash] {"command":"cd /Users/vitalii/www/nitra/cursor/npm && bun run vitest run scripts/lib/fix/tests 2>&1 | tail -8"}
[user]
[tool_result]
RUN  v4.1.8 /Users/vitalii/www/nitra/cursor/npm


Test Files  6 passed (6)
Tests  92 passed (92)
Start at  17:37:14
Duration  256ms (transform 307ms, setup 0ms, import 456ms, tests 77ms, environment 0ms)
[assistant]

Фаза 2 завершена.

**Що зроблено:**

| Файл | Зміна |
|---|---|
| `llm-worker.mjs` | `buildRepoContext(projectRoot)` — git ls-files ≤300 рядків + маніфести; вклинюється у `buildPrompt` коли `files.length === 0`; артефакти патчу (дублікат-імпорт, `execSync` у середині файлу, `callModel_legacy`) прибрані |
| `llm-worker.mjs` | `export { buildPrompt, buildRepoContext }` |
| `tests/llm-worker.test.mjs` | 4 нові тести: `buildRepoContext`, `buildPrompt` з/без files/repoContext/feedback |
| `docs/llm-worker.md` | CRC оновлено, опис пп.3–5 |
| `npm/.changes/260619-1736.md` | changelog-запис |

**Ефект у реальному прогоні:**
- Для doc-files, adr, npm-module (де `extractFilePaths` повертає порожньо) хмарна модель тепер бачить дерево репо + `package.json` — замість `(no files identified)`, що викликало дослівну скаргу *«недостатньо контексту репозиторію»*.
- Якщо є конкретні файли у violation — поведінка незмінна.

Фаза 3 (маршрутизація doc-files → `/n-docgen`) — коли будеш готовий до архітектурного обговорення.

---
TRANSCRIPT END

---

## ADR Диференційовані таймаути per-тир у fix-escalation-каскаді

## Context and Problem Statement
Під час `lint --full` cascade для правила `adr` локальна модель `omlx/gemma-4-e4b-it-OptiQ-4bit` щоразу витрачала 120 секунд (`curl exit 28`) перед ескалацією на хмарний тир. Хмарний `cloud-min` після ETIMEDOUT незалежно ескалював на `cloud-avg`, марно витрачаючи avg-бюджет (обмежений 3 кепом).

## Considered Options
* Per-tier `timeoutMs` у `buildLadder` (local ≈ 45 s, cloud = 120 s) + cloud-ETIMEDOUT → `'break'`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Per-tier `timeoutMs` у `buildLadder` + cloud-transport-timeout → `'break'`", because потрібно fail-fast на локалі (4b-модель не встигає за 120 s на важких правилах) і не витрачати avg-слоти на хмарний таймаут, який не вирішується більшою моделлю.

### Consequences
* Good, because transcript фіксує очікувану користь: `local-min` абортить за ~45 s замість 120 s і швидше ескалює; cloud-ETIMEDOUT більше не спалює `cloud-avg`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/scripts/lib/fix/orchestrator.mjs` — `buildLadder` додає поле `timeoutMs`, `decideAfterFailure` ловить `/ETIMEDOUT|timed out|pi error/i` на не-local рунзі → `'break'`, `escalateRule` прокидає `timeoutMs` у worker.
- `npm/scripts/lib/fix/llm-worker.mjs` — `callModel(prompt, model, caller, timeoutMs)` + `runLlmWorker opts.timeoutMs`.
- Env-змінні: `N_LOCAL_FIX_TIMEOUT_MS` (дефолт 45 000), `N_CLOUD_FIX_TIMEOUT_MS` (дефолт 120 000).
- Тест: `npm/scripts/lib/fix/tests/orchestrator.test.mjs` — 2 нові кейси (per-tier timeout у worker, cloud-ETIMEDOUT обриває драбину).
- Changelog: `npm/.changes/260619-1716.md`.

---

## ADR Repo-context у промпті для file-less правил fix-escalation-каскаду

## Context and Problem Statement
Для структурних правил (`doc-files`, `adr`, `npm-module`) функція `extractFilePaths` повертає порожній масив, бо violation описує відсутні файли, а не наявні шляхи. Промпт містив лише `(no files identified)`, і хмарні моделі дослівно скаржились: *«Недостатньо контексту репозиторію»* — та не могли сформувати патч.

## Considered Options
* `buildRepoContext` — підставляти `git ls-files` (≤300 рядків) + маніфести `package.json` у `buildPrompt`, коли `files.length === 0`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`buildRepoContext` — generic fallback з деревом репо та маніфестами", because хмарні моделі самі вказали на брак контексту як причину провалу; дерево + маніфести — мінімальний generic-контекст без per-rule провайдерів.

### Consequences
* Good, because transcript фіксує очікувану користь: хмарна модель отримує достатній контекст репо навіть для структурних правил (adr, doc-files, npm-module).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/scripts/lib/fix/llm-worker.mjs` — `buildRepoContext(projectRoot)`: `execSync('git ls-files')`, фільтр `/node_modules|\.git|\.lock/`, `slice(0, 300)`, + `package.json` / `npm/package.json` (до 2000 символів кожен).
- `buildPrompt` отримує шостий параметр `repoContext`; якщо `files.length === 0` і `repoContext != null` — вставляє `<repo-context>` блок замість `(no files identified)`.
- `export { buildPrompt, buildRepoContext }` — доступно для тестів.
- Тест: `npm/scripts/lib/fix/tests/llm-worker.test.mjs` — 4 нові кейси (buildRepoContext фільтрація, buildPrompt з/без files/repoContext/feedback).
- Changelog: `npm/.changes/260619-1736.md`.
