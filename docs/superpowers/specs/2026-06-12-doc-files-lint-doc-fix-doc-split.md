# doc-files → lint-doc-files / fix-doc-files: міграція на канонічний механізм правил

**Дата:** 2026-06-12
**Статус:** чернетка — на затвердження
**Надбудова:** `doc` — один із механізмів, класифікованих у спеці `2026-06-14-lint-rule-consolidation.md` (`meta.json:lint` = `"per-file"`, база-origin, три контексти запуску). Scope/контексти — там; ця спека лишається джерелом істини по самому детекту staleness і парі `lint-doc-files`/`fix-doc-files`.
**Зв'язані документи:** ADR `20260516-rules-fix-lint-policy-structure` (структура fix/lint/policy), спека `2026-06-10-doc-files-local-only-pipeline` (local-only конвеєр генерації — лишається чинною), ADR `260610-2228`, канон `lint-*`/`fix-<id>` у `.cursor/rules/scripts.mdc` («Серіалізація важких CLI-команд»)

## 1. Мета

Розвести у механізмі `doc-files` дві відповідальності, які зараз сплетені в одному
skill-неймспейсі (`n-cursor doc-files scan|check|gen|stamp`):

- **`lint-doc-files`** — детермінований **детектор**: знаходить кодові файли без актуальної
  файлової доки (`<dir>/docs/<stem>.md`). 0 викликів LLM, працює будь-де (локально, hook, CI).
- **`fix-doc-files`** — **генератор**: безпосередньо створює/оновлює доки local-only конвеєром
  (omlx) зі штампом CRC. Потребує локальної моделі, у CI не запускається.

І додати **окремий GA-workflow `lint-doc-files.yml`**, який у CI **тільки лінтує** наявність
документації — рівно так, як `lint-text.yml` / `lint-ga.yml` лінтують свої домени.

Це та сама пара, що вже є канон у проєкті: `/n-lint` (детект+вивід порушень) проти
`/n-fix` (закриття порушень); `lint/lint.mjs` проти fix-каналу правила.

## 2. Поточний стан (звідки мігруємо)

| Що | Де зараз |
| --- | --- |
| Увесь JS (скан, CRC, ignore, конвеєр генерації) | `npm/skills/doc-files/js/` (≈13 модулів + `tests/` + `docs/`) |
| CLI | `n-cursor doc-files scan\|check\|gen\|stamp` (диспатч у `npm/bin/n-cursor.js`, lazy import зі skills) |
| Детект для hook'ів | `doc-files check --hook` (PostToolUse), `doc-files check --git` (Stop-гейт, поріг `N_CURSOR_DOC_FILES_GATE_MAX`), exit 2 |
| Синк hook'ів | `npm/scripts/sync-claude-config.mjs`, маркер `DOC_FILES_HOOK_COMMAND_MARKER = '@nitra/cursor doc-files check'` |
| Секція CLAUDE.md | рендериться кодом у `npm/bin/n-cursor.js` (`## Файлова документація…`) |
| GA workflow | **немає** |
| `lint-*` скрипт у package.json | **немає** |
| Policy (rego/template) | **немає** |

Розширення джерел (канон у `docgen-scan.mjs`): `.js .mjs .ts .vue .py .rs`.
Визначення застарілості: дока **stale**, якщо її **немає** (`missing`) або
`crc(джерело) ≠ crc у frontmatter` (`crc-mismatch`). Degraded (низький `score`,
CRC свіжий) — **не** stale.

## 3. Ухвалені рішення (пропозиція)

