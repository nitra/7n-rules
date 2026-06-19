---
session: 92b92f8f-d999-4638-807d-e743dbb88c8b
captured: 2026-06-19T13:40:27+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/92b92f8f-d999-4638-807d-e743dbb88c8b.jsonl
---

Запушено.

## Результат

**Три нові коміти на `origin/main`:**

1. `📝 docs` — регенеровані 4 доки з verification-прогону (не змінюють поведінки)
2. `✨ feat(npm): lint fail-fast лише для --read-only + знахідки escalation-аналітики`

### Що зроблено:

**`applyChanges` → `mkdirSync` (llm-fix-apply.mjs):**
LLM міг запропонувати файл у неіснуючій теці (наприклад, `.changes/`) → `ENOENT`. Тепер `mkdirSync(dir, { recursive: true })` перед `writeFileSync`.

**T0-патерн `changelog-create-change-file` (t0.mjs):**
Повністю детермінований фікс без LLM: парсить `❌ <ws>: є релевантні зміни, але немає change-файлу` → `writeChange({ bump: 'patch', section: 'Changed', ws, cwd })` для кожного workspace. Кличеться до драбини ескалації — LLM взагалі не залучається.

**Fail-fast лише для `--read-only` (orchestrate.mjs):**
Раніше будь-який ненульовий per-file код зупиняв весь `lint --full`. Тепер у fix-режимі прогін **завжди доходить до конформність-фази** (і хуку аналітики) — зупинка лише після всіх кроків.

### Перевірено:
- 61 тест / 7 test-файлів — усі ✅
- oxlint + eslint чисто; doc-crc звірено; `lint changelog` exit 0

---
_Транскрипт занадто довгий — відповідь зупинена після TRANSCRIPT FOLLOWS_

## ADR fail-fast lint — лише для --read-only

## Context and Problem Statement
У `n-cursor lint --full` оркестратор (`npm/rules/lint/js/orchestrate.mjs`) завершував увесь прогін при першому per-file правилі з ненульовим кодом. Через це у fix-режимі конформність-фаза з LLM-драбиною ескалації та хук аналітики (`maybeAnalyzeEscalation`) ніколи не виконувались, якщо будь-яке раннє правило (наприклад, `js-lint`) поверталося з помилкою.

## Considered Options
* Fail-fast лише в `--read-only` (CI/детект); у fix-режимі продовжувати до кроку виправлення
* Зберегти fail-fast у всіх режимах (передіснуючий підхід)

## Decision Outcome
Chosen option: "Fail-fast лише в `--read-only`", because у fix-режимі зупинка на першому правилі блокує конформність-фазу й хук аналітики, позбавляючи їх можливості виправити помилки — що суперечить призначенню fix-режиму.

### Consequences
* Good, because у fix-режимі `lint --full` тепер завжди доходить до конформність-фази (LLM-драбина ескалації) та хуку `maybeAnalyzeEscalation`, навіть якщо ранні per-file правила повернули помилки.
* Bad, because у fix-режимі exit code може бути 0 (усі помилки виправлено далі), попри те, що деякі per-file правила повернули ненульовий код — поведінка менш передбачувана для зовнішніх скриптів.

## More Information
Змінений файл: `npm/rules/lint/js/orchestrate.mjs`. Прапор: `readOnly` (CLI: `--read-only`). Коміт: `fac8f5b2`.

---

## ADR T0-патерн для changelog: детермінований фікс без LLM

## Context and Problem Statement
Правило `changelog` у конформності генерувало violation «є релевантні зміни, але немає change-файлу», після чого `orchestrator.mjs` звертався до LLM-драбини ескалації. Проте цей violation повністю детермінований — відомо workspace, відомо що зробити (`writeChange`). Звертання до LLM з наступною ескалацією до cloud-avg витрачало токени й час без будь-якої потреби в інтелекті моделі.

## Considered Options
* T0-патерн у `t0.mjs`, що парсить violation та викликає `writeChange` без LLM
* Залишити LLM-драбину (передіснуючий підхід)

## Decision Outcome
Chosen option: "T0-патерн у `t0.mjs`", because changelog-violation є повністю детермінованим: регекс `❌ <ws>: є релевантні зміни` однозначно визначає workspace → `writeChange({ bump: 'patch', section: 'Changed', ws, cwd })` закриває violation без LLM.

### Consequences
* Good, because transcript фіксує очікувану користь: changelog-violation більше не ескалює до cloud-avg, усувається звернення до моделі повністю.
* Bad, because T0-патерн фіксує `bump: 'patch'` і `section: 'Changed'` — реальний семвер-тип і секція зміни відомі лише людині; якщо потрібен `minor` або `Added`, change-файл доведеться редагувати вручну.

## More Information
Змінені файли: `npm/scripts/lib/fix/t0.mjs`, `npm/scripts/lib/fix/tests/t0.test.mjs`. `writeChange` імпортовано з `npm/rules/release/change.mjs`. Новий патерн: `MISSING_CHANGE_FILE` із `MISSING_CHANGE_MATCH_ALL_RE = /❌\s+(\S+): є релевантні зміни, але немає change-файлу/g`. Коміт: `fac8f5b2`.

---

## ADR mkdirSync у applyChanges перед writeFileSync

## Context and Problem Statement
`applyChanges` у `npm/scripts/lib/fix/llm-fix-apply.mjs` викликав `writeFileSync(path, content)` напряму. Якщо LLM пропонував файл у неіснуючій теці (наприклад, `.changes/260619-HHMM.md`), операція завершувалась `ENOENT`. Саме цей баг виявила аналітика escalation-логу (поле `diagnosis` cloud-рунгів: «попередня спроба не змогла записати файл у неіснуючий шлях»).

## Considered Options
* `mkdirSync(dir, { recursive: true })` перед `writeFileSync`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`mkdirSync` перед `writeFileSync`", because це мінімальна зміна, що усуває `ENOENT` при запису будь-якого файлу у неіснуючу теку — незалежно від того, що пропонує LLM.

### Consequences
* Good, because transcript фіксує очікувану користь: `applyChanges` більше не падає при записі файлів у відсутні теки; changelog-violation тепер виправляється з першого рунга (T0-патерн).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінений файл: `npm/scripts/lib/fix/llm-fix-apply.mjs`. Додано `import { mkdirSync } from 'node:fs'` і `mkdirSync(dirname(absPath), { recursive: true })` перед `writeFileSync`. Коміт: `fac8f5b2`.
