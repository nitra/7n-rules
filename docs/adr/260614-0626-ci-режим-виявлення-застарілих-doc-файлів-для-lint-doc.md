---
session: 4b386ce5-70e3-4c5a-b5f6-bcdd5aef68ed
captured: 2026-06-14T06:26:04+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/4b386ce5-70e3-4c5a-b5f6-bcdd5aef68ed.jsonl
---

Workflow вимагає підтвердження. Генерую ADR-блоки напряму з транскрипту.

---

## ADR CI-режим виявлення застарілих doc-файлів для lint-doc

## Context and Problem Statement
У проєкті впроваджується `lint-doc` — детермінований детектор, що перевіряє наявність і актуальність docs-файлів поряд із кодом. Постало питання, наскільки суворим має бути CI: чи фейлити лише за відсутністю доки (`missing`), чи й за відсталою докою (`crc-mismatch`).

## Considered Options
* Варіант 1 — повний stale-детект: `stale = missing ∪ crc-mismatch`
* Варіант 2 — `--missing-only`: CI фейлить лише при відсутній доці, `crc-mismatch` толерується

## Decision Outcome
Chosen option: "Варіант 1 — повний stale-детект (`missing ∪ crc-mismatch`)", because `--missing-only` лишає головну діру — дока є, але відстала від коду; сенс усього механізму саме в тому, щоб дока не відставала від коду.

### Consequences
* Good, because будь-яка правка джерела без перегенерації доки буде зловлена CI і не потрапить у `main`.
* Bad, because кожна зміна джерела вимагає прогнати `fix-doc` і закомітити оновлену доку; без попереднього Крок-0 (`fix-doc` до зеленого baseline) перший CI-запуск одразу червоний на накопиченому борзі.

## More Information
Файли: `docs/superpowers/specs/2026-06-12-doc-files-lint-doc-fix-doc-split.md`, `lint-doc.yml`. Передумова (Крок 0): перед увімкненням CI прогнати `fix-doc` до повного зеленого стану. `--missing-only` лишається як опція команди, але не як режим CI.

---

## ADR Дефолт lint-doc — diff vs origin, --full — повний скан

## Context and Problem Statement
Локальні агенти та CI-workflow потребують ефективної перевірки документації лише для тих файлів, що змінилися, — без повного сканування всього репо щоразу. Водночас потрібен і спосіб запустити повний аудит.

## Considered Options
* Дефолт = diff vs origin (голий `lint-doc`), повний скан = `lint-doc --full`
* Дефолт = повний скан, delta = опція `--since` / `--git`
* `--missing-only` як режим CI (відхилено на попередньому кроці)

## Decision Outcome
Chosen option: "дефолт = diff vs origin, `--full` = повний скан", because і CI, і локальні агенти потребують «по diff vs origin» як основний режим; повний скан — лише локальний аудит.

### Consequences
* Good, because голий `lint-doc` покриває весь актуальний diff агента (включно з uncommitted правками, бо права сторона diff — робоче дерево); агент може викликати `lint-doc` без аргументів і отримає перевірку лише своїх змін.
* Good, because fail-closed: якщо `@{upstream}` / `origin/HEAD` не резолвиться — `lint-doc` автоматично падає на `--full`, ніколи не недоперевіряє.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Семантика diff: `git diff --name-only --merge-base <base>`; права сторона = робоче дерево. Дефолтна база: `@{upstream}` → `origin/HEAD`. Both-direction маппінг зберігається (змінене джерело → його дока; змінена/видалена дока → її джерело). Автоматичний fallback на `--full` при зміні `docgen-ignore.mjs` — **явно відхилено** користувачем. Утиліт: `npm/scripts/lib/changed-files.mjs` (`resolveChangedBase`, `collectChangedFilesSince`).

---

## ADR lint-doc --since як явна база для CI і локальних агентів

## Context and Problem Statement
CI-workflow і локальні агенти мають різні відправні точки для delta-перевірки: PR порівнює з `base_ref`, push у `main` — з останнім успішним запуском, агент — зі своїми незакомітованими правками відносно origin. Потрібен єдиний спосіб задати явну базу без дублювання git-логіки.

## Considered Options
* Новий CLI-режим `lint-doc --since <ref>` з перевикористанням `npm/scripts/lib/changed-files.mjs`
* Рахувати diff безпосередньо в YAML і передавати `lint-doc <paths…>`

## Decision Outcome
Chosen option: "новий CLI-режим `lint-doc --since <ref>`", because git-логіка і both-direction маппінг мають жити в одному **тестованому** місці CLI, а не бути розмазані по YAML; `npm/scripts/lib/changed-files.mjs` (`resolveChangedBase`, `collectChangedFilesSince`) вже реалізовує потрібну семантику і має бути перевикористаний.

### Consequences
* Good, because transcript фіксує очікувану користь: одна команда обслуговує і локального агента, і PR CI, і push-CI; логіка верифікована тестами CLI, а не YAML-рядками.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Точки виклику:

| Хто | Виклик |
| --- | --- |
| Локальний агент | `lint-doc` (дефолт) або `lint-doc --since origin/main` |
| CI · PR | `lint-doc --since origin/${{ github.base_ref }}` |
| CI · push main/dev | `lint-doc --since $LAST_GREEN` |
| Stop-гейт | `lint-doc --git` |
| Повний аудит | `lint-doc --full` |

`$LAST_GREEN` отримується через: `gh run list --workflow lint-doc.yml --branch "$GITHUB_REF_NAME" --status success --limit 1 --json headSha --jq '.[0].headSha'`. Файл: `npm/scripts/lib/changed-files.mjs`.

---

## ADR Whole-tree лінтери (ci-набір) викликаються виключно у повному режимі

## Context and Problem Statement
При переведенні per-file лінтерів на delta-режим vs origin постало питання: чи можна застосувати changed-only логіку і до whole-tree лінтерів (knip, jscpd, trufflehog, actionlint, conftest/regal, text), щоб прискорити CI.

## Considered Options
* Whole-tree лінтери — завжди повний режим (`--full` / ci-фаза), delta не застосовується
* Додатковий per-file режим для частини whole-tree лінтерів (дискусія розпочата, але не завершена в сесії)

## Decision Outcome
Chosen option: "whole-tree лінтери — завжди повний режим", because knip бачить увесь граф імпортів, trufflehog — увесь tree; changed-only семантично некоректний для них.

### Consequences
* Good, because class чітко розмежований: `quick` (per-file) = delta vs origin; `ci` (whole-tree) = завжди повний.
* Bad, because аудит per-file можливостей для кожного whole-tree механізму (text, ga, rego) розпочато в сесії, але не завершено — можливості оптимізації залишаються нерозглянутими.

## More Information
Whole-tree (ci-набір): `js-lint-ci` (knip/jscpd), `security` (trufflehog), `ga` (actionlint), `rego` (conftest/regal), `text`. Per-file (quick-набір): `doc` (lint-doc), `js-lint` (oxlint/eslint), `style-lint` (stylelint). Файли читались під час аудиту: `security/js/lint.mjs`, `text/lint/lint.mjs`.

---

## ADR Уніфікація бази per-file лінтерів: HEAD → origin

## Context and Problem Statement
Поточна реалізація quick-лінтерів (`js-lint`, `style-lint`) використовує `collectChangedFiles()`, що рахує diff проти `HEAD` (лише uncommitted). Агент, що закомітив частину правок на гілці, не бачить їх при перевірці. `coverage` вже перейшов на `resolveChangedBase()` (origin), але lint-механізми — ні; «changed» означає різні речі в різних командах.

## Considered Options
* Уніфікувати всі per-file (quick) лінтери на `resolveChangedBase()` (origin)
* Лишити агрегатор на HEAD, origin-базу — лише для standalone `lint-doc`

## Decision Outcome
Chosen option: "уніфікувати всі per-file лінтери на `resolveChangedBase()`", because «changed» має означати одне й те саме скрізь — в агрегаторі, у standalone-командах і в coverage; мета — забезпечити вже перевірений код у новому пуші.

### Consequences
* Good, because transcript фіксує очікувану користь: семантична узгодженість між `lint-doc`, `js-lint`, `style-lint` і `coverage` — агент використовує одну ментальну модель.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл для зміни: `npm/scripts/lib/changed-files.mjs` — замінити виклики `collectChangedFiles()` (vs HEAD) на `collectChangedFilesSince(resolveChangedBase())` у точках, де споживаються per-file лінтери. `resolveChangedBase()` резолвить: явний ref → `@{upstream}` → `origin/HEAD`.

---

## ADR Нове правило lint у npm/rules/ замість секції в scripts.mdc

## Context and Problem Statement
Семантику lint-механізмів (класифікація per-file/whole-tree, базові ref, вимоги до виклику) треба зафіксувати у `.cursor/rules/` як machine-readable правило. Постало питання: чи додавати секцію до існуючого `scripts.mdc`, чи створювати окремий файл у `npm/rules/`.

## Considered Options
* Секція в `.cursor/rules/scripts.mdc` (рекомендовано асистентом)
* Нове правило у `npm/rules/lint/` за аналогією з існуючими концернами (`doc`, `js-lint`, `ga` тощо)

## Decision Outcome
Chosen option: "нове правило у `npm/rules/lint/`", because `npm/rules/` є канонічним місцем для концернів; додавання секції до `scripts.mdc` фрагментувало б lint-канон на два `alwaysApply`-файли і вело б до дрейфу.

### Consequences
* Good, because lint отримує власний концерн-файл у канонічному місці; уникається дрейф через роздвоєний alwaysApply-канон.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Існуючі правила в `npm/rules/`: `doc`, `js-lint`, `ga`, `rego`, `security`, `text` та інші. Усі lint-механізми мають бути перенесені до нового правила `npm/rules/lint/`. `scripts.mdc` (`alwaysApply: true`) лишається без змін у частині lint.