| # | Питання | Рішення |
| --- | --- | --- |
| А | Де живе механізм | Нове правило **`npm/rules/doc-files/`** — лише правило має слоти для policy/template (GA workflow, package.json-скрипт) і місце в lint-агрегаторі. Скіл `doc-files` стає **тонким** (тільки `SKILL.md` + `meta.json`; прецедент — скіл `lint`) |
| Б | Імена команд | rule id = `doc-files` → команди **`lint-doc-files`** / **`fix-doc-files`**; ключі локів `lint-doc-files` / `fix-doc-files` виводяться зі шляху каталогу (канон scripts.mdc) |
| В | Що детектує `lint-doc-files` | повний клас **stale = missing ∪ crc-mismatch** (обидва детерміновані, 0 токенів); degraded **не** падає; опція `--missing-only` звужує до самої наявності |
| Г | Exit-коди | повний прогін — **1** (конвенція `lint-*`); `--hook`/`--git` — **2** (hook-протокол Claude Code: blocking feedback). Раніше plain `check` повертав 2 — зміна фіксується в changelog |
| Д | Переїзд JS | `npm/skills/doc-files/js/` → **`npm/rules/doc-files/js/`** одним `git mv` (разом із `tests/` і `docs/`); глибина та сама, тож відносні імпорти `../../../scripts/…`, `../../../lib/…` не змінюються; після переносу `fix-doc-files --stamp` оновлює `source:` у frontmatter док |
| Е | GA workflow | `policy/lint_doc_yml/` + `template/lint-doc-files.yml.snippet.yml` (job `doc`, `bun run lint-doc-files`); CI суто детермінований — без omlx/LLM/ключів |
| Ж | package.json | `policy/package_json/` вимагає `"lint-doc-files": "n-cursor lint-doc-files"`; кореневий `lint`-ланцюжок цього репо отримує `bun run lint-doc-files` (алфавітно перед `lint-ga`) |
| З | Агрегатор `n-cursor lint` | `meta.json` правила: `{ "auto": "завжди", "lint": "quick" }`; `js/lint.mjs` — per-file адаптер (quick = лише змінені файли) |
| И | Hooks | команди стають `npx @nitra/cursor lint-doc-files --hook` / `--git`; маркер у sync — `'@nitra/cursor lint-doc-files'`; синк розпізнає й **замінює** legacy-рядки з `doc-files check`. Env `N_CURSOR_DOC_FILES_GATE_MAX` — без перейменування |
| К | Сумісність | `n-cursor doc-files <sub>` лишається **делегувальним аліасом** з deprecation-попередженням на stderr; зняття аліасів — у наступному major |
| Л | Semver | реліз з аліасами — **minor**; видалення неймспейсу `doc-files` — major |

## 4. Цільова структура

```text
npm/rules/doc-files/
  doc.mdc                        # правило: обовʼязкова файлова дока, CRC-свіжість, команди
  meta.json                      # { "auto": "завжди", "lint": "quick" }
  js/                            # ← перенесено зі npm/skills/doc-files/js/ (git mv)
    lint.mjs                     # НОВЕ: адаптер агрегатора lint(changed, cwd)
    docgen-scan.mjs              # ядро детекту (scan, staleness, resolveRoot)
    docgen-crc.mjs  docgen-ignore.mjs
    docgen-gen.mjs  docgen-files-batch.mjs  docgen-prompts.mjs
    docgen-extract.mjs  docgen-extract-anchors.mjs
    units.mjs  units-js.mjs  units-rs.mjs
    tests/  docs/                # переїздять разом із джерелами
  lint/
    lint.mjs                     # runLintDocCli через runStandardLint (ключ lint-doc-files)
  policy/
    lint_doc_yml/
      lint_doc_yml.rego          # суперсет-перевірки workflow (як text.lint_text)
      lint_doc_yml_test.rego
      target.json                # { "files": { "single": ".github/workflows/lint-doc-files.yml" } }
      template/lint-doc-files.yml.snippet.yml
    package_json/
      package_json.rego
      package_json_test.rego
      target.json                # { "files": { "single": "package.json", "required": true } }
      template/package.json.contains.json   # { "scripts": { "lint-doc-files": ["n-cursor lint-doc-files"] } }

npm/skills/doc-files/
  SKILL.md                       # тонкий агентський workflow: fix-doc-files → підсумок → lint-doc-files --git
  meta.json                      # без змін: { "auto": "завжди", "worktree": false, "requireRoot": true }
```

Окремого `fix.mjs` правило **не** має: структурні concerns (наявність workflow,
скрипт у package.json) повністю закриває policy-канал (`n-cursor check doc-files` /
`n-cursor fix doc-files` — той самий механізм, що нині створює `lint-text.yml` з template).
Контентні порушення (відсутні/застарілі доки) — **поза** скоупом `n-cursor fix`,
як і ESLint-порушення (закриваються `fix-doc-files`, а не generic-оркестратором).

