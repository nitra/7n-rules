---
session: 4b386ce5-70e3-4c5a-b5f6-bcdd5aef68ed
captured: 2026-06-14T08:00:40+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/4b386ce5-70e3-4c5a-b5f6-bcdd5aef68ed.jsonl
---

The `workflow` system-reminder was triggered by "workflow" appearing in the transcript content (GitHub Actions references), not as an actual request to run multi-agent orchestration. I'll produce the ADR output directly.

---

## ADR `lint-doc-files` дефолтний scope — changed-vs-origin замість full

## Context and Problem Statement
Команда `lint-doc-files` (детектор застарілості файлових dok) мала дефолтний повний скан. Локальні агенти та CI потребували швидкого режиму, що перевіряє лише змінені файли, щоб «лінти забезпечили вже перевірений код у новому пуші», а не повторно сканували весь репо.

## Considered Options
* Дефолт = full scan; явний флаг для дельти (попередній стан)
* Дефолт = changed-vs-origin (`git diff --name-only --merge-base <base>`); `--full` для повного прогону

## Decision Outcome
Chosen option: "Дефолт = changed-vs-origin; `--full` як явний флаг", because користувач сформулював вимогу прямо: «lint-doc буде за замовчуванням тільки по різниці з origin, а lint-doc --full це повний прогон». Це покриває і локального агента (некомітнуті зміни входять через merge-base vs робоче дерево), і CI (дельта PR-коміту), одним семантичним примітивом.

### Consequences
* Good, because локальний агент і CI кличуть одну команду без прапорів, база (origin/main або `@{upstream}`) резолвиться автоматично.
* Good, because повний скан (`--full`) — явний, не випадковий; transcript фіксує очікувану користь: «забезпечити вже перевірений код у новому пуші».
* Bad, because якщо `@{upstream}` не резолвиться (detached HEAD, гілка не пушена) — дефолт падає на `--full` (fail-closed); transcript фіксує це як свідомий trade-off, а не помилку.

## More Information
Реалізація: `npm/rules/doc-files/lint/lint.mjs` — режими `(default)` → `collectChangedFilesSince(resolveChangedBase())` і `--full` → повний скан. Утиліти `resolveChangedBase` / `collectChangedFilesSince` — `npm/scripts/lib/changed-files.mjs` (вже існували, перевикористані). Таблиця команд у `npm/rules/doc-files/doc-files.mdc` §5, spec `docs/superpowers/specs/2026-06-14-lint-rule-consolidation.md` §6.

---

## ADR Класифікація lint-механізмів: per-file vs whole-tree у `meta.json:lint`

## Context and Problem Statement
Репо має вісім lint-механізмів з різною природою: одні перевіряють файли незалежно, інші потребують повного графа репо. Поле `meta.json:lint` мало лише рядки `"quick"|"ci"`, які змішували «здатність дробитися» та «контекст виконання» в одному значенні — що не дозволяло оркестратору автоматично обрати правильний режим.

## Considered Options
* Лишити `"quick"|"ci"` (попередній стан)
* Нова схема `{scope: "per-file"|"full", ci?: "full"}` з шорткатами-рядками

## Decision Outcome
Chosen option: "Нова схема `{scope, ci}`", because потрібно розділити дві ортогональні осі: чи детектор декомпозується (scope) і який режим у CI (ci-override). Це дозволяє оркестратору у контексті A (агент) брати лише `scope === "per-file"`, у контексті B (CI) — `effectiveCi = rule.ci ?? rule.scope`, без нових полів у CLI.

Класифікація механізмів зафіксована в transcript:

| Правило | `lint` у `meta.json` | Причина |
|---|---|---|
| `js-lint`, `style-lint`, `doc-files`, `text` | `"per-file"` | per-document детект |
| `security` | `{scope:"per-file", ci:"full"}` | per-file локально, full у CI |
| `js-lint-ci` (jscpd+knip), `rego`, `ga` | `"full"` | крос-файловий аналіз |

### Consequences
* Good, because три контексти виконання (агент, CI, `--full`) деривуються з двох полів без окремих прапорів у кожному правилі.
* Good, because transcript фіксує очікувану користь: `knip` і `jscpd` явно не дробляться (граф залежностей, порівняння між файлами), `rego` — крос-модульна компіляція.
* Bad, because hard-rename `"quick"|"ci"` → нова схема потребує одноразової міграції всіх `meta.json`; transcript не містить підтверджених негативних наслідків крім обсягу роботи.

