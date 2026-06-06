# sync-claude-config.mjs

## Огляд

Цей файл синхронізує конфігурацію Claude Code з шаблонів пакету `npm/.claude-template`, включаючи налаштування, slash-команди та хуки. Він забезпечує узгодженість між проєктом та базовою конфігурацією, автоматично оновлюючи та підтримуючи налаштування хуків та команд.  Це дозволяє використовувати стандартні налаштування та автоматично адаптувати проєкт до змін у шаблоні.

## Поведінка

*   `parseGitignoreFragmentLines`: Розбиває рядок фрагменту `.gitignore` на окремі рядки, видаляє порожні та коментарні рядки.
*   `syncGitignoreAdrFragment`: Дописує відсутні рядки з канонічного фрагменту `.gitignore` у `.gitignore` проєкту.
*   `syncClaudeCommands`: Копіює slash-команди з `commands/` темплейту в `.claude/commands/*.md`.
*   `syncClaudeSettings`: Об'єднує конфігурацію Claude Code з темплейту, зберігаючи користувацькі налаштування та перезаписуючи хуки, що ідентифікуються маркерами.
*   `syncCursorHooksConfig`: Об'єднує конфігурацію хуків Cursor з темплейту, додаючи або видаляючи хуки ADR Stop-hook залежно від наявності правила `adr`.
*   `syncAdrHookScript`: Копіює bash-скрипт ADR capture Stop-hook з темплейту в `.claude/hooks/capture-decisions.sh`.
*   `syncAdrNormalizeHookScript`: Копіює bash-скрипт ADR normalize Stop-hook з темплейту в `.claude/hooks/normalize-decisions.sh`.
*   `syncAdrHookLibScripts`: Копіює bash-скрипти lib-файлів з `commands/` темплейту в `.claude/hooks/lib/`.
*   `removeOrphanAdrHookLib`: Видаляє директорію lib-файлів з `.claude/hooks/lib/`, якщо правило `adr` вимкнено.
*   `syncPiExtensions`: Копіює розширення TypeScript з `npm/.pi-template/extensions/n-cursor-adr/` в `.pi/extensions/n-cursor-adr/`.
*   `removeOrphanPiExtension`: Видаляє директорію розширення TypeScript з `.pi/extensions/n-cursor-adr/`, якщо правило `adr` вимкнено.
*   `syncClaudeConfig`: Синхронізує конфігурацію Claude Code та Cursor hooks, об'єднуючи їх та додаючи/видаляючи хуки

## Публічний API

- MANAGED_HOOK_COMMAND_MARKER — Маркер для фіксації хуків PostToolUse.
- LEGACY_STOP_HOOK_COMMAND_MARKER — Маркер для legacy-хуків Stop, використовується під час оновлення.
- ADR_HOOK_COMMAND_MARKER — Маркер для хуків ADR Stop, визначає шлях до скрипту capture-decisions.
- ADR_NORMALIZE_HOOK_COMMAND_MARKER — Маркер для хуків ADR Stop, визначає шлях до скрипту normalize-decisions.
- CURSOR_ADR_HOOK_COMMAND_MARKER — Маркер для хуків Cursor ADR Stop, шлях до скрипту в `.cursor/hooks.json`.
- CURSOR_ADR_NORMALIZE_HOOK_COMMAND_MARKER — Маркер для хуків Cursor ADR Normalize Stop, шлях до скрипту в `.cursor/hooks.json`.
- MANAGED_HOOK_COMMAND_MARKERS — Усі маркери managed-хуків пакета.
- PI_DIR — Корінь артефактів pi.dev у проєкті-споживачі.
- PI_EXTENSIONS_DIR — Директорія pi.dev TS-extensions у проєкті-споживачі.
- PI_TEMPLATE_DIR_NAME — Назва bundled-директорії pi-template у пакеті `@nitra/cursor`.
- PI_EXTENSION_NAME — Ім'

## Гарантії поведінки

Немає кешування.

Функція повертає `true`, якщо синхронізація завершилася успішно.

Якщо `claude-config` встановлено на `false` у `.n-cursor.json`, функція не змінює конфігурацію Claude.

`settings.json` оновлюється шляхом об'єднання конфігурації з `.claude-template/settings.json`, де перекриваються команди, що містять `MANAGED_HOOK_COMMAND_MARKER`, дозволи `permissions.allow` об'єднуються, і правила `adr` додаються/видаляються згідно з їх статусом у `.n-cursor.json`.

`.claude/commands/*.md` оновлюється шляхом повного заміщення вмісту з `.claude-template/commands/`.

`.claude/hooks/capture-decisions.sh` оновлюється шляхом повного копіювання з `.claude-template/hooks/` лише тоді, коли правило `adr` увімкнено в `.n-cursor.json`.

`.claude/hooks/normalize-decisions.sh` оновлюється шляхом повного копіюювання з `.claude-template/hooks/` лише тоді, коли правило `adr` увімкнено в `.n-cursor.json`.

`.