## 5. Мапа команд

| Було | Стає | Exit | Семантика |
| --- | --- | --- | --- |
| `doc-files scan` | `lint-doc-files --json` | 0 | JSON-лістинг усіх кандидатів зі станом застарілості |
| `doc-files check [paths…]` | `lint-doc-files [paths…]` | 1 — є stale | повний (або точковий) детект, людиночитний вивід зі списком stale |
| — | `lint-doc-files --missing-only` | 1 | лише `missing`, без `crc-mismatch` |
| `doc-files check --hook` | `lint-doc-files --hook` | 2 — stale | PostToolUse: stdin JSON, один файл |
| `doc-files check --git [--max N]` | `lint-doc-files --git [--max N]` | 2 — stale | Stop-гейт: `git diff --name-only HEAD`; понад поріг (`N_CURSOR_DOC_FILES_GATE_MAX`, дефолт 50) — warn + exit 0 |
| `doc-files check --degraded` | `lint-doc-files --degraded` | 0 | інформаційний звіт про доки зі score < порогу |
| `doc-files gen [--limit/--from/--overwrite/--retry-degraded]` | `fix-doc-files [ті самі прапорці]` | 0/1 | local-only генерація за спекою 2026-06-10, omlx preflight, штамп CRC |
| `doc-files stamp` | `fix-doc-files --stamp` | 0/1 | детерміноване перештампування `source`+`crc` без LLM |

Обидві нові команди підтримують `--root <dir>` і, як і `doc-files` сьогодні,
належать до «`--root`-команд» (виконуються без синку правил). `fix-doc-files` зберігає
вимогу кореня основного дерева (`requireRoot`, не worktree).

### Блокування (канон scripts.mdc)

- **Повний `lint-doc-files`** — через `runStandardLint(import.meta.dirname, …)` у
  `rules/doc-files/lint/lint.mjs`: ключ `lint-doc-files`, дедуп успішних прогонів за fingerprint.
- **`--hook` / `--git`** — окрема експортна форма **без локу** (канон «інша експортна
  форма без локу»): це швидкі точкові перевірки в hook-протоколі, їм потрібен
  завжди-свіжий вердикт і мінімальна латентність.
- **`fix-doc-files`** — через `runStandardRule` з ключем `fix-doc-files`: серіалізується і між
  собою, і з generic-каналом `n-cursor fix doc-files` (спільний ключ — навмисно).

## 6. `lint-doc-files`: семантика детекту

1. **Кандидати** — як зараз у `docgen-scan.mjs`: розширення `.js .mjs .ts .vue .py .rs`;
   ігнор `node_modules`, `dist`, `.git`, `__pycache__`, `coverage`, `.cursor`, `.claude`,
   теки `docs/`, `*.test.*` / `*.spec.*` / `*.d.ts`; кореневий repo-`docs/` — system-wide only.
   Єдине джерело глобів — `docgen-ignore.mjs` (re-export для `doc-aggregate` зберігається).
2. **Порушення** — `missing` і `crc-mismatch`. Degraded не є порушенням (CRC свіжий,
   борг видно через `lint-doc-files --degraded`).
3. **Вивід** — список `джерело → очікувана дока [причина]`, у кінці підсумок
   `✗ stale: N (missing: M, crc-mismatch: K)`; `--json` — машиночитний масив.
4. **Без порога** у повному режимі: поріг `--max` — атрибут лише Stop-гейта (`--git`),
   CI має бути строгим.
5. **Quick-фаза агрегатора** (`rules/doc-files/js/lint.mjs`): отримує список змінених файлів;
   мапить їх на пари в обидва боки — змінене **джерело** → перевірка його доки,
   змінена/видалена **дока** (`*/docs/*.md`) → перевірка відповідного джерела.
   `lint-ci` (фаза ci = quick ∪ ci) проганяє повний скан.

## 7. `fix-doc-files`: семантика генерації

