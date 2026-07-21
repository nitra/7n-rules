---
name: n-storybook
description: >-
  Канон Storybook для Vue-компонентних бібліотек — прогін lint-поверхонь правила
  storybook (scope/scaffold/vitest-config/hygiene) по поточному репо, і окремий
  --adopt режим для пакетів із уже наявним ручним Storybook (діагностика diff
  проти канону без сліпого перезапису)
version: '1.0'
---

<!-- n-rules:worktree:start -->
> [!IMPORTANT]
> **Worktree-only skill.** Виконується **виключно** в окремому git-worktree (`.worktrees/<current-branch>-storybook/`) і **не** паралелиться — один інстанс за раз.

**Крок 0 — preflight (обовʼязковий, перед будь-якими іншими діями).** Якщо перевірка падає — **STOP**: не питай користувача про назву гілки, а сам створи worktree від поточної гілки за конвенцією `<current-branch>-storybook`. Суфікс `storybook` — коротка (до 10 символів) транслітерація задачі. Не виконуй **жоден** наступний крок скіла, поки preflight не завершився успіхом.

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
```

**Root-assert.** Якщо `pwd` **не** збігається з виводом `git rev-parse --show-toplevel` — ти в **піддиректорії** робочого дерева (worktree-шляхи нижче відносні до кореня репо). Спершу перейди в корінь: `cd <toplevel>` (literal-шлях із виводу), і лише тоді продовжуй preflight. Не створюй worktree з піддиректорії — `cd .worktrees/<…>` звідти впаде.

Якщо `git rev-parse --show-toplevel` показав, що ти **не** в `.worktrees/`, візьми вивід `git branch --show-current` як `<current-branch>` і виконай **literal-команди без shell expansion** (без command substitution, variable expansion чи backticks). Наприклад, якщо поточна гілка `feature/x`:

```bash
npx @7n/mt worktree create "feature/x-storybook" "n-storybook: worktree-only skill"
cd ".worktrees/feature-x-storybook"
```

Тобто branch-argument лишає slash як у git-гілці, а шлях для `cd` бере sanitized форму: slash → `-`.

**Крок 0.1 — bootstrap у новому дереві (після `cd`).** Дерево щойно створене й **без** `node_modules`. Постав залежності локально — тоді `npx @7n/rules <cmd>` бере локальну копію без походу в реєстр:

```bash
bun install
```
<!-- n-rules:worktree:end -->

# n-storybook — канон Storybook для Vue-компонентних бібліотек

Джерело рішення: `docs/adr/канон-storybook-для-vue-компонентних-бібліотек.md`. Уся логіка канону
(скоуп, скафолд, vitest-конфіг, гігієна залежностей, adopt-діагностика) живе в правилі `storybook`
пакета `@7n/rules-lang-js` (`node_modules/@7n/rules-lang-js/rules/storybook/`) — цей скіл лише
тонка обгортка запуску, за зразком `doc-files`.

## Передумови

- Правило `storybook` увімкнене у `.n-rules.json` (`"storybook"` у `rules`) — інакше lint-поверхні
  concern-ів не виконуються (правило `alwaysApply: false`, хвильовий rollout, ADR Decision Outcome).
- Плагін `@7n/rules-lang-js` встановлений (JS/Vue-екосистема) — сигнал автодетекту: кореневий
  `package.json`.

## Звичайний запуск (rule увімкнене, без адопції)

```bash
npx @7n/rules lint storybook
```

Прогонить усі lint-поверхні правила (`scope`, `scaffold`, `vitest-config`, `hygiene`) по всьому
репо. T0-autofix (`fixability: config` — детермінований, без LLM-ladder) відтворює канонічний
скафолд ЛИШЕ для секцій, яких немає ВЗАЄМНО (`.storybook/main.js`, `preview.js`,
`package.json#scripts.storybook`, `vitest.config`-projects, `vitest.stryker.config`) — з
`template/` правила. Наявний-але-розбіжний файл (маркер канону відсутній) — `fixability: config`
зупиняється після T0 без LLM-ladder (canon — одна правильна форма, вгадувати нема чого): звіт
покаже violation, ручне чи agent-виправлення за посиланням на `storybook.mdc`/`vitest-config.mdc`.

