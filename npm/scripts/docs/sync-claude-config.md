---
type: JS Module
title: sync-claude-config.mjs
resource: npm/scripts/sync-claude-config.mjs
docgen:
  crc: 1ae220d3
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 85
---

Синхронізує конфігурацію Claude Code (`.claude/settings.json`, slash-команди з `commands/` темплейту, ADR Stop-hook) та Cursor hooks (`.cursor/hooks.json`) у поточний проєкт із темплейтів пакету `npm/.claude-template/`. Здійснює злиття конфігурацій: користувацькі поля зберігаються у `.claude/settings.json`, а дозволи (`permissions.allow`) зливаються через union. Керовані хуки, ідентифіковані командою-маркером `MANAGED_HOOK_COMMAND_MARKERS`, перезаписуються. Копіює ADR Stop-hook (`.claude/hooks/capture-decisions.sh`) та ADR normalize Stop-hook (`.claude/hooks/normalize-decisions.sh`) залежно від налаштувань у `.n-rules.json`. Також зливає фрагмент `.gitignore` з канонічного шаблону, додаючи необхідні записи для ADR. За правилом `local-ai` керує rtk-інтеграцією (fail-open, працює лише за наявності бінарника rtk): PreToolUse hook `rtk hook claude` у `.claude/settings.json`, preToolUse entry `rtk hook cursor` у `.cursor/hooks.json` і vendored pi-extension `.pi/extensions/rtk.ts`; вимкнення правила прибирає записи та видаляє extension.

## Поведінка

MANAGED_HOOK_COMMAND_MARKER — Визначає маркер актуальних hook-ів пакета (`hook --post-tool-use`, `hook --stop`).
LEGACY_POST_TOOL_USE_HOOK_COMMAND_MARKER — Визначає маркер застарілого хука `post-tool-use-check` для cleanup при ресинку.
LEGACY_POST_TOOL_USE_FIX_HOOK_COMMAND_MARKER — Визначає маркер ще старішої мутуючої команди `post-tool-use-fix` для cleanup при ресинку.
DOC_FILES_HOOK_COMMAND_MARKER — Визначає маркер для хука `lint-doc-files`.
LEGACY_DOC_FILES_HOOK_COMMAND_MARKER — Визначає маркер для застарілого хука `doc-files check`.
LEGACY_STOP_HOOK_COMMAND_MARKER — Визначає маркер для застарілого Stop-hook'а.
ADR_HOOK_COMMAND_MARKER — Визначає маркер шляху до bash-скрипта ADR capture Stop-hook.
ADR_NORMALIZE_HOOK_COMMAND_MARKER — Визначає маркер шляху до bash-скрипта ADR normalize Stop-hook.
CURSOR_ADR_HOOK_COMMAND_MARKER — Визначає маркер шляху до bash-скрипта ADR capture Stop-hook у `.cursor/hooks.json`.
CURSOR_ADR_NORMALIZE_HOOK_COMMAND_MARKER — Визначає маркер шляху до bash-скрипта ADR normalize Stop-hook у `.cursor/hooks.json`.
RTK_CLAUDE_HOOK_COMMAND_MARKER — Визначає маркер rtk PreToolUse hook'а (`rtk hook claude`) у `.claude/settings.json` (правило `local-ai`).
RTK_CURSOR_HOOK_COMMAND_MARKER — Визначає маркер rtk preToolUse hook'а (`rtk hook cursor`) у `.cursor/hooks.json` (правило `local-ai`).
MANAGED_HOOK_COMMAND_MARKERS — Містить список усіх маркерів, що ідентифікують керовані хуки пакета.
PI_DIR — Визначає кореневу директорію для артефактів pi.dev у проєкті-споживачі.
PI_EXTENSIONS_DIR — Визначає директорію для TS-extensions pi.dev у проєкті-споживачі.
PI_TEMPLATE_DIR_NAME — Визначає назву директорії з темплейтом pi-template у пакеті.
PI_EXTENSION_NAME — Визначає ім'я bundled pi-extension для ADR capture/normalize.
ADR_GITIGNORE_SNIPPET_REL — Визначає відносний шлях до канонічного фрагмента `.gitignore` для ADR Stop-hook'ів у tarball пакета.
mergeAllowList — Об'єднує списки дозволених дозволів, зберігаючи користувацькі записи першими.
mergeHooks — Зливає секцію `hooks` з `.claude/settings.json`, видаляючи керовані групи з існуючої конфігурації.
mergeSettings — Зливає конфігурацію `.claude/settings.json` з темплейту, зберігаючи користувацькі поля та оновлюючи керовані хуки.
mergeCursorHooksConfig — Зливає конфігурацію `.cursor/hooks.json`, зберігаючи користувацькі записи та додаючи/видаляючи керовані ADR stop entries і rtk preToolUse entry.
syncCursorHooksConfig — Синхронізує `.cursor/hooks.json` для Cursor Agent hooks, додаючи ADR stop і rtk preToolUse entries за умовою.
syncClaudeSettings — Синхронізує `.claude/settings.json` за темплейтом, зберігаючи користувацькі налаштування.
syncAdrHookScript — Копіює канонічний bash-скрипт ADR capture Stop-hook з темплейту пакета у `.claude/hooks/`.
syncAdrNormalizeHookScript — Копіює канонічний bash-скрипт ADR normalize Stop-hook з темплейту пакета у `.claude/hooks/`.
syncAdrHookLibScripts — Копіює всі bash-скрипти з `lib/` темплейту у `.claude/hooks/lib/` проєкту.
removeOrphanAdrHookLib — Видаляє директорію `.claude/hooks/lib/` з проєкту, якщо ADR-хуки вимкнені.
syncPiExtensions — Копіює bundled pi.dev TS-extension `n-rules-adr` у `.pi/extensions/n-rules-adr/` проєкту.
removeOrphanPiExtension — Видаляє директорію `.pi/extensions/n-rules-adr/` з проєкту, якщо ADR-хуки вимкнені.
RTK_PI_EXTENSION_FILE — Визначає ім'я файлу rtk pi-extension (`rtk.ts`) — шлях спільний із `rtk init --agent pi`.
syncRtkPiExtension — Копіює vendored rtk pi-extension у `.pi/extensions/rtk.ts` проєкту (правило `local-ai`).
removeOrphanRtkPiExtension — Видаляє `.pi/extensions/rtk.ts` з проєкту, якщо правило `local-ai` вимкнене.
syncGitignoreAdrFragment — Дописує відсутні рядки з канонічного ADR-фрагмента до кореневого `.gitignore` проєкту.
syncClaudeCommands — Копіює всі slash-команди з `.claude-template/commands/` у `.claude/commands/` проєкту.
syncClaudeConfig — Виконує повну синхронізацію Claude Code-конфігу, включаючи ADR-хуки, `.gitignore` та pi-extension, залежно від правил.

