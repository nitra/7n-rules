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
@.cursor/rules/n-js-lint-ci.mdc
@.cursor/rules/n-js-lint.mdc
@.cursor/rules/n-js-run.mdc
@.cursor/rules/n-npm-module.mdc
@.cursor/rules/n-python.mdc
@.cursor/rules/n-rego.mdc
@.cursor/rules/n-security.mdc
@.cursor/rules/n-style-lint.mdc
@.cursor/rules/n-test.mdc
@.cursor/rules/n-text.mdc
@.cursor/rules/n-vue.mdc
@.cursor/rules/n-worktree.mdc
@.cursor/rules/scripts.mdc

## Лінт і ESLint (паралелізм)

Паралельний лінт по **різних** файлах — **дозволено**: диз'юнктні набори (per-file `lint` на змінених vs origin) не конфліктують і не перевантажують диск/CPU. Серіалізувати треба лише **whole-tree** прогони того самого корпусу (`bun run lint`, `n-cursor lint --full` по всьому репо) — щоб не дублювати важкий full-scan. Деталі: `.cursor/skills/n-lint/SKILL.md`.

## Worktree-only skills (`meta.json` → `worktree: true`)

Скіл із **`worktree: true`** у `meta.json` запускається **виключно** в окремому git-worktree (`.worktrees/<current-branch>-<suffix>/`) — **не** в основному дереві й **не** паралельно. Перший крок такого скіла (блок `n-cursor:worktree:start` у його `SKILL.md`) — **preflight**: якщо `git rev-parse --show-toplevel` не вказує під `.worktrees/`, **STOP** і не питай користувача про назву гілки; створи worktree від поточної гілки готовим snippet з `SKILL.md` за конвенцією `<current-branch>-<suffix>` і без shell expansion (без command substitution, variable expansion чи backticks). Чисте робоче дерево — **не** привід пропустити preflight.

## Skills

- `.cursor/skills/mdc-check/SKILL.md` — Проаналізувати правило в npm/mdc: максимум перевірюваної логіки й деталей — у check-{id}.mjs з зрозумілими коментарями/JSDoc; у .mdc залишати людинозрозумілий зміст без дублювання алгоритму перевірки
  Команда: `/mdc-check`
- `.cursor/skills/n-adr-normalize/SKILL.md` — Ручний запуск ADR-нормалізації — обхід порогу й min-interval, прогон одного батчу чернеток через LLM, перегляд результату через git diff
  Команда: `/n-adr-normalize`
- `.cursor/skills/n-coverage-fix/SKILL.md` — Автономна команда: запускає n-cursor coverage → читає вцілілих мутантів → ітеративно пише тести до конвергенції (max 3 ітерації)
  Команда: `/n-coverage-fix`
- `.cursor/skills/n-docgen/SKILL.md` — Обходить проєкт і для кожного кодового файлу (js/mjs/ts/vue/py) пише лаконічну поведінкову українську md-документацію у теку docs/ поряд із кодом — диспатчить окремого субагента на кожен файл, за правилами adr/ci4
  Команда: `/n-docgen`
- `.cursor/skills/n-fix/SKILL.md` — Виправити проєкт відповідно до всіх правил в .cursor/rules/
  Команда: `/n-fix`
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
- `.cursor/skills/n-worktree/SKILL.md` — Створення та керування git-worktree через n-cursor worktree CLI: ізольований workspace у .worktrees/<branch>/ з інвентарним файлом-описом
  Команда: `/n-worktree`
