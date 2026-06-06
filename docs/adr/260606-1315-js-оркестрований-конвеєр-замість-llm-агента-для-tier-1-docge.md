---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T13:15:25+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

## ADR JS-оркестрований конвеєр замість LLM-агента для Tier 1 docgen

## Context and Problem Statement
Скіл `n-docgen` використовував Claude-агента як ведучого циклу генерації документації. Для Tier 1 (локальний Ollama, 8GB M2) ця архітектура приводила до галюцинацій, витоку сигнатур і нестабільної структури, бо локальна модель (gemma3:4b, ~85% якості в one-shot) одночасно керувала і структурою, і фактами, і прозою.

## Considered Options
* JS-скрипт як orchestrator, LLM — лише сервіс перефразування
* LLM-агент як і раніше, але з кращим system prompt
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "JS-скрипт як orchestrator, LLM — лише сервіс перефразування", because користувач сформулював: «точкою входу буде js який підготує вже точкові завдання до локальної моделі а потім збере все докупи» — це лягає на принцип зі `scripts.mdc` («максимум логіки в CLI-екстрактор, 0 токенів»).

### Consequences
* Good, because transcript фіксує очікувану користь: JS vol оdає фактами й структурою (імена, порядок секцій, лінт), модель отримує лише вузьку задачу перефразування → менше галюцинацій.
* Bad, because складніша кодова база (3 модулі замість 1 промпта): `docgen-extract.mjs`, `docgen-prompts.mjs`, `docgen-gen.mjs`. Transcript фіксує цей trade-off як свідомий вибір.

## More Information
Файли у гілці `feat/docgen-orchestrator-pi`, worktree `.worktrees/feat-docgen-orchestrator-pi/npm/skills/docgen/js/`. Стадії: Stage 0 (`docgen-extract.mjs`, 0 токенів) → Stage 1 (`docgen-prompts.mjs`, секційні промпти) → Stage 2 (`stripSignatures`, 0 токенів) → Stage 3 (фіксована зборка `assemble()`).

---

## ADR Секційно-мінімальний контекст (v2): код лише у секцію `Поведінка`

## Context and Problem Statement
v1 оркестрованого конвеєра надсилав повний код файлу у КОЖНУ секційну задачу (Огляд / API / Гарантії / Поведінка). Бенч показав, що це дає 2–5× уповільнення проти one-shot: кожен секційний виклик повторно інгестує повний код, а ollama не перевикористовує KV-cache між stateless `/api/chat` запитами на 8 GB RAM надійно.

## Considered Options
* Код лише у `Поведінку`, решта секцій отримують тільки факт-лист (v2)
* Спільна persistent session з кодом у system (v1)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Код лише у `Поведінку`, решта секцій отримують тільки факт-лист (v2)", because `Огляд` потребує тільки header-коментар, `API` — список export-ів, `Гарантії` — markers (крихітні); код потрібен лише для `Поведінки`. Це нейтралізує проблему інгесту незалежно від KV-cache поведінки.

### Consequences
* Good, because transcript фіксує: overlay-paths 310с → 77с (×4), k8s-tree 141с → 55с (швидше за one-shot), якість лишається ~86% +6 п.п. над g3 one-shot.
* Bad, because transcript фіксує: `gemma4:4b` повертає порожній рядок для секцій без коду в контексті (`""`) — секційно-мінімальний підхід **несумісний з Gemma 3n E4B архітектурою**. Для g4 застосовний лише one-shot.

## More Information
Функція `sectionMessages()` у `docgen-prompts.mjs`. Діагностика gemma4 — виклики `/api/chat` з `system+facts+user`-інструкцією повертали `""` незалежно від варіанту (split roles і merged single user message). Для g4 обходу не знайдено.

---

## ADR Негативні маркери у fact-list для запобігання галюцинації кешу

## Context and Problem Statement
Після впровадження секційно-мінімального контексту секція `Гарантії поведінки` при роботі без коду у контексті патерн-матчила «гарантії → кеш» і вигадувала кешування для файлів, де воно фактично відсутнє (`firebase_hosting.mjs`, `overlay-paths.mjs`).

## Considered Options
* Явно передавати у fact-list негативний стан: «Кешування: НЕМАЄ — не згадуй кеш у гарантіях»
* Не згадувати кеш взагалі і сподіватися, що модель не додасть його
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Явно передавати у fact-list негативний стан", because модель ігнорує відсутність позитивного факту, але реагує на явну заборону. Ту саму логіку застосовано до мережевих викликів (`Робота з мережею: немає`).

### Consequences
* Good, because transcript фіксує: cache-галюцинація зникла у фінальному бенчі для firebase і overlay (де кешу справді немає) при збереженні коректного опису кешу для k8s-tree (де він є).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізовано у `factsSummary()` в `docgen-prompts.mjs`: `m.caches ? 'Кешування: так, у межах прогону' : 'Кешування: НЕМАЄ — не згадуй кеш у гарантіях'`. Аналогічно для `m.network`.

---

## ADR gemma3:4b orchestrated як рекомендована модель для Tier 1 docgen

## Context and Problem Statement
Потрібно обрати локальну модель для Tier 1 docgen (8GB Apple M2) між `gemma3:4b` (3.3 GB, 100% GPU, ~14-20 tok/s) і `gemma4:4b` (5.3 GB, 56%/44% CPU/GPU split, ~11 tok/s), і режим запуску (one-shot vs orchestrated). Критерії: якість, час, придатність до оркестрації.

## Considered Options
* `gemma3:4b` в orchestrated режимі
* `gemma4:4b` в one-shot режимі
* `gemma3:4b` в one-shot режимі
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`gemma3:4b` в orchestrated режимі", because фінальний бенч (3 файли × 3 конфігурації) показав: g3 orchestrated — 92% якості / ~52с avg; g3 one-shot — 47% / ~53с; g4 one-shot — 75% / ~162с. Orchestration підняла g3 з 47% до 92% без часового штрафу, g4 виявилась несумісною з orchestrated (повертає `""`) і у 3× повільнішою за g3.

### Consequences
* Good, because transcript фіксує: g3 orchestrated повністю в GPU (3.3 GB), той самий час що й g3 one-shot, якість вища за g4 one-shot. Детермінований Stage-2 (`stripSignatures`) забезпечує чистоту сигнатур для обох моделей безкоштовно.
* Bad, because transcript фіксує: k8s-tree (файл із двома публічними функціями і внутрішнім кешем) — найскладніший кейс; g3 one-shot впав до 17% на ньому, що підтверджує жорстку залежність від оркестрації для багатофункційних файлів.

## More Information
Бенчмарк-скрипти у `~/docgen-bench3/bench_final.mjs`; виходи у `~/docgen-bench3/final/`. 9 файлів: g3_ORCH, g3_ONE, g4_ONE × 3 abie-файли (`firebase_hosting.mjs`, `overlay-paths.mjs`, `k8s-tree.mjs`). Commit `17cfca32` (Stage 1) та наступний (Stage 2 + негативні маркери) у гілці `feat/docgen-orchestrator-pi`.
