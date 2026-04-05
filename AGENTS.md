# AGENTS.md version: '1.0'

## Purpose

This file is the entry point for all AI agents working with this repository.

## Rule source

The primary development rules are stored in the Cursor rules directory:


- .cursor/rules/n-bun.mdc

- .cursor/rules/n-ga.mdc

- .cursor/rules/n-js-format.mdc

- .cursor/rules/n-js-lint.mdc

- .cursor/rules/n-npm-module.mdc

- .cursor/rules/n-spell.mdc

- .cursor/rules/script.mdc


## Skills


- `.cursor/skills/n-fix-cursor/SKILL.md` — Fix project to comply with all n cursor rules. Use when the user asks to fix the project, apply rules, make project compliant, or mentions fix-cursor or n-fix-cursor. Runs diagnostics, identifies violations, applies fixes, and verifies the result.

- `.cursor/skills/n-publish-telegram/SKILL.md` — Викликається командою /publish-telegram. Підготовка матеріалу з поточного контексту для публікації в Telegram-каналі команди моноширним шрифтом. Use when the user says /publish-telegram, publish, or asks to prepare material for Telegram channel sharing with the dev team.


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
