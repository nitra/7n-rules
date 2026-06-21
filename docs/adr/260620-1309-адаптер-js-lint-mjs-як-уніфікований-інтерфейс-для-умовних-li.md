---
session: 45a1997b-a862-4bad-aa42-299f0ed8f886
captured: 2026-06-20T13:09:19+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/45a1997b-a862-4bad-aa42-299f0ed8f886.jsonl
---

Поки генерується — пишу ADR по сесії:

```markdown
## ADR Адаптер `js/lint.mjs` як уніфікований інтерфейс для умовних lint-правил

## Context and Problem Statement
Умовні правила (`python`, `php`, `rust`) мали лінтер-логіку у `lint/lint.mjs`, але не мали стандартного JS-адаптера, тому `n-cursor lint <rule>` не міг їх делегувати. Точкою запуску лінту для цих правил залишався скрипт `lint-<rule>` у `package.json`, що суперечить уніфікованому підходу.

## Considered Options
* Додати `js/lint.mjs`-адаптер з сигнатурою `lint(files, cwd, { readOnly })`, що делегує до `lint/lint.mjs`.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `js/lint.mjs`-адаптер", because вся лінтер-логіка вже існувала у `lint/lint.mjs`; потрібна лише тонка обгортка, що пробрасовує `readOnly` (нуль мутацій у CI) — точно так само, як це зроблено в `python`.

### Consequences
* Good, because transcript фіксує очікувану користь: `n-cursor lint php --read-only` і `n-cursor lint rust --read-only` тепер виконують конформність + лінтер через єдину точку.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли-адаптери: `npm/rules/php/js/lint.mjs`, `npm/rules/rust/js/lint.mjs`. Патерн (readOnly → `--dry-run`/`--check`) перевірено на `python` (`npm/rules/python/js/lint.mjs`, вже існував) перед реплікацією. Коміти: `5427cb57` (php), `f3c4c34c` (rust).
```

---

```markdown
## ADR Rust CI лишається cargo-direct без `n-cursor lint rust`

## Context and Problem Statement
При міграції правила `rust` у `n-cursor lint` постало питання, чи оновлювати `lint_rust_yml`-воркфлоу (CI), що вже використовував `cargo fmt --check` + `cargo clippy` напряму, на виклик `n-cursor lint rust --read-only`.

## Considered Options
* Лишити CI cargo-direct (без змін у `lint_rust_yml`).
* Змінити CI на `n-cursor lint rust --read-only`.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Лишити CI cargo-direct", because `lint_rust_yml` вже ганяє `cargo fmt --check` і `cargo clippy` без `bun run lint-rust` — тобто CI не мав обгортки, яку треба прибирати. Нового виклику `n-cursor` у CI не потрібно; `js/lint.mjs`-адаптер додано лише для локальної точки.

### Consequences
* Good, because transcript фіксує очікувану користь: rust CI залишається мінімальним і не набуває зайньої bun-залежності.
* Bad, because місцева і CI-команди різні (локально — `n-cursor lint rust`, у CI — cargo напряму); transcript не містить підтверджених негативних наслідків від цієї розбіжності.

## More Information
`npm/rules/rust/policy/lint_rust_yml` залишено без змін. Новий адаптер: `npm/rules/rust/js/lint.mjs` (readOnly → `cargo fmt --check` + `cargo clippy` без `--fix`). Коміт: `f3c4c34c`.
```

---

```markdown
## ADR Прибирання `docker` з `RULE_SCRIPTS` і спрощення `checkCursorRuleScripts`

## Context and Problem Statement
`bun/js/layout.mjs` містив `RULE_SCRIPTS` і `checkCursorRuleScripts` — JS-логіку, що вимагала `lint-docker` / `lint-k8s` / `lint-image` скриптів, якщо відповідні правила активні. Після видалення `lint`-агрегату (`bun run lint`) ця логіка стала застарілою для правил, що переходять на `n-cursor lint <rule>`.

## Considered Options
* Прибирати `RULE_SCRIPTS`-записи по одному, синхронно з міграцією кожного правила (поточний підхід).
* Видалити `checkCursorRuleScripts` одразу для всіх — до завершення міграції docker/k8s/image.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Прибирати по одному, синхронно з міграцією правила", because docker/k8s/image — спільна механіка, і неповний реверт лишає `RULE_SCRIPTS` у суперечливому стані. При міграції docker з `RULE_SCRIPTS` прибрано запис `{ rules: ['docker'], script: 'lint-docker', doc: 'docker.mdc' }`, а `inChain`-логіку і невживані helper'и видалено — оскільки `lint`-агрегат уже не існує.

### Consequences
* Good, because transcript фіксує очікувану користь: bun layout тести (14/14) залишились зеленими після спрощення; `checkCursorRuleScripts` більше не посилається на прибраний lint-агрегат.
* Bad, because k8s і image-compress ще лишаються у `RULE_SCRIPTS` до завершення власної міграції — часткова консистентність між правилами.

## More Information
Файл: `npm/rules/bun/js/layout.mjs` — прибрано `inChain`, `WHITESPACE_RE`, `containsChainCall`. Тести переписано: `npm/rules/bun/js/tests/layout.test.mjs` (docker→k8s як активний приклад). Docker мігровано в цій же сесії: `npm/rules/docker/js/lint.mjs` отримав `export async function lint(...)`.
```