## More Information
Валідатор: `npm/rules/npm-module/js/rule_meta.mjs` → `parseRuleLintPhase` потребує оновлення під новий формат. Канонічна схема в `docs/superpowers/specs/2026-06-14-lint-rule-consolidation.md` §4–5. Нове правило-оркестратор: `npm/rules/lint/` (в spec §3-E, §7).

---

## ADR `security` scan: per-file локально, завжди `--full` у CI

## Context and Problem Statement
`trufflehog filesystem .` технічно приймає конкретні шляхи (per-file здатний), але secret-scan традиційно проводиться над усім деревом. Після введення per-file дефолту для lint-механізмів потрібно було визначити режим для `security` у CI та локально.

## Considered Options
* `security` → `"per-file"` у всіх контекстах
* `security` → `"full"` у всіх контекстах
* `security` → `{scope:"per-file", ci:"full"}` (різний режим залежно від контексту)

## Decision Outcome
Chosen option: "`{scope:\"per-file\", ci:\"full\"}`", because користувач сказав «все що можна зробити per file робимо», але водночас «security запускається тільки повний завжди» в контексті CI. Це зберігає швидкість для локального агента (лише нові/змінені файли) і гарантію defense-in-depth у CI.

### Consequences
* Good, because локальний агент не чекає повного trufflehog-скану по всьому репо при кожній зміні файлу.
* Good, because CI завжди гарантує повну перевірку, незалежно від бази гілки.
* Neutral, because transcript не містить підтвердження наслідку щодо ймовірності пропуску секрету при per-file скані локально.

## More Information
`meta.json` правила `security`: `{"lint": {"scope": "per-file", "ci": "full"}}`. Оркестратор у контексті CI: `effectiveCi = rule.ci ?? rule.scope` → `"full"`. Spec `docs/superpowers/specs/2026-06-14-lint-rule-consolidation.md` §4.

---

## ADR `doc-files`: міграція `npm/skills/doc-files` → `npm/rules/doc-files` із тонким скілом

## Context and Problem Statement
Код генерації та детекції doc-files жив у `npm/skills/doc-files/js/`. Скіли в цьому репо — агентські workflow (SKILL.md), а не policy-канал (fix.mjs → rego → GA). Без правила `doc-files` детектор не мав: policy-каналу для GA-workflow, скрипту у package.json lint-chain, записи у `.n-cursor.json`, хука PostToolUse через стандартний sync-claude-config.

## Considered Options
* Лишити скіл, додати окреме правило `doc` (короткі команди `lint-doc`/`fix-doc`)
* Перейменувати правило на `doc-files`, лишити тонкий скіл (`SKILL.md` без `js/`)
* Злити всі файли в один каталог `npm/rules/doc-files/`

## Decision Outcome
Chosen option: "Перейменувати правило на `doc-files`, лишити тонкий скіл", because користувач підтвердив: «перейменувати правило на `doc-files` і лишити тонкий скіл». Фізичне злиття директорій відхилено асистентом (порушує `scripts.mdc` «одне правило — один каталог»), і користувач не заперечив цьому уточненню.

### Consequences
* Good, because `git mv npm/skills/doc-files/js → npm/rules/doc-files/js` (та сама глибина → `../../../` імпорти без змін); усі 83 тести пройшли без правок після mv.
* Good, because transcript фіксує очікувану користь: policy-канал (fix.mjs → runStandardRule), хук `lint-doc-files --hook`, запис у `.n-cursor.json`, script `lint-doc-files` у кореневому `bun run lint`.
* Bad, because команди `doc-files check/gen/stamp` стали deprecated-aliases з warn; потребує оновлення всіх зовнішніх посилань — `SKILL.md`, `doc-aggregate/SKILL.md`, `settings.template.json`, `sync-claude-config.mjs` маркер.

## More Information
Ключові файли: `npm/rules/doc-files/fix.mjs`, `npm/rules/doc-files/lint/lint.mjs` (`runLintDocFilesCli`), `npm/rules/doc-files/js/lint.mjs` (адаптер агрегатора, both-direction mapping). Маркер хука: `export const DOC_FILES_HOOK_COMMAND_MARKER = '@nitra/cursor lint-doc-files'` у `npm/scripts/sync-claude-config.mjs:36`. Changeset: `npm/.changes/260614-0724.md` (minor). Реліз: `@nitra/cursor@5.4.0` (e2732640) — авто-бамп після push.
