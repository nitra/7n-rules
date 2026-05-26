<!-- Цей файл генерується автоматично через `npx @nitra/cursor`. Не редагуй вручну. -->

## Захищені директорії

Ніколи не змінюй, не видаляй і не створюй файли у цих директоріях:

- `.claude/worktrees/`

@.cursor/rules/conftest.mdc
@.cursor/rules/dev-dep.mdc
@.cursor/rules/n-adr.mdc
@.cursor/rules/n-bun.mdc
@.cursor/rules/n-changelog.mdc
@.cursor/rules/n-ci4.mdc
@.cursor/rules/n-feedback.mdc
@.cursor/rules/n-ga.mdc
@.cursor/rules/n-js-lint.mdc
@.cursor/rules/n-js-run.mdc
@.cursor/rules/n-npm-module.mdc
@.cursor/rules/n-rego.mdc
@.cursor/rules/n-security.mdc
@.cursor/rules/n-style-lint.mdc
@.cursor/rules/n-test.mdc
@.cursor/rules/n-text.mdc
@.cursor/rules/n-vue.mdc
@.cursor/rules/scripts.mdc

## Лінт і ESLint (без паралельних запусків)

Щоб не запускати **кілька** одночасних **`eslint`** (і не перевантажувати диск/CPU), **заборонено** стартувати `bun run lint` / `lint-js` / `eslint` **паралельно** в різних Bash-задачах, **фонових** shells чи **субагентах** (Task тощо). Має бути **один** послідовний прогон на сесію; команда **`/n-lint`** — **не** ділити на паралельні підзадачі. Деталі: `.cursor/skills/n-lint/SKILL.md`.

## Skills

- `.cursor/skills/mdc-check/SKILL.md` — Проаналізувати правило в npm/mdc: максимум перевірюваної логіки й деталей — у check-{id}.mjs з зрозумілими коментарями/JSDoc; у .mdc залишати людинозрозумілий зміст без дублювання алгоритму перевірки
  Команда: `/mdc-check`
- `.cursor/skills/n-adr-normalize/SKILL.md` — Ручний запуск ADR-нормалізації — обхід порогу й min-interval, прогон одного батчу чернеток через LLM, перегляд результату через git diff
  Команда: `/n-adr-normalize`
- `.cursor/skills/n-coverage-fix/SKILL.md` — Автономна команда: запускає coverage, читає ## Recommendations у COVERAGE.md, ітеративно пише тести для вижилих мутантів до конвергенції
  Команда: `/n-coverage-fix`
- `.cursor/skills/n-fix/SKILL.md` — Виправити проєкт відповідно до всіх правил в .cursor/rules/
  Команда: `/n-fix`
- `.cursor/skills/n-fix-tests/SKILL.md` — Ітеративно дописати тести щоб підвищити mutation score — читає вижилі мутанти з COVERAGE.md і запускає агент до конвергенції
  Команда: `/n-fix-tests`
- `.cursor/skills/n-lint/SKILL.md` — Запустити кореневий bun run lint, виправити порушення й підтвердити чистий вихід
  Команда: `/n-lint`
- `.cursor/skills/n-llm-patch/SKILL.md` — Підготовка самодостатнього текстового промпта для іншого Claude/Cursor-агента — read-only аналіз CWD без жодних змін у поточному репо
  Команда: `/n-llm-patch`
- `.cursor/skills/n-publish-telegram/SKILL.md` — Підготовка матеріалу з поточного контексту для публікації в Telegram-каналі команди
  Команда: `/n-publish-telegram`
- `.cursor/skills/n-start-check/SKILL.md` — Smoke-перевірка bun-монорепо: зайти в кожен воркспейс зі `start`-скриптом, прогнати `start` і зафіксувати, чи проєкт взагалі запускається без негайного краху
  Команда: `/n-start-check`
- `.cursor/skills/n-taze/SKILL.md` — Оновлення версій модулів проекту з аналізом major-змін і автоматичним рефакторингом несумісного коду
  Команда: `/n-taze`
