# Синхронний Stop hook як блокуючий quality gate

**Status:** Accepted
**Date:** 2026-05-25

## Context and Problem Statement

Проєкт потребував механізму, що гарантує відсутність порушень правил `.cursor/rules/` до повернення керування користувачу після кожного turn-а агента. Без нього агент міг завершити хід із порушеним кодом і не відреагувати.

## Considered Options

- Синхронний `Stop` hook із `npx --no @nitra/cursor stop-hook` (exit 2 блокує завершення)
- `async: true` для `stop-hook` (fire-and-forget, не блокує)
- `PostToolUse` hook з `matcher: "Edit|Write"` і фільтрацією лише змінених правил
- Виклик повного `fix` лише через ручну команду `/n-fix`

## Decision Outcome

Chosen option: "Синхронний `Stop` hook із `npx --no @nitra/cursor stop-hook`", because потрібна жорстка гарантія: агент не може повернути керування поки `npx @nitra/cursor fix` не завершиться з `0`. Exit code `2` повертає stderr агенту як інструкцію «не зупиняйся, виправ це».

### Consequences

- Good, because агент фізично не може завершити хід із порушеними правилами.
- Good, because захист від нескінченної рекурсії: хук читає `stop_hook_active` зі stdin — якщо `true`, виходить з `0` без запуску `fix`.
- Good, because два async Stop-хуки (capture-decisions.sh, normalize-decisions.sh) не блокують завершення turn-а.
- Bad, because `stop-hook` спавнить `bun rules/<id>/fix.mjs` послідовно для ~15–20 правил на кожному Stop-турні; кумулятивна вартість перевищує `timeout 60s` при холодному кеші.
- Bad, because правила k8s/rego прогоняться по всьому дереву незалежно від того, чи turn торкався відповідних файлів.

## More Information

- `.claude/settings.json` → `hooks.Stop[0]`: `npx --no @nitra/cursor stop-hook`, timeout 60s, async false
- `npm/scripts/claude-stop-hook.mjs` — читає stdin, перевіряє `stop_hook_active`, спавнить `npx --no @nitra/cursor fix`; exit code `2` → Claude Code повертає stderr агенту
- `.claude/hooks/capture-decisions.sh` (timeout 180s, async true), `.claude/hooks/normalize-decisions.sh` (timeout 600s, async true) — fire-and-forget
- Обговорені, але не прийняті: підняти timeout до 300–600s; `PostToolUse` з matcher (найчесніший виграш у продуктивності); disable через `.claude/settings.local.json`
- Примітка: рішення пізніше замінено на PostToolUse з інкрементальною маршрутизацією
