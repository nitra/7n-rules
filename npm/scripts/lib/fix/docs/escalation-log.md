---
type: JS Module
title: escalation-log.mjs
resource: npm/scripts/lib/fix/escalation-log.mjs
docgen:
  crc: 07ae959f
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
---

Append-only JSONL-лог драбини ескалації конформність-фіксу. Один запис на рунг драбини: модель, чи виклик удався, чи правило стало зеленим після рунга («чи допомогло»), залишковий violation і само-аналіз моделі (`diagnosis`). Доповнює always-on wire-trace — той знає вміст викликів, але не результат re-check; join — за полем `caller` (`fix:<rule>:<rung>`).

## Поведінка

`escalationLogPath` резолвить шлях: `N_CURSOR_FIX_ESCALATION_LOG` як kill-switch (`0|false|off|no` → лог вимкнено, повертає `null`) або як явний шлях; інакше дефолт `<cwd>/.n-cursor/fix-escalation.jsonl`.

`logEscalation` дописує один JSONL-рядок (no-op, якщо лог вимкнено). Поля `remainingViolation` і `diagnosis` обрізаються до межі; `recheckOk` обнуляє `remainingViolation`. Помилки запису ковтаються — лог діагностичний і не має валити сам фікс.

## Публічний API

- `escalationLogPath()` — шлях активного логу або `null`, якщо вимкнено.
- `logEscalation(rec)` — дописує запис рунга у JSONL.

## Гарантії поведінки

- Не звертається до мережі.
- Перехоплює помилки запису і не пропускає винятків назовні (fail-safe).
