---
session: e513a1f0-c8b8-4eec-a745-63768ffe456b
captured: 2026-05-16T14:19:43+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/e513a1f0-c8b8-4eec-a745-63768ffe456b.jsonl
---

## ADR: Видалення lint-conftest — консолідація у `npx @nitra/cursor check`
**Контекст:** `npm/scripts/lint-conftest.mjs` запускав conftest/rego-валідацію по всіх policy-концернах окремим скриптом (`bun run lint-conftest`). Паралельно існував CLI-команда `npx @nitra/cursor check`, яка робить те саме через `discoverCheckableRules`. Два канали дублювали одне й те саме, і будь-яке нове правило треба було реєструвати у двох місцях.
**Рішення/Процедура/Факт:** Видалено `npm/scripts/lint-conftest.mjs`. З кореневого `package.json#scripts.lint` прибрано ланку `bun run lint-conftest`. У ~18 файлах (`*.mjs`, `*.rego`, `*.mdc`) всі посилання `bun run lint-conftest` замінено на `npx @nitra/cursor check`. Документація (conftest.mdc, scripts.mdc, abie.mdc) оновлена. Версія `1.11.11`.
**Обґрунтування:** Єдине джерело правди — `discoverCheckableRules` автоматично підхоплює нові rego-концерни за наявністю `target.json`. Реєстрація у TARGETS у `lint-conftest.mjs` була ручною і регулярно розходилася з реальністю (conditional rego без `target.json` не потрапляло у глобальний прогін).
**Розглянуті альтернативи:** Лишити `lint-conftest` і зробити його wrapper навколо `npx @nitra/cursor check` — відхилено, бо це ще одна ланка без будь-якої доданої цінності.
**Зачіпає:** `npm/scripts/lint-conftest.mjs` (deleted), `package.json#scripts`, `npm/rules/*/fix/*/check.mjs` (comments), `npm/rules/*/policy/*.rego` (comments), `.cursor/rules/conftest.mdc`, `.cursor/rules/scripts.mdc`, `npm/rules/abie/abie.mdc`.

## ADR: Фаза 3 — інфраструктура сканування single-source `fix/`-only
**Контекст:** Після двофазної реструктуризації правил з `js/` → `fix/` (+ `lint/`) у `discover-checkable-rules.mjs` і `run-rule.mjs` лишився dual-mode: сканування і `js/<concern>/check.mjs`, і `fix/<concern>/check.mjs`, плюс поле `rootDir` у `JsConcern`-типі для сумісності. Всі 26 правил уже переїхали — легасі-код тримав мертвий path і ускладнював читання.
**Рішення/Процедура/Факт:** Переписано `discover-checkable-rules.mjs`: прибрано `mergeJsConcerns` (guard на дублікати між `js/` і `fix/`), прибрано сканування `rules/<id>/js/`; залишено тільки `fix/<concern>/check*.mjs` і `lint/lint.mjs`. Видалено поле `rootDir` з типу. `run-rule.mjs`: `resolveJsCheckPath` хардкодить `'fix'` замість `concern.rootDir ?? 'js'`. Юніт-тести переписано з 19 → 13 кейсів (прибрано 6 dual-mode, додано 2 single-mode). Версія `1.11.12`.
**Обґрунтування:** Dual-mode існував лише для того, щоб нові правила могли переїжджати поступово без поломки CLI. Після завершення фази 2 він став мертвим кодом і ризиком регресій (нові правила у `js/` більше не мають потрапляти у CLI).
**Розглянуті альтернативи:** Не обговорювалися.
**Зачіпає:** `npm/scripts/utils/discover-checkable-rules.mjs`, `npm/scripts/utils/discover-checkable-rules.test.mjs`, `npm/scripts/utils/run-rule.mjs`, `npm/scripts/utils/run-rule.test.mjs`, `npm/bin/n-cursor.js` (JSDoc comment), `knip.json` (entry patterns).

## ADR: Slug-генерація у `capture-decisions.sh` на основі LLM-heading
**Контекст:** Stop-hook `capture-decisions.sh` зберігав ADR-чернетки з іменем `<timestamp>-<session-hash[0:8]>.md` (наприклад, `20260516-090349-e513a1f0.md`). Такий формат нечитабельний у git status/IDE, і `normalize-decisions.sh` мусив робити `rewrite`-операції для перейменування у slug-формат — окремий LLM-виклик для кожного файлу.
**Рішення/Процедура/Факт:** У `capture-decisions.sh` (canonical: `npm/.claude-template/hooks/`, + синк у `.claude/hooks/`) після отримання LLM-відповіді парситься перший `## [ADR|Runbook|Knowledge] <heading>` рядок. `awk` + `tr` + `sed` генерує kebab-slug: lowercase, пробіли/розділові знаки → `-`, дозволено кирилицю та `a-z 0-9 -`, truncate 60 символів. Формат: `<TS>-<slug>.md`. Колізії у ту саму секунду → `-2`, `-3`. Fallback при невдалому парсі — `<TS>-<session-id[0:8]>.md`. Нульовий overhead: LLM-виклик той самий, slug деривується з уже отриманого тексту. Версія `1.11.15`.
**Обґрунтування:** Slug-формат зрозумілий одразу після capture; `normalize` тепер обмежується `delete`/`merge-into` для дублікатів, `rewrite`-операції стають рідкісними (лише коли нормалізатор обирає «чистіший» канонічний slug для merge-target).
**Розглянуті альтернативи:** Окремий LLM-виклик для генерації slug — відхилено, бо подвоює час Stop-hook. Slug без timestamp-prefix — відхилено, бо дві сесії з однаковою темою дали б колізію.
**Зачіпає:** `npm/.claude-template/hooks/capture-decisions.sh`, `.claude/hooks/capture-decisions.sh` (обидва синхронізовані), `npm/CHANGELOG.md`.
