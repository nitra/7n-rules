---
session: fce1d1c2-4217-4a3a-bb26-649747c9653b
captured: 2026-06-15T13:09:34+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/fce1d1c2-4217-4a3a-bb26-649747c9653b.jsonl
---

Changeset вже створений зовнішнім агентом. Переходжу до написання ADR-документів за transcript.

---

## ADR Видалення надлишкових CLI-точок `lint-ci` та `doc-files <sub>`

## Context and Problem Statement
У `npm/bin/n-cursor.js` існував `case 'lint-ci'` — чистий аліас для `runLint({ full: true, readOnly: true })` — і deprecated `case 'doc-files'` (підкоманди `scan|check|gen|stamp`), що мав 0 живих callerів після міграції на `lint-doc-files`/`fix-doc-files`. Обидва збільшували поверхню без функціональної цінності. Ціль сесії — «мінімальна поверхня».

## Considered Options
* Видалити обидва аліаси (breaking → major bump)
* Залишити `lint-ci` для зворотної сумісності
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Видалити обидві CLI-точки", because `lint-ci` — точний дублікат `lint --read-only --full` (CI лишається тим самим прапор-комбо), а `doc-files <sub>` мав 0 живих callerів: hook-маркер, скіл і root-`package.json` вже використовують `lint-doc-files`/`fix-doc-files` безпосередньо.

### Consequences
* Good, because transcript фіксує очікувану користь: усунуто 2 надлишкові точки входу, шапка `n-cursor.js` і помилка `default` тепер відображають реальний стан; `rule-meta.json` enum оновлено з `quick|ci` → `per-file|full` (відповідає `parseRuleLintSpec`).
* Bad, because видалення `lint-ci` є breaking change → changeset `260615-0638.md` (`bump: major`). Сторонні репо, що безпосередньо кличуть `n-cursor lint-ci`, мусять оновитись на `n-cursor lint --read-only --full`.

## More Information
Змінено: `npm/bin/n-cursor.js` (`case 'lint-ci'`, `case 'doc-files'`, шапка, `default`-помилка, ROOT_GUARDED-коментар); `npm/schemas/rule-meta.json` (enum); `npm/rules/js-lint-ci/js-lint-ci.mdc` (посилання `lint-ci` → `lint --full`). Changeset: `.changes/260615-0638.md`. Перевірено: `node --check` + `vitest` оркестратора lint (6/6).

---

## ADR Opportunistic LLM-fix tier у lint-кроці doc-files

## Context and Problem Statement
Lint-крок правила `doc-files` (`npm/rules/doc-files/js/lint.mjs`) детектував застарілість документації та виводив `→ перегенеруй: npx @nitra/cursor fix-doc-files`, але нічого не виправляв навіть у fix-by-default режимі. Це порушувало симетрію з іншими правилами (oxlint `--fix`, конформність-конвергенція). Водночас генерація потребує локальної LLM (omlx) і не може зламати детермінований `--read-only`/CI контракт.

## Considered Options
* Додати opportunistic-генерацію у lint-крок: omlx up → генерує, omlx down → skip + exit 1 (гейт тримається)
* Додати `--doc-files` прапор до головного `lint` (відкинуто: дублює наявний per-file адаптер, спеціалькейсить одне правило)
* Залишити lint-крок detect-only (статус-кво)

## Decision Outcome
Chosen option: "Додати opportunistic-генерацію у lint-крок", because це унітарно: всі lint-правила в fix-by-default mode вже намагаються виправити; doc-files не порушував контракт `readOnly` (він нічого не мутував і без прапора), тому opportunistic-fix не порушує CI-інваріант (`readOnly: true` → лише детект).

### Consequences
* Good, because transcript фіксує очікувану користь: контракт `readOnly`/fix-by-default узгоджений між doc-files і рештою правил; 131/131 тестів проходять; `meta.json: llmFix: true` додає explicit opt-in для оркестратора.
* Bad, because lint-крок стає side-effecting (lazy-import генерації). `vi.fn`+`mockReset` quirk із замоканим dynamic-import у тестах потребував стабільного wrapper'а з мутабельним `state.impl`.

## More Information
Змінено: `npm/rules/doc-files/js/lint.mjs` (нова async `lint(files, cwd, {readOnly})`); `npm/rules/doc-files/js/docgen-files-batch.mjs` (витяг `runGenerationBatch` + export `preflightProblem`); `npm/rules/doc-files/meta.json` (`llmFix: true`); `npm/schemas/rule-meta.json` (нова властивість `llmFix`); `npm/rules/doc-files/js/tests/lint.test.mjs` (переписано: detect-тести на `{readOnly:true}`, gating-тести omlx-up/down). Спека: `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md`. Changeset: `.changes/260615-0907.md`.

---

## ADR Заміна cspell whole-file rewrite на classify→dict-suggest

## Context and Problem Statement
Наявний `npm/rules/text/lint/cspell-fix.mjs` у fix-режимі передавав весь вміст файлу до LLM (`llmLintFix` whole-file rewrite) і очікував виправлений файл назад. На реальних файлах репо це призводило до timeout 120 с (curl exit 28) та parse-fail на файлах ≥6k токенів. Емпірично ~90% «Unknown word» знахідок cspell на проєкті — валідні українські слова або тех-терміни (не одруки), тому реальний ремедіейшн — поповнення словника, а не LLM-патч.

## Considered Options
* Замінити на bounded classify-виклик (≤80 унікальних слів → JSON verdict) + авто-дописування `valid`-слів у `.cspell.json`; одруки — список на рев'ю без авто-застосування (вибрано)
* Залишити whole-file rewrite з вищим timeout
* Прибрати LLM з cspell повністю (detect-only)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Bounded classify + dict-suggest", because whole-file output є unbounded (зростає з розміром файлу → timeout неминучий); справжній ремедіейшн для цього репо — словник; один classify-виклик на ≤80 слів bounded за визначенням і не мутує джерельні файли.

### Consequences
* Good, because transcript фіксує вимірювані результати: ~2–5 с замість 15–30 хв (timeout); 79 валідних слів у `.cspell.json` за один прогін; один одрук (`stry → try`) виловлений коректно; 0 мутацій джерельних файлів; 4/4 тести + 0 eslint-errors.
* Bad, because classify-виклик може помилитися (у тесті `аутейдж` → `аудит` = хибна класифікація), тому авто-застосування typo-fix залишено на рев'ю, а не авто. Це зниження автоматизму порівняно з оригінальним задумом whole-file fix.

## More Information
Змінено: `npm/rules/text/lint/cspell-fix.mjs` (нова функція `unknownWords`, `appendWordsToDict`, `classifyPrompt`, `runCspellText`; видалено `groupFindingsByFile` + `llmLintFix`); `npm/rules/text/lint/tests/cspell-fix.test.mjs` (4 тести). Словник: `.cspell.json` (поле `words`, sorted+dedup). Boundedness: classify output ≤ 80×30 ≈ 2400 токенів. Changeset: `.changes/260615-1308.md`.