## Публічний API

MANAGED_HOOK_COMMAND_MARKER — Позначає актуальні hook-и пакета.
LEGACY_POST_TOOL_USE_HOOK_COMMAND_MARKER — Позначає застарілий хук `post-tool-use-check`, який прибирається при ресинку.
LEGACY_POST_TOOL_USE_FIX_HOOK_COMMAND_MARKER — Позначає застарілу мутуючу команду `post-tool-use-fix`, яка прибирається при ресинку.
DOC_FILES_HOOK_COMMAND_MARKER — Позначає хук для перевірки актуальності файлів документації.
LEGACY_DOC_FILES_HOOK_COMMAND_MARKER — Позначає старий маркер для очищення хуків документації.
LEGACY_STOP_HOOK_COMMAND_MARKER — Позначає старий маркер для очищення хука зупинки.
ADR_HOOK_COMMAND_MARKER — Позначає шлях до скрипта для фіксації рішень ADR.
ADR_NORMALIZE_HOOK_COMMAND_MARKER — Позначає шлях до скрипта для нормалізації рішень ADR.
CURSOR_ADR_HOOK_COMMAND_MARKER — Позначає шлях до скрипта фіксації ADR у конфігурації Cursor.
CURSOR_ADR_NORMALIZE_HOOK_COMMAND_MARKER — Позначає шлях до скрипта нормалізації ADR у конфігурації Cursor.
MANAGED_HOOK_COMMAND_MARKERS — Групує всі маркери хуків, щоб відрізнити автоматичні записи від користувацьких.
PI_DIR — Місце зберігання артефактів pi.dev у проєкті.
PI_EXTENSIONS_DIR — Директорія для TS-розширень pi.dev у проєкті.
PI_TEMPLATE_DIR_NAME — Назва папки з шаблоном pi у пакеті.
PI_EXTENSION_NAME — Ім'я пакета pi-розширення для фіксації/нормалізації ADR.
ADR_GITIGNORE_SNIPPET_REL — Відносний шлях до шаблону `.gitignore` для ADR.
mergeAllowList — Об'єднує дозволені права доступу, зберігаючи порядок існуючих записів.
mergeHooks — Об'єднує секцію хуків: видаляє автоматичні записи з існуючої конфігурації та додає записи з шаблону.
mergeSettings — Створює об'єднаний файл налаштувань.
mergeCursorHooksConfig — Об'єднує конфігурацію хуків Cursor, зберігаючи користувацькі записи та оновлюючи ADR-записи.
syncCursorHooksConfig — Синхронізує конфігурацію зупинки для агента Cursor.
syncClaudeSettings — Копіює налаштування Claude Code з шаблону, зберігаючи користувацькі дані.
syncAdrHookScript — Копіює канонічний скрипт фіксації рішень ADR.
syncAdrNormalizeHookScript — Копіює канонічний скрипт нормалізації рішень ADR.
syncAdrHookLibScripts — Копіює всі допоміжні скрипти з шаблону в проєкт.
removeOrphanAdrHookLib — Видаляє директорію з допоміжними скриптами ADR, якщо правило ADR вимкнено.
syncPiExtensions — Копіює TS-розширення pi.dev у проєкт.
removeOrphanPiExtension — Видаляє директорію з розширення pi, якщо правило ADR вимкнено.
syncGitignoreAdrFragment — Додає необхідні рядки з канонічного фрагмента `.gitignore` до кореня проєкту.
syncClaudeCommands — Копіює всі slash-команди з шаблону в директорію команд Claude.
syncClaudeConfig — Виконує повну синхронізацію конфігурації Claude Code з шаблону.

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- Свідомо пропускає шляхи: `.git`.
