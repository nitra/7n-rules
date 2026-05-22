# AGENTS.md version: '1.0'

## Purpose

This file is the entry point for all AI agents working with this repository.

## Rule source

The primary development rules are stored in the Cursor rules directory:

- .cursor/rules/conftest.mdc
- .cursor/rules/dev-dep.mdc
- .cursor/rules/n-adr.mdc
- .cursor/rules/n-bun.mdc
- .cursor/rules/n-changelog.mdc
- .cursor/rules/n-ci4.mdc
- .cursor/rules/n-feedback.mdc
- .cursor/rules/n-ga.mdc
- .cursor/rules/n-js-lint.mdc
- .cursor/rules/n-js-run.mdc
- .cursor/rules/n-npm-module.mdc
- .cursor/rules/n-rego.mdc
- .cursor/rules/n-security.mdc
- .cursor/rules/n-style-lint.mdc
- .cursor/rules/n-text.mdc
- .cursor/rules/n-vue.mdc
- .cursor/rules/scripts.mdc

## Skills

- `.cursor/skills/mdc-check/SKILL.md` — Проаналізувати правило в npm/mdc: максимум перевірюваної логіки й деталей — у check-{id}.mjs з зрозумілими коментарями/JSDoc; у .mdc залишати людинозрозумілий зміст без дублювання алгоритму перевірки
- `.cursor/skills/n-adr-normalize/SKILL.md` — Ручний запуск ADR-нормалізації — обхід порогу й min-interval, прогон одного батчу чернеток через LLM, перегляд результату через git diff
- `.cursor/skills/n-fix/SKILL.md` — Виправити проєкт відповідно до всіх правил в .cursor/rules/
- `.cursor/skills/n-lint/SKILL.md` — Запустити кореневий bun run lint, виправити порушення й підтвердити чистий вихід
- `.cursor/skills/n-llm-patch/SKILL.md` — Підготовка самодостатнього текстового промпта для іншого Claude/Cursor-агента — read-only аналіз CWD без жодних змін у поточному репо
- `.cursor/skills/n-publish-telegram/SKILL.md` — Підготовка матеріалу з поточного контексту для публікації в Telegram-каналі команди
- `.cursor/skills/n-start-check/SKILL.md` — Smoke-перевірка bun-монорепо: зайти в кожен воркспейс зі `start`-скриптом, прогнати `start` і зафіксувати, чи проєкт взагалі запускається без негайного краху
- `.cursor/skills/n-taze/SKILL.md` — Оновлення версій модулів проекту з аналізом major-змін і автоматичним рефакторингом несумісного коду

## Commands

Generated from the root `package.json` on each `npx @nitra/cursor` sync. Prefer `bun run <script>` for project scripts.

- **Залежності**: `bun i`
- **test**: `bun run test`
- **lint**: `bun run lint`
- **lint-js**: `bun run lint-js`
- **lint-text**: `bun run lint-text`
- **lint-ga**: `bun run lint-ga`
- **start**: `bun run start`
- **lint-rego**: `bun run lint-rego`
- **lint-security**: `bun run lint-security`
- **lint-style**: `bun run lint-style`
- **Оновити правила та AGENTS.md** (після змін у правилах/шаблоні CLI): `npx @nitra/cursor`
- **Перевірки правил (programmatic)**: `npx @nitra/cursor check`
- **knip (невикористані залежності та експорти)**: `bunx knip`

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
