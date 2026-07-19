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
- .cursor/rules/n-local-ai.mdc
- .cursor/rules/n-npm-module.mdc
- .cursor/rules/n-python.mdc
- .cursor/rules/n-rego.mdc
- .cursor/rules/n-rust.mdc
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
- `.cursor/skills/n-brainstorming/SKILL.md` — Фасилітація структурованої генерації ідей для будь-якої теми — продуктові фічі, архітектурні рішення, бізнес-стратегія, назви, маркетинг, вирішення проблем. ОБОВ'ЯЗКОВО використовуй цей skill, коли користувач каже "давай побрейнштормимо", "накидай ідей", "хочу подумати над X", "які є варіанти для...", просить допомогти придумати щось з нуля, або коли задача явно на стадії "ще не зрозуміло що робити" (на відміну від "вже зрозуміло що робити, допоможи зробити"). Не використовуй для чистого уточнення вимог до вже визначеної фічі (це просто уточнюючі питання, без техніки генерації) і не використовуй, якщо користувач вже приніс готове рішення і просить його реалізувати.
- `.cursor/skills/n-doc-files/SKILL.md` — Обовʼязковий крок задачі (як lint): для кожного зміненого/нового кодового файлу (розширення декларують lang-плагіни: js/mjs/ts/vue — lang-js, rs/py — lang-rust/lang-python) JS-оркестрована генерація лаконічної поведінкової української md-документації у теку docs/ поряд із кодом, зі звіркою застарілості за CRC у frontmatter
- `.cursor/skills/n-lint/SKILL.md` — Запустити дельта-лінт (npx @7n/rules lint) по змінених файлах vs origin, виправити порушення й підтвердити чистий вихід
- `.cursor/skills/n-llm-patch/SKILL.md` — Підготовка самодостатнього текстового промпта для іншого Claude/Cursor-агента — read-only аналіз CWD без жодних змін у поточному репо
- `.cursor/skills/n-publish-telegram/SKILL.md` — Підготовка матеріалу з поточного контексту для публікації в Telegram-каналі команди
- `.cursor/skills/n-taze/SKILL.md` — Оновлення версій модулів проекту до останніх (усі екосистеми — JS/npm, Rust, Python тощо — через активні lang-плагіни) з аналізом major-змін і автоматичним рефакторингом несумісного коду

## Commands

Generated from the root `package.json` on each `npx @7n/rules` sync. Prefer `bun run <script>` for project scripts.

- **Залежності**: `bun i`
- **test**: `bun run test`
- **start**: `bun run start`
- **Оновити правила та AGENTS.md** (після змін у правилах/шаблоні CLI): `npx @7n/rules`
- **Перевірки правил (programmatic)**: `npx @7n/rules lint`
- **knip (невикористані залежності та експорти)**: `bunx knip`

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
