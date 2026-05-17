---
session: e513a1f0-c8b8-4eec-a745-63768ffe456b
captured: 2026-05-16T17:49:57+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/e513a1f0-c8b8-4eec-a745-63768ffe456b.jsonl
---

готовий до наступного кроку.

---

## ADR Видалення `lint-conftest`-каналу та консолідація у `npx @nitra/cursor check`
**Контекст:** Скрипт `npm/scripts/lint-conftest.mjs` дублював функцію `npx @nitra/cursor check`, ітеруючи Rego policy-концерни через окремий `TARGETS`-список; це породжувало дві паралельні точки входу для однієї перевірки і сповільнювало обслуговування (у 10+ мсd-файлах зберігалися посилання на `bun run lint-conftest`).
**Рішення/Процедура/Факт:** Видалено `npm/scripts/lint-conftest.mjs` і його ланку зі скрипту `lint` у кореневому `package.json`; у 10 check.mjs та 7 rego-файлах замінено `bun run lint-conftest` → `npx @nitra/cursor check`; оновлено `.cursor/rules/conftest.mdc`, `scripts.mdc` та `abie.mdc` (cross-reference). Bump версії `1.11.10 → 1.11.11`.
**Обґрунтування:** `discoverCheckableRules` автоматично підхоплює policy-концерни за наявністю `target.json`, тому окремий TARGETS-реєстр є зайвим; єдине джерело правди — `npx @nitra/cursor check`.
**Розглянуті альтернативи:** Залишити обидва канали — відхилено через дублювання стану.
**Зачіпає:** `npm/scripts/lint-conftest.mjs` (видалено), `package.json#scripts.lint`, `package.json#scripts.lint-conftest`, `.cursor/rules/conftest.mdc`, `.cursor/rules/scripts.mdc`, `npm/rules/abie/abie.mdc`, 10 `check.mjs` та 7 `.rego` файлів у `npm/rules/`.

## ADR Реструктуризація `discover-checkable-rules` та `run-rule`: усунення legacy `js/` fallback (фаза 3)
**Контекст:** Після фази 2 (перейменування `rules/<id>/js/` → `rules/<id>/fix/`) інфраструктурний шар `discover-checkable-rules.mjs` і `run-rule.mjs` все ще підтримували dual-mode — сканували обидві директорії (`js/` і `fix/`) через поле `rootDir` у типі `JsConcern`. Це ускладнювало читання коду і залишало мертвий шлях.
**Рішення/Процедура/Факт:** Переписано `discover-checkable-rules.mjs` — вилучено `mergeJsConcerns`, поле `rootDir`, fallback-сканування `js/`; хардкод `'fix'` у `resolveJsCheckPath` (`run-rule.mjs`). Тести скорочені з 19 до 13: прибрано 6 dual-mode сценаріїв, додано 2 single-mode (ігнорування `js/`, multi-concern сортування). Bump `1.11.11 → 1.11.12`.
**Обґрунтування:** Всі 26 правил уже у `fix/` (або `lint/` для 6 правил), підтримувати dead-code `js/`-гілку немає сенсу.
**Розглянуті альтернативи:** Зберегти dual-mode ще один цикл — відхилено; тест-суїт підтверджував чистоту після фази 2.
**Зачіпає:** `npm/scripts/utils/discover-checkable-rules.mjs`, `npm/scripts/utils/discover-checkable-rules.test.mjs`, `npm/scripts/utils/run-rule.mjs`, `npm/scripts/utils/run-rule.test.mjs`, `npm/bin/n-cursor.js:1011-1015`.

## ADR Slug-derivation у `capture-decisions.sh`: чернетки одразу з нормалізованим іменем
**Контекст:** Stop-hook `capture-decisions.sh` зберігав чернетки під іменем `<timestamp>-<session-id[0:8]>.md` (наприклад `20260516-090349-e513a1f0.md`); зрозумілий slug з'являвся лише після ручного `/n-adr-normalize`. Унаслідок цього batch-нормалізатор витрачав LLM-токени на rename-операції замість суто змістовної роботи (delete/merge-into).
**Рішення/Процедура/Факт:** У `capture-decisions.sh` після LLM-виклику (без додаткового виклику) парситься перший `## [ADR|Runbook|Knowledge] <heading>` рядок; з нього генерується kebab-slug (lowercase, кирилиця дозволена, `[^a-zа-яёіїєґ0-9-]` dropped, max 60 символів); ім'я файла набуває вигляду `<TS>-<slug>.md`. Колізії → `-2`/`-3`-суфікс. Fallback на `<TS>-<session-id[0:8]>.md`, якщо heading не спарсився. Зміна синхронізована у `npm/.claude-template/hooks/capture-decisions.sh`. Bump `1.11.14 → 1.11.15`.
**Обґрунтування:** LLM-відповідь уже містить heading — парсити його Bash-інструментами (`awk`+`sed`) безкоштовно і достатньо. Timestamp-prefix гарантує унікальність між сесіями з однаковою темою.
**Розглянуті альтернативи:** (а) Окремий LLM-виклик для генерації slug — відхилено (зайві затримки і токени). (б) Лише slug без timestamp — відхилено (ризик колізії між різними сесіями).
**Зачіпає:** `.claude/hooks/capture-decisions.sh`, `npm/.claude-template/hooks/capture-decisions.sh`, `npm/CHANGELOG.md`.
