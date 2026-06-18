---
type: ADR
title: "PostToolUse з інкрементальною маршрутизацією за типом файлу"
---

# PostToolUse з інкрементальною маршрутизацією за типом файлу

**Status:** Accepted
**Date:** 2026-05-25

## Context and Problem Statement

Синхронний `Stop` hook запускав повний `n-fix` (15–20 правил послідовно) на кожному turn-і, незалежно від змінених файлів. Timeout 60s вбивав хук при холодному кеші навіть при коректному коді.

## Considered Options

* Лишити Stop-hook, підняти timeout до 600s
* `PostToolUse` з грубим фільтром (matcher `Edit|Write|MultiEdit`, але повний `fix`)
* `PostToolUse` з точковою маршрутизацією за `tool_input.file_path`
* `PostToolUse` + лишити Stop як backstop із timeout 600s

## Decision Outcome

Chosen option: "PostToolUse з точковою маршрутизацією без Stop-hook backstop", because користувач явно обрав точкову маршрутизацію і повне видалення Stop-hook, довіривши дисципліну `PostToolUse` + ручному `/n-fix` перед PR.

### Consequences

* Good, because після правки одного `.mjs` крутиться лише `js-lint`, а не 18 правил.
* Good, because `stop-hook` CLI subcommand видалено одразу без deprecation; legacy cleanup у `sync-claude-config.mjs` прибирає старі Stop-entries автоматично.
* Good, because routing-таблиця на Bun (.mjs) з `picomatch` покрита 21 unit-тестом.
* Bad, because якщо агент модифікував файли через `Bash` (не `Edit/Write`), `PostToolUse` не спрацьовує.

## More Information

- `npm/scripts/post-tool-use-fix.mjs` — `routeFilePathToRules(filePath)` з `picomatch`
- Routing: `*.{mjs,js,cjs,ts,tsx,jsx}` → `js-lint`; `*.vue` → `js-lint,style-lint,vue`; `*.{css,scss,sass}` → `style-lint`; `**/k8s/**/*.{yaml,yml}` → `k8s`; `*.rego` → `rego`; `Dockerfile*` → `docker`; `.github/workflows/*.{yml,yaml}` → `ga`; `**/*.md` (поза `docs/adr/`) → `text`; `**/package.json` → `npm-module,bun`
- CLI: `case 'post-tool-use-fix'` у `npm/bin/n-cursor.js`
- `npm/.claude-template/settings.template.json` — `hooks.PostToolUse`, matcher `Edit|Write|MultiEdit`, timeout 300
- `npm/scripts/sync-claude-config.mjs` — `MANAGED_HOOK_COMMAND_MARKER` + `LEGACY_STOP_HOOK_COMMAND_MARKER`
- Видалено: `npm/scripts/claude-stop-hook.mjs`, `case 'stop-hook'` з `npm/bin/n-cursor.js`
- `adr` правило виключено з маршрутизації — залишено в async `normalize-decisions.sh`
- Пакет: `1.20.0 → 1.21.0` (BREAKING)
