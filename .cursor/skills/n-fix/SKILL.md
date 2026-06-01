---
name: n-fix
description: >-
  Виправити проєкт відповідно до всіх правил в .cursor/rules/
---

<!-- n-cursor:worktree:start -->

> [!IMPORTANT]
> **Worktree-only skill.** Виконується **виключно** в окремому git-worktree (`.worktrees/<current-branch>-fix/`) і **не** паралелиться — один інстанс за раз.

**Крок 0 — preflight (обовʼязковий, перед будь-якими іншими діями).** Якщо перевірка падає — **STOP**: не питай користувача про назву гілки, а сам створи worktree від поточної гілки за конвенцією `<current-branch>-fix`. Суфікс `fix` — коротка (до 10 символів) транслітерація задачі. Не виконуй **жоден** наступний крок скіла, поки preflight не завершився успіхом.

```bash
if ! git rev-parse --show-toplevel | grep -q '/\.worktrees/'; then
  B=$(git branch --show-current)
  W="${B}-fix"
  P="${W//\//-}"
  npx @nitra/cursor worktree add "$W" "n-fix: worktree-only skill"
  cd ".worktrees/${P}"
fi
```

<!-- n-cursor:worktree:end -->

# n-fix — автоматичне виправлення проєкту

## Scope

Цей скіл відповідає **лише за структуру** проєкту: щоб `.cursor/rules/` + `npx @nitra/cursor fix` були задоволені (наявність конфігів, залежностей, скриптів, GitHub workflows, відсутність заборонених файлів). **Лінт-порушення у самому коді** (ESLint, oxlint, jscpd, cspell, knip, sonarjs, stylelint тощо) — **поза скоупом**; їх діагностує й виправляє **`/n-lint`** (`bun run lint`). Не запускай `bun run lint` із цього скілу і не намагайся виправляти його порушення тут — це задача `/n-lint`. Якщо `npx @nitra/cursor fix` чистий, а `bun run lint` лишився червоним — запусти `/n-lint` окремо.

## Workflow

1. **Діагностика** — запусти перевірку (за замовчуванням лише правила з `.cursor/rules/*.mdc`, для яких у пакеті є programmatic check; повний набір — явні аргументи: `npx @nitra/cursor fix bun ga …`):

```bash
npx @nitra/cursor fix
```

2. **Аналіз** — зчитай вивід, знайди всі `❌` та визнач які правила порушено

3. **Виправлення** — для кожного `❌` відкрий відповідне правило з `.cursor/rules/` і виправ:
   - Створи відсутні конфігураційні файли (`.cspell.json`, `.oxfmtrc.json`, `eslint.config.js`, тощо)
   - Додай відсутні залежності до `package.json`
   - Створи або оновити `.vscode/settings.json` та `extensions.json`
   - Створи відсутні GitHub Actions workflows у `.github/workflows/`
   - Видали заборонені файли та залежності (`package-lock.json`, `yarn.lock`, prettier, тощо)
   - Оновити скрипти в `package.json`

4. **Встановлення** — якщо були змінені залежності:

```bash
bun i
```

5. **Форматування** — відформатуй змінені файли:

```bash
oxfmt .
```

6. **Верифікація** — перевір що все виправлено:

```bash
npx @nitra/cursor fix
```

7. **Результат** — всі `❌` від `npx @nitra/cursor fix` мають стати `✅`. Якщо залишились `❌` — повтори кроки 3-6. Лінт-помилки від `bun run lint` тут **не виправляй** — вони на скіл `/n-lint`.
