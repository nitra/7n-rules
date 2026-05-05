# AGENTS.md version: '1.0'

## Purpose

This file is the entry point for all AI agents working with this repository.

## Rule source

The primary development rules are stored in the Cursor rules directory:


- .cursor/rules/dev-dep.mdc

- .cursor/rules/n-bun.mdc

- .cursor/rules/n-ga.mdc

- .cursor/rules/n-image.mdc

- .cursor/rules/n-js-bun-db.mdc

- .cursor/rules/n-js-lint.mdc

- .cursor/rules/n-js-run.mdc

- .cursor/rules/n-nginx-default-tpl.mdc

- .cursor/rules/n-npm-module.mdc

- .cursor/rules/n-style-lint.mdc

- .cursor/rules/n-text.mdc

- .cursor/rules/n-vue.mdc

- .cursor/rules/scripts.mdc


## Skills


- `.cursor/skills/mdc-check/SKILL.md` — Проаналізувати правило в npm/mdc: максимум перевірюваної логіки й деталей — у check-{id}.mjs з зрозумілими коментарями/JSDoc; у .mdc залишати людинозрозумілий зміст без дублювання алгоритму перевірки

- `.cursor/skills/n-fix/SKILL.md` — Виправити проєкт відповідно до всіх правил в .cursor/rules/

- `.cursor/skills/n-lint/SKILL.md` — Запустити кореневий bun run lint, виправити порушення й підтвердити чистий вихід

- `.cursor/skills/n-publish-telegram/SKILL.md` — Підготовка матеріалу з поточного контексту для публікації в Telegram-каналі команди


## Commands

Generated from the root `package.json` on each `npx @nitra/cursor` sync. Prefer `bun run <script>` for project scripts.


- **Залежності**: `bun i`

- **test**: `bun run test`

- **lint**: `bun run lint`

- **lint-js**: `bun run lint-js`

- **lint-text**: `bun run lint-text`

- **lint-ga**: `bun run lint-ga`

- **lint-k8s**: `bun run lint-k8s`

- **lint-docker**: `bun run lint-docker`

- **start**: `bun run start`

- **lint-image**: `bun run lint-image`

- **lint-style**: `bun run lint-style`

- **Оновити правила та AGENTS.md** (після змін у правилах/шаблоні CLI): `npx @nitra/cursor`

- **Перевірки правил (programmatic)**: `npx @nitra/cursor check`


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
