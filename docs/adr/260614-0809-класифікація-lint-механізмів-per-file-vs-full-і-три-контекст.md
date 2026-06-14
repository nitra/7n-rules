---
session: 4b386ce5-70e3-4c5a-b5f6-bcdd5aef68ed
captured: 2026-06-14T08:09:29+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/4b386ce5-70e3-4c5a-b5f6-bcdd5aef68ed.jsonl
---

## ADR Класифікація lint-механізмів: per-file vs full і три контексти виконання

## Context and Problem Statement
Оркестратор `n-cursor lint` мав одну класифікацію `"quick"|"ci"`, яка змішувала дві незалежні характеристики: здатність детектора дробитися на змінені файли (per-file) та контекст виконання (локальний агент / CI). Потрібно стандартизувати, які механізми запускаються в яких контекстах і з якою базою diff.

## Considered Options
* Зберегти `"quick"|"ci"` і документувати поведінку описово (без формальної класифікації).
* Ввести дві ортогональні осі: `scope: "per-file"|"full"` (технічна здатність дробитися) + опційний `ci: "full"` (override для CI).

## Decision Outcome
Chosen option: "Дві ортогональні осі scope + ci", because технічний аудит коду кожного механізму показав, що `jscpd`, `knip`, `opa check` і `actionlint/zizmor` є крос-файловими за природою і не можуть коректно звужуватися до changed-set, тоді як `cspell`, `markdownlint-cli2`, `shellcheck`, `dotenv-linter`, `v8r` (text), `trufflehog` (security) — per-document і технічно допускають per-file режим.

Три контексти виконання (деривуються, не зберігаються окремо):
- **A · Локальний агент** — лише `scope==="per-file"` механізми → changed-vs-origin (без whole-tree).
- **B · CI** — всі механізми; `effectiveCi = rule.ci ?? rule.scope`; `security` → завжди `full`.
- **C · `--full`** — всі механізми, повний прогон.

Класифікація: `js-lint`, `style-lint`, `doc-files`, `text` → `"per-file"`; `security` → `{ scope: "per-file", ci: "full" }` (defense-in-depth у CI); `js-lint-ci` (jscpd + knip), `rego`, `ga` → `"full"`.

### Consequences
* Good, because transcript фіксує очікувану користь: локальний агент не запускає важкі крос-файлові механізми (`knip`, `jscpd`, `regal`, `actionlint`) — тільки швидкий per-file набір.
* Good, because `security` у CI лишається повним (defense-in-depth): новий секрет міг зʼявитися у файлі, що не змінився в поточному PR, але був присутній у базі до введення правила.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `docs/superpowers/specs/2026-06-14-lint-rule-consolidation.md` (§4 — таблиця класифікації, §5 — деривація контекстів, §9 — відкрите рішення про розкладку GA-workflow). Технічна база аудиту: `npm/rules/text/lint/lint.mjs`, `npm/rules/security/js/lint.mjs`, `npm/rules/js-lint-ci/js/lint.mjs`, `npm/rules/rego/`, `npm/rules/ga/`.

---

## ADR Схема meta.json:lint — {scope, ci} замість "quick"|"ci"

## Context and Problem Statement
Рядковий тип `"quick" | "ci"` у `meta.json` правил змішував дві різні речі: чи детектор декомпозується на per-file (технічна властивість) і в якому контексті він запускається (операційна властивість). Це унеможливлювало виразити ситуацію «per-file локально, але full у CI» без введення третього магічного значення.

## Considered Options
* Залишити `"quick"|"ci"` і задокументувати override через окремий конфіг-файл.
* Замінити на об'єктний тип `{ scope: "per-file" | "full", ci?: "full" }` з підтримкою шортката-рядка.

## Decision Outcome
Chosen option: "Об'єктний тип {scope, ci}", because це розділяє дві ортогональні осі в одному полі; шорткат-рядок (`"per-file"` ≡ `{scope:"per-file"}`, `"full"` ≡ `{scope:"full"}`) зберігає лаконічність для більшості правил без `ci`-override.

Міграція безпечна (hard-rename): `meta.json` не синкається у споживачів (`scripts.mdc`: «синк не копіює meta.json»), тож зовнішньої сумісності тримати не треба — усі значення мігрують в одному кроці.

### Consequences
* Good, because transcript фіксує очікувану користь: `security` отримує власне вираження `{scope:"per-file", ci:"full"}` без нового магічного значення.
* Bad, because валідатор `parseRuleLintPhase` у `npm/scripts/lib/rule-meta.mjs` і `checkLintField` у `npm/rules/npm-module/js/rule_meta.mjs` потребують оновлення для парсингу об'єктного варіанта — це неатомарна зміна.

## More Information
Файли: `npm/scripts/lib/rule-meta.mjs` (функція `parseRuleLintPhase`, рядок ~52), `npm/rules/npm-module/js/rule_meta.mjs` (функція `checkLintField`), `docs/superpowers/specs/2026-06-14-lint-rule-consolidation.md` (§6 «Схема meta.json:lint»).

