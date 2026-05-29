# Синхронний Stop hook як quality gate та async hooks для ADR-автоматизації

**Status:** Accepted
**Date:** 2026-05-25

## Context and Problem Statement

Після кожного turn-а агента (Claude Code) правила з `.cursor/rules/` могли бути порушені. Без примусового контролю агент завершував хід без гарантії чистоти. Додатково: `capture-decisions.sh` і `normalize-decisions.sh` потребували асинхронного запуску, щоб не затримувати повернення керування.

## Considered Options

* Синхронний `Stop` hook із `npx --no @nitra/cursor stop-hook` (exit 2 блокує завершення)
* `async: true` для `stop-hook` (fire-and-forget, усуває гарантію)
* `PostToolUse` hook із фільтрацією лише змінених правил
* Виклик повного `fix` лише через ручну команду `/n-fix`

## Decision Outcome

Chosen option: "Синхронний `Stop` hook + async hooks для ADR-автоматизації", because потрібна жорстка гарантія: агент не може повернути керування поки `npx @nitra/cursor fix` не завершиться з `0`; async для ADR-хуків не додає затримки.

### Consequences

* Good, because жорстка дисципліна якості без покладання на свідомість агента.
* Good, because ADR-автоматизація fire-and-forget: `capture-decisions.sh` (180s, async), `normalize-decisions.sh` (600s, async).
* Good, because захист від рекурсії: `claude-stop-hook.mjs` читає `stop_hook_active` зі stdin — якщо `true`, виходить з `0` без повторного `fix`.
* Bad, because ~15–20 правил послідовно на кожному turn-і; кумулятивна затримка перевищує `timeout 60s` при холодному кеші.
* Bad, because правила k8s/rego прогоняться по всьому дереву, навіть якщо turn їх не торкався.

## More Information

- `.claude/settings.json` → `hooks.Stop[0]`: `npx --no @nitra/cursor stop-hook`, `timeout: 60`, `async: false`
- `npm/scripts/claude-stop-hook.mjs` — читає stdin, перевіряє `stop_hook_active`, спавнить `fix`; exit 2 → Claude Code повертає stderr агенту
- `hooks.Stop[1]`: `.claude/hooks/capture-decisions.sh`, timeout 180, async true
- `hooks.Stop[2]`: `.claude/hooks/normalize-decisions.sh`, timeout 600, async true
- Disable для важких сесій: `.claude/settings.local.json`
- Замінено на PostToolUse з інкрементальною маршрутизацією у version 1.21.0

## Update 2026-05-25

Додаткова деталь щодо захисту від рекурсії: `claude-stop-hook.mjs` першим ділом читає stdin; при `stop_hook_active: true` негайно виходить з `exit 0`. Поле `stop_hook_active` надходить від Claude Code у stdin у форматі JSON при повторному виклику після блокування (exit 2). Гарантується, що другий Stop у межах одного циклу не запускає `fix` рекурсивно.
