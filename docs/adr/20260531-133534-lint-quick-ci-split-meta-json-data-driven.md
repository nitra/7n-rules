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

## Update 2026-05-31

### Дві окремі JSON-схеми для `rules` і `skills` (E2)

`npm/rules/<id>/meta.json` і `npm/skills/<id>/meta.json` — та сама назва файлу, але дві незалежні схеми: `rules`-схема знає лише `auto`; `skills`-схема знає `auto` + `worktree`. Поле `worktree` відсутнє в `rules`-схемі — правила є програмними перевірками, не генеративними скілами; помилка «worktree у правилі» вловлюється валідатором автоматично. Check-перевірка розрізняє схеми за розташуванням файлу: `skills/*/meta.json` vs `rules/*/meta.json`.

### Характеристика важкого та легкого наборів

Важкий набір (CI + worktree): `jscpd`, `knip`, `cspell`, `lint-security`, `lint-ga`, `lint-k8s`, `lint-docker`, `lint-rego`, `lint-text`. Легкий (агент причісує свої правки): `oxfmt` + `eslint`/`oxlint` лише на `git diff`. Принцип: «легкий = що я зачепив; важкий = весь репо + безпека + інфра». `n-lint/meta.json` тимчасово `worktree: false` — `lint` реактивний (лінтить незакомічені зміни поточного checkout, які worktree відрізає) — до реалізації split.

## Update 2026-05-31

### Деталі архітектурних рішень lint-split

**D3 + E1**: `js-lint` — єдиний реальний композит, розщеплено явно: `js-lint` (quick: oxlint+eslint) і `js-lint-ci` (ci: jscpd+knip). Поле `lint: "quick"|"ci"` (E1) з семантикою `quick ⊆ ci`; scope виводиться з фази, не дублюється. D2 (атрибут на рівні інструмента) відхилено як надмірне ускладнення.

**G3 — база quick**: working-tree зміни відносно HEAD + untracked файли. Покриває сценарій «агент щойно створив/змінив файли перед комітом». G2 (merge-base з `main`) відхилено — не охоплює untracked нових файлів.

**H1 — виключення CLI-кроків з quick**: `n-cursor lint-ga`, `lint-rego`, `lint-text` лишаються лише у `ci`-наборі (YAGNI, рідко змінюються в одному PR). H2 (підтримка `--files` у цих CLI-кроках) відкладена.

**Інструменти за фазою**: quick — `oxlint`, `eslint`, `stylelint`, `oxfmt`; ci-only — `jscpd`, `knip`, `trufflehog`, `n-cursor lint-ga/rego/text`.

Сесія завершилась на brainstorming-стадії; spec-документ і план реалізації ще не написані.

## Update 2026-05-31

### F1 — CLI-оркестратор і fix-поведінка (H1)

**F1 vs F2/F3**: `n-cursor lint`/`n-cursor lint-ci` зчитують `rules/*/meta.json` динамічно — аналогічно до `auto-rules.mjs` після Spec B. F2 (генерація скриптів під час sync) не вирішує задачу «передати список файлів інструментам». F3 (хардкод + фільтр по diff) зберігає хардкод у `package.json`.

**H1 — симетрична fix-поведінка**: обидва режими (`lint` і `lint-ci`) виконують `--fix`. H2 (`lint-ci` лише перевіряє, без fix) відхилено — не всі інструменти підтримують однаковий `--no-fix` режим; H1 дає менше сюрпризів на старті.

Поточний хардкод-ланцюг (для довідки): `lint-ga && lint-js && lint-rego && lint-security && lint-style && lint-text && oxfmt .`.

## Update 2026-05-31

Реалізація завершена: гілка `feat/lint-quick-ci`, 8 комітів `78cedd6`..`c65142f`. Тестовий сюїт: **1987 passed, 0 failed**.

Нові файли пакета:
- `npm/scripts/lib/changed-files.mjs` — база «змінених» для quick: working-tree vs HEAD + untracked нові файли
- `npm/scripts/lint-cli.mjs` — CLI-оркестратор (замінює `run-lint-cli.mjs`)
- `npm/rules/js-lint-ci/` (meta.json + js-lint-ci.mdc + js/lint.mjs) — новий ci-концерн для jscpd+knip

Класифікація `meta.json.lint`: `js-lint`, `style-lint` → `"quick"`; `ga`, `rego`, `text`, `security`, `js-lint-ci` → `"ci"`; `oxfmt` → quick (окремий крок). Причина класифікації `ga/rego/text/security` як ci підтверджена дослідженням субагента: їхні CLI-функції (`runLintGaCli`, `runLintRego`, `runLintTextCli`, trufflehog) не приймають список файлів.

Змінено в `npm/bin/n-cursor.js`: замінено `case 'lint'` (старий timing-оркестратор `runLintCli`) на нові `case 'lint'` / `case 'lint-ci'` через `runLint({ ci })` з `lint-cli.mjs`; видалено `npm/scripts/lib/run-lint-cli.mjs`.

Change-файл: `npm/.changes/lint-quick-ci-split.md`. Spec: `docs/superpowers/specs/2026-05-31-lint-quick-ci-split-design.md` (Approved). Plan: `docs/superpowers/plans/2026-05-31-lint-quick-ci-e1.md` (8 задач).

Примітка: `.cursor/rules/n-*` дзеркало оновиться лише після релізу пакета з цими змінами — sync бере правила з опублікованого `@nitra/cursor`, не з локального `npm/rules`.
