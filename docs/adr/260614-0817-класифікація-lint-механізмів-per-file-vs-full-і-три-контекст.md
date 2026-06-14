---
session: 4b386ce5-70e3-4c5a-b5f6-bcdd5aef68ed
captured: 2026-06-14T08:17:52+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/4b386ce5-70e3-4c5a-b5f6-bcdd5aef68ed.jsonl
---

## ADR Класифікація lint-механізмів: per-file vs full і три контексти запуску

## Context and Problem Statement
У репо існує кілька незалежних lint-механізмів (`js-lint`, `style-lint`, `doc-files`, `text`, `security`, `js-lint-ci`, `rego`, `ga`), кожен із різною здатністю до декомпозиції на окремі файли. Виникла потреба чітко стандартизувати, які механізми запускаються в якому контексті (локальний агент, CI, повний аудит), щоб агент не гальмував роботу whole-tree-перевірками, а CI не пропускав критичних перевірок.

## Considered Options
* Всі механізми завжди повним прогоном
* `security` — per-file у всіх контекстах (однаково з іншими per-file-здатними)
* Три контексти: A (агент — лише per-file), B (CI — per-file де можна + full де треба, `security` завжди full), C (`--full` — все повністю)

## Decision Outcome
Chosen option: "Три контексти виконання з `security` full у CI", because користувач явно продиктував: «все що можна per-file — робимо, але security в GA запускається тільки повним завжди» (defense-in-depth), а крос-файлові механізми (`jscpd`/`knip`, `rego`, `ga`) технічно не дробляться.

Фінальна матриця:
| Механізм | scope | CI-режим |
|---|---|---|
| `js-lint`, `style-lint`, `doc-files`, `text` | per-file | per-file |
| `security` | per-file | **full** |
| `js-lint-ci` (jscpd+knip), `rego`, `ga` | full | full |

### Consequences
* Good, because локальний агент запускає лише швидкі per-file-перевірки і не блокує workflow whole-tree-прогонами.
* Bad, because `security` — єдиний механізм із подвійним режимом залежно від контексту, що ускладнює читання `meta.json`.

## More Information
Класифікація зафіксована у спеці `docs/superpowers/specs/2026-06-14-lint-rule-consolidation.md` (§4, §5). Три контексти деривуються через `meta.json:lint.ci` без окремих runtime-полів.

---

## ADR meta.json:lint — схема `{scope, ci}` замість рядка `"quick"|"ci"`

## Context and Problem Statement
Існуючий рядок `"lint": "quick"|"ci"` у `meta.json` правил змішував дві ортогональні осі: здатність детектора до декомпозиції на файли (`scope`) і режим запуску в CI (`ci`). Після рішення про три контексти (ADR вище) стало неможливо закодувати `security` (`per-file` локально, але `full` у CI) одним рядком.

## Considered Options
* Лишити `"quick"|"ci"` і додати окремий `"ci-override"` рядок
* Замінити на об'єкт `{scope: "per-file"|"full", ci?: "full"}` зі шорткатами

## Decision Outcome
Chosen option: "Об'єкт `{scope, ci}` зі шорткатами", because він явно розділяє дві осі й дозволяє `security` отримати `{scope:"per-file", ci:"full"}`. Шорткати `"per-file"` ≡ `{scope:"per-file"}` і `"full"` ≡ `{scope:"full"}` мінімізують зміни у файлах правил без такого split-режиму.

