---
session: 92b92f8f-d999-4638-807d-e743dbb88c8b
captured: 2026-06-19T08:20:42+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/92b92f8f-d999-4638-807d-e743dbb88c8b.jsonl
---

## ADR Злиття скіла `/n-fix` і підкоманди `fix` у єдиний `lint --full`

## Context and Problem Statement
У проєкті `@nitra/cursor` існували дві окремі команди: `/n-fix` (`n-cursor fix`) для конформності структури та `/n-lint` (`bun run lint`) для лінтерів коду. Їх потрібно було запускати послідовно, а модель викликала скіл вручну. Постало питання об'єднати обидві функції в один прохід.

## Considered Options
* Зберегти `/n-fix` і `/n-lint` як окремі команди
* Видалити `fix` і поглинути його конформність-движок у `lint --full`

## Decision Outcome
Chosen option: "Видалити `fix` і поглинути його конформність-движок у `lint --full`", because два коміти (`185cbeab`, `6f49a0c8`) підтверджують явне рішення: движок конформності (convergence-loop check → T0 → LLM) перенесено в `npm/scripts/lib/fix/orchestrator.mjs` і тепер викликається як конформність-фаза всередині `lint --full`.

### Consequences
* Good, because `lint --full` робить обидві половини за один прохід — лінтер-фаза (ESLint/oxlint/jscpd/…) + конформність-фаза (T0-auto + LLM convergence до 3 ітерацій), що раніше вимагало двох окремих команд.
* Good, because transcript фіксує очікувану користь: LLM-конформність збережена — `llm-worker.mjs` (`npm/scripts/lib/fix/llm-worker.mjs`) викликає `resolveModel(tier)` з `npm/lib/models.mjs`, тому вибір моделі (min/avg/max, локальна чи хмарна) залишився через змінні середовища (`N_LOCAL_MIN_MODEL`, `N_CLOUD_MIN_MODEL` тощо), а не зник.
* Bad, because дефолтний `npx @nitra/cursor lint` (без `--full`) конформність-фазу **не запускає** — LLM-перевірка правил `.cursor/rules/` активується лише через явний `--full`, і ця зміна поведінки не є очевидною з назви команди.

## More Information
- Коміт видалення скіла: `6f49a0c8` — `npm/skills/fix/SKILL.md` позначено DEPRECATED і видалено.
- Коміт переносу движка: `185cbeab` — `fix`/`check` видалені як підкоманди, движок конформності переїхав у `npm/scripts/lib/fix/`.
- Файли реалізації: `npm/scripts/lib/fix/orchestrator.mjs`, `npm/scripts/lib/fix/run-fix-check.mjs`, `npm/scripts/lib/fix/llm-worker.mjs`, `npm/scripts/lib/fix/t0.mjs`.
- Оркестратор `lint`: `npm/rules/lint/js/orchestrate.mjs` — конформність-фаза виконується лише при `full=true` (рядок 133).
- Модель для LLM-фіксу обирає `resolveModel` через env-змінні (`N_LOCAL_MIN_MODEL`, `N_CLOUD_MIN_MODEL`, `N_CLOUD_AVG_MODEL`, `N_CLOUD_MAX_MODEL`); ескалація після 2 провалів підряд (`orchestrator.mjs:54`).
