# Автоматичне додавання `.gitignore`-фрагмента для артефактів ADR Stop-hook'ів

**Status:** Accepted
**Date:** 2026-05-20

## Context and Problem Statement

Локальні артефакти ADR Stop-hook'ів (`.claude/hooks/capture-decisions.log`, `.claude/hooks/normalize-decisions.log`, `.claude/hooks/.normalize-state`, `.claude/hooks/.normalize.lock`) потрапляли до `git status` споживчих репозиторіїв як неперевірені файли. Потрібно визначити, де зберігати канонічний перелік шаблонів ігнорування і як доставляти їх у проєкти без ручних кроків.

## Considered Options

* Канонічний `.gitignore.snippet` у tarball пакета + автоматичне злиття під час `npx @nitra/cursor`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Канонічний `.gitignore.snippet` у tarball пакета + автоматичне злиття через `sync-claude-config.mjs`", because це відповідає вже наявному патерну sync — той самий `npx @nitra/cursor` вже копіює hook-скрипти і керує `settings.json`; додавання `.gitignore`-злиття у ту саму точку входу не потребує окремого кроку від розробника.

### Consequences

* Good, because `npx @nitra/cursor` сам дописує відсутні рядки до кореневого `.gitignore` споживача без дублювання, коли в `.n-cursor.json` увімкнено правило `adr`.
* Good, because існуючі рядки в `.gitignore` не зачіпаються і не дублюються.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

* Новий файл: `npm/rules/adr/fix/hooks/template/.gitignore.snippet`:
  ```
  # @nitra/cursor (adr) — локальні артефакти Stop-hook, не коміти
  .claude/hooks/*.log
  .claude/hooks/.normalize-state
  .claude/hooks/.normalize.lock
  ```
* Логіка злиття додана до `npm/scripts/sync-claude-config.mjs`; константа `ADR_GITIGNORE_SNIPPET_REL`.
* Тест: `npm/scripts/sync-claude-config.test.mjs` — `'з правилом "adr": дописує канонічний фрагмент у .gitignore'`.
* `npm/rules/adr/adr.mdc` оновлено: рядки покриваються автоматично через `npx @nitra/cursor`.
* Bump: `npm/package.json` `1.13.63` → `1.13.64`; запис у `npm/CHANGELOG.md` `## [1.13.64]` секція `### Added`.

## Update 2026-05-20

Деталі реалізації у `sync-claude-config.mjs`: нова функція `parseGitignoreLines` (або аналогічна) і константа `ADR_GITIGNORE_SNIPPET_REL` додані до публічного API модуля; прапорець `gitignore` повертається у результаті `syncClaudeConfig`; CLI (`npm/bin/n-cursor.js`) виводить шлях `.gitignore` після злиття.

Для проєктів, де артефакт вже потрапив до git-індексу: `git rm --cached .claude/hooks/capture-decisions.log`.

## Update 2026-05-20

Розширення сніпету: базові рядки (`node_modules/`, `dist/`, `*.secret`) з кореневого `.gitignore` (рядки 1–5) додано на початок `npm/rules/adr/fix/hooks/template/.gitignore.snippet`; ADR-специфічні записи залишаються під секцією `# @nitra/cursor (adr)`. Злиття є ідемпотентним: функція `mergeGitignoreSnippet` додає лише відсутні рядки — існуючі не перезаписуються. Оновлено тестові fixtures у `npm/scripts/sync-claude-config.test.mjs`.
