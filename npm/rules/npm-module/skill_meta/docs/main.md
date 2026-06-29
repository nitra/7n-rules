---
type: JS Module
title: main.mjs
resource: npm/rules/npm-module/skill_meta/main.mjs
docgen:
  crc: 276c5ebf
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

system_message:
You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
(none)

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:

- Be concise in your responses
- Show file paths clearly when working with files

Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):

- Main documentation: /Users/vitalii/www/nitra/cursor/node_modules/@earendil-works/pi-coding-agent/README.md
- Additional docs: /Users/vitalii/www/nitra/cursor/node_modules/@earendil-works/pi-coding-agent/docs
- Examples: /Users/vitalii/www/nitra/cursor/node_modules/@earendil-works/pi-coding-agent/examples (extensions, custom tools, SDK)
- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md)
- When working on pi topics, read the pi .md files completely and follow .md cross-references before implementing
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)

<project_context>
Project-specific instructions and guidelines:

<project_instructions path="/Users/vitalii/www/nitra/cursor/AGENTS.md">

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
- .cursor/rules/n-doc-files.mdc
- .cursor/rules/n-feedback.mdc
- .cursor/rules/n-ga.mdc
- .cursor/rules/n-js-run.mdc
- .cursor/rules/n-js.mdc
- .cursor/rules/n-npm-module.mdc
- .cursor/rules/n-python.mdc
- .cursor/rules/n-rego.mdc
- .cursor/rules/n-security.mdc
- .cursor/rules/n-style.mdc
- .cursor/rules/n-test.mdc
- .cursor/rules/n-text.mdc
- .cursor/rules/n-tool-surface.mdc
- .cursor/rules/n-vue.mdc
- .cursor/rules/n-worktree.mdc
- .cursor/rules/scripts.mdc

## Skills

- `.cursor/skills/mdc-check/SKILL.md` — Проаналізувати правило в npm/mdc: максимум перевірюваної логіки й деталей — у check-{id}.mjs з зрозумілими коментарями/JSDoc; у .mdc залишати людинозрозумілий зміст без дублювання алгоритму перевірки
- `.cursor/skills/n-adr-normalize/SKILL.md` — Ручний запуск ADR-нормалізації — обхід порогу й min-interval, прогон одного батчу чернеток через LLM, перегляд результату через git diff
- `.cursor/skills/n-doc-files/SKILL.md` — Обовʼязковий крок задачі (як lint): для кожного зміненого/нового кодового файлу (js/mjs/ts/vue/py) JS-оркестрована генерація лаконічної поведінкової української md-документації у теку docs/ поряд із кодом, зі звіркою застарілості за CRC у frontmatter
- `.cursor/skills/n-lint/SKILL.md` — Запустити дельта-лінт (npx @nitra/cursor lint) по змінених файлах vs origin, виправити порушення й підтвердити чистий вихід
- `.cursor/skills/n-llm-patch/SKILL.md` — Підготовка самодостатнього текстового промпта для іншого Claude/Cursor-агента — read-only аналіз CWD без жодних змін у поточному репо
- `.cursor/skills/n-publish-telegram/SKILL.md` — Підготовка матеріалу з поточного контексту для публікації в Telegram-каналі команди
- `.cursor/skills/n-taze/SKILL.md` — Оновлення версій модулів проекту з аналізом major-змін і автоматичним рефакторингом несумісного коду

## Commands

Generated from the root `package.json` on each `npx @nitra/cursor` sync. Prefer `bun run <script>` for project scripts.

- **Залежності**: `bun i`
- **test**: `bun run test`
- **start**: `bun run start`
- **Оновити правила та AGENTS.md** (після змін у правилах/шаблоні CLI): `npx @nitra/cursor`
- **Перевірки правил (programmatic)**: `npx @nitra/cursor fix`
- **knip (невикористані залежності та експорти)**: `bunx knip`

## Instructions for all agents

Before making changes, read the relevant rule files for the area you are working on.

## Інваріант після змін

`n-changelog.mdc` (alwaysApply) релевантне після **будь-якої** зміни файлів, не лише для релізу. Перед фінальною відповіддю виконай `npx @nitra/cursor fix changelog` (exit `0`) і познач результат рядком `Changelog: …` у відповіді.

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

</project_instructions>
</project_context>

## Поведінка

Поведінка:

1. Перевіряє наявність каталогу `npm/skills` у корені репозиторію. Якщо відсутній, операція завершується успіхом.
2. Ітерується по всім підкаталогах у `npm/skills`. Для кожного каталогу виконується перевірка відповідності метаданих скіла.
3. Для кожного скіла перевіряється, чи відсутній файл `auto.md`. Якщо знайдено, фіксується порушення, оскільки метадані мають знаходитися у `main.json`.
4. Зчитується вміст `main.json` скіла. Якщо файл відсутній або недійсний, фіксується порушення.
5. Виконується перевірка полів у `main.json` скіла:
   - Перевіряється тип поля `worktree` — має бути булевим значенням.
   - Якщо поле `auto` визначене, аналізується його значення на відповідність очікуваним форматам.
   - Перевіряється тип поля `requireRoot` — має бути булевим значенням.
   - Перевіряється узгодженість: якщо `worktree` дорівнює `true`, поле `requireRoot` не може бути `false`.
   - Якщо поле `tier` визначене, воно має відповідати одному з визначених рівнів.
6. Якщо всі перевірки для скіла успішно пройдені, фіксується успішний статус для цього скіла.
7. Завершення виконання `main` та повернення коду виходу, що відображає кількість виявлених порушень.

## Публічний API

main — перевіряє, що всі файли `npm/skills/<id>/meta.json` відповідають встановленим вимогам.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
