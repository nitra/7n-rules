---
session: ad2778ec-2972-4dc6-84de-95c0327ff501
captured: 2026-05-24T06:34:47+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/ad2778ec-2972-4dc6-84de-95c0327ff501.jsonl
---

Чисто. План оновлено.

**Ключова зміна:** всі `<rule>/tests/`, `<rule>/templates/`, `<rule>/data/` → `<rule>/js/tests/`, `<rule>/js/templates/`, `<rule>/js/data/`. Усе JS-related живе під `js/` — симетрія з `policy/` де rego-тести вже лежать поряд з реалізацією.

Discovery-логіка ще спростилась: `if (!entry.isFile()) continue` достатньо, щоб ігнорувати `tests/`, `_lib/`, `templates/`, `data/` — жодного regex або `_`-prefix check для каталогів.

Готовий до виконання. Який варіант: **Subagent-Driven** чи **Inline Execution**?

---

## ADR Flat-концерн JS-лейаут у `@nitra/cursor`

## Context and Problem Statement
Правила `@nitra/cursor` мали JS-концерни у вигляді каталогів `rules/<rule>/js/<concern>/check.mjs` з helpers, tests, templates і data-файлами поряд. Така структура ускладнювала `listJsConcerns` (regex `check-*.mjs`) і розмивала межу між «концерном» і «каталогом артефактів».

## Considered Options
* Flat: концерн = файл `js/<concern>.mjs`; підпапки всередині `js/` (`utils/`, `tests/`, `templates/`, `data/`)
* Частковий flat: тільки concerns без helpers залишаються плоскими; concerns із helpers — підкаталог
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Flat скрізь: концерн = файл `js/<concern>.mjs`", because це спрощує discovery до `readdir + isFile()`, узгоджується з конвенцією `policy/<concern>_test.rego` і усуває потребу в regex `check-*.mjs`. Часткова варіація відхилена — ускладнює правило без користі.

Уточнення (user-driven):
- Тести, templates і data — всередині `js/` (`js/tests/`, `js/templates/`, `js/data/`), не на рівні правила.
- Helpers: `js/utils/<concern>/` (без underscore — конвенція `abie/utils/`); shared rule-level utils (`abie/utils/`) → `js/utils/` (плоско, без concern-підкаталогу).
- Тести з fixtures: `js/tests/<concern>/<concern>.test.mjs` + `js/tests/<concern>/fixtures/`; без fixtures: `js/tests/<concern>.test.mjs`.

### Consequences
* Good, because `listJsConcerns` скорочується до `entry.isFile() && entry.name.endsWith('.mjs')` — підкаталоги (`utils/`, `tests/`, `templates/`, `data/`) ігноруються автоматично; вже реалізовано у коміті `ad1bb4a`.
* Good, because тести живуть у `js/tests/` симетрично до `policy/<concern>_test.rego`, відносні import-шляхи коротші.
* Good, because `utils/` (без underscore) відповідає наявній конвенції `abie/utils/` і `npm/scripts/utils/`.
* Bad, because BREAKING зміна для зовнішніх інтеграторів з власними правилами та `js/<concern>/check.mjs` — потрібен ручний `git mv`.
* Bad, because міграція охоплює 34 concern-файли, 13 helpers, 8 `abie/utils/` і 17 тест-файлів — ризик помилок у відносних imports.

## More Information
- Plan: `docs/superpowers/plans/2026-05-23-flat-concern-layout.md`
- Discovery: `npm/scripts/utils/discover-checkable-rules.mjs` → `listJsConcerns` (оновлено у `ad1bb4a`)
- Runner: `npm/scripts/utils/run-rule.mjs`
- Canon layout:
  ```
  js/<concern>.mjs
  js/utils/<shared>.mjs
  js/utils/<concern>/<helper>.mjs
  js/tests/<concern>.test.mjs
  js/tests/<concern>/<concern>.test.mjs + fixtures/
  js/templates/<concern>/
  js/data/<concern>/
  ```
- Version bump: `1.13.89` → `1.14.0` (BREAKING для зовнішніх споживачів шляхів файлів)
