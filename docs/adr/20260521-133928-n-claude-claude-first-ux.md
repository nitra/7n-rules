---
type: ADR
title: "Claude-first UX: підкоманда `claude` і bin `n-claude`"
---

# Claude-first UX: підкоманда `claude` і bin `n-claude`

**Status:** Accepted
**Date:** 2026-05-21

## Context and Problem Statement

Після появи команди `skill claude taze` виникла потреба в інвертованому порядку аргументів — спочатку «запускач», потім скіл, за аналогією з нативним Claude CLI: `npx @nitra/cursor claude taze`.

## Considered Options

* Bin із іменем `claude` у пакеті `@nitra/cursor`
* Підкоманда `claude` у `n-cursor` + окремий bin `n-claude`; для `claude taze` у терміналі — alias у shell

## Decision Outcome

Chosen option: "Підкоманда `claude` у `n-cursor` + bin `n-claude`", because ім'я bin `claude` конфліктує з Anthropic Claude Code CLI — при глобальній установці обидва конкурували б за одну команду; `n-claude` безпечно співіснує.

### Consequences

* Good, because `npx @nitra/cursor claude taze` і `npx -p @nitra/cursor n-claude lint "task"` працюють без конфлікту з Anthropic Claude Code CLI.
* Bad, because bin не може називатися `claude` — для точного UX `claude taze` потрібен alias у `~/.zshrc`.
* Neutral, because transcript не містить підтвердження того, що alias-підхід задовольняє потребу.

## More Information

Нові файли: `npm/bin/n-claude.js` (делегує до `runClaudeFirstSkillsCli` з `skills-cli.mjs`).
Зміни: `npm/bin/n-cursor.js` — `case 'claude': runClaudeFirstSkillsCli(args)`; `npm/scripts/skills-cli.mjs` — нові експорти `runClaudeFirstSkillsCli`, `mapClaudeFirstArgv`, `CLAUDE_FIRST_USAGE_LINES`; `npm/package.json` — bin `n-claude`, версія `1.13.71`.
`mapClaudeFirstArgv` перетворює `[skillId, ...task]` → `['claude', skillId, ...task]`.
Рекомендований alias у `~/.zshrc`: `alias ccode='command claude'; claude() { npx -p @nitra/cursor n-claude "$@"; }`.
Тести `mapClaudeFirstArgv` та `runClaudeFirstSkillsCli` у `npm/scripts/skills-cli.test.mjs`.

## Update 2026-05-21

Додаткові форми виклику: `npx @nitra/cursor claude taze` (без тексту завдання), `n-claude list` (перелік скілів). Версія `1.13.71`. Рекомендований alias підтверджено: `alias ccode='command claude'; claude() { npx -p @nitra/cursor n-claude "$@"; }`.
