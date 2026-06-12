---
docgen:
  source: npm/scripts/sync-claude-config.mjs
  crc: 1233d1a1
  score: 95
---

# sync-claude-config.mjs

## Огляд

Файл синхронізує конфігурацію Claude Code (`.claude/settings.json`), slash-команди з темплейту та Cursor hooks (`.cursor/hooks.json`) у поточний проєкт з використанням темплейтів пакету `npm/.claude-template/`. Він виконує злиття користувацьких полів, дозволів та хуків з різних джерел. Синхронізуються та видаляються залежні скрипти та фрагменти конфігурації.

## Поведінка

MANAGED_HOOK_COMMAND_MARKER Маркер PostToolUse fix-hook

DOC_FILES_HOOK_COMMAND_MARKER Маркер doc-files staleness-hook

LEGACY_STOP_HOOK_COMMAND_MARKER Маркер старого Stop-hook

ADR_HOOK_COMMAND_MARKER Маркер ADR Stop-hook

ADR_NORMALIZE_HOOK_COMMAND_MARKER Маркер ADR Stop-hook

CURSOR_ADR_HOOK_COMMAND_MARKER Маркер Cursor ADR Stop-hook

CURSOR_ADR_NORMALIZE_HOOK_COMMAND_MARKER Маркер Cursor ADR Normalize Stop-hook

MANAGED_HOOK_COMMAND_MARKERS Маркерів для відрізнення managed-hook'ів

PI_DIR Корінь pi.dev артефактів

PI_EXTENSIONS_DIR Директорія pi.dev TS-extensions

PI_TEMPLATE_DIR_NAME Назва bundled-директорії pi-template

PI_EXTENSION_NAME Імʼя bundled pi-extension'а

ADR_GITIGNORE_SNIPPET_REL Відносний шлях до канонічного фрагмента `.gitignore` для ADR Stop-hook'ів

mergeAllowList Зливає список allow-permissions без дублікатів

mergeHooks Зливає hooks-секцію, видаляючи managed-групи з існуючої конфігурації

mergeSettings Зливає конфігурацію Claude, перевіряючи та зливаючи permissions та hooks

mergeCursorHooksConfig Зливає конфігурацію Cursor, керуючи додаванням/видаленням ADR stop entries

syncCursorHooksConfig Синхронізує `.cursor/hooks.json` для Cursor Agent stop-hooks

syncClaudeSettings Синхронізує `.claude/settings.json` за темплейтом

syncAdrHookScript Копіює канонічний bash-скрипт ADR capture Stop-hook з темплейту

syncAdrNormalizeHookScript Копіює канонічний bash-скрипт ADR normalize Stop-hook з темплейту

syncAdrHookLibScripts Копіює `.sh`-файли з `.claude-template/hooks/lib/` у `.claude/hooks/`

removeOrphanAdrHookLib Видаляє директорію `.claude/hooks/lib/` з проєкту-споживача

syncPiExtensions Копіює bundled pi.dev TS-extension з пакета у проєкт

removeOrphanPiExtension Видаляє директорію `.pi/extensions/n-cursor-adr/` з проєкту-споживача

syncGitignoreAdrFragment Дописує відсутні рядки з канонічного ADR-фрагмента до кореневого `.gitignore` проєкту

syncClaudeCommands Копіює slash-команди з `commands/` темплейту у `.claude/commands/`

syncClaudeConfig Виконує повну синхронізацію Claude Code-конфігу з темплейту

## Публічний API

