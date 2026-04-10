# AGENTS.md version: '1.0'

## Purpose

This file is the entry point for all AI agents working with this repository.

## Rule source

The primary development rules are stored in the Cursor rules directory:

- .cursor/rules/dev-dep.mdc

- .cursor/rules/n-bun.mdc

- .cursor/rules/n-ga.mdc

- .cursor/rules/n-js-lint.mdc

- .cursor/rules/n-npm-module.mdc

- .cursor/rules/n-text.mdc

- .cursor/rules/scripts.mdc

## Skills

- `.cursor/skills/n-fix/SKILL.md` — Виправити проєкт відповідно до всіх правил в .cursor/rules/

- `.cursor/skills/n-publish-telegram/SKILL.md` — Підготовка матеріалу з поточного контексту для публікації в Telegram-каналі команди

## Instructions for all agents

Before making changes, read the relevant rule files for the area you are working on.

## Priority

If rules conflict:

1. AGENTS.md
2. task-specific rule file
3. core rule file

## Language

Respond in Ukrainian.
Keep technical terms in English.

## Behavior

Do not ignore referenced rule files.
Explicitly follow repository conventions before proposing or applying changes.
