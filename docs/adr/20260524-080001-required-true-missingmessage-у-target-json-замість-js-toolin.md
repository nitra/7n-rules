---
session: cd601c3c-0f14-4351-9c41-ac2e633456c0
captured: 2026-05-24T08:00:01+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/cd601c3c-0f14-4351-9c41-ac2e633456c0.jsonl
---

## ADR `required:true` + `missingMessage` у `target.json` замість `js/tooling.mjs`

## Context and Problem Statement
При плануванні правила `rust` план містив окремий `js/tooling.mjs`, що перевіряв існування `package.json`, `.vscode/extensions.json` та `.github/workflows/lint-rust.yml` через `existsSync`. Під час виконання Task 6 з'ясувалося, що `runPolicyConcern` вже підтримує автоматичну обробку відсутніх target-файлів — через поля `required` та `missingMessage` у `target.json`.

## Considered Options
* Окремий `js/tooling.mjs` з `existsSync`-перевірками для кожного target-файлу
* Поля `"required": true` та `"missingMessage"` безпосередньо у `target.json` кожного policy-пакету

## Decision Outcome
Chosen option: "Поля `required:true` + `missingMessage` у `target.json`", because `runPolicyConcern` вже реалізує цю логіку — окремий `js/tooling.mjs` дублював би вже наявну функціональність CLI і збільшував обсяг коду без нової цінності.

### Consequences
* Good, because transcript фіксує очікувану користь: "Менше коду, одне місце для missing-повідомлення, немає ризику дрифту між JS і policy-шаром."
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Три `target.json` отримали `"required": true` + `"missingMessage"`:
- `npm/rules/rust/policy/package_json/target.json`
- `npm/rules/rust/policy/vscode_extensions/target.json`
- `npm/rules/rust/policy/lint_rust_yml/target.json`

Реалізація обробки — `npm/scripts/utils/run-rule.mjs` (функція `runPolicyConcern`).

---

## ADR Rust rule використовує flat concern layout як першопрохідець

## Context and Problem Statement
На момент реалізації правила `rust` існував окремий план `2026-05-23-flat-concern-layout.md` із міграцією `js/<concern>/check.mjs` → `js/<concern>.mjs`. Специфікація правила `rust` була написана під стару вертикальну структуру. Постало питання: будувати `rust` у старій структурі або одразу в flat.

## Considered Options
* Вертикальна структура (`js/tooling/check.mjs`, `js/applies/check.mjs` з тестами поруч) — відповідно до початкового плану
* Flat concern layout (`js/tooling.mjs`, `js/applies.mjs`, тести в `js/tests/`) — user підтвердив, що flat-міграція вже виконана

## Decision Outcome
Chosen option: "Flat concern layout", because користувач підтвердив: «flat міграція вже виконана», і `discover-checkable-rules.mjs` вже шукає `rules/<id>/js/<concern>.mjs` (v1.13.90+). Будувати у старій структурі означало б негайну необхідність міграції.

### Consequences
* Good, because `rust` з'являється у кодовій базі вже в канонічній flat-структурі; жодної подальшої міграції не потрібно.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли правила: `npm/rules/rust/js/applies.mjs`, `npm/rules/rust/js/tests/applies.test.mjs`. Discovery-утиліта: `npm/scripts/utils/discover-checkable-rules.mjs:45` (`listJsConcerns`).

---

## ADR Вилучення Rust-розширень з `tauri/policy/vscode_extensions`

## Context and Problem Statement
До рефакторингу `tauri/policy/vscode_extensions` вимагав у `.vscode/extensions.json` три записи: `tauri-apps.tauri-vscode`, `rust-lang.rust-analyzer`, `tamasfe.even-better-toml`. Нове правило `rust` додає власний policy-пакет `vscode_extensions`, що вимагає `rust-lang.rust-analyzer` і `tamasfe.even-better-toml`. Лишати обидві вимоги в `tauri` означало б дублювання.

## Considered Options
* Залишити всі три розширення у `tauri.vscode_extensions` (без змін)
* Вилучити `rust-lang.rust-analyzer` і `tamasfe.even-better-toml` з `tauri.vscode_extensions`, залишивши лише `tauri-apps.tauri-vscode`

## Decision Outcome
Chosen option: "Вилучити Rust-розширення з tauri.vscode_extensions", because Tauri-проєкт завжди має `src-tauri/Cargo.toml`, що автоматично активує правило `rust`; Rust-розширення тепер є відповідальністю правила `rust`, а не `tauri`.

### Consequences
* Good, because transcript фіксує очікувану користь: одне місце визначення Rust VSCode-вимог, без дублювання між правилами.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `npm/rules/tauri/policy/vscode_extensions/vscode_extensions.rego`, `npm/rules/tauri/policy/vscode_extensions/vscode_extensions_test.rego`, `npm/rules/tauri/tauri.mdc`. Новий канон для `tauri`: `template/extensions.json.snippet.json` містить лише `["tauri-apps.tauri-vscode"]`.

---

## ADR Авто-детект правила `rust` через факт `hasCargoToml`

## Context and Problem Statement
Механізм `auto-rules.mjs` визначає набір правил для проєкту за фактами файлової системи (приклад: `hasCapacitorConfig`, `hasGaWorkflowsDir`). Треба було визначити, який факт і який шлях пошуку використовувати для виявлення Rust-проєктів.

## Considered Options
* Факт `hasCargoToml` — рекурсивний walker по дереву проєкту з пропуском `node_modules`, `.git`, `.next`, `.turbo`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Факт `hasCargoToml` з рекурсивним walker-ом", because `auto.md` правила `rust` каже «якщо в проєкті є хоч один Cargo.toml», що прямо відповідає fact-імені і логіці walker-утиліти `utils/has-cargo-toml.mjs`. Той самий walker використовується в `js/applies.mjs` — єдиний алгоритм для auto-detect і applies-gate.

### Consequences
* Good, because transcript фіксує очікувану користь: автоматичне увімкнення для будь-якого проєкту з Rust без ручного редагування `.n-cursor.json`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Факт додано у `npm/scripts/auto-rules.mjs` (`updateFileFacts`, `gatherProjectFacts`, `autoRuleChecks`). Walker-утиліта: `npm/rules/rust/utils/has-cargo-toml.mjs`. Тести: `npm/scripts/tests/auto-rules.test.mjs` (2 нових сценарії з `withTmpCwd`/`ensureDir`/`writeFile`).