MANAGED_HOOK_COMMAND_MARKER — Маркер для хуків PostToolUse fix-hook'а (`npx --no @nitra/cursor post-tool-use-fix`).
DOC_FILES_HOOK_COMMAND_MARKER — Маркер для хуків doc-files staleness-hook'ів (PostToolUse `--hook` та Stop-гейт `--git`).
LEGACY_STOP_HOOK_COMMAND_MARKER — Маркер для старого Stop-hook'а — для очищення при оновленні існуючих інсталяцій.
ADR_HOOK_COMMAND_MARKER — Маркер для ADR Stop-hook'а — підрядок шляху до bash-скрипта capture-decisions.sh.
ADR_NORMALIZE_HOOK_COMMAND_MARKER — Маркер для ADR Stop-hook'а — підрядок шляху до bash-скрипта normalize-decisions.sh.
CURSOR_ADR_HOOK_COMMAND_MARKER — Маркер для Cursor ADR Stop-hook'а — той самий script path, але в `.cursor/hooks.json`.
CURSOR_ADR_NORMALIZE_HOOK_COMMAND_MARKER — Маркер для Cursor ADR Stop-hook'а — той самий script path, але в `.cursor/hooks.json`.
MANAGED_HOOK_COMMAND_MARKERS — Група маркерів managed-hook'ів пакета — відрізняються від користувацьких.
Legacy stop-hook включений сюди, щоб старі entries автоматично видалялись при наступному sync-у.
PI_DIR — Корінь артефактів pi.dev у проєкті-споживачі.
PI_EXTENSIONS_DIR — Директорія TS-розширень pi.dev у проєкті-споживачі.
PI_TEMPLATE_DIR_NAME — Назва bundled-директорії pi-template у пакеті `@nitra/cursor`.
PI_EXTENSION_NAME — Імʼя bundled pi-extension'а для ADR capture/normalize.
ADR_GITIGNORE_SNIPPET_REL — Відносний шлях до канонічного фрагмента `.gitignore` для ADR Stop-hook'ів у tarball пакета.
mergeAllowList — Зливає список allow-permissions: об'єднує існуючі та темплейтні дозволи без дублікатів, зберігаючи користувацький порядок.
mergeHooks — Зливає hooks-секцію. Видаляє managed-групи з існуючої конфігурації та дописує managed-групи з темплейту. Перебір подій union-у враховує зміну порядку хуків.
mergeSettings — Повертає об'єднаний об'єкт settings.json.
mergeCursorHooksConfig — Зливає `.cursor/hooks.json`: користувацькі записи зберігаються, managed ADR записи в `hooks.stop` перезаписуються або видаляються залежно від `includeAdrHook`.
syncCursorHooksConfig — Синхронізує `.cursor/hooks.json` для Cursor Agent stop-hooks. Cursor читає project-level config з `.cursor/hooks.json`; хук-скрипти залишаються спільними з Claude Code у `.claude/hooks/`.
syncClaudeSettings — Синхронізує `.claude/settings.json` за темплейтом, зберігаючи решту користувацьких полів.
syncAdrHookScript — Копіює канонічний `.claude/hooks/capture-decisions.sh` з темплейту пакета.
syncAdrNormalizeHookScript — Копіює канонічний `.claude/hooks/normalize-decisions.sh` з темплейту пакета.
syncAdrHookLibScripts — Копіює всі `.sh`-файли з `.claude-template/hooks/lib/` у `.claude/hooks/lib/` проєкту.
Файли source-only (без exec bit) — їх source-ять capture/normalize-decisions.sh, щоб уникнути дублювання спільної bash-логіки (`is_tooling_only_change`, `git_diff_only_version_field`).
Тека fully-owned — при кожному sync-у перезаписується.
removeOrphanAdrHookLib — Видаляє директорію `.claude/hooks/lib/` з проєкту-споживача. Викликається, коли правило `adr` вимкнено — бібліотечні файли не самостійні, і їх не потрібні.
syncPiExtensions — Копіює bundled pi.dev TS-extension `npm/.pi-template/extensions/n-cursor-adr/` (всі файли — `index.ts`, `tsconfig.json`, потенційні `package.json`/`.gitignore` тощо`) у `.pi/extensions/n-cursor-adr/` проєкту-споживача. Тека fully-owned: при кожному sync-у перезаписується. Якщо bundled template відсутній (legacy-версії пакета без `.pi-template/`) або в ньому немає `index.ts` — повертається `{written: false}` без помилки.
Розширення поверх `index.ts` (tsconfig тощо) потрібні, бо `.pi/extensions/` синхронізується як у проєкти-споживачі, а IDE/TS-сервер мусить резолвити `node:*` модулі без додаткових project-wide конфігів.
removeOrphanPiExtension — Видаляє директорію `.pi/extensions/n-cursor-adr/` з проєкту-споживача. Викликається, коли правило `adr` вимкнено у `.n-cursor.json` — бібліотечні файли не самостійні, і їх не потрібні (симетрично до cleanup-у `.claude/hooks/{capture,normalize}-decisions.sh`).
syncGitignoreAdrFragment — Дописує в кореневий `.gitignore` проєкту відсутні рядки з канонічного ADR-фрагмента.
syncClaudeCommands — Копіює всі slash-команди з `templateDir/commands/` у `.claude/commands/`. Команди ідентифікуються тим, що вони лежать у темплейті — не перетинаються з командами скілів (n-fix, n-lint, ...).
syncClaudeConfig — Виконує повну синхронізацію Claude Code-конфігу з темплейту пакету в проєкт. Використовується з `bin/n-cursor.js` після інших синків.

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За невдачі повертає значення помилки (`false`/`null`/`Err`) замість генерування винятку чи паніки.
- Свідомо пропускає шляхи: `.git`.
- Не звертається до мережі.
