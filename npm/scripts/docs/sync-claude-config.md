---
type: JS Module
title: sync-claude-config.mjs
resource: npm/scripts/sync-claude-config.mjs
docgen:
  crc: 7e76e00d
  model: omlx/gemma-4-e2b-it-4bit
  tier: local-min
  score: 35
  issues: no-overview,short-behavior,anchor-miss:LEGACY_PACKAGE_HOOK_COMMAND_MARKER,anchor-miss:LEGACY_POST_TOOL_USE_HOOK_COMMAND_MARKER,anchor-miss:LEGACY_POST_TOOL_USE_FIX_HOOK_COMMAND_MARKER,anchor-miss:DOC_FILES_HOOK_COMMAND_MARKER,best-of-2:retry-lost
---

## Публічний API

- MANAGED_HOOK_COMMAND_MARKER — Маркер hook-ів пакета (`hook --post-tool-use`, `hook --stop`).
- LEGACY_STOP_HOOK_COMMAND_MARKER — Legacy-маркер старого Stop-hook'а — лишаємо для cleanup-у при оновленні існуючих інсталяцій.
- ADR_HOOK_COMMAND_MARKER — Маркер ADR Stop-hook'а — підрядок шляху до bash-скрипта capture-decisions.
- ADR_NORMALIZE_HOOK_COMMAND_MARKER — Маркер ADR Stop-hook'а — підрядок шляху до bash-скрипта normalize-decisions.
- CURSOR_ADR_HOOK_COMMAND_MARKER — Маркер Cursor ADR Stop-hook'а — той самий script path, але в `.cursor/hooks.json`.
- CURSOR_ADR_NORMALIZE_HOOK_COMMAND_MARKER — Маркер Cursor ADR Normalize Stop-hook'а — той самий script path, але в `.cursor/hooks.json`.
- RTK_CLAUDE_HOOK_COMMAND_MARKER — Маркер rtk PreToolUse hook'а у `.claude/settings.json` (правило `local-ai`).
- RTK_CURSOR_HOOK_COMMAND_MARKER — Маркер rtk preToolUse hook'а у `.cursor/hooks.json` (правило `local-ai`).
- RTK_CODEX_HOOK_COMMAND_MARKER — Legacy-маркер помилкового Codex rtk hook'а. Лишається лише щоб наступний sync прибрав
його зі старих `.codex/hooks.json`; новий hook не генерується, бо rtk не має підкоманди
`hook codex`.
- MANAGED_HOOK_COMMAND_MARKERS — Усі маркери managed-hook'ів пакета — за ними відрізняємо свої записи від користувацьких.
Legacy stop-hook включений сюди, щоб старі entries автоматично видалялись при наступному sync-у.
- PI_DIR — Корінь pi.dev артефактів у проєкті-споживачі.
- PI_EXTENSIONS_DIR — Директорія pi.dev TS-extensions у проєкті-споживачі.
- PI_TEMPLATE_DIR_NAME — Назва bundled-директорії pi-template у пакеті `@7n/rules`.
- PI_EXTENSION_NAME — Імʼя bundled pi-extension'а для ADR capture/normalize.
- ADR_GITIGNORE_SNIPPET_REL — Відносний шлях до канонічного фрагмента `.gitignore` для ADR Stop-hook'ів у tarball пакета.
- mergeAllowList — Зливає список allow-permissions: union існуючого і темплейтного без дублікатів,
порядок — спочатку існуючі (щоб не міняти користувацький порядок), потім нові.
- mergeHooks — Зливає hooks-секцію. Для **кожної події** з обох сторін:
  1) видаляємо managed-групи з існуючої конфігурації (їх ідентифікують маркери з
     `MANAGED_HOOK_COMMAND_MARKERS`, включно з legacy-маркерами — це автоматично
     прибирає застарілі hook'и при переході на нову версію темплейту);
  2) дописуємо managed-групи з темплейту.
