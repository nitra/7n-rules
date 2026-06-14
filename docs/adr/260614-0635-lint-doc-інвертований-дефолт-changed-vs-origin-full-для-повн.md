---
session: 4b386ce5-70e3-4c5a-b5f6-bcdd5aef68ed
captured: 2026-06-14T06:35:11+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/4b386ce5-70e3-4c5a-b5f6-bcdd5aef68ed.jsonl
---

## ADR lint-doc: інвертований дефолт — changed-vs-origin, `--full` для повного сканування

## Context and Problem Statement
Команда `lint-doc` первісно перевіряла весь репозиторій. З'явилася потреба у швидкому режимі для локальних агентів і CI: лінтувати тільки те, що змінено відносно origin, щоб зворотній зв'язок надходив швидко і без шуму від непов'язаних файлів.

## Considered Options
* Залишити дефолт = повний скан, додати окремий прапор `--changed`
* Інвертувати дефолт: `lint-doc` без аргументів = changed-vs-origin; `lint-doc --full` = повний скан

## Decision Outcome
Chosen option: "Інвертувати дефолт", because це відповідає першочерговому сценарію — агент і CI лінтять саме свої зміни, а не весь репо; повний скан залишається доступним через `--full`.

### Consequences
* Good, because `lint-doc` без аргументів дає швидкий зворотній зв'язок лише по змінених файлах; некомітнуті правки агента входять автоматично (робоче дерево — права сторона `git diff --merge-base`).
* Good, because примітив `resolveChangedBase()` + `collectChangedFilesSince()` вже існує в `npm/scripts/lib/changed-files.mjs` і перевикористовується без дублювання git-логіки.
* Bad, because при недоступності upstream (detached HEAD, гілка ще не пушена) дефолт автоматично падає на повний скан (`--full`), що може сповільнити перший запуск на нових гілках.

## More Information
Семантика бази: `@{upstream}` → `origin/HEAD` → fail-closed на `--full`. Команди: `lint-doc` (changed-vs-origin), `lint-doc --full` (повний), `lint-doc --since <ref>` (явна база), `lint-doc --git` (vs HEAD, Stop-гейт, exit 2). Примітив: `npm/scripts/lib/changed-files.mjs::resolveChangedBase()`.

---

## ADR lint-doc CI: повний stale-detect (missing ∪ crc-mismatch)

## Context and Problem Statement
`lint-doc` детектує два стани застарілої документації: `missing` (файл є, `docs/<stem>.md` відсутня) і `crc-mismatch` (дока є, але CRC вихідника змінився після написання доки). Треба визначити, які стани валять CI.

## Considered Options
* `--missing-only`: CI падає тільки при відсутніх доках, `crc-mismatch` толерується
* Повний stale-detect: CI падає і на `missing`, і на `crc-mismatch`

## Decision Outcome
Chosen option: "Повний stale-detect", because `--missing-only` залишає головну діру — застарілі доки не ловляться, борг накопичується непомітно; сенс механізму — щоб дока не відставала від коду.

### Consequences
* Good, because будь-яка правка джерела без перегенерації доки ловиться в PR; дока не може мовчки відстати після зміни коду.
* Bad, because кожна правка джерела вимагає прогнати `fix-doc` і закомітити оновлену доку перед пушем, інакше CI червоний. Передумова активації: прогнати `fix-doc` до нуля stale (Крок 0 зі спеки) до ввімкнення CI-гейта.

## More Information
`--missing-only` лишається доступним прапором команди, але не використовується в CI-конфігурації. Спека: `docs/superpowers/specs/2026-06-12-doc-files-lint-doc-fix-doc-split.md`, секція 6, п. 4.

---

## ADR lint: класифікація per-file vs whole-tree і контекст виклику (агент / GA)

## Context and Problem Statement
У проекті кілька lint-механізмів із різною природою: одні перевіряють кожен файл незалежно, інші — весь граф одночасно. Потрібно визначити де і в якому режимі вони запускаються залежно від контексту — локальний агент чи GA.