Звіт користувачу — стандартний вивід `n-rules lint`: список violations (якщо є) + підсумок
виправлених T0-патернів.

## `--adopt` — пакети з уже наявним ручним Storybook (ADR Кластер 8)

Для пакетів, де `.storybook/` вже існує (ручне впровадження ДО канону чи паралельно з ним) —
окремий діагностичний режим: diff по секціях проти канонічних `template/`
(`main.js`/`preview.js`/`mocks/gql-sse.js`/`package.json#scripts.storybook`/vitest
`test.projects`/`vitest.stryker.config`), **без сліпого перезапису** розбіжних файлів.
Автофікс (`--fix-missing`) генерує ЛИШЕ секції, яких немає ВЗАГАЛІ — розбіжні секції завжди
йдуть як інструкція для агента/людини, ніколи не переписуються автоматично.

```bash
# Діагностика всіх пакетів у скоупі (без запису)
bun node_modules/@7n/rules-lang-js/rules/storybook/adopt/main.mjs

# + генерація повністю відсутніх секцій (main.js/preview.js/mocks/scripts/vitest-конфіги
# лишаються недоторканими, якщо вже існують хоч у якомусь вигляді)
bun node_modules/@7n/rules-lang-js/rules/storybook/adopt/main.mjs --fix-missing

# Звузити діагностику до конкретних пакетів (root dir, той самий формат що storybook.optOut)
bun node_modules/@7n/rules-lang-js/rules/storybook/adopt/main.mjs --fix-missing packages/ui packages/legacy-ui
```

Прогін через прямий виклик скрипта плагіна (`node_modules/@7n/rules-lang-js/...`) — CLI-плюмбінг
окремого прапорця `--adopt` у ядро `n-rules.js` для однієї команди одного правила визнано
надлишковим (нема інших concern-ів з подібним diagnostic-only режимом; якщо з'явиться другий
кандидат — тоді вартий узагальнення на рівні ядра).

### Формат звіту

Для кожного пакета — статус (`canonical` / `missing-files` / `differs` / `broken`) і розклад
по секціях (`match` / `differ` / `missing`, з поясненням для `differ`). При `--fix-missing` —
перелік згенерованих файлів. Приклад одного пакета:

```text
⚠️  [packages/legacy-ui] differs
  ✗ main.js (packages/legacy-ui/.storybook/main.js): differ — бракує: viteFinal-override vite.config пакета
  + preview.js (packages/legacy-ui/.storybook/preview.js): missing
  ✗ package.json#scripts.storybook (packages/legacy-ui/package.json): differ — зараз 'storybook dev', канон '...'
```

Прочитай звіт користувачу: скільки пакетів канонічні, скільки мають лише прогалини (безпечно
`--fix-missing`), скільки мають розбіжності (потребують ручного рішення — мігрувати секцію на
канон чи свідомо лишити виняток), скільки зламані (circuit breaker нижче).

## Circuit breaker (ADR)

Якщо діагностика чи фікс одного пакета кидає виняток (пошкоджений файл, directory замість файлу
тощо) — цей пакет позначається `status: 'broken'` з текстом помилки, а решта пакетів прогону
обробляються далі. Один зламаний пакет ніколи не валить увесь `--adopt`-прогін.

## Rollout-порядок (ADR Кластер 8)

Пілот на одному репо перед глобальним увімкненням правила; серед пакетів одного репо — малі
спершу (менше `.vue`-файлів → менший blast radius одного скафолд-фейлу). Це організаційна
рекомендація для агента/людини, що вмикає правило — скіл сам не має списку "усіх репо
організації", тому не автоматизує послідовність.
