# AGENTS.md version: '1.0'

## Purpose

This file is the entry point for all AI agents working with this repository.

## Rule source

The primary development rules are stored in the Cursor rules directory:

{{#services}}
{{name}}
{{/services}}

## Skills

{{#skills}}
{{name}}
{{/skills}}

## Commands

Generated from the root `package.json` on each `npx @7n/rules` sync. Prefer `bun run <script>` for project scripts.

{{#commands}}
{{name}}
{{/commands}}

## Instructions for all agents

Before making changes, read the relevant rule files for the area you are working on.

## Інваріант після змін

`n-changelog.mdc` (alwaysApply) релевантне після **будь-якої** зміни файлів, не лише для релізу. Перед фінальною відповіддю виконай `npx @7n/rules lint changelog` (exit `0`) і познач результат рядком `Changelog: …` у відповіді.

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
