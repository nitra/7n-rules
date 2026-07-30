---
type: JS Module
title: ensure-tool.mjs
resource: npm/scripts/lib/ensure-tool.mjs
docgen:
  crc: fabdd634
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 40
---

## Огляд

Авто-встановлення зовнішніх CLI-залежностей пакету `@7n/rules`.

`ensureTool(toolId)` — єдиний seam резолву зовнішніх бінарників: PATH → кеш → авто-install → hard-fail.
Новий тул = один запис у реєстрі `TOOLS`, без дублювання install-логіки в кожному `lint.mjs`/`fix.mjs`.

Версії GitHub Release-тулів (Linux/Windows-fallback install-шлях) — **закріплені** у
`tool-pins.json`, а не резолвляться як `latest` на кожен install: CI-runner-и ефемерні,
кеш бінарників порожній щоразу, і `latest`-lookup на кожен job = постійний трафік у
GitHub API з shared-IP (rate-limit). `fetchLatestVersion` (GitHub API з `GITHUB_TOKEN`/
`GH_TOKEN` за наявності, з fallback-ом на redirect `releases/latest` повз API) лишається
— це «мотор» для ручного рефрешу пінів (`tool-pins-refresh.mjs`), у звичайному install
не викликається. `checkToolPinsFreshness()` — гейт «пінам більше 30 днів → час
рефрешнути» (тест `tool-pins-freshness.test.mjs`). Транзієнтні збої download-у
кидаються як `ToolProvisionError` (fail-open seam для lint-детекторів — див.
`lint-surface/detect.mjs`).

Per-platform matrix: macOS → brew, Windows → scoop (fallback: GitHub Release), Linux → GitHub Release binary.
Бінарники кешуються у `~/.cache/@7n/rules/bin/` (Linux/Mac), `%LOCALAPPDATA%\@7n\cursor\bin\` (Win).
Download завжди пишеться в унікальний per-call temp-каталог і публікується атомарним `renameSync` —
паралельні install того самого тула (різні процеси/промиси) не тупцюють по спільному archive-шляху.

`ensureTool` лишається синхронним — публічний API пакету (`@7n/rules/scripts/lib/ensure-tool.mjs`,
реально споживається зовнішнім `plugins/ci-github`), сигнатуру не міняємо. `ensureToolAsync(toolId)` —
async-варіант для parallel lane `detectAll()`: внутрішньопроцесний single-flight + міжпроцесний
`withLock` навколо auto-install кроку (`docs/adr/260716-1354-…`).

`ensureHkInstall(hkBin)` — реєструє git pre-commit hook через `hk install`; пропускається в CI.

## Публічний API

- TOOL_PINS_MAX_AGE_DAYS — Поріг «застарілості» пінів версій (`tool-pins.json.pinnedAt`) у днях.
- checkToolPinsFreshness — Вік поточних пінів версій у днях від `pinnedAt` до `now`.
- ToolProvisionError — Транзієнтний збій авто-встановлення зовнішнього тула (GitHub API rate-limit, мережа,
обірваний download). Відрізняється від конфігураційних помилок (невідомий тул,
`N_CURSOR_NO_AUTO_INSTALL`, відсутній curl) — споживачі розпізнають за `name`
і можуть спрацювати fail-open замість валити весь прогін.
- TOOLS — Реєстр install-стратегій. Експортовано read-only для `tool-pins-refresh.mjs`
(ітерує `entry.github`, щоб рефрешнути `tool-pins.json`) — не мутуй.
- fetchLatestVersion — Отримує останній тег релізу: спершу GitHub API (з токеном за наявності), при збої —
redirect-fallback повз API. Кидає `ToolProvisionError`, лише якщо не вдались обидва шляхи.
Експортовано для юніт-тестів; основний споживач — `installFromGithub`.
- ensureTool — Резолвить і за необхідності авто-встановлює зовнішній CLI-тул.

Порядок: PATH → кеш → авто-install (якщо не N_CURSOR_NO_AUTO_INSTALL) → hard-fail.
Повертає абсолютний шлях або кидає Error.
- ensureToolAsync — Async-варіант `ensureTool` для parallel lane `detectAll()` (ADR 260716-1354). `ensureTool`
(sync) лишається незміненою — публічний API пакета; ця функція існує окремо, не заміняє її.

Fast-paths (PATH, уже закешований бінарник) — ідентичні sync-версії. Auto-install — єдина
гілка, що реально потребує async: обгорнута internal single-flight (`inFlightInstalls`) і
cross-process `withLock`, щоб паралельні виклики того самого `toolId` (в одному процесі чи
кількох) не тягнули install конкурентно.
- ensureHkInstall — Реєструє git pre-commit hook через `hk install`.
Пропускається в CI (`process.env.CI`). Попереджає (не кидає) на помилку.

## Сценарії використання

- `npm/scripts/lib/tests/ensure-tool.test.mjs` (ensureTool; ensureToolAsync) — PATH hit → повертає абсолютний шлях, без install; кеш hit → повертає шлях з кеш-каталогу, коли в PATH нема; невідомий тул → кидає; opt-out N_CURSOR_NO_AUTO_INSTALL + відсутній → hard-fail з підказкою (без install); PATH hit → повертає абсолютний шлях, без withLock; ще 14

## Гарантії поведінки

- Кешує результати в межах одного прогону.
