---
type: JS Module
title: orchestrator.mjs
resource: npm/scripts/lib/fix/orchestrator.mjs
docgen:
  crc: 08d96254
  model: claude-sonnet-4-6
  score: 100
---

Оркеструє повний цикл виправлення порушень конформності: детермінований T0-фікс без LLM → LLM-драбина ескалації (local-min → local-min-retry → cloud-min → cloud-avg) → фінальна перевірка. Кожне провальне правило проходить через тири послідовно до першого зеленого re-check або до обриву (no-key, systemic-помилка, cloud transport fail, вичерпаний avg-кеп).

## Поведінка

### `buildLadder`

Будує масив рунгів ескалації з чотирьох тирів:

| Тир               | Модель      | Feedback | Timeout                   |
| ----------------- | ----------- | -------- | ------------------------- |
| `local-min`       | `LOCAL_MIN` | ні       | `LOCAL_TIMEOUT_MS` (45s)  |
| `local-min-retry` | `LOCAL_MIN` | так      | `LOCAL_TIMEOUT_MS`        |
| `cloud-min`       | `CLOUD_MIN` | так      | `CLOUD_TIMEOUT_MS` (120s) |
| `cloud-avg`       | `CLOUD_AVG` | так      | `CLOUD_TIMEOUT_MS`        |

Рунги з порожньою моделлю (`''`) відфільтровуються — драбина стискається до доступних тирів.

### `escalateRule`

Проводить одне правило через драбину до першого зеленого re-check. На кожному рунзі:

1. Виклик `worker.runLlmWorker` (синхронно) з feedback від попереднього рунга.
2. Re-check через `check([ruleId], cwd)`.
3. Запис у escalation-лог (`logEscalation`).
4. Якщо re-check зелений → `{ resolved: true }`.
5. Якщо ні → `decideAfterFailure` визначає дію: `break` (no-key або cloud transport fail), `skip-model` (systemic omlx-помилка), або продовжити.
6. Avg-рунг пропускається, якщо `avgBudget <= 0` (з фіксацією у лог).

Після кожного рунга виводить verbose-блок (`printVerboseBlock`), якщо `N_CURSOR_FIX_VERBOSE !== 'off'`.

### `parseOrchestratorArgs`

Витягує `--max-avg N` (default: 3) і збирає позиційні аргументи як `ruleFilter`.

### `runOrchestratorCli`

Повний цикл:

1. Початкова conformance-перевірка → якщо чисто, exit 0.
2. `runT0Step` — детермінований фікс без LLM; якщо після нього чисто, exit 0.
3. Для кожного правила, що лишилося — `escalateRule` з відстеженням `avgBudget`.
4. Фінальна перевірка → exit 0 якщо чисто, exit 1 якщо є невирішені.

## Публічний API

- `buildLadder({ localMin, cloudMin, cloudAvg })` — повертає масив рунгів ескалації.
- `escalateRule(rule, cwd, deps)` — проводить одне правило через драбину; `deps` дозволяє ін'єкцію worker/check/clock для тестів; повертає `{ resolved, avgUsed }`.
- `parseOrchestratorArgs(args)` — повертає `{ maxAvg, ruleFilter }`.
- `runOrchestratorCli(args, cwd)` — CLI-точка входу; повертає `Promise<0|1>`.

## Гарантії поведінки

- Мутує файли проєкту лише через `worker.runLlmWorker` (apply-changes) і T0-auto.
- Не кидає винятків назовні: помилки LLM перехоплює worker і повертає як `res.error`.
