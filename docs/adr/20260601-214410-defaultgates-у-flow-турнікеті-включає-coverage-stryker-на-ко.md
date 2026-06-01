---
session: 37e16d83-9fec-4e35-8975-e1f75f254fe3
captured: 2026-06-01T21:44:10+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/37e16d83-9fec-4e35-8975-e1f75f254fe3.jsonl
---

## ADR DEFAULT_GATES у flow-турнікеті включає coverage (Stryker) на кожен verify

## Context and Problem Statement
`flow verify` та кожен крок `flow run --autonomous` проганяють гейти через `runReview`. Список гейтів — хардкодована константа `DEFAULT_GATES` у `npm/scripts/dispatcher/lib/reviewer.mjs:14`. Користувач з'ясовував, які правила/скіли запускають Stryker, щоб мінімізувати кількість його прогонів, і виявив, що coverage-гейт спрацьовує автоматично на кожен `flow verify` без жодного ручного втручання.

## Considered Options
* Залишити `DEFAULT_GATES = [lint, coverage]` (поточний стан)
* Видалити `coverage` з `DEFAULT_GATES` повністю — Stryker лише за явним викликом
* Запускати coverage лише на `release`, передаючи урізаний `gates=[lint]` у `flow verify` та повний набір у `release`-команду
* Конфіг-керовані gates через `.n-cursor.json#flow.gates` (дефолт `['lint']`)

## Decision Outcome
Chosen option: "Залишити `DEFAULT_GATES = [lint, coverage]` (поточний стан)", because рішення про зміну ще не прийнято — transcript завершується на уточнювальному запитанні користувача («чи проганяє всі файли проекту, а не тільки змінені?»); зміна коду не зроблена.

### Consequences
* Good, because transcript фіксує очікувану користь поточного дизайну: кожен `flow verify` автоматично перевіряє мутаційне покриття без явного виклику, регресія помічається одразу.
* Bad, because кожен `flow verify` (у TDD-циклі — після кожного логічного кроку) запускає повний `bunx stryker run` проти всіх файлів проєкту (не тільки змінених); у `flow run --autonomous` це N прогонів Stryker за одну задачу. `/n-coverage-fix` і `/n-fix-tests` можуть додатково запустити до ~4 прогонів кожен.

## More Information
- `DEFAULT_GATES` — `npm/scripts/dispatcher/lib/reviewer.mjs:14`
- `runReview` уже приймає ін'єктований `gates`-параметр, але тільки тести передають кастомний список; `commands.mjs:141` і `active.mjs:44` (`defaultVerify`) кличуть без аргументу
- `flow verify` документований у `npm/scripts/dispatcher/lib/commands.mjs:121-123` і `npm/rules/flow/flow.mdc:81`
- `n-cursor coverage` → `npm/rules/test/coverage/coverage.mjs` → `npm/rules/js-lint/coverage/coverage.mjs` → `bunx stryker run`; серіалізований через `withLock('coverage')`
- Конфіг-керування гейтами через `.n-cursor.json` відсутнє (перевірено grep-ом по `npm/`)
- Stryker використовує `stryker.config.baseline.mjs` з `perTest`-режимом (мутує лише рядки, покриті тестами), але сканує всі файли проєкту незалежно від git-дифу