Без змін по суті — це перейменований `doc-files gen` (+ `--stamp` замість окремої
підкоманди). Конвеєр, якість, degraded-маркери, прапорці `--limit/--from/--overwrite/
--retry-degraded` — за чинною спекою `2026-06-10-doc-files-local-only-pipeline`.
Спека міграції конвеєр **не** чіпає.

## 8. GA workflow: `template/lint-doc-files.yml.snippet.yml`

```yaml
name: Lint Doc

on:
  push:
    branches:
      - dev
      - main
    paths:
      - '**/*.js'
      - '**/*.mjs'
      - '**/*.ts'
      - '**/*.vue'
      - '**/*.py'
      - '**/*.rs'
      - '**/docs/**'
  pull_request:
    branches:
      - dev
      - main

concurrency:
  group: ${{ github.ref }}-${{ github.workflow }}
  cancel-in-progress: true

jobs:
  doc:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false

      - uses: ./.github/actions/setup-bun-deps

      - name: Lint doc
        run: bun run lint-doc-files
```

Нотатки:

- `paths` на push перелічує **всі шість** розширень явно (`**/*.js` не матчить `.mjs`)
  плюс `**/docs/**` — щоб редагування/**видалення** доки теж тригерило прогін.
  `pull_request` — без paths-фільтра (як у `lint-text.yml`): PR перевіряється завжди.
- Жодного omlx/LLM/секретів: `bun run lint-doc-files` — чистий детермінований скан, секунди.
- `setup-bun-deps` — наявна composite action, синкається CLI як для решти lint-workflow.
- Rego `lint_doc_yml.rego` — дзеркало `text.lint_text`: суперсет-перевірки
  `name`/`on.push.branches`/`on.push.paths`/`on.pull_request.branches`/`runs-on`/
  `permissions`/`uses`/`run`-підрядків зі снапшота `--data template.snippet`;
  універсальні перевірки (checkout, persist-credentials) — успадковано
  з `ga.workflow_common`.

## 9. Інтеграційні точки

| Точка | Зміна |
| --- | --- |
| `npm/bin/n-cursor.js` | нові cases `lint-doc-files` / `fix-doc-files` (обидва `await`); case `doc-files` → делегат + deprecation-warn; оновити header-JSDoc, список очікуваних команд, what-is-хелпер |
| Рендерер секції CLAUDE.md (там само) | текст секції `## Файлова документація…` посилається на `lint-doc-files --hook` / `lint-doc-files --git` / `fix-doc-files` |
| `npm/scripts/sync-claude-config.mjs` | маркер → `'@nitra/cursor lint-doc-files'`; PostToolUse: `npx @nitra/cursor lint-doc-files --hook`; Stop: `npx @nitra/cursor lint-doc-files --git`; при merge видаляти/замінювати hook-рядки зі старим маркером `doc-files check` |
| `npm/skills/doc-aggregate/js/docgen-ignore.mjs` | re-export ignore-глобів вказує на `npm/rules/doc-files/js/docgen-ignore.mjs` |
| Кореневий `package.json` | `"lint-doc-files": "n-cursor lint-doc-files"`; ланцюжок `"lint"` += `bun run lint-doc-files &&` (першим, алфавітно) |
| `.n-cursor.json` цього репо | `rules` += `"doc"` (якщо список явний) |
| `AGENTS.md` | перегенерується синком автоматично (скрипти беруться з package.json) |
| `.github/workflows/lint-doc-files.yml` (цей репо) | створюється зі снапшота template |

## 10. Порядок міграції

1. **Крок 0 — зелена база.** `npx @nitra/cursor doc-files gen` до чистого стану:
   перший повний `lint-doc-files` у CI має стартувати зеленим (degraded допустимі).
2. **Крок 1 — переїзд коду.** `git mv npm/skills/doc-files/js npm/rules/doc-files/js`;
   створити `doc.mdc`, `meta.json`; поправити lazy-імпорти в `bin/n-cursor.js`
   і re-export у `doc-aggregate`; `fix-doc-files --stamp` — оновити `source:` у frontmatter
   перенесених док.
3. **Крок 2 — `lint-doc-files`.** `rules/doc-files/lint/lint.mjs` (`runLintDocCli` +
   безлокові hook-форми) поверх наявного `docgen-scan.mjs`; адаптер
   `rules/doc-files/js/lint.mjs`; cases у bin; аліаси `doc-files scan|check`.
4. **Крок 3 — `fix-doc-files`.** Обгортка над `runDocFilesGenCli`/`runDocFilesStampCli`
   (`runStandardRule`, ключ `fix-doc-files`); case у bin; аліаси `doc-files gen|stamp`.
5. **Крок 4 — policy.** `lint_doc_yml` + `package_json` (rego, target, template,
   `_test.rego`); прогнати `bun run lint-rego`.
6. **Крок 5 — hooks.** Оновити `sync-claude-config.mjs` (маркер, команди,
   заміна legacy-рядків); тести синку.
7. **Крок 6 — інтеграція цього репо.** package.json (скрипт + ланцюжок),
   `.github/workflows/lint-doc-files.yml`, `.n-cursor.json`, ресинк (AGENTS.md, hooks).
8. **Крок 7 — скіл.** Стоншити `npm/skills/doc-files/SKILL.md` (Крок 1:
   `npx @nitra/cursor fix-doc-files`; Крок 3: `npx @nitra/cursor lint-doc-files --git`);
   оновити рендерер CLAUDE.md-секції.
9. **Крок 8 — фінал.** `bun test` у `npm/`, один послідовний `bun run lint`;
   change-файли через `n-cursor change` (зміни в `npm/` → bump за n-changelog, minor).

## 11. Тести

- Наявні `js/tests/*` переїздять разом із кодом (шляхи відносні — без правок по суті).
- Нові: `rules/doc-files/lint/tests/lint.test.mjs` — exit-коди (1/2/0), `--json`,
  `--missing-only`, `--git` з порогом, мапінг доки→джерело у quick-адаптері.
- `lint_doc_yml_test.rego`, `package_json_test.rego` — позитив/негатив на снапшот.
- Селектор агрегатора: правило `doc` зʼявляється у quick-наборі (юніт на
  `selectLintRules`).
- Аліаси: `doc-files check --git` ≡ `lint-doc-files --git` (делегат, warn на stderr).

## 12. Сумісність і semver

- **Minor-реліз**: нові команди + делегувальні аліаси; plain `doc-files check`
  змінює exit 2→1 (через делегат) — зафіксувати у CHANGELOG. Hook-режими
  зберігають exit 2, тож **старі** засинкані `.claude/settings.json` (які ще
  кличуть `doc-files check --hook/--git`) працюють без змін до першого ресинку.
- **Major-реліз (наступний)**: видалення неймспейсу `doc-files` (hard error
  з підказкою на `lint-doc-files`/`fix-doc-files`).
- Env-змінні (`N_CURSOR_DOC_FILES_GATE_MAX`, `N_CURSOR_DOCGEN_MODEL`, …) —
  без перейменувань у цій міграції.

## 13. Поза скоупом

- `doc-aggregate` (агрегуюча документація) — не чіпається, окрім шляху re-export.
- **Orphan-доки** (дока є, джерело видалене/перейменоване) — не детектуються і
  зараз; кандидат на майбутнє розширення `lint-doc-files --orphans`.
- Конвеєр генерації, пороги якості, degraded-механіка — чинна спека 2026-06-10.
- Перейменування скіла `doc-files` → `doc` — не зараз (churn у засинканих
  проєктах); переглянути разом зі зняттям аліасів у major.

## 14. Відкриті питання

1. **Суворість CI:** workflow запускає повний `lint-doc-files` (missing + crc-mismatch) —
   рекомендовано, бо CRC-перевірка детермінована й безкоштовна, а Stop-гейт уже
   тримає актуальність в агентських задачах. Якщо для людських PR без локальної
   моделі це виявиться занадто жорстко — у template міняється один рядок на
   `bun run lint-doc-files -- --missing-only`, механізм не змінюється.
2. **Кореневий `lint`-ланцюжок:** додавати `lint-doc-files` одразу (рекомендовано: так —
   секунди, 0 токенів) чи лишити тільки CI-workflow і hook-гейти.
