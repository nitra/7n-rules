## ADR Розділення lint на quick (змінені файли) та ci (всі файли) через meta.json

## Context and Problem Statement
Поточний `bun run lint` перевіряє всі файли, що робить його повільним для локальної розробки. Потрібно відокремити швидку перевірку (лише змінені файли) від повної CI-перевірки (всі файли), зберігши єдину точку конфігурації для правил.

## Considered Options
* F1 — CLI-оркестратор у пакеті (`n-cursor lint` / `lint-ci`), читає `meta.json.lint`
* F2 — генерація lint-скриптів під час sync (не обрано)
* F3 — лишити ланцюг, додати лише фільтр (не обрано)
* E1 — одне поле `meta.json.lint: "quick"|"ci"`, семантика quick⊆ci
* E2 — поле-обʼєкт `lint: { phase, scope }` (не обрано)
* E3 — булеві прапорці `lintQuick`/`lintCi` (не обрано)
* D3 — per-rule атрибут зі спеціальним розбиттям для `js-lint`
* D1 — грубий атрибут на правилі без розбиття (не обрано)
* D2 — атрибут на lint-кроці/інструменті (не обрано)
* G3 — база "змінені файли" = working-tree vs HEAD + untracked
* H1 — і `lint`, і `lint-ci` виконують `--fix`, падають на невиправних
* H2 — `lint` фіксить, `lint-ci` лише перевіряє (не обрано)
* I1 — все в одному spec, scope = лише механіка пакета

## Decision Outcome
Chosen option: "F1 + E1 + D3 + G3 + H1 + I1", because кожен варіант обрано явно під час brainstorming-сесії як найбільш відповідний до вимог data-driven підходу і узгодженості з наявними патернами пакета.

### Consequences
* Good, because transcript фіксує очікувану користь: швидкий `lint` прискорює локальний цикл, `lint-ci` дає повну перевірку, конфігурація централізована через `meta.json`, семантика quick⊆ci гарантує, що `lint-ci` є суперсетом `lint`.
* Bad, because `lint-ga`, `lint-rego`, `lint-text` потребують додаткового аналізу при імплементації (чи підтримують file-list); `js-lint` розбивається на два скрипти (`lint-js` і новий `lint-js-ci`), що збільшує кількість точок підтримки.

## More Information
Канонічний spec: `docs/superpowers/specs/2026-05-31-lint-quick-ci-split-design.md` (статус "Approved"). Дублікат `docs/superpowers/specs/2026-05-31-lint-split-quick-ci-design.md` видалено (коміт `26cb6ac`). План імплементації: `docs/superpowers/plans/2026-05-31-lint-quick-all-meta-json.md` (коміт `1a86d42`).

Технічні деталі, підтверджені у transcript:
- Quick-інструменти (підтримують file-list): `oxlint`, `eslint`, `stylelint`, `oxfmt`
- CI-only-інструменти (cross-file, без file-list): `jscpd`, `knip`, `trufflehog`
- Розбиття `js-lint`: `lint-js` (oxlint+eslint, quick) + новий `lint-js-ci` (jscpd+knip, ci)
- Новий оркестратор: `npm/scripts/lint-cli.mjs`, cases у `npm/bin/n-cursor.js`
- Схема: `rule-meta.json` з опціональним полем `lint: "quick"|"ci"`; валідація через `rule_meta.mjs`
- Кореневий `package.json` репо мігрує через sync, не вручну
