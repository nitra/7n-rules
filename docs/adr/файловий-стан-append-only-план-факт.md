---
type: ADR
title: "Файловий стан, append-only інваріант і принцип план → дія → факт"
---

# Файловий стан, append-only інваріант і принцип план → дія → факт

**Status:** Accepted
**Date:** 2026-06-06

## Context and Problem Statement

Система виконує задачі через LLM-агентів у розподіленому середовищі де агенти можуть падати або зависати в будь-який момент. Потрібен механізм зберігання стану який (1) є LLM-friendly, (2) гарантує відновлення після збою, (3) не вимагає транзакційної бази даних.

## Considered Options

* Файли як state store із append-only інваріантом і принципом план/факт
* Централізована база даних (PostgreSQL, SQLite) — потребує окремого сервісу, складне відновлення
* JSON-файли що змінюються — простіше але race condition при паралельних записах і немає аудиту

## Decision Outcome

Chosen option: "Файли як state store із append-only інваріантом і принципом план/факт", because файлова система дає безкоштовну персистентність і git-аудит, а append-only усуває race condition при паралельному виконанні у ворктрі.

### Consequences

* Good, because стан вузла визначається наявністю файлів, а не полем у базі — немає single point of failure.
* Good, because `*-план.md` + `*-факт.md` дозволяє відновити будь-яку незавершену операцію після збою scan-ом директорій.
* Good, because Markdown+YAML є природним форматом для LLM — агент читає `repair/*.md` і продовжує журнал без парсингу.
* Good, because git history = безкоштовний time-travel debugging всього графу.
* Bad, because scan для відновлення стану — без індексу при великих графах дорого.

## More Information

Append-only інваріант: файли тільки створюються, ніколи не змінюються. Нова версія = новий файл (`вихідні-2.md`). Sentinel-файли (`invalidated`) визначають стани через наявність. Кожна операція: (1) `*-план.md` → (2) виконання → (3) `*-факт.md`. При відновленні: `scan tasks/**/*-план.md` → якщо відповідний `*-факт.md` відсутній → незавершена операція → відновити. Файли: `task.md`, `вхідні.md`, `вихідні.md`, `помилка.md`, `repair/`, `операції/`, `патчі/`.

## Update 2026-06-06

Transcript уточнив файловий контракт task graph:

- Остаточні англомовні імена файлів: `task.md`, `inputs.md`, `outputs.md`, `error.md`, `repair_history.md`, `repair_context.md`, `ops/`, `patches/`, `subgraph/`.
- YAML-атрибути мають бути англійською у `snake_case`: `created_at`, `parent`, `deps`, `nodes_created`, `kill_order`, `nodes_killed`, `target_node`, `result`.
- `id` вузла не дублюється у frontmatter: він читається з назви директорії.
- Для нових версій результатів і помилок допускався суфікс `-vN`.
- `invalidated` розглядався як sentinel-файл для знедійсненого вузла.
- `patch-plan-<ts>.md` має передувати зміні вузла; залежні worktree перед patch потрібно kill-ити у топологічному порядку.

Це доповнює рішення про append-only файловий стан і plan→fact протокол, а не створює окреме рішення.

## Update 2026-06-06

Transcript уточнив формат файлів state store:

- Основний формат — Markdown + YAML frontmatter, бо frontmatter читається скриптами, а тіло природне для LLM.
- Секції, які парсить orchestrator, мають англійські заголовки; довільні секції можуть бути будь-якою мовою.
- `repair_history.md` ведеться як один append-only документ із секціями `## Attempt N`.
- `repair_context.md` зберігає часовий бюджет і deadline окремо від історії спроб.
- Було прийнято обʼєднати місію й inputs в один `task.md` із секцією `## Inputs`; окремий `inputs.md` не потрібен.

Це деталізація файлового append-only рішення.

## Update 2026-06-06

Transcript завершив передреалізаційний контракт для файлового task graph:

- `task.md` є єдиним файлом для місії та входів; `inputs.md` не використовується.
- Зміна inputs після старту — це patch через `patches/patch-plan-<ts>.md` і `patches/patch-fact-<ts>.md`.
- `outputs.md` містить довільні секції-порти; наявність файлу означає `resolved`.
- `error.md` означає `failed` і має тип `execution-error | timeout | unresolvable`.
- `repair_context.md` містить `budget_sec` і `deadline`; `repair_history.md` є append-only журналом `## Attempt N`.
- Timestamp у назвах операційних файлів має формат `YYYYMMDD-HHMMSS`.
- CLI контракт включає `n-cursor graph init|start|spawn|done|fail|kill|repair|status`.
- Wrapper генерує system prompt динамічно, передає `task.md`, `parent/task.md`, outputs залежностей і `repair_history.md`, а timeout за замовчуванням становить 600 секунд.
- Ресурсні ліміти: 3 паралельних worktree, глибина графу 10, розмір файлу 1 MB, `budget_sec` max 3600.
- `status` має terminal і `--json` вивід з прогресом і elapsed time.
- Відновлення після збою виконується від листів вгору; `patch-fact` підтримує `result: partial` і `completed_changes`.
- `fail --type unresolvable` автоматично тригерить `repair` на батьківському вузлі; EngineerAgent — той самий Claude з іншим system prompt.

Це підсумкове уточнення append-only/plan→fact рішення і контракту реалізації.
