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
@.cursor/rules/n-doc-files.mdc
@.cursor/rules/n-feedback.mdc
@.cursor/rules/n-ga.mdc
@.cursor/rules/n-js-lint-ci.mdc
@.cursor/rules/n-js-lint.mdc
@.cursor/rules/n-js-run.mdc
@.cursor/rules/n-npm-module.mdc
@.cursor/rules/n-python.mdc
@.cursor/rules/n-rego.mdc
@.cursor/rules/n-security.mdc
@.cursor/rules/n-style.mdc
@.cursor/rules/n-test.mdc
@.cursor/rules/n-text.mdc
@.cursor/rules/n-tool-surface.mdc
@.cursor/rules/n-vue.mdc
@.cursor/rules/n-worktree.mdc
@.cursor/rules/scripts.mdc

## Лінт і ESLint (паралелізм)

Паралельний лінт по **різних** файлах — **дозволено**: диз'юнктні набори (per-file `lint` на змінених vs origin) не конфліктують і не перевантажують диск/CPU. Серіалізувати треба лише **whole-tree** прогони того самого корпусу (`bun run lint`, `n-cursor lint --full` по всьому репо) — щоб не дублювати важкий full-scan. Деталі: `.cursor/skills/n-lint/SKILL.md`.

## Worktree-only skills (`main.json` → `worktree: true`)

Скіл із **`worktree: true`** у `main.json` запускається **виключно** в окремому git-worktree (`.worktrees/<current-branch>-<suffix>/`) — **не** в основному дереві й **не** паралельно. Перший крок такого скіла (блок `n-cursor:worktree:start` у його `SKILL.md`) — **preflight**: якщо `git rev-parse --show-toplevel` не вказує під `.worktrees/`, **STOP** і не питай користувача про назву гілки; створи worktree від поточної гілки готовим snippet з `SKILL.md` за конвенцією `<current-branch>-<suffix>` і без shell expansion (без command substitution, variable expansion чи backticks). Чисте робоче дерево — **не** привід пропустити preflight.

## Файлова документація (`doc-files` — обовʼязковий крок, як lint)

Після зміни чи додавання кодового файлу його файлова дока (`<dir>/docs/<stem>.md`) має бути **актуальною** — це **обовʼязковий крок кожної задачі**, нарівні з lint. Застарілість детермінується за **CRC** джерела у frontmatter доки. PostToolUse hook (`lint-doc-files --hook`) **сигналить** про дрейф після правки; Stop-hook (`lint-doc-files --git`) **блокує завершення** задачі за наявності застарілих док (виняток — масовий прогін понад поріг `N_CURSOR_DOC_FILES_GATE_MAX`, дефолт 50). Регенерація — `/doc-files` (JS-оркестрована, не диспатч субагентів). Агрегуюча дока (module-summary, доменні) — окремий скіл `/doc-aggregate`, за запитом.

## Skills

- `.cursor/skills/mdc-check/SKILL.md` — Проаналізувати правило в npm/mdc: максимум перевірюваної логіки й деталей — у check-{id}.mjs з зрозумілими коментарями/JSDoc; у .mdc залишати людинозрозумілий зміст без дублювання алгоритму перевірки
  Команда: `/mdc-check`
- `.cursor/skills/n-adr-normalize/SKILL.md` — Ручний запуск ADR-нормалізації — обхід порогу й min-interval, прогон одного батчу чернеток через LLM, перегляд результату через git diff
  Команда: `/n-adr-normalize`
- `.cursor/skills/n-coverage-fix/SKILL.md` — Автономна команда: запускає n-cursor coverage → читає вцілілих мутантів → ітеративно пише тести до конвергенції (max 3 ітерації)
  Команда: `/n-coverage-fix`
- `.cursor/skills/n-doc-files/SKILL.md` — Обовʼязковий крок задачі (як lint): для кожного зміненого/нового кодового файлу (js/mjs/ts/vue/py) JS-оркестрована генерація лаконічної поведінкової української md-документації у теку docs/ поряд із кодом, зі звіркою застарілості за CRC у frontmatter
  Команда: `/n-doc-files`
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
