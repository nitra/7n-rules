---
session: a159a310-54ca-4004-9344-9a953824d66b
captured: 2026-05-25T21:58:03+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/a159a310-54ca-4004-9344-9a953824d66b.jsonl
---

## ADR Заміна синхронного Stop-hook на PostToolUse з інкрементальною маршрутизацією за типом файлу

## Context and Problem Statement
Синхронний `Stop` hook (`npx --no @nitra/cursor stop-hook`) запускав повний `n-fix` усіх правил (15–20 правил поспіль) на **кожному** turn-і Claude Code. Це призводило до кумулятивної затримки (ESLint, stylelint, kubeconform тощо — послідовно на кожен хід), а timeout 60s вбивав хук навіть при коректному коді на великих репо.

## Considered Options
* Лишити Stop-hook, підняти timeout до 600s (не зменшує ціни, лише прибирає фальшиві помилки)
* Перенести в `PostToolUse` з грубим фільтром по типу інструмента (Variant A: matcher `Edit|Write|MultiEdit`, але все одно повний `fix`)
* Перенести в `PostToolUse` з точковою маршрутизацією за `tool_input.file_path` (Variant B): `*.mjs` → `js-lint`, `*.vue` → `js-lint,style-lint,vue`, `k8s/**/*.yaml` → `k8s`, тощо
* Перенести в `PostToolUse`, лишити Stop як backstop із timeout 600s

## Decision Outcome
Chosen option: "PostToolUse з точковою маршрутизацією (Variant B) без Stop-hook backstop", because користувач явно вибрав Variant B і повне видалення Stop-hook, довіривши дисципліну `PostToolUse` + ручному `/n-fix` перед PR.

### Consequences
* Good, because транскрипт фіксує очікувану користь: після правки одного `.mjs` крутиться лише `js-lint`, а не 18 правил — реальне скорочення часу на кожному turn-і.
* Bad, because транскрипт підтверджує компроміс: якщо агент модифікував файли через `Bash`-команди (а не `Edit/Write`), `PostToolUse` не спрацьовує і порушення не буде знайдено автоматично.

## More Information
- Нова точка входу: `npm/scripts/post-tool-use-fix.mjs` — `routeFilePathToRules(filePath)` + `runPostToolUseFixCli({stdinJson, spawnFn})`
- CLI subcommand: `case 'post-tool-use-fix'` у `npm/bin/n-cursor.js`
- Template: `npm/.claude-template/settings.template.json` — `hooks.PostToolUse`, matcher `Edit|Write|MultiEdit`, timeout 300
- Sync-скрипт: `npm/scripts/sync-claude-config.mjs` — `MANAGED_HOOK_COMMAND_MARKER = '@nitra/cursor post-tool-use-fix'` + `LEGACY_STOP_HOOK_COMMAND_MARKER` для очищення старих інсталяцій консьюмерів
- Тести router: 21 test у `npm/scripts/tests/post-tool-use-fix.test.mjs`, всі pass
- `adr` правило свідомо **виключено** з маршрутизації (залишено в існуючому async `normalize-decisions.sh` Stop-hook)
- Версія пакета: 1.20.0 → 1.21.0 (minor, BREAKING)

---

## ADR Негайне видалення CLI subcommand `stop-hook` без deprecation-периоду

## Context and Problem Statement
CLI subcommand `stop-hook` (`npx @nitra/cursor stop-hook`) реалізований у `npm/bin/n-cursor.js` і `npm/scripts/claude-stop-hook.mjs` втратив сенс після заміни Stop-hook на PostToolUse. Постало питання: прибрати відразу (breaking) чи лишити як no-op із deprecation warning на 1–2 версії.

## Considered Options
* Видалити одразу (breaking у мажорній поведінці, але minor bump пакета)
* Лишити як no-op із `console.warn` на 1–2 версії, потім видалити

## Decision Outcome
Chosen option: "Видалити одразу", because користувач явно відповів "1 — одразу" у відповідь на запитання про backward compat.

### Consequences
* Good, because транскрипт фіксує очікувану користь: відсутній мертвий код, жодного додаткового тестового навантаження.
* Bad, because транскрипт не містить підтверджених негативних наслідків. Консьюмери, які явно викликали `stop-hook` не через template sync, отримають `unknown command`.

## More Information
- Видалено: `npm/scripts/claude-stop-hook.mjs` (разом із тестом)
- Видалено: `case 'stop-hook'` з `npm/bin/n-cursor.js:1430`
- Видалено: `import { runStopHookCli }` з `npm/bin/n-cursor.js:86`
- Legacy cleanup у `sync-claude-config.mjs`: `LEGACY_STOP_HOOK_COMMAND_MARKER = '@nitra/cursor stop-hook'` автоматично прибирає старі Stop-entries зі `.claude/settings.json` консьюмерів під час наступного `npx @nitra/cursor`
- Версія пакета: 1.21.0 (BREAKING задокументовано в `CHANGELOG.md`)

---

## ADR Реалізація PostToolUse-маршрутизатора на Bun (.mjs), а не на bash

## Context and Problem Statement
PostToolUse hook потребував скрипта-маршрутизатора, який парсить stdin JSON Claude Code (`tool_input.file_path`) і будує список правил для запуску. Необхідно було обрати рантайм: bash або Bun.

## Considered Options
* Bash — зберігає dependency тільки на shell
* Bun (.mjs) — читабельна routing-таблиця, легкий `picomatch`-матчинг, TDD-тестування

## Decision Outcome
Chosen option: "Bun (.mjs)", because користувач явно відповів "2 — bun"; транскрипт підкріплює це тим, що Bun вже є базовим runtime у всіх репо, які використовують `@nitra/cursor`.

### Consequences
* Good, because транскрипт фіксує очікувану користь: routing-таблиця читабельна, повністю вкрита unit-тестами (21 тест), `picomatch` уже у deps пакета.
* Bad, because транскрипт не містить підтверджених негативних наслідків. (Теоретично: репо без Bun не зможе використати хук; але такого сценарію в transcript не зафіксовано.)

## More Information
- Файл: `npm/scripts/post-tool-use-fix.mjs` — `routeFilePathToRules(filePath)` використовує `picomatch` для glob-матчингу
- Routing-таблиця покриває: `*.{mjs,js,cjs,ts,tsx,jsx}` → `js-lint`; `*.vue` → `js-lint,style-lint,vue`; `*.{css,scss,sass}` → `style-lint`; `**/k8s/**/*.{yaml,yml}` → `k8s`; `*.rego` → `rego`; `Dockerfile*` → `docker`; `.github/workflows/*.{yml,yaml}` → `ga`; `**/*.md` (поза `docs/adr/`) → `text`; `**/package.json` → `npm-module,bun`
- Smoke-тест: `echo '{"tool_name":"Edit","tool_input":{"file_path":"npm/scripts/post-tool-use-fix.mjs"}}' | bun ...` → `SPAWN: npx --no @nitra/cursor fix js-lint`, exit 0
- Тести: `npm/scripts/tests/post-tool-use-fix.test.mjs` — 21 pass із `makeFakeChild`-mock для EventEmitter