Перебір union-у подій важливий: коли пакет переносить hook між подіями (напр. `Stop`
→ `PostToolUse`), старі managed entries у вже-непотрібній події теж мають піти.
- mergeSettings — Повертає об'єднаний об'єкт settings.json.
- mergeCursorHooksConfig — Зливає `.cursor/hooks.json`: користувацькі entries зберігаються, managed ADR
entries у `hooks.stop` перезаписуються або видаляються залежно від `includeAdrHook`;
managed rtk entry у `hooks.preToolUse` — залежно від `includeLocalAiHook`.
- syncCursorHooksConfig — Синхронізує `.cursor/hooks.json` для Cursor Agent hooks (ADR stop + rtk preToolUse).
Cursor читає project-level config з `.cursor/hooks.json`; hook scripts лишаються
спільними з Claude Code у `.claude/hooks/`.
- mergeCodexHooks — Зливає hooks-секцію `.codex/hooks.json`. Формат ідентичний `.claude/settings.json.hooks`
(matcher + hooks[] з type/command/timeout — підтверджено `vendor/codex-hooks.json`), тож
перевикористовує ту саму {@link mergeHooks}.
- syncCodexHooksConfig — Синхронізує `.codex/hooks.json` для Codex CLI: базовий PostToolUse lint-hook (правило-
незалежний, з темплейту `codex-hooks.template.json`, matcher `apply_patch` — best-guess,
див. JSDoc {@link ../../hook.mjs}) + опційні ADR Stop-hook групи. Codex не має rtk hook:
інтеграція rtk відбувається через пряму інструкцію в AGENTS.md.
На відміну від `.claude/settings.json` тут немає секції `permissions` — Codex тримає
дозволи окремо в `config.toml`.
- syncClaudeSettings — Синхронізує `.claude/settings.json` за темплейтом, зберігаючи решту
користувацьких полів.
- syncAdrHookScript — Копіює канонічний `.claude/hooks/capture-decisions.sh` з темплейту пакета.
- syncAdrNormalizeHookScript — Копіює канонічний `.claude/hooks/normalize-decisions.sh` з темплейту пакета.
- syncAdrHookLibScripts — Копіює всі `.sh`-файли з `.claude-template/hooks/lib/` у `.claude/hooks/lib/` проєкту.
Файли source-only (без exec bit) — їх `source`-ять capture/normalize-decisions.sh,
щоб не дублювати спільну bash-логіку (`is_tooling_only_change`,
`git_diff_only_version_field`).
Тека fully-owned: при кожному sync-у перезаписується.
- removeOrphanAdrHookLib — Видаляє `.claude/hooks/lib/` директорію з проєкту-споживача.
Викликається коли правило `adr` вимкнено — lib-файли не самостійні, без хуків,
що їх source-ять, вони нікому не потрібні (симетрично до `removeOrphanPiExtension`).
- syncPiExtensions — Копіює bundled pi.dev TS-extension `npm/.pi-template/extensions/n-rules-adr/` (усі файли —
`index.ts`, `tsconfig.json`, потенційні `package.json`/`.gitignore` тощо) у
`.pi/extensions/n-rules-adr/` проєкту-споживача (legacy `n-cursor-adr/` видаляється). Тека fully-owned: при кожному sync-у
перезаписується. Якщо bundled template відсутній (legacy-версії пакета без `.pi-template/`)
або в ньому немає `index.ts` — повертаємо `{written: false}` без помилки.

Розширення поверх `index.ts` (tsconfig тощо) потрібні, бо `.pi/extensions/` синхронізується як є
у проєкти-споживачі, а IDE/TS-сервер мусить резолвити `node:*` модулі без додаткових
project-wide конфігів.
- removeOrphanPiExtension — Видаляє `.pi/extensions/n-rules-adr/` (і legacy `n-cursor-adr/`) директорію з проєкту-споживача.
Викликається коли правило `adr` вимкнено у `.n-rules.json` (симетрично до
cleanup-у `.claude/hooks/{capture,normalize}-decisions.sh`).
- RTK_PI_EXTENSION_FILE — Ім'я файлу rtk pi-extension — той самий шлях, що пише `rtk init --agent pi` (повторна установка ідемпотентна).
- syncRtkPiExtension — Копіює vendored rtk pi-extension `npm/.pi-template/extensions/rtk.ts` у
`.pi/extensions/rtk.ts` проєкту-споживача (правило `local-ai`). Файл fully-owned:
при кожному sync-у перезаписується. Якщо bundled template відсутній — `{written: false}`.
- removeOrphanRtkPiExtension — Видаляє `.pi/extensions/rtk.ts` з проєкту-споживача. Викликається, коли правило
`local-ai` вимкнено у `.n-rules.json` (симетрично до cleanup-у hook-записів).
Шлях спільний з `rtk init --agent pi`, тож прибереться і встановлений вручну файл.
- syncGitignoreAdrFragment — Дописує в кореневий `.gitignore` проєкту відсутні рядки з канонічного ADR-фрагмента.
- syncClaudeCommands — Копіює всі slash-команди з `templateDir/commands/` у `.claude/commands/`.
Команди ідентифікуються тим, що вони лежать у темплейті — не перетинаються
з командами скілів (n-fix, n-lint, ...).
- syncClaudeConfig — Виконує повну синхронізацію Claude Code-конфігу з темплейту пакету в проєкт.
Використовується з `bin/n-rules.js` після інших синків.

## Сценарії використання

- `npm/scripts/tests/sync-claude-config.test.mjs` (mergeAllowList; mergeHooks) — union без дублікатів, порядок: спочатку існуючі; обробляє undefined по обидва боки; видаляє managed-групу (у т.ч. legacy; зберігає користувацькі групи поряд з managed; legacy Stop-hook (; ще 44

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Свідомо пропускає шляхи: `.git`.
