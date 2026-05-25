---
session: a159a310-54ca-4004-9344-9a953824d66b
captured: 2026-05-25T21:05:58+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/a159a310-54ca-4004-9344-9a953824d66b.jsonl
---

## ADR Синхронний `Stop` hook як блокуючий quality gate перед поверненням керування

## Context and Problem Statement

Проєкт потребував механізму, що гарантує відсутність порушень правил `.cursor/rules/` **до** повернення керування користувачу після кожного turn-а. Без такого механізму агент міг завершити хід із «брудним» кодом і не відреагувати на порушення.

## Considered Options

* Синхронний `Stop` hook із `npx --no @nitra/cursor stop-hook` (exit 2 блокує завершення)
* `async: true` для `stop-hook` (fire-and-forget, не блокує)
* `PostToolUse` hook з `matcher: "Edit|Write"` і фільтрацією лише змінених правил
* Виклик повного `fix` лише через ручну команду `/n-fix`

## Decision Outcome

Chosen option: "Синхронний `Stop` hook із `npx --no @nitra/cursor stop-hook`", because потрібна **жорстка гарантія**: агент не може повернути керування поки `npx @nitra/cursor fix` не завершиться з `0`. Exit code `2` повертає stderr агенту як інструкцію «не зупиняйся, виправ це». Альтернативи з `async: true` або `PostToolUse` усувають блокуючу гарантію або знижують покриття.

### Consequences

* Good, because transcript фіксує очікувану користь: «не повертати юзеру керування з брудним кодом» — жорстка дисципліна якості без покладання на свідомість агента.
* Good, because захист від нескінченної рекурсії реалізований: хук читає `stop_hook_active` зі stdin — якщо `true`, виходить з `0` без запуску `fix`.
* Bad, because `stop-hook` спавнить `bun rules/<id>/fix.mjs` **послідовно** для ~15-20 правил на **кожному** Stop-турні (ESLint, stylelint, kubeconform, opa/regal, cspell, markdownlint, hadolint, shellcheck); кумулятивна вартість перевищує `timeout 60s` при холодному кеші — Claude Code вбиває хук, навіть якщо правила ОК.
* Bad, because дублює роботу: правила k8s/rego прогоняться по всьому дереву, навіть якщо turn-и не торкались відповідних файлів.

## More Information

* Конфіг: `/Users/vitaliytv/www/nitra/cursor/.claude/settings.json` — `hooks.Stop[0]`, `timeout: 60`, `async: false`
* Реалізація хука: `npm/scripts/claude-stop-hook.mjs` — читає stdin, перевіряє `stop_hook_active`, спавнить `npx --no @nitra/cursor fix` з `stdio: 'inherit'`
* Два додаткові Stop-хуки у тому ж конфізі — `.claude/hooks/capture-decisions.sh` (async, timeout 180s) і `.claude/hooks/normalize-decisions.sh` (async, timeout 600s) — запускаються у фоні й не блокують завершення turn-а
* Обговорені, але не прийняті альтернативи: підняти `timeout` до 300-600s (не знижує вартість, усуває лише фальшиві вбивства); `PostToolUse` із `matcher: "Edit|Write"` (найчесніший виграш у продуктивності); disable через `.claude/settings.local.json` для важких сесій
