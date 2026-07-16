<!-- Цей файл генерується автоматично через `npx @7n/rules`. Не редагуй вручну. -->

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
@.cursor/rules/n-js-run.mdc
@.cursor/rules/n-js.mdc
@.cursor/rules/n-local-ai.mdc
@.cursor/rules/n-npm-module.mdc
@.cursor/rules/n-python.mdc
@.cursor/rules/n-rego.mdc
@.cursor/rules/n-rust.mdc
@.cursor/rules/n-security.mdc
@.cursor/rules/n-style.mdc
@.cursor/rules/n-test.mdc
@.cursor/rules/n-text.mdc
@.cursor/rules/n-tool-surface.mdc
@.cursor/rules/n-vue.mdc
@.cursor/rules/n-worktree.mdc
@.cursor/rules/scripts.mdc

## Лінт і ESLint (паралелізм)

Дельта-`lint` (типовий задачний прогін) — **без черги**, паралельні запуски по різних файлах дозволені. `npx @7n/rules lint --full` має **вбудовану глобальну чергу** (spec 2026-07-03): один full-прогін на машину; запуск у черзі показує свою позицію, решту черги і живий прогрес-бар активного прогону (`⏳ lint --full у черзі #… · працює pid … [██…] 5/12 · …` — штатна черга, не зависання; fail-closed таймаут 45 хв). Ідентичний повтор --full на незміненому дереві дедуплікується (`♻️ … пропускаю`). Координувати запуски вручну не треба. Деталі: `.cursor/skills/n-lint/SKILL.md`.

## Worktree-only skills (`main.json` → `worktree: true`)

Скіл із **`worktree: true`** у `main.json` запускається **виключно** в окремому git-worktree (`.worktrees/<current-branch>-<suffix>/`) — **не** в основному дереві й **не** паралельно. Перший крок такого скіла (блок `n-rules:worktree:start` у його `SKILL.md`) — **preflight**: якщо `git rev-parse --show-toplevel` не вказує під `.worktrees/`, **STOP** і не питай користувача про назву гілки; створи worktree від поточної гілки готовим snippet з `SKILL.md` за конвенцією `<current-branch>-<suffix>` і без shell expansion (без command substitution, variable expansion чи backticks). Чисте робоче дерево — **не** привід пропустити preflight.

## Файлова документація (`doc-files` — обовʼязковий крок, як lint)

Після зміни чи додавання кодового файлу його файлова дока (`<dir>/docs/<stem>.md`) має бути **актуальною** — це **обовʼязковий крок кожної задачі**, нарівні з lint. Застарілість детермінується за **CRC** джерела у frontmatter доки. PostToolUse hook (`hook --post-tool-use`) **сигналить** про дрейф після правки через per-file lint правила. Регенерація — `/doc-files` (JS-оркестрована, не диспатч субагентів). Агрегуюча дока (module-summary, доменні) — окремий скіл `/doc-aggregate`, за запитом.

## Skills

- `.cursor/skills/mdc-check/SKILL.md` — Проаналізувати правило в npm/mdc: максимум перевірюваної логіки й деталей — у check-{id}.mjs з зрозумілими коментарями/JSDoc; у .mdc залишати людинозрозумілий зміст без дублювання алгоритму перевірки
  Команда: `/mdc-check`
- `.cursor/skills/n-adr-normalize/SKILL.md` — Ручний запуск ADR-нормалізації — обхід порогу й min-interval, прогон одного батчу чернеток через LLM, перегляд результату через git diff
  Команда: `/n-adr-normalize`
- `.cursor/skills/n-brainstorming/SKILL.md` — Фасилітація структурованої генерації ідей для будь-якої теми — продуктові фічі, архітектурні рішення, бізнес-стратегія, назви, маркетинг, вирішення проблем. ОБОВ'ЯЗКОВО використовуй цей skill, коли користувач каже "давай побрейнштормимо", "накидай ідей", "хочу подумати над X", "які є варіанти для...", просить допомогти придумати щось з нуля, або коли задача явно на стадії "ще не зрозуміло що робити" (на відміну від "вже зрозуміло що робити, допоможи зробити"). Не використовуй для чистого уточнення вимог до вже визначеної фічі (це просто уточнюючі питання, без техніки генерації) і не використовуй, якщо користувач вже приніс готове рішення і просить його реалізувати.
  Команда: `/n-brainstorming`
- `.cursor/skills/n-doc-files/SKILL.md` — Обовʼязковий крок задачі (як lint): для кожного зміненого/нового кодового файлу (js/mjs/ts/vue/py) JS-оркестрована генерація лаконічної поведінкової української md-документації у теку docs/ поряд із кодом, зі звіркою застарілості за CRC у frontmatter
  Команда: `/n-doc-files`
- `.cursor/skills/n-lint/SKILL.md` — Запустити дельта-лінт (npx @7n/rules lint) по змінених файлах vs origin, виправити порушення й підтвердити чистий вихід
  Команда: `/n-lint`
- `.cursor/skills/n-llm-patch/SKILL.md` — Підготовка самодостатнього текстового промпта для іншого Claude/Cursor-агента — read-only аналіз CWD без жодних змін у поточному репо
  Команда: `/n-llm-patch`
- `.cursor/skills/n-publish-telegram/SKILL.md` — Підготовка матеріалу з поточного контексту для публікації в Telegram-каналі команди
  Команда: `/n-publish-telegram`
- `.cursor/skills/n-taze/SKILL.md` — Оновлення версій модулів проекту (bun/npm і, якщо є Cargo.toml, Rust-крейти через cargo-edit) з аналізом major-змін і автоматичним рефакторингом несумісного коду
  Команда: `/n-taze`
