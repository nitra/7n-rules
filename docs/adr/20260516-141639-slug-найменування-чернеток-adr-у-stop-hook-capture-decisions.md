---
session: e513a1f0-c8b8-4eec-a745-63768ffe456b
captured: 2026-05-16T14:16:39+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/e513a1f0-c8b8-4eec-a745-63768ffe456b.jsonl
---

## ADR: Slug-найменування чернеток ADR у Stop-hook capture-decisions.sh
**Контекст:** Чернетки ADR створювалися з іменами `<timestamp>-<session-hash[0:8]>.md`, що унеможливлювало навігацію по темі у IDE та git history; нормалізатор витрачав LLM-виклик на rename-операції кожного файла.
**Рішення/Процедура/Факт:** У `npm/.claude-template/hooks/capture-decisions.sh` та `.claude/hooks/capture-decisions.sh` (рядки ~147-176) після отримання LLM-відповіді — `awk` витягує перший `## [ADR|Runbook|Knowledge] <heading>`, `tr`/`sed` будує kebab-slug (дозволені `a-z`, `а-яіїєґ`, `0-9`, `-`, truncate 60 символів). Формат файла: `<YYYYMMDD-HHMMSS>-<slug>.md`. Колізії — суфікс `-2`, `-3`. Fallback до `<TS>-<session-id[0:8]>.md` якщо heading не розпізнано.
**Обґрунтування:** LLM-відповідь уже містить читабельний heading (частина існуючого промпта) — додатковий виклик не потрібен. Timestamp prefix гарантує унікальність між різними сесіями з однаковою темою. Нормалізатор тепер займається лише `delete`/`merge-into`, rename-операції стають рідкісними.
**Розглянуті альтернативи:** 1) Тільки slug без timestamp (чистіше, але ризик колізій між сесіями). 2) Окремий LLM-виклик для нормалізації slug одразу (дорожче, затримує Stop-hook). 3) Залишити session-hash (без змін, статус-кво).
**Зачіпає:** `npm/.claude-template/hooks/capture-decisions.sh`, `.claude/hooks/capture-decisions.sh`, `docs/adr/` (формат нових файлів). Версія: 1.11.15.

## ADR: Видалення lint-conftest як дублюючого каналу перевірки Rego policy
**Контекст:** `npm/scripts/lint-conftest.mjs` дублював функціональність `npx @nitra/cursor check` — обидва ітерували policy-концерни через `conftest`; наявність окремого скрипта створювала дві точки входу для одного й того самого та заплутувала документацію.
**Рішення/Процедура/Факт:** `npm/scripts/lint-conftest.mjs` видалено. З кореневого `package.json` прибрано скрипт `lint-conftest` і його ланку з `lint`-chain. У `.cursor/rules/conftest.mdc`, `scripts.mdc`, `abie.mdc` та 17 `check.mjs`/`.rego` файлах посилання `bun run lint-conftest` → `npx @nitra/cursor check`. Conditional rego без `target.json` (tauri, graphql) переформульовано як «не auto-discoverable». Версія: 1.11.11.
**Обґрунтування:** `npx @nitra/cursor check` вже є єдиним auto-discovery каналом через `discoverCheckableRules` (за наявністю `target.json`). Дублювання порушувало принцип єдиного джерела правди й змушувало підтримувати TARGETS-реєстр паралельно до файлової системи.
**Розглянуті альтернативи:** Не обговорювалися — рішення надійшло від користувача як вимога усунути дублювання.
**Зачіпає:** `npm/scripts/lint-conftest.mjs` (видалено), кореневий `package.json`, `.cursor/rules/conftest.mdc`, `scripts.mdc`, `npm/rules/abie/abie.mdc`, 10 `fix/<concern>/check.mjs`, 7 `policy/**/*.rego`.

## ADR: Фаза 3 — прибирання legacy `js/` з інфраструктури discover/run-rule
**Контекст:** Після завершення Фази 2 (переміщення всіх 26 правил з `js/` у `fix/`/`lint/`) в `discover-checkable-rules.mjs` та `run-rule.mjs` залишилися dual-mode ланки: сканування `js/`+`fix/` та `mergeJsConcerns`-захист від дублікатів, поле `rootDir` у `JsConcern`.
**Рішення/Процедура/Факт:** `discover-checkable-rules.mjs` переписано у single-source режим: тільки `fix/`-сканування, `mergeJsConcerns` (перевірка дублікатів між `js/` і `fix/`) видалено, поле `rootDir` у `JsConcern`-типі прибрано. `run-rule.mjs`: `resolveJsCheckPath` хардкодить `'fix'`, JSDoc оновлено. `knip.json` — entry-патерни оновлено з `rules/*/js/**` на `rules/*/fix/**` та `rules/*/lint/lint.mjs`. Тести: прибрано 6 dual-mode тестів, додано 2 single-mode (legacy `js/` ігнорується, multi-concern сортування). Версія: 1.11.12.
**Обґрунтування:** Dual-mode логіка існувала лише для транзитного стану реструктуризації. Після повного переїзду всіх правил підтримка двох шляхів стала мертвим кодом, що ускладнює розуміння і може приховати баги.
**Розглянуті альтернативи:** Залишити dual-mode як backward-compatibility (відхилено: немає зовнішніх споживачів `js/`-структури; пакет публікує лише `fix/` + `lint/`).
**Зачіпає:** `npm/scripts/utils/discover-checkable-rules.mjs`, `npm/scripts/utils/run-rule.mjs`, `npm/scripts/utils/discover-checkable-rules.test.mjs`, `npm/scripts/utils/run-rule.test.mjs`, `knip.json`, `npm/bin/n-cursor.js:1011-1015`.