---

## ADR База diff для per-file lint: HEAD → origin/main через resolveChangedBase

## Context and Problem Statement
Per-file lint-механізми (`collectChangedFiles`) рахували дельту відносно `HEAD` — тобто тільки незакомічені зміни. Вже закомічений, але не запушений код не перевірявся, і кожен механізм (lint-агрегатор, `coverage --changed`, `lint-doc-files`) мав власне розуміння «changed».

## Considered Options
* Залишити HEAD як базу для агрегатора, а origin-базу використовувати тільки для standalone-команд.
* Уніфікувати всі per-file механізми на `resolveChangedBase()` (`main` → `origin/main` → `null`) через наявний `npm/scripts/lib/changed-files.mjs`.

## Decision Outcome
Chosen option: "Уніфікувати на resolveChangedBase()", because мета — «лінти забезпечили вже перевірений код у новому пуші»: перевірка vs origin гарантує, що весь код, який піде в push, пройшов per-file детектори, а не лише незакомічені зміни.

### Consequences
* Good, because transcript фіксує очікувану користь: єдиний сенс «changed» скрізь — в агрегаторі `n-cursor lint`, у `lint-doc-files --git` і у `coverage --changed`.
* Good, because `resolveChangedBase()` вже реалізований з fail-closed на недосяжний base і вже використовується `coverage --changed` — патерн доведений на практиці.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/scripts/lib/changed-files.mjs` — функції `resolveChangedBase()` і `collectChangedFilesSince(base)`. Наразі `coverage --changed` вже споживає цей util; `lint`-агрегатор (`npm/scripts/lint-cli.mjs`) і `lint-doc-files` потребують аналогічного переходу (заплановано в `docs/superpowers/specs/2026-06-14-lint-rule-consolidation.md` §7).

---

## ADR doc-files: міграція скіл → правило npm/rules/ + тонкий скіл поверх

## Context and Problem Statement
Функціональність doc-files (детермінований детектор застарілості + LLM-генерація) повністю жила у `npm/skills/doc-files/` як агентський workflow. Це позбавляло її policy-каналу (GA-workflow, `package.json`-скрипт через rego), CI-енфорсу через `meta.json:lint`, і стандартної точки входу `fix.mjs` для оркестратора.

## Considered Options
* Залишити doc-files виключно скілом (без `npm/rules/doc/`).
* Створити правило `npm/rules/doc-files/` через `git mv js/` зі скіла + лишити тонкий скіл поверх правила.

## Decision Outcome
Chosen option: "Правило npm/rules/doc-files/ + тонкий скіл", because правило дає `meta.json:lint` (інтеграція в агрегатор `n-cursor lint`), `fix.mjs` (policy-канал через `runStandardRule`), та стандартні CLI-команди `lint-doc-files` / `fix-doc-files` з lock-ключами, виведеними зі шляху каталогу (`scripts.mdc` §«lock»).

Деталі реалізації: `git mv npm/skills/doc-files/js → npm/rules/doc-files/js` (та сама глибина `../../../` → імпорти незмінні). Нові команди: `lint-doc-files` (детектор, exit 1 якщо stale; режими `--json`/`--hook`/`--git`/`--missing-only`/`--degraded`), `fix-doc-files` (генерація + `--stamp`). `doc-files <sub>` — deprecated-аліас із deprecation warn. `meta.json`: `{auto:"завжди", lint:"quick"}`. Тонкий `SKILL.md` делегує на `fix-doc-files` і `lint-doc-files --git`.

### Consequences
* Good, because transcript фіксує очікувану користь: `lint-doc-files` інтегрований у кореневий `lint`-ланцюжок `package.json` і підхоплюється агрегатором `n-cursor lint quick`.
* Good, because lock-ключ `lint-doc-files` виводиться автоматично зі шляху каталогу — без ручного прописування.
* Bad, because до публікації нової версії пакета (авто-реліз `@nitra/cursor@5.4.0` після squash-merge) кореневий `n-cursor` у `node_modules` не знав команди `lint-doc-files` — `package.json`-скрипт тимчасово вказує на локальне джерело `bun npm/bin/n-cursor.js lint-doc-files`.

## More Information
Коміт: `6eba5b1a feat(doc-files): правило npm/rules/doc-files + lint-doc-files/fix-doc-files (squash)`. Файли: `npm/rules/doc-files/fix.mjs`, `npm/rules/doc-files/lint/lint.mjs`, `npm/rules/doc-files/js/lint.mjs`, `npm/rules/doc-files/meta.json`, `npm/skills/doc-files/SKILL.md`, `npm/.claude-template/settings.template.json` (hook-команди оновлено на `lint-doc-files --hook` / `lint-doc-files --git`), `npm/scripts/sync-claude-config.mjs` (константа `DOC_FILES_HOOK_COMMAND_MARKER` оновлена). Changeset: `npm/.changes/260614-0724.md` (bump: minor).
