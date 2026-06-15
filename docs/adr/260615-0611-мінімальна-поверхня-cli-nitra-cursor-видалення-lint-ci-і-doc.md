---
session: fce1d1c2-4217-4a3a-bb26-649747c9653b
captured: 2026-06-15T06:11:33+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/fce1d1c2-4217-4a3a-bb26-649747c9653b.jsonl
---

Тепер відповідь точна. `lint({ readOnly: false })` (дефолтний `n-cursor lint` без `--read-only`) вже зве `runDocFilesGenCli` — тобто **генерує** stale-доки. Тобто так, є перекриття з `fix-doc-files`.

## Фактична картина

| | `n-cursor lint` (fix-mode) | `n-cursor fix-doc-files` |
|---|---|---|
| Файли | **тільки змінені** (delta vs origin) | **весь репо** (без `--from`) або `--limit`/`--from` |
| Overwrite | CRC-mismatch тільки | `--overwrite` = примусово всі |
| Degraded | пропускає | `--retry-degraded` |
| Stamp | після gen | `--stamp` окремо |
| `--full` | і per-file, і full правила (але doc-files = per-file, тобто теж дельта) | N/A |

Тобто `fix-doc-files` — **не** дубль: він потрібен для **first-run** (ввести всі доки в репо), `--overwrite` (примусова регенерація), `--retry-degraded`. `lint` у fix-mode лише латає дельту від твоїх змін.

## Висновок щодо поверхні

Три doc-files команди → дві ролі, і вони **не** дублі:

- `lint` → локальна латка (дельта)
- `lint-doc-files` → hook-протокол
- `fix-doc-files` → bulk/overwrite/retry-degraded

Deprecated `doc-files <sub>` — єдиний мертвий аліас. Знести його?

---

## ADR Мінімальна поверхня CLI `@nitra/cursor`: видалення `lint-ci` і `doc-files`

## Context and Problem Statement
CLI `n-cursor` (`npm/bin/n-cursor.js`) накопичив дві надлишкові точки входу: `lint-ci` (чистий аліас `lint --read-only --full`) та `doc-files <sub>` (deprecated-аліас міграційного вікна без живих callerів). Паралельно заголовний коментар файлу і `npm/schemas/rule-meta.json` тримали застарілі значення (`fix`, enum `quick/ci`). Ціль — мінімальна поверхня CLI без breaking-change для реальних інтеграцій.

## Considered Options
* Видалити `lint-ci` як аліас і залишити два рівноцінних виклики: `lint` (fix-mode, дельта) і `lint --read-only --full` (CI)
* Злити doc-files-виклики у флаг `--doc-files` до `lint`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Видалити `lint-ci` і `doc-files <sub>`; виправити стейл-прозу і схему", because `lint-ci` не мав жодного живого callera поза docstrings (підтверджено grep по `.github`, `package.json`, скілах), а `doc-files <sub>` позначений deprecated після міграції до `lint-doc-files`/`fix-doc-files`. Варіант `--doc-files` флагу відхилено: doc-files вже є lint-правилом (`meta.json: lint: per-file`), і оркестратор `runLint` уже викликає його в scan-фазі; додатковий флаг дублював би наявний механізм і спеціалькейсив одне правило.

### Consequences
* Good, because transcript фіксує очікувану користь: зменшується кількість точок входу CLI з 5 до 3 (`lint`, `lint-doc-files`, `fix-doc-files`), усувається мертва поверхня.
* Bad, because видалення `lint-ci` — технічно breaking для зовнішніх скриптів, що зверталися безпосередньо до цього аліасу; transcript не містить підтверджених негативних наслідків для реальних інтеграцій (grep не знайшов callerів).

## More Information
- `npm/bin/n-cursor.js`: видалено `case 'lint-ci'`, оновлено шапку (`fix`, `lint-ci`), `default`-перелік.
- `npm/schemas/rule-meta.json`: enum `["quick","ci"]` → `["per-file","full"]`.
- `npm/rules/js-lint-ci/js-lint-ci.mdc`: замінено `lint-ci` → `lint --full` / `lint --read-only --full`.
- `npm/rules/doc-files/js/lint.mjs:17-32`: підтверджено, що `lint({ readOnly: false })` зве `runDocFilesGenCli` (fix-mode дельта), тому `fix-doc-files` — не дубль (bulk/overwrite/retry-degraded).
- Перевірено: `node --check npm/bin/n-cursor.js` OK; `vitest run` orchestrate.test.mjs — 6/6 passed.