## Considered Options
* Всі лінтери завжди повний скан (`--full`)
* Розподіл per-file / whole-tree за технічною можливістю + різні набори для агента і GA

## Decision Outcome
Chosen option: "Розподіл per-file / whole-tree + контекст виклику", because per-file детектори коректні під інваріантом «base вже зелений» — нова помилка може бути тільки в зміненому файлі; крос-файлові механізми (jscpd, knip) технічно не можна звузити без втрати коректності.

Фінальна класифікація:

| Механізм | Природа | Агент (локально) | GA |
|---|---|---|---|
| `doc` (lint-doc) | per-file | ✅ changed-vs-origin | ✅ `--since $BASE` |
| `js-lint` (oxlint/eslint) | per-file | ✅ changed-vs-origin | ✅ changed-vs-base |
| `style-lint` (stylelint) | per-file | ✅ changed-vs-origin | ✅ changed-vs-base |
| `text` (cspell/markdownlint/shellcheck/v8r) | per-file | ✅ changed-vs-origin | ✅ changed-vs-base |
| `security` (trufflehog) | per-file (технічно) | ❌ не запускається | ✅ `--full` завжди |
| `js-lint-ci` (jscpd + knip) | whole-tree | ❌ | ✅ `--full` |
| `rego` (opa check + regal) | whole-tree | ❌ | ✅ `--full` |
| `ga` (actionlint/zizmor) | whole-tree | ❌ | ✅ `--full` |

### Consequences
* Good, because локальний агент отримує швидкий зворотній зв'язок тільки по своїх файлах без запуску важких крос-файлових перевірок.
* Good, because GA залишається повністю строгим: per-file по дельті для швидких детекторів + `--full` для security і неподільних whole-tree.
* Bad, because `security` не запускається локально агентом — секрети потраплять у коміт і будуть зловлені тільки в GA; це свідомий компроміс (transcript фіксує: «все що можна зробити per file робимо», але security в GA завжди `--full`).

## More Information
`security` лишається `--full`-only в GA як defense-in-depth: повна гарантія сильніша, ціна повного скану trufflehog невелика. База для GA PR: `--since origin/${{ github.base_ref }}`; для push у main/dev: `--since $LAST_GREEN` (SHA через `gh run list --workflow lint-doc.yml --status success --limit 1 --json headSha`). Усі per-file лінтери мігрують з HEAD-бази на `resolveChangedBase()` (origin). Нове правило з канонічною класифікацією: `npm/rules/lint`.

---

## ADR lint: консолідація всіх lint-механізмів у `npm/rules/lint`

## Context and Problem Statement
Класифікація lint-механізмів (per-file / whole-tree, контекст виклику) не мала єдиного канонічного місця — частина була в `scripts.mdc`, частина неявна. Потрібне одне місце для правила, щоб агенти і CI знали, що і де запускати.

## Considered Options
* Додати нову секцію в наявний `scripts.mdc`
* Створити новий модуль `npm/rules/lint` поряд з іншими правилами

## Decision Outcome
Chosen option: "Новий модуль `npm/rules/lint`", because це відповідає наявній структурі проекту (кожен концерн — окремий модуль у `npm/rules/`); фрагментація `scripts.mdc` двома alwaysApply-файлами провокує дрейф.

### Consequences
* Good, because lint-канон у одному місці поряд з іншими правилами; легко посилатися, легко оновлювати.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Наявні правила в `npm/rules/`: `adr`, `bun`, `changelog`, `ci4`, `doc`, `feedback`, `ga`, `js-lint`, `js-lint-ci`, `rego`, `security`, `style-lint`, `text` та ін. Новий модуль `lint` консолідує класифікацію і правила виклику — не дублює логіку окремих правил, а описує їх взаємодію і контекст запуску.