### Consequences
* Good, because transcript фіксує очікувану користь: валідатор `parseRuleLintPhase` і `rule_meta.mjs:checkLintField` вчать парсити новий формат; міграція — безпечний hard-rename (meta.json не синкається у споживачів за `scripts.mdc`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Деталі схеми — `docs/superpowers/specs/2026-06-14-lint-rule-consolidation.md` §3. Валідація: `npm/scripts/lib/rule-meta.mjs` (`parseRuleLintPhase`), `npm/rules/npm-module/js/rule_meta.mjs`.

---

## ADR doc-files — міграція скіл→правило з тонким скілом поверх

## Context and Problem Statement
Код генератора файлової документації (`docgen-scan`, `docgen-files-batch`, тощо) жив у `npm/skills/doc-files/js/`. Задача — перейменувати правило на `doc-files` і зробити CLI-команди `lint-doc-files` (детектор) та `fix-doc-files` (генератор). У transcript спочатку була неоднозначність між «правилом» і «скілом».

## Considered Options
* Весь `doc-files` — лише скіл (без правила, без policy-каналу)
* Правило `npm/rules/doc-files/` з тонким скілом `npm/skills/doc-files/SKILL.md` поверх

## Decision Outcome
Chosen option: "Правило `npm/rules/doc-files/` + тонкий скіл", because користувач явно підтвердив: «перейменувати правило на `doc-files` і лишити тонкий скіл». Детектори лишаються у своїх каталогах; `lint` = правило-оркестратор + контракт класифікації.

Реалізовано:
- `git mv npm/skills/doc-files/js → npm/rules/doc-files/js` (глибина збережена — `../../../` імпорти не змінились)
- Новий скафолд: `meta.json` (`auto:"завжди"`, `lint:"quick"`), `doc-files.mdc`, `fix.mjs`, `lint/lint.mjs`, `js/lint.mjs`
- Команди у `npm/bin/n-cursor.js`: `lint-doc-files` (exit 1/2/0, `--json`/`--hook`/`--git`/`--missing-only`), `fix-doc-files` (gen + `--stamp`), `doc-files <sub>` (deprecated alias із warn)
- Hook-маркер у `sync-claude-config.mjs`: `@nitra/cursor lint-doc-files`
- Тонкий `SKILL.md` оновлено на нові команди; `doc-aggregate/js/docgen-ignore.mjs` перенаправлено

### Consequences
* Good, because правило отримує policy-канал (rego, GA-workflow), lint-агрегатор через `js/lint.mjs` і стандартний контракт `fix.mjs`; тонкий скіл лишається для агентського workflow.
* Bad, because rego-policy і сам `.github/workflows/lint-doc-files.yml` свідомо відкладені — розкладка GA є відкритим рішенням у consolidation-спеці.

## More Information
Зафіксовано у `npm/.changes/260614-0724.md` (minor bump → авто-реліз `@nitra/cursor@5.4.0`). Правило перелічено у `.n-cursor.json`. Баг під час міграції: `*/` у JSDoc `js/lint.mjs` передчасно закривав коментар — виправлено до мержу. Тести: `npm/rules/doc-files/js/tests/lint.test.mjs`, `npm/rules/doc-files/lint/tests/lint.test.mjs` (10/10). Squash-комміт: `6eba5b1a`.

---

## ADR `N_LOCAL_MIN_MODEL` як канонічний env для локальної omlx-моделі

## Context and Problem Statement
`fix-doc-files` (генератор docgen) викликає локальний omlx-сервер. Дефолтна модель у пакеті — `mlx-community--gemma-4-e2b-it-4bit` — не збігалася з іменем, яке віддає omlx-сервер (`gemma-4-e2b-it-4bit` без HF-org-префікса). Пакет має docgen-специфічний env `N_CURSOR_DOCGEN_MODEL`; потрібно було знайти **універсальний** env для всіх скілів.

## Considered Options
* Лишити `N_CURSOR_DOCGEN_MODEL` (docgen-специфічний)
* Self-heal у пакеті: при «model not found» зрізати `<org>--` префікс
* Використати існуючий `N_LOCAL_MIN_MODEL` — universal тир-системи `resolveModel('min')`

## Decision Outcome
Chosen option: "`N_LOCAL_MIN_MODEL` у `~/.zshenv`", because пакет уже має `resolveModel('min')` → `N_LOCAL_MIN_MODEL || N_LOCAL_AVG_MODEL || …`; docgen читає `N_CURSOR_DOCGEN_MODEL ?? resolveModel('min')`, тобто `N_LOCAL_MIN_MODEL` застосовується автоматично. Це єдина точка конфігурації для всіх скілів, без зміни пакета.

Встановлено: `export N_LOCAL_MIN_MODEL=omlx/gemma-4-e2b-it-4bit` у `~/.zshenv`. Модель `gemma-4-e4b-it-OptiQ-4bit` (первісний вибір) не підходить на 16GB Mac: потребує 13.07GB, ceiling omlx = 11.84GB.

### Consequences
* Good, because transcript фіксує: генерація `fix-doc-files` без env-префікса в команді — ✓ score=100; env підхоплює свіжий non-interactive zsh.
* Bad, because дефолт у пакеті (`mlx-community--gemma-4-e2b-it-4bit`) залишився сталим — лікується окремо (self-heal #1, не реалізовано в цій сесії).

## More Information
`npm/lib/models.mjs` — `resolveModel`, `LOCAL_MIN`. Файл: `~/.zshenv` (sourced будь-яким zsh, зокрема Bash-інструментом агента). Оновлено пам'ять `docgen-omlx-model-local` — тир-канон `N_LOCAL_MIN_MODEL`, не `N_CURSOR_DOCGEN_MODEL`.
